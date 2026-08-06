/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Framework Errors  (Milestone 4.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Structured error types for the backup subsystem. Every failure
 *    raised by the backup framework is one of these — machine-readable
 *    `code`s plus `ctx` context — never bare Error instances. Callers
 *    (and the verification suite) branch on `err.code`, never on
 *    message text.
 *
 *  Codes (BACKUP_ERROR_CODES — enforced by backupError()):
 *    not-initialized   manager used before initialize()
 *    disabled          backup.enabled=false (manual backups refused)
 *    busy              concurrent backup or restore in progress
 *    cancelled         backup cancelled by cancel()/shutdown()
 *    not-found         backup id / provider not found
 *    incompatible      restore refused — version compatibility failed
 *    invalid-manifest  manifest file missing / not JSON / malformed
 *    integrity-failed  integrity verification failed before restore
 *    provider-failed   a provider threw during backup
 *    restore-failed    restore could not complete (rolled back)
 *    invalid-argument  caller supplied an invalid value
 *    missing-source    a required source (e.g. the SQLite database)
 *                      is absent
 *    backup-failed     an internal stage (compress/checksum/progress)
 *                      failed outside the providers
 *
 *  Dependencies: none (pure ECMAScript classes — cannot participate in
 *    an import cycle).
 */

/** Canonical error codes raised by the backup subsystem. */
export const BACKUP_ERROR_CODES = Object.freeze([
  'not-initialized',
  'disabled',
  'busy',
  'cancelled',
  'not-found',
  'incompatible',
  'invalid-manifest',
  'integrity-failed',
  'provider-failed',
  'restore-failed',
  'invalid-argument',
  'missing-source',
  'backup-failed',
]);

/** Base structured error for every backup subsystem failure. */
export class BackupError extends Error {
  constructor(code, message, ctx = {}) {
    super(`[Aarogyam] Backup error (${code}): ${message}`);
    this.name = 'BackupError';
    this.code = code;
    this.ctx = { ...ctx };
  }
}

/**
 * Structured error raised by the restore engine. `rolledBack` is true
 * when the engine restored the application to its pre-restore state.
 */
export class RestoreError extends BackupError {
  constructor(code, message, ctx = {}) {
    super(code, message, ctx);
    this.name = 'RestoreError';
  }
}

/** True when `err` is a backup-framework error (either class). */
export function isBackupError(err) {
  return (
    err instanceof BackupError ||
    (err && typeof err === 'object' && err.name === 'BackupError' && typeof err.code === 'string')
  );
}

/**
 * Build a BackupError, enforcing that `code` is a registered member of
 * BACKUP_ERROR_CODES — this prevents the constant from drifting from
 * the codes actually raised by the framework.
 */
export function backupError(code, message, ctx = {}) {
  if (!BACKUP_ERROR_CODES.includes(code)) {
    throw new Error(`[Aarogyam] internal: unregistered backup error code "${code}"`);
  }
  return new BackupError(code, message, ctx);
}
