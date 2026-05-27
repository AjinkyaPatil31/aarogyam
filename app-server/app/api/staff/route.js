import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { verifyToken } from '@/app/api/lib/jwt';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';

// GET — list all staff (doctors and compounders)
export async function GET(req) {
  try {
    const authHeader = req.headers.get('authorization')
                    ?? req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const token = authHeader.split(' ')[1];
    const payload = await verifyToken(token);
    if (payload.role !== 'DOCTOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const staff = await prisma.user.findMany({
      where: { role: { in: ['DOCTOR', 'COMPOUNDER'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return NextResponse.json({ staff });
  } catch (err) {
    console.error('GET staff error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — add new doctor or compounder
export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization')
                    ?? req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const token = authHeader.split(' ')[1];
    const payload = await verifyToken(token);
    if (payload.role !== 'DOCTOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { email, password, role } = await req.json();

    if (!email || !password || !role) {
      return NextResponse.json(
        { error: 'User ID, password and role are required' },
        { status: 400 }
      );
    }
    if (!['DOCTOR', 'COMPOUNDER'].includes(role)) {
      return NextResponse.json(
        { error: 'Role must be DOCTOR or COMPOUNDER' },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'A user with this User ID already exists' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, passwordHash, role },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return NextResponse.json({ success: true, user }, { status: 201 });
  } catch (err) {
    console.error('POST staff error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE — remove a staff member
export async function DELETE(req) {
  try {
    const authHeader = req.headers.get('authorization')
                    ?? req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const token = authHeader.split(' ')[1];
    const payload = await verifyToken(token);
    if (payload.role !== 'DOCTOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }
    if (userId === payload.id) {
      return NextResponse.json(
        { error: 'You cannot remove your own account' },
        { status: 400 }
      );
    }

    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE staff error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
