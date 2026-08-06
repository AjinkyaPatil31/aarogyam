/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Storage Engine  (Milestone 3.2 scaffold / Milestone 4.1)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Complete, production-grade document storage for INFRASTRUCTURE data
 *    only: application settings, metadata, cache, installation data,
 *    runtime state and backup metadata. Business entities (patients,
 *    appointments, prescriptions, …) must NEVER use this engine —
 *    SQLite via Prisma remains the primary application database.
 *
 *  Design highlights
 *    • Namespaced document collections — each namespace is a directory
 *      of `<safeKey>.json` files; namespaces are fully isolated.
 *    • Document envelope — every document carries `{ $schema, version,
 *      namespace, key, savedAt, checksum, data }`. `version` is reserved
 *      for future compatibility (no migrations yet). `checksum` is a
 *      SHA-256 over the serialized data.
 *    • Atomic persistence — all writes go through a temp file + rename,
 *      so a crash can never leave a partially-written document.
 *    • Transactions — staged multi-write operations with commit /
 *      rollback; commit moves originals aside before applying, so a
 *      mid-commit failure is rolled back (no partial commits).
 *    • Concurrency — a FIFO write mutex serializes every mutation;
 *      the engine is safe when accessed by multiple services at once.
 *    • Caching — optional in-memory LRU, read-through + write-through
 *      (crash-safe), with invalidation and statistics.
 *    • Integrity validation — JSON format, version, schema markers and
 *      checksums are validated; structured `StorageError`s are raised.
 *    • Lifecycle — integrates with app/lib/lifecycle: initialize()
 *      transitions to READY, shutdown() drains pending writes, flushes
 *      and transitions to STOPPED.
 *    • Logging — every operation logs through app/lib/logging.
 *
 *  Transaction restrictions:
 *    • Inside a transaction callback use ONLY tx.set() / tx.remove().
 *      Calling the service-level set()/remove() while a transaction
 *      holds the write mutex raises a StorageError immediately — it
 *      would otherwise deadlock.
 *    • An abandoned transaction (never committed/rolled back) holds the
 *      write mutex; a stale-transaction warning is logged after
 *      TX_STALE_MS so a future service manager can recover.
 *
 *  Crash-atomicity honesty:
 *    • Single-document writes are crash-safe (temp file + atomic rename).
 *    • Multi-document transactions are EXCEPTION-safe (in-process
 *      failures roll back via backups) but NOT crash-atomic — a hard
 *      process kill between commit phase 1 and phase 3 can leave
 *      orphaned `.bak` artifacts. listKeys ignores non-.json files so
 *      nothing corrupt is served; the future journaling milestone
 *      closes this window.
 *
 *  Configuration (Milestone 3.1 system): the shared singleton reads
 *  `storage.cache.enabled` / `storage.cache.maxEntries` via get().
 *  Sandboxed instances pass options directly. No process.env access.
 *
 *  Dependencies:
 *    node:path, node:fs/promises, node:crypto, app/lib/local/paths,
 *    app/lib/local/fsutil, app/lib/local/errors, app/lib/lifecycle,
 *    app/lib/logging, app/lib/config (singleton cache settings only).
 */

import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { readdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { StorageError } from '../local/errors.mjs';
import { LIFECYCLE_STATES, createLifecycle } from '../lifecycle/index.mjs';
import { createLogger } from '../logging/index.mjs';
import { get } from '../config/index.mjs';

/** Canonical infrastructure namespaces (isolated top-level folders). */
export const NAMESPACES = Object.freeze([
  'settings',
  'cache',
  'metadata',
  'installation',
  'runtime',
  'backup',
]);

/** Current document envelope format version (future: migrations bump it). */
export const DOCUMENT_VERSION = 1;

/** Envelope marker used to distinguish engine documents from raw JSON. */
export const DOCUMENT_SCHEMA = 'aarogyam-doc';

/** Error codes raised by the engine. */
export const STORAGE_ERROR_CODES = Object.freeze([
  'invalid-json',
  'invalid-version',
  'missing-data',
  'invalid-value',
  'unsupported-version',
  'namespace-mismatch',
  'key-mismatch',
  'checksum-mismatch',
  'missing-document',
  'transaction-failed',
  'transaction-in-progress',
]);

/**
 * Build a StorageError, enforcing that `code` is a registered member of
 * STORAGE_ERROR_CODES — this prevents the constant from drifting from
 * the codes actually thrown by the engine.
 */
function storageError(code, message, ctx = {}) {
  if (!STORAGE_ERROR_CODES.includes(code)) {
    throw new Error(`[Aarogyam] internal: unregistered storage error code "${code}"`);
  }
  return new StorageError(code, message, ctx);
}

/** Milliseconds after which a held transaction is considered stale. */
export const TX_STALE_MS = 60_000;

function safeKey(value) {
  // Keys and namespace names become file names — strip path-hostile chars.
  return String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function checksumOf(data) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

/** Build a document envelope. Throws on undefined values (not JSON). */
function buildEnvelope(ns, key, value, version = DOCUMENT_VERSION) {
  if (value === undefined) {
    throw storageError('invalid-value', `Cannot store undefined at ${ns}/${key}`, { ns, key });
  }
  return {
    $schema: DOCUMENT_SCHEMA,
    version,
    namespace: ns,
    key,
    savedAt: new Date().toISOString(),
    checksum: checksumOf(value),
    data: value,
  };
}

/**
 * Parse + validate a raw document file. Returns the envelope, or for a
 * legacy raw-JSON document (written before Milestone 4.1) a synthetic
 * version-0 envelope. Throws StorageError with a structured code.
 */
function parseDocument(raw, ns, key) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StorageError('invalid-json', `Document ${ns}/${key} is not valid JSON`, { ns, key });
  }

  if (parsed && typeof parsed === 'object' && parsed.$schema === DOCUMENT_SCHEMA) {
    if (!Number.isInteger(parsed.version) || parsed.version < 1) {
      throw storageError('invalid-version', `Document ${ns}/${key} has an invalid version`, { ns, key });
    }
    if (!('data' in parsed)) {
      throw storageError('missing-data', `Document ${ns}/${key} is missing the data field`, { ns, key });
    }
    if (parsed.namespace !== ns) {
      throw storageError('namespace-mismatch', `Document ${ns}/${key} declares namespace "${parsed.namespace}"`, { ns, key });
    }
    if (parsed.key !== key) {
      throw storageError('key-mismatch', `Document ${ns}/${key} declares key "${parsed.key}"`, { ns, key });
    }
    const expected = checksumOf(parsed.data);
    if (parsed.checksum && expected !== parsed.checksum) {
      throw storageError('checksum-mismatch', `Document ${ns}/${key} failed checksum verification`, { ns, key });
    }
    return parsed;
  }

  // Legacy document — raw JSON without an envelope (pre-4.1). Version 0.
  return {
    $schema: DOCUMENT_SCHEMA,
    version: 0,
    namespace: ns,
    key,
    savedAt: null,
    checksum: null,
    data: parsed,
    legacy: true,
  };
}

/**
 * Create a storage service rooted at a data directory.
 * @param {string} [rootDir=paths.dataDir]
 * @param {object} [options]
 * @param {{ enabled?: boolean, maxEntries?: number }} [options.cache]
 */
export function createStorageService(rootDir = paths.dataDir, options = {}) {
  const log = createLogger('storage');
  const lifecycle = createLifecycle(LIFECYCLE_STATES.UNINITIALIZED);

  const cacheEnabled = options.cache?.enabled ?? true;
  const cacheMaxEntries = options.cache?.maxEntries ?? 100;

  // ── In-memory LRU cache (read-through + write-through) ────────────
  const cacheMap = new Map(); // cacheKey (`ns/key`) → { envelope, value }
  const cacheStats = { hits: 0, misses: 0, evictions: 0 };
  const cacheKey = (ns, key) => `${ns}/${key}`;
  function cacheSet(ns, key, envelope) {
    if (!cacheEnabled) return;
    cacheMap.set(cacheKey(ns, key), { envelope, value: envelope.data });
    if (cacheMap.size > cacheMaxEntries) {
      const oldest = cacheMap.keys().next().value;
      cacheMap.delete(oldest);
      cacheStats.evictions += 1;
    }
  }
  function cacheGet(ns, key) {
    if (!cacheEnabled) return undefined;
    const k = cacheKey(ns, key);
    const hit = cacheMap.get(k);
    if (hit === undefined) {
      cacheStats.misses += 1;
      return undefined;
    }
    // Refresh recency (LRU).
    cacheMap.delete(k);
    cacheMap.set(k, hit);
    cacheStats.hits += 1;
    return hit;
  }
  function cacheDelete(ns, key) {
    cacheMap.delete(cacheKey(ns, key));
  }

  // ── FIFO write mutex ───────────────────────────────────────────────
  let lockTail = Promise.resolve();
  let activeWrites = 0;
  let queuedWrites = 0;
  // Transaction bookkeeping for re-entrancy guard + stale detection.
  let txDepth = 0;
  let txHeldAt = 0;
  let txStaleWarned = false;
  async function acquire() {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const prev = lockTail;
    lockTail = prev.then(() => gate);
    queuedWrites += 1;
    if (txDepth > 0 && Date.now() - txHeldAt > TX_STALE_MS && !txStaleWarned) {
      txStaleWarned = true;
      log.error(`A transaction has held the storage write lock for over ${TX_STALE_MS}ms — it may be abandoned`);
    }
    await prev;
    queuedWrites -= 1;
    activeWrites += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeWrites -= 1;
      release();
    };
  }
  async function withLock(fn) {
    // Re-entrancy guard: a transaction already holds the mutex, so a
    // service-level mutation here would deadlock — fail fast instead.
    if (txDepth > 0) {
      throw storageError(
        'transaction-in-progress',
        'Service-level set/remove cannot run inside a transaction — use tx.set / tx.remove'
      );
    }
    const release = await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  const namespaceDir = (ns) => join(rootDir, safeKey(ns));

  const service = {
    rootDir,
    namespaces: [...NAMESPACES],
    /** True when the root data directory exists. */
    async exists() {
      return fsutil.dirExists(rootDir);
    },
    /** Path of a namespaced document (does not create it). */
    pathFor(ns, key) {
      return join(namespaceDir(ns), `${safeKey(key)}.json`);
    },
    /** Number of writes queued or in flight (accurate count). */
    getWritesPending() {
      return queuedWrites + activeWrites;
    },

    // ── Lifecycle (Milestone 4.1, req 9) ─────────────────────────────
    getState: () => lifecycle.getState(),
    /** Prepare in-memory state. Synchronous — performs no I/O. */
    initialize() {
      if (lifecycle.getState() === LIFECYCLE_STATES.READY) return service;
      lifecycle.transitionTo(LIFECYCLE_STATES.INITIALIZING);
      cacheMap.clear();
      lifecycle.transitionTo(LIFECYCLE_STATES.READY);
      log.info('Storage initialized', { rootDir, cacheEnabled });
      return service;
    },
    /**
     * Graceful shutdown: drain all pending writes (acquire the mutex),
     * flush (write-through — disk is already current), drop the cache,
     * transition to STOPPED.
     */
    async shutdown() {
      if (lifecycle.getState() === LIFECYCLE_STATES.STOPPED) return service;
      lifecycle.transitionTo(LIFECYCLE_STATES.STOPPING);
      const release = await acquire(); // waits for queued writes to finish
      release();
      cacheMap.clear();
      lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
      log.info('Storage shutdown complete');
      return service;
    },

    // ── Document reads ───────────────────────────────────────────────
    /**
     * Read a document's data. Lenient: returns `fallback` when the
     * document is missing OR fails integrity validation (corruption is
     * logged and never served).
     */
    async get(ns, key, fallback = null) {
      const cached = cacheGet(ns, key);
      if (cached !== undefined) return cached.value;
      let raw;
      try {
        raw = await readFile(service.pathFor(ns, key), 'utf8');
      } catch {
        return fallback;
      }
      try {
        const envelope = parseDocument(raw, ns, key);
        if (envelope.version > DOCUMENT_VERSION) {
          log.warn(`Document ${ns}/${key} has unsupported version ${envelope.version} — reading anyway`);
        }
        cacheSet(ns, key, envelope);
        return envelope.data;
      } catch (err) {
        if (err instanceof StorageError) {
          log.error(`Document ${ns}/${key} failed validation (${err.code}) — returning fallback`);
        }
        return fallback;
      }
    },

    /**
     * Strict read: returns the document data or throws a structured
     * StorageError ('missing-document', 'invalid-json', …).
     */
    async getStrict(ns, key) {
      const doc = await service.readDocument(ns, key);
      return doc.data;
    },

    /**
     * Read the full document envelope. Returns null when missing;
     * throws StorageError when the document is corrupt.
     */
    async readDocument(ns, key) {
      const cached = cacheGet(ns, key);
      if (cached !== undefined) return cached.envelope;
      let raw;
      try {
        raw = await readFile(service.pathFor(ns, key), 'utf8');
      } catch {
        return null;
      }
      const envelope = parseDocument(raw, ns, key);
      cacheSet(ns, key, envelope);
      return envelope;
    },

    /** True when the document exists. */
    async has(ns, key) {
      return fsutil.fileExists(service.pathFor(ns, key));
    },

    // ── Document writes ──────────────────────────────────────────────
    /**
     * Write a document atomically (temp file + rename) inside the write
     * mutex. `options.version` overrides the envelope version (reserved
     * for future migrations).
     */
    async set(ns, key, value, options = {}) {
      return withLock(async () => {
        const envelope = buildEnvelope(ns, key, value, options.version ?? DOCUMENT_VERSION);
        await fsutil.atomicWriteFile(service.pathFor(ns, key), JSON.stringify(envelope, null, 2));
        cacheSet(ns, key, envelope);
        log.debug(`set ${ns}/${key} v${envelope.version}`);
        return value;
      });
    },

    /** Delete a document (missing documents are fine). */
    async remove(ns, key) {
      return withLock(async () => {
        await fsutil.removeRecursive(service.pathFor(ns, key));
        cacheDelete(ns, key);
        log.debug(`remove ${ns}/${key}`);
      });
    },

    /** List document keys inside a namespace (files ending in .json). */
    async listKeys(ns) {
      try {
        const entries = await readdir(namespaceDir(ns), { withFileTypes: true });
        return entries
          .filter((e) => e.isFile() && e.name.endsWith('.json'))
          .map((e) => e.name.replace(/\.json$/, ''));
      } catch {
        return [];
      }
    },

    /** Remove an entire namespace folder. */
    async removeNamespace(ns) {
      return withLock(async () => {
        await fsutil.removeRecursive(namespaceDir(ns));
        for (const k of [...cacheMap.keys()]) {
          if (k.startsWith(`${ns}/`)) cacheMap.delete(k);
        }
        log.debug(`removeNamespace ${ns}`);
      });
    },

    // ── Integrity validation (req 5) ─────────────────────────────────
    /**
     * Validate a single document. Returns structured diagnostics
     * { ns, key, ok, code?, detail? } — never throws.
     */
    async verifyDocument(ns, key) {
      const target = service.pathFor(ns, key);
      if (!(await fsutil.fileExists(target))) {
        return { ns, key, ok: false, code: 'missing-document', detail: 'file not found' };
      }
      try {
        const raw = await readFile(target, 'utf8');
        const envelope = parseDocument(raw, ns, key);
        if (envelope.version > DOCUMENT_VERSION) {
          return {
            ns,
            key,
            ok: false,
            code: 'unsupported-version',
            detail: `document version ${envelope.version} > supported ${DOCUMENT_VERSION}`,
          };
        }
        return {
          ns,
          key,
          ok: true,
          version: envelope.version,
          legacy: envelope.legacy === true,
          detail: 'valid',
        };
      } catch (err) {
        if (err instanceof StorageError) {
          return { ns, key, ok: false, code: err.code, detail: err.message };
        }
        return { ns, key, ok: false, code: 'unknown', detail: err.message };
      }
    },

    /**
     * Verify every document in every namespace. Returns
     * { ok, checked, errors: [...] } — never throws.
     */
    async verify() {
      const errors = [];
      let checked = 0;
      for (const ns of service.namespaces) {
        const keys = await service.listKeys(ns);
        for (const key of keys) {
          checked += 1;
          const result = await service.verifyDocument(ns, key);
          if (!result.ok) errors.push(result);
        }
      }
      return { ok: errors.length === 0, checked, errors };
    },

    // ── Cache control (req 7) ────────────────────────────────────────
    cache: {
      get enabled() {
        return cacheEnabled;
      },
      /** Snapshot of cache statistics. */
      getStats() {
        return { ...cacheStats, entries: cacheMap.size, maxEntries: cacheMaxEntries, enabled: cacheEnabled };
      },
      /** Drop one entry from the in-memory cache (disk is untouched). */
      invalidate(ns, key) {
        cacheDelete(ns, key);
        return service;
      },
      /** Drop every entry of a namespace from the cache. */
      invalidateNamespace(ns) {
        for (const k of [...cacheMap.keys()]) {
          if (k.startsWith(`${ns}/`)) cacheMap.delete(k);
        }
        return service;
      },
      /** Drop the whole in-memory cache. */
      clear() {
        cacheMap.clear();
        return service;
      },
    },

    // ── Transactions (req 4) ─────────────────────────────────────────
    /**
     * Begin a transaction. The write mutex is held until commit() or
     * rollback() (or transaction() completes). Returns a handle:
     *   const tx = await storage.begin();
     *   await tx.set('settings', 'a', 1);   // staged (temp file written)
     *   await tx.remove('cache', 'b');      // staged
     *   await tx.commit();                  // atomically apply all
     */
    async begin() {
      const release = await acquire();
      txDepth += 1;
      txHeldAt = Date.now();
      txStaleWarned = false;
      const ops = []; // { type:'set'|'remove', ns, key, target, tempFile?, envelope? }
      const endTx = () => {
        txDepth = Math.max(0, txDepth - 1);
      };

      const tempPathFor = (target, index) =>
        join(dirname(target), `.tx-${basename(target)}.${process.pid}.${index}.tmp`);

      const tx = {
        set: async (ns, key, value, options = {}) => {
          const target = service.pathFor(ns, key);
          const envelope = buildEnvelope(ns, key, value, options.version ?? DOCUMENT_VERSION);
          const tempFile = tempPathFor(target, ops.length);
          await fsutil.ensureDir(dirname(tempFile)); // namespace dir may not exist yet
          await writeFile(tempFile, JSON.stringify(envelope, null, 2));
          ops.push({ type: 'set', ns, key, target, tempFile, envelope });
          return value;
        },
        remove: async (ns, key) => {
          ops.push({ type: 'remove', ns, key, target: service.pathFor(ns, key) });
        },
        /**
         * Apply all staged operations. Existing targets are moved aside
         * first (backups), then new documents are renamed into place; on
         * any failure the originals are restored — no partial commits.
         */
        commit: async () => {
          let backups = [];
          let applied = [];
          try {
            // Phase 1 — move existing targets aside as backups.
            for (let i = 0; i < ops.length; i += 1) {
              const op = ops[i];
              if (await fsutil.fileExists(op.target)) {
                const bak = `${op.target}.bak-${process.pid}-${Date.now()}-${i}`;
                await rename(op.target, bak);
                backups.push({ target: op.target, bak });
              }
            }
            // Phase 2 — apply operations, tracking exactly what applied.
            for (const op of ops) {
              if (op.type === 'set') {
                await rename(op.tempFile, op.target);
                applied.push(op);
              } else {
                await rm(op.target, { force: true });
                applied.push(op);
              }
            }
            // Phase 3 — commit point: drop backups (best effort).
            for (const b of backups) {
              await fsutil.removeRecursive(b.bak).catch(() => {});
            }
            backups = []; // backups already dropped — nothing to restore
            // Keep the cache consistent.
            for (const op of ops) {
              if (op.type === 'set') cacheSet(op.ns, op.key, op.envelope);
              else cacheDelete(op.ns, op.key);
            }
            log.debug(`transaction committed (${ops.length} ops)`);
          } catch (err) {
            // Phase 4 — rollback: restore originals, undo only applied ops.
            for (const b of [...backups].reverse()) {
              await rename(b.bak, b.target).catch(() => {});
            }
            for (const op of applied) {
              if (op.type === 'set' && !backups.some((b) => b.target === op.target)) {
                // Freshly-created target with no original — remove it.
                await fsutil.removeRecursive(op.target).catch(() => {});
              }
              if (op.tempFile) await rm(op.tempFile, { force: true }).catch(() => {});
            }
            throw storageError('transaction-failed', `commit failed: ${err.message}`);
          } finally {
            endTx();
            release();
          }
        },
        /** Discard every staged operation. Nothing has been applied. */
        rollback: async () => {
          try {
            for (const op of ops) {
              if (op.tempFile) await rm(op.tempFile, { force: true }).catch(() => {});
            }
            log.debug(`transaction rolled back (${ops.length} ops)`);
          } finally {
            endTx();
            release();
          }
        },
      };
      return tx;
    },

    /**
     * Convenience transaction: runs `fn(tx)`, commits on success,
     * rolls back and rethrows on failure.
     */
    async transaction(fn) {
      const tx = await service.begin();
      try {
        const result = await fn(tx);
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback().catch(() => {});
        throw err;
      }
    },
  };

  return service;
}

/** Shared default instance rooted at the configured data directory. */
export const storage = createStorageService(paths.dataDir, {
  cache: {
    enabled: get('storage.cache.enabled', true),
    maxEntries: get('storage.cache.maxEntries', 100),
  },
});
