import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/app/lib/prisma';
import { signToken } from '@/app/api/lib/jwt';
import { config } from '@/app/lib/config/index.mjs';

export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const body = await req.json();
    const { action } = body;

    // ── REGISTER (used by compounder to create patients) ──
    if (action === 'register') {
      const { email, password, role } = body;
      if (!email || !password || !role) {
        return NextResponse.json(
          { error: 'User ID, password and role are required' },
          { status: 400 }
        );
      }
      const allowed = ['DOCTOR', 'COMPOUNDER', 'PATIENT'];
      if (!allowed.includes(role)) {
        return NextResponse.json(
          { error: 'Invalid role. Must be DOCTOR, COMPOUNDER or PATIENT' },
          { status: 400 }
        );
      }
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return NextResponse.json(
          { error: 'User ID already registered' },
          { status: 409 }
        );
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: { email, passwordHash, role },
      });
      const { passwordHash: _, ...safeUser } = user;
      const token = await signToken({ id: user.id, email: user.email, role: user.role });
      
      const response = NextResponse.json({ user: safeUser }, { status: 201 });
      
      // Sliding-session timeout from centralized config
      const maxAge = config.session.idleTimeoutMinutes * 60;
      
      response.cookies.set(config.session.cookieName, token, {
        ...config.session.cookie,
        maxAge: maxAge
      });
      
      return response;
    }

    // ── LOGIN ──
    if (action === 'login') {
      const { email, password } = body;
      if (!email || !password) {
        return NextResponse.json(
          { error: 'User ID and password are required' },
          { status: 400 }
        );
      }
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json(
          { error: 'Invalid user ID or password' },
          { status: 401 }
        );
      }
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return NextResponse.json(
          { error: 'Invalid user ID or password' },
          { status: 401 }
        );
      }
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
      { error: 'Internal server error', detail: err.message },
      { status: 500 }
    );
  }
}
