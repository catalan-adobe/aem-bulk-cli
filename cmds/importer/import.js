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
import { md2docx } from '@adobe/helix-md2docx';
import { RequestInterceptionManager } from 'puppeteer-intercept-and-modify-requests';
import * as fastq from 'fastq';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import serveStatic from 'serve-static';
import sharp from 'sharp';

import { ExcelWriter } from '../../src/excel.js';
import { CommonCommandHandler, readLines, withCustomCLIParameters } from '../../src/cli.js';

const DEFAULT_IMPORT_SCRIPT_URL = 'http://localhost:8888/defaults/import-script.js';

/**
 * functions
 */

async function startHTTPServer() {
  const app = express();
  app.use(cors());
  app.use(serveStatic(path.join(import.meta.dirname, '../../src/importer')));
  return app.listen(8888);
}

async function disableJS(page) {
  const client = await page.target().createCDPSession();
  const interceptManager = new RequestInterceptionManager(client);
  await interceptManager.intercept(
    {
      // specify the URL pattern to intercept:
      urlPattern: '*',
      // optionally filter by resource type:
      resourceType: 'Document',
      // specify how you want to modify the response (may be async):
      modifyResponse({ body }) {
        if (body) {
          const regex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gm;
          const subst = '';
          const result = body.replace(regex, subst);
          return { body: result };
        }
        return { body };
      },
    },
  );
}

async function image2png({ src, data }) {
  try {
    const png = (await sharp(data)).png();
    const metadata = await png.metadata();
    return {
      data: png.toBuffer(),
      width: metadata.width,
      height: metadata.height,
      type: 'image/png',
    };
  } catch (e) {
    /* eslint-disable no-console */
    console.error(`Cannot convert image ${src} to png. It might corrupt the Word document and you should probably remove it from the DOM.`);
    return null;
  }
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
        disableJs,
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
        adBlocker: true,
        gdprBlocker: true,
        disableJS: false,
        devTools: false,
        extraArgs: ['--disable-features=site-per-process,IsolateOrigins,sitePerProcess'],
      });

      // disable JS
      if (disableJs) {
        await disableJS(page);
      }

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

        // force scroll
        if (!disableJs) {
          await AEMBulk.Puppeteer.smartScroll(page, { postReset: true });
        }

        const urlDetails = AEMBulk.FS.computeFSDetailsFromUrl(url);
        const docxPath = path.join('docx', urlDetails.hostname, urlDetails.path);
        if (!fs.existsSync(docxPath)) {
          fs.mkdirSync(docxPath, { recursive: true });
        }

        // inject helix-import library script
        // will provice WebImporter.html2docx function in browser context
        const js = fs.readFileSync(path.join(import.meta.dirname, '../../vendors/helix-importer.js'), 'utf-8');
        await page.evaluate(js);

        const md = await page.evaluate(async (importScriptURL) => {
          /* eslint-disable */
          // code executed in the browser context

          // import the custom transform config          
          const customTransformConfig = await import(importScriptURL);
          
          // execute default import script
          const out = await WebImporter.html2docx(location.href, document, customTransformConfig.default, { toDocx: false, toMd: true });

          // return the md content
          return out.md;
          /* eslint-enable */
        }, DEFAULT_IMPORT_SCRIPT_URL);

        // convert markdown to docx
        const docx = await md2docx(md, {
          docxStylesXML: null,
          image2png,
        });

        // save docx file
        fs.writeFileSync(path.join(process.cwd(), docxPath, `${urlDetails.filename}.docx`), docx);

        logger.debug(`imported page saved to docx file ${docxPath}/${urlDetails.filename}.docx`);

        importResult.docxFilename = `${docxPath}${urlDetails.filename}.docx`;
      }
    } catch (e) {
      importResult.status = 'error';
      importResult.message = e.message;
      console.error(e);
    }

    // close browser
    if (browser) {
      await browser.close();
    }

    resolve(importResult);
  });
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
        .option('disable-js', {
          alias: 'disableJs',
          describe: 'Disable JavaScript execution in the browser',
          type: 'boolean',
          default: true,
        })
        .option('retries', {
          describe: 'Number of retried in case of import error',
          type: 'number',
          default: 1,
        })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for processed URLs',
          default: 'import-report.xlsx',
          type: 'string',
        })
        .group(['disable-js', 'pacing-delay', 'retries', 'excel-report'], 'Import Options:')
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
            disableJs: argv.disableJs,
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
            await excelReport.addRow(result);
          }
        } else {
          // let tplName = '';

          if (result.status === 'done') {
            // const tplHash = result.analysis.template?.hash || '';
          }

          logger.info(`[${result.status.padEnd(8)}] import done for ${result.url} (${result.message})`);
          await excelReport.addRow(result);
        }
      };

      try {
        // add items to queue
        for (const url of urls) {
          queue.push({ url, retries: argv.retries, logger }).then(queueResultHandler);
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

      // write/close excel report
      await excelReport.close();

      // stop http server
      await httpServer.close();

      logger.debug('handler - import done');
    }),
  };
}
