const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');

/*
 * Worker thread
 */

const JS_LIB = path.join(__dirname, '../resources/detect-lib.js');

// Listen for messages from the parent thread
parentPort.on('message', async (msg) => {
  if (msg && msg.type === 'exit') {
    // If the parent thread sent 'exit', exit the worker thread
    process.exit();
  } else {
    const importerLib = await import('franklin-bulk-shared');

    try {
      const [browser, page] = await importerLib.Puppeteer.initBrowser({
        port: msg.port,
        headless: false,
        devTools: false,
        maximized: false,
      });

      // await page.setViewport({ width: 1280, height: 1200 });

      await importerLib.Puppeteer.runStepsSequence(
        page,
        msg.url,
        [
          // importerLib.Puppeteer.Steps.postLoadWait(msg.options.postLoadWait),
          importerLib.Puppeteer.Steps.execAsync(async (browserPage) => {
            try {
              console.log(__dirname);
              const js = fs.readFileSync(JS_LIB, 'utf8');
              await browserPage.evaluateOnNewDocument(js);
              await browserPage.reload({ waitUntil: 'networkidle0'});
            } catch (e) {
              console.error(e);
            }
            
          }),
          // importerLib.Puppeteer.Steps.smartScroll(),
          importerLib.Puppeteer.Steps.execAsync(async (browserPage) => {
            try {
              const resultHandle = await browserPage.evaluateHandle(() => xp.analysePage());
              // importerLib.Time.sleep(1000);
              const resultHandle2 = await browserPage.evaluateHandle(() => xp.predictPage());
              // importerLib.Time.sleep(1000);
              const boxes = await resultHandle2.jsonValue();
              console.log(boxes.template);

              fs.writeFileSync('templates.txt', `${boxes.template.hash},${msg.url}\n`, { flag: 'a' });
              await resultHandle.dispose();
            } catch (e) {
              console.error(e);
            }            
          }),
          importerLib.Puppeteer.Steps.postLoadWait(99999999),
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
