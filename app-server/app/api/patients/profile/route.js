import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireAuth, requireRole } from '@/app/lib/authHelpers';

export const runtime = 'nodejs';

// GET — fetch own profile
export async function GET(req) {
  try {
    const { payload, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const user = await prisma.user.findUnique({
      where: { id: payload.id },
      include: { patientProfile: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      email: user.email,
      profileComplete: user.patientProfile?.profileComplete || false,
      profile: user.patientProfile || null,
    });
  } catch (err) {
    console.error('GET profile error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST — complete own profile (first login)
export async function POST(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['PATIENT']);
    if (errorResponse) return errorResponse;

    const { fullName, dateOfBirth, gender, contact, newPassword, currentPassword } = await req.json();

    if (!fullName || !dateOfBirth || !gender || !contact) {
      return NextResponse.json(
        { error: 'fullName, dateOfBirth, gender and contact are required' },
        { status: 400 }
      );
    }

    // Upsert profile
    await prisma.patientProfile.upsert({
      where: { userId: payload.id },
      update: {
        fullName,
        dateOfBirth,
        gender,
        contact,
        profileComplete: true,
      },
      create: {
        fullName,
        dateOfBirth,
        gender,
        contact,
        profileComplete: true,
        userId: payload.id,
      },
    });

    // Change password if provided
    if (newPassword && newPassword.length >= 8) {
      if (!currentPassword) {
        return NextResponse.json(
          { error: 'Current password is required to set a new password' },
          { status: 400 }
        );
      }
      const bcrypt = await import('bcryptjs');
      const user = await prisma.user.findUnique({
        where: { id: payload.id }
      });
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: 'Current password is incorrect' },
          { status: 401 }
        );
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: payload.id },
        data: { passwordHash: hash },
      });
    }
    // Handle case where only newPassword is provided (profile setup with password change)
    else if (newPassword && newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST profile error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
