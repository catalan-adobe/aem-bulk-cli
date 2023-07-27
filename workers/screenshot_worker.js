const { parentPort } = require('worker_threads');

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
      const OUTPUT_FOLDER = msg.options.outputFolder;

      const [browser, page] = await importerLib.Puppeteer.initBrowser({
        width: msg.options.pageWidth,
        adBlocker: msg.options.adBlocker,
        gdprBlocker: msg.options.gdprBlocker,
        port: msg.port,
        headless: msg.options.headless,
        useLocalChrome: msg.options.useLocalChrome,
      });

      await importerLib.Puppeteer.runStepsSequence(
        page,
        msg.url,
        [
          importerLib.Puppeteer.Steps.postLoadWait(msg.options.postLoadWait),
          importerLib.Puppeteer.Steps.execAsync(async (browserPage) => {
            if (msg.options.injectJs) {
              await browserPage.evaluate(msg.options.injectJs);
            }
            if (msg.options.removeSelectors.length > 0) {
              await browserPage.evaluate((selector) => {
                document.querySelectorAll(selector).forEach((el) => el.remove());
              }, msg.options.removeSelectors.join(', '));
            }
          }),
          importerLib.Puppeteer.Steps.smartScroll(),
          importerLib.Puppeteer.Steps.fullPageScreenshot({
            outputFolder: OUTPUT_FOLDER,
          }),
        ],
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
