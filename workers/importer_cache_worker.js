const { parentPort, workerData } = require('worker_threads');
const pUtils = require('path');
const fs = require('fs');
const { getWorkerLogger } = require('../src/logger');

const logger = getWorkerLogger(workerData.idx);

/*
 * Worker thread
 */

// Listen for messages from the parent thread
parentPort.on('message', async (msg) => {
  if (msg && msg.type === 'exit') {
    // If the parent thread sent 'exit', exit the worker thread
    process.exit();
  } else {
    logger.debug(`process URL ${msg.url}`);
    const importerLib = await import('franklin-bulk-shared');

    let browser;
    let page;

    try {
      const u = new URL(msg.url);
      const OUTPUT_FOLDER = pUtils.join(msg.options.outputFolder, u.hostname);

      if (msg.options.skipExisting) {
        const [p, filename] = importerLib.Url.buildPathAndFilenameWithPathFromUrl(msg.url);
        const path = pUtils.join(OUTPUT_FOLDER, p);

        if (fs.existsSync(pUtils.join(path, filename))) {
          parentPort.postMessage({
            url: msg.url,
            passed: true,
            result: 'Skipped',
          });
          return;
        }
      }

      [browser, page] = await importerLib.Puppeteer.initBrowser({
        port: msg.port,
        headless: msg.options.headless,
      });

      await importerLib.Puppeteer.runStepsSequence(
        page,
        msg.url,
        [
          importerLib.Puppeteer.Steps.postLoadWait(1000),
          importerLib.Puppeteer.Steps.GDPRAutoConsent(),
          importerLib.Puppeteer.Steps.smartScroll(),
          importerLib.Puppeteer.Steps.cacheResources({ outputFolder: OUTPUT_FOLDER }),
          importerLib.Puppeteer.Steps.fullPageScreenshot({ outputFolder: OUTPUT_FOLDER }),
        ],
        logger,
      );

      // cool down
      await importerLib.Time.sleep(250);

      logger.debug(`URL ${msg.url} done, success`);
      parentPort.postMessage({
        url: msg.url,
        passed: true,
        result: 'Success',
      });
    } catch (error) {
      logger.debug(`URL ${msg.url} done, failed`);
      parentPort.postMessage({
        url: msg.url,
        passed: false,
        result: error.message,
      });
    } finally {
      if (browser) {
        logger.debug('closing browser ...');
        await browser.close();
      }
    }
  }
});
