/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Providers  (Milestone 4.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    The provider layer of the backup framework. Each provider is an
 *    independently replaceable unit that knows ONE thing: where its
 *    data lives and how to copy it in/out of a backup.
 *
 *  Providers:
 *    • sqlite    — the application database (prisma/sqlite.db)
 *    • storage   — infrastructure storage engine documents
 *                  (cache, metadata, installation, runtime namespaces)
 *    • settings  — application settings (storage `settings` namespace)
 *    • exports   — generated export data (data/exports tree)
 *
 *  Provider contract:
 *    create({ targetDir, context })
 *      → copies its source into <targetDir>/…, returns
 *        { files: [{ relative }], output: {…} }
 *      • `relative` is the path RELATIVE TO targetDir (the manager
 *        records it in the manifest as `<type>/<relative>`)
 *      • providers NEVER compress or checksum — the manager owns those
 *      • a missing OPTIONAL source (settings/storage/exports) yields
 *        zero files; a missing REQUIRED source (sqlite) throws
 *        BackupError('missing-source')
 *    resolveTargets({ files, manifest })
 *      → [{ path, target }] where `path` is the manifest path and
 *        `target` is the absolute restore destination
 *
 *  The storage `backup` namespace is deliberately excluded from
 *  backups: it is the backup registry (an index of backups), not
 *  protected application data — it is rebuilt from restored manifests.
 *
 *  Dependencies: node:path, app/lib/local/paths, app/lib/local/fsutil,
 *    app/lib/local/errors, app/lib/backup/errors, app/lib/logging.
 *    No cycles.
 */

import { join } from 'node:path';
import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { BackupError } from './errors.mjs';
import { createLogger } from '../logging/index.mjs';

const log = createLogger('backup:providers');

/**
 * Storage engine namespaces protected by the `storage` provider.
 * `settings` is owned by the settings provider; `backup` is the backup
 * registry (an index, not protected data).
 */
export const STORAGE_NAMESPACES = Object.freeze([
  'cache',
  'metadata',
  'installation',
  'runtime',
]);

/** Shared copy helper: copy one file/dir into the provider staging dir. */
async function copySource(source, target) {
  await fsutil.copyRecursive(source, target);
}

/**
 * SQLite database provider.
 * Required source: the database file MUST exist — a backup without the
 * primary database is worthless, so the backup fails loudly instead of
 * silently producing an empty backup.
 */
export function createSqliteBackupProvider(options = {}) {
  const databaseFile = options.databaseFile ?? paths.databaseFile;
  const outputName = options.outputName ?? 'aarogyam.sqlite';
  return {
    type: 'sqlite',
    options: { databaseFile, outputName },
    describe() {
      return { type: 'sqlite', options: { databaseFile, outputName } };
    },
    async create({ targetDir }) {
      if (!(await fsutil.fileExists(databaseFile))) {
        throw new BackupError(
          'missing-source',
          `SQLite database file not found: ${databaseFile}`,
          { source: databaseFile }
        );
      }
      await copySource(databaseFile, join(targetDir, outputName));
      log.debug(`sqlite provider captured ${databaseFile}`);
      return { files: [{ relative: outputName }], output: { databaseFile } };
    },
    resolveTargets({ files }) {
      return files.map((f) => ({ path: f.path, target: databaseFile }));
    },
  };
}

/**
 * Infrastructure storage provider — raw copies of the storage engine's
 * non-settings, non-backup namespaces (document envelopes preserved
 * byte-for-byte so the storage engine re-validates them on read).
 */
export function createStorageBackupProvider(options = {}) {
  const rootDir = options.rootDir ?? paths.dataDir;
  const namespaces = options.namespaces ?? [...STORAGE_NAMESPACES];
  return {
    type: 'storage',
    options: { rootDir, namespaces: [...namespaces] },
    describe() {
      return { type: 'storage', options: { rootDir, namespaces: [...namespaces] } };
    },
    async create({ targetDir }) {
      const files = [];
      for (const ns of namespaces) {
        const source = join(rootDir, ns);
        if (!(await fsutil.dirExists(source))) continue;
        await copySource(source, join(targetDir, ns));
        const copied = await fsutil.walkFiles(join(targetDir, ns));
        for (const abs of copied) {
          files.push({ relative: abs.slice(targetDir.length + 1).replace(/\\/g, '/') });
        }
      }
      log.debug(`storage provider captured ${files.length} document(s)`);
      return { files, output: { rootDir, namespaces: [...namespaces] } };
    },
    resolveTargets({ files }) {
      return files.map((f) => ({
        path: f.path,
        target: join(rootDir, f.path.slice('storage/'.length)),
      }));
    },
  };
}

/**
 * Application settings provider — the storage engine `settings`
 * namespace (where the application persists its settings documents).
 * Optional source: no settings documents yet yields an empty provider.
 */
export function createSettingsBackupProvider(options = {}) {
  const settingsDir = options.settingsDir ?? paths.dataDir;
  const sourceDir = options.sourceDir ?? join(settingsDir, 'settings');
  return {
    type: 'settings',
    options: { settingsDir, sourceDir },
    describe() {
      return { type: 'settings', options: { settingsDir, sourceDir } };
    },
    async create({ targetDir }) {
      if (!(await fsutil.dirExists(sourceDir))) {
        return { files: [], output: { sourceDir, present: false } };
      }
      await copySource(sourceDir, targetDir);
      const copied = await fsutil.walkFiles(targetDir);
      const files = copied.map((abs) => ({
        relative: abs.slice(targetDir.length + 1).replace(/\\/g, '/'),
      }));
      log.debug(`settings provider captured ${files.length} document(s)`);
      return { files, output: { sourceDir, present: true } };
    },
    resolveTargets({ files }) {
      return files.map((f) => ({
        path: f.path,
        target: join(sourceDir, f.path.slice('settings/'.length)),
      }));
    },
  };
}

/**
 * Export data provider — the generated exports tree (data/exports,
 * PDFs, reports). Optional source: an empty exports directory yields an
 * empty provider.
 */
export function createExportProvider(options = {}) {
  const exportDir = options.exportDir ?? paths.exportDir;
  return {
    type: 'exports',
    options: { exportDir },
    describe() {
      return { type: 'exports', options: { exportDir } };
    },
    async create({ targetDir }) {
      if (!(await fsutil.dirExists(exportDir))) {
        return { files: [], output: { exportDir, present: false } };
      }
      await copySource(exportDir, targetDir);
      const copied = await fsutil.walkFiles(targetDir);
      const files = copied.map((abs) => ({
        relative: abs.slice(targetDir.length + 1).replace(/\\/g, '/'),
      }));
      log.debug(`exports provider captured ${files.length} file(s)`);
      return { files, output: { exportDir, present: true } };
    },
    resolveTargets({ files }) {
      return files.map((f) => ({
        path: f.path,
        target: join(exportDir, f.path.slice('exports/'.length)),
      }));
    },
  };
}
