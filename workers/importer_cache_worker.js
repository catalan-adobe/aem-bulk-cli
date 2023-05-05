const { parentPort, workerData, threadId } = require('worker_threads');
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
    console.log('threadId', threadId, workerData.idx, workerData.port, msg.port, msg.url);

    const lll = WORKER_LOGGER.child({ workerId: `WORKER #${msg.idx}` });

    const importerLib = await import('franklin-bulk-shared');

    try {
      const u = new URL(msg.url);
      const OUTPUT_FOLDER = pUtils.join(msg.options.outputFolder, u.hostname); // `${process.cwd()}/output`;

      if (msg.options.skipExisting) {
        const path = importerLib.Url.buildFilenameWithPathFromUrl(msg.url);
        const filename = `${OUTPUT_FOLDER}${path}`;

        if (fs.existsSync(filename)) {
          lll.debug('SKIPPED >>>', msg.url);
          console.log('SKIPPED >>>', threadId, msg.url);

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
          importerLib.Puppeteer.Steps.cacheResources({ outputFolder: OUTPUT_FOLDER }),
          importerLib.Puppeteer.Steps.fullPageScreenshot({ outputFolder: OUTPUT_FOLDER }),
        ],
        lll,
      );

      // cool down
      await importerLib.Time.sleep(250);

      lll.debug('CLOSING BROWSER >>>');
      await browser.close();
      lll.debug('BROWSER CLOSED >>>');

      lll.debug('PASSED >>>', msg.url);
      console.log('PASSED >>>', threadId, msg.url);

      parentPort.postMessage({
        url: msg.url,
        passed: true,
        result: 'Success',
      });
    } catch (error) {
      lll.debug('FAILED >>>', msg.url, error.message);
      console.log('FAILED >>>', threadId, msg.url);
      parentPort.postMessage({
        url: msg.url,
        passed: false,
        result: error.message,
      });
    }
  }
});
