const { createLogger, format, transports } = require("winston");
const { combine, timestamp, label, prettyPrint } = format;

let WORKER_LOGGER_INSTANCE;

const setupLogger = () => {
  if (WORKER_LOGGER_INSTANCE !== null && WORKER_LOGGER_INSTANCE !== undefined) {
    return WORKER_LOGGER_INSTANCE;
  }

  let local_logger = createLogger({
    level: "info",
    format: combine(
      // // format.colorize(),
      format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
      }),
      // label({ label: 'worker' }),
      // format.simple((info, opts) => {
      //   console.log(info);
      //   return info;
      // }),
      format.printf((info) => {
        // console.log(info);
        return `[${info.workerId}][${info.level}][${info.timestamp}] ${info.message}`;
      }),
      // format.splat(),
      // // timestamp(),
      // // prettyPrint(),
    ),
      exitOnError: false,
    transports: [
      new transports.File({ filename:  'workers.log', level: "debug"}),
    ],
  });
  return local_logger;
}

WORKER_LOGGER_INSTANCE = setupLogger();

exports.WORKER_LOGGER = WORKER_LOGGER_INSTANCE;
