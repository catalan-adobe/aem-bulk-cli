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
import cors from 'cors';
import express from 'express';
import serveStatic from 'serve-static';
import fs from 'fs';
import path from 'path';
import { CommonCommandHandler, withCustomCLIParameters } from '../../src/cli.js';
import chromePaths from 'chrome-paths';

const LOCAL_HTTP_HOST = 'http://localhost:8888';
const HELIX_IMPORTER_HTML2JCR_SCRIPT = '../../vendors/helix-importer-html2jcr.js';

async function startHTTPServer(htmlPath = null) {
  const app = express();
  app.use(cors());
  app.use(serveStatic(htmlPath));

  return app.listen(8888, { index: true });
}

/**
 * main
 */

export default function html2jcr() {
  return {
    command: 'html2jcr',
    describe: 'Convert HTML to JCR XML',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: false, workers: false })
        .option('url', {
          describe: 'URL to convert',
          demandOption: true,
          type: 'string',
        })
        .option('html-folder', {
          alias: 'htmlFolder',
          describe: 'Folder containing HTML files',
          default: 'html',
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
      argv, logger, AEMBulk,
    }) => {
      // start http server serving the html folder
      const httpServer = await startHTTPServer(argv.htmlFolder);
      let browser;
      let page;

      try {
        const url = new URL(argv.url);
        const localURL = `${LOCAL_HTTP_HOST}${url.pathname}`;

        logger.debug(`handler - html2jcr start for url ${argv.url}`);

        [browser, page] = await AEMBulk.Puppeteer.initBrowser({
          headless: false,
          defaultViewport: null,
          executablePath: chromePaths?.chrome || null,
          args: [
            '--disable-web-security',
            '--remote-allow-origins=*',
            '--no-sandbox',
            '--no-default-browser-check',
          ],
        });

        await page.goto(localURL, { waitUntil: 'networkidle0' });

        // inject helix-import library script
        // will provide WebImporter.html2docx function in browser context
        const js = fs.readFileSync(path.join(import.meta.dirname, HELIX_IMPORTER_HTML2JCR_SCRIPT), 'utf-8');
        await page.evaluate(js);

        // const importScriptURL = customImportScriptPath
        //   ? `http://localhost:8888/${path.basename(customImportScriptPath)}`
        //   : DEFAULT_IMPORT_SCRIPT_URL;

        const importTransformResult = await page.evaluate(async (originalURL) => {
          /* eslint-disable */
          // code executed in the browser context

          // execute default import script
          const out = await WebImporter.html2jcr(
            location.href,
            document,
            null,
            { originalURL, toDocx: false, toMd: false, toJcr: true }
          );

          console.log('out', out);

          // return the md content
          return out;
          /* eslint-enable */
        }, url);

        const jcrPath = path.join(argv.outputFolder, `${importTransformResult.path}.xml`);
        if (!fs.existsSync(path.dirname(jcrPath))) {
          fs.mkdirSync(path.dirname(jcrPath), { recursive: true });
        }

        fs.writeFileSync(jcrPath, importTransformResult.jcr);

        logger.debug(`imported page saved to xml file ${jcrPath}.xml`);

        // console.log(importTransformResult);
        // await AEMBulk.Time.sleep(1000000);
      } catch (e) {
        logger.error(`html2jcr error: ${e.message} ${e.stack}`);
      } finally {
        if (browser) {
          await browser.close();
        }

        // stop http server
        await httpServer.close();
      }
    }),
  };
}
