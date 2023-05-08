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
      const [browser, page] = await importerLib.Puppeteer.initBrowser({
        port: msg.port,
      });

      const result = await importerLib.Puppeteer.runStepsSequence(
        page,
        msg.url,
        [
          importerLib.Puppeteer.Steps.runLighthouseCheck(),
        ],
      );

      // cool down
      await importerLib.Time.sleep(250);

      await browser.close();

      parentPort.postMessage({
        url: msg.url,
        passed: true,
        result: 'Success',
        preMsg: `LH (${result.lighthouse.version}) Scores: ${Object.keys(result.lighthouse.scores).map((k) => `${k}: ${result.lighthouse.scores[k].score}`).join(', ')} `,
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
