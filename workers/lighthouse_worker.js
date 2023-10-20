const { parentPort } = require('worker_threads');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * functions
 */

/* eslint-disable no-async-promise-executor */
const runLighthouse = (url, apiKey) => new Promise(async (resolve, reject) => {
  const execId = randomUUID();

  try {
    const startTime = Date.now();
    const psiURL = `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&category=ACCESSIBILITY&category=BEST_PRACTICES&category=PERFORMANCE&category=SEO&strategy=MOBILE&key=${apiKey}`;

    const res = await fetch(psiURL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`PSI error: ${res.status} ${res.statusText}`);
    }

    const duration = Date.now() - startTime;
    const report = await res.json();
    const timestamp = new Date().toISOString();

    resolve({
      execId,
      url,
      report,
      duration,
      timestamp,
    });
  } catch (error) {
    reject(error);
  }
});

/**
 * worker thread
 */

// Listen for messages from the parent thread
parentPort.on('message', async (msg) => {
  if (msg && msg.type === 'exit') {
    // If the parent thread sent 'exit', exit the worker thread
    process.exit();
  } else {
    // console.log(msg);
    const { psiType } = msg.options.argv;

    try {
      if (psiType === 'local') {
        const importerLib = await import('franklin-bulk-shared');

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
          postMsg: `: LH (${result.lighthouse.version}) Scores: ${Object.keys(result.lighthouse.scores).map((k) => `${k}: ${result.lighthouse.scores[k].score}`).join(', ')} `,
        });
      } else if (psiType === 'google') {
        const result = await runLighthouse(msg.url, msg.options.argv.googleApiKey);

        // write result to file
        fs.writeFileSync(path.join(msg.options.reportsFolder, `${result.execId}.json`), JSON.stringify(result, null, 2));

        const categories = ['performance', 'accessibility', 'best-practices', 'seo'];

        parentPort.postMessage({
          url: msg.url,
          passed: true,
          result: 'Success',
          postMsg: `: LH (${result.report.lighthouseResult.lighthouseVersion}) Scores: ${categories.map((k) => `${k}: ${result.report.lighthouseResult.categories[k].score}`).join(', ')} `,
          report: result,
        });
      } else {
        throw new Error(`Unsupported PSI type ${psiType}`);
      }
    } catch (error) {
      parentPort.postMessage({
        url: msg.url,
        passed: false,
        result: error.message,
      });
    }
  }
});
