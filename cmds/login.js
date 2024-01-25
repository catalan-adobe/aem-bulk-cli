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
import os from 'os';
import { CommonCommandHandler } from '../src/cli.js';

const GLOBAL_TIMEOUT = 120000;
/**
 * main
 */

export default function loginCmd() {
  return {
    command: 'login',
    describe: 'Login to an AEM Edge Delivery project and save credentials locally (~/aem-ed-credentials.json)',
    builder: (yargs) => {
      yargs
        .option('project-path', {
          alias: 'p',
          describe: 'Path of the Frankiln website (/{owner}/{repo}/{ref})',
          type: 'string',
        })
        .demandOption(['p'])
        .option('use-local-chrome', {
          alias: 'useLocalChrome',
          describe: 'Use local Chrome for browser interaction',
          type: 'boolean',
          default: false,
        })
        .group(['project-path', 'use-local-chrome'], 'Login Options:')
        .help();
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      const frkPath = argv.projectPath;

      let browser = null;

      try {
        [browser] = await AEMBulk.Puppeteer.initBrowser({
          headless: false,
          adBlocker: false,
          gdprBlocker: false,
        });

        // Create a page
        const page = await browser.newPage();

        let authTokenFound = false;

        // // global timeout
        // const globalTimeout = setTimeout(() => {
        //   reject(new Error('global timeout reached (120s.)'));
        // }, 120000);

        page.on('load', async () => {
          const cookies = await page.cookies();
          const cookie = cookies.find((c) => c.name === 'auth_token');

          if (cookie) {
            await browser.close();

            const credentialsFile = path.join(os.homedir(), '.aem-ed-credentials.json');

            logger.info(`Saving credentials to ${credentialsFile}`);
            await fs.writeFileSync(credentialsFile, JSON.stringify({
              path: frkPath,
              auth_token: decodeURIComponent(cookie.value),
            }, null, 2));
            // clearTimeout(globalTimeout);
            authTokenFound = true;
          }
        });

        await page.goto(`https://admin.hlx.page/login${frkPath}`/* , { waitUntil: 'networkidle2' } */);

        await new Promise((resolve, reject) => {
          let authTokenPollCheckInterval;
          const interval = 500;
          let timeoutCounter = GLOBAL_TIMEOUT;

          const intFn = () => {
            timeoutCounter -= interval;

            // global timeout
            if (timeoutCounter <= 0) {
              clearInterval(authTokenPollCheckInterval);
              reject(new Error('global timeout reached (120s.)'));
            }
            // auth token found, move on
            if (authTokenFound === true) {
              clearInterval(authTokenPollCheckInterval);
              resolve();
            }
          };

          authTokenPollCheckInterval = setInterval(intFn, interval);
        });
      } catch (e) {
        logger.error(e);
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }),
  };
}
