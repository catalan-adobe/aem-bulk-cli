#!/usr/bin/env node

// imports
const { cliWorkerHandler } = require('../src/cliWorkerHandler');
const { defaultCLICmdWithWorkerYargsBuilder } = require('../src/yargs');

// constants
const FRANKLIN_STAGE_LIVE = 'live';

/*
 * Main
 */

exports.desc = 'Publish pages to live stage on Franklin';
exports.builder = defaultCLICmdWithWorkerYargsBuilder;
exports.handler = cliWorkerHandler.bind(null, 'publish_worker.js', { stage: FRANKLIN_STAGE_LIVE });
