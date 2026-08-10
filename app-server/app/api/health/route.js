import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/authHelpers';
import { prisma, getSqlitePragmaState } from '@/app/lib/prisma';
import { createHealthManager } from '@/app/lib/health/index.mjs';
import { HEALTH_STATES, worstState } from '@/app/lib/health/model.mjs';
import { apiError, handleServerError } from '@/app/lib/apiResponse';

export const runtime = 'nodejs';

// ── M1.6 W-02 — Health API (thin adapter over the existing M4.4 framework) ──
// Access policy: any authenticated, F-1-valid identity (requireAuth) may read
// operational health. Anonymous callers get 401 — health state is not public.
//
// Information-boundary contract:
//   • The response exposes ONLY operational status (overall state, per-check
//     state, database reachability + SQLite durability settings). It never
//     carries JWT material, provider credentials, raw environment values,
//     stack traces, Prisma errors or absolute filesystem paths.
//   • Provider `details` are not forwarded; only the safe result envelope
//     (status/component/message/duration) is surfaced.
//   • No backup is created or triggered here — backup state is reported only
//     if the existing backup health provider already supplies it.

// Providers surfaced to the client. The registry/lifecycle providers are
// excluded because they expose service inventory and system facts that a
// clinic operator does not need at this endpoint.
const EXPOSED_COMPONENTS = Object.freeze([
  'configuration',
  'filesystem',
  'logging',
  'storage',
  'backup',
]);

// Only the safe envelope fields of a health result may cross the boundary.
function sanitizeResult(result) {
  const safe = {
    status: result?.status ?? HEALTH_STATES.UNKNOWN,
    component: result?.component ?? 'unknown',
    message: result?.message ?? '',
    duration: typeof result?.duration === 'number' ? result.duration : 0,
  };
  // Absolute filesystem paths must never reach the client; the filesystem
  // provider's `details.directories[].dir` carries them, so details are
  // stripped wholesale above and never re-attached here.
  return safe;
}

// Lightweight database reachability probe — a generic success/failure flag,
// never a raw error/stack/query result.
async function checkDatabase() {
  try {
    const pragma = await getSqlitePragmaState();
    await prisma.$queryRaw`SELECT 1`;
    return {
      status: HEALTH_STATES.HEALTHY,
      reachable: true,
      journalMode: pragma.journalMode,
      busyTimeoutMs: pragma.busyTimeout,
      message: 'Database is reachable',
    };
  } catch {
    return {
      status: HEALTH_STATES.FAILED,
      reachable: false,
      message: 'Database is not reachable',
    };
  }
}

// Shared manager — stateful but all collection is on-demand and cheap.
let healthManager = null;
function getHealthManager() {
  if (!healthManager) {
    healthManager = createHealthManager();
    healthManager.initialize();
  }
  return healthManager;
}

export async function GET(req) {
  try {
    const auth = await requireAuth(req);
    if (auth.errorResponse) return auth.errorResponse;

    const manager = getHealthManager();
    const collected = await manager.collect();
    const database = await checkDatabase();

    // Overall = worst severity across the exposed checks and the database.
    const checkStates = (collected.results ?? [])
      .filter((r) => EXPOSED_COMPONENTS.includes(r.component))
      .map((r) => r.status);
    const overall = worstState([...checkStates, database.status]);

    return NextResponse.json({
      overall,
      status: overall,
      collectedAt: collected.collectedAt,
      database,
      checks: (collected.results ?? [])
        .filter((r) => EXPOSED_COMPONENTS.includes(r.component))
        .map(sanitizeResult),
    });
  } catch (err) {
    console.error('Health route error:', err);
    return handleServerError(err);
  }
}
