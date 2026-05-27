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

    // Issue fresh token with same identity
    const newToken = await signToken({
      id: payload.id,
      email: payload.email,
      role: payload.role,
    });

    return NextResponse.json({ token: newToken });
  } catch (err) {
    // Token invalid or expired — force re-login
    return NextResponse.json(
      { error: 'Token invalid or expired' },
      { status: 401 }
    );
  }
}
