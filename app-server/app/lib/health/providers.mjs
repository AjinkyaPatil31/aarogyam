/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Health Providers  (Milestone 4.4)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    One provider per infrastructure component. Each provider is an
 *    independently replaceable unit returning a canonical health result
 *    ({ status, component, message, details, timestamp, duration,
 *      recommendations }) for its component.
 *
 *  Providers:
 *    • configuration — config coherence + schema validation
 *    • filesystem    — required directories + disk availability
 *    • storage       — storage engine state / cache / pending writes
 *    • logging       — log manager statistics
 *    • backup        — backup manager state + registry summary
 *    • bootstrap     — bootstrap manager state (live, when attached)
 *    • registry      — service inventory + lifecycle states
 *    • lifecycle     — health manager lifecycle + aggregate service states
 *
 *  Performance: every provider check is deliberately LIGHTWEIGHT —
 *  state reads, stats and stat calls only. Expensive verifications
 *  (writability probes, storage.verify(), log-write probes) live in the
 *  on-demand self-tests (app/lib/health/selftest.mjs), never here.
 *
 *  Safety: providers surface infrastructure state only. No patient,
 *  prescription, appointment, medical-record, authentication or secret
 *  data is ever read or included.
 *
 *  Dependencies: node:fs/promises, app/lib/config, app/lib/local/paths,
 *    app/lib/config/validate, app/lib/system, app/lib/health/model.
 *    No cycles.
 */

import { stat, statfs } from 'node:fs/promises';
import { get } from '../config/index.mjs';
import { paths } from '../local/paths.mjs';
import { validateConfig } from '../config/validate.mjs';
import { getSystemFacts } from '../system/index.mjs';
import { HEALTH_STATES, buildResult } from './model.mjs';

/** Wrap a provider factory so a plain object contract is enforced. */
export function createHealthProvider({ name, description, check }) {
  if (typeof name !== 'string' || typeof check !== 'function') {
    throw new TypeError('createHealthProvider requires a name and check()');
  }
  return {
    name,
    description: description ?? '',
    describe() {
      return { name, description: this.description };
    },
    check,
  };
}

// ── configuration ────────────────────────────────────────────────────
export function createConfigurationProvider() {
  return createHealthProvider({
    name: 'configuration',
    description: 'Configuration coherence and schema validation',
    async check() {
      const start = Date.now();
      let status = HEALTH_STATES.HEALTHY;
      let message = 'Configuration is valid';
      let detail = {};
      try {
        validateConfig(process.env);
      } catch (err) {
        status = HEALTH_STATES.FAILED;
        message = 'Configuration validation failed';
        detail = { error: err.message };
      }
      const appName = get('app.name', '');
      if (typeof appName !== 'string' || appName.length === 0) {
        status = HEALTH_STATES.FAILED;
        message = 'app.name is not configured';
      }
      const environment = get('env.isProduction', false) ? 'production' : 'development';
      return buildResult({
        component: 'configuration',
        status,
        message,
        details: {
          ...detail,
          appName,
          environment,
          nodeVersion: process.version,
        },
        recommendations:
          status === HEALTH_STATES.HEALTHY
            ? []
            : ['Fix the configuration and restart (see scripts/validate-config.mjs)'],
        duration: Date.now() - start,
      });
    },
  });
}

// ── filesystem ──────────────────────────────────────────────────────
const REQUIRED_DIRS = [
  ['data', paths.dataDir],
  ['logs', paths.logsDir],
  ['backups', paths.backupsDir],
  ['database', paths.databaseDir],
  ['exports', paths.exportDir],
  ['temp', paths.tempDir],
];

/** Minimum free disk space (bytes) before a WARNING is raised. */
export const MIN_FREE_DISK_BYTES = 100 * 1024 * 1024; // 100 MB

export function createFilesystemProvider() {
  return createHealthProvider({
    name: 'filesystem',
    description: 'Required directories and disk availability',
    async check() {
      const start = Date.now();
      const directories = [];
      const missing = [];
      for (const [label, dir] of REQUIRED_DIRS) {
        let exists = false;
        try {
          exists = (await stat(dir)).isDirectory();
        } catch {
          exists = false;
        }
        directories.push({ label, dir, exists });
        if (!exists) missing.push(label);
      }

      let disk = null;
      try {
        const fs = await statfs(paths.dataDir);
        disk = {
          freeBytes: fs.bavail * fs.bsize,
          totalBytes: fs.blocks * fs.bsize,
          freePercent: fs.blocks > 0 ? Math.round((fs.bavail / fs.blocks) * 1000) / 10 : null,
        };
      } catch {
        disk = null;
      }

      const lowDisk =
        disk && typeof disk.freeBytes === 'number' && disk.freeBytes < MIN_FREE_DISK_BYTES;
      let status = HEALTH_STATES.HEALTHY;
      let message = 'Filesystem is healthy';
      if (missing.length > 0) {
        status = HEALTH_STATES.DEGRADED;
        message = `Required directories missing: ${missing.join(', ')}`;
      } else if (lowDisk) {
        status = HEALTH_STATES.WARNING;
        message = 'Free disk space is low on the data directory';
      }

      return buildResult({
        component: 'filesystem',
        status,
        message,
        details: { directories, disk: disk ?? { error: 'statfs unavailable' } },
        recommendations:
          missing.length > 0
            ? ['Run the installer/bootstrap to create the missing directories']
            : lowDisk
              ? ['Free up disk space on the data volume']
              : [],
        duration: Date.now() - start,
      });
    },
  });
}

// ── storage engine ──────────────────────────────────────────────────
export function createStorageProvider({ storage = null } = {}) {
  return createHealthProvider({
    name: 'storage',
    description: 'Storage engine state and statistics',
    async check() {
      const start = Date.now();
      if (!storage) {
        return buildResult({
          component: 'storage',
          status: HEALTH_STATES.UNKNOWN,
          message: 'Storage engine dependency not provided',
          duration: Date.now() - start,
        });
      }
      const state = storage.getState ? storage.getState() : 'UNKNOWN';
      const cacheStats =
        typeof storage.cache?.getStats === 'function' ? storage.cache.getStats() : null;
      let writesPending = 0;
      if (typeof storage.getWritesPending === 'function') {
        try {
          writesPending = storage.getWritesPending();
        } catch {
          writesPending = -1;
        }
      }
      // Lightweight document counts per namespace (readdir only).
      const counts = {};
      try {
        for (const ns of storage.namespaces ?? []) {
          counts[ns] = (await storage.listKeys(ns)).length;
        }
      } catch {
        /* counts are best-effort */
      }

      const status =
        state === 'READY'
          ? HEALTH_STATES.HEALTHY
          : state === 'FAILED'
            ? HEALTH_STATES.FAILED
            : HEALTH_STATES.DEGRADED;
      return buildResult({
        component: 'storage',
        status,
        message: state === 'READY' ? 'Storage engine is ready' : `Storage engine state: ${state}`,
        details: { state, cacheStats, writesPending, documents: counts, rootDir: storage.rootDir ?? null },
        recommendations:
          status === HEALTH_STATES.FAILED
            ? ['Restart the storage engine through the service registry']
            : status === HEALTH_STATES.DEGRADED
              ? ['Initialize the storage engine (registry initializeAll / bootstrap)']
              : [],
        duration: Date.now() - start,
      });
    },
  });
}

// ── logging ─────────────────────────────────────────────────────────
export function createLoggingProvider({ getLogManager = null } = {}) {
  return createHealthProvider({
    name: 'logging',
    description: 'Logging framework statistics',
    async check() {
      const start = Date.now();
      if (!getLogManager) {
        return buildResult({
          component: 'logging',
          status: HEALTH_STATES.UNKNOWN,
          message: 'Logging manager dependency not provided',
          duration: Date.now() - start,
        });
      }
      const mgr = getLogManager();
      const stats = typeof mgr.getStats === 'function' ? mgr.getStats() : null;
      const state = mgr.getState ? mgr.getState() : 'UNKNOWN';
      const dropped = stats?.dropped ?? 0;
      const fileErrors = stats?.fileErrors ?? 0;

      let status = HEALTH_STATES.HEALTHY;
      let message = 'Logging framework is healthy';
      if (fileErrors > 0 || dropped > 0) {
        status = HEALTH_STATES.WARNING;
        message = 'Logging is degraded (dropped entries or file write errors)';
      }
      if (state !== 'READY' && state !== 'STOPPED') {
        status = HEALTH_STATES.DEGRADED;
        message = `Logging manager state: ${state}`;
      }

      return buildResult({
        component: 'logging',
        status,
        message,
        details: { state, ...(stats ?? {}) },
        recommendations:
          dropped > 0
            ? ['Reduce log volume or raise the buffer (maxBufferEntries)']
            : fileErrors > 0
              ? ['Check the log directory permissions and disk space']
              : [],
        duration: Date.now() - start,
      });
    },
  });
}

// ── backup ──────────────────────────────────────────────────────────
export function createBackupProvider({ backup = null } = {}) {
  return createHealthProvider({
    name: 'backup',
    description: 'Backup framework state and registry summary',
    async check() {
      const start = Date.now();
      if (!backup) {
        return buildResult({
          component: 'backup',
          status: HEALTH_STATES.UNKNOWN,
          message: 'Backup manager dependency not provided',
          duration: Date.now() - start,
        });
      }
      const snapshot = typeof backup.status === 'function' ? backup.status() : { state: 'UNKNOWN' };
      let registrySummary = null;
      try {
        const list = typeof backup.listBackups === 'function' ? await backup.listBackups() : [];
        registrySummary = {
          count: list.length,
          latest: list[0] ?? null,
        };
      } catch {
        registrySummary = { count: -1, latest: null, error: 'registry unreadable' };
      }

      const state = snapshot.state ?? 'UNKNOWN';
      const lastFailed =
        registrySummary?.latest?.status && registrySummary.latest.status !== 'completed'
          ? registrySummary.latest.status
          : null;
      let status = HEALTH_STATES.HEALTHY;
      let message = 'Backup framework is healthy';
      if (state === 'FAILED') {
        status = HEALTH_STATES.FAILED;
        message = 'Backup manager failed';
      } else if (state !== 'READY') {
        status = HEALTH_STATES.DEGRADED;
        message = `Backup manager state: ${state}`;
      } else if (lastFailed) {
        status = HEALTH_STATES.WARNING;
        message = `Latest backup did not complete (${lastFailed})`;
      }

      return buildResult({
        component: 'backup',
        status,
        message,
        details: { ...snapshot, registry: registrySummary },
        recommendations:
          lastFailed
            ? ['Run a manual backup and inspect the failure (verify-m43)']
            : registrySummary?.count === 0
              ? ['Create your first backup — no backup exists yet']
              : [],
        duration: Date.now() - start,
      });
    },
  });
}

// ── bootstrap ───────────────────────────────────────────────────────
export function createBootstrapProvider({ getBootstrap = null } = {}) {
  return createHealthProvider({
    name: 'bootstrap',
    description: 'Bootstrap manager state (live)',
    async check() {
      const start = Date.now();
      const boot = typeof getBootstrap === 'function' ? getBootstrap() : null;
      if (!boot) {
        return buildResult({
          component: 'bootstrap',
          status: HEALTH_STATES.UNKNOWN,
          message: 'Bootstrap manager not attached',
          duration: Date.now() - start,
        });
      }
      const statusData =
        typeof boot.getStatus === 'function' ? boot.getStatus() : { state: 'UNKNOWN' };
      const state = statusData.state ?? 'UNKNOWN';
      let status = HEALTH_STATES.HEALTHY;
      let message = 'Bootstrap is ready';
      if (state === 'FAILED') {
        status = HEALTH_STATES.FAILED;
        message = 'Bootstrap failed to start';
      } else if (state === 'UNINITIALIZED' || state === 'STOPPED') {
        status = HEALTH_STATES.WARNING;
        message = `Bootstrap has not started (${state})`;
      } else if (state !== 'READY') {
        status = HEALTH_STATES.WARNING;
        message = `Bootstrap state: ${state}`;
      }
      return buildResult({
        component: 'bootstrap',
        status,
        message,
        details: {
          state,
          startedAt: statusData.startedAt ?? null,
          stoppedAt: statusData.stoppedAt ?? null,
          errors: Array.isArray(statusData.errors) ? statusData.errors.length : 0,
        },
        recommendations: status === HEALTH_STATES.FAILED ? ['Run the bootstrap manager and inspect its errors'] : [],
        duration: Date.now() - start,
      });
    },
  });
}

// ── registry ────────────────────────────────────────────────────────
export function createRegistryProvider({ registry = null } = {}) {
  return createHealthProvider({
    name: 'registry',
    description: 'Service inventory and lifecycle states',
    async check() {
      const start = Date.now();
      if (!registry || typeof registry.getStates !== 'function') {
        return buildResult({
          component: 'registry',
          status: HEALTH_STATES.UNKNOWN,
          message: 'Service registry dependency not provided',
          duration: Date.now() - start,
        });
      }
      const states = registry.getStates();
      const names = typeof registry.names === 'function' ? registry.names() : Object.keys(states);
      const stateValues = Object.values(states);
      const failed = names.filter((n) => states[n] === 'FAILED');
      const notReady = names.filter((n) => states[n] && states[n] !== 'READY');

      let status = HEALTH_STATES.HEALTHY;
      let message = 'All services are READY';
      if (failed.length > 0) {
        status = HEALTH_STATES.DEGRADED;
        message = `Service(s) FAILED: ${failed.join(', ')}`;
      } else if (notReady.length > 0) {
        status = HEALTH_STATES.WARNING;
        message = `Service(s) not READY: ${notReady.join(', ')}`;
      }
      return buildResult({
        component: 'registry',
        status,
        message,
        details: { services: states, count: names.length, states: stateValues },
        recommendations:
          failed.length > 0
            ? ['Restart the failed service(s) through the service manager']
            : notReady.length > 0
              ? ['Initialize all services (registry initializeAll / bootstrap)']
              : [],
        duration: Date.now() - start,
      });
    },
  });
}

// ── lifecycle ───────────────────────────────────────────────────────
export function createLifecycleProvider({ manager = null, registry = null } = {}) {
  return createHealthProvider({
    name: 'lifecycle',
    description: 'Health manager lifecycle and aggregate service states',
    async check() {
      const start = Date.now();
      const resolved = typeof manager === 'function' ? manager() : manager;
      const managerState = resolved?.getState ? resolved.getState() : 'UNKNOWN';
      const serviceStates = {};
      if (registry && typeof registry.getStates === 'function') {
        for (const state of Object.values(registry.getStates())) {
          serviceStates[state] = (serviceStates[state] ?? 0) + 1;
        }
      }
      const failedServices = (serviceStates.FAILED ?? 0) + (serviceStates.STOPPED ?? 0);
      let status = HEALTH_STATES.HEALTHY;
      let message = 'Lifecycle is healthy';
      if (managerState === 'FAILED') {
        status = HEALTH_STATES.FAILED;
        message = 'Health manager failed';
      } else if (failedServices > 0) {
        status = HEALTH_STATES.DEGRADED;
        message = `${failedServices} service(s) are FAILED/STOPPED`;
      } else if (managerState !== 'READY' || Object.keys(serviceStates).some((s) => s !== 'READY')) {
        status = HEALTH_STATES.WARNING;
        message = `Lifecycle not fully ready (manager=${managerState})`;
      }
      return buildResult({
        component: 'lifecycle',
        status,
        message,
        details: { managerState, serviceStates, facts: getSystemFacts() },
        recommendations:
          failedServices > 0 ? ['Restart the failed/stopped service(s)'] : [],
        duration: Date.now() - start,
      });
    },
  });
}
