/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — System Helpers  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Read-only helpers exposing process / OS information for the local
 *    edition (platform checks, runtime metadata). No side effects.
 *
 *  Future purpose:
 *    Installer and service-manager milestones use these to decide
 *    platform-specific behavior (Windows service vs. systemd unit).
 *
 *  Dependencies: node:os, node:process, app/lib/network (hostname and
 *    platform are delegated to the network module — single source of
 *    truth, no duplicated helpers).
 */

import { arch, cpus, totalmem } from 'node:os';
import { getHostname, getPlatform } from '../network/index.mjs';

// Re-exported from network (no duplicate implementations).
export { getHostname, getPlatform };

/** CPU architecture, e.g. 'x64'. */
export function getArch() {
  return arch();
}

/** Number of logical CPU cores. */
export function getCpuCount() {
  return cpus().length;
}

/** Total system memory in bytes. */
export function getTotalMemoryBytes() {
  return totalmem();
}

/** Node.js runtime version string. */
export function getRuntimeVersion() {
  return process.version;
}

/** Process id of the current server process. */
export function getPid() {
  return process.pid;
}

/** Convenience snapshot of all system facts. */
export function getSystemFacts() {
  return {
    platform: getPlatform(),
    arch: getArch(),
    hostname: getHostname(),
    cpuCount: getCpuCount(),
    totalMemoryBytes: getTotalMemoryBytes(),
    runtimeVersion: getRuntimeVersion(),
    pid: getPid(),
  };
}
