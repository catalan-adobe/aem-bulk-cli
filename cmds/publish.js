/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import PQueue from 'p-queue';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { CommonCommandHandler, readLines, withCustomCLIParameters } from '../src/cli.js';
import { ExcelWriter } from '../src/excel.js';
import { buildAPIURL } from '../src/aem.js';

/**
 * main
 */

export default function publishCmd() {
  return {
    command: 'publish',
    describe: 'Publish pages to AEM Edge Delivery (URLs must be of type "https://<branch>--<repo>--<owner>.hlx.page/<path>")',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for the URLs to publish',
          default: 'publish-report.xlsx',
          type: 'string',
        })
        .option('delete', {
          describe: 'Revert publish operation',
          default: false,
          type: 'boolean',
        })
        .option('stage', {
          describe: 'Edge Delivery stage to publish to (choices: preview (hlx.page) or live (hlx.live))',
          default: 'preview',
          type: 'string',
        })
        .group(['stage', 'delete'], 'Publish Options:');
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger,
    }) => {
      logger.debug(`${argv.stage} main handler - start - ${logger.level}`);

      let excelReport;

      try {
        // parse URLs
        let urls = [];
        if (argv.interactive) {
          urls = await readLines(argv.listBreaker, '(URLs must be of type "https://<branch>--<repo>--<owner>.hlx.page/<path>")');
        } else if (argv.file) {
          // Read the list of URLs from the file
          urls = fs.readFileSync(argv.file, 'utf-8').split('\n').filter(Boolean);
        } else {
          throw new Error('Please specify either --file or --interactive mode');
        }
        logger.info(`Processing ${urls.length} URLs with ${argv.workers} workers`);

        // init excel report
        excelReport = new ExcelWriter({
          filename: argv.excelReport,
          headers: ['url', 'api url', `${argv.stage} status`],
          formatRowFn: (record) => [record.url, record.apiURL, record.status],
          writeEvery: Math.min(Math.round(urls.length / 10), 1000),
        });

        // init work queue
        const queue = new PQueue({
          concurrency: argv.workers || 2,
          autoStart: false,
        });

        // concatenate errors and only display them at the end
        queue.on('error', (error) => {
          logger.error(error);
        });

        // triggered each time a job is completed
        queue.on('completed', async (result) => {
          await excelReport.addRow(result);
        });

        const donePromise = new Promise((resolve) => {
          queue.on('idle', () => {
            logger.debug('handler - queue idle');
            resolve();
          });
        });

        const reqOptions = {
          method: argv.delete ? 'DELETE' : 'POST',
          timeout: {
            request: 60000,
          },
        };

        // authentication
        let authToken = null;
        const authFile = path.join(os.homedir(), '.aem-ed-credentials.json');
        if (process.env.AEM_API_TOKEN) {
          authToken = process.env.FRANKLIN_API_TOKEN;
        } else if (fs.existsSync(authFile)) {
          const credentials = JSON.parse(fs.readFileSync(authFile));
          const tempAPIURL = buildAPIURL(argv.stage, urls[0]);
          if (tempAPIURL.includes(credentials.path)) {
            authToken = credentials.auth_token;
          }
        }

        if (authToken) {
          reqOptions.headers = {
            'X-Auth-Token': authToken,
          };
        }

        // add items to queue
        urls.forEach((url) => {
          queue.add(async () => {
            const apiURL = buildAPIURL(argv.stage, url);
            try {
              logger.debug(`fetching ${apiURL}`);
              const resp = await fetch(apiURL, reqOptions);

              if (!resp.ok) {
                throw new Error(`${resp.status}: ${resp.statusText}`);
              }

              let publishStatus = resp.status;
              if (!argv.delete) {
                const apiResp = await resp.json();
                publishStatus = apiResp[argv.stage].status;
              }
              const publishStatusOK = argv.delete ? publishStatus === 204 : publishStatus === 200;
              if (publishStatusOK) {
                logger.warn(`${publishStatus}: ${url}`);
              } else {
                logger.info(`${publishStatus}: ${url}`);
              }

              return {
                url,
                apiURL,
                status: publishStatus,
              };
            } catch (error) {
              logger.error(`publish ${url} on ${argv.stage} stage: ${error}`);
              return {
                url,
                apiURL,
                status: error.message,
              };
            }
          });
        });

        // start the queue
        queue.start();

        await donePromise;
      } finally {
        logger.debug(`${argv.stage} main handler - finally`);
        if (excelReport) {
          logger.info('writing excel report');

          // write/close excel report
          await excelReport.close();
        }
      }
    }),
  };
}
