/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Diagnostics Collection  (Milestone 4.4)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    On-demand collection of runtime information:
 *      • application version / installation version
 *      • platform / architecture / hostname
 *      • uptime / memory usage / disk availability
 *      • storage statistics / logging statistics / backup statistics
 *      • registry state / lifecycle state / configuration summary
 *
 *  Safety: this module surfaces INFRASTRUCTURE state only. It never
 *  reads patient, prescription, appointment, medical-record,
 *  authentication or secret data. The configuration summary carries a
 *  small set of non-sensitive values (app name, environment) plus key
 *  counts per category — never secret values.
 *
 *  Dependencies: node:os, node:fs/promises, app/lib/system,
 *    app/lib/installer, app/lib/local/paths, app/lib/config,
 *    app/lib/health/model. No cycles.
 */

import { statfs } from 'node:fs/promises';
import { totalmem, freemem } from 'node:os';
import { paths } from '../local/paths.mjs';
import { get } from '../config/index.mjs';
import { readAppVersion } from '../installer/index.mjs';
import { getPlatform, getArch, getHostname } from '../system/index.mjs';
/** True when diagnostics collection is permitted (config gate). */
export function diagnosticsEnabled() {
  return get('diagnostics.enabled', true) !== false;
}

/**
 * Collect runtime information.
 * @param {object} deps
 * @param {object} [deps.storage]      storage engine service
 * @param {object} [deps.backup]       backup manager
 * @param {object} [deps.registry]     service registry
 * @param {object} [deps.manager]      health manager (lifecycle state)
 * @param {Function} [deps.getLogManager]
 * @param {string}  [deps.appVersion]  cached application version
 * @param {string}  [deps.installationId]
 * @param {object}  [options]
 * @param {boolean} [options.enabled]  override gate (default: config)
 */
export async function collectDiagnostics(deps = {}, { enabled = diagnosticsEnabled() } = {}) {
  if (!enabled) {
    return { enabled: false, reason: 'diagnostics disabled (diagnostics.enabled=false)' };
  }

  const appVersion = deps.appVersion ?? (await readAppVersion());
  const uptimeSeconds = Math.round(process.uptime());

  const memory = process.memoryUsage();
  // Real DISK availability for the data volume (statfs). Falls back to
  // the app root when the data directory does not exist yet, so this
  // is never null on a running system. The previous implementation
  // mislabeled memory (totalmem/freemem) as disk — corrected.
  let disk = null;
  for (const dir of [paths.dataDir, paths.appRoot]) {
    try {
      const fs = await statfs(dir);
      disk = {
        freeBytes: fs.bavail * fs.bsize,
        totalBytes: fs.blocks * fs.bsize,
        freePercent: fs.blocks > 0 ? Math.round((fs.bavail / fs.blocks) * 1000) / 10 : null,
      };
      break;
    } catch {
      // try the next candidate
    }
  }

  let storageStats = null;
  if (deps.storage) {
    storageStats = {
      state: deps.storage.getState ? deps.storage.getState() : 'UNKNOWN',
      cache: typeof deps.storage.cache?.getStats === 'function' ? deps.storage.cache.getStats() : null,
      writesPending: typeof deps.storage.getWritesPending === 'function' ? deps.storage.getWritesPending() : null,
    };
  }

  let loggingStats = null;
  if (deps.getLogManager) {
    const mgr = deps.getLogManager();
    loggingStats = {
      state: mgr.getState ? mgr.getState() : 'UNKNOWN',
      ...(typeof mgr.getStats === 'function' ? mgr.getStats() : {}),
    };
  }

  let backupStats = null;
  if (deps.backup) {
    const snapshot = typeof deps.backup.status === 'function' ? deps.backup.status() : null;
    let registry = null;
    try {
      const list =
        typeof deps.backup.listBackups === 'function' ? await deps.backup.listBackups() : [];
      registry = { count: list.length, latest: list[0] ?? null };
    } catch {
      registry = { count: -1, latest: null };
    }
    backupStats = { ...(snapshot ?? {}), registry };
  }

  let registryState = null;
  if (deps.registry && typeof deps.registry.getStates === 'function') {
    registryState = deps.registry.getStates();
  }

  // Non-sensitive configuration summary: app identity, environment and
  // per-category key counts. Secret VALUES are never included.
  const configSummary = {
    appName: get('app.name', ''),
    environment: get('env.isProduction', false) ? 'production' : 'development',
    appUrl: get('app.url', ''),
  };

  return {
    enabled: true,
    collectedAt: new Date().toISOString(),
    app: {
      version: appVersion,
      installationId: deps.installationId ?? null,
    },
    system: {
      platform: getPlatform(),
      arch: getArch(),
      hostname: getHostname(),
      nodeVersion: process.version,
      pid: process.pid,
      uptimeSeconds,
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        total: totalmem(),
        free: freemem(),
      },
      disk: disk ?? { error: 'disk stat unavailable' },
    },
    storage: storageStats,
    logging: loggingStats,
    backup: backupStats,
    registry: registryState,
    lifecycle: {
      managerState: deps.manager?.getState ? deps.manager.getState() : 'UNKNOWN',
    },
    configuration: configSummary,
  };
}
