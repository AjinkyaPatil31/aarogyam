import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { verifyToken } from '@/app/api/lib/jwt';
import bcrypt from 'bcryptjs';

export const runtime = 'nodejs';

async function getPayload(req) {
  const authHeader = req.headers.get('authorization')
                  ?? req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try { return await verifyToken(token); }
  catch { return null; }
}

export async function PUT(req) {
  try {
    const payload = await getPayload(req);
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { newEmail, newPassword, currentPassword } = await req.json();

    if (!currentPassword) {
      return NextResponse.json(
        { error: 'Current password is required to make changes' },
        { status: 400 }
      );
    }

    // Verify current password
    const user = await prisma.user.findUnique({
      where: { id: payload.id },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    const updateData = {};

    // Update User ID (email) if provided
    if (newEmail && newEmail !== user.email) {
      const existing = await prisma.user.findUnique({
        where: { email: newEmail },
      });
      if (existing) {
        return NextResponse.json(
          { error: 'This User ID is already taken' },
          { status: 409 }
        );
      }
      updateData.email = newEmail;
    }

    // Update password if provided
    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: 'New password must be at least 8 characters' },
          { status: 400 }
        );
      }
      updateData.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No changes provided' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: payload.id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      emailChanged: !!updateData.email,
      passwordChanged: !!updateData.passwordHash,
    });
  } catch (err) {
    console.error('Account update error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
