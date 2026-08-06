/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Configuration Validation  (Milestone 3.1, Task 5)
 * ─────────────────────────────────────────────────────────────────────
 *  Single, centralized validation entry point. It is invoked by
 *  scripts/validate-config.mjs, which is wired into the npm
 *  dev / build / start scripts so the application fails fast at
 *  startup with clear, actionable errors when configuration is invalid.
 *
 *  Validation is intentionally NOT scattered through the codebase.
 *  Do not add per-module validation — extend this file instead.
 */

import { SCHEMA, LEGACY } from './schema.mjs';

const NUMBER_RE = /^\d+$/;
const TRUE_VALUES = new Set(['true', '1']);
const BOOLEAN_VALUES = new Set(['true', 'false', '1', '0']);

function isValidNumber(raw) {
  return NUMBER_RE.test(String(raw).trim());
}

function isValidUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates the supplied environment against the config schema.
 *
 * @param {object} env  environment mapping (defaults to process.env)
 * @returns {{ ok: true, schema: object[], legacy: object[] }}
 * @throws {Error} aggregated, human-readable validation errors
 */
export function validateConfig(env = process.env) {
  const errors = [];

  for (const entry of SCHEMA) {
    // Future keys are structure-only; nothing consumes them yet.
    if (entry.status === 'future' || !entry.env) continue;

    const raw = env[entry.env];
    const unset = raw === undefined || String(raw).trim() === '';

    if (entry.required) {
      if (unset) {
        errors.push(
          `  • ${entry.env}: REQUIRED but not set. Add it to app-server/.env.local (or .env).`
        );
        continue;
      }
    } else if (unset) {
      continue; // optional + unset → default applies
    }

    const value = String(raw).trim();

    if (entry.type === 'number' && !isValidNumber(value)) {
      errors.push(
        `  • ${entry.env}: must be a positive integer, got "${value}".`
      );
    }
    if (entry.type === 'url' && !isValidUrl(value)) {
      errors.push(
        `  • ${entry.env}: must be a valid http(s) URL, got "${value}".`
      );
    }
    if (entry.type === 'enum' && !entry.options.includes(value)) {
      errors.push(
        `  • ${entry.env}: must be one of [${entry.options.join(', ')}], got "${value}".`
      );
    }
    if (entry.type === 'boolean' && !BOOLEAN_VALUES.has(value.toLowerCase())) {
      errors.push(
        `  • ${entry.env}: must be true or false, got "${value}".`
      );
    }
  }

  // Conditional requirement: Twilio provider needs its credentials.
  const provider = String(env.WA_PROVIDER || 'webjs').trim();
  if (provider === 'twilio') {
    for (const key of [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_WHATSAPP_NUMBER',
    ]) {
      const raw = env[key];
      if (raw === undefined || String(raw).trim() === '') {
        errors.push(
          `  • ${key}: REQUIRED when WA_PROVIDER=twilio. Add it to app-server/.env.local (or .env).`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      '❌ Invalid Aarogyam configuration — refusing to start.\n\n' +
        errors.join('\n') +
        '\n\nFix the values above, then re-run the command.'
    );
  }

  return { ok: true, schema: SCHEMA, legacy: LEGACY };
}
