import { verifyToken } from '@/app/api/lib/jwt';
import { apiError } from './apiResponse';
import { config } from '@/app/lib/config/index.mjs';

// The application's legitimate roles — the only roles a verified session may
// carry (F-1 identity-contract enforcement). Matches the conventions used by
// prisma/seed.js, POST /api/staff, POST /api/patients and the role-route map
// in middleware.js.
const VALID_ROLES = Object.freeze(['DOCTOR', 'COMPOUNDER', 'PATIENT']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Extracts and verifies the JWT token from the Authorization header.
 * Returns the decoded payload or null if invalid/missing.
 */
export async function getAuthPayload(request) {
  try {
    let token = request.cookies.get(config.session.cookieName)?.value;
    
    if (!token) {
      const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      return null;
    }
    
    const payload = await verifyToken(token);
    if (!payload) {
      return null;
    }

    // F-1 — enforce the authentication contract BEFORE the payload is treated
    // as an authenticated identity. A cryptographically valid token that lacks
    // a non-empty string `id`, a non-empty string `email`, or a legitimate
    // `role` is treated as unauthenticated (null), so downstream code can
    // never receive an undefined `id` that would silently widen a Prisma
    // filter (e.g. findMany({ where: { patientId: undefined } }) returning
    // every record instead of none).
    if (
      !isNonEmptyString(payload.id) ||
      !isNonEmptyString(payload.email) ||
      !VALID_ROLES.includes(payload.role)
    ) {
      return null;
    }

    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Ensures the request is authenticated.
 * Returns { payload, errorResponse }
 * If errorResponse is present, the caller MUST return it immediately.
 */
export async function requireAuth(request) {
  const payload = await getAuthPayload(request);
  if (!payload) {
    return { errorResponse: apiError('Unauthenticated', 401) };
  }
  return { payload };
}

/**
 * Ensures the request is authenticated AND the user has one of the allowed roles.
 */
export async function requireRole(request, allowedRoles) {
  const { payload, errorResponse } = await requireAuth(request);
  if (errorResponse) return { errorResponse };

  if (!allowedRoles.includes(payload.role)) {
    return { errorResponse: apiError('Forbidden: Insufficient privileges', 403) };
  }
  return { payload };
}
