/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Integrity Verification  (Milestone 4.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Structured diagnostics for a backup on disk. Verification NEVER
 *    throws for a degraded backup — it reports. Checks:
 *
 *    • manifest-present       manifest.json exists
 *    • manifest-valid         parses as JSON and passes shape validation
 *    • format-version         formatVersion equals BACKUP_FORMAT_VERSION
 *    • manifest-checksum      recorded checksum matches recomputation
 *    • metadata-complete      id / createdAt / appVersion / schemaVersion
 *    • provider-<type>-status each declared provider section is well-formed
 *    • files-present          every manifest file exists (missing-file
 *                             detection)
 *    • file-checksums         every file's SHA-256 matches the manifest
 *
 *  Checksums are computed over the file EXACTLY as stored (compressed
 *  bytes when compression is enabled — the manifest path already names
 *  the stored file).
 *
 *  Dependencies: node:path, node:fs/promises, app/lib/local/fsutil,
 *    app/lib/local/errors, app/lib/backup/errors, app/lib/backup/format,
 *    app/lib/logging. No cycles.
 */

import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import * as fsutil from '../local/fsutil.mjs';
import { createLogger } from '../logging/index.mjs';
import {
  BACKUP_FORMAT_VERSION,
  MANIFEST_FILE_NAME,
  parseManifest,
  validateManifestShape,
  manifestChecksum,
  isSafeManifestPath,
} from './format.mjs';

const log = createLogger('backup:verify');

/**
 * Verify a backup directory.
 * @param {object} params
 * @param {string} params.backupDir      absolute path of the backup dir
 * @param {object} [params.manifest]     pre-parsed manifest (avoids re-read)
 * @param {string[]} [params.providers]  only verify these provider types
 * @returns {Promise<{ ok: boolean, checks: Array<{name,ok,detail}>,
 *   errors: Array<{name,detail}>, manifestPath: string, manifest?: object }>}
 */
export async function verifyBackup({ backupDir, manifest = null, providers = null }) {
  const checks = [];
  const errors = [];
  const push = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) errors.push({ name, detail });
  };

  const manifestPath = join(backupDir, MANIFEST_FILE_NAME);
  const present = await fsutil.fileExists(manifestPath);
  push('manifest-present', present, present ? manifestPath : 'missing');

  let loaded = manifest;
  if (present && !loaded) {
    try {
      loaded = parseManifest(await readFile(manifestPath, 'utf8'), manifestPath);
    } catch (err) {
      push('manifest-valid', false, err.message);
      return { ok: false, checks, errors, manifestPath };
    }
  }
  if (!present) {
    return { ok: false, checks, errors, manifestPath };
  }

  const problems = validateManifestShape(loaded);
  push('manifest-valid', problems.length === 0, problems.join('; ') || 'shape ok');

  push(
    'format-version',
    loaded.formatVersion === BACKUP_FORMAT_VERSION,
    `manifest=${loaded.formatVersion} supported=${BACKUP_FORMAT_VERSION}`
  );

  push(
    'manifest-checksum',
    typeof loaded.checksum === 'string' && manifestChecksum(loaded) === loaded.checksum,
    'recomputed sha256 matches recorded'
  );

  push(
    'metadata-complete',
    typeof loaded.id === 'string' &&
      typeof loaded.createdAt === 'string' &&
      typeof loaded.appVersion === 'string' &&
      (typeof loaded.schemaVersion === 'string' || typeof loaded.schemaVersion === 'number'),
    'id / createdAt / appVersion / schemaVersion'
  );

  const providerTypes = providers
    ? providers.filter((p) => loaded.providers?.[p])
    : Object.keys(loaded.providers ?? {});

  const missingFiles = [];
  const badChecksums = [];
  for (const type of providerTypes) {
    const section = loaded.providers[type];
    if (!section || typeof section !== 'object') {
      push(`provider-${type}-status`, false, 'section missing');
      continue;
    }
    push(
      `provider-${type}-status`,
      section.status === 'ok' || section.status === 'empty',
      `status=${section.status}`
    );
    const files = Array.isArray(section.files) ? section.files : [];
    for (const file of files) {
      // Unsafe paths were already reported by manifest-valid — never
      // resolve them under the backup root.
      if (!isSafeManifestPath(file.path)) continue;
      const abs = join(backupDir, file.path);
      if (!(await fsutil.fileExists(abs))) {
        missingFiles.push(file.path);
        continue;
      }
      const actual = await fsutil.hashFile(abs);
      if (actual !== file.sha256) {
        badChecksums.push(`${file.path} (${actual.slice(0, 8)}… != ${file.sha256.slice(0, 8)}…)`);
      }
    }
  }

  push(
    'files-present',
    missingFiles.length === 0,
    missingFiles.length === 0
      ? `${providerTypes.length} provider(s), all manifest files present`
      : `missing: ${missingFiles.join(', ')}`
  );
  push(
    'file-checksums',
    badChecksums.length === 0,
    badChecksums.length === 0 ? 'all sha256 match' : badChecksums.join(' | ')
  );

  const result = { ok: errors.length === 0, checks, errors, manifestPath, manifest: loaded };
  log.debug(`verifyBackup(${loaded.id}): ${result.ok ? 'OK' : `${errors.length} problem(s)`}`);
  return result;
}
