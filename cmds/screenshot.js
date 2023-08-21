#!/usr/bin/env node

// imports
const { cliWorkerHandler } = require('../src/cliWorkerHandler');
const path = require('path');

/*
 * CLI Command parameters
 */

function yargsBuilder(yargs) {
  return yargs
    .option('interactive', {
      alias: 'i',
      describe: 'Start the application in interactive mode, you will be prompted to copy/paste the list of URLs directly in the terminal. Enter an empty line to finish the process',
      type: 'boolean',
    })
    .option('file', {
      alias: 'f',
      describe: 'Path to a text file containing the list of URLs to deliver (urls pattern: "https://<branch>--<repo>--<owner>.hlx.page/<path>")',
      type: 'string',
    })
    .option('error-file', {
      alias: 'e',
      describe: 'Path to a text file that will contain the list of URLs that failed to process',
      type: 'string',
    })
    .conflicts('f', 'i')
    .option('list-breaker', {
      describe: 'The character to use to signal end of the list in interactive mode. Default is empty line',
      type: 'string',
      default: '',
    })
    .option('workers', {
      alias: 'w',
      describe: 'Number of workers to use (max. 5)',
      type: 'number',
      default: 1,
      coerce: (value) => {
        if (value > 5) {
          terminal.yellow('Warning: Maximum number of workers is 5. Using 5 workers instead.\n');
          return 5;
        }
        return value;
      },
    })
    .option('output-folder', {
      alias: 'o',
      describe: 'The target folder for the generated screenshots',
      type: 'string',
      default: 'screenshots',
    })
    .option('page-width', {
      describe: 'Width of the page to capture (in px.)',
      type: 'number',
      default: 1280,
    })
    .option('remove-selector', {
      alias: 'r',
      describe: 'CSS Selector to remove from the page before taking the screenshot',
      type: 'array',
    })
    .option('post-load-wait', {
      describe: 'The time to wait after page loaded, before starting to take the screenshot (in ms.)',
      type: 'number',
      default: 500,
    })
    .option('inject-js', {
      describe: 'Javascript code to inject in the browser after page loaded',
      type: 'string',
    })
    .option('no-headless', {
      describe: 'No headless browser',
      type: 'boolean',
    })
    .option('no-ad-blocker', {
      describe: 'No AD blocker used in the headless browser',
      type: 'boolean',
    })
    .option('no-gdpr-blocker', {
      describe: 'No GDPR blocker used in the headless browser',
      type: 'boolean',
    })
    .option('use-local-chrome', {
      describe: 'Use local Chrome rather than default Chromium. !Beware! This will only work if you have Chrome installed on your machine + performance will be impacted',
      type: 'boolean',
    })
    .option('verbose', {
      describe: 'Verbose mode',
      type: 'boolean',
    })
  
    .help('h');

}

/*
 * Main
 */

exports.desc = 'Take full page screenshot for the given list of URLs';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  // create output folder structure
  const outputFolder = path.isAbsolute(argv.outputFolder)
    ? argv.outputFolder
    : path.join(process.cwd(), argv.outputFolder);

  const adBlocker = argv.adBlocker === false ? false : true;
  const gdprBlocker = argv.gdprBlocker === false ? false : true;
  const headless = argv.headless === false ? false : true;
  const removeSelectors = argv.removeSelector || [];
  const useLocalChrome = argv.useLocalChrome === true ? true : false;
    
  // execute preparation of the sections mapping
  return cliWorkerHandler('screenshot_worker.js', {
    adBlocker,
    gdprBlocker,
    headless,
    outputFolder,
    pageWidth: argv.pageWidth,
    postLoadWait: argv.postLoadWait,
    injectJs: argv.injectJs,
    removeSelectors,
    useLocalChrome,
  }, argv);
};
