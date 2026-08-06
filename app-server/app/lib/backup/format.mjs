/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Format / Manifest  (Milestone 4.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    The single definition of the on-disk backup format: manifest
 *    shape, format version, backup ids and manifest checksums. The
 *    format is versioned (`formatVersion`) so future milestones can
 *    extend it without breaking restore of older backups.
 *
 *  Manifest shape (canonical key order — checksum is the LAST field and
 *  is computed over the canonical serialization WITHOUT itself):
 *
 *    {
 *      $schema:       'aarogyam-backup-manifest',
 *      formatVersion: 1,
 *      id:            '20260807T103000Z-3f2a9b1c',
 *      createdAt:     ISO-8601 timestamp of backup start,
 *      appVersion:    application version from package.json,
 *      schemaVersion: application data schema version ('1'),
 *      trigger:       'manual' | 'scheduled',
 *      compression:   { enabled: boolean, algorithm: 'gzip' | null },
 *      metadata:      { platform, arch, hostname },
 *      providers:     {
 *        sqlite:   { status: 'ok'|'empty', output: {...},
 *                    files: [{ path, size, sha256, compressed, algorithm }] },
 *        storage:  { ... },
 *        settings: { ... },
 *        exports:  { ... }
 *      },
 *      checksum:      sha256 of the canonical manifest (self-excluded)
 *    }
 *
 *  File entries: `path` is relative to the backup root (e.g.
 *  'sqlite/aarogyam.sqlite'), `size` and `sha256` describe the file
 *  exactly as stored (compressed bytes when compression is enabled).
 *
 *  Dependencies: node:crypto, app/lib/backup/errors. No cycles.
 */

import { createHash, randomUUID } from 'node:crypto';
import { BackupError } from './errors.mjs';

/** Current on-disk backup format version. */
export const BACKUP_FORMAT_VERSION = 1;

/** File name of the backup manifest inside each backup directory. */
export const MANIFEST_FILE_NAME = 'manifest.json';

/** Envelope marker used to distinguish backup manifests from raw JSON. */
export const MANIFEST_SCHEMA = 'aarogyam-backup-manifest';

/**
 * Valid backup id charset (used to guard path resolution). Deliberately
 * excludes `.` so an id can never be `..` — ids become directory names
 * under the backup root.
 */
export const BACKUP_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * True when a manifest file `path` is safe to resolve under the backup
 * root: relative, no backslashes, no absolute prefix, no empty, `.` or
 * `..` segments. Enforced during shape validation and again as a hard
 * gate inside the restore planner, so manifest contents can never
 * escape the backup directory (defense in depth against a crafted or
 * corrupted manifest).
 */
export function isSafeManifestPath(path) {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  const segments = path.split('/');
  return segments.every((s) => s.length > 0 && s !== '.' && s !== '..');
}

/**
 * Generate a globally-unique backup id: `YYYYMMDDTHHMMSSZ-<8 hex>`.
 * Time-based (sortable) with a random suffix (unique).
 */
export function makeBackupId(now = new Date()) {
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${ts}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

/**
 * Canonical serialization of a manifest — the manifest object is built
 * in a fixed key order, so JSON.stringify is deterministic. The
 * `checksum` field is excluded (it cannot checksum itself).
 */
export function canonicalManifest(manifest) {
  const { checksum, ...rest } = manifest;
  return JSON.stringify(rest);
}

/** SHA-256 hex digest of a manifest's canonical form (self-excluded). */
export function manifestChecksum(manifest) {
  return createHash('sha256').update(canonicalManifest(manifest)).digest('hex');
}

/**
 * Assemble a manifest object. `fields.compression` is a boolean — the
 * manifest records the algorithm name derived from it.
 */
export function buildManifest(fields) {
  const manifest = {
    $schema: MANIFEST_SCHEMA,
    formatVersion: BACKUP_FORMAT_VERSION,
    id: fields.id,
    createdAt: fields.createdAt,
    appVersion: fields.appVersion,
    schemaVersion: fields.schemaVersion,
    trigger: fields.trigger,
    compression: {
      enabled: fields.compression === true,
      algorithm: fields.compression === true ? 'gzip' : null,
    },
    metadata: { ...(fields.metadata ?? {}) },
    providers: { ...(fields.providers ?? {}) },
  };
  manifest.checksum = manifestChecksum(manifest);
  return manifest;
}

/**
 * Parse a manifest file's raw text. Throws BackupError('invalid-manifest')
 * when the text is not valid JSON — structural validation is separate
 * (validateManifestShape) so verification can report rather than throw.
 */
export function parseManifest(raw, source = 'manifest') {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupError('invalid-manifest', `Backup manifest (${source}) is not valid JSON`);
  }
  return parsed;
}

/**
 * Structural validation of a parsed manifest. Returns an array of
 * human-readable problem strings (empty when the shape is valid).
 * Never throws — integrity verification reports.
 */
export function validateManifestShape(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') {
    problems.push('manifest is not an object');
    return problems;
  }
  if (manifest.$schema !== MANIFEST_SCHEMA) {
    problems.push(`$schema mismatch (${manifest.$schema})`);
  }
  if (!Number.isInteger(manifest.formatVersion)) problems.push('formatVersion missing');
  if (typeof manifest.id !== 'string' || !BACKUP_ID_PATTERN.test(manifest.id)) {
    problems.push('id missing or malformed');
  }
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    problems.push('createdAt missing or invalid');
  }
  if (typeof manifest.appVersion !== 'string' || manifest.appVersion.length === 0) {
    problems.push('appVersion missing');
  }
  if (
    typeof manifest.schemaVersion !== 'string' &&
    typeof manifest.schemaVersion !== 'number'
  ) {
    problems.push('schemaVersion missing');
  }
  if (!manifest.providers || typeof manifest.providers !== 'object') {
    problems.push('providers section missing');
    return problems;
  }
  for (const [type, section] of Object.entries(manifest.providers)) {
    if (!section || typeof section !== 'object') {
      problems.push(`provider "${type}" section is not an object`);
      continue;
    }
    if (section.status !== 'ok' && section.status !== 'empty') {
      problems.push(`provider "${type}" has invalid status "${section.status}"`);
    }
    if (!Array.isArray(section.files)) {
      problems.push(`provider "${type}" files list missing`);
      continue;
    }
    for (const file of section.files) {
      if (!file || typeof file !== 'object' || typeof file.path !== 'string' || !file.path) {
        problems.push(`provider "${type}" has a file entry without a path`);
        continue;
      }
      if (!isSafeManifestPath(file.path)) {
        problems.push(`provider "${type}" file "${file.path}" has an unsafe path`);
        continue;
      }
      if (!Number.isInteger(file.size) || file.size < 0) {
        problems.push(`provider "${type}" file "${file.path}" has an invalid size`);
      }
      if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) {
        problems.push(`provider "${type}" file "${file.path}" has an invalid sha256`);
      }
    }
  }
  return problems;
}
