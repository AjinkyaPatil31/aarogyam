import { PrismaClient } from '@prisma/client';
import { config } from '@/app/lib/config/index.mjs';

const globalForPrisma = globalThis;

// We MUST pass an object {} inside PrismaClient() for Prisma 7 to work with Next.js
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error']});

if (!config.env.isProduction) {
  globalForPrisma.prisma = prisma;
}

// ── M1.6 W-05 — SQLite durability tuning (PRAGMA at initialization) ─────────
// Applied once per process through the shared Prisma singleton. WAL journaling
// gives crash-safe, concurrent-read durability for the single-node clinic
// deployment; busy_timeout bounds contention waits so a brief lock from a
// concurrent write surfaces as a retry instead of an immediate failure.
const SQLITE_BUSY_TIMEOUT_MS = 5000; // 5s — bounded, non-zero

// Reuse any setup already cached on the global (dev hot-reload safe); the
// promise guarantees pragmas are applied exactly once per process and that
// waiters (e.g. the health route) observe the completed setup.
let pragmaSetupPromise =
  globalForPrisma.__aarogyamPragmaSetup ??
  (globalForPrisma.__aarogyamPragmaSetup = (async () => {
    const result = {
      journalMode: 'unknown',
      busyTimeout: null,
      error: null,
    };
    try {
      // $queryRaw executes against the SQLite file; both statements are
      // idempotent and safe to repeat. journal_mode=WAL is a connection
      // attribute in SQLite — applying it once on the shared client is
      // exactly what "configured during initialization" requires.
      // NOTE: PRAGMA statements do not accept bound parameters in SQLite
      // ("near ?: syntax error"), so the numeric timeout is inlined as a
      // validated integer literal — it is a constant, not user input.
      const [journalRow] = await prisma.$queryRaw`PRAGMA journal_mode=WAL`;
      // The setter may surface Prisma's SQLite BigInt-serialization quirk
      // ("Do not know how to serialize a BigInt") — the PRAGMA has already
      // taken effect by then, and the TEXT readback below verifies the
      // actual applied value, so the quirk is treated as a non-fatal signal.
      try {
        await prisma.$queryRawUnsafe(`PRAGMA busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}`);
      } catch (pragmaErr) {
        if (!String(pragmaErr?.message ?? '').includes('serialize a BigInt')) {
          throw pragmaErr; // a real failure — propagate to the outer handler
        }
      }
      result.journalMode = String(journalRow?.journal_mode ?? 'unknown').toUpperCase();
      // Read the effective busy_timeout back as TEXT — integer reads from
      // pragma tables arrive as BigInt and break Prisma's result
      // serialization, so a CAST to TEXT is required for a safe readback.
      const [busyRow] = await prisma.$queryRawUnsafe(
        'SELECT CAST((SELECT * FROM pragma_busy_timeout) AS TEXT) AS busy_ms'
      );
      result.busyTimeout = Number(busyRow?.busy_ms ?? null) || null;
    } catch (err) {
      // Never crash the process on a pragma failure — the app keeps running
      // and the health endpoint reports the degraded state.
      result.error = err?.message ?? String(err);
    }
    return result;
  })());

/**
 * Resolve when the SQLite durability setup has been attempted and return its
 * outcome. Consumed by GET /api/health so the operator can see whether WAL
 * and busy_timeout are actually in effect.
 */
export async function getSqlitePragmaState() {
  return pragmaSetupPromise;
}
