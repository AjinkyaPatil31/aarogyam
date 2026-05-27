import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { verifyToken } from '@/app/api/lib/jwt';

export const runtime = 'nodejs';

// GET — fetch own profile
export async function GET(req) {
  try {
    const authHeader = req.headers.get('authorization')
                    ?? req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const token = authHeader.split(' ')[1];
    const payload = await verifyToken(token);

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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — complete own profile (first login)
export async function POST(req) {
  try {
    const authHeader = req.headers.get('authorization')
                    ?? req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const token = authHeader.split(' ')[1];
    const payload = await verifyToken(token);
    if (payload.role !== 'PATIENT') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
