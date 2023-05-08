const { createLogger, format, transports } = require('winston');

const { combine } = format;

let LOGGER_INSTANCE = null;

const DEFAULT_LOGGER_OPTIONS = {
  level: 'info',
  format: combine(
    format.printf((info) => `[${info.name}][${info.level}] ${info.message}`),
  ),
  exitOnError: false,
};

const setupLogger = () => {
  if (LOGGER_INSTANCE !== null && LOGGER_INSTANCE !== undefined) {
    return LOGGER_INSTANCE;
  }
  const localLogger = createLogger(DEFAULT_LOGGER_OPTIONS);
  return localLogger;
};

function getLogger(name, level = 'error') {
  const wl = LOGGER_INSTANCE.child({ name });
  wl.add(
    new transports.Console({ level }),
  );
  return wl;
}

function getWorkerLogger(workerId, level = 'debug') {
  const wl = LOGGER_INSTANCE.child({ workerId });
  wl.add(
    new transports.File({
      filename: `worker_${parseInt(workerId, 10) < 10 ? '0' : ''}${workerId}.log`,
      format: combine(
        format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        format.printf((info) => `[${info.workerId}][${info.level}][${info.timestamp}] ${info.message}`),
      ),
      level,
    }),
  );
  return wl;
}

LOGGER_INSTANCE = setupLogger();

exports.getWorkerLogger = getWorkerLogger;
exports.getLogger = getLogger;
