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
import { CommonCommandHandler, readLines, withCustomCLIParameters } from '../../src/cli.js';
import { ExcelWriter } from '../../src/excel.js';

/**
 * main
 */

export default function CheckURLsCmd() {
  return {
    command: 'check-urls',
    describe: 'Check HTTP Status for a list of URLs',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for the found URLs',
          default: 'check-urls-report.xlsx',
          type: 'string',
        })
        .option('headers', {
          alias: 'h',
          describe: 'file containing custom headers to include in the request',
          type: 'string',
        });
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger,
    }) => {
      logger.debug(`check-urls main handler - start - ${logger.level}`);

      let excelReport;

      try {
        // parse URLs
        let urls = [];
        if (argv.interactive) {
          urls = await readLines(argv.listBreaker);
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
          headers: ['URL', 'path', 'path level 1', 'path level 2', 'path level 3', 'filename', 'http status'],
          formatRowFn: (record) => {
            const u = new URL(record.url);
            const levels = u.pathname.split('/');
            const filename = levels[levels.length - 1];
            while (levels.length < 4) {
              levels.push('');
            }
            const r = [record.url, u.pathname].concat(levels.slice(1, 4).map((l) => ((l === filename) ? ('') : (l || ' '))));
            return r.concat([filename, record.status]);
          },
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
          await excelReport.addRow({
            url: result.url,
            status: result.status,
          });
        });

        const donePromise = new Promise((resolve) => {
          queue.on('idle', () => {
            logger.debug('handler - queue idle');
            resolve();
          });
        });

        // read custom headers
        let headers = {};
        if (argv.headers) {
          headers = JSON.parse(fs.readFileSync(argv.headers, 'utf-8'));
        }

        // add items to queue
        urls.forEach((url) => {
          queue.add(async () => {
            try {
              logger.debug(`fetching ${url}`);
              const resp = await fetch(url, {
                headers,
                timeout: {
                  request: 60000,
                },
              });

              if (!resp.ok) {
                logger.error(resp);
                throw new Error(`fetch ${url}: ${resp.statusCode}`);
              }

              return {
                url,
                status: resp.status,
              };
            } catch (error) {
              logger.error(error.cause);
              logger.error(`fetch ${url}: ${error.message}`);
              return {
                url,
                status: error.message,
              };
            }
          });
        });

        // start the queue
        queue.start();

        await donePromise;
      } finally {
        logger.debug('check-urls main handler - finally');
        if (excelReport) {
          logger.info('writing excel report');

          // write/close excel report
          await excelReport.close();
        }
      }
    }),
  };
}
