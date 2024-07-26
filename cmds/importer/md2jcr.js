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
import { md2jcr } from '../../vendors/helix-importer-md2jcr.js';

const loadComponents = async (componentsPath) => {
  const components = {};
  if (componentsPath) {
    try {
      components.componentModels = JSON.parse(fs.readFileSync(`${componentsPath}/component-models.json`, 'utf-8'));
      components.componentDefinition = JSON.parse(fs.readFileSync(`${componentsPath}/component-definition.json`, 'utf-8'));
      components.filters = JSON.parse(fs.readFileSync(`${componentsPath}/component-filters.json`, 'utf-8'));
    } catch (e) {
      throw new Error(`Failed to read a component json file: ${e}`);
    }
  }
  return components;
};

/**
 * main
 */

export default function md2jcrCLI() {
  return {
    command: 'md2jcr',
    describe: 'Convert Markdown to JCR XML',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: false, workers: false })
        .option('md-file', {
          alias: 'mdFile',
          describe: 'Path to the Markdown file to convert',
          type: 'string',
        })
        .option('components-path', {
          alias: 'componentsPath',
          describe: 'Path to components json files',
          type: 'string',
        })
        .option('output-folder', {
          alias: 'outputFolder',
          describe: 'target folder for jcr xml files',
          default: 'jcr',
          type: 'string',
        });
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger,
    }) => {
      try {
        logger.debug(`handler - md2jcr start for url ${argv.url}`);

        // read md file content
        const mdContent = fs.readFileSync(argv.mdFile, 'utf-8');

        // load components
        const components = await loadComponents(argv.componentsPath);

        // convert md to jcr
        const importTransformResult = await md2jcr(mdContent, components);

        const jcrPath = path.join(argv.outputFolder, `${path.dirname(argv.mdFile)}/${path.basename(argv.mdFile, '.md')}.xml`);
        if (!fs.existsSync(path.dirname(jcrPath))) {
          fs.mkdirSync(path.dirname(jcrPath), { recursive: true });
        }

        fs.writeFileSync(jcrPath, importTransformResult);

        logger.debug(`imported page saved to xml file ${jcrPath}`);
      } catch (e) {
        logger.error(`html2jcr error: ${e.message} ${e.stack}`);
      }
    }),
  };
}
