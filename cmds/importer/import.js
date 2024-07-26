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
import { md2docx } from '@adobe/helix-md2docx';
import { RequestInterceptionManager } from 'puppeteer-intercept-and-modify-requests';
import * as fastq from 'fastq';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import serveStatic from 'serve-static';
import sharp from 'sharp';

import { ExcelWriter } from '../../src/excel.js';
import { CommonCommandHandler, readLines, withCustomCLIParameters } from '../../src/cli.js';
import { getLogger } from '../../src/logger.js';
import { md2jcr } from '../../vendors/helix-importer-md2jcr.js';

const loadComponents = async (componentsPath) => {
  console.log('componentsPath', componentsPath);
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

const DEFAULT_IMPORT_SCRIPT_URL = 'http://localhost:8888/defaults/import-script.js';

const IMPORT_FORMATS = {
  DOCX: 'docx',
  JCR: 'jcr',
};

/**
 * functions
 */

function truncateString(str, firstCharCount = str.length, endCharCount = 0) {
  if (str.length <= firstCharCount + endCharCount) {
    return str; // No truncation needed
  }
  const firstPortion = str.slice(0, firstCharCount);
  const endPortion = str.slice(-endCharCount);
  return `${firstPortion}...${endPortion}`;
}

async function startHTTPServer(customImportScriptPath = null) {
  const scriptPath = customImportScriptPath
    ? path.resolve(path.dirname(customImportScriptPath))
    : path.join(import.meta.dirname, '../../src/importer');

  const app = express();
  app.use(cors());
  app.use(serveStatic(scriptPath));

  return app.listen(8888, { index: true });
}

async function disableJS(page) {
  const client = await page.target().createCDPSession();
  const interceptManager = new RequestInterceptionManager(client);
  await interceptManager.intercept(
    {
      // specify the URL pattern to intercept:
      urlPattern: '*',
      // optionally filter by resource type:
      resourceType: 'Document',
      // specify how you want to modify the response (may be async):
      modifyResponse({ body }) {
        if (body) {
          const regex = /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gm;
          const subst = '';
          const result = body.replace(regex, subst);
          return { body: result };
        }
        return { body };
      },
    },
  );
}

async function rewriteUrlsToRelative(page, url, rewriteFn) {
  const client = await page.target().createCDPSession();
  const interceptManager = new RequestInterceptionManager(client);
  await interceptManager.intercept(
    {
      urlPattern: url,
      resourceType: 'Document',
      modifyResponse({ body }) {
        if (body) {
          const u = new URL(url);
          const result = rewriteFn(body, u.origin);
          return { body: result };
        }
        return { body };
      },
    },
  );
}

function getImage2PngFunction(imageCache) {
  return async function image2png({ src, data }) {
    try {
      const found = imageCache.find((img) => img.url === src);
      const imgData = found ? found.buffer : data;
      const png = (await sharp(imgData)).png();
      const metadata = await png.metadata();
      return {
        data: png.toBuffer(),
        width: metadata.width,
        height: metadata.height,
        type: 'image/png',
      };
    } catch (e) {
      /* eslint-disable no-console */
      console.error(`Cannot convert image ${src} to png. It might corrupt the Word document and you should probably remove it from the DOM.`);
      return null;
    }
  };
}

async function importPage(
  page,
  url,
  saveAs,
  componentsPath,
  customImportScriptPath,
  pageImages,
  logger,
) {
  // inject helix-import library script
  // will provide WebImporter.html2docx function in browser context
  const js = fs.readFileSync(path.join(import.meta.dirname, '../../vendors/helix-importer.js'), 'utf-8');
  await page.evaluate(js);

  const importScriptURL = customImportScriptPath
    ? `http://localhost:8888/${path.basename(customImportScriptPath)}`
    : DEFAULT_IMPORT_SCRIPT_URL;

  const importTransformResult = await page.evaluate(async (originalURL, importScript) => {
    /* eslint-disable */
    // code executed in the browser context

    // import the custom transform config          
    const customTransformConfig = await import(importScript);
    
    // execute default import script
    const out = await WebImporter.html2md(location.href, document, customTransformConfig.default, { originalURL, toDocx: false, toMd: true });

    // return the md content
    return out;
    /* eslint-enable */
  }, url, importScriptURL);

  console.log('importTransformResult', importTransformResult);
  const files = Array.isArray(importTransformResult)
    ? importTransformResult
    : [importTransformResult];

  const filenames = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];

    if (saveAs === IMPORT_FORMATS.DOCX) {
      // convert markdown to docx
      /* eslint-disable no-await-in-loop */
      const docx = await md2docx(file.md, {
        docxStylesXML: null,
        image2png: getImage2PngFunction(pageImages),
        log: {
          info: () => {},
          warn: () => {},
          error: () => {},
          log: () => {},
        },
      });

      // save docx file
      const docxPath = path.resolve(path.join('docx', file.path));
      if (!fs.existsSync(path.dirname(docxPath))) {
        fs.mkdirSync(path.dirname(docxPath), { recursive: true });
      }

      fs.writeFileSync(`${docxPath}.docx`, docx);

      logger.debug(`imported page saved to docx file ${docxPath}.docx`);
    } else if (saveAs === IMPORT_FORMATS.JCR) {
      // load components
      const components = await loadComponents(componentsPath);
      console.log('components', components);

      const jcr = await md2jcr(file.md, components);
      // save jcr file
      const jcrPath = path.resolve(path.join('jcr', file.path));
      if (!fs.existsSync(path.dirname(jcrPath))) {
        fs.mkdirSync(path.dirname(jcrPath), { recursive: true });
      }

      fs.writeFileSync(`${jcrPath}.xml`, jcr);

      logger.debug(`imported page saved to xml file ${jcrPath}.xml`);
    }

    filenames.push({
      path: file.path.replace(/\/index$/, '/'),
      filename: `${file.path}.${IMPORT_FORMATS.DOCX ? 'docx' : 'xml'}`,
    });
  }
  return filenames;
}

/**
 * worker
 */

async function importWorker({
  // payload
  url,
  retries,
}) {
  /* eslint-disable no-async-promise-executor */
  return new Promise(async (resolve) => {
    // context / this
    const {
      AEMBulk,
      options: {
        saveAs,
        componentsPath,
        pacingDelay,
        pageTimeout,
        disableJs,
        customImportScriptPath,
        customHeaders,
        pptrCluster,
      },
    } = this;

    const importResult = {
      url,
      retries,
      status: 'done',
      message: '',
      docxFilename: '',
      files: [],
    };

    let logger = getLogger('importer-worker');

    try {
      // pacing delay
      await AEMBulk.Time.sleep(pacingDelay);

      await pptrCluster.execute({ url }, async ({ page, data, worker }) => {
        logger = getLogger(`importer-worker-${worker.id}`);

        await page.setDefaultNavigationTimeout(pageTimeout);

        /* eslint-disable no-shadow */
        const { url } = data;

        logger.debug(`importing ${url} on browser instance ${worker.id}`);

        // disable JS
        if (disableJs) {
          await disableJS(page);
        }

        // rewrite URLs to relative
        rewriteUrlsToRelative(page, url, AEMBulk.Web.rewriteLinksRelative);

        // force bypass CSP
        await page.setBypassCSP(true);

        // intercept all images and store them as PNG in an array
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          if (req.isInterceptResolutionHandled()) {
            return;
          }
          req.continue();
        });
        const pageImages = [];
        page.on('requestfinished', async (req) => {
          if (req.resourceType() === 'image') {
            try {
              const response = await req.response();
              const contentType = response.headers()['content-type'];
              if (response && response.status() < 300 && contentType && contentType.startsWith('image')) {
                const buffer = await response.buffer();
                const type = response.headers()['content-type'];
                const imgUrl = req.url();
                logger.silly(`storing image ${truncateString(imgUrl, 50, 50).padEnd(105, ' ')} - ${type.padEnd(10, ' ')} - ${(buffer.length).toString().padStart(7, ' ')} bytes`);
                pageImages.push({ url: imgUrl, buffer, type });
              }
            } catch (e) {
              logger.error(`error storing image (${req.url()}): ${e.message}: ${e.stack}`);
            }
          }
        });

        // custom headers
        if (customHeaders) {
          await page.setExtraHTTPHeaders(customHeaders);
        }

        const resp = await page.goto(url, { waitUntil: 'networkidle2' });

        // compute status
        if (resp.status() >= 400) {
          // error -> stop + do not retry
          importResult.status = 'error';
          importResult.message = `status code ${resp.status()}`;
          importResult.retries = 0;
        } else if (resp.request()?.redirectChain()?.length > 0 && resp.url() !== url) {
          // redirect -> stop
          importResult.status = 'redirect';
          importResult.message = `redirected to ${resp.url()}`;
        } else {
          // ok -> import

          // force scroll
          if (!disableJs) {
            await AEMBulk.Puppeteer.smartScroll(page, { postReset: true });
          }

          const filenames = await importPage(
            page,
            url,
            saveAs,
            componentsPath,
            customImportScriptPath,
            pageImages,
            logger,
          );

          importResult.docxFilename = filenames.join(', ');
          importResult.files = filenames;
        }
      });
    } catch (e) {
      importResult.status = 'error';
      importResult.message = e.message;
      logger.error(e);
    }

    resolve(importResult);
  });
}

/**
 * main
 */

export default function importCmd() {
  return {
    command: 'import',
    describe: 'Import the given URLs to docx file using default import script',
    builder: (yargs) => {
      withCustomCLIParameters(yargs, { inputs: true, workers: true })
        .option('pacing-delay', {
          alias: 'pacingDelay',
          describe: 'Delay in milliseconds between each request',
          type: 'number',
          default: 250,
        })
        .option('disable-js', {
          alias: 'disableJs',
          describe: 'Disable JavaScript execution in the browser',
          type: 'boolean',
          default: true,
        })
        .option('import-script-path', {
          alias: 'importScriptPath',
          describe: 'Path to the custom import script to use for the import',
          type: 'string',
          string: true,
        })
        .option('save-as', {
          alias: 'saveAs',
          describe: 'format(s) to save the imported content as',
          choices: Object.values(IMPORT_FORMATS),
          default: 'docx',
        })
        .option('components-path', {
          alias: 'componentsPath',
          describe: '(JCR only) Path to crosswalk components json files',
        })
        .option('page-timeout', {
          alias: 'pageTimeout',
          describe: 'Timeout in milliseconds for each page load',
          type: 'number',
          default: 30000,
        })
        .option('custom-header', {
          alias: 'customHeader',
          describe: 'custom header to set in the browser',
          type: 'array',
          string: true,
        })
        .option('retries', {
          describe: 'Number of retried in case of import error',
          type: 'number',
          default: 1,
        })
        .option('excel-report', {
          alias: 'excelReport',
          describe: 'Path to Excel report file for processed URLs',
          default: 'import-report.xlsx',
          type: 'string',
        })
        .group(['import-script-path', 'custom-header', 'disable-js', 'save-as', 'components-path', 'pacing-delay', 'retries', 'page-timeout', 'excel-report'], 'Import Options:')
        .help();
    },
    handler: (new CommonCommandHandler()).withHandler(async ({
      argv, logger, AEMBulk,
    }) => {
      logger.debug(`handler - import start - ${logger.level}`);

      /**
       * init
       */

      // http server to serve the import script
      const httpServer = await startHTTPServer(argv.importScriptPath);

      // parse URLs
      let urls = [];
      if (argv.interactive) {
        urls = await readLines(argv.listBreaker);
      } else if (argv.file) {
        // Read the list of URLs from the file
        urls = fs.readFileSync(argv.file, 'utf-8').split('\n').filter(Boolean);
      } else {
        throw new Error('Please specify either --file or --interactive mode');
      }
      logger.info(`Processing ${urls.length} URLs with ${argv.workers} workers`);

      // init excel report
      const excelReport = new ExcelWriter({
        filename: argv.excelReport,
        headers: ['url', 'path', 'filename', 'status', 'message'],
        formatRowFn: (r) => {
          const row = ['url', 'path', 'filename', 'status', 'message'].map((k) => r[k]);
          return row;
        },
        writeEvery: 1,
      });

      // parse browser headers
      let customHeaders = null;
      if (argv.customHeader) {
        customHeaders = {};
        argv.customHeader.forEach((h) => {
          const [key, value] = h.split(':');
          customHeaders[key] = value;
        });
      }

      // init puppeteer cluster
      const pptrCluster = await AEMBulk.Puppeteer.initBrowserCluster(
        argv.workers,
        {
          headless: true,
          disableJS: argv.disableJs,
          pageTimeout: argv.pageTimeout,
          extraArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--remote-allow-origins=*', '--disable-web-security'],
        },
      );

      // init queue
      const queue = fastq.promise(
        {
          AEMBulk,
          options: {
            pptrCluster,
            saveAs: argv.saveAs,
            componentsPath: argv.componentsPath,
            pacingDelay: argv.pacingDelay,
            pageTimeout: argv.pageTimeout,
            disableJs: argv.disableJs,
            customImportScriptPath: argv.importScriptPath,
            customHeaders,
          },
        },
        importWorker,
        argv.workers,
      );
      // force pause - no autostart
      await queue.pause();

      /**
       * main
       */

      const queueResultHandler = async (result, err) => {
        if (err) {
          logger.error(`import error: ${err}`);
        } else if (result.status === 'error') {
          logger.error(`import error on ${result.url}: ${result.message}`);
          if (result.retries > 0) {
            logger.error(`retrying ${result.url} - ${result.retries} left`);
            await queue.pause();
            queue.push({ url: result.url, retries: result.retries - 1 }).then(queueResultHandler);
            await queue.resume();
          } else {
            logger.error(`giving up on ${result.url}`);
            await excelReport.addRow(result);
          }
        } else {
          // let tplName = '';

          if (result.status === 'done') {
            // const tplHash = result.analysis.template?.hash || '';
          }

          logger.info(`[${result.status.padEnd(8)}] import done for ${result.url} (${result.message})`);

          for (const file of result.files) {
            const { path, filename } = file;
            const row = {
              url: result.url,
              path,
              filename,
              status: result.status,
              message: result.message,
            };
            await excelReport.addRow(row);
          }
        }
      };

      try {
        // add items to queue
        for (const url of urls) {
          queue.push({ url, retries: argv.retries, logger }).then(queueResultHandler);
        }

        logger.debug('queue - all items added, start processing');
        await queue.resume();
        logger.debug('queue - wait for drained');
        await queue.drained();
        logger.debug('queue - done, stop queue');
        await queue.kill();
        await pptrCluster.close();
      } catch (e) {
        logger.error(`main command thread: ${e.stack}`);
      }

      // write/close excel report
      await excelReport.close();

      // stop http server
      await httpServer.close();

      logger.debug('handler - import done');
    }),
  };
}
