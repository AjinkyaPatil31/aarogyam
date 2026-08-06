/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Service Registry  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Lightweight registry that lets future infrastructure services be
 *    registered and initialized in ONE place.
 *
 *  HARD CONSTRAINT: registering services starts NOTHING. Services are
 *    lazy — they are only constructed when initialize()/initializeAll()
 *    is explicitly called by a future milestone. No sockets open, no
 *    background processes begin, no filesystem changes occur at import
 *    or registration time.
 *
 *  Future purpose:
 *    Installer / service-manager milestones call
 *    `registry.initializeAll()` once at startup to bring up storage,
 *    logging, backup, discovery and sync in dependency order.
 *
 *  Dependencies: every infrastructure module (paths, fsutil, flags,
 *    logging, storage, backup, discovery, sync). No cycles — this
 *    module is the top of the dependency graph.
 */

import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { getFlags } from '../local/flags.mjs';
import { createLogger } from '../logging/index.mjs';
import { createStorageService } from '../storage/index.mjs';
import { createBackupManager } from '../backup/index.mjs';
import { createDiscoveryService } from '../discovery/index.mjs';
import { createSyncService } from '../sync/index.mjs';

/**
 * Create an empty service registry.
 * @param {{ autoStart?: boolean }} [options] — future switch; default
 *   keeps everything manual (nothing starts automatically).
 */
export function createRegistry(options = {}) {
  const services = new Map();
  const instances = new Map();
  // Tracks names currently being initialized, to detect dependency cycles.
  const inProgress = new Set();

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
      // Initialize dependencies first (recursive, cycle-detected via set).
      inProgress.add(name);
      try {
        for (const dep of svc.dependencies) {
          if (!instances.has(dep) && services.has(dep)) registry.initialize(dep);
        }
        const instance = svc.factory();
        instances.set(name, instance);
        return instance;
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

    /** Explicitly stop a constructed service (no-op for now). */
    async stop(name) {
      instances.delete(name);
    },

    /** Stop all constructed services (no-op for now). */
    async stopAll() {
      instances.clear();
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
