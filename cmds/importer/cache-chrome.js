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
import CacheDefault from './cache.js';

export default function CommandHandler() {
  return CacheDefault({
    name: 'cache-chrome',
    description: 'Generate website cache in chrome',
    commandParameters(yargs) {
      return yargs
        .option('user-data-dir', {
          alias: 'userDataDir',
          type: 'string',
          default: 'chrome-data',
        })
        .demandOption(['userDataDir'])
        .group(['userDataDir'], 'Browser Options:');
    },
    urlsBuilder(urls) {
      return urls.map((url) => ({
        original: url,
        transformed: url,
      }));
    },
  });
}
