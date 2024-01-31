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
import {
  CommonCommandHandler, readLines,
  withBrowserCLIParameters, withCustomCLIParameters,
} from '../../src/cli.js';
import { ExcelWriter } from '../../src/excel.js';

/**
 * functions
 */

async function addURLToCache(browser, queue, url, logger, AEMBulk) {
  try {
    await queue.add(async () => {
      let np;

      try {
        // load page in browser
        np = await browser.newPage();
        const resp = await np.goto(url.transformed);
        await AEMBulk.Puppeteer.smartScroll(np, { postReset: false });

        // compute status
        let status = 'done';
        if (resp.status() >= 400) {
          status = `${resp.status()} - ${resp.statusText()}`;
        } else if (resp.request()?.redirectChain()?.length > 0) {
          status = 'redirect';
        }

        return { url: url.original, status };
      } catch (e) {
        logger.error(`caching ${url.transformed}: ${e.stack})`);
        return { url: url.original, status: e.message };
      } finally {
        if (np) {
          np.close();
        }
      }
    });
  } catch (e) {
    logger.debug(e);
  }
}

/**
 * main
 */

export default function cacheAEMImporter({
  name = '',
  description = '',
  commandParameters = (yargs) => yargs,
  urlsBuilder = (urls) => urls,
}) {
  return {
    command: name,
    describe: description,
    builder: (yargs) => {
      let bYargs = yargs;
      if (commandParameters) {
        bYargs = commandParameters(bYargs);
      }
      bYargs = withBrowserCLIParameters(bYargs);
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for the found URLs',
          default: 'cache-report.xlsx',
          type: 'string',
        });
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      logger.debug(`handler - cache start - ${logger.level}`);

      /**
       * init
       */

      //
      // parse URLs
      //
      let urls = [];
      if (argv.interactive) {
        urls = await readLines(argv.listBreaker);
      } else if (argv.file) {
        // Read the list of URLs from the file
        urls = fs.readFileSync(argv.file, 'utf-8').split('\n').filter(Boolean);
      } else {
        logger.warn('Please specify either a file or interactive mode');
        process.exit(1);
      }
      logger.info(`Processing ${urls.length} URLs with ${argv.workers} workers`);

      // init excel report
      const excelReport = new ExcelWriter({
        filename: argv.excelReport,
        headers: ['URL', 'path', 'path level 1', 'path level 2', 'path level 3', 'filename', 'cache status'],
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
      const queue = new PQueue({ concurrency: argv.workers || 2 });

      // concatenate errors and only display them at the end
      queue.on('error', (error) => {
        logger.error(error);
      });

      // global browser and page objects
      let browser;

      try {
        const browserOptions = {
          headless: argv.headless,
          disableJS: argv.disableJS,
        };
        if (argv.useLocalChrome) {
          browserOptions.useLocalChrome = true;
        }
        if (argv.userDataDir) {
          browserOptions.userDataDir = argv.userDataDir;
        }

        // init browser
        [browser] = await AEMBulk.Puppeteer.initBrowser(browserOptions);

        // triggered each time a job is completed
        queue.on('completed', async (result) => {
          logger.debug(`cache result ${result.status.padEnd(8)} for ${result.url}`);
          await excelReport.addRow(result);
        });

        // build the list of URLs to cache
        const transformedURLs = urlsBuilder(urls, {
          argv,
          logger,
        });
        for (const url of transformedURLs) {
          addURLToCache(browser, queue, url, logger, AEMBulk);
        }
        logger.debug(`queued ${transformedURLs.length} url(s) to be cached`);

        await new Promise((resolve) => {
          queue.on('idle', () => {
            logger.debug('handler - queue idle');
            resolve();
          });
        });
      } catch (e) {
        logger.debug(e);
      } finally {
        logger.debug('handler - finally');
        if (browser) {
          browser.close();
        }
      }

      await excelReport.write();
    }),
  };
}
