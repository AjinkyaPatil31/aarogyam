/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Logging Framework  (Milestone 3.2 scaffold / 4.2 complete)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    THE single logging system for the application. Every infrastructure
 *    module obtains its own logger through createLogger() while sharing
 *    one buffered asynchronous backend (the log manager). No
 *    infrastructure module uses console.* directly — console output is
 *    produced only by this framework's console sink.
 *
 *  Levels:  TRACE < DEBUG < INFO < WARN < ERROR < FATAL (filterable).
 *
 *  Write pipeline (buffered, asynchronous, ordered):
 *    log.info(...) → normalise entry → FIFO buffer (bounded) → single
 *    drain loop takes ordered batches → console sink (human-readable,
 *    no stack) + file sink (JSONL with full structured metadata incl.
 *    stack). Enqueue is synchronous and cheap; disk I/O never blocks
 *    the caller. flush()/shutdown() guarantee buffered entries reach
 *    disk. Context is sanitized at entry creation (circular references
 *    never poison an entry), and when NO sink is enabled entries are
 *    dropped synchronously instead of buffering into a queue that
 *    would only drain to nowhere (bounded memory).
 *
 *  File logging:
 *    • append-only JSONL at <logsDir>/aarogyam.log
 *    • rotation by size (maxSize) with maxFiles retained files —
 *      completed entries are never lost (the active file is renamed
 *      aside before new entries are appended)
 *    • the log DIRECTORY is created by the installer only — the file
 *      sink never creates directories (missing dir → file sink disables
 *      itself with a console warning)
 *    • graceful recovery: a closed/stale handle reopens lazily on the
 *      next write (restart-safe)
 *
 *  Structured entry:
 *    { timestamp, level, module, service, message, context, error,
 *      stack, ... } — context is extensible.
 *
 *  Error handling:
 *    Error arguments (StorageError, LifecycleError, InstallerError, …)
 *    are normalized into `error` (name/message/code) + `stack`. Stack
 *    traces appear ONLY in the file sink — never in console output.
 *
 *  Lifecycle: getLogManager().initialize() → READY (sync, no I/O);
 *    flush() drains; shutdown() flushes + closes the file handle →
 *    STOPPED (a later write reopens lazily — graceful recovery).
 *
 *  Configuration (Milestone 3.1 system): the shared manager reads
 *    logging.level, logging.console.enabled, logging.file.enabled,
 *    logging.file.maxSize and logging.file.maxFiles via get(). The log
 *    directory comes from paths.logsDir (future.paths.logs /
 *    LOG_DIRECTORY). No process.env access, no duplicated values.
 *
 *  Dependencies:
 *    node:path, node:fs/promises, app/lib/config, app/lib/local/paths,
 *    app/lib/local/fsutil, app/lib/lifecycle. No cycles.
 */

import { join, dirname, basename } from 'node:path';
import { open, rename, rm, stat } from 'node:fs/promises';
import { get } from '../config/index.mjs';
import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { LIFECYCLE_STATES, createLifecycle } from '../lifecycle/index.mjs';

/** Numeric severity ordering. */
export const LOG_LEVELS = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
});

/** Canonical level names, in ascending severity. */
export const LOG_LEVEL_NAMES = Object.freeze(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

const BATCH_MAX = 64;

function levelValue(name) {
  return LOG_LEVELS[name] ?? LOG_LEVELS.info;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Serializable error metadata for structured entries. */
function errorMeta(err) {
  return {
    name: err?.name ?? 'Error',
    message: err?.message ?? String(err),
    code: err?.code ?? null,
  };
}

/**
 * Make arbitrary context JSON-safe at entry creation: circular references
 * (and functions/undefined) must never poison the structured entry. Scalar
 * own properties survive even when the object also carries circular refs.
 */
function sanitizeContext(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === null || (typeof v !== 'object' && typeof v !== 'function')) out[k] = v;
    }
    return out;
  }
}

/** Normalize the variadic arguments of a log call into an entry. */
function normalizeArgs(args) {
  const out = { message: '', context: null, error: null };
  const first = args[0];
  if (first instanceof Error) {
    out.error = first;
    out.message = first.message || first.name;
  } else if (typeof first === 'string') {
    out.message = first;
  } else if (first !== undefined) {
    out.message = typeof first === 'object' ? safeStringify(first) : String(first);
  }
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg instanceof Error && !out.error) {
      out.error = arg;
    } else if (arg && typeof arg === 'object' && !out.context) {
      out.context = arg;
    } else if (arg !== undefined) {
      if (!out.context) out.context = {};
      out.context[`arg${i}`] = arg;
    }
  }
  return out;
}

function makeEntry(moduleName, levelName, args, cfg) {
  const normalized = normalizeArgs(args);
  return {
    timestamp: new Date().toISOString(),
    level: levelName,
    module: moduleName,
    service: cfg.service,
    message: normalized.message,
    context: normalized.context ? sanitizeContext(normalized.context) : null,
    error: normalized.error ? errorMeta(normalized.error) : null,
    stack: normalized.error?.stack ?? null,
  };
}

/** Human-readable console line — never contains stack traces. */
function formatConsole(entry) {
  const parts = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${entry.module}]`,
    entry.message,
  ];
  if (entry.context && Object.keys(entry.context).length > 0) {
    parts.push(safeStringify(entry.context));
  }
  if (entry.error) {
    parts.push(`(${entry.error.name}: ${entry.error.message})`);
  }
  return parts.join(' ');
}

function consoleWrite(entry) {
  const line = formatConsole(entry);
  if (entry.level === 'warn') console.warn(line);
  else if (entry.level === 'error' || entry.level === 'fatal') console.error(line);
  else if (entry.level === 'trace' || entry.level === 'debug') console.debug(line);
  else console.info(line);
}

/**
 * Create a log manager — the shared backend owning the buffer, the
 * console sink, the rotating file sink and the lifecycle.
 * @param {object} [options]
 * @param {string} [options.level='info'] minimum emitted level
 * @param {{ enabled?: boolean }} [options.console]
 * @param {{ enabled?: boolean, dir?: string, filename?: string,
 *           maxSize?: number, maxFiles?: number }} [options.file]
 * @param {string} [options.service='aarogyam'] service name in entries
 * @param {number} [options.maxBufferEntries=4096] bounded buffer cap
 */
export function createLogManager(options = {}) {
  const cfg = {
    level: options.level ?? 'info',
    service: options.service ?? 'aarogyam',
    consoleEnabled: options.console?.enabled ?? true,
    fileEnabled: options.file?.enabled ?? false,
    fileDir: options.file?.dir ?? paths.logsDir,
    fileName: options.file?.filename ?? 'aarogyam.log',
    fileMaxSize: options.file?.maxSize ?? 1024 * 1024,
    fileMaxFiles: options.file?.maxFiles ?? 5,
  };
  const maxBufferEntries = options.maxBufferEntries ?? 4096;
  const lifecycle = createLifecycle(LIFECYCLE_STATES.UNINITIALIZED);

  const buffer = [];
  let dropped = 0;
  let written = 0;
  let fileErrors = 0;
  let drainRunning = false;
  let inflight = Promise.resolve();
  let fileHandle = null;
  let fileDisabled = false;
  let fileDisabledWarned = false;

  const filePath = () => join(cfg.fileDir, cfg.fileName);

  /** Shift rotated files: drop oldest, roll .1→.2 …, active → .1. */
  async function rotateFiles() {
    const current = filePath();
    await rm(`${current}.${cfg.fileMaxFiles - 1}`, { force: true }).catch(() => {});
    for (let i = cfg.fileMaxFiles - 2; i >= 1; i -= 1) {
      const from = `${current}.${i}`;
      await rename(from, `${current}.${i + 1}`).catch(() => {});
    }
    await rename(current, `${current}.1`).catch(() => {});
  }

  /** Open (or reopen) the append-only file handle lazily. Never creates
   *  directories — the installer owns the log directory. */
  async function ensureFileHandle() {
    if (fileHandle) return true;
    if (fileDisabled) return false;
    if (!(await fsutil.dirExists(cfg.fileDir))) {
      if (!fileDisabledWarned) {
        fileDisabledWarned = true;
        console.warn(
          `[logging] log directory missing (${cfg.fileDir}) — file logging disabled. ` +
            'Create the directory during installation.'
        );
      }
      fileDisabled = true;
      return false;
    }
    try {
      const current = filePath();
      const st = await stat(current).catch(() => null);
      if (st && st.size >= cfg.fileMaxSize) await rotateFiles();
      fileHandle = await open(filePath(), 'a');
      return true;
    } catch (err) {
      fileErrors += 1;
      fileDisabled = true;
      console.warn(`[logging] cannot open log file (${err.message}) — file logging disabled.`);
      return false;
    }
  }

  /** Per-entry file write (single append, ordered by the drain loop). */
  async function writeFileEntry(entry) {
    if (!(await ensureFileHandle())) return;
    try {
      // safeStringify: a circular context/error object must never throw
      // here — it would drop the entry and inflate fileErrors.
      await fileHandle.write(`${safeStringify(entry)}\n`);
    } catch (err) {
      fileErrors += 1;
      await fileHandle?.close().catch(() => {});
      fileHandle = null; // transient failure — reopen on the next write
    }
  }

  async function writeBatch(batch) {
    // Batch-level rotation check: if the active file crossed maxSize,
    // rotate before appending so completed entries are never lost.
    if (cfg.fileEnabled && fileHandle && batch.length > 0) {
      try {
        const st = await fileHandle.stat();
        if (st.size >= cfg.fileMaxSize) {
          await fileHandle.close();
          fileHandle = null;
          await rotateFiles();
          fileHandle = await open(filePath(), 'a');
        }
      } catch {
        /* rotation check is best-effort */
      }
    }
    for (const entry of batch) {
      if (cfg.consoleEnabled) consoleWrite(entry);
      if (cfg.fileEnabled) await writeFileEntry(entry);
      written += 1;
    }
  }

  function enqueue(entry) {
    buffer.push(entry);
    if (buffer.length > maxBufferEntries) {
      buffer.shift(); // bounded memory: drop the OLDEST when saturated
      dropped += 1;
    }
    scheduleDrain();
  }

  function scheduleDrain() {
    if (drainRunning) return;
    drainRunning = true;
    inflight = (async () => {
      try {
        while (buffer.length > 0) {
          const batch = buffer.splice(0, BATCH_MAX);
          await writeBatch(batch);
        }
      } finally {
        drainRunning = false;
      }
    })();
  }

  /** Resolve when the buffer is empty and no drain cycle is running. */
  async function flushImpl() {
    while (buffer.length > 0 || drainRunning) {
      await inflight.catch(() => {});
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  const manager = {
    /** Current minimum level name. */
    getLevel: () => cfg.level,
    /** Adjust the minimum level at runtime (config/test use). */
    setLevel(levelName) {
      if (LOG_LEVELS[levelName]) cfg.level = levelName;
      return manager;
    },
    getStats() {
      return {
        level: cfg.level,
        buffered: buffer.length,
        dropped,
        written,
        fileErrors,
        consoleEnabled: cfg.consoleEnabled,
        fileEnabled: cfg.fileEnabled && !fileDisabled,
        maxBufferEntries,
      };
    },

    // ── Lifecycle (req 7) ────────────────────────────────────────────
    getState: () => lifecycle.getState(),
    /** Synchronous, no I/O — prepares the manager state. */
    initialize() {
      if (lifecycle.getState() === LIFECYCLE_STATES.READY) return manager;
      lifecycle.transitionTo(LIFECYCLE_STATES.INITIALIZING);
      lifecycle.transitionTo(LIFECYCLE_STATES.READY);
      return manager;
    },
    /** Drain every buffered entry to the sinks. */
    async flush() {
      await flushImpl();
      return manager;
    },
    /** Flush + close the file handle, then STOPPED. A later write
     *  reopens lazily (graceful recovery). Safe from any state — an
     *  uninitialized manager goes straight to STOPPED. */
    async shutdown() {
      const state = lifecycle.getState();
      if (state === LIFECYCLE_STATES.STOPPED) return manager;
      if (state === LIFECYCLE_STATES.UNINITIALIZED) {
        lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
        return manager;
      }
      lifecycle.transitionTo(LIFECYCLE_STATES.STOPPING);
      await flushImpl();
      await fileHandle?.close().catch(() => {});
      fileHandle = null;
      lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
      return manager;
    },

    /** Backend entry point used by loggers (filter + enqueue). */
    emit(levelName, moduleName, args) {
      if (levelValue(levelName) < levelValue(cfg.level)) return;
      // No sink enabled — drop synchronously instead of buffering into a
      // queue that would only be drained to nowhere (bounded memory).
      if (!cfg.consoleEnabled && !cfg.fileEnabled) return;
      enqueue(makeEntry(moduleName, levelName, args, cfg));
    },
  };

  return manager;
}

/** Shared manager configured from the centralized configuration. */
let sharedManager = null;
export function getLogManager() {
  if (!sharedManager) {
    sharedManager = createLogManager({
      level: get('logging.level', 'info'),
      console: { enabled: get('logging.console.enabled', true) },
      file: {
        enabled: get('logging.file.enabled', false),
        dir: paths.logsDir,
        maxSize: get('logging.file.maxSize', 1024 * 1024),
        maxFiles: get('logging.file.maxFiles', 5),
      },
    });
  }
  return sharedManager;
}

/**
 * Create a named logger bound to a log manager (default: the shared
 * backend). `options.level` raises the per-logger threshold; all other
 * loggers in the hierarchy share the same backend.
 * @param {string} [name='aarogyam']
 * @param {{ level?: string, manager?: object }} [options]
 */
export function createLogger(name = 'aarogyam', options = {}) {
  const manager = options.manager ?? getLogManager();
  const overrideLevel = options.level ? levelValue(options.level) : null;

  const emit = (levelName, args) => {
    if (overrideLevel !== null && levelValue(levelName) < overrideLevel) return;
    manager.emit(levelName, name, args);
  };

  return {
    name,
    manager,
    trace: (...args) => emit('trace', args),
    debug: (...args) => emit('debug', args),
    info: (...args) => emit('info', args),
    warn: (...args) => emit('warn', args),
    error: (...args) => emit('error', args),
    fatal: (...args) => emit('fatal', args),
    /** Effective minimum level for this logger. */
    getLevel: () =>
      overrideLevel !== null
        ? LOG_LEVEL_NAMES.find((n) => LOG_LEVELS[n] === overrideLevel)
        : manager.getLevel(),
    /** Child logger — same backend, hierarchical module name. */
    child: (subName) =>
      createLogger(`${name}:${subName}`, {
        ...options,
        manager,
        level: overrideLevel !== null ? LOG_LEVEL_NAMES.find((n) => LOG_LEVELS[n] === overrideLevel) : undefined,
      }),
  };
}

/** Default logger — safe to use anywhere. */
export const logger = createLogger('aarogyam');

/** Compatibility wrapper (Milestone 3.2 API): file-only isolated logger. */
export function createFileLogger(name, filePath, options = {}) {
  const manager = createLogManager({
    level: options.level,
    service: name,
    console: { enabled: false },
    file: {
      enabled: true,
      dir: dirname(filePath),
      filename: basename(filePath),
    },
  });
  return createLogger(name, { manager });
}

/** Path of the default log file for file logging. */
export function defaultLogFilePath() {
  return paths.logsDir;
}

/** Convenience: flush the shared log manager (used by bootstrap). */
export async function flushLogs() {
  return getLogManager().flush();
}
