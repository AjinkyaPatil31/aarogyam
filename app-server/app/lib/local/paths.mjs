/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Runtime Path Manager  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    THE single module that resolves every absolute directory the Local
 *    Edition needs. No other module may hardcode an absolute path —
 *    import `paths` from here instead.
 *
 *  Resolves:
 *    • application directory  (appRoot)
 *    • data directory         (dataDir)
 *    • logs directory         (logsDir)
 *    • backups directory      (backupsDir)
 *    • temporary directory    (tempDir)
 *    • database directory     (databaseDir)
 *    • export directory       (exportDir)
 *
 *  Configuration integration (Milestone 3.1):
 *    Values fall back to safe defaults but can be overridden through
 *    config.future.paths.* (INSTALLATION_PATH, DATABASE_LOCATION,
 *    BACKUP_DIRECTORY, LOG_DIRECTORY). No values are duplicated here.
 *
 *  Future purpose:
 *    The installer milestone should ONLY modify this module to redirect
 *    the whole tree to a user-chosen installation directory.
 *
 *  Dependencies: node:path, node:os, app/lib/config (via get()).
 *
 *  IMPORTANT: importing this module performs NO filesystem writes.
 *  Directory creation is the job of fsutil.ensureDir and is invoked
 *  only by future milestones at startup — never at import time.
 */

import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from '../config/index.mjs';

/** Override helper — treats empty strings as "not set" (future keys
 *  default to '' in the config system). */
function effective(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/** Application root — where the server runs from (app-server). */
const appRoot = resolve(process.cwd());

/** Installation directory — defaults to app root until the installer
 *  milestone redirects it via INSTALLATION_PATH. */
const installationDir = resolve(
  effective(get('future.paths.installation', ''), appRoot)
);

/** SQLite database file — defaults to the Prisma schema location. */
const databaseFile = resolve(
  effective(get('future.paths.database', ''), join(installationDir, 'prisma', 'sqlite.db'))
);

/** Data directory — root of all writable app data (settings, cache…). */
const dataDir = resolve(join(installationDir, 'data'));

const logsDir = resolve(effective(get('future.paths.logs', ''), join(dataDir, 'logs')));
const backupsDir = resolve(effective(get('backup.directory', ''), join(dataDir, 'backups')));
const exportDir = join(dataDir, 'exports');
const tempDir = join(tmpdir(), 'aarogyam');

export const paths = Object.freeze({
  appRoot,
  installationDir,
  dataDir,
  logsDir,
  backupsDir,
  tempDir,
  databaseFile,
  databaseDir: dirname(databaseFile),
  exportDir,
});

/** Resolve a path relative to the installation directory. */
export function resolvePath(...segments) {
  return resolve(installationDir, ...segments);
}

/** Resolve a path inside the data directory. */
export function resolveDataPath(...segments) {
  return resolve(dataDir, ...segments);
}
