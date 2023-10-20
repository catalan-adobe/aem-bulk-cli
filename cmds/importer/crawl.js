#!/usr/bin/env node

// imports
const fs = require('fs');
const path = require('path');
const { terminal } = require('terminal-kit');
const ExcelJS = require('exceljs');

/*
 * CLI Command parameters
 */

function yargsBuilder(yargs) {
  return yargs
    .option('origin', {
      alias: 'o',
      describe: 'Origin URL to start crawling from',
      demandOption: true,
      type: 'string',
    })
    .option('simple-filter', {
      alias: 's',
      describe: 'Simple filter to apply to the URLs. Only URLs containing this string will be crawled',
      type: 'string',
    })
    .option('output-file', {
      alias: 'f',
      describe: 'File where to save the list of discovered URLs',
      default: 'urls.txt',
      type: 'string',
    })
    .option('excel-report', {
      alias: 'e',
      describe: 'Path to Excel report file for the found URLs',
      default: 'urls-report.xlsx',
      type: 'string',
    })
    .option('workers', {
      alias: 'w',
      describe: 'Number of workers to use (max. 8)',
      type: 'number',
      default: 1,
      coerce: (value) => {
        if (value > 5) {
          terminal.yellow('Warning: Maximum number of workers is 5. Using 5 workers instead.\n');
          return 5;
        }
        return value;
      },
    })
    .option('timeout', {
      alias: 't',
      describe: 'HTTP Timeout in seconds',
      type: 'number',
      default: 10,
    });
}

/*
 * Helper function to handle sitemaps
 */

async function handleSitemaps(queue, sitemaps, options = {}) {
  const fBulk = await import('franklin-bulk-shared');

  const ss = options.simpleFilter
    ? sitemaps.filter((sitemap) => sitemap.indexOf(options.simpleFilter) !== -1)
    : sitemaps;

  // eslint-disable-next-line no-console
  ss.forEach((s) => console.log(`new sitemap to crawl ${s}`));

  ss.forEach(async (sitemap) => {
    if (sitemap.indexOf('.rss') === -1) {
      try {
        await queue.add(async () => {
          try {
            // eslint-disable-next-line no-console
            console.log('crawling sitemap', sitemap);
            const s = await fBulk.Web.parseSitemapFromUrl(sitemap, { timeout: options.timeout });
            if (s.sitemaps && s.sitemaps.length > 0) {
              await handleSitemaps(queue, s.sitemaps.map((o) => o.url), options);
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

/*
 * Main
 */

exports.desc = 'Collect URLs from robots.txt and sitemaps';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  let urlsFileStream;
  const urls = [];

  try {
    const fBulk = await import('franklin-bulk-shared');
    /* eslint import/no-unresolved: "off" */
    const PQueue = (await import('p-queue')).default;

    // init constants from CLI args
    // crawl workers
    const { workers } = argv;
    // validate origin URL
    const originUrl = new URL(argv.origin).href;
    // validate simple filter
    const simpleFilter = argv.simpleFilter ? argv.simpleFilter : null;
    // timeout
    const timeout = argv.timeout * 1000;

    // crawling constants
    const sitemaps = [];
    // array of errors discovered during crawling
    // will be displayed at the end
    const errors = [];
    // crawling options
    const crawlOptions = {
      simpleFilter,
      timeout,
    };

    // create stream to save the list of discovered URLs
    const outputFile = path.isAbsolute(argv.outputFile)
      ? argv.outputFile
      : path.join(process.cwd(), argv.outputFile);
    if (!(await fs.existsSync(path.dirname(outputFile)))) {
      fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    }
    urlsFileStream = fs.createWriteStream(outputFile);

    // init first sitemaps list from origin URL
    if (originUrl.endsWith('robots.txt')) {
      const r = await fBulk.Web.parseRobotsTxt(originUrl, { timeout });
      sitemaps.push(...r.getSitemaps());
    } else if (originUrl.indexOf('sitemap') > -1) {
      sitemaps.push(originUrl);
    } else {
      throw new Error(`unsupported origin URL (${originUrl}) it should point to a robots.txt or a sitemap`);
    }

    // init work queue
    const queue = new PQueue({
      concurrency: workers,
      autoStart: false,
    });

    // triggered each time a job is completed
    queue.on('completed', async (result) => {
      if (result?.urls) {
        // eslint-disable-next-line no-console
        console.log(`done parsing sitemap ${result.url}, found ${result.urls?.length || 0} url(s) and ${result.sitemaps?.length || 0} sitemap(s)`);
        urls.push(...result.urls);
        urlsFileStream.write(result.urls.map((u) => u.url).join('\n'));
        urlsFileStream.write('\n');
      }
    });

    // concatenate errors and only display them at the end
    queue.on('error', (error) => {
      errors.push(error);
    });

    // crawl is done
    // when the queue is idle, display result + errors
    queue.on('idle', () => {
      terminal.green('Crawling done!\n');
      if (errors.length > 0) {
        // eslint-disable-next-line no-console
        console.log('errors:', errors.map((e) => e.message));
      }
    });

    await handleSitemaps(queue, sitemaps, crawlOptions);

    // start crawling
    queue.start();

    await new Promise((resolve) => {
      queue.on('idle', () => {
        resolve();
      });
    });

    if (argv.excelReport) {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('report');
    
      const headers = ['URL', 'path', 'path level 1', 'path level 2', 'path level 3', 'filename'];
    
      // create Excel auto Filters for the first row / header
      worksheet.autoFilter = {
        from: 'A1',
        to: `${String.fromCharCode(65 + headers.length - 1)}1`, // 65 = 'A'...
      };
    
      worksheet.addRows([
        headers,
      ].concat(urls.map((row) => {
        const u = new URL(row.url);
        const levels = u.pathname.split('/');
        const filename = levels[levels.length - 1];
        while (levels.length < 4) {
          levels.push('');
        }
        const r = [row.url, u.pathname].concat(levels.slice(1, 4).map((l, idx) => {
          return (l === filename) ? ('') : (l || ' ')
        }));
        r.push(filename);
        return r;
      })));
      await workbook.xlsx.writeFile(argv.excelReport);
    }
  } catch (e) {
    terminal.red(`\n${e.message}\n`);
    throw new Error(`crawler failed: ${e.message}`);
  } finally {
    urlsFileStream.close((e) => {
      if (e) {
        terminal.red('error closing file', e);
      }
    });
  }
};
