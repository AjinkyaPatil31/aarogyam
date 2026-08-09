import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireRole } from '@/app/lib/authHelpers';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';

// ── M1.4 — User ID ("email") format check ────────────────────────────────────
// The clinic uses display-name style IDs (e.g. "Vinod Patil") as well as
// email-style IDs, so this is a lenient identifier check (non-empty,
// length-capped, no control characters) rather than strict email syntax.
function isValidUserId(v) {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > 254) return false;
  return !/[\u0000-\u001F\u007F]/.test(v);
}

// GET — list all staff (doctors and compounders)
export async function GET(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['DOCTOR']);
    if (errorResponse) return errorResponse;

    const staff = await prisma.user.findMany({
      where: { role: { in: ['DOCTOR', 'COMPOUNDER'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    return NextResponse.json({ staff });
  } catch (err) {
    console.error('GET staff error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST — add new doctor or compounder
export async function POST(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['DOCTOR']);
    if (errorResponse) return errorResponse;

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

    // M1.4 — User ID format + length limits (before any DB write).
    if (!isValidUserId(email)) {
      return NextResponse.json(
        { error: 'User ID must be a non-empty identifier up to 254 characters' },
        { status: 400 }
      );
    }
    if (typeof password !== 'string' || password.length > 128) {
      return NextResponse.json(
        { error: 'Password must be at most 128 characters' },
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
    // M1.4 — race-safe duplicate handling: the pre-check above normally
    // returns 409, but a concurrent create can still hit the unique email
    // constraint; map P2002 to the same 409 response.
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A user with this User ID already exists' },
        { status: 409 }
      );
    }
    console.error('POST staff error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE — remove a staff member
export async function DELETE(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['DOCTOR']);
    if (errorResponse) return errorResponse;

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

    // M1.3 — only DOCTOR/COMPOUNDER accounts may be removed through this
    // endpoint. Without this guard a doctor could pass a PATIENT's user id
    // and delete patient accounts via the staff-management endpoint.
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!target || !['DOCTOR', 'COMPOUNDER'].includes(target.role)) {
      return NextResponse.json(
        { error: 'Staff member not found' },
        { status: 404 }
      );
    }

    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE staff error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
