/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Centralized Feature Flags  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Single registry of every Local Edition feature flag. All flags are
 *    DISABLED by default and are backed by the Milestone 3.1 config
 *    system (future.* keys) — no configuration values are duplicated.
 *
 *  Flags:
 *    • lanMode           LAN mode                      (future.lanMode.enabled)
 *    • offlineMode       Offline mode                  (future.offlineMode.enabled)
 *    • automaticBackups  Scheduled backups             (backup.schedule.enabled)
 *    • loggingToFile     Logging to disk               (logging.file.enabled)
 *    • discovery         LAN discovery                 (future.lanDiscovery.enabled)
 *    • synchronization   Data synchronization          (future.sync.enabled)
 *
 *  Future purpose:
 *    Later milestones read flags here instead of scattering
 *    `config.future.*` checks through the codebase.
 *
 *  Dependencies: app/lib/config (via get()).
 */

import { get } from '../config/index.mjs';

/** Flag → config key mapping. THE single source of truth. */
export const FLAG_DEFINITIONS = Object.freeze({
  lanMode: { configKey: 'future.lanMode.enabled', default: false },
  offlineMode: { configKey: 'future.offlineMode.enabled', default: false },
  automaticBackups: { configKey: 'backup.schedule.enabled', default: false },
  loggingToFile: { configKey: 'logging.file.enabled', default: false },
  discovery: { configKey: 'future.lanDiscovery.enabled', default: false },
  synchronization: { configKey: 'future.sync.enabled', default: false },
});

/** Read the current value of a feature flag. */
export function isEnabled(name) {
  const def = FLAG_DEFINITIONS[name];
  if (!def) return false;
  return get(def.configKey, def.default) === true;
}

/** Snapshot of every flag (useful for status pages / reports). */
export function getFlags() {
  const snapshot = {};
  for (const name of Object.keys(FLAG_DEFINITIONS)) {
    snapshot[name] = isEnabled(name);
  }
  return snapshot;
}
