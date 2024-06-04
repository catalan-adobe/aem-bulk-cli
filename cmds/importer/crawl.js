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
        .option('http-header', {
          alias: 'httpHeader',
          describe: 'HTTP header to send with the robots.txt/sitemaps requests (example: "User-Agent: Mozilla/5.0")',
          type: 'array',
        })
        .option('limit', {
          describe: 'Limit max number of URLs to collect',
          type: 'number',
        })
        .group(['origin', 'limit', 'inclusionFilter', 'exclusionFilter', 'timeout', 'httpHeader'], 'Crawl Options:')
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for the found URLs',
          default: 'crawl-report.xlsx',
          type: 'string',
        })
        .option('text-file', {
          alias: 'textFile',
          describe: 'Path to text for the collected and valid URLs',
          default: 'valid-urls.txt',
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
        headers: ['url', 'source url', 'status', 'path level 1', 'path level 2', 'path level 3', 'filename', 'search', 'message'],
        formatRowFn: (record) => Object.keys(record).map((k) => record[k] || ''),
      });

      // init urls file stream
      // create stream to save the list of discovered URLs
      const textFile = path.isAbsolute(argv.textFile)
        ? argv.textFile
        : path.join(process.cwd(), argv.textFile);
      if (!(await fs.existsSync(path.dirname(textFile)))) {
        fs.mkdirSync(path.dirname(textFile), { recursive: true });
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

      // parse headers from argv
      let headers = null;
      if (argv.httpHeaders) {
        headers = {};
        argv.httpHeaders.forEach((h) => {
          const [key, value] = h.split(':');
          headers[key] = value;
        });
      }

      const result = await AEMBulk.Web.crawl(
        origin,
        {
          limit: argv.limit || -1,
          timeout: argv.timeout * 1000,
          logger: getLogger('frk-bulk-shared/web/crawl'),
          inclusionPatterns: argv.inclusionFilter || [],
          exclusionPatterns: argv.exclusionFilter || [],
          sameDomain: false,
          httpHeaders: headers,
          keepHash: false,
          urlStreamFn: async (newUrls) => {
            if (newUrls.length > 0) {
              await excelReport.addRows(newUrls);
            }
          },
        },
      );

      // write/close excel report
      await excelReport.close();

      fs.writeFileSync('result.json', JSON.stringify(result, null, 2));
      fs.writeFileSync(textFile, result.urls.filter((u) => u.status === 'valid').map((u) => u.url).join('\n'));

      logger.info(`Crawl completed. Found ${result.urls.length} URLs. Valid URLs saved to ${textFile}`);
    }),
  };
}
