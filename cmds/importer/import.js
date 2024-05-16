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
import fs from 'fs';
import path from 'path';
import * as fastq from 'fastq';
import { ExcelWriter } from '../../src/excel.js';
import { CommonCommandHandler, readLines, withCustomCLIParameters } from '../../src/cli.js';
import { RequestInterceptionManager } from 'puppeteer-intercept-and-modify-requests'
import serveStatic from 'serve-static';
import express from 'express';
import cors from 'cors';

const RETRIES = 1;

async function disableJS(page) {
  const client = await page.target().createCDPSession()
  const interceptManager = new RequestInterceptionManager(client)
  await interceptManager.intercept(
    {
      // specify the URL pattern to intercept:
      urlPattern: '*',
      // optionally filter by resource type:
      resourceType: 'Document',
      // specify how you want to modify the response (may be async):
      modifyResponse({ body }) {
        if (!body) {
          return;
        }
        const regex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gm;
        const subst = '';
        const result = body.replace(regex, subst);
        return {
          body: result,
        }
      },
    },
  );
}

/**
 * worker
 */

async function importWorker({
  // payload
  url,
  retries,
  logger,
}) {
  /* eslint-disable no-async-promise-executor */
  return new Promise(async (resolve) => {
    // context / this
    const {
      AEMBulk,
      options: {
        pacingDelay,
      },
    } = this;

    let browser;
    let page;

    const importResult = {
      url,
      retries,
      status: 'done',
      message: '',
      docxFilename: '',
    };

    try {
      // pacing delay
      await AEMBulk.Time.sleep(pacingDelay);

      [browser, page] = await AEMBulk.Puppeteer.initBrowser({
        port: 0,
        headless: true,
        disableJS: false,
        adBlocker: true,
        gdprBlocker: true,
        extraArgs: ['--disable-features=site-per-process,IsolateOrigins,sitePerProcess'],
      });

      // disable JS
      await disableJS(page);

      // force bypass CSP
      await page.setBypassCSP(true);

      const resp = await page.goto(url, { waitUntil: 'networkidle2' });

      // compute status
      if (resp.status() >= 400) {
        // error -> stop + do not retry
        importResult.status = 'error';
        importResult.message = `status code ${resp.status()}`;
        importResult.retries = 0;
      } else if (resp.request()?.redirectChain()?.length > 0) {
        // redirect -> stop
        importResult.status = 'redirect';
        importResult.message = `redirected to ${resp.url()}`;
      } else {
        // ok -> import
        const u = new URL(url);
        const docxPath = path.join('docx', path.dirname(u.pathname));
        const client = await page.target().createCDPSession();
        await client.send('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath: path.join(process.cwd(), docxPath),
          eventsEnabled: true,
        });

        const filename = await page.evaluate(async () => {
          /* eslint-disable */
          // code executed in the browser context
          await import('http://localhost:8888/js/dist/helix-importer.js');

          // execute default import script
          const out = await WebImporter.html2docx(location.href, document, null, {});

          // get the docx file
          const blob = new Blob([out.docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          const url = window.URL.createObjectURL(blob);

          // download the docx file
          const filename = `${out.path.substring(out.path.lastIndexOf('/') + 1)}.docx`;
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', filename);
          document.body.appendChild(link);
          link.click();

          // return the filename
          return out.path;
          /* eslint-enable */
        });

        logger.debug(`imported page saved to docx file ${docxPath}${filename}.docx`);

        // wait for download to complete
        const dlState = await new Promise(async (res) => {
          client.on('Browser.downloadProgress', async ({
            // guid,
            // totalBytes,
            // receivedBytes,
            state,
          }) => {
            if (state !== 'inProgress') {
              res(state);
            }
          });
        });
        logger.debug(`download state: ${dlState}`);

        importResult.docxFilename = `${docxPath}${filename}.docx`;
      }
    } catch (e) {
      importResult.status = 'error';
      importResult.message = e.message;
    }

    // close browser
    if (browser) {
      await browser.close();
    }

    resolve(importResult);
  });
}

async function startHTTPServer() {
  const app = express();
  app.use(cors());
  app.use(serveStatic(path.join(import.meta.dirname, '../../node_modules/@adobe/helix-importer-ui/')));
  return app.listen(8888);
}

/**
 * main
 */

export default function importCmd() {
  return {
    command: 'import',
    describe: 'Import the given URLs to docx file using default import script',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('pacing-delay', {
          alias: 'pacingDelay',
          describe: 'Delay in milliseconds between each request',
          type: 'number',
          default: 250,
        })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for processed URLs',
          default: 'import-report.xlsx',
          type: 'string',
        })
        .group(['pacing-delay', 'excel-report'], 'Import Options:')

        .help();
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      logger.debug(`handler - import start - ${logger.level}`);

      /**
       * init
       */

      // http server to serve the import script
      const httpServer = await startHTTPServer();

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
      const excelReport = new ExcelWriter({
        filename: argv.excelReport,
        headers: ['url', 'docx filename', 'status', 'message'],
        formatRowFn: (r) => {
          const row = ['url', 'docxFilename', 'status', 'message'].map((k) => r[k]);
          return row;
        },
        writeEvery: 1,
      });

      // init queue
      const queue = fastq.promise(
        {
          logger,
          AEMBulk,
          options: {
            pacingDelay: argv.pacingDelay,
          },
        },
        importWorker,
        argv.workers,
      );
      // force pause - no autostart
      await queue.pause();

      /**
       * main
       */

      const queueResultHandler = async (result, err) => {
        if (err) {
          logger.error(`import error: ${err}`);
        } else if (result.status === 'error') {
          logger.error(`import error on ${result.url}: ${result.message}`);
          if (result.retries > 0) {
            logger.error(`retrying ${result.url} - ${result.retries} left`);
            await queue.pause();
            queue.push({ url: result.url, retries: result.retries - 1 }).then(queueResultHandler);
            await queue.resume();
          } else {
            logger.error(`giving up on ${result.url}`);
            await excelReport.addRow(result, true);
          }
        } else {
          // let tplName = '';

          if (result.status === 'done') {
            // const tplHash = result.analysis.template?.hash || '';
          }

          logger.info(`[${result.status.padEnd(8)}] import done for ${result.url} (${result.message})`);
          await excelReport.addRow(result, true);
        }
      };

      try {
        // add items to queue
        for (const url of urls) {
          queue.push({ url, retries: RETRIES, logger }).then(queueResultHandler);
        }

        logger.debug('queue - all items added, start processing');
        await queue.resume();
        logger.debug('queue - wait for drained');
        await queue.drained();
        logger.debug('queue - done, stop queue');
        await queue.kill();
      } catch (e) {
        logger.error(`main command thread: ${e.stack}`);
      }

      // stop http server
      await httpServer.close();

      logger.debug('handler - import done');
    }),
  };
}
