/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup Compression  (Milestone 4.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Optional, configurable compression for backup payloads. gzip is
 *    the only supported algorithm (node built-in — no dependencies).
 *
 *  Decoupling:
 *    Providers never compress — they emit plain files into their
 *    staging directory. The BACKUP MANAGER applies compression when
 *    `backup.compression.enabled` is true, so the manager API
 *    (backup()/restore()/verify()) is independent of the compression
 *    implementation. This module is the only place that knows about
 *    file-level compression.
 *
 *  Dependencies: node:zlib, node:fs, node:stream/promises — zero app
 *    imports, so it can never participate in an import cycle.
 */

import { createGzip, createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** Supported compression algorithms (extensible). */
export const COMPRESSION_ALGORITHMS = Object.freeze(['gzip']);

/** Compress `source` into `target` (gzip). Resolves to `target`. */
export async function compressFile(source, target) {
  await pipeline(createReadStream(source), createGzip(), createWriteStream(target));
  return target;
}

/** Decompress `source` (gzip) into `target`. Resolves to `target`. */
export async function decompressFile(source, target) {
  await pipeline(createReadStream(source), createGunzip(), createWriteStream(target));
  return target;
}

/** The on-disk name for a compressed file (`<relative>.gz`). */
export function compressedName(relative) {
  return `${relative}.gz`;
}

/** True when a manifest `path` denotes a compressed payload. */
export function isCompressedPath(relative) {
  return relative.endsWith('.gz');
}
