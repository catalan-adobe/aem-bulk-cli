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
import { CommonCommandHandler, withCustomCLIParameters } from '../../src/cli.js';
import { getLogger } from '../../src/logger.js';

/**
 * main
 */

export default function minimalCSSCmd() {
  return {
    command: 'minimal-css',
    describe: 'Extract minimal CSS for given url',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: false, workers: false })
        .option('url', {
          describe: 'URL to extract minimal CSS',
          demandOption: true,
          type: 'string',
        })
        .option('css-file', {
          alias: 'cssFile',
          describe: 'CSS file to save minimal CSS',
          default: 'minimal-styles.css',
          type: 'string',
        });
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      let browser;
      let page;

      try {
        const url = new URL(argv.url);
        logger.debug(`handler - minimal css start for url ${argv.url}`);

        [browser, page] = await AEMBulk.Puppeteer.initBrowser();

        await page.goto(url.href, { waitUntil: 'networkidle2' });

        const result = await AEMBulk.Puppeteer.CSS.getMinimalCSSForCurrentPage(page, { logger: getLogger('frk-bulk-shared/css/extractMinimalCSS') });

        if (result.string) {
          fs.writeFileSync(argv.cssFile, result.string);
          logger.info(`Minimal CSS saved to ${argv.cssFile}`);
        }
      } catch (e) {
        logger.error(`minimal css error: ${e.message} ${e.stack}`);
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }),
  };
}
