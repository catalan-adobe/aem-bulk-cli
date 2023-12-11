#!/usr/bin/env node

// imports
const path = require('path');
const { cliWorkerHandler } = require('../../src/cliWorkerHandler');
const { defaultCLICmdWithWorkerYargsBuilder } = require('../../src/yargs');

function yargsBuilder(yargs) {
  return defaultCLICmdWithWorkerYargsBuilder(yargs)
    .option('output-folder', {
      alias: 'o',
      describe: 'The target folder for the generated data',
      type: 'string',
      default: 'cache',
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
