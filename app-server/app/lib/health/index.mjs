/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Health & Diagnostics Framework  (Milestone 4.4)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    The single source of truth for infrastructure health, diagnostics,
 *    self-tests and operational reporting. Completely local — no
 *    telemetry, no cloud services, no internet dependencies.
 *
 *  What the manager provides:
 *    • collect()        — run the registered health providers (all
 *                         LIGHTWEIGHT checks) and aggregate the overall
 *                         state (worst severity wins)
 *    • diagnostics()    — on-demand runtime information (version,
 *                         platform, uptime, memory, disk, storage /
 *                         logging / backup / registry / lifecycle
 *                         statistics, configuration summary) — never
 *                         personal or medical data
 *    • runSelfTests()   — on-demand executable verification (storage,
 *                         backup, log-write, configuration, filesystem,
 *                         registry) — never modifies business data
 *    • generateReport() — structured reports (JSON + text, extensible
 *                         via REPORT_FORMATS), optionally saved under
 *                         diagnostics.reportDirectory
 *    • register()       — modular health: providers register themselves
 *    • lifecycle        — initialize() → READY, shutdown() → STOPPED;
 *                         health collection NEVER blocks shutdown (no
 *                         background work, all collection is on-demand)
 *
 *  Performance (req 10):
 *    Default health collection is cheap — state reads and stat calls
 *    only. Expensive work (writability probes, storage.verify(),
 *    isolated log-write probes) runs exclusively in on-demand
 *    self-tests/diagnostics. Cached values (application version,
 *    installation id) are reused across calls.
 *
 *  Safety (quality requirements):
 *    The framework assesses INFRASTRUCTURE state only. No patient,
 *    prescription, appointment, medical-record, authentication or
 *    secret data is read, logged or reported.
 *
 *  Configuration (all via config.get()): health.enabled,
 *    diagnostics.enabled, diagnostics.reportDirectory, selfTest.enabled.
 *
 *  Dependencies: app/lib/config, app/lib/local/paths, app/lib/local/
 *    fsutil, app/lib/lifecycle, app/lib/logging, app/lib/installer,
 *    app/lib/system, app/lib/health/*. No cycles.
 */

import { join } from 'node:path';
import { get } from '../config/index.mjs';
import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { LIFECYCLE_STATES, createLifecycle } from '../lifecycle/index.mjs';
import { createLogger, getLogManager } from '../logging/index.mjs';
import { readAppVersion, installer } from '../installer/index.mjs';
import { getPlatform, getArch, getHostname } from '../system/index.mjs';
import { HEALTH_STATES, buildResult, worstState } from './model.mjs';
import {
  createHealthProvider,
  createConfigurationProvider,
  createFilesystemProvider,
  createStorageProvider,
  createLoggingProvider,
  createBackupProvider,
  createBootstrapProvider,
  createRegistryProvider,
  createLifecycleProvider,
} from './providers.mjs';
import { collectDiagnostics as collectRuntimeDiagnostics } from './diagnostics.mjs';
import { runSelfTests as executeSelfTests, SELF_TESTS } from './selftest.mjs';
import {
  REPORT_FORMAT_VERSION,
  renderJsonReport,
  renderTextReport,
  collectRecommendations,
} from './report.mjs';

export { HEALTH_STATES, HEALTH_SEVERITY, worstState, buildResult, isHealthResult } from './model.mjs';
export {
  createHealthProvider,
  createConfigurationProvider,
  createFilesystemProvider,
  createStorageProvider,
  createLoggingProvider,
  createBackupProvider,
  createBootstrapProvider,
  createRegistryProvider,
  createLifecycleProvider,
} from './providers.mjs';
export { collectDiagnostics, diagnosticsEnabled } from './diagnostics.mjs';
export { runSelfTests, SELF_TESTS, selfTestsEnabled } from './selftest.mjs';
export {
  REPORT_FORMATS,
  REPORT_FORMAT_VERSION,
  renderJsonReport,
  renderTextReport,
  collectRecommendations,
  reportOverall,
  sortBySeverity,
} from './report.mjs';

/** Resolve a non-empty string option with a fallback (config key convention). */
function effective(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

/**
 * Create the health manager.
 * @param {object} [options]
 * @param {boolean} [options.enabled]           health.enabled
 * @param {object}  [options.diagnostics]       { enabled } — diagnostics.enabled
 * @param {object}  [options.selfTest]          { enabled } — selfTest.enabled
 * @param {string}  [options.reportDirectory]   diagnostics.reportDirectory
 * @param {object}  [options.storage]           storage engine service
 * @param {object}  [options.backup]            backup manager
 * @param {object}  [options.registry]          service registry
 * @param {Function} [options.getLogManager]    log manager accessor
 * @param {string}  [options.appVersion]        cached app version override
 */
export function createHealthManager(options = {}) {
  const log = createLogger('health');
  const lifecycle = createLifecycle(LIFECYCLE_STATES.UNINITIALIZED);

  const cfg = {
    enabled: options.enabled ?? get('health.enabled', true),
    diagnostics: options.diagnostics?.enabled ?? get('diagnostics.enabled', true),
    selfTest: options.selfTest?.enabled ?? get('selfTest.enabled', true),
    reportDirectory: effective(
      options.reportDirectory ?? get('diagnostics.reportDirectory', ''),
      join(paths.dataDir, 'diagnostics')
    ),
  };

  const providers = new Map();
  let bootstrapRef = null;
  let cachedAppVersion = options.appVersion ?? null;
  let cachedInstallationId = null;
  let lastCollectedAt = null;
  let lastOverall = null;
  const deps = {
    storage: options.storage ?? null,
    backup: options.backup ?? null,
    registry: options.registry ?? null,
    getLogManager: options.getLogManager ?? (() => getLogManager()),
  };

  // ── Provider registry (modular, replaceable) ──────────────────────
  function register(provider) {
    const p =
      provider && typeof provider.check === 'function'
        ? createHealthProvider(provider)
        : provider;
    if (!p || typeof p.name !== 'string' || typeof p.check !== 'function') {
      throw new TypeError('register() requires a provider with name + check()');
    }
    providers.set(p.name, p);
    return manager;
  }
  function registerDefaults() {
    register(createConfigurationProvider());
    register(createFilesystemProvider());
    register(createStorageProvider({ storage: deps.storage }));
    register(createLoggingProvider({ getLogManager: deps.getLogManager }));
    register(createBackupProvider({ backup: deps.backup }));
    register(createBootstrapProvider({ getBootstrap: () => bootstrapRef }));
    register(createRegistryProvider({ registry: deps.registry }));
    // The lifecycle provider receives the manager via a getter so it
    // observes the manager object once it is constructed.
    register(createLifecycleProvider({ manager: () => manager, registry: deps.registry }));
  }

  // ── Cached values ─────────────────────────────────────────────────
  async function resolveAppVersion() {
    if (cachedAppVersion) return cachedAppVersion;
    try {
      cachedAppVersion = await readAppVersion();
    } catch (err) {
      // Diagnostics must never crash the framework — degrade to a
      // stable placeholder and log, mirroring resolveInstallationId.
      log.warn('Application version could not be read', { error: err.message });
      cachedAppVersion = 'unknown';
    }
    return cachedAppVersion;
  }
  async function resolveInstallationId() {
    if (cachedInstallationId === null) {
      try {
        const meta = await installer.readMetadata();
        cachedInstallationId = meta?.installationId ?? null;
      } catch {
        cachedInstallationId = null;
      }
    }
    return cachedInstallationId;
  }

  // ── Health collection (lightweight) ───────────────────────────────
  async function collect({ providers: only = null } = {}) {
    const collectedAt = new Date().toISOString();
    const started = performance.now();
    if (!cfg.enabled) {
      return {
        enabled: false,
        overall: HEALTH_STATES.UNKNOWN,
        results: [
          buildResult({
            component: 'health',
            status: HEALTH_STATES.UNKNOWN,
            message: 'Health framework is disabled (health.enabled=false)',
          }),
        ],
        collectedAt,
        duration: 0,
      };
    }
    const names = only ?? [...providers.keys()];
    const results = [];
    for (const name of names) {
      const provider = providers.get(name);
      if (!provider) continue;
      const t0 = performance.now();
      try {
        const result = await provider.check();
        results.push({ ...result, duration: Math.round((performance.now() - t0) * 10) / 10 });
      } catch (err) {
        results.push(
          buildResult({
            component: name,
            status: HEALTH_STATES.FAILED,
            message: `Health check threw: ${err.message}`,
            duration: Math.round((performance.now() - t0) * 10) / 10,
          })
        );
      }
    }
    const overall = worstState(results.map((r) => r.status));
    lastCollectedAt = collectedAt;
    lastOverall = overall;
    return {
      enabled: true,
      overall,
      results,
      collectedAt,
      duration: Math.round((performance.now() - started) * 10) / 10,
    };
  }

  // ── Diagnostics + self-tests (on-demand) ──────────────────────────
  async function collectDiagnostics() {
    if (!cfg.diagnostics) {
      return { enabled: false, reason: 'diagnostics disabled (diagnostics.enabled=false)' };
    }
    return collectRuntimeDiagnostics(
      {
        storage: deps.storage,
        backup: deps.backup,
        registry: deps.registry,
        manager,
        getLogManager: deps.getLogManager,
        appVersion: await resolveAppVersion(),
        installationId: await resolveInstallationId(),
      },
      { enabled: true }
    );
  }

  async function runSelfTests({ only = null } = {}) {
    if (!cfg.selfTest) {
      return {
        overall: HEALTH_STATES.UNKNOWN,
        results: [
          buildResult({
            component: 'selftest',
            status: HEALTH_STATES.UNKNOWN,
            message: 'Self-tests are disabled (selfTest.enabled=false)',
          }),
        ],
      };
    }
    return executeSelfTests(
      { storage: deps.storage, backup: deps.backup, registry: deps.registry },
      { only, enabled: true }
    );
  }

  // ── Reports ───────────────────────────────────────────────────────
  async function generateReport({ includeSelfTests = false, save = false } = {}) {
    const health = await collect();
    const diagnostics = await collectDiagnostics();
    const selfTests = includeSelfTests ? (await runSelfTests()).results : null;
    const report = {
      $schema: 'aarogyam-health-report',
      formatVersion: REPORT_FORMAT_VERSION,
      generatedAt: new Date().toISOString(),
      appVersion: await resolveAppVersion(),
      overall: health.overall,
      health: health.results,
      diagnostics,
      selfTests,
      recommendations: collectRecommendations([...(health.results ?? []), ...(selfTests ?? [])]),
      metadata: {
        platform: getPlatform(),
        arch: getArch(),
        hostname: getHostname(),
        nodeVersion: process.version,
        pid: process.pid,
      },
    };
    const json = renderJsonReport(report);
    const text = renderTextReport(report);
    let saved = null;
    if (save) saved = await saveReport(report);
    log.info('Health report generated', {
      overall: report.overall,
      providers: (report.health ?? []).length,
      selfTests: (report.selfTests ?? []).length,
      saved: Boolean(saved),
    });
    return { report, json, text, saved };
  }

  async function saveReport(report) {
    await fsutil.ensureDir(cfg.reportDirectory);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const base = join(cfg.reportDirectory, `aarogyam-health-${stamp}`);
    const jsonPath = `${base}.json`;
    const textPath = `${base}.txt`;
    await fsutil.writeJson(jsonPath, report);
    await fsutil.atomicWriteFile(textPath, renderTextReport(report));
    log.info('Health report saved', { json: jsonPath, text: textPath });
    return { directory: cfg.reportDirectory, json: jsonPath, text: textPath };
  }

  // ── Lifecycle (health collection never blocks shutdown) ───────────
  function initialize() {
    if (lifecycle.getState() === LIFECYCLE_STATES.READY) return manager;
    lifecycle.transitionTo(LIFECYCLE_STATES.INITIALIZING);
    lifecycle.transitionTo(LIFECYCLE_STATES.READY);
    log.info('Health manager initialized', {
      enabled: cfg.enabled,
      diagnostics: cfg.diagnostics,
      selfTest: cfg.selfTest,
      providers: manager.list().map((p) => p.name),
    });
    return manager;
  }

  async function shutdown() {
    const state = lifecycle.getState();
    if (state === LIFECYCLE_STATES.STOPPED) return manager;
    lifecycle.transitionTo(LIFECYCLE_STATES.STOPPING);
    // No background collection exists — nothing to drain; transition
    // completes immediately, so health collection can never block
    // application shutdown.
    lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
    log.info('Health manager shutdown complete');
    return manager;
  }

  function status() {
    return {
      state: lifecycle.getState(),
      enabled: cfg.enabled,
      providers: manager.list().map((p) => p.name),
      diagnostics: cfg.diagnostics,
      selfTest: cfg.selfTest,
      reportDirectory: cfg.reportDirectory,
      lastCollectedAt,
      lastOverall,
    };
  }

  // ── Manager surface ───────────────────────────────────────────────
  const manager = {
    register,
    list() {
      return [...providers.values()].map((p) => p.describe());
    },
    get(name) {
      return providers.get(name) ?? null;
    },
    getState: () => lifecycle.getState(),
    initialize,
    shutdown,
    status,
    collect,
    /** Alias — lightweight health snapshot. */
    getHealth: (opts) => collect(opts),
    collectDiagnostics,
    runSelfTests,
    generateReport,
    saveReport,
    /** Attach the live bootstrap manager (called by the bootstrap). */
    attachBootstrap(boot) {
      bootstrapRef = boot;
      log.info('Bootstrap manager attached to health framework');
      return manager;
    },
    /** Canonical self-test names (informational). */
    selfTestNames: [...SELF_TESTS],
  };

  // Default providers register themselves (replaceable via register()).
  registerDefaults();

  return manager;
}
