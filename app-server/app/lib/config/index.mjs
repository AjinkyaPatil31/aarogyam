/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Runtime Configuration Access  (Milestone 3.1, Task 6)
 * ─────────────────────────────────────────────────────────────────────
 *  THE single interface for reading configuration at runtime.
 *
 *  Use `config.<section>.<key>` or `get('<section>.<key>', fallback)`.
 *  Do NOT read process.env directly elsewhere in the application —
 *  route everything through this module (and schema.mjs for metadata).
 *
 *  Example:
 *    import { config } from '@/app/lib/config/index.mjs';
 *    config.session.idleTimeoutMinutes   // → number
 *    config.app.url                      // → 'http://localhost:3000'
 *
 *  The returned object is deeply frozen; it is built once from
 *  schema.mjs + defaults.mjs + process.env and is safe to share
 *  between server routes, middleware, and standalone scripts.
 */

import { DEFAULTS } from './defaults.mjs';
import { SCHEMA } from './schema.mjs';

/** Resolve a dotted default path inside DEFAULTS. */
function resolveDefault(defaultKey) {
  return defaultKey
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), DEFAULTS);
}

/** Coerce a raw env string into the schema-declared type. */
function coerce(raw, entry) {
  const value = String(raw).trim();
  switch (entry.type) {
    case 'number': {
      const n = parseInt(value, 10);
      return Number.isNaN(n) ? resolveDefault(entry.defaultKey) : n;
    }
    case 'boolean':
      return ['true', '1'].includes(value.toLowerCase());
    case 'object':
      return resolveDefault(entry.defaultKey); // structural default
    case 'enum':
      return entry.options.includes(value)
        ? value
        : resolveDefault(entry.defaultKey);
    default:
      return value;
  }
}

/** Write a value at a dotted path, creating intermediate objects. */
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let node = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!node[keys[i]]) node[keys[i]] = {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

/** Build the full configuration object from schema + env + defaults. */
export function buildConfig() {
  const cfg = {};

  for (const entry of SCHEMA) {
    const raw = entry.env ? process.env[entry.env] : undefined;
    const hasValue = raw !== undefined && String(raw).trim() !== '';
    const value = hasValue ? coerce(raw, entry) : resolveDefault(entry.defaultKey);
    setPath(cfg, entry.key, value);
  }

  // Derived runtime environment (framework-managed, not a schema key).
  cfg.env = {
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV !== 'production',
  };

  // Derived cookie security flag — cookies are always secure in prod.
  cfg.session.cookie.secure = cfg.env.isProduction;
  cfg.session.refreshCookie.secure = cfg.env.isProduction;

  return cfg;
}

/**
 * The frozen, fully-resolved runtime configuration.
 * Build once at module load; never mutate.
 */
export const config = deepFreeze(buildConfig());

/**
 * Read a configuration value by dotted path, with an optional fallback.
 *   get('whatsapp.provider')              // → 'webjs'
 *   get('future.offlineMode.enabled', false)
 */
export function get(path, fallback) {
  const value = path
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), config);
  return value === undefined ? fallback : value;
}
