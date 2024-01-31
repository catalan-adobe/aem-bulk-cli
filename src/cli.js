/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import readline from 'readline';
import { getLogger } from './logger.js';

export async function readLines(breaker = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lines = [];

  /* eslint-disable-next-line no-console */
  console.log('Enter a list of URLs (urls pattern: "https://<branch>--<repo>--<owner>.hlx.page/<path>"). Enter an empty line to proceed:\n');

  /* eslint-disable-next-line no-restricted-syntax */
  for await (const input of rl) {
    if (input === breaker) {
      break;
    }
    if (input !== '') {
      lines.push(input);
    }
  }

  rl.close();

  return lines;
}

export class CommonCommandHandler {
  #argv;

  #logger;

  #urls;

  constructor(argv, logger) {
    this.#argv = argv;
    this.#logger = logger;
    this.#urls = [];
  }

  get argv() {
    return this.#argv;
  }

  get logger() {
    return this.#logger;
  }

  set logger(value) {
    this.#logger = value;
  }

  get urls() {
    return this.#urls;
  }

  set urls(value) {
    this.#urls = value;
  }

  // eslint-disable-next-line class-methods-use-this
  withHandler(cmdFn) {
    return async function h(argv) {
      try {
        const cmdCommand = argv._ ? argv._.join('_>_') : 'unknown';
        this.logger = getLogger(cmdCommand, {
          level: argv.logLevel,
          file: argv.logFile,
        });
        
        /**
         * validate cli parameters
        */

        if (argv.workers  > 5) {
          this.logger.warn('Warning: limiting maximum number of workers to 5!');
          argv.workers = 5;
        }

        JSON.stringify(argv, null, 2).split('\n').forEach((line) => {
          this.logger.debug(line);
        });

        /**
         * execute cmdFn
         */

        await cmdFn({
          argv,
          logger: this.logger,
          AEMBulk: await import('franklin-bulk-shared'),
        });
      } catch (e) {
        this.logger.error(e.stack);
        throw e;
      } finally {
        this.logger.debug('cli handler done');
      }
    };
  }
}

export function withBrowserCLIParameters(yargs) {
  return yargs
    .option('headless', {
      alias: 'h',
      describe: 'Run in headless mode',
      type: 'boolean',
      default: true,
    })
    .option('disable-js', {
      alias: 'disableJS',
      describe: 'Disable JavaScript',
      type: 'boolean',
      default: false,
    });
}

export function withURLsInputCLIParameters(yargsInst) {
  return yargsInst
    .option('interactive', {
      describe: 'Start the application in interactive mode, you will be prompted to copy/paste the list of URLs directly in the terminal. Enter an empty line to finish the process',
      type: 'boolean',
    })
    .option('list-breaker', {
      alias: 'listBreaker',
      describe: 'The character to use to signal end of the list in interactive mode. Default is empty line',
      type: 'string',
      default: '',
    })
    .conflicts('file', 'interactive')
    .group(['file', 'interactive', 'listBreaker'], 'Input Options:');
}

export function withCommonCLIParameters(yargs) {
  return yargs
    .option('log-level', {
      alias: 'logLevel',
      describe: 'Log level',
      type: 'string',
      choices: ['debug', 'info', 'warn', 'error'],
      default: 'info',
    })
    .option('log-file', {
      alias: 'logFile',
      describe: 'Log file',
      type: 'string',
      normalize: true,
    })
    .option('workers', {
      describe: 'Number of workers to use (max. 5)',
      type: 'number',
      default: 1,
    });
}

export function withCustomCLIParameters(yargs, { inputs = false, workers = false } = {}) {
  if (inputs) {
    yargs
      .option('file', {
        describe: 'Path to a text file containing the list of URLs to use in the command',
        type: 'string',
      })
      .option('interactive', {
        describe: 'Start the application in interactive mode, you will be prompted to copy/paste the list of URLs directly in the terminal. Enter an empty line to finish the process',
        type: 'boolean',
      })
      .option('list-breaker', {
        alias: 'listBreaker',
        describe: 'The character to use to signal end of the list in interactive mode. Default is empty line',
        type: 'string',
        default: '',
      })
      .conflicts('file', 'interactive')
      .group(['file', 'interactive', 'listBreaker'], 'Input Options:');
  }

  if (workers) {
    yargs
      .option('workers', {
        describe: 'Number of workers to use (max. 5)',
        type: 'number',
        default: 1,
      });
  }

  return yargs;
}
