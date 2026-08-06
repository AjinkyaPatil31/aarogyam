import { verifyToken } from '@/app/api/lib/jwt';
import { apiError } from './apiResponse';
import { config } from '@/app/lib/config/index.mjs';

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
