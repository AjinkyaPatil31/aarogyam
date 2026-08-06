/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Network Metadata Helpers  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Pure, read-only helpers for inspecting the local machine's network
 *    configuration. NO sockets are opened, nothing is broadcast and no
 *    scanning occurs — this is metadata only.
 *
 *  Future purpose:
 *    LAN discovery milestone uses these to advertise and identify the
 *    clinic server (IP addresses, hostname) without duplicating logic.
 *
 *  Dependencies: node:os. Deliberately no app imports.
 */

import { hostname, networkInterfaces, platform } from 'node:os';

/** All non-internal IPv4 addresses of this machine. */
export function getIpv4Addresses() {
  const results = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        results.push(iface.address);
      }
    }
  }
  return results;
}

/** This machine's hostname. */
export function getHostname() {
  return hostname();
}

/** OS platform string (win32 / linux / darwin). */
export function getPlatform() {
  return platform();
}

/** A stable-ish device descriptor for advertising on the LAN. */
export function getDeviceDescriptor() {
  return {
    hostname: getHostname(),
    platform: getPlatform(),
    addresses: getIpv4Addresses(),
  };
}
