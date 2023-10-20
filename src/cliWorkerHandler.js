const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { terminal } = require('terminal-kit');
const { Worker } = require('worker_threads');
const fp = require('find-free-port');
const { getLogger } = require('./logger');
const { readLines } = require('./cli');

const results = [];
let urls = [];

/*
 * Worker handlers
 */

async function workerMsgHandler(worker, workerOptions, port, workerId, onMessageFn, result) {
  // store the result
  const idx = results.findIndex((r) => r.url === result.url);
  if (idx > -1) {
    /* eslint-disable-next-line no-param-reassign */
    results[idx].status = result;
  }

  if (onMessageFn) {
    await onMessageFn(result);
  }

  // If there are more URLs, send one to the worker
  if (urls.length > 0) {
    const url = urls.shift();
    results.push({ url, status: null });
    worker.postMessage({
      idx: workerId,
      port,
      line: urls.length - urls.length,
      options: workerOptions,
      url,
    });
  } else {
    // If there are no more URLs, terminate the worker
    worker.postMessage({ type: 'exit' });
  }
}

function workerExitHandler(workers) {
  workers.shift();
}

/*
 * Main Handler for CLI commands with worker threads
 */

async function cliWorkerHandler(workerScriptFilename, workerOptions, argv, onMessageFn) {
  workerOptions = {
    ...workerOptions,
    argv,
  };

  let failedURLsFileStream;
  const logger = getLogger('importer cache - cliWorkerHandler', (argv.verbose !== undefined ? 'debug' : null));

  // set worker script
  const workerScript = path.join(__dirname, '../workers/', workerScriptFilename);

  // parse URLs
  if (argv.interactive) {
    urls = await readLines(argv.listBreaker);
  } else if (argv.file) {
    // Read the list of URLs from the file
    urls = fs.readFileSync(argv.file, 'utf-8').split('\n').filter(Boolean);
  } else {
    yargs.showHelp('log');
    terminal.yellow('Please specify either a file or interactive mode\n');
    process.exit(1);
  }

  if (argv.errorFile) {
    if (fs.existsSync(argv.errorFile)) {
      terminal.yellow(`[WARNING] Specified error file (${argv.errorFile}) already exists. Will overwrite.\n`);
      fs.truncateSync(argv.errorFile);
    }

    failedURLsFileStream = fs.createWriteStream(argv.errorFile);
  }

  // Array to keep track of the worker threads
  const workers = [];

  /*
  * Init workers
  */

  const numWorkers = Math.min(argv.workers, urls.length);
  const ports = await fp(9222, 9800, '127.0.0.1', numWorkers);

  terminal.green(`Processing ${urls.length} url(s) with ${numWorkers} worker(s)...\n`);

  // Start the workers
  Promise.all((new Array(numWorkers)).fill(1).map((_, idx) => new Promise((resolve) => {
    const w = idx * 2000;

    logger.debug(`[${new Date().toISOString()}] waiting ${w}ms for worker ${idx + 1} to start...`);

    setTimeout(() => {
      try {
        const url = urls.shift();
        if (url) {
          logger.debug(`[${new Date().toISOString()}] OK, starting worker ${idx + 1}...`);
          const worker = new Worker(workerScript, {
            workerData: {
              port: ports[idx],
              idx: idx + 1,
              workerOptions,
            },
          });
          workers.push(worker);
          // Handle worker exit
          worker.on('exit', workerExitHandler.bind(null, workers));
          // Listen for messages from the worker thread
          worker.on('message', workerMsgHandler.bind(null, worker, workerOptions, ports[idx], idx + 1, onMessageFn));

          results.push({ url, status: null });
          workers[idx].postMessage({
            idx: idx + 1,
            port: ports[idx],
            options: workerOptions,
            line: urls.length - urls.length,
            url,
          });
        } else {
          logger.debug(`[${new Date().toISOString()}] No new URLs to process, no need to start worker ${idx + 1}`);
        }
      } catch (e) {
        logger.error('starting worker', idx, e);
      } finally {
        resolve();
      }
    }, w);
  })));

  const mainPromise = new Promise((resolve) => {
    // Handle ordered output
    const interval = setInterval(() => {
      // console.log('display thread', results.length, results[0].status !== null);
      while (results.length > 0 && results[0].status !== null) {
        const result = results.shift();
        if (result.status.passed) {
          terminal(`${result.status.result === 'Skipped' ? ' ⏩' : ' ✅'} ${result.status.preMsg || ''}${result.url} ${result.status.postMsg || ''}\n`);
        } else {
          terminal(` ❌  ${result.url} - ^rError: ${result.status.result}^:\n`);

          if (failedURLsFileStream) {
            failedURLsFileStream.write(result.url);
          }
        }
      }

      if (workers.length === 0) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });

  return mainPromise;
}

/*
 * Exports
 */

exports.cliWorkerHandler = cliWorkerHandler;
