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
    .option('output-file', {
      alias: 'o',
      describe: 'File where to save JSON statisticsthe',
      default: 'text-search-results.json',
      type: 'string',
    })
    .option('search-text', {
      alias: 't',
      describe: 'Text to search for',
      type: 'string',
    })
    .option('workers', {
      alias: 'w',
      describe: 'Number of workers to use (max. 20)',
      type: 'number',
      default: 10,
      coerce: (value) => {
        if (value > 20) {
          terminal.yellow('Warning: Maximum number of workers is 20. Using 20 workers instead.\n');
          return 20;
        }
        return value;
      },
    })
    .demand('search-text');
}

/*
 * Main
 */

exports.desc = 'Search for a text in given list of URLs';
exports.builder = yargsBuilder;
exports.handler = async (argv) => {
  const results = [];

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

    const got = (await import('got')).default;

    // /* eslint import/no-unresolved: "off" */
    // const franklin = await import('franklin-bulk-shared');

    // // validate simple filter
    // // TODO: implement filtering ...
    // const simpleFilter = argv.simpleFilter ? argv.simpleFilter : null;

    // create stream to save the list of discovered URLs
    const outputFile = path.isAbsolute(argv.outputFile)
      ? argv.outputFile
      : path.join(process.cwd(), argv.outputFile);
    resultsFileStream = fs.createWriteStream(`${outputFile}.stream`);

    // init work queue
    const queue = new PQueue({
      concurrency: argv.workers, // hardcoded to 2 max for now
      autoStart: false,
    });

    // triggered each time a job is completed
    queue.on('completed', async (result) => {
      console.log('completed event', result);

      resultsFileStream.write(JSON.stringify(result.result, null, 2));
      resultsFileStream.write('\n');

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

            const response = await got(url, {
              timeout: {
                request: 10000,
              },
            });

            if (!response.ok) {
              throw new Error(`Request ${url} failed with status ${response.status}`);
            }
            // const blocks = await franklin.Stats.getBlocksStats(url);

            // console.log('response', response);
            const content = response.body;

            const found = content.includes(argv.searchText);

            const matches = [];

            if (found) {
              const regex = new RegExp(`(${argv.searchText})`, 'gmi');
              let m;
              while ((m = regex.exec(response.body)) !== null) {
                // This is necessary to avoid infinite loops with zero-width matches
                if (m.index === regex.lastIndex) {
                  regex.lastIndex++;
                }

                const excerpt = content.slice(Math.max(0, m.index - 100), Math.min(content.length, m.index + 100));
                matches.push(excerpt);
                // console.log(m);
                // // The result can be accessed through the `m`-variable.
                // m.forEach((match, groupIndex) => {
                //     console.log(`Found match, group ${groupIndex}: ${match}`);
                // });
              }
            }

            const result = {
              url,
              text: argv.searchText,
              found,
              matches,
              error: null,
            };

            results.push(result);

            console.log('job done', url);

            return {
              url,
              status: 'done',
              result,
            };
          } catch (e) {
            console.log('job failed', url, e);
            const result = {
              url,
              text: '',
              found: false,
              matches: null,
              error: e.message,
            };
            results.push(result);
            return {
              url,
              status: 'error',
              message: e.message,
              result,
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

    await fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  } catch (e) {
    terminal.red(`\n${e.message}\n`);
    throw new Error(`crawler failed: ${e.message}`);
  }
};
