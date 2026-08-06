/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Framework  (Milestone 3.2 scaffold → 4.3 complete)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Production-grade backup framework protecting ALL application data:
 *      • sqlite    — the application database (Prisma sqlite.db)
 *      • storage   — infrastructure storage engine documents
 *      • settings  — application settings
 *      • exports   — generated export data
 *    Each provider is independently replaceable (app/lib/backup/providers).
 *
 *  What the manager provides:
 *    • manual backups     — backup({ trigger }) runs every provider into
 *                           <backup.directory>/<id>/ with a manifest
 *    • progress reporting — optional onProgress callback + status()
 *    • cancellation       — cancel() cooperatively aborts the run
 *    • retention          — backup.retention.maxBackups prunes the oldest
 *    • restore            — validate / dry-run / full / provider restore
 *                           with rollback (app/lib/backup/restore)
 *    • integrity          — verify(id) structured diagnostics
 *    • scheduling         — scheduler infrastructure exists but remains
 *                           DISABLED (backup.schedule.enabled=false); only
 *                           manual execution is exposed (requirement 2)
 *    • concurrency        — one backup at a time; no restore during a
 *                           backup; no concurrent restores — structured
 *                           BackupError('busy') otherwise
 *    • lifecycle          — initialize() → READY, shutdown() safely stops
 *                           or finishes backup work → STOPPED
 *    • metadata           — backup registry persisted through the Storage
 *                           Engine ('backup' namespace); the manifest on
 *                           disk stays the single source of truth, the
 *                           registry stores an index only (no duplication)
 *
 *  Configuration flows exclusively through config.get() (backup.enabled,
 *  backup.directory, backup.compression.enabled, backup.retention.maxBackups,
 *  backup.schedule.*) — no process.env access, no duplicated values.
 *  Every significant operation logs through the logging framework.
 *
 *  Directory layout (extension point — format is versioned):
 *    <backup.directory>/
 *      <id>/                     e.g. 20260807T103000Z-3f2a9b1c
 *        manifest.json           format, metadata, provider outputs,
 *                                per-file sha256 checksums, versions
 *        sqlite/aarogyam.sqlite[.gz]
 *        settings/<doc>.json[.gz]
 *        storage/<ns>/<doc>.json[.gz]
 *        exports/<tree>[.gz]
 *
 *  Dependencies: node:path, node:crypto, node:fs/promises,
 *    app/lib/config, app/lib/local/paths, app/lib/local/fsutil,
 *    app/lib/lifecycle, app/lib/logging, app/lib/storage,
 *    app/lib/installer, app/lib/system, app/lib/backup/*. No cycles.
 */

import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { get } from '../config/index.mjs';
import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { LIFECYCLE_STATES, createLifecycle } from '../lifecycle/index.mjs';
import { createLogger } from '../logging/index.mjs';
import { storage as defaultStorage } from '../storage/index.mjs';
import { METADATA_SCHEMA_VERSION, readAppVersion } from '../installer/index.mjs';
import { getPlatform, getArch, getHostname } from '../system/index.mjs';
import { BackupError, isBackupError, backupError } from './errors.mjs';
import {
  MANIFEST_FILE_NAME,
  BACKUP_ID_PATTERN,
  makeBackupId,
  buildManifest,
  parseManifest,
} from './format.mjs';
import { compressFile } from './compression.mjs';
import {
  createSqliteBackupProvider,
  createStorageBackupProvider,
  createSettingsBackupProvider,
  createExportProvider,
} from './providers.mjs';
import { verifyBackup } from './verify.mjs';
import { createRestoreEngine } from './restore.mjs';
import { createBackupScheduler } from './schedule.mjs';

export { BACKUP_ERROR_CODES, BackupError, RestoreError, isBackupError } from './errors.mjs';
export {
  BACKUP_FORMAT_VERSION,
  MANIFEST_FILE_NAME,
  MANIFEST_SCHEMA,
  makeBackupId,
  buildManifest,
  parseManifest,
  validateManifestShape,
} from './format.mjs';
export { COMPRESSION_ALGORITHMS } from './compression.mjs';
export {
  STORAGE_NAMESPACES,
  createSqliteBackupProvider,
  createStorageBackupProvider,
  createSettingsBackupProvider,
  createExportProvider,
} from './providers.mjs';
export { verifyBackup } from './verify.mjs';
export { createRestoreEngine } from './restore.mjs';
export { createBackupScheduler } from './schedule.mjs';

/** Canonical provider types protected by the framework. */
export const BACKUP_TYPES = Object.freeze(['sqlite', 'storage', 'settings', 'exports']);

/** Milliseconds the shutdown routine waits for a running backup. */
export const SHUTDOWN_GRACE_MS = 30_000;

/** Small async sleep (module-local; keeps the manager dependency-free). */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create the backup manager.
 * @param {object} [options]
 * @param {boolean} [options.enabled]           backup.enabled
 * @param {string}  [options.directory]         backup.directory (backup root)
 * @param {object}  [options.compression]       { enabled } — backup.compression.enabled
 * @param {object}  [options.retention]         { maxBackups } — backup.retention.maxBackups
 * @param {object}  [options.schedule]          { enabled, intervalSeconds } — backup.schedule.*
 * @param {object}  [options.storage]           storage service for the backup registry
 * @param {object}  [options.sqlite]            sqlite provider options ({ databaseFile })
 * @param {object}  [options.storageProvider]   storage provider options ({ rootDir })
 * @param {object}  [options.settings]          settings provider options ({ settingsDir })
 * @param {object}  [options.exports]           exports provider options ({ exportDir })
 * @param {string}  [options.appVersion]        override (default: package.json)
 * @param {string}  [options.schemaVersion]     override (default: METADATA_SCHEMA_VERSION)
 */
export function createBackupManager(options = {}) {
  const log = createLogger('backup');
  const lifecycle = createLifecycle(LIFECYCLE_STATES.UNINITIALIZED);

  const cfg = {
    enabled: options.enabled ?? get('backup.enabled', true),
    directory: options.directory ?? paths.backupsDir,
    compression: options.compression?.enabled ?? get('backup.compression.enabled', false),
    retention: options.retention?.maxBackups ?? get('backup.retention.maxBackups', 20),
    schedule: {
      enabled: options.schedule?.enabled ?? get('backup.schedule.enabled', false),
      intervalSeconds:
        options.schedule?.intervalSeconds ?? get('backup.schedule.intervalSeconds', 86400),
    },
  };
  if (!Number.isInteger(cfg.retention) || cfg.retention < 1) {
    throw new TypeError('backup.retention.maxBackups must be a positive integer');
  }

  const storageService = options.storage ?? defaultStorage;
  const providers = new Map();
  // Active backup run. `cancelToken` is owned by that run — a stale run
  // can never observe the cancellation state of a later run.
  let running = null; // { id, startedAt, stage, progress, cancelToken, promise? }
  let restoreActive = false;
  let schedule = null;
  let restoreEngine = null;
  const REGISTRY_KEY = 'registry';

  // ── Guards (structured errors only) ───────────────────────────────
  function guardInitialized() {
    if (lifecycle.getState() !== LIFECYCLE_STATES.READY) {
      throw backupError('not-initialized', 'Backup manager is not initialized — call initialize() first');
    }
  }
  function guardEnabled() {
    if (!cfg.enabled) throw backupError('disabled', 'Backups are disabled (backup.enabled=false)');
  }
  function guardBackupFree() {
    if (running) {
      throw backupError('busy', `A backup is already running (${running.id})`);
    }
    if (restoreActive) throw backupError('busy', 'A restore is in progress — backup is blocked');
  }
  function guardRestoreFree() {
    if (running) {
      throw backupError('busy', `A backup is running (${running.id}) — restore is blocked`);
    }
    if (restoreActive) throw backupError('busy', 'A restore is already in progress');
  }

  function backupDirFor(id) {
    if (typeof id !== 'string' || !BACKUP_ID_PATTERN.test(id)) {
      throw backupError('invalid-argument', `Invalid backup id "${id}"`);
    }
    return join(cfg.directory, id);
  }

  // ── Registry (storage engine — index only, no manifest duplication) ─
  async function readRegistry() {
    const reg = await storageService.get('backup', REGISTRY_KEY, null);
    return reg && typeof reg === 'object'
      ? reg
      : { schemaVersion: 1, latest: null, backups: [] };
  }
  async function writeRegistry(reg) {
    await storageService.set('backup', REGISTRY_KEY, reg);
  }

  async function recordBackup(entry) {
    try {
      const reg = await readRegistry();
      reg.backups = [entry, ...(reg.backups ?? [])];
      reg.latest = { id: entry.id, createdAt: entry.createdAt, dir: entry.dir, status: entry.status };
      await writeRegistry(reg);
      return reg;
    } catch (err) {
      // The backup on disk is the source of truth; a registry write
      // failure must never fail a completed backup.
      log.error('Failed to persist backup registry entry', err);
      return null;
    }
  }

  async function applyRetention() {
    try {
      const reg = await readRegistry();
      if (reg.backups.length <= cfg.retention) return reg;
      const excess = reg.backups.slice(cfg.retention);
      for (const b of excess) {
        await fsutil.removeRecursive(join(cfg.directory, b.dir)).catch(() => {});
        log.info('Retention: pruned oldest backup', { id: b.id });
      }
      reg.backups = reg.backups.slice(0, cfg.retention);
      reg.latest =
        reg.backups.length > 0
          ? { id: reg.backups[0].id, createdAt: reg.backups[0].createdAt, dir: reg.backups[0].dir, status: reg.backups[0].status }
          : null;
      await writeRegistry(reg);
      return reg;
    } catch (err) {
      log.error('Retention pruning failed', err);
      return null;
    }
  }

  // ── Backup execution ──────────────────────────────────────────────
  async function runBackup({ trigger = 'manual', onProgress = null, providers: only = null }) {
    guardInitialized();
    guardEnabled();
    guardBackupFree();
    await fsutil.ensureDir(cfg.directory);

    const id = makeBackupId();
    const backupDir = join(cfg.directory, id);
    const startedAt = new Date().toISOString();
    // Per-run cancellation token — cancel()/shutdown() flip this via
    // the CURRENT running object; a lingering run only ever reads its
    // own token, so it can never mistake a later run's state.
    const cancelToken = { requested: false };
    running = { id, startedAt, stage: 'start', progress: { completed: 0, total: 0 }, cancelToken };

    const checkCancelled = () => {
      if (cancelToken.requested) {
        throw backupError('cancelled', `Backup ${id} was cancelled`);
      }
    };
    const emitProgress = (stage, message, extra = {}) => {
      running.stage = stage;
      running.progress = { ...running.progress, ...extra };
      if (onProgress) {
        try {
          onProgress({ id, stage, message, ...extra });
        } catch (err) {
          // A progress callback must never abort a backup.
          log.warn('Backup progress callback threw — continuing', err);
        }
      }
    };

    try {
      log.info('Backup starting', { id, trigger, directory: backupDir });
      emitProgress('start', 'backup beginning', { trigger });
      await fsutil.ensureDir(backupDir);

      const selected = (only ?? BACKUP_TYPES).filter((t) => providers.has(t));
      const manifestProviders = {};
      let totalBytes = 0;

      for (const type of selected) {
        checkCancelled();
        const provider = providers.get(type);
        emitProgress(type, 'capturing', { provider: type });
        const staging = join(backupDir, type);
        await fsutil.ensureDir(staging);
        let created;
        try {
          created = await provider.create({ targetDir: staging, context: { backupId: id, trigger } });
        } catch (err) {
          if (isBackupError(err)) throw err;
          throw new BackupError(
            'provider-failed',
            `Provider "${type}" failed during backup: ${err.message}`,
            { type, cause: err.message }
          );
        }
        const staged = await fsutil.walkFiles(staging);
        const entries = [];
        for (const abs of staged) {
          checkCancelled();
          const relative = abs.slice(staging.length + 1).replace(/\\/g, '/');
          let entry = {
            path: `${type}/${relative}`,
            size: 0,
            sha256: '',
            compressed: false,
            algorithm: null,
          };
          let finalAbs = abs;
          if (cfg.compression) {
            const gz = `${abs}.gz`;
            await compressFile(abs, gz);
            await fsutil.removeRecursive(abs);
            finalAbs = gz;
            entry = { ...entry, path: `${type}/${relative}.gz`, compressed: true, algorithm: 'gzip' };
          }
          const st = await stat(finalAbs);
          entry.size = st.size;
          entry.sha256 = await fsutil.hashFile(finalAbs);
          totalBytes += st.size;
          entries.push(entry);
        }
        manifestProviders[type] = {
          status: entries.length === 0 ? 'empty' : 'ok',
          files: entries,
          output: created?.output ?? {},
        };
        emitProgress(type, `captured ${entries.length} file(s)`, { provider: type, files: entries.length });
      }

      checkCancelled();
      const appVersion = options.appVersion ?? (await readAppVersion());
      const schemaVersion = options.schemaVersion ?? METADATA_SCHEMA_VERSION;
      const manifest = buildManifest({
        id,
        createdAt: startedAt,
        appVersion,
        schemaVersion,
        trigger,
        compression: cfg.compression,
        providers: manifestProviders,
        metadata: {
          platform: getPlatform(),
          arch: getArch(),
          hostname: getHostname(),
        },
      });
      await fsutil.writeJson(join(backupDir, MANIFEST_FILE_NAME), manifest);

      await recordBackup({
        id,
        createdAt: startedAt,
        dir: id,
        status: 'completed',
        size: totalBytes,
        compressed: cfg.compression,
        providers: selected,
      });
      await applyRetention();

      emitProgress('done', 'backup completed', { size: totalBytes, files: Object.values(manifestProviders).reduce((n, p) => n + p.files.length, 0) });
      log.info('Backup completed', { id, size: totalBytes, providers: selected, compressed: cfg.compression });
      return { id, dir: backupDir, status: 'completed', size: totalBytes, createdAt: startedAt, manifest, providers: manifestProviders };
    } catch (err) {
      // Structured errors only — wrap anything that escaped the
      // providers (compress/checksum/progress stages) in a BackupError.
      if (!isBackupError(err)) {
        err = new BackupError('backup-failed', `Backup ${id} failed: ${err.message}`, { cause: err.message });
      }
      if (err.code === 'cancelled') {
        log.warn(`Backup ${id} cancelled — partial backup removed`, err);
      } else {
        log.error(`Backup ${id} failed — partial backup removed`, err);
      }
      await fsutil.removeRecursive(backupDir).catch(() => {});
      throw err;
    } finally {
      running = null;
    }
  }

  // ── Restore / verify / validate ───────────────────────────────────
  async function resolveEngine() {
    if (!restoreEngine) {
      restoreEngine = createRestoreEngine({
        supportedSchemaVersion: options.schemaVersion ?? METADATA_SCHEMA_VERSION,
        storage: storageService,
        providerMap: providers,
        log: log.child('restore'),
      });
    }
    return restoreEngine;
  }

  async function verifyBackupById(id) {
    guardInitialized();
    const backupDir = backupDirFor(id);
    if (!(await fsutil.dirExists(backupDir))) {
      throw backupError('not-found', `Backup "${id}" not found`, { id });
    }
    return verifyBackup({ backupDir });
  }

  async function validateBackup(id, { providers: only = null } = {}) {
    guardInitialized();
    const backupDir = backupDirFor(id);
    if (!(await fsutil.dirExists(backupDir))) {
      throw backupError('not-found', `Backup "${id}" not found`, { id });
    }
    const engine = await resolveEngine();
    return engine.validate({ backupDir, providers: only });
  }

  async function restore({ id, providers: only = null, dryRun = false, onProgress = null }) {
    guardInitialized();
    guardRestoreFree();
    restoreActive = true;
    try {
      const backupDir = backupDirFor(id);
      if (!(await fsutil.dirExists(backupDir))) {
        throw backupError('not-found', `Backup "${id}" not found`, { id });
      }
      const engine = await resolveEngine();
      // Single source of truth for the pre-restore gate: integrity +
      // compatibility, both verified BEFORE any state change.
      const validation = await engine.validate({ backupDir, providers: only });
      const manifest = validation.manifest;
      const { verified, compatibility } = validation;
      const selected = only ?? BACKUP_TYPES.filter((t) => manifest.providers?.[t]);

      if (!compatibility.compatible) {
        throw backupError('incompatible', `Backup "${id}" is not compatible with this build: ${compatibility.blocking.join('; ')}`, {
          id,
          blocking: compatibility.blocking,
        });
      }
      if (!verified.ok) {
        const names = verified.errors.map((e) => e.name);
        throw backupError('integrity-failed', `Backup "${id}" failed integrity verification: ${names.join(', ')}`, {
          id,
          failures: names,
        });
      }
      for (const w of compatibility.warnings) log.warn(`Restore warning for backup ${id}: ${w}`);

      const result = await engine.run({ backupDir, manifest, providers: selected, dryRun, onProgress });
      log.info(`Restore of backup ${id} ${dryRun ? 'planned (dry-run)' : 'completed'}`, {
        providers: selected,
        actions: result.actions.length,
        dryRun,
      });
      return { id, dryRun, ...result, compatibility };
    } finally {
      restoreActive = false;
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────
  function initialize() {
    if (lifecycle.getState() === LIFECYCLE_STATES.READY) return manager;
    lifecycle.transitionTo(LIFECYCLE_STATES.INITIALIZING);
    schedule = createBackupScheduler({
      manager,
      enabled: cfg.schedule.enabled,
      intervalSeconds: cfg.schedule.intervalSeconds,
      log: log.child('schedule'),
    });
    // The scheduler is NEVER started here — scheduled backups remain
    // disabled (backup.schedule.enabled=false) until a future milestone.
    restoreEngine = null;
    lifecycle.transitionTo(LIFECYCLE_STATES.READY);
    log.info('Backup manager initialized', {
      directory: cfg.directory,
      compression: cfg.compression,
      retention: cfg.retention,
      scheduleEnabled: cfg.schedule.enabled,
      providers: manager.list().map((p) => p.type),
    });
    return manager;
  }

  async function shutdown() {
    const state = lifecycle.getState();
    if (state === LIFECYCLE_STATES.STOPPED) return manager;
    lifecycle.transitionTo(LIFECYCLE_STATES.STOPPING);
    // Safely stop or finish backup work: cancel cooperatively (per-run
    // token), then wait for the run to settle, bounded by the grace cap.
    if (running) {
      running.cancelToken.requested = true;
      log.warn('Shutdown: cancellation requested for running backup', { id: running.id });
      if (running.promise) {
        await Promise.race([running.promise.catch(() => {}), delay(SHUTDOWN_GRACE_MS)]);
      } else {
        // Fallback poll for runs that began before the promise link.
        const deadline = Date.now() + SHUTDOWN_GRACE_MS;
        while (running && Date.now() < deadline) await delay(25);
      }
      if (running) {
        log.error(`Running backup ${running.id} did not settle within shutdown grace period`, {
          id: running.id,
        });
      }
    }
    schedule?.stop();
    lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
    log.info('Backup manager shutdown complete');
    return manager;
  }

  function cancel() {
    if (!running) return { cancelled: false, reason: 'no-backup-running' };
    running.cancelToken.requested = true;
    log.warn('Cancellation requested for running backup', { id: running.id });
    return { cancelled: true, id: running.id };
  }

  function status() {
    return {
      state: lifecycle.getState(),
      enabled: cfg.enabled,
      directory: cfg.directory,
      compression: { enabled: cfg.compression },
      retention: { maxBackups: cfg.retention },
      schedule: schedule ? schedule.status() : { enabled: cfg.schedule.enabled, started: false },
      running: running
        ? {
            id: running.id,
            startedAt: running.startedAt,
            stage: running.stage,
            progress: { ...running.progress },
            cancelRequested: running.cancelToken.requested,
          }
        : null,
      restoreActive,
    };
  }

  async function listBackups() {
    guardInitialized();
    const reg = await readRegistry().catch(() => ({ backups: [] }));
    return (reg.backups ?? []).map((b) => ({ ...b }));
  }

  // ── Manager surface ───────────────────────────────────────────────
  const manager = {
    register(provider) {
      providers.set(provider.type, provider);
      return manager;
    },
    list() {
      return [...providers.values()].map((p) => p.describe());
    },
    get(type) {
      return providers.get(type) ?? null;
    },
    getState: () => lifecycle.getState(),
    initialize,
    shutdown,
    cancel,
    status,
    /** Run a manual backup of every registered provider. */
    backup: (opts = {}) => {
      const promise = runBackup({ trigger: 'manual', ...opts });
      // Link the in-flight promise so shutdown() can await it.
      if (running) running.promise = promise;
      return promise;
    },
    /** Backwards-compatible alias for a full manual backup. */
    runAll: (opts = {}) => {
      const promise = runBackup({ trigger: 'manual', ...opts });
      if (running) running.promise = promise;
      return promise;
    },
    verify: verifyBackupById,
    validate: validateBackup,
    restore,
    listBackups,
    get schedule() {
      return schedule;
    },
  };

  // Default providers (independently replaceable via register()).
  manager.register(createSqliteBackupProvider(options.sqlite));
  manager.register(createStorageBackupProvider(options.storageProvider));
  manager.register(createSettingsBackupProvider(options.settings));
  manager.register(createExportProvider(options.exports));

  return manager;
}
