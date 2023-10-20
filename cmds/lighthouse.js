#!/usr/bin/env node

// imports
const { cliWorkerHandler } = require('../src/cliWorkerHandler');
const { defaultCLICmdWithWorkerYargsBuilder } = require('../src/yargs');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

// constants
const LH_AUDIT_KEYS = [ 'speed-index', 'first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift' ];

/**
 * functions
*/

// Get an excel workbook from a path, using exceljs package
async function getExcelSheet(path, sheetName) {
  const REPORT_HEADERS = [ 'url', 'execution id', 'timestamp', 'duration (ms)', 'performance (%)', 'accessibility (%)', 'best practices (%)', 'seo (%)' ].concat(LH_AUDIT_KEYS.map((k) => `${k} (ms)`));
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(path)) {
    await workbook.xlsx.readFile(path);
    const sheet = workbook.getWorksheet(sheetName) || workbook.addWorksheet(sheetName);
    return {workbook, sheet };
  } else {
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(REPORT_HEADERS);
    await workbook.xlsx.writeFile(path);
    return {workbook, sheet };
  }
};

/**
 * CLI Command parameters
 */

function yargsBuilder(yargs) {
  return defaultCLICmdWithWorkerYargsBuilder(yargs)
    .env('FRK_BULK_LH')
    .option('psi-type', {
      alias: 't',
      describe: 'Type of PSI check to use (local|google)',
      default: 'local',
      type: 'string',
    })
    .option('excel-report', {
      alias: 'e',
      describe: 'Path to Excel report file for analysed URLs',
      type: 'string',
    })
    .option('output-folder', {
      alias: 'o',
      describe: 'Folder for generated report',
      default: 'output',
      type: 'string',
    })
    .epilog('(Google PSI requires a valid API key in the FRK_BULK_LH_GOOGLE_API_KEY environment variable)');
}

/*
 * Main
 */

exports.desc = 'Executes Lighthouse analysis for a list of URLs';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  if (argv.psiType === 'google' && !process.env.FRK_BULK_LH_GOOGLE_API_KEY) {
    throw new Error('Google PSI requires a valid API key in the FRK_BULK_LH_GOOGLE_API_KEY environment variable');
  }

  // create output folder structure
  const outputFolder = path.isAbsolute(argv.outputFolder)
    ? argv.outputFolder
    : path.join(process.cwd(), argv.outputFolder);

  const reportsFolder = path.join(outputFolder, 'reports');

  // init environment
  // create output folder if does not exist
  if (!fs.existsSync(reportsFolder)) {
    fs.mkdirSync(reportsFolder, { recursive: true });
  }

  let reporInExcelFn = null;
  if (argv.excelReport && argv.excelReport !== '') {
    const workbook = await getExcelSheet(path.join(outputFolder, argv.excelReport), 'results');

    reporInExcelFn = async (result) => {
      const report = result.report;
      const audits = report.report.lighthouseResult.audits;
      if (report) {
        // write result to excel
        workbook.sheet.addRow([ 
          report.url,
          report.execId,
          report.timestamp,
          report.duration,
          report.report.lighthouseResult.categories.performance.score * 100,
          report.report.lighthouseResult.categories.accessibility.score * 100,
          report.report.lighthouseResult.categories["best-practices"].score * 100,
          report.report.lighthouseResult.categories.seo.score * 100,
        ].concat(LH_AUDIT_KEYS.map((k) => (audits[k]?.numericValue || audits[k]?.numericValue === 0) ? Math.round(audits[k]?.numericValue * 1000) / 1000 : 'N/A')));
        await workbook.workbook.xlsx.writeFile(path.join(outputFolder, argv.excelReport));
      }
    };
  }

  // execute preparation of the sections mapping
  return cliWorkerHandler('lighthouse_worker.js', {
    outputFolder,
    reportsFolder,
  }, argv, reporInExcelFn);
};
