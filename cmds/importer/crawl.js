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
import { URLPattern } from 'urlpattern-polyfill';
import { CommonCommandHandler, withCustomCLIParameters } from '../../src/cli.js';
import { ExcelWriter } from '../../src/excel.js';

/**
 * functions
 */

async function handleSitemaps(queue, sitemaps, AEMBulk, options = {}) {
  // eslint-disable-next-line no-console
  sitemaps.forEach((s) => options.logger.info(`new sitemap to crawl ${s}`));

  sitemaps.forEach(async (sitemap) => {
    if (sitemap.indexOf('.rss') === -1) {
      try {
        await queue.add(async () => {
          try {
            // eslint-disable-next-line no-console
            options.logger.debug(`crawling sitemap ${sitemap}`);
            const s = await AEMBulk.Web.parseSitemapFromUrl(sitemap, {
              timeout: options.timeout,
            });
            if (s.sitemaps && s.sitemaps.length > 0) {
              await handleSitemaps(queue, s.sitemaps.map((o) => o.url), AEMBulk, options);
            }
            return s;
          } catch (e) {
            throw new Error(`parse sitemap (${sitemap}): ${e}`);
          }
        });
      } catch (e) {
        // nothing
      }
    }
  });
}

async function addURLToCrawl(baseUrl, urlPattern, browser, queue, url, logger, AEMBulk) {
  try {
    await queue.add(async () => {
      let np;

      try {
        np = await browser.newPage();

        await np.goto(url, { waitUntil: 'networkidle2' });

        await AEMBulk.Puppeteer.smartScroll(np, { postReset: false });

        const links = [];
        const hrefs = await np.$$eval('a', (links) => links.map((a) => a.href).filter((href) => href.length > 0));
        hrefs.forEach((href) => {
          const u = new URL(href);
          const link = `${u.origin}${u.pathname}`;
          const matchesUrlPattern = urlPattern ? urlPattern.test(link) : true;
          if (u.origin === baseUrl && matchesUrlPattern) {
            links.push(link);
          }
        });

        return {
          url,
          links,
        };
      } catch (e) {
        logger.error(`${url} ${e.name}: ${e.message} (${e.stack})`);
        return {
          url,
          error: e.message,
        };
      } finally {
        if (browser && np) {
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

export default function crawlCmd() {
  return {
    command: 'crawl',
    describe: 'Crawl a website to discover and collect URLs',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: false, workers: false })
        .option('origin', {
          describe: 'Origin URL to start crawling from',
          demandOption: true,
          type: 'string',
        })
        .option('filter', {
          describe: 'Filter to apply to the URLs. Only URLs containing this string will be crawled (example: "/blog/*")',
          type: 'string',
        })
        .option('timeout', {
          describe: 'HTTP Timeout in seconds',
          type: 'number',
          default: 10,
        })
        .group(['origin', 'filter', 'timeout'], 'Crawl Options:')
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for the found URLs',
          default: 'crawl-report.xlsx',
          type: 'string',
        })
        .option('text-file', {
          alias: 'textFile',
          describe: 'Path to text for the found URLs',
          default: 'urls.txt',
          type: 'string',
        });
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      logger.debug(`handler - crawl start - ${logger.level}`);

      /**
       * init
       */

      // extract origin from argv.
      const { origin } = argv;
      logger.debug(origin);

      // extract base url
      const u = new URL(origin);
      const baseUrl = u.origin;
      logger.debug(baseUrl);

      // init excel report
      const excelReport = new ExcelWriter({
        filename: argv.excelReport,
        writeEvery: 10,
        headers: ['URL', 'path', 'path level 1', 'path level 2', 'path level 3', 'filename', 'crawl status', 'error'],
        formatRowFn: (record) => {
          const ru = new URL(record.url);
          const levels = ru.pathname.split('/');
          const filename = levels[levels.length - 1];
          while (levels.length < 4) {
            levels.push('');
          }
          const r = [record.url, ru.pathname].concat(levels.slice(1, 4).map((l) => ((l === filename) ? ('') : (l || ' '))));
          return r.concat([filename, record.status, record.error || '']);
        },
      });

      // init urls file stream
      // create stream to save the list of discovered URLs
      const textFile = path.isAbsolute(argv.textFile)
        ? argv.textFile
        : path.join(process.cwd(), argv.textFile);
      if (!(await fs.existsSync(path.dirname(textFile)))) {
        fs.mkdirSync(path.dirname(textFile), { recursive: true });
      }
      const urlsFileStream = fs.createWriteStream(textFile);

      // url pattern check
      const urlPattern = argv.filter ? new URLPattern(argv.filter, baseUrl) : null;

      // initial urls
      const initialURLs = argv.origin ? [argv.origin] : [];

      // found urls
      const foundUrls = [{ url: argv.origin, status: 'todo' }];

      // init work queue
      const queue = new PQueue({ concurrency: argv.workers });

      // concatenate errors and only display them at the end
      queue.on('error', (error) => {
        logger.error(error);
      });

      if (origin.includes('robots.txt') || origin.endsWith('.xml')) {
        logger.info('collect urls from robots.txt and sitemaps');

        try {
          // init constants from CLI args
          // timeout
          const timeout = argv.timeout * 1000;

          // crawling constants
          const sitemaps = [];
          // array of errors discovered during crawling
          // will be displayed at the end
          const errors = [];
          // crawling options
          const crawlOptions = {
            urlPattern,
            timeout,
            logger,
          };

          // init first sitemaps list from origin URL
          if (origin.endsWith('robots.txt')) {
            const r = await AEMBulk.Web.parseRobotsTxt(origin, { timeout });
            sitemaps.push(...r.getSitemaps());
          } else if (origin.indexOf('sitemap') > -1) {
            sitemaps.push(origin);
          } else {
            throw new Error(`unsupported origin URL (${origin}) it should point to a robots.txt or a sitemap`);
          }

          // triggered each time a job is completed
          queue.on('completed', async (result) => {
            if (result?.urls) {
              // eslint-disable-next-line no-console
              const uNum = result.urls?.length || 0;
              const sNum = result.sitemaps?.length || 0;
              logger.info(`done parsing sitemap ${result.url}, found ${uNum} url(s) and ${sNum} sitemap(s)`);
              const filteredRes = urlPattern
                ? result.urls.filter((loc) => urlPattern.test(loc.url))
                : result.urls;
              const finalUrls = [];
              filteredRes.forEach((loc) => {
                if (!foundUrls.find((f) => loc.url === f.url)) {
                  finalUrls.push({
                    url: loc.url,
                    status: '',
                  });
                }
              });

              finalUrls.forEach(async (loc) => {
                foundUrls.push(loc);
                await excelReport.addRow(loc, false);
              });

              if (urlsFileStream) {
                urlsFileStream.write(finalUrls.map((fu) => fu.url).join('\n'));
                urlsFileStream.write('\n');
              }
            }
          });

          // crawl is done
          // when the queue is idle, display result + errors
          queue.on('idle', () => {
            logger.info('Crawling done!');
            if (errors.length > 0) {
              // eslint-disable-next-line no-console
              logger.error('errors:', errors.map((e) => e.message));
            }
          });

          await handleSitemaps(queue, sitemaps, AEMBulk, crawlOptions);

          await new Promise((resolve) => {
            queue.on('idle', () => {
              resolve();
            });
          });
        } catch (e) {
          logger.error(`${e.toString()}`);
          throw new Error(`crawler failed: ${e.message}`);
        } finally {
          // nothing
        }
      } else {
        logger.info('collect urls from classic browser crawling');

        // global browser and page objects
        let browser;

        try {
          [browser] = await AEMBulk.Puppeteer.initBrowser({
            useLocalChrome: true,
          });

          // triggered each time a job is completed
          queue.on('completed', async (result) => {
            const found = foundUrls.find((f) => result.url === f.url);
            if (found) {
              if (result.error) {
                found.status = 'error';
                found.error = result.error;
              } else {
                found.status = 'done';
                let newUrlsCtr = 0;
                result.links.forEach((link) => {
                  if (!foundUrls.find((f) => link === f.url)) {
                    foundUrls.push({
                      url: link,
                      status: 'todo',
                    });
                    addURLToCrawl(baseUrl, urlPattern, browser, queue, link, logger, AEMBulk);
                    newUrlsCtr += 1;
                  }
                });
                logger.info(`found ${newUrlsCtr} new url(s)`);
              }
              await excelReport.addRow(found, true);
              if (urlsFileStream) {
                urlsFileStream.write(`${found.url}\n`);
              }
            }
          });

          for (const url of initialURLs) {
            logger.debug(`crawl url ${url}`);
            addURLToCrawl(baseUrl, urlPattern, browser, queue, url, logger, AEMBulk);
          }

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
      }

      logger.info(`found ${foundUrls.length} urls`);

      foundUrls.forEach((fu) => logger.debug(JSON.stringify(fu)));

      await excelReport.write();

      if (urlsFileStream) {
        urlsFileStream.close((e) => {
          if (e) {
            logger.error(`closing file: ${e.stack}`);
          }
        });
      }

      logger.debug('handler - crawl done');
    }),
  };
}
