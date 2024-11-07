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
import path from 'path';
import { randomUUID } from 'crypto';
import { CommonCommandHandler, readLines, withCustomCLIParameters } from '../src/cli.js';
import { ExcelWriter } from '../src/excel.js';
import { getLogger } from '../src/logger.js';

const GOOGLE_API_ENV_KEY = 'AEM_BULK_LH_GOOGLE_API_KEY';
const LH_CATEGORIES_KEYS = ['performance', 'accessibility', 'best-practices', 'seo'];
const LH_AUDIT_KEYS = ['speed-index', 'first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift'];

class LHError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

/**
 * functions
 */

async function runLighthouse(url, type, pacingDelay, apiKey, AEMBulk) {
  await AEMBulk.Time.sleep(pacingDelay);
  const execId = randomUUID();
  const startTime = Date.now();

  if (type === 'google') {
    const psiURL = `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=ACCESSIBILITY&category=BEST_PRACTICES&category=PERFORMANCE&category=SEO&strategy=MOBILE&key=${apiKey}`;

    const res = await fetch(psiURL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    const duration = Date.now() - startTime;
    const timestamp = new Date().toISOString();

    if (!res.ok) {
      const result = {
        execId,
        url,
        duration,
        timestamp,
        error: `PSI error: ${res.status} ${res.statusText}`,
      };

      try {
        const errorJson = await res.json();

        result.error = `${errorJson.error.code} - ${errorJson.error.message}`;
      } catch {
        // noop
      }

      return result;
    }

    const report = await res.json();
    return {
      execId,
      url,
      report,
      duration,
      timestamp,
    };
  } else if (type === 'local') {
    let browser;
    let page;

    try {
      [browser, page] = await AEMBulk.Puppeteer.initBrowser({
        useLocalChrome: true,
      });

      const res = await AEMBulk.Puppeteer.runStepsSequence(
        page,
        url,
        [
          AEMBulk.Puppeteer.Steps.runLighthouseCheck(),
        ],
        getLogger('puppeteer'),
      );

      const duration = Date.now() - startTime;
      const timestamp = new Date().toISOString();

      // cool down
      await AEMBulk.Time.sleep(250);

      return {
        execId,
        url,
        report: { lighthouseResult: res.lighthouse.reportFull.lhr },
        duration,
        timestamp,
      };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  } else {
    throw new Error(`Unknown PSI type: ${type}`);
  }
}

async function addURLToAnalyse(type, pacingDelay, queue, url, logger, apiKey, AEMBulk) {
  try {
    await queue.add(async () => {
      try {
        return await runLighthouse(url, type, pacingDelay, apiKey, AEMBulk);
      } catch (e) {
        logger.error(`caching ${url.transformed}: ${e.stack})`);
        return {
          ...e.details,
          status: 'error',
          message: e.message,
        };
      }
    });
  } catch (e) {
    logger.error(`add url to analyse in queue: ${e.stack}`);
  }
}

/**
 * main
 */

let excelReport = null;

export default function lighthouseCmd() {
  return {
    command: 'lighthouse',
    describe: 'Execute Lighthouse analysis for a list of URLs',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('psi-type', {
          alias: 'psiType',
          describe: 'Type of PSI check to use (local|google)',
          default: 'google',
          type: 'string',
        })
        .option('lh-google-api-key', {
          alias: 'lhGoogleApiKey',
          describe: 'API key for Google PSI check',
          type: 'string',
        })
        .option('pacing-delay', {
          alias: 'pacingDelay',
          describe: 'Delay in milliseconds between each lighthouse analysis',
          type: 'number',
          default: 250,
        })
        .group(['psiType', 'lhGoogleApiKey', 'pacingDelay'], 'Lighthouse Analysis Options:')
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for analysed URLs',
          default: 'lighthouse-report.xlsx',
          type: 'string',
        })
        .option('reports-folder', {
          alias: 'reportsFolder',
          describe: 'Folder for generated report',
          default: 'lh-reports',
          type: 'string',
        })
        .epilog(`(You can also set the Google PSI Check API key in the ${GOOGLE_API_ENV_KEY} environment variable)`);
    },
    handler: (new CommonCommandHandler(null, null, async () => {
      if (excelReport) {
        await excelReport.close();
      }
    })).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      let { workers } = argv;
      // google api key required
      const lhGoogleAPIKey = process.env[GOOGLE_API_ENV_KEY];
      if (argv.psiType === 'google' && !lhGoogleAPIKey) {
        throw new Error(`Google PSI requires a valid API key in the ${GOOGLE_API_ENV_KEY} environment variable`);
      }

      if (argv.psiType === 'local' && workers > 1) {
        logger.warn('Warning: as per Google documentation, it is not recommended to run multiple Lighthouse analysis on local machine! Forcing workers to 1');
        workers = 1;
      }

      logger.debug(`handler - lighthouse start - ${logger.level}`);

      /**
       * init
       */

      // create reports folder if does not exist
      if (!fs.existsSync(argv.reportsFolder)) {
        fs.mkdirSync(argv.reportsFolder, { recursive: true });
      }

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
      logger.info(`Processing ${urls.length} URLs with ${workers} workers`);

      // init excel report
      excelReport = new ExcelWriter({
        filename: argv.excelReport,
        headers: ['url', 'execution id', 'status', 'timestamp', 'duration (ms)']
          .concat(LH_CATEGORIES_KEYS.map((k) => `${k} (%)`))
          .concat(LH_AUDIT_KEYS.map((k) => `${k} (ms)`))
          .concat(['message']),
        formatRowFn: (record) => {
          if (record?.status === 'error') {
            return [record.url, record.execId, 'error', record.timestamp, record.duration, '', '', '', '', '', '', '', '', '', record.message];
          } else {
            const { report } = record;
            const { audits, categories } = report.lighthouseResult;
            return [
              record.url, record.execId, 'done', record.timestamp, record.duration,
            ]
              .concat(LH_CATEGORIES_KEYS.map((k) => (('score' in categories[k]) ? Math.round(categories[k].score * 100) : 'N/A')))
              .concat(LH_AUDIT_KEYS.map((k) => (('numericValue' in audits[k]) ? Math.round(audits[k].numericValue * 1000) / 1000 : 'N/A')))
              .concat(['']);
          }
        },
        writeEvery: Math.min(Math.round(urls.length / 10), 1000),
      });

      try {
        // init work queue
        const queue = new PQueue({
          concurrency: workers,
        });

        // concatenate errors and only display them at the end
        queue.on('error', (error) => {
          logger.error(error);

          if (error instanceof LHError) {
            logger.error(`Error for ${error.details.url}: ${error.message}`);

            if (argv.jsonSummary) {
              fs.writeFileSync(argv.jsonSummary, JSON.stringify({
                url: error.details.url,
                status: 'error',
                message: error.message,
                execId: error.details.execId,
                duration: error.details.duration,
              }, null, 2));
            }
          }
        });

        // triggered each time a job is completed
        queue.on('completed', async (result) => {
          try {
            if (result.error) {
              logger.error(`analysis error for ${result.url}: ${result.error}`);
              fs.writeFileSync(path.join(argv.reportsFolder, `${result.execId}.json`), JSON.stringify(result, null, 2));
              if (argv.jsonSummary) {
                fs.writeFileSync(argv.jsonSummary, JSON.stringify(result, null, 2));
              }
              return;
            }

            // write result to file
            fs.writeFileSync(path.join(argv.reportsFolder, `${result.execId}.json`), JSON.stringify(result.report, null, 2));

            const { report } = result;
            const { audits } = report.lighthouseResult;
            const summaryAuditKeys = ['SI', 'FCP', 'LCP', 'TBT', 'CLS'];
            const summary = LH_AUDIT_KEYS.map((k, i) => (`${summaryAuditKeys[i]}: ${('numericValue' in audits[k]) ? Math.round(audits[k].numericValue * 1000) / 1000 : 'N/A'}`)).join(' | ');

            logger.info(`analysis done for ${result.url}: ${summary} (duration: ${result.duration}ms.) id: ${result.execId})`);
          } catch (e) {
            logger.error(`handler - queue item completed: ${e.stack}`);
          }
          // add row to excel report
          await excelReport.addRow(result);
        });

        const donePromise = new Promise((resolve) => {
          queue.on('idle', () => {
            logger.debug('handler - queue idle');
            resolve();
          });
        });

        // add items to queue
        for (const url of urls) {
          addURLToAnalyse(
            argv.psiType,
            argv.pacingDelay,
            queue,
            url,
            logger,
            lhGoogleAPIKey,
            AEMBulk,
          );
        }

        await donePromise;
      } catch (e) {
        logger.error(`main command thread: ${e.stack}`);
      }

      // write/close excel report
      await excelReport.close();

      logger.debug('handler - lighthouse done');
    }),
  };
}
