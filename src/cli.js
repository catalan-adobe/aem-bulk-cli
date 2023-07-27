const readline = require('readline');
const { terminal } = require('terminal-kit');

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

exports.readLines = readLines;
