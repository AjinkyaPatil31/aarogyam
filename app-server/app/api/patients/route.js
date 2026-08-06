import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAuth, requireRole } from "@/app/lib/authHelpers";
import bcrypt from "bcryptjs";
import { config } from "@/app/lib/config/index.mjs";

// Forces Next.js to use the standard Node.js runtime (not Edge)
export const runtime = 'nodejs';

/**
 * GET /api/patients
 *   Returns the list of all patients (doctor use) or the current user's profile.
 *
 *   Query params:
 *     ?self=true  — returns the authenticated user's own PatientProfile
 *     (no param)  — returns all patients (DOCTOR-only)
 */
export async function GET(request) {
  const { payload, errorResponse } = await requireAuth(request);
  if (errorResponse) return errorResponse;

  try {
    const url = new URL(request.url);
    const self = url.searchParams.get("self") === "true";

    if (self) {
      // ── Return the authenticated user's own profile ─────────────────
      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        include: { patientProfile: true },
      });

      if (!user || user.role !== "PATIENT") {
        return NextResponse.json(
          { error: "No patient profile found for this user" },
          { status: 404 }
        );
      }

      return NextResponse.json({ patient: user });
    }

    // ── Return all patients (DOCTOR / COMPOUNDER only) ───────────
    if (payload.role !== "DOCTOR" && payload.role !== "COMPOUNDER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const patients = await prisma.user.findMany({
      where: { role: 'PATIENT' },
      include: {
        patientProfile: true,
        medicalRecordsPat: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, consultationDate: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = patients.map(p => ({
      id: p.id,
      email: p.email,
      createdAt: p.createdAt,
      fullName: p.patientProfile?.fullName || 'Unknown',
      contact: p.patientProfile?.contact || '—',
      gender: p.patientProfile?.gender || '—',
      dateOfBirth: p.patientProfile?.dateOfBirth || null,
      medicalHistory: p.patientProfile?.medicalHistory || '',
      profileComplete: p.patientProfile?.profileComplete || false,
      lastVisit: p.medicalRecordsPat?.[0]?.consultationDate || null,
    }));

    // Sort by lastVisit desc, then createdAt desc
    result.sort((a, b) => {
      if (a.lastVisit && b.lastVisit) {
        return new Date(b.lastVisit) - new Date(a.lastVisit);
      }
      if (a.lastVisit) return -1;
      if (b.lastVisit) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    return NextResponse.json({ patients: result });
  } catch (error) {
    console.error("GET /api/patients error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/patients
 *   Register a new patient (DOCTOR/COMPOUNDER). Creates both the User and
 *   PatientProfile records in a single transaction.
 *
 *   Body: { email, password, fullName, contact, medicalHistory?, gender?, dob? }
 */
export async function POST(request) {
  const { payload, errorResponse } = await requireRole(request, ['DOCTOR', 'COMPOUNDER']);
  if (errorResponse) return errorResponse;

  try {
    const body = await request.json();
    let { email, password, fullName, contact, medicalHistory, gender, dob } =
      body;

    // Auto-generate email + password when not provided (compounder flow)
    if (!email) {
      const timestamp = Date.now();
      email = `patient_${contact?.replace(/[^0-9]/g, "")}_${timestamp}@aarogyam.com`;
    }
    if (!password) {
      password = Math.random().toString(36).slice(2, 10) + "A1!";
    }

    if (!fullName || !contact) {
      return NextResponse.json(
        { error: "Missing required fields: fullName, contact" },
        { status: 400 }
      );
    }

    // Validate 10-digit contact number
    const digitsOnly = contact.replace(/[^0-9]/g, "");
    if (digitsOnly.length !== 10) {
      return NextResponse.json(
        { error: "Contact number must be exactly 10 digits" },
        { status: 400 }
      );
    }

    // Check for duplicate email
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: 'A patient with this contact number already exists' },
        { status: 409 }
      );
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const patient = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'PATIENT',
        patientProfile: {
          create: {
            fullName: fullName || '',
            contact: contact || '',
            dateOfBirth: dob || '',
            gender: gender || '',
            medicalHistory: medicalHistory || '',
            profileComplete: true,
          },
        },
      },
      include: { patientProfile: true },
    });

    try { 
      const { sendWhatsAppMessage } = await import('@/app/lib/whatsappProvider'); 
      const appUrl = config.app.url; 
      const message = `*Aarogyam Healthcare* 🏥\n\nGreetings ${fullName},\n\nWelcome! Your profile has been created.\n\n*User ID:* ${email}\n*Password:* ${password}\n\nLogin at: ${appUrl}/login\n\n_If required, change your password after first login._`; 
 
      await sendWhatsAppMessage(contact, message); 
    } catch (waError) { 
      console.error('WhatsApp notification failed (non-fatal):', waError); 
    }

    return NextResponse.json(
      {
        message: "Patient registered successfully",
        patient,
        generatedPassword: password,
        generatedEmail: email,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/patients error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ── DELETE patient (cascade delete everything) ──
export async function DELETE(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['DOCTOR', 'COMPOUNDER']);
    if (errorResponse) return errorResponse;

    const { patientId } = await req.json();
    if (!patientId) {
      return NextResponse.json(
        { error: 'patientId is required' },
        { status: 400 }
      );
    }

    // Cascade delete in correct order
    await prisma.$transaction(async (tx) => {
      // Get all medical record IDs for this patient
      const records = await tx.medicalRecord.findMany({
        where: { patientId },
        select: { id: true },
      });
      const recordIds = records.map(r => r.id);

      // Delete prescriptions linked to those records
      if (recordIds.length > 0) {
        await tx.prescription.deleteMany({
          where: { recordId: { in: recordIds } },
        });
      }

      // Delete medical records
      await tx.medicalRecord.deleteMany({ where: { patientId } });

      // Delete appointments
      await tx.appointment.deleteMany({ where: { patientId } });

      // Delete patient profile
      await tx.patientProfile.deleteMany({ where: { userId: patientId } });

      // Delete user
      await tx.user.delete({ where: { id: patientId } });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE patient error:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

// ── PUT - update patient profile ──
export async function PUT(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['DOCTOR', 'COMPOUNDER']);
    if (errorResponse) return errorResponse;

    const { patientId, fullName, contact, dateOfBirth, gender, medicalHistory } = await req.json();
    if (!patientId) {
      return NextResponse.json(
        { error: 'patientId is required' },
        { status: 400 }
      );
    }

    const updated = await prisma.patientProfile.update({
      where: { userId: patientId },
      data: {
        fullName: fullName || '',
        contact: contact || '',
        dateOfBirth: dateOfBirth || '',
        gender: gender || '',
        medicalHistory: medicalHistory || '',
        profileComplete: true,
      },
    });

    return NextResponse.json({ success: true, profile: updated });
  } catch (err) {
    console.error('PUT patient error:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
