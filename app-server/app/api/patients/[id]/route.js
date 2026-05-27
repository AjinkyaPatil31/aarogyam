import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { verifyToken } from '@/app/api/lib/jwt';

export const runtime = 'nodejs';

// GET /api/patients/:id — fetch single patient with full medical history
export async function GET(request, { params }) {
  const authHeader = request.headers.get('authorization')
                  ?? request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const token = authHeader.split(' ')[1];
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (payload.role !== 'DOCTOR' && payload.role !== 'COMPOUNDER') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
