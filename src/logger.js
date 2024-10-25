/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import winston, { createLogger, format, transports } from 'winston';

let LOGGER_INSTANCE = null;

const myCustomLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    silly: 4,
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    debug: 'blue',
    silly: 'grey',
  },
};

function formatLevel(level) {
  const padding = level.length <= 5 ? 5 : 15; // check if colored or not
  return level.padEnd(padding, ' ');
}

const DEFAULT_FORMAT = format.combine(
  format.colorize({
    all: true,
  }),
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss',
  }),
  format.printf((info) => `[${info.name}][${(formatLevel(info.level))}][${info.timestamp}] ${info.message}`),
);

const DEFAULT_LOGGER_OPTIONS = {
  levels: myCustomLevels.levels,
  level: 'info',
  format: DEFAULT_FORMAT,
  exitOnError: false,
};

winston.addColors(myCustomLevels.colors);

function setupLogger() {
  if (LOGGER_INSTANCE !== null && LOGGER_INSTANCE !== undefined) {
    return LOGGER_INSTANCE;
  }
  const localLogger = createLogger(DEFAULT_LOGGER_OPTIONS);
  // add console by default
  localLogger.add(new transports.Console());
  return localLogger;
}

export function getLogger(name, {
  level = null,
  file = null,
} = {}) {
  const l = LOGGER_INSTANCE.child({ name });

  if (file) {
    l.add(
      new transports.File({
        filename: file,
        level,
      }),
    );
  }
  if (level) {
    l.level = level;
    for (const transport of l.transports) {
      transport.level = level;
    }
    // l.transports.forEach((t) => { t.level = level; });
  }
  return l;
}

// init global logger
LOGGER_INSTANCE = setupLogger();
