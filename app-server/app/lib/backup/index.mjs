/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Framework  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Reusable backup infrastructure supporting future SQLite backups,
 *    settings backups and exports.
 *
 *  HARD CONSTRAINT: NO backup is performed by this module. It only
 *  defines providers and a manager registry. Actual backup execution
 *  lands in the backup milestone (gated behind the automaticBackups
 *  feature flag).
 *
 *  Future purpose:
 *    The backup milestone implements each provider's create()/restore()
 *    using fsutil primitives (copyRecursive, hashFile, atomicWriteFile)
 *    and schedules them through the service registry.
 *
 *  Dependencies: app/lib/local/errors, app/lib/local/paths.
 */

import { NotImplementedError } from '../local/errors.mjs';
import { paths } from '../local/paths.mjs';

/** Provider types this framework anticipates. */
export const BACKUP_TYPES = Object.freeze(['sqlite', 'settings', 'exports']);

/** Base provider factory — returns an inert, self-describing provider. */
function createProvider(type, options = {}) {
  return {
    type,
    options: { ...options },
    /** Metadata about this provider (no execution). */
    describe: () => ({ type, options: { ...options } }),
    create: async () => {
      throw new NotImplementedError(`Backup provider "${type}" create`);
    },
    restore: async () => {
      throw new NotImplementedError(`Backup provider "${type}" restore`);
    },
  };
}

/** SQLite backup provider — future: snapshot prisma/sqlite.db. */
export function createSqliteBackupProvider(options = {}) {
  return createProvider('sqlite', {
    databaseFile: options.databaseFile ?? paths.databaseFile,
    ...options,
  });
}

/** Settings backup provider — future: snapshot the settings namespace. */
export function createSettingsBackupProvider(options = {}) {
  return createProvider('settings', {
    settingsDir: options.settingsDir ?? paths.dataDir,
    ...options,
  });
}

/** Export provider — future: package exports (PDFs, reports). */
export function createExportProvider(options = {}) {
  return createProvider('exports', {
    exportDir: options.exportDir ?? paths.exportDir,
    ...options,
  });
}

/**
 * Backup manager — registers providers and exposes orchestration
 * entry points. No backup runs until a future milestone calls runAll().
 */
export function createBackupManager(options = {}) {
  const providers = new Map();

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
    runAll: async () => {
      throw new NotImplementedError('Backup manager runAll');
    },
    restore: async (type) => {
      throw new NotImplementedError(`Backup manager restore "${type}"`);
    },
  };

  // Register the three anticipated providers by default.
  manager.register(createSqliteBackupProvider(options.sqlite));
  manager.register(createSettingsBackupProvider(options.settings));
  manager.register(createExportProvider(options.exports));

  return manager;
}
