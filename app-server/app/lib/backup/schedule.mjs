/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Scheduler  (Milestone 4.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Scheduled-backup infrastructure. The scheduler EXISTS so a future
 *    milestone can flip `backup.schedule.enabled` and scheduled backups
 *    work immediately — but it remains DISABLED by default and the
 *    backup manager never starts it. Only manual backup execution is
 *    exposed today (requirement 2).
 *
 *  Behavior:
 *    start() refuses (stays stopped, logs) when disabled; when enabled
 *    it runs manager.backup({ trigger: 'scheduled' }) on the configured
 *    interval. The timer is unref'd so it never keeps the process alive.
 *    stop() clears the timer. status() reports state + next run.
 *
 *  Dependencies: app/lib/logging. No cycles.
 */

import { createLogger } from '../logging/index.mjs';

/**
 * Create a backup scheduler.
 * @param {object} options
 * @param {object} options.manager      backup manager exposing backup()
 * @param {boolean} [options.enabled=false]  config backup.schedule.enabled
 * @param {number} [options.intervalSeconds=86400] config backup.schedule.intervalSeconds
 * @param {object} [options.log]
 */
export function createBackupScheduler(options = {}) {
  const manager = options.manager;
  const enabled = options.enabled ?? false;
  const intervalSeconds = Math.max(1, Number(options.intervalSeconds ?? 86400));
  const log = options.log ?? createLogger('backup:schedule');

  let timer = null;
  let startedAt = null;
  let lastRunAt = null;
  let lastError = null;

  return {
    /** Whether this scheduler is permitted to run (config gate). */
    isEnabled: () => enabled,
    getIntervalSeconds: () => intervalSeconds,
    /** Begin scheduled backups. Refuses when disabled. */
    start() {
      if (!enabled) {
        log.info('Backup scheduler is disabled (backup.schedule.enabled=false) — not starting');
        return { started: false, reason: 'disabled' };
      }
      if (timer) return { started: true, reason: 'already-running' };
      if (!manager || typeof manager.backup !== 'function') {
        throw new TypeError('createBackupScheduler requires a manager exposing backup()');
      }
      startedAt = new Date().toISOString();
      timer = setInterval(() => {
        void manager
          .backup({ trigger: 'scheduled' })
          .then(() => {
            lastRunAt = new Date().toISOString();
            lastError = null;
          })
          .catch((err) => {
            lastError = err;
            log.error('Scheduled backup failed', err);
          });
      }, intervalSeconds * 1000);
      if (typeof timer.unref === 'function') timer.unref();
      log.info('Backup scheduler started', { intervalSeconds });
      return { started: true };
    },
    /** Stop the scheduler. Safe when not running. */
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      log.info('Backup scheduler stopped');
      return this.status();
    },
    /** Snapshot: config + live state. */
    status() {
      return {
        enabled,
        intervalSeconds,
        started: timer !== null,
        startedAt,
        lastRunAt,
        lastError: lastError ? { name: lastError.name, code: lastError.code ?? null, message: lastError.message } : null,
      };
    },
  };
}
