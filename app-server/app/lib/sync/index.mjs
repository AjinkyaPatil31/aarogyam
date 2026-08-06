/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Offline Synchronization Foundation  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Interfaces for a future offline sync engine: operation queue,
 *    sync engine, conflict resolver and version tracking.
 *
 *  HARD CONSTRAINT: nothing here runs. Every capability is an inert
 *  interface that throws NotImplementedError — the offline milestone
 *  supplies the real implementations.
 *
 *  Future purpose:
 *    Offline mode milestone implements these so that operations recorded
 *    while disconnected can be queued, synced, conflict-resolved and
 *    version-tracked against the clinic server.
 *
 *  Dependencies: app/lib/local/errors.
 */

import { NotImplementedError } from '../local/errors.mjs';

/** Operation queue — future: durable FIFO of offline operations. */
export function createOperationQueue(options = {}) {
  return {
    type: 'operation-queue',
    enqueue: async () => {
      throw new NotImplementedError('Operation queue enqueue');
    },
    dequeue: async () => {
      throw new NotImplementedError('Operation queue dequeue');
    },
    size: async () => {
      throw new NotImplementedError('Operation queue size');
    },
  };
}

/** Sync engine — future: push/pull operations to/from the server. */
export function createSyncEngine(options = {}) {
  return {
    type: 'sync-engine',
    push: async () => {
      throw new NotImplementedError('Sync engine push');
    },
    pull: async () => {
      throw new NotImplementedError('Sync engine pull');
    },
    sync: async () => {
      throw new NotImplementedError('Sync engine sync');
    },
  };
}

/** Conflict resolver — future: merge divergent records deterministically. */
export function createConflictResolver(options = {}) {
  return {
    type: 'conflict-resolver',
    resolve: async () => {
      throw new NotImplementedError('Conflict resolver');
    },
  };
}

/** Version tracker — future: monotonically increasing sync versions. */
export function createVersionTracker(options = {}) {
  return {
    type: 'version-tracker',
    current: async () => {
      throw new NotImplementedError('Version tracker current');
    },
    bump: async () => {
      throw new NotImplementedError('Version tracker bump');
    },
  };
}

/** Convenience bundle of all sync interfaces (all inert). */
export function createSyncService(options = {}) {
  return {
    queue: createOperationQueue(options),
    engine: createSyncEngine(options),
    resolver: createConflictResolver(options),
    tracker: createVersionTracker(options),
  };
}
