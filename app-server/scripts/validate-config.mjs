#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Startup Configuration Gate  (Milestone 3.1, Task 5)
 * ─────────────────────────────────────────────────────────────────────
 *  Runs BEFORE `next dev`, `next build`, and `next start` (see the npm
 *  scripts in package.json). Loads environment files using Next.js
 *  precedence (.env.local first, then .env) and validates the entire
 *  configuration through the single centralized validator.
 *
 *  Exit codes:
 *    0  — configuration valid, proceed
 *    1  — configuration invalid, abort with clear errors
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { validateConfig } from '../app/lib/config/validate.mjs';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local first, then .env. dotenv never overrides an already-set
// key, so this reproduces Next.js precedence (.env.local wins).
for (const file of ['.env.local', '.env']) {
  const path = join(appRoot, file);
  if (existsSync(path)) {
    loadEnv({ path, override: false, quiet: true });
  }
}

try {
  validateConfig(process.env);
  console.log('✅ Aarogyam configuration is valid.');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
