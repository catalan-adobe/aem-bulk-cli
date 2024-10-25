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
import { CommonCommandHandler, withCustomCLIParameters } from '../../src/cli.js';
import { ExcelWriter } from '../../src/excel.js';
import { getLogger } from '../../src/logger.js';

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
        .option('strategy', {
          describe: 'Crawl strategy to use',
          choices: ['sitemaps', 'http'],
          default: 'sitemaps',
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
        .option('timeout', {
          describe: 'HTTP Timeout in seconds',
          type: 'number',
          default: 10,
        })
        .option('headers', {
          describe: 'JSON file containing custom headers to include in the request',
          type: 'string',
        })
        .option('limit', {
          describe: 'Limit max number of URLs to collect',
          type: 'number',
        })
        .option('text-file-prefix', {
          alias: 'textFilePrefix',
          describe: 'Prefix name for all text generated text files (urls.all.txt, urls.valid.txt)',
          default: 'urls',
          type: 'string',
        })
        .option('json-file', {
          alias: 'jsonFile',
          describe: 'Path to json result file',
          default: 'crawl.json',
          type: 'string',
        })
        .group(['origin', 'strategy', 'limit', 'inclusionFilter', 'exclusionFilter', 'timeout', 'headers', 'textFilePrefix', 'jsonFile'], 'Crawl Options:')
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for the found URLs',
          default: 'crawl-report.xlsx',
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
      const oURL = new URL(origin);
      const baseUrl = oURL.origin;
      logger.debug(baseUrl);

      // init excel report
      const excelReport = new ExcelWriter({
        filename: argv.excelReport,
        sheetName: 'crawl-report',
        writeEvery: 1,
        headers: ['url', 'source url', 'status', 'path level 1', 'path level 2', 'path level 3', 'filename', 'search', 'language', 'message'],
        formatRowFn: (record) => Object.keys(record).map((k) => record[k] || ''),
      });

      // init urls file stream
      // create stream to save the list of discovered URLs
      const textFilePrefix = path.isAbsolute(argv.textFilePrefix)
        ? argv.textFilePrefix
        : path.join(process.cwd(), argv.textFilePrefix);
      if (!(await fs.existsSync(path.dirname(textFilePrefix)))) {
        fs.mkdirSync(path.dirname(textFilePrefix), { recursive: true });
      }
      if (await fs.existsSync(`${textFilePrefix}.all.txt`)) {
        fs.unlinkSync(`${textFilePrefix}.all.txt`);
      }
      if (await fs.existsSync(`${textFilePrefix}.valid.txt`)) {
        fs.unlinkSync(`${textFilePrefix}.valid.txt`);
      }

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

      // initial urls
      const initialURLs = argv.origin ? [argv.origin] : [];

      foundUrls.filter((u) => u.status === 'todo').forEach((f) => {
        if (!initialURLs.includes(f.url)) {
          initialURLs.push(f.url);
        }
      });

      // read custom headers
      let headers = {};
      if (argv.headers) {
        try {
          headers = JSON.parse(fs.readFileSync(argv.headers, 'utf-8'));
        } catch (e) {
          logger.warn(`Error reading headers file (${argv.headers}): ${e.message}`);
        }
      }

      const result = await AEMBulk.Web.crawl(
        origin,
        {
          strategy: argv.strategy,
          workers: argv.workers,
          limit: argv.limit || -1,
          timeout: argv.timeout * 1000,
          logger: getLogger('frk-bulk-shared/web/crawl'),
          inclusionPatterns: argv.inclusionFilter || [],
          exclusionPatterns: argv.exclusionFilter || [],
          httpHeaders: headers,
          keepHash: false,
          urlStreamFn: async (newCrawl) => {
            if (newCrawl.length > 0) {
              await excelReport.addRows(newCrawl);

              // stream urls to text files
              fs.appendFileSync(`${textFilePrefix}.all.txt`, newCrawl.map((u) => `${u.url}\n`).join(''), 'utf8');
              const validURLs = newCrawl.filter((u) => u.status === 'valid');
              if (validURLs.length > 0) {
                fs.appendFileSync(`${textFilePrefix}.valid.txt`, validURLs.map((u) => `${u.url}\n`).join(''), 'utf8');
              }
            }
          },
        },
      );

      // write/close excel report
      await excelReport.close();

      fs.writeFileSync(argv.jsonFile, JSON.stringify(result, null, 2));

      // final log
      logger.info('Crawl completed:');
      logger.info(`* ${result.urls.total} URL(s) discovered (saved to ${textFilePrefix}.all.txt)`);
      logger.info(`* ${result.urls.valid} URL(s) valid (saved to ${textFilePrefix}.valid.txt)`);
    }),
  };
}
