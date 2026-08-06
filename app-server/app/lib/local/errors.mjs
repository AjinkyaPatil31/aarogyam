/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Shared Local Edition Error Types  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Single home for error classes shared by the local infrastructure
 *    modules (discovery, sync, backup). Avoids duplicated error
 *    definitions across modules.
 *
 *  Future purpose:
 *    Installer, service manager and LAN milestones will throw these
 *    errors so that callers can react predictably (e.g. surface a
 *    friendly message instead of an opaque stack trace).
 *
 *  Dependencies: none (pure ECMAScript classes).
 */

/**
 * Thrown by infrastructure interfaces whose implementation is deferred
 * to a future milestone. Guarantees that "architecture only" modules can
 * never silently pretend to do work they do not support yet.
 */
export class NotImplementedError extends Error {
  constructor(feature) {
    super(`[Aarogyam] "${feature}" is not implemented yet — reserved for a future milestone.`);
    this.name = 'NotImplementedError';
    this.code = 'AAROGYAM_NOT_IMPLEMENTED';
  }
}

/**
 * Thrown when an infrastructure service is used before it has been
 * initialized through the Service Registry.
 */
export class ServiceNotInitializedError extends Error {
  constructor(name) {
    super(`[Aarogyam] Service "${name}" has not been initialized.`);
    this.name = 'ServiceNotInitializedError';
    this.code = 'AAROGYAM_SERVICE_NOT_INITIALIZED';
  }
}

/**
 * Thrown when a runtime path resolves outside an allowed base directory.
 */
export class PathViolationError extends Error {
  constructor(message) {
    super(`[Aarogyam] Path violation: ${message}`);
    this.name = 'PathViolationError';
    this.code = 'AAROGYAM_PATH_VIOLATION';
  }
}
