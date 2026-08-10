import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireAuth, requireRole } from '@/app/lib/authHelpers';

export const runtime = 'nodejs';

// ── M1.5-F2 — bounded input caps for the patient profile write path,
// consistent with the M1.4 caps enforced by POST/PUT /api/patients.
const MAX_FULLNAME = 200;
const MAX_DATEOFBIRTH = 20;
const MAX_GENDER = 30;
const MAX_CONTACT = 20;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

// A password change is requested only when newPassword is a present,
// non-null, non-empty value (an empty string is the "no change" signal sent
// by the patient dashboard's profile form).
function isPasswordChangeRequested(newPassword) {
  return newPassword !== undefined && newPassword !== null && newPassword !== '';
}

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

    // M1.5-F2 — type-check every field before any string operation, so
    // malformed input produces a clean 400 instead of reaching Prisma as an
    // accidental 500.
    if (
      typeof fullName !== 'string' ||
      typeof dateOfBirth !== 'string' ||
      typeof gender !== 'string' ||
      typeof contact !== 'string'
    ) {
      return NextResponse.json({ error: 'Invalid input format' }, { status: 400 });
    }

    // M1.5-F2 — bounded lengths before any DB write.
    if (
      fullName.length > MAX_FULLNAME ||
      dateOfBirth.length > MAX_DATEOFBIRTH ||
      gender.length > MAX_GENDER ||
      contact.length > MAX_CONTACT
    ) {
      return NextResponse.json(
        { error: 'Input field exceeds maximum allowed length' },
        { status: 400 }
      );
    }

    // M1.5-F2 — contact must resolve to exactly 10 digits (same contract as
    // POST /api/patients).
    const digitsOnly = contact.replace(/[^0-9]/g, '');
    if (digitsOnly.length !== 10) {
      return NextResponse.json(
        { error: 'Contact number must be exactly 10 digits' },
        { status: 400 }
      );
    }

    // M1.5-F2 — every password-change validation completes BEFORE the
    // profile upsert/update: a missing or incorrect currentPassword, or an
    // invalid new password, must fail without modifying the profile.
    let changePassword = false;
    if (isPasswordChangeRequested(newPassword)) {
      if (typeof newPassword !== 'string') {
        return NextResponse.json({ error: 'Invalid input format' }, { status: 400 });
      }
      if (newPassword.length < MIN_PASSWORD) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters' },
          { status: 400 }
        );
      }
      if (newPassword.length > MAX_PASSWORD) {
        return NextResponse.json(
          { error: 'New password must be at most 128 characters' },
          { status: 400 }
        );
      }
      if (!currentPassword) {
        return NextResponse.json(
          { error: 'Current password is required to set a new password' },
          { status: 400 }
        );
      }
      if (typeof currentPassword !== 'string') {
        return NextResponse.json({ error: 'Invalid input format' }, { status: 400 });
      }
      if (currentPassword.length > MAX_PASSWORD) {
        return NextResponse.json(
          { error: 'Current password exceeds maximum allowed length' },
          { status: 400 }
        );
      }

      // Read-only lookup to verify the current password — still no write.
      const bcrypt = await import('bcryptjs');
      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: { passwordHash: true },
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
      changePassword = true;
    }

    // Upsert profile — reached only after every validation passed.
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

    // Apply the (already validated) password change.
    if (changePassword) {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: payload.id },
        data: { passwordHash: hash },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST profile error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
