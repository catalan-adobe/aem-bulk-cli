#!/usr/bin/env node

// imports
const path = require('path');
const { terminal } = require('terminal-kit');
const { cliWorkerHandler } = require('../../src/cliWorkerHandler');

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
    .conflicts('f', 'i')
    .option('output-folder', {
      alias: 'o',
      describe: 'The target folder for the generated data',
      type: 'string',
      default: 'cache',
    })
    .option('workers', {
      alias: 'w',
      describe: 'Number of workers to use (max. 8)',
      type: 'number',
      default: 1,
      coerce: (value) => {
        if (value > 50) {
          terminal.yellow('Warning: Maximum number of workers is 50. Using 50 workers instead.\n');
          return 50;
        }
        return value;
      },
    })
    .option('no-headless', {
      describe: 'Starts the browser in non-headless mode. Useful for debugging. Also, it forces workers to 1.',
      type: 'boolean',
    })
    .option('skip-existing', {
      describe: 'Starts the browser in non-headless mode. Useful for debugging. Also, it forces workers to 1.',
      type: 'boolean',
    });
}

/*
 * Main
 */

exports.desc = 'Cache webpages resources for a list of URLs';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  // create output folder structure
  const outputFolder = path.isAbsolute(argv.outputFolder)
    ? argv.outputFolder
    : path.join(process.cwd(), argv.outputFolder);

  // headless true unless --no-headless is passed
  const headless = argv.headless !== undefined ? argv.headless : true;

  // skip-existing false unless --no-headless is passed
  const skipExisting = argv.skipExisting !== undefined;

  // execute preparation of the sections mapping
  return cliWorkerHandler('importer_cache_worker.js', {
    outputFolder,
    headless,
    skipExisting,
  }, argv);
};
