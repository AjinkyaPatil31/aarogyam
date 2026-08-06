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

/**
 * Structured error raised by the installer (Milestone 3.3 / 4.2) when
 * installation cannot complete. Carries the original failure as
 * `cause` so the logging framework can preserve the root stack.
 */
export class InstallerError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'InstallerError';
    this.code = 'AAROGYAM_INSTALLER';
    if (cause) this.cause = cause;
  }
}

/**
 * Structured error raised by the storage engine (Milestone 4.1) when a
 * document fails integrity validation or an operation cannot complete.
 * Carries a machine-readable `code` (e.g. 'invalid-json',
 * 'checksum-mismatch', 'unsupported-version', 'missing-document',
 * 'transaction-failed') plus `ns` / `key` context when available.
 */
export class StorageError extends Error {
  constructor(code, message, { ns = null, key = null } = {}) {
    super(`[Aarogyam] Storage error (${code}): ${message}`);
    this.name = 'StorageError';
    this.code = code;
    this.ns = ns;
    this.key = key;
  }
}
