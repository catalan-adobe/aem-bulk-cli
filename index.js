#!/usr/bin/env node

const yargs = require('yargs');

(async function main() {
  await yargs(process.argv.slice(2))
    .commandDir('cmds')
    .demandCommand()
    .help('h')
    .wrap(yargs.terminalWidth())
    .argv;
}());
