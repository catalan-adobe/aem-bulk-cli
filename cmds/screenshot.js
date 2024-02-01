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
import fp from 'find-free-port';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { ExcelWriter } from '../src/excel.js';
import { CommonCommandHandler, readLines, withCustomCLIParameters } from '../src/cli.js';
import { getLogger } from '../src/logger.js';

class PortManager {
  #assignedPorts = [];

  constructor(initPort) {
    this.initPort = initPort;
    this.lockedPort = initPort - 1;
  }

  async getFreePort() {
    this.lockedPort += 1;
    const [port] = await fp(this.lockedPort);
    this.#assignedPorts.push(port);
    this.port = port;
    return this.port;
  }

  releasePort(port) {
    this.#assignedPorts = this.#assignedPorts.filter((p) => p !== port);
  }
}

const portManager = new PortManager(9222);

/**
 * functions
 */

async function getScreenshot(url, browserOptions, logger, AEMBulk) {
  const execId = randomUUID();
  logger.info(`get screenshot for ${url} (execId: ${execId})`);

  let port;
  let browser;
  let page;
  const tmpDir = `${tmpdir}/chrome-tmp-${execId}`;

  try {
    port = await portManager.getFreePort();

    [browser, page] = await AEMBulk.Puppeteer.initBrowser({
      port,
      disableJS: browserOptions.disableJS,
      useLocalChrome: browserOptions.useLocalChrome,
      width: browserOptions.pageWidth,
      adBlocker: browserOptions.adBlocker,
      gdprBlocker: browserOptions.gdprBlocker,
      headless: browserOptions.headless,
      userDataDir: tmpDir,
    });

    const res = await AEMBulk.Puppeteer.runStepsSequence(
      page,
      url,
      [
        AEMBulk.Puppeteer.Steps.postLoadWait(browserOptions.postLoadWait),
        AEMBulk.Puppeteer.Steps.execAsync(async (browserPage) => {
          if (browserOptions.removeSelectors?.length > 0) {
            await browserPage.evaluate((selector) => {
              // eslint-disable-next-line no-undef
              document.querySelectorAll(selector).forEach((el) => el.remove());
            }, browserOptions.removeSelectors?.join(', '));
          }
          if (!browserOptions.disableJS) {
            await AEMBulk.Puppeteer.smartScroll(browserPage);
          }
        }),
        AEMBulk.Puppeteer.Steps.fullPageScreenshot({
          outputFolder: browserOptions.screenshotsFolder,
        }),
      ],
      getLogger(`browser-${execId}`),
    );

    // cool down
    await AEMBulk.Time.sleep(250);

    return {
      url,
      pageWidth: browserOptions.pageWidth,
      screenshotPath: res.screenshotPath,
      status: 'done',
    };
  } finally {
    if (port) {
      portManager.releasePort(port);
    }
    if (browser) {
      await browser.close();
    }
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

async function addURLToSCreen(queue, url, logger, browserOptions, AEMBulk) {
  try {
    await queue.add(async () => {
      try {
        return await getScreenshot(url, browserOptions, logger, AEMBulk);
      } catch (e) {
        logger.error(`get screenshot for ${url}: ${e.stack})`);
        return { url, status: e.message };
      }
    });
  } catch (e) {
    logger.error(`add url to analyse in queue: ${e.stack}`);
  }
}

/**
 * main
 */

export default function screenshotCmd() {
  return {
    command: 'screenshot',
    describe: 'Take full page screenshot for a list of URLs',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for processed URLs',
          default: 'screenshot-report.xlsx',
          type: 'string',
        })
        .option('screenshots-folder', {
          alias: 'screenshotsFolder',
          describe: 'Path to the folder where screenshots will be saved',
          default: 'screenshots',
          type: 'string',
        })
        // options related to browser handling
        .option('disable-js', {
          alias: 'disableJS',
          describe: 'Disable JavaScript',
          type: 'boolean',
          default: false,
        })
        .option('page-width', {
          alias: 'pageWidth',
          describe: 'Width of the page to capture (in px.)',
          type: 'number',
          default: 1280,
        })
        .option('remove-selector', {
          alias: 'removeSelector',
          describe: 'CSS Selector to remove from the page before taking the screenshot',
          type: 'array',
          default: [],
        })
        .option('post-load-wait', {
          alias: 'postLoadWait',
          describe: 'The time to wait after page loaded, before starting to take the screenshot (in ms.)',
          type: 'number',
          default: 500,
        })
        .option('no-headless', {
          alias: 'noHeadless',
          describe: 'No headless browser',
          type: 'boolean',
        })
        .option('no-ad-blocker', {
          alias: 'noAdBlocker',
          describe: 'No AD blocker used in the headless browser',
          type: 'boolean',
        })
        .option('no-gdpr-blocker', {
          alias: 'noGdprBlocker',
          describe: 'No GDPR blocker used in the headless browser',
          type: 'boolean',
        })
        .group([
          'page-width', 'disable-js', 'remove-selector', 'post-load-wait',
          'no-headless', 'no-ad-blocker', 'no-gdpr-blocker',
        ], 'Browser Options:')

        .help();
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      logger.debug(`handler - screenshot start - ${logger.level}`);

      /**
       * init
       */

      const browserOptions = {
        useLocalChrome: true,
        screenshotsFolder: argv.screenshotsFolder,
        pageWidth: argv.pageWidth,
        removeSelectors: argv.removeSelector,
        postLoadWait: argv.postLoadWait,
        headless: argv.headless ?? true,
        adBlocker: argv.adblocker ?? true,
        gdprBlocker: argv.gdprBlocker ?? true,
        disableJS: argv.disableJS ?? false,
      };

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
        headers: ['url', 'width', 'status', 'screenshot path'],
        formatRowFn: (r) => ['url', 'pageWidth', 'status', 'screenshotPath'].map((k) => r[k]),
        writeEvery: Math.min(Math.round(urls.length / 10), 1000),
      });

      try {
        // init work queue
        const queue = new PQueue({
          concurrency: argv.workers,
        });

        // concatenate errors and only display them at the end
        queue.on('error', (error) => {
          logger.error(error);
        });

        // triggered each time a job is completed
        queue.on('completed', async (result) => {
          try {
            logger.info(`screenshot taken for ${result.url}`);
            await excelReport.addRow(result);
          } catch (e) {
            logger.error(`handler - queue completed: ${e.stack}`);
            throw e;
          }
        });

        const donePromise = new Promise((resolve) => {
          queue.on('idle', () => {
            logger.debug('handler - queue idle');
            resolve();
          });
        });

        // add items to queue
        for (const url of urls) {
          addURLToSCreen(queue, url, logger, browserOptions, AEMBulk);
        }

        await donePromise;
      } catch (e) {
        logger.error(`main command thread: ${e.stack}`);
      } finally {
        await excelReport.write();
        logger.debug('handler - lighthouse done');
      }
    }),
  };
}
