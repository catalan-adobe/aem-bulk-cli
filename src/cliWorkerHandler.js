const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yargs = require('yargs');
const { terminal } = require('terminal-kit');
const { Worker } = require('worker_threads');
const fp = require('find-free-port');

const results = [];
let urls = [];

/*
 * Worker handlers
 */

function workerMsgHandler(worker, workerOptions, port, workerId, result) {
  console.log('RX MSG >>>', workerId);
  // store the result
  const idx = results.findIndex((r) => r.url === result.url);
  if (idx > -1) {
    /* eslint-disable-next-line no-param-reassign */
    results[idx].status = result;
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

async function readLines() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lines = [];

  terminal.brightBlue('Enter a list of URLs (urls pattern: "https://<branch>--<repo>--<owner>.hlx.page/<path>"). Enter an empty line to proceed:\n');

  /* eslint-disable-next-line no-restricted-syntax */
  for await (const input of rl) {
    if (input === '') {
      break;
    }
    lines.push(input);
  }

  rl.close();

  return lines;
}

/*
 * Main Handler for CLI commands with worker threads
 */

async function cliWorkerHandler(workerScriptFilename, workerOptions, argv) {
  let failedURLsFileStream;

  // set worker script
  const workerScript = path.join(__dirname, '../workers/', workerScriptFilename);

  // parse URLs
  if (argv.interactive) {
    urls = await readLines();
  } else if (argv.file) {
    // Read the list of URLs from the file
    urls = fs.readFileSync(argv.file, 'utf-8').split('\n').filter(Boolean);
  } else {
    yargs.showHelp('log');
    terminal.yellow('Please specify either a file or interactive mode\n');
    process.exit(1);
  }

  if (argv.errorFile) {
    if(fs.existsSync(argv.errorFile)){
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

  console.log('ports', ports);

  terminal.green(`Processing ${urls.length} url(s) with ${numWorkers} worker(s)...\n`);

  // Start the workers
  const importerLib = await import('franklin-bulk-shared');

  for (let i = 0; i < numWorkers; i += 1) {
    const worker = new Worker(workerScript, {
      workerData: {
        port: ports[i],
        idx: i + 1,
        workerOptions: workerOptions,
      },
    });
    workers.push(worker);
    // Handle worker exit
    worker.on('exit', workerExitHandler.bind(null, workers));
    // Listen for messages from the worker thread
    worker.on('message', workerMsgHandler.bind(null, worker, workerOptions, ports[i], i+1));
  }
  
  
  const mainPromise = new Promise((resolve) => {
    // Handle ordered output
    const interval = setInterval(() => {
      // console.log('display thread', results.length, results[0].status !== null);
      while (results.length > 0 && results[0].status !== null) {
        const result = results.shift();
        if (result.status.passed) {
          terminal(`${result.status.result === 'Skipped' ? '#SKIPPED# ⏩': '#PASSED# ✅'} ${result.status.preMsg || ''}${result.url} ${result.status.postMsg || ''}\n`);
        } else {
          terminal(`#FAILED# ❌  ${result.url} - ^rError: ${result.status.result}^:\n`);

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

  Promise.all(urls.splice(0, numWorkers).map(async (url, idx) => {
    return new Promise(async (resolve) => {
      const w = idx * 2500;

      results.push({ url, status: null });
      workers[idx].postMessage({
        idx: idx + 1,
        port: ports[idx],
        options: workerOptions,
        line: urls.length - urls.length,
        url,
      });
      await importerLib.Time.sleep(w);
      resolve();
    });
  }));

  // // Send a URL to each worker
  // for (let i = 0; i < numWorkers; i += 1) {
  //   const url = urls.shift();
  //   if (url) {
  //     results.push({ url, status: null });
  //     workers[i].postMessage({
  //       idx: i + 1,
  //       port: ports[i],
  //       options: workerOptions,
  //       argv,
  //       line: urls.length - urls.length,
  //       url,
  //     });
  //   } else {
  //     // If there are no more URLs, terminate the worker
  //     workers[i].postMessage({ type: 'exit' });
  //   }
  //   await importerLib.Time.sleep(2500);
  // }

  return mainPromise;
}

/*
 * Exports
 */

exports.cliWorkerHandler = cliWorkerHandler;
