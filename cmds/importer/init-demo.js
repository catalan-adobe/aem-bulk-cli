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

/**
 * main
 */

export default function initDemoCmd() {
  return {
    command: 'init-demo',
    describe: 'Initializes a demo environment',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: false, workers: false })
        .option('url', {
          describe: 'URL to extract minimal CSS',
          demandOption: true,
          type: 'string',
        })
        .option('limit-urls', {
          alias: 'limitUrls',
          describe: 'Limit number of URLs to import',
          default: 1,
          type: 'number',
        })
        .config('configuration', (configPath) => JSON.parse(fs.readFileSync(configPath, 'utf-8')))
        .group(['url', 'limit-urls', 'configuration'], 'Demo Options:');
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      // AEMBulk is franklin-bulk-shared import AEMBulk.Time... AEMBulk.Puppeteer... AEMBulk.Web...

      try {
        const url = new URL(argv.url); // validate URL

        logger.debug(`handler - init demo start for url ${url}`);

        // @pnp/cli-microsoft365 added to package.json
        // so m365 binary available at ./node_modules/.bin/m365
        // ex. const stdout = execSync('./node_modules/.bin/m365 login');

        /**
         * demo script
         *
        auth_sharepoint
        auth_github
        open_powerscore "$arg1"
        create_git_repo "$arg2"
        create_sharepoint_folder "$arg2"
        run_crawler "$arg1" "$arg2"
        install_importer
        checkout_git_repo "$arg2"
        patch_fstab "$arg2"
        patch_readme "$arg2"
        patch_template "$arg2"
        add_blocks_from_collection "$arg2"
        run_importer
        add_files
        upload_dir_to_sharepoint "$arg2" tools/aem-bulk-cli/docx
        preview_and_publish "$arg2"
        sleep 5
        open_github "$arg2"
        open_sharepoint "$arg2"
        open_page "$arg2"
         *
         */
      } catch (e) {
        logger.error(`init demo css error: ${e.message} ${e.stack}`);
      } finally {
        // ...
      }
    }),
  };
}
