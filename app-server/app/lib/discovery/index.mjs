/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — LAN Discovery Foundation  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Reusable interfaces for future LAN discovery: broadcast,
 *    discovery scanning, clinic identification and device metadata.
 *
 *  HARD CONSTRAINT: this module opens NO sockets, broadcasts NOTHING
 *  and scans NO networks. Every capability is exposed as an inert
 *  interface that throws NotImplementedError when invoked — the actual
 *  implementation lands in the LAN milestone.
 *
 *  Future purpose:
 *    The LAN milestone replaces the throwing stubs with real
 *    implementations (UDP multicast broadcast + listening) while the
 *    call sites remain unchanged.
 *
 *  Dependencies: app/lib/local/errors, app/lib/config,
 *    app/lib/network (metadata only).
 */

import { NotImplementedError } from '../local/errors.mjs';
import { get } from '../config/index.mjs';
import { getDeviceDescriptor, getIpv4Addresses } from '../network/index.mjs';

/** Broadcast interface — future: announce clinic presence on the LAN. */
export function createBroadcaster(options = {}) {
  const address = options.address ?? get('future.lanDiscovery.multicastAddress', '239.255.255.250');
  const port = options.port ?? get('future.lanDiscovery.port', 4567);
  return {
    type: 'broadcaster',
    address,
    port,
    start: async () => {
      throw new NotImplementedError('LAN discovery broadcaster');
    },
    stop: async () => {
      /* nothing to stop yet */
    },
  };
}

/** Discovery scanner interface — future: find clinics on the LAN. */
export function createDiscoveryScanner(options = {}) {
  const port = options.port ?? get('future.lanDiscovery.port', 4567);
  return {
    type: 'scanner',
    port,
    start: async () => {
      throw new NotImplementedError('LAN discovery scanner');
    },
    stop: async () => {
      /* nothing to stop yet */
    },
  };
}

/** Clinic identity — describes THIS clinic for future advertising. */
export function createClinicIdentity(options = {}) {
  return {
    type: 'clinic-identity',
    clinicName: options.clinicName ?? get('app.name', 'Aarogyam'),
    clinicId: options.clinicId ?? null,
    version: options.version ?? 'local-edition',
    toPayload: () => ({
      clinicName: options.clinicName ?? get('app.name', 'Aarogyam'),
      clinicId: options.clinicId ?? null,
      version: options.version ?? 'local-edition',
    }),
  };
}

/** Device metadata — describes the machine hosting the clinic server. */
export function createDeviceMetadata(options = {}) {
  const descriptor = options.device ?? getDeviceDescriptor();
  return {
    type: 'device-metadata',
    hostname: descriptor.hostname,
    platform: descriptor.platform,
    addresses: descriptor.addresses ?? getIpv4Addresses(),
    toPayload: () => descriptor,
  };
}

/** Convenience bundle of all discovery interfaces (all inert). */
export function createDiscoveryService(options = {}) {
  return {
    broadcaster: createBroadcaster(options),
    scanner: createDiscoveryScanner(options),
    identity: createClinicIdentity(options),
    device: createDeviceMetadata(options),
  };
}
