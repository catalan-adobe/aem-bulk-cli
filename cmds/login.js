#!/usr/bin/env node

// imports
const fs = require('fs');
const path = require('path');
const os = require('os');

/*
 * CLI Command parameters
 */

function yargsBuilder(yargs) {
  return yargs
    .option('path', {
      alias: 'p',
      describe: 'Path of the Frankiln website (/{repo}/{owner}/{ref})',
      type: 'string',
    })
    .demandOption(['p'])

    .help('h');
}

/*
 * Main
 */

exports.desc = 'Login to a Franklin authenticated website';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  const frkPath = argv.path;

  let browser = null;

  const importerLib = await import('franklin-bulk-shared');

  try {
    [browser] = await importerLib.Puppeteer.initBrowser({
      headless: false,
      adBlocker: false,
      gdprBlocker: false,
      userDataDir: path.join(os.tmpdir(), '.franklin-bulk-shared-chrome-data'),
    });

    // Create a page
    const page = await browser.newPage();

    // global timeout
    const globalTimeout = setTimeout(() => {
      throw new Error('Timeout');
    }, 120000);

    page.on('load', async () => {
      const cookies = await page.cookies();
      const cookie = cookies.find((c) => c.name === 'auth_token');

      if (cookie) {
        await browser.close();

        const credentialsFile = path.join(os.homedir(), '.frk-cli-credentials.json');

        await fs.writeFileSync(credentialsFile, JSON.stringify({
          path: frkPath,
          auth_token: decodeURIComponent(cookie.value),
        }, null, 2));
        clearTimeout(globalTimeout);
      }
    });

    await page.goto(`https://admin.hlx.page/login${frkPath}`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e.message);
    if (browser) {
      await browser.close();
    }
  }
};
