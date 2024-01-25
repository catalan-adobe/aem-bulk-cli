#!/usr/bin/env node

// imports
const fs = require('fs');
const path = require('path');
const yargs = require('yargs');
const { terminal } = require('terminal-kit');
const { readLines } = require('../../src/cli');

/*
 * CLI Command parameters
 */

function yargsBuilder(yargs) {
  return yargs
    .option('interactive', {
      alias: 'i',
      describe: 'Start the application in interactive mode, you will be prompted to copy/paste the list of URLs directly in the terminal. Enter an empty line to finish the process',
      type: 'boolean',
    })
    .option('file', {
      alias: 'f',
      describe: 'Path to a text file containing the list of URLs to deliver (urls pattern: "https://<branch>--<repo>--<owner>.hlx.page/<path>")',
      type: 'string',
    })
    .conflicts('f', 'i')
  // TODO: implement filtering ...
  // .option('simple-filter', {
  //   alias: 's',
  //   describe: 'Simple filter to apply to the URLs. Only URLs containing this string will be crawled',
  //   type: 'string',
  // })
    .option('output-file', {
      alias: 'o',
      describe: 'File where to save JSON statisticsthe',
      default: 'stats.json',
      type: 'string',
    });
}

/*
 * Main
 */

exports.desc = 'Collect blocks statistics for a list of URLs';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  const stats = {
    total: {
      blocks: {},
    },
    urls: [],
  };

  try {
    console.log('handler', argv);
    let urls;
    const errors = [];

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

    const queueResults = urls.map((url) => ({
      url,
      status: 'pending',
    }));
    console.log('urls', urls.length);

    /* eslint import/no-unresolved: "off" */
    const PQueue = (await import('p-queue')).default;

    /* eslint import/no-unresolved: "off" */
    const franklin = await import('franklin-bulk-shared');

    // validate simple filter
    // TODO: implement filtering ...
    const simpleFilter = argv.simpleFilter ? argv.simpleFilter : null;

    // create stream to save the list of discovered URLs
    const outputFile = path.isAbsolute(argv.outputFile)
      ? argv.outputFile
      : path.join(process.cwd(), argv.outputFile);

    // init work queue
    const queue = new PQueue({
      concurrency: 2, // hardcoded to 2 max for now
      autoStart: false,
    });

    // triggered each time a job is completed
    queue.on('completed', async (result) => {
      console.log('completed event', result);

      if (result.status === 'error') {
        errors.push(result);
      }

      queueResults.find((r) => r.url === result.url).status = result.status;
    });

    // concatenate errors and only display them at the end
    queue.on('error', (error) => {
      console.log('error event', error);
      errors.push(error);
    });

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        console.log('adding job', url);
        queue.add(async () => {
          try {
            console.log('running job', url);
            const blocks = await franklin.Stats.getBlocksStats(url);

            stats.urls.push({
              url,
              blocks,
            });
            console.log('job done', url);
            return {
              url,
              status: 'done',
            };
          } catch (e) {
            console.log('job failed', url, e);
            return {
              url,
              status: 'error',
              message: e.message,
            };
          }
        });
        console.log('job added', url);
      } catch (e) {
        // nothing
      }
    }

    // start processing queue
    queue.start();

    // wait for all jobs to be completed
    await new Promise((resolve) => {
      queue.on('idle', () => {
        const pendingRequests = queueResults.filter((r) => r.status === 'pending');
        if (pendingRequests.length === 0) {
          resolve();
        } else {
          console.log(`${pendingRequests.length} pending requests in the queue...`);
        }
      });
    });

    /*
     * aggregate blocks stats
     */

    stats.errors = errors;

    stats.urls.forEach((item) => {
      if (item.blocks) {
        Object.keys(item.blocks).forEach((block) => {
          if (!stats.total.blocks[block]) {
            stats.total.blocks[block] = 0;
          }
          stats.total.blocks[block] += item.blocks[block];
        });
      }
    });

    await fs.writeFileSync(outputFile, JSON.stringify(stats, null, 2));
  } catch (e) {
    terminal.red(`\n${e.message}\n`);
    throw new Error(`crawler failed: ${e.message}`);
  }
};
