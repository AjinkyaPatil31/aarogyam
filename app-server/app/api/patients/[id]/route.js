import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireRole } from '@/app/lib/authHelpers';

export const runtime = 'nodejs';

// GET /api/patients/:id — fetch single patient with full medical history
export async function GET(request, { params }) {
  const { payload, errorResponse } = await requireRole(request, ['DOCTOR', 'COMPOUNDER']);
  if (errorResponse) return errorResponse;

  try {
    const { id } = await params;
    const patient = await prisma.user.findUnique({
      where: { id },
      include: {
        patientProfile: true,
        medicalRecordsPat: {
          orderBy: { createdAt: 'desc' },
          include: { prescriptions: true },
        },
      },
    });

    if (!patient || patient.role !== 'PATIENT') {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const { passwordHash, ...safePatient } = patient;
    return NextResponse.json({ patient: safePatient });
  } catch (err) {
    console.error('GET /api/patients/[id] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
