const { parentPort } = require('worker_threads');
const pUtils = require('path');
const fs = require('fs');
const { WORKER_LOGGER } = require('../src/logger');

/*
 * Worker thread
 */

// Listen for messages from the parent thread
parentPort.on('message', async (msg) => {
  if (msg && msg.type === 'exit') {
    // If the parent thread sent 'exit', exit the worker thread
    process.exit();
  } else {
    const importerLib = await import('franklin-bulk-shared');

    try {
      const u = new URL(msg.url);
      const OUTPUT_FOLDER = pUtils.join(msg.options.outputFolder, u.hostname); // `${process.cwd()}/output`;

      if (msg.options.skipExisting) {
        const path = importerLib.Url.buildFilenameWithPathFromUrl(msg.url);
        const filename = `${OUTPUT_FOLDER}${path}`;

        console.log(filename);

        if (fs.existsSync(filename)) {
          parentPort.postMessage({
            url: msg.url,
            passed: true,
            result: 'Skipped',
          });
          return;
        }  
      }

      const [browser, page] = await importerLib.Puppeteer.initBrowser({ 
        port: msg.port,
        headless: msg.options.headless
      });
      
      await importerLib.Puppeteer.runStepsSequence(
        page,
        msg.url,
        [
          importerLib.Puppeteer.Steps.postLoadWait(1000),
          importerLib.Puppeteer.Steps.GDPRAutoConsent(),
          importerLib.Puppeteer.Steps.smartScroll(),
          // importerLib.Puppeteer.Steps.execAsync(async (browserPage) => {
          //   await browserPage.keyboard.press('Escape');
          // }),
          importerLib.Puppeteer.Steps.fullPageScreenshot({ outputFolder: OUTPUT_FOLDER }),
          importerLib.Puppeteer.Steps.cacheResources({ outputFolder: OUTPUT_FOLDER }),
        ],
        WORKER_LOGGER.child({ workerId: `WORKER #${msg.idx}` }),
      );

      // cool down
      await importerLib.Time.sleep(250);

      await browser.close();

      parentPort.postMessage({
        url: msg.url,
        passed: true,
        result: 'Success',
      });
    } catch (error) {
      parentPort.postMessage({
        url: msg.url,
        passed: false,
        result: error.message,
      });
    }
  }
});
