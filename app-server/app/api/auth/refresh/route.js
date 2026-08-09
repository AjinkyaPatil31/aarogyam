import { NextResponse } from 'next/server';
import { verifyToken, signToken } from '@/app/api/lib/jwt';

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization')
                    ?? req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'No token provided' },
        { status: 401 }
      );
    }

    const token = authHeader.split(' ')[1];

    // Verify existing token
    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Token invalid or expired' },
        { status: 401 }
      );
    }

    // F-1 identity contract (M1.4) — refuse to re-sign a token whose claims
    // do not carry a valid identity. A cryptographically valid token with
    // missing/invalid id, email or role must not be re-issued as a fresh,
    // longer-lived token; such tokens are treated as unauthenticated (401).
    const { id, email, role } = payload;
    if (
      typeof id !== 'string' || id.length === 0 ||
      typeof email !== 'string' || email.length === 0 ||
      !['DOCTOR', 'COMPOUNDER', 'PATIENT'].includes(role)
    ) {
      return NextResponse.json(
        { error: 'Token invalid or expired' },
        { status: 401 }
      );
    }

    // Issue fresh token with same identity
    const newToken = await signToken({ id, email, role });

    return NextResponse.json({ token: newToken });
  } catch (err) {
    // Token invalid or expired — force re-login
    return NextResponse.json(
      { error: 'Token invalid or expired' },
      { status: 401 }
    );
  }
}
