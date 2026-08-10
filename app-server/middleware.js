import { NextResponse } from 'next/server';
import { verifyToken, signToken } from '@/app/api/lib/jwt';
// Alias avoids clashing with this file's own `export const config` (matcher).
import { config as appConfig } from '@/app/lib/config/index.mjs';

// M1.5-F1 — F-1 identity-contract constants (mirrors authHelpers.js and
// POST /api/auth/refresh). A token may only be re-signed (sliding session)
// when it carries a non-empty string id, a non-empty string email and a
// legitimate role.
const F1_VALID_ROLES = ['DOCTOR', 'COMPOUNDER', 'PATIENT'];
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  
  // Exclude public auth endpoints (including the main /api/auth POST handler)
  if (
    pathname === '/api/auth' ||
    pathname.startsWith('/api/auth/login') || 
    pathname.startsWith('/api/auth/register') || 
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/api/auth/refresh')
  ) {
    return NextResponse.next();
  }

  let token = req.cookies.get(appConfig.session.cookieName)?.value;
  if (!token) {
    const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
  }

  const roleRoutes = {
    '/dashboard/doctor':     'DOCTOR',
    '/dashboard/compounder': 'COMPOUNDER',
    '/dashboard/patient':    'PATIENT',
  };

  const matchedRole = Object.keys(roleRoutes).find(path => pathname.startsWith(path));
  const isApiRoute = pathname.startsWith('/api/');

  // If not a protected dashboard route and not an API route, allow through
  if (!matchedRole && !isApiRoute) {
    return NextResponse.next();
  }

  if (!token) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const payload = await verifyToken(token);
    
    // Explicit null check if token was invalid/expired
    if (!payload) {
      throw new Error('Invalid or expired token');
    }
    
    // Authorization check for dashboard routes
    if (matchedRole) {
      const requiredRole = roleRoutes[matchedRole];
      if (payload.role !== requiredRole) {
        const redirectMap = {
          DOCTOR:     '/dashboard/doctor',
          COMPOUNDER: '/dashboard/compounder',
          PATIENT:    '/dashboard/patient',
        };
        return NextResponse.redirect(
          new URL(redirectMap[payload.role] ?? '/login', req.url)
        );
      }
    }

    const response = NextResponse.next();

    // Sliding session logic
    const exp = payload.exp; // expiry timestamp in seconds
    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = exp - now;
    
    const thresholdMinutes = appConfig.session.refreshThresholdMinutes;
    const thresholdSeconds = thresholdMinutes * 60;
    
    if (timeRemaining <= thresholdSeconds) {
      // M1.5-F1 — never re-sign a token whose claims violate the F-1
      // identity contract. A cryptographically valid but claim-less token is
      // not extended; the request still proceeds with its existing verified
      // token and route-level F-1 rejects the malformed identity (no new
      // error contract introduced here).
      const claimsValid =
        isNonEmptyString(payload.id) &&
        isNonEmptyString(payload.email) &&
        F1_VALID_ROLES.includes(payload.role);

      if (claimsValid) {
        const idleMinutes = appConfig.session.idleTimeoutMinutes;
        const newPayload = { id: payload.id, email: payload.email, role: payload.role };
        const newToken = await signToken(newPayload);

        // M1.5-F5 — use the same cookie attributes as login/logout so the
        // sliding re-issue shares one unified cookie contract (previously
        // this path used a separate 'strict' SameSite profile).
        response.cookies.set(appConfig.session.cookieName, newToken, {
          ...appConfig.session.cookie,
          maxAge: idleMinutes * 60,
        });
      }
    }

    return response;
  } catch (err) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login?reason=expired', req.url));
  }
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/:path*'
  ],
};
