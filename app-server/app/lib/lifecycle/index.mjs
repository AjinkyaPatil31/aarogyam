/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Lifecycle Interfaces  (Milestone 3.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Standardize infrastructure lifecycle. Every stateful component
 *    (service registry entries, bootstrap manager) tracks its state
 *    through the same six states and the same transition rules, so
 *    startup and shutdown ordering is predictable across the app.
 *
 *  States:
 *    UNINITIALIZED  created / registered, never started
 *    INITIALIZING   initialization in progress
 *    READY          initialized and operational
 *    FAILED         initialization failed (retryable)
 *    STOPPING       shutdown in progress
 *    STOPPED        shut down (or never started)
 *
 *  Future purpose:
 *    The service-manager milestone surfaces these states on a status
 *    page / health endpoint and drives auto-restart from FAILED.
 *
 *  Dependencies: none (pure ECMAScript — cannot participate in an
 *    import cycle).
 */

/** Canonical lifecycle states. */
export const LIFECYCLE_STATES = Object.freeze({
  UNINITIALIZED: 'UNINITIALIZED',
  INITIALIZING: 'INITIALIZING',
  READY: 'READY',
  FAILED: 'FAILED',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
});

/**
 * Allowed transitions. Self-transitions (e.g. STOPPED → STOPPED) are
 * treated as idempotent no-ops by createLifecycle and are not listed.
 */
const VALID_TRANSITIONS = Object.freeze({
  UNINITIALIZED: ['INITIALIZING', 'STOPPED'],
  INITIALIZING: ['READY', 'FAILED', 'STOPPING'],
  READY: ['STOPPING'],
  FAILED: ['UNINITIALIZED', 'INITIALIZING', 'STOPPING', 'STOPPED'],
  STOPPING: ['STOPPED'],
  STOPPED: ['UNINITIALIZED', 'INITIALIZING', 'STOPPED'],
});

/** Thrown when a component attempts an illegal state transition. */
export class LifecycleError extends Error {
  constructor(from, to) {
    super(
      `[Aarogyam] Illegal lifecycle transition "${from}" → "${to}" (see LIFECYCLE_STATES).`
    );
    this.name = 'LifecycleError';
    this.code = 'AAROGYAM_LIFECYCLE';
    this.from = from;
    this.to = to;
  }
}

/** True when `to` is reachable from `from` (or they are equal). */
export function canTransition(from, to) {
  return from === to || (VALID_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Throw a LifecycleError when `from → to` is not allowed.
 * Returns `true` when the transition is legal.
 */
export function assertValidTransition(from, to) {
  if (!canTransition(from, to)) throw new LifecycleError(from, to);
  return true;
}

/**
 * Create a small state machine.
 * @param {string} [initial=LIFECYCLE_STATES.UNINITIALIZED]
 * @returns {{ state: string, getState(): string,
 *   canTransitionTo(next): boolean, transitionTo(next): string,
 *   getHistory(): Array<{from,to,at}> }}
 */
export function createLifecycle(initial = LIFECYCLE_STATES.UNINITIALIZED) {
  let state = initial;
  const history = [];

  return {
    /** Current state (getter — convenient for logs). */
    get state() {
      return state;
    },
    getState: () => state,
    canTransitionTo: (next) => canTransition(state, next),
    /** Move to `next`, recording the transition. Idempotent when equal. */
    transitionTo(next) {
      if (next === state) return state;
      assertValidTransition(state, next);
      history.push({ from: state, to: next, at: new Date().toISOString() });
      state = next;
      return state;
    },
    /** Immutable snapshot of every transition so far. */
    getHistory: () => [...history],
  };
}
