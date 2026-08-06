/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Filesystem Utilities  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Reusable, dependency-free filesystem helpers used by storage,
 *    backup, installer and future service milestones. All helpers are
 *    explicit calls — nothing runs at import time.
 *
 *  Helpers:
 *    • ensureDir          create a directory (recursive)
 *    • dirExists / fileExists
 *    • verifyDirectory    existence + type + (optionally) writability
 *    • removeRecursive    delete a directory tree
 *    • copyRecursive      copy a directory tree
 *    • move               rename / move a file or directory
 *    • hashFile           SHA-256 (or other) hex digest of a file
 *    • atomicWriteFile    write via temp file + rename (crash-safe)
 *    • readJson / writeJson  safe JSON helpers (writeJson is atomic)
 *
 *  Future purpose:
 *    Installer (copy/verify), backup (hash/copy/atomic), offline sync
 *    (atomic journal writes) will all build on these primitives.
 *
 *  Dependencies: node:fs, node:fs/promises, node:crypto, node:path,
 *    node:stream/promises. Deliberately no imports from this app so it
 *    can never participate in an import cycle.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fsp } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** Create a directory (and any missing parents). No-op if it exists. */
export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** True if `dir` exists and is a directory. */
export async function dirExists(dir) {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** True if `file` exists and is a regular file. */
export async function fileExists(file) {
  try {
    return (await fsp.stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Inspect a directory. With `{ writable: true }` performs a probe write
 * (creating and deleting a temporary probe file) to confirm write access.
 */
export async function verifyDirectory(dir, { writable = false } = {}) {
  const result = { exists: false, isDirectory: false, writable: false };
  try {
    const stat = await fsp.stat(dir);
    result.exists = true;
    result.isDirectory = stat.isDirectory();
  } catch {
    return result;
  }
  if (result.isDirectory && writable) {
    const probe = join(dir, `.aarogyam-probe-${process.pid}-${Date.now()}`);
    try {
      await fsp.writeFile(probe, 'ok');
      await fsp.rm(probe, { force: true });
      result.writable = true;
    } catch {
      result.writable = false;
    }
  }
  return result;
}

/** Recursively delete a file or directory tree. Missing targets are fine. */
export async function removeRecursive(target) {
  await fsp.rm(target, { recursive: true, force: true });
}

/** Recursively copy a directory tree (or a single file). */
export async function copyRecursive(source, destination) {
  await fsp.cp(source, destination, { recursive: true, force: true });
}

/** Move / rename a file or directory. */
export async function move(source, destination) {
  await fsp.rename(source, destination);
}

/** Compute the hex digest of a file (default SHA-256). */
export async function hashFile(file, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Crash-safe write: write to a temp file in the same directory, then
 * rename over the target. Guarantees the destination is never observed
 * half-written.
 */
export async function atomicWriteFile(file, data) {
  await ensureDir(dirname(file));
  const temp = join(
    dirname(file),
    `.${basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await fsp.writeFile(temp, data);
    await fsp.rename(temp, file);
  } catch (err) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
  return file;
}

/** Parse a JSON file; returns `fallback` when the file is missing/invalid. */
export async function readJson(file, fallback = null) {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Atomically write a JSON file (pretty-printed). */
export async function writeJson(file, value) {
  await atomicWriteFile(file, JSON.stringify(value, null, 2));
  return file;
}
