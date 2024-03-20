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
import { isMatch } from 'matcher';
import { Url } from 'franklin-bulk-shared';
import { CommonCommandHandler, withCustomCLIParameters } from '../../src/cli.js';
import { ExcelWriter } from '../../src/excel.js';

function qualifyURLsForCrawl(urls, {
  baseURL,
  originURL,
  URLPatterns,
  sameDomain = true,
  keepHash = false,
}) {
  return urls.concat(urls.reduce(
    // for urls with query or hash, concatenate the origin + pathname url to the list
    // of urls to qualify and crawl
    (acc, val) => {
      try {
        const u = new URL(val);
        if (u.search !== '' || u.hash !== '') {
          acc.push(`${u.origin}${u.pathname}`);
        }
      } catch (e) {
        // nothing
      }
      return acc;
    },
    [],
  )).map((url) => {
    const result = url.url ? url : { url };
    result.originalURL = result.url;
    result.sourceURL = originURL;
    result.status = 'todo';
    const u = Url.isValidHTTP(result.url);
    let ext = '';

    if (!keepHash && u) {
      result.url = `${u.origin}${u.pathname}${u.search}`;
      ext = path.parse(`${u.origin}${u.pathname}` || '').ext;
    }

    if (!u) {
      result.status = 'excluded';
      result.message = 'invalid url';
    } else if (sameDomain && !result.url.startsWith(baseURL)) {
      result.status = 'excluded';
      result.message = `not same origin as base URL ${baseURL}`;
    } else if ((ext !== '' && !ext.includes('htm'))) {
      result.status = 'excluded';
      result.message = 'not an html page';
    } else {
      const excludedFromURLPatterns = URLPatterns.find(
        (pat) => !(isMatch(`${u.pathname}${u.search}`, pat.pattern) === pat.expect),
      );
      if (excludedFromURLPatterns) {
        const message = excludedFromURLPatterns.expect
          ? `does not match any including filter ${URLPatterns.filter((f) => f.expect).map((f) => f.pattern).join(', ')}`
          : `matches excluding filter ${excludedFromURLPatterns.pattern}`;
        result.status = 'excluded';
        result.message = message;
      }
    }
    return result;
  });
}

/**
 * functions
 */

async function handleSitemaps(queue, sitemaps, AEMBulk, options = {}) {
  sitemaps.forEach((s) => options.logger.info(`new sitemap to crawl ${s}`));

  sitemaps.forEach(async (sitemap) => {
    if (sitemap.indexOf('.rss') === -1) {
      try {
        await queue.add(async () => {
          try {
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

async function addURLToCrawl(url, queue, AEMBulk, logger, { // options
  baseUrl,
  pacingDelay,
  URLPatterns,
  retries = 2,
}) {
  const uuid = crypto.randomUUID();
  try {
    await queue.add(async () => {
      const userDataDir = path.join(process.cwd(), `.chrome-user-data-${uuid}`);
      let browser;
      let page;

      const crawlResult = {
        url,
        status: 'done',
        message: '',
        links: [],
      };

      // pacing delay
      await AEMBulk.Time.sleep(pacingDelay);

      try {
        if (!Url.isValidHTTP(url)) {
          // invalid url, do not proceed!
          crawlResult.status = 'invalid';
          crawlResult.message = 'invalid url';
        } else {
          [browser, page] = await AEMBulk.Puppeteer.initBrowser({
            port: 0,
            headless: true,
            useLocalChrome: true,
            userDataDir,
            extraArgs: ['--disable-features=site-per-process,IsolateOrigins,sitePerProcess'],
          });

          page = await browser.newPage();

          const resp = await page.goto(url, { waitUntil: 'networkidle2' });

          // compute status
          if (resp.status() >= 400) {
            // error -> stop
            crawlResult.status = 'error';
            crawlResult.message = `status code ${resp.status()}`;
          } else if (resp.request()?.redirectChain()?.length > 0) {
            // redirect -> stop
            crawlResult.status = 'redirect';
            crawlResult.message = `redirected to ${resp.url()}`;
          } else {
            // ok -> collect links
            if (page.isJavaScriptEnabled()) {
              await AEMBulk.Puppeteer.smartScroll(page, { postReset: false });
            }

            // collect links
            const hrefs = await page.$$eval('a', (l) => l.map((a) => a.href).filter((href) => href.length > 0));

            const qURLs = qualifyURLsForCrawl(hrefs, {
              baseURL: baseUrl,
              originURL: url,
              URLPatterns,
            });

            crawlResult.links = qURLs;
          }
        }
      } catch (e) {
        logger.error(`${url} ${e.name}: ${e.message} (${e.stack})`);
        if ((retries - 1) >= 0) {
          logger.warn(`retrying ${url} (${retries} left)`);
          crawlResult.status = 'retry';
          crawlResult.retries = retries - 1;
        } else {
          logger.warn(`no more retries for ${url}, mark as error`);
          crawlResult.status = 'error';
          crawlResult.message = e.message;
        }
      } finally {
        if (browser) {
          await browser.close();
        }

        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
      return crawlResult;
    });
  } catch (e) {
    logger.error('addURLToCrawl error:');
    logger.error(e);
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
        .option('inclusion-file', {
          alias: 'inclusionFile',
          describe: 'Text file containing a list of URLs to include in the crawl',
          type: 'string',
        })
        .option('exclusion-file', {
          alias: 'exclusionFile',
          describe: 'Text file containing a list of URLs to exclude from the crawl',
          type: 'string',
        })
        .option('inclusion-filter', {
          alias: 'inclusionFilter',
          describe: 'Filter to apply to the URLs. Only URLs containing this string will be crawled (example: "/blog/*")',
          type: 'array',
        })
        .option('exclusion-filter', {
          alias: 'exclusionFilter',
          describe: 'Filter to apply to the URLs. Only URLs *not* containing this string will be crawled (example: "/blog/*" to exclude blog URLs)',
          type: 'array',
        })
        .option('pacing-delay', {
          alias: 'pacingDelay',
          describe: 'Delay in milliseconds between each request',
          type: 'number',
          default: 250,
        })
        .option('timeout', {
          describe: 'HTTP Timeout in seconds',
          type: 'number',
          default: 10,
        })
        .group(['origin', 'inclusionFile', 'exclusionFile', 'inclusionFilter', 'exclusionFilter', 'pacingDelay', 'timeout'], 'Crawl Options:')
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
      const { origin, pacingDelay } = argv;
      logger.debug(origin);

      // extract base url
      const oURL = new URL(origin);
      const baseUrl = oURL.origin;
      logger.debug(baseUrl);

      // init excel report
      const excelReport = new ExcelWriter({
        filename: argv.excelReport,
        sheetName: 'crawl-report',
        writeEvery: 10,
        headers: ['url', 'source url', 'path', 'path level 1', 'path level 2', 'path level 3', 'filename', 'search', 'crawl status', 'message'],
        formatRowFn: (record) => {
          let pathname = '';
          let levels = [];
          let filename = '';
          let search = '';
          const sourceURL = record.sourceURL || '';
          const ru = Url.isValidHTTP(record.url);

          if (ru) {
            pathname = ru.pathname;
            levels = pathname.split('/');
            filename = levels[levels.length - 1];
            search = ru.search;
          }

          while (levels.length < 4) {
            levels.push('');
          }

          const r = [record.url, sourceURL, pathname].concat(levels.slice(1, 4).map((l) => ((l === filename) ? ('') : (l || ' '))));
          return r.concat([filename, search, record.status, record.message || '']);
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
      const URLPatterns = argv.inclusionFilter
        ? argv.inclusionFilter.map((f) => ({
          pattern: f,
          expect: true,
        })) : [];
      if (argv.exclusionFilter) {
        URLPatterns.push(...argv.exclusionFilter.map((f) => ({
          pattern: f,
          expect: false,
        })));
      }

      // found urls
      const foundUrls = [{ url: argv.origin, status: 'todo' }];

      // inclusion list
      if (argv.inclusionFile) {
        const inclusionFile = path.isAbsolute(argv.inclusionFile)
          ? argv.inclusionFile
          : path.join(process.cwd(), argv.inclusionFile);
        if (await fs.existsSync(inclusionFile)) {
          const inclusionList = fs.readFileSync(inclusionFile, 'utf-8').split('\n').filter(Boolean);
          foundUrls.push(...inclusionList.map((url) => ({ url, status: 'todo' })));
        } else {
          logger.warn(`inclusion file not found: ${inclusionFile}`);
        }
      }

      // exclusion list
      if (argv.exclusionFile) {
        const exclusionFile = path.isAbsolute(argv.exclusionFile)
          ? argv.exclusionFile
          : path.join(process.cwd(), argv.exclusionFile);
        if (await fs.existsSync(exclusionFile)) {
          const exclusionList = fs.readFileSync(exclusionFile, 'utf-8').split('\n').filter(Boolean);
          exclusionList.forEach((url) => {
            const found = foundUrls.find((f) => f.url === url);
            if (found) {
              found.status = 'excluded';
            } else {
              foundUrls.push({ url, status: 'excluded' });
            }
          });
        } else {
          logger.warn(`exclusion file not found: ${exclusionFile}`);
        }
      }

      // initial urls
      const initialURLs = argv.origin ? [argv.origin] : [];

      foundUrls.filter((u) => u.status === 'todo').forEach((f) => {
        if (!initialURLs.includes(f.url)) {
          initialURLs.push(f.url);
        }
      });

      // init work queue
      const queue = new PQueue({ concurrency: argv.workers });

      // concatenate errors and only display them at the end
      queue.on('error', (error) => {
        logger.error('error in queue:');
        logger.error(error);
      });

      try {
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
                const uNum = result.urls?.length || 0;
                const sNum = result.sitemaps?.length || 0;
                logger.info(`done parsing sitemap ${result.url}, found ${uNum} url(s) and ${sNum} sitemap(s)`);

                const filteredRes = qualifyURLsForCrawl(result.urls, {
                  baseURL: baseUrl,
                  originURL: result.url,
                  URLPatterns,
                });

                const finalUrls = [];
                filteredRes.forEach((loc) => {
                  if (!foundUrls.find((f) => loc.url === f.url)) {
                    finalUrls.push(loc);
                  }
                });

                finalUrls.forEach(async (loc) => {
                  foundUrls.push(loc);
                  await excelReport.addRow(loc);
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
          }
        } else {
          logger.info('collect urls from classic browser crawling');

          try {
            // triggered each time a job is completed
            queue.on('completed', async (result) => {
              const found = foundUrls.find((f) => result.url === f.url);
              if (found) {
                found.status = result.status;
                if (result.message && result.message.length > 0) {
                  found.message = result.message;
                }
                if (result.status === 'retry') {
                  found.status = 'retry';
                  addURLToCrawl(result.url, queue, AEMBulk, logger, {
                    baseUrl,
                    pacingDelay,
                    URLPatterns,
                    retries: result.retries,
                  });
                } else if (result.status !== 'error') {
                  let newUrlsCtr = 0;
                  result.links.forEach(async (link) => {
                    const fff = foundUrls.find((f) => link.url === f.url);
                    if (!fff) {
                      foundUrls.push(link);
                      if (link.status === 'todo') {
                        addURLToCrawl(link.url, queue, AEMBulk, logger, {
                          baseUrl,
                          pacingDelay,
                          URLPatterns,
                          retries: 2,
                        });
                        newUrlsCtr += 1;
                      } else if (link.status === 'excluded') {
                        await excelReport.addRow(link);
                      }
                    }
                  });
                  logger.info(`found ${newUrlsCtr.toString().padStart(3)} new url(s) (in ${result.url})`);
                }

                fs.writeFileSync('foundUrls.json', JSON.stringify(foundUrls, null, 2));

                if (result.status !== 'retry') {
                  await excelReport.addRow(found);
                }

                if (urlsFileStream) {
                  urlsFileStream.write(`${found.url}\n`);
                }
              } else {
                logger.error(`result not found for ${result.url}`);
              }
            });

            for (const url of initialURLs) {
              logger.debug(`crawl url ${url}`);
              addURLToCrawl(url, queue, AEMBulk, logger, {
                baseUrl,
                pacingDelay,
                URLPatterns,
                retries: 2,
              });
            }

            await new Promise((resolve) => {
              queue.on('idle', () => {
                logger.debug('handler - queue idle');
                resolve();
              });
            });
          } catch (e) {
            logger.error('classic crawl error:');
            logger.error(e);
          }
        }
      } catch (e) {
        logger.error('final crawl error:');
        logger.error(e);
      } finally {
        logger.info(`found ${foundUrls.length} urls`);

        await excelReport.write();

        if (urlsFileStream) {
          urlsFileStream.close((e) => {
            if (e) {
              logger.error(`closing file: ${e.stack}`);
            }
          });
        }

        logger.debug('handler - crawl done');
      }
    }),
  };
}
