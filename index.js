#!/usr/bin/env node
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
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { getLogger } from './src/logger.js';
import { withCommonCLIParameters } from './src/cli.js';

const MIN_MSG = 'You need at least one command.';

(async () => {
  const logger = getLogger('aem-bulk', {
    level: 'debug',
    parent: null,
  });

  logger.debug('aem-bulk-cli init ...');

  function cliFailFn(message, err, argv) {
    const msg = err && err.message ? err.message : message;
    if (msg) {
      // eslint-disable-next-line no-console
      console.error(msg);
    }
    if (msg === MIN_MSG || /.*Unknown argument.*/.test(msg) || /.*Not enough non-option arguments:.*/.test(msg)) {
      // eslint-disable-next-line no-console
      console.error('\n%s', argv.help());
    }
    process.exit(1);
  }

  const yyy = yargs();
  const argv = withCommonCLIParameters(yyy, logger)
    .command([
      (await import('./cmds/publish.js')).previewCmd(),
      (await import('./cmds/publish.js')).liveCmd(),
      (await import('./cmds/login.js')).default(),
      (await import('./cmds/screenshot.js')).default(),
      (await import('./cmds/lighthouse.js')).default(),
      (await import('./cmds/importer/index.js')).default(),
    ])
    .strictCommands(true)
    .scriptName('aem-bulk')
    .usage('Usage: $0 <command> [options]')
    // .parserConfiguration({ 'camel-case-expansion': false })
    .env('AEM_BULK')
    // .check((a) => envAwareStrict(a, argv.parsed.aliases))
    .showHelpOnFail(true)
    .fail(cliFailFn)
    // .exitProcess(args.indexOf('--get-yargs-completions') > -1)
    .demandCommand(1, MIN_MSG)
    // .epilogue('use <command> --help to get command specific details.\n\nfor more information, find our manual at https://github.com/adobe/helix-cli')
    .wrap(120/* yyy.terminalWidth() */)
    .help()
    .parse(hideBin(process.argv));

  argv.logger = getLogger('aem-bulk', {
    level: argv.logLevel,
    parent: logger,
    file: argv.logFile,
  });
})();
