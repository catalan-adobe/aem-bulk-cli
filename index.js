#!/usr/bin/env node
const yargs = require('yargs');

(async function main() {
  await yargs(process.argv.slice(2))
    .commandDir('cmds')
    .demandCommand()
    .scriptName('franklin-bulk')
    .usage('Usage: $0 <command> [options]')
    // .parserConfiguration({ 'camel-case-expansion': false })
    .showHelpOnFail(true)
    .help('h')
    .wrap(yargs.terminalWidth())
    .argv;
}());
