/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Service Registry  (Milestone 3.2 / 3.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Lightweight registry that lets future infrastructure services be
 *    registered, initialized and stopped in ONE place. Milestone 3.3
 *    adds lifecycle state tracking per service and graceful shutdown
 *    in reverse dependency order.
 *
 *  HARD CONSTRAINT: registering services starts NOTHING. Services are
 *    lazy — they are only constructed when initialize()/initializeAll()
 *    is explicitly called. No sockets open, no background processes
 *    begin, no filesystem changes occur at import or registration time.
 *
 *  Lifecycle (see app/lib/lifecycle):
 *    UNINITIALIZED → INITIALIZING → READY   (FAILED on error)
 *    READY/FAILED  → STOPPING     → STOPPED
 *    Service instances may expose shutdown() — it is awaited during
 *    stop() when present.
 *
 *  Shutdown order: services are stopped in the REVERSE of their
 *  initialization order (dependencies are initialized before dependents,
 *  so dependents are stopped before their dependencies).
 *
 *  Future purpose:
 *    Service-manager milestone calls registry.shutdownAll() on process
 *    exit and exposes getStates() on a status endpoint.
 *
 *  Dependencies: every infrastructure module (paths, fsutil, flags,
 *    logging, storage, backup, discovery, sync) + app/lib/lifecycle.
 *    No cycles — this module is the top of the dependency graph.
 */

import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { getFlags } from '../local/flags.mjs';
import { createLogger } from '../logging/index.mjs';
import { createStorageService } from '../storage/index.mjs';
import { createBackupManager } from '../backup/index.mjs';
import { createDiscoveryService } from '../discovery/index.mjs';
import { createSyncService } from '../sync/index.mjs';
import { LIFECYCLE_STATES, createLifecycle } from '../lifecycle/index.mjs';

/**
 * Create an empty service registry.
 * @param {{ autoStart?: boolean }} [options] — future switch; default
 *   keeps everything manual (nothing starts automatically).
 */
export function createRegistry(options = {}) {
  const services = new Map();
  const instances = new Map();
  const lifecycles = new Map();
  // Tracks names currently being initialized, to detect dependency cycles.
  const inProgress = new Set();
  // Initialization order — reversed for shutdown (dependencies first).
  const initOrder = [];

  const registry = {
    /**
     * Register a lazy service factory.
     * @param {string} name
     * @param {() => any} factory  constructs the service when initialized
     * @param {string[]} [dependencies]  other registered service names
     */
    register(name, factory, dependencies = []) {
      if (typeof name !== 'string' || typeof factory !== 'function') {
        throw new TypeError('register(name, factory) requires a name and factory function');
      }
      services.set(name, { name, factory, dependencies: [...dependencies] });
      lifecycles.set(name, createLifecycle(LIFECYCLE_STATES.UNINITIALIZED));
      return registry;
    },

    /** True when a service name is registered. */
    has(name) {
      return services.has(name);
    },

    /** List registered service names. */
    names() {
      return [...services.keys()];
    },

    /** Get a registered service descriptor (does not construct it). */
    descriptor(name) {
      return services.get(name) ?? null;
    },

    /** True when the service instance has been constructed. */
    isInitialized(name) {
      return instances.has(name);
    },

    /** Current lifecycle state of a service. */
    getState(name) {
      return lifecycles.get(name)?.getState() ?? LIFECYCLE_STATES.UNINITIALIZED;
    },

    /** Snapshot of every service's lifecycle state. */
    getStates() {
      return Object.fromEntries(
        [...lifecycles.entries()].map(([name, lc]) => [name, lc.getState()])
      );
    },

    /** Construct (once) and return a service instance. */
    initialize(name) {
      const svc = services.get(name);
      if (!svc) throw new Error(`Service "${name}" is not registered`);
      if (instances.has(name)) return instances.get(name);
      if (inProgress.has(name)) {
        throw new Error(
          `Circular service dependency detected at "${name}" — aborting initialization`
        );
      }
      const lifecycle = lifecycles.get(name);
      lifecycle.transitionTo(LIFECYCLE_STATES.INITIALIZING);
      // Initialize dependencies first (recursive, cycle-detected via set).
      inProgress.add(name);
      try {
        for (const dep of svc.dependencies) {
          if (!instances.has(dep) && services.has(dep)) registry.initialize(dep);
        }
        const instance = svc.factory();
        instances.set(name, instance);
        if (!initOrder.includes(name)) initOrder.push(name);
        lifecycle.transitionTo(LIFECYCLE_STATES.READY);
        return instance;
      } catch (err) {
        lifecycle.transitionTo(LIFECYCLE_STATES.FAILED);
        throw err;
      } finally {
        inProgress.delete(name);
      }
    },

    /** Construct every registered service (in registration order). */
    initializeAll() {
      for (const name of services.keys()) registry.initialize(name);
      return registry.instances();
    },

    /** Map of constructed service name → instance. */
    instances() {
      return Object.fromEntries(instances.entries());
    },

    /**
     * Gracefully stop one service: transition STOPPING → await
     * instance.shutdown() (when present) → STOPPED. Idempotent.
     */
    async stop(name) {
      const svc = services.get(name);
      if (!svc) throw new Error(`Service "${name}" is not registered`);
      const lifecycle = lifecycles.get(name);
      if (lifecycle.getState() === LIFECYCLE_STATES.STOPPED) return;
      if (!instances.has(name)) {
        lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
        return;
      }
      lifecycle.transitionTo(LIFECYCLE_STATES.STOPPING);
      const instance = instances.get(name);
      try {
        if (instance && typeof instance.shutdown === 'function') {
          await instance.shutdown();
        }
      } finally {
        instances.delete(name);
        lifecycle.transitionTo(LIFECYCLE_STATES.STOPPED);
      }
    },

    /**
     * Stop every initialized service in REVERSE dependency order
     * (reverse of initialization order). A failing service shutdown is
     * collected and the remaining services are still stopped — a
     * partially-stopped registry is never left behind. Throws after
     * cleanup when any service reported an error.
     */
    async shutdownAll() {
      const order = [...initOrder].reverse();
      const errors = [];
      for (const name of order) {
        try {
          await registry.stop(name);
        } catch (err) {
          errors.push({ service: name, message: err.message });
        }
      }
      initOrder.length = 0;
      if (errors.length > 0) {
        throw new Error(
          `Shutdown completed with ${errors.length} service error(s): ${errors
            .map((e) => `${e.service} (${e.message})`)
            .join('; ')}`
        );
      }
    },
  };

  return registry;
}

/**
 * Register every infrastructure service in the canonical order.
 * @returns {ReturnType<typeof createRegistry>} the populated registry
 */
export function registerInfrastructureServices(registry = createRegistry()) {
  registry
    .register('paths', () => paths)
    .register('fsutil', () => fsutil)
    .register('flags', () => getFlags())
    .register('logging', () => createLogger('aarogyam'))
    .register('storage', () => createStorageService(paths.dataDir))
    .register('backup', () => createBackupManager())
    .register('discovery', () => createDiscoveryService())
    .register('sync', () => createSyncService());
  return registry;
}

/** Convenience: create + register + (optionally) initialize all. */
export function createInfrastructure({ initialize = false } = {}) {
  const registry = registerInfrastructureServices();
  if (initialize) registry.initializeAll();
  return registry;
}
