const { terminal } = require('terminal-kit');

// yargs options
function defaultCLICmdWithWorkerYargsBuilder(yargs) {
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
    .option('error-file', {
      alias: 'e',
      describe: 'Path to a text file that will contain the list of URLs that failed to process',
      type: 'string',
    })
    .conflicts('f', 'i')
    .option('workers', {
      alias: 'w',
      describe: 'Number of workers to use (max. 5)',
      type: 'number',
      default: 1,
      coerce: (value) => {
        if (value > 5) {
          terminal.yellow('Warning: Maximum number of workers is 5. Using 5 workers instead.\n');
          return 5;
        }
        return value;
      },
    })
    .help('h');
}

exports.defaultCLICmdWithWorkerYargsBuilder = defaultCLICmdWithWorkerYargsBuilder;
