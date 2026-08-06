/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Logging Framework  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Reusable logging layer supporting info / warning / error / debug
 *    with configurable levels. Existing application code is NOT wired
 *    to this logger yet (no application-wide replacement — Milestone
 *    3.2 constraint).
 *
 *  Supports:
 *    • console logging (default)
 *    • future file logging via createFileLogger (architecture only —
 *      no file is opened unless explicitly requested)
 *    • configurable log level via LOG_LEVEL / future.logging.level
 *
 *  Future purpose:
 *    Service manager and installer milestones will adopt this logger;
 *    file logging can be enabled by passing a file path explicitly.
 *
 *  Dependencies: app/lib/config (level), app/lib/local/paths (log dir).
 */

import { get } from '../config/index.mjs';
import { paths } from '../local/paths.mjs';

/** Numeric severity ordering. */
export const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const LEVEL_NAMES = Object.freeze(['debug', 'info', 'warn', 'error']);

/** Resolve a level name to a numeric value, defaulting to config. */
function levelValue(name) {
  return LOG_LEVELS[name] ?? LOG_LEVELS[get('future.logging.level', 'info')];
}

function format(level, name, args) {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) =>
      typeof arg === 'string'
        ? arg
        : arg instanceof Error
          ? arg.stack || arg.message
          : JSON.stringify(arg)
    )
    .join(' ');
  return `[${timestamp}] [${level.toUpperCase()}] [${name}] ${message}`;
}

/**
 * Create a named logger.
 * @param {string} [name='aarogyam']  logger name shown in every line
 * @param {{ level?: string, filePath?: string }} [options]
 *   level     minimum level to emit (debug|info|warn|error)
 *   filePath  optional — when provided, lines are ALSO appended to this
 *             file (future file logging). No file is created unless
 *             explicitly passed.
 */
export function createLogger(name = 'aarogyam', options = {}) {
  const level = levelValue(options.level);

  const emit = (levelName, args) => {
    if (levelValue(levelName) < level) return;
    const line = format(levelName, name, args);
    if (levelName === 'error') console.error(line);
    else if (levelName === 'warn') console.warn(line);
    else console.log(line);
    if (options.filePath) appendToFile(options.filePath, line);
  };

  return {
    name,
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    /** Current minimum level name. */
    getLevel: () =>
      LEVEL_NAMES.find((n) => LOG_LEVELS[n] === level) ?? 'info',
  };
}

/** Default logger — safe to use anywhere; console-only by default. */
export const logger = createLogger('aarogyam');

/** Async append (fire-and-forget, best effort). */
async function appendToFile(filePath, line) {
  try {
    const { promises: fsp } = await import('node:fs');
    await fsp.appendFile(filePath, line + '\n');
  } catch {
    /* logging must never crash the caller */
  }
}

/**
 * Create a file-backed logger (future file logging).
 * Explicit opt-in: opens nothing until a line is written.
 */
export function createFileLogger(name, filePath, options = {}) {
  return createLogger(name, { ...options, filePath });
}

/** Path of the default log file for future file logging. */
export function defaultLogFilePath() {
  return paths.logsDir;
}
