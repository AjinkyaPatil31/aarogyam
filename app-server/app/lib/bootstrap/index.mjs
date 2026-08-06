/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Runtime Bootstrap Manager  (Milestone 3.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    The single entry point for infrastructure initialization. It
 *    drives the deterministic startup sequence:
 *
 *      1. configuration      — already resolved by app/lib/config at
 *                              import; a coherence check runs first
 *      2. installation       — detect first launch, run the installer,
 *                              or verify an existing installation
 *      3. upgrade detection  — record version changes (no migrations)
 *      4. registry           — initialize every infrastructure service
 *                              in dependency order
 *
 *    and the graceful shutdown sequence:
 *
 *      1. stop registry services in REVERSE dependency order
 *      2. drain in-flight async log writes (flush)
 *      3. release resources, mark STOPPED
 *
 *  HARD CONSTRAINT: nothing starts automatically. initialize() must be
 *  called explicitly (future service manager / installer UI). Importing
 *  this module performs no filesystem writes and opens no resources.
 *
 *  Future purpose:
 *    The service-manager milestone calls initialize() once at process
 *    start and registers shutdown() on SIGINT/SIGTERM.
 *
 *  Dependencies:
 *    app/lib/config, app/lib/lifecycle, app/lib/installer,
 *    app/lib/system/registry, app/lib/logging. No cycles — this module
 *    is the top of the dependency graph alongside the registry.
 */

import { get } from '../config/index.mjs';
import { LIFECYCLE_STATES, createLifecycle } from '../lifecycle/index.mjs';
import { createInstaller } from '../installer/index.mjs';
import { createRegistry, registerInfrastructureServices } from '../system/registry.mjs';
import { createLogger, flushLogs } from '../logging/index.mjs';

/**
 * Create a bootstrap manager.
 * @param {object} [options]
 * @param {object} [options.installer]  custom installer (injectable for tests)
 * @param {object} [options.registry]   custom registry (injectable for tests)
 */
export function createBootstrapManager(options = {}) {
  const lifecycle = createLifecycle(LIFECYCLE_STATES.UNINITIALIZED);
  const installer = options.installer ?? createInstaller();
  const registry = options.registry ?? registerInfrastructureServices();
  const log = createLogger('bootstrap');
  let startedAt = null;
  let stoppedAt = null;
  const errors = [];

  const manager = {
    installer,
    registry,
    lifecycle,

    getState: () => lifecycle.getState(),

    /** Snapshot of bootstrap + registry + installation status. */
    getStatus() {
      return {
        state: lifecycle.getState(),
        startedAt,
        stoppedAt,
        errors: [...errors],
        config: {
          appName: get('app.name', 'Aarogyam'),
          environment: get('env.isProduction', false) ? 'production' : 'development',
        },
        registry: registry.getStates(),
      };
    },

    /**
     * Run the full bootstrap sequence. Idempotent at the manager level
     * (a READY bootstrap is left untouched). On failure the manager
     * transitions to FAILED and rethrows; it may be retried.
     */
    async initialize() {
      if (lifecycle.getState() === LIFECYCLE_STATES.READY) return manager.getStatus();
      lifecycle.transitionTo(LIFECYCLE_STATES.INITIALIZING);
      startedAt = new Date().toISOString();
      log.info('Bootstrap starting');
      try {
        // 1. Configuration — resolved at import; verify coherence first.
        const appName = get('app.name', '');
        if (typeof appName !== 'string' || appName.length === 0) {
          throw new Error('Configuration check failed: app.name is empty');
        }

        // 2. Installation — first launch installs, otherwise verify.
        const installed = await installer.isInstalled();
        if (!installed) {
          log.info('First launch detected — running installer');
          const result = await installer.install();
          log.info('Installer completed', { firstLaunch: result.firstLaunch });
        } else {
          log.info('Existing installation found — verifying integrity');
          const verified = await installer.verifyInstallation();
          if (!verified.ok) {
            log.warn('Installation integrity issues detected', {
              failed: verified.checks.filter((c) => !c.ok).map((c) => c.name),
            });
          }
        }

        // 3. Upgrade detection — no migrations. When a version change is
        //    detected on an existing installation, persist it (install()
        //    is idempotent and records the upgrade in metadata).
        const upgrade = await installer.checkUpgrade();
        if (upgrade.upgraded) {
          log.warn('Application version change detected — persisting', {
            from: upgrade.previousVersion,
            to: upgrade.currentVersion,
          });
          await installer.install();
        }

        // 4. Infrastructure registry — initialize in dependency order.
        registry.initializeAll();

        // 4b. Attach this bootstrap manager to the health framework so
        //     the 'bootstrap' health provider can report live state.
        const health = registry.instances().health;
        if (health && typeof health.attachBootstrap === 'function') {
          health.attachBootstrap(manager);
        }

        lifecycle.transitionTo(LIFECYCLE_STATES.READY);
        log.info('Bootstrap ready');
        return manager.getStatus();
      } catch (err) {
        errors.push({ at: new Date().toISOString(), message: err.message, stack: err.stack });
        lifecycle.transitionTo(LIFECYCLE_STATES.FAILED);
        log.error('Bootstrap failed', err);
        throw err;
      }
    },

    /**
     * Graceful shutdown: stop registry services in reverse dependency
     * order, drain pending log writes, then mark STOPPED. Safe to call
     * from any state; idempotent once STOPPED.
     */
    async shutdown() {
      const state = lifecycle.getState();
      if (state === LIFECYCLE_STATES.STOPPED) return manager.getStatus();

      if (state === LIFECYCLE_STATES.UNINITIALIZED) {
        stoppedAt = new Date().toISOString();
        lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
        log.info('Bootstrap shutdown (never started)');
        return manager.getStatus();
      }

      lifecycle.transitionTo(LIFECYCLE_STATES.STOPPING);
      stoppedAt = new Date().toISOString();
      log.info('Bootstrap shutting down');

      // 1. Stop infrastructure services in reverse dependency order.
      try {
        await registry.shutdownAll();
      } catch (err) {
        errors.push({ at: new Date().toISOString(), message: err.message });
        log.error('Shutdown error while stopping services', err);
      }

      // 2. Flush — guarantee every buffered async log write reaches
      //    disk (the logging framework's flush drains its bounded buffer
      //    and waits for the drain loop to finish).
      await flushLogs();

      // 3. Mark stopped.
      lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
      log.info('Bootstrap stopped');
      return manager.getStatus();
    },
  };

  return manager;
}
