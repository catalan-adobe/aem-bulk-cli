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

/**
 * Fetches the helix-importer.js library from the helix-importer-ui repository.
 */

import fs from 'fs';

const files = [
  {
    name: 'helix-importer.js',
    url: 'https://raw.githubusercontent.com/adobe/helix-importer-ui/main/js/dist/helix-importer.js',
  },
  // this dependency does not work for now, added file to the project instead
  // {
  //   name: 'helix-importer-html2jcr.js',
  //   url: 'https://raw.githubusercontent.com/mhaack/helix-importer-ui/html2jcr/js/dist/helix-importer.js',
  // },
];

try {
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < files.length; i += 1) {
    const resp = await fetch(files[i].url);

    if (!resp.ok) {
      throw new Error(`Failed to fetch ${files[i].name}: ${resp.status} ${resp.statusText}`);
    }

    const text = await resp.text();
    fs.writeFileSync(`vendors/${files[i].name}`, text);
  }
} catch (e) {
  throw new Error('Failed to fetch helix-importer.js', e);
}
