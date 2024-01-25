#!/usr/bin/env node

// imports
const { cliWorkerHandler } = require('../../src/cliWorkerHandler');
const { defaultCLICmdWithWorkerYargsBuilder } = require('../../src/yargs');

/*
 * Main
 */

exports.desc = 'Detect the template of a list of URLs';
exports.builder = defaultCLICmdWithWorkerYargsBuilder;
// exports.handler = cliWorkerHandler.bind(null, 'importer_detect_template_worker.js');
exports.handler = async (argv) => {
  // execute preparation of the sections mapping
  return cliWorkerHandler('importer_detect_template_worker.js', null, argv);
};
