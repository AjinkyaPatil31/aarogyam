import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/app/lib/prisma';
import { signToken } from '@/app/api/lib/jwt';
import { config } from '@/app/lib/config/index.mjs';

export const runtime = 'nodejs';

// ── M1.5-F4 — minimal in-memory login throttle ───────────────────────────────
// Bounded, expiring per-User-ID failure state. Deliberately in-memory: this
// is a local/LAN application running under `next start` as a single
// long-lived Node process, so module state persists across requests. No
// dependencies, no database, no schema changes, no JWT revocation.
//
// Key choice: the throttle key is the normalized User ID (trimmed,
// lowercased). The Next.js route runtime does not expose a reliable client IP
// for direct local/LAN connections, so a per-identity key is the simplest
// robust option and directly addresses the known seed-account brute-force
// scenario. The 429 response is generic and never reveals whether a User ID
// exists.
const LOGIN_MAX_FAILURES = 5;
const LOGIN_COOLDOWN_MS = 10 * 1000;       // lock duration after threshold
const LOGIN_ENTRY_TTL_MS = 10 * 60 * 1000; // hard expiry for stale entries
const LOGIN_MAX_ENTRIES = 1000;            // hard bound on the Map size

const loginFailures = new Map(); // key -> { count, lockedUntil, lastAttempt }

function pruneLoginThrottle(now) {
  if (loginFailures.size <= LOGIN_MAX_ENTRIES) return;
  for (const [key, entry] of loginFailures) {
    if (now - entry.lastAttempt > LOGIN_ENTRY_TTL_MS) loginFailures.delete(key);
  }
  // Still over the bound (all entries fresh): drop the oldest entries.
  if (loginFailures.size > LOGIN_MAX_ENTRIES) {
    const oldest = [...loginFailures.entries()]
      .sort((a, b) => a[1].lastAttempt - b[1].lastAttempt)
      .slice(0, loginFailures.size - LOGIN_MAX_ENTRIES)
      .map(([k]) => k);
    for (const k of oldest) loginFailures.delete(k);
  }
}

function isLoginThrottled(key, now) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (entry.lockedUntil && now < entry.lockedUntil) return true;
  if (entry.lockedUntil && now >= entry.lockedUntil) {
    loginFailures.delete(key); // cooldown elapsed — reset
  }
  return false;
}

function recordLoginFailure(key, now) {
  const entry = loginFailures.get(key) || { count: 0, lockedUntil: 0, lastAttempt: now };
  entry.count += 1;
  entry.lastAttempt = now;
  if (entry.count >= LOGIN_MAX_FAILURES) {
    entry.lockedUntil = now + LOGIN_COOLDOWN_MS;
  }
  loginFailures.set(key, entry);
  pruneLoginThrottle(now);
}

function clearLoginThrottle(key) {
  loginFailures.delete(key);
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { action } = body;

    // ── LOGIN (only supported action) ──
    // Account creation is intentionally NOT handled here:
    //   • Patients are registered via POST /api/patients  (DOCTOR/COMPOUNDER only)
    //   • Staff (DOCTOR/COMPOUNDER) are created via POST /api/staff (DOCTOR only)
    //   • Bootstrap accounts are created offline by prisma/seed.js
    // Previously an unauthenticated `register` action allowed any anonymous client
    // to create privileged DOCTOR/COMPOUNDER accounts (P0 — fixed).
    if (action === 'login') {
      const { email, password } = body;
      if (!email || !password) {
        return NextResponse.json(
          { error: 'User ID and password are required' },
          { status: 400 }
        );
      }

      // M1.5-F4 — throttle failed attempts per normalized User ID. The 429
      // response is generic (no account-existence disclosure) and is issued
      // before any lookup, so throttled and unthrottled keys stay
      // indistinguishable. Successful login clears the failure state.
      const now = Date.now();
      const throttleKey = String(email).trim().toLowerCase();
      if (isLoginThrottled(throttleKey, now)) {
        return NextResponse.json(
          { error: 'Too many login attempts. Please try again later.' },
          { status: 429 }
        );
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        recordLoginFailure(throttleKey, now);
        return NextResponse.json(
          { error: 'Invalid user ID or password' },
          { status: 401 }
        );
      }
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        recordLoginFailure(throttleKey, now);
        return NextResponse.json(
          { error: 'Invalid user ID or password' },
          { status: 401 }
        );
      }
      clearLoginThrottle(throttleKey);
      const { passwordHash: _, ...safeUser } = user;
      const token = await signToken({ id: user.id, email: user.email, role: user.role });
      
      const response = NextResponse.json({ user: safeUser });
      
      // Sliding-session timeout from centralized config
      const maxAge = config.session.idleTimeoutMinutes * 60;
      
      response.cookies.set(config.session.cookieName, token, {
        ...config.session.cookie,
        maxAge: maxAge
      });
      
      return response;
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (err) {
    console.error('AUTH ROUTE ERROR:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
