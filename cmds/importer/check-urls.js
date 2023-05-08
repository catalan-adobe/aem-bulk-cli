#!/usr/bin/env node

// imports
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
      describe: 'Path to a text file containing the list of URLs to check',
      type: 'string',
    })
    .conflicts('f', 'i')
    .option('workers', {
      alias: 'w',
      describe: 'Number of workers to use (max. 8)',
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
    .option('timeout', {
      alias: 't',
      describe: 'HTTP Timeout in seconds',
      type: 'number',
      default: 10,
    });
}

/*
 * Main
 */

exports.desc = 'Check HTTP Status for a list of URLs';
exports.builder = yargsBuilder;
// exports.handler = cliWorkerHandler.bind(null, 'importer_check_urls_worker.js');
exports.handler = async (argv) => cliWorkerHandler('importer_check_urls_worker.js', { timeout: argv.timeout }, argv);
