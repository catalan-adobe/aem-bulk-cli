#!/usr/bin/env node --no-deprecation
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
    level: 'info',
    parent: null,
  });

  logger.debug('aem-bulk-cli init ...');

  function envAwareStrict(args, aliases) {
    const specialKeys = ['$0', '--', '_'];

    const unknown = [];
    Object.keys(args).forEach((key) => {
      if (specialKeys.indexOf(key) === -1 && !(key in aliases)) {
        unknown.push(key);
      }
    });

    if (unknown.length > 0) {
      return unknown.length === 1 ? `Unknown argument: ${unknown[0]}` : `Unknown arguments: ${unknown.join(', ')}`;
    }

    return true;
  }

  function cliFailFn(message, err, argv) {
    const msg = err && err.message ? err.message : message;
    if (msg) {
      logger.error(msg);
    }
    /* eslint-disable no-console */
    console.error(argv.help());
    process.exit(1);
  }

  const yyy = yargs();
  const argv = withCommonCLIParameters(yyy, logger)
    .command([
      (await import('./cmds/publish.js')).default(),
      (await import('./cmds/login.js')).default(),
      (await import('./cmds/screenshot.js')).default(),
      (await import('./cmds/lighthouse.js')).default(),
      (await import('./cmds/importer/index.js')).default(),
    ])
    .strictCommands(true)
    .scriptName('aem-bulk')
    .usage('Usage: $0 <command> [options]')
    .env('AEM_BULK')
    .check((a) => envAwareStrict(a, yyy.parsed.aliases))
    .fail(cliFailFn)
    .demandCommand(1, MIN_MSG)
    .wrap(120)
    .help()
    .parse(hideBin(process.argv));

  argv.logger = getLogger('aem-bulk', {
    level: argv.logLevel,
    parent: logger,
    file: argv.logFile,
  });
})();
