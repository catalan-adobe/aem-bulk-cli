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

const DETECT_LIB = path.join(import.meta.dirname, '../../vendors/detect.no-ui.min.js');
const SCREENSHOTS_FOLDER = 'screenshots';
const RETRIES = 2;

/**
 * worker
 */

async function analyseWorker({
  // payload
  url,
  retries,
}) {
  /* eslint-disable no-async-promise-executor */
  return new Promise(async (resolve) => {
    // context / this
    const {
      AEMBulk,
      options: {
        disableJS,
        withScreenshots,
        pacingDelay,
        templatesCsv,
      },
    } = this;
    const uuid = crypto.randomUUID();

    const userDataDir = path.join(process.cwd(), `.chrome-user-data-${uuid}`);
    let browser;
    let page;

    const analyseResult = {
      url,
      retries,
      status: 'done',
      message: '',
      analysis: {},
    };

    try {
      // pacing delay
      await AEMBulk.Time.sleep(pacingDelay);

      [browser, page] = await AEMBulk.Puppeteer.initBrowser({
        port: 0,
        headless: true,
        useLocalChrome: true,
        userDataDir,
        disableJS,
        adBlocker: true,
        gdprBlocker: true,
        extraArgs: ['--disable-features=site-per-process,IsolateOrigins,sitePerProcess'],
      });

      const preloadFile = fs.readFileSync(DETECT_LIB, 'utf8');
      await page.evaluateOnNewDocument(preloadFile);

      const resp = await page.goto(url, { waitUntil: 'networkidle2' });

      // setup page state
      await AEMBulk.Puppeteer.smartScroll(page, { postReset: true });
      await AEMBulk.Time.sleep(2000);

      // compute status
      if (resp.status() >= 400) {
        // error -> stop + do not retry
        analyseResult.status = 'error';
        analyseResult.message = `status code ${resp.status()}`;
        analyseResult.retries = 0;
      } else if (resp.request()?.redirectChain()?.length > 0) {
        // redirect -> stop
        analyseResult.status = 'redirect';
        analyseResult.message = `redirected to ${resp.url()}`;
      } else {
        // ok -> analyse
        const resultHandle = await page.evaluateHandle(async () => {
          /* global window, document, xp */
          document.querySelectorAll('.navigation-menu ul li > :not(button)').forEach((el) => el.remove());
          await xp.detectSections(document.body, window, { autoDetect: true });
          // await xp.analysePage({ autoDetect: true });
          delete xp.boxes.children;
          return xp.boxes;
        });

        const boxes = await resultHandle.jsonValue();
        boxes.url = url;

        analyseResult.analysis.boxes = boxes;
        analyseResult.analysis.template = boxes.template;

        // take screenshot
        if (withScreenshots) {
          const urlDetails = AEMBulk.FS.computeFSDetailsFromUrl(url);
          const ppp = path.join(SCREENSHOTS_FOLDER, urlDetails.path);

          if (!fs.existsSync(ppp)) {
            fs.mkdirSync(ppp, { recursive: true });
          }
          await page.screenshot({
            format: 'jpeg',
            quality: 25,
            path: path.join(ppp, `template_${urlDetails.filename}.screenshot.jpg`),
            fullPage: true,
          });
          await AEMBulk.Time.sleep(250);
        }

        fs.writeFileSync(templatesCsv, `${boxes.template.hash},${url}\n`, { flag: 'a' });
        await resultHandle.dispose();
      }
    } catch (e) {
      analyseResult.status = 'error';
      analyseResult.message = e.message;
    }

    // close browser
    if (browser) {
      await browser.close();
    }

    fs.rmSync(userDataDir, { recursive: true, force: true });

    resolve(analyseResult);
  });
}

/**
 * main
 */

export default function analyseCmd() {
  return {
    command: 'analyse',
    describe: 'Analyse the given URLs',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('disable-js', {
          alias: 'disableJS',
          describe: 'Disable JavaScript in the orchestrated browser',
          type: 'boolean',
          default: false,
        })
        .option('with-screenshots', {
          alias: 'withScreenshots',
          describe: 'Enable taking screenshots (saved in ./screenshots folder)',
          type: 'boolean',
        })
        .option('templates-csv', {
          alias: 'templatesCsv',
          describe: 'Path to CSV report for templates collected from the URLs',
          default: 'analyse-templates.csv',
          type: 'string',
        })
        .option('pacing-delay', {
          alias: 'pacingDelay',
          describe: 'Delay in milliseconds between each request',
          type: 'number',
          default: 250,
        })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for processed URLs',
          default: 'analyse-report.xlsx',
          type: 'string',
        })
        .group(['disable-js', 'with-screenshots', 'templates-csv', 'excel-report', 'pacing-delay'], 'Analyse Options:')

        .help();
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      logger.debug(`handler - analyse start - ${logger.level}`);

      /**
       * init
       */

      // found templates
      const foundTemplates = [];

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
        headers: ['url', 'status', 'message', 'template name', 'template:hash', 'template:raw'],
        formatRowFn: (r) => {
          const row = ['url', 'status', 'message'].map((k) => r[k]);
          row.push(r.tplName);
          row.push(r.analysis?.template?.hash || '');
          row.push(r.analysis?.template?.raw || '');
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
            disableJS: argv.disableJS,
            withScreenshots: argv.withScreenshots,
            pacingDelay: argv.pacingDelay,
            templatesCsv: argv.templatesCsv,
          },
        },
        analyseWorker,
        argv.workers,
      );
      // force pause - no autostart
      await queue.pause();

      /**
       * main
       */

      const queueResultHandler = async (result, err) => {
        if (err) {
          logger.error(`analyse error: ${err}`);
        } else if (result.status === 'error') {
          logger.error(`analyse error on ${result.url}: ${result.message}`);
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
          let tplName = '';

          if (result.status === 'done') {
            const tplHash = result.analysis.template?.hash || '';
            const u = new URL(result.url);
            const tplPrefix = `${path.dirname(u.pathname).slice(1).replaceAll('/', '_')}_template_`;

            const foundTpl = foundTemplates.find((t) => t.hash === tplHash);
            if (!foundTpl) {
              const tplCount = foundTemplates.filter((t) => t.name === tplPrefix).length.toString().padStart(2, '0');
              foundTemplates.push({
                hash: tplHash,
                name: tplPrefix,
                count: tplCount,
              });
              tplName = tplPrefix + tplCount;
            } else {
              tplName = foundTpl.name + foundTpl.count;
            }
          }

          logger.info(`[${result.status.padEnd(8)}] analyse done for ${result.url} (${result.message})`);
          await excelReport.addRow({
            ...{ tplName },
            ...result,
          });
        }
      };

      try {
        // add items to queue
        for (const url of urls) {
          queue.push({ url, retries: RETRIES }).then(queueResultHandler);
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

      logger.debug('handler - analyse done');
    }),
  };
}
