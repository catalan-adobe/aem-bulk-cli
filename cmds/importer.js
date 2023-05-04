exports.command = 'importer <command>';
exports.desc = 'Commands related to Franklin Importer';
exports.builder = function (yargs) {
  return yargs.commandDir('importer')
}
exports.handler = function (argv) {}