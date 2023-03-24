#!/usr/bin/env node

// imports
const { cliWorkerHandler } = require('../src/cliWorkerHandler');
const { defaultCLICmdWithWorkerYargsBuilder } = require('../src/yargs');

/*
 * Main
 */

exports.desc = 'Take full page screenshots for given list of URLs';
exports.builder = defaultCLICmdWithWorkerYargsBuilder;
exports.handler = cliWorkerHandler.bind(null, 'screenshot_worker.js', {});
