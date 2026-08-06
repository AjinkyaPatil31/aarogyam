/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Health Model  (Milestone 4.4)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    The standardized health vocabulary: the five health states, their
 *    severity ordering (for aggregation) and the canonical result shape
 *    every provider / self-test / diagnostic returns.
 *
 *  States:
 *    HEALTHY   everything expected is working
 *    WARNING   working but noteworthy (e.g. dropped log entries)
 *    DEGRADED  partially available (e.g. some services not READY)
 *    FAILED    an essential check failed
 *    UNKNOWN   cannot be determined (missing dependency, no data)
 *
 *  Aggregation: overall = worst severity present. FAILED > DEGRADED >
 *  WARNING > UNKNOWN > HEALTHY.
 *
 *  Dependencies: none (pure ECMAScript — cannot participate in an
 *    import cycle).
 */

/** Canonical health states. */
export const HEALTH_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  WARNING: 'WARNING',
  DEGRADED: 'DEGRADED',
  FAILED: 'FAILED',
  UNKNOWN: 'UNKNOWN',
});

/** Severity ranking used for aggregation (higher = worse). */
export const HEALTH_SEVERITY = Object.freeze({
  FAILED: 4,
  DEGRADED: 3,
  WARNING: 2,
  UNKNOWN: 1,
  HEALTHY: 0,
});

/**
 * Aggregate a list of states into the overall state: the worst
 * severity present. An empty list aggregates to UNKNOWN.
 */
export function worstState(states) {
  if (!Array.isArray(states) || states.length === 0) return HEALTH_STATES.UNKNOWN;
  let worst = HEALTH_STATES.HEALTHY;
  let worstSeverity = -1;
  for (const state of states) {
    const severity = HEALTH_SEVERITY[state] ?? HEALTH_SEVERITY.UNKNOWN;
    if (severity > worstSeverity) {
      worstSeverity = severity;
      worst = HEALTH_SEVERITY[state] === undefined ? HEALTH_STATES.UNKNOWN : state;
    }
  }
  return worst;
}

/**
 * Build a canonical health result. Guarantees the full required shape:
 * { status, component, message, details, timestamp, duration,
 *   recommendations }.
 * @param {object} fields
 * @param {string} fields.component  provider/component name
 * @param {string} [fields.status=HEALTHY]
 * @param {string} [fields.message='']
 * @param {object} [fields.details={}]
 * @param {string[]} [fields.recommendations]
 * @param {number} [fields.duration] elapsed ms (measured by the caller)
 */
export function buildResult({ component, status = HEALTH_STATES.HEALTHY, message = '', details = {}, recommendations = null, duration = 0 }) {
  return {
    status: HEALTH_STATES[status] ? status : HEALTH_STATES.UNKNOWN,
    component,
    message,
    details: details ?? {},
    timestamp: new Date().toISOString(),
    duration,
    recommendations: recommendations ?? [],
  };
}

/** True when `result` carries the canonical health shape. */
export function isHealthResult(result) {
  return Boolean(
    result &&
      typeof result === 'object' &&
      HEALTH_STATES[result.status] &&
      typeof result.component === 'string' &&
      typeof result.message === 'string' &&
      typeof result.timestamp === 'string' &&
      typeof result.duration === 'number' &&
      Array.isArray(result.recommendations)
  );
}
