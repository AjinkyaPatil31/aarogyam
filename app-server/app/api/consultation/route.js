import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireAuth, requireRole } from '@/app/lib/authHelpers';

export const runtime = 'nodejs';

// ── M1.4 — vitals validation helpers (mirror the prescription-route checks) ─
function isParsableNumeric(v) {
  if (v === null || v === undefined || v === '') return false;
  return !isNaN(Number(v));
}

// POST /api/consultation — save walk-in consultation + prescriptions
export async function POST(request) {
  const { payload, errorResponse } = await requireRole(request, ['DOCTOR']);
  if (errorResponse) return errorResponse;

  try {
    const body = await request.json();
    const {
      patientId,
      consultationDate,
      symptoms,
      diagnosis,
      // Vitals
      bloodPressure, heartRate, temperature, spo2, weight, respiratoryRate,
      // System exams
      rsExam, cvsExam, cnsExam, paExam,
      rsNote, cvsNote, cnsNote, paNote,
      // General assessment
      allergy, allergyNote, edema, edemaNote, clubbing, icterus, pallor,
      // Medical history flags
      historyDM, historyHTN, historyIHD, historyCVA, historyCKD,
      historyHypothyroid, historyCOPD,
      // Prescriptions array: [{ medicationName, dosage, frequency, duration, instructions }]
      prescriptions,
    } = body;

    // Validate required fields
    if (!patientId || !consultationDate || !symptoms || !diagnosis) {
      return NextResponse.json(
        { error: 'Missing required fields: patientId, consultationDate, symptoms, diagnosis' },
        { status: 400 }
      );
    }
    if (!bloodPressure || !heartRate || !temperature || !spo2 || !weight || !respiratoryRate) {
      return NextResponse.json(
        { error: 'All 6 vitals are required: bloodPressure, heartRate, temperature, spo2, weight, respiratoryRate' },
        { status: 400 }
      );
    }

    // M1.4 — vitals validation, consistent with the prescription-route
    // contract. All checks run before any database write.
    if (typeof bloodPressure !== 'string' || bloodPressure.length > 10 ||
        !/^\d+\/\d+$/.test(bloodPressure.trim())) {
      return NextResponse.json(
        { error: 'Validation failed: bloodPressure must be in format "120/80"' },
        { status: 400 }
      );
    }
    const numericVitals = [
      ['heartRate', heartRate, 1, 400],
      ['temperature', temperature, 20, 120],
      ['spo2', spo2, 1, 100],
      ['weight', weight, 1, 500],
      ['respiratoryRate', respiratoryRate, 1, 100],
    ];
    for (const [name, value, min, max] of numericVitals) {
      if (!isParsableNumeric(value) || String(value).length > 10) {
        return NextResponse.json(
          { error: `Validation failed: ${name} must be a numeric value` },
          { status: 400 }
        );
      }
      const n = Number(value);
      if (n < min || n > max) {
        return NextResponse.json(
          { error: `Validation failed: ${name} must be between ${min} and ${max}` },
          { status: 400 }
        );
      }
    }
    if (typeof symptoms !== 'string' || symptoms.length > 5000 ||
        typeof diagnosis !== 'string' || diagnosis.length > 5000) {
      return NextResponse.json(
        { error: 'Validation failed: symptoms and diagnosis exceed the maximum allowed length' },
        { status: 400 }
      );
    }

    // Confirm patient exists
    const patient = await prisma.user.findUnique({ where: { id: patientId } });
    if (!patient || patient.role !== 'PATIENT') {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Create medical record + prescriptions in one transaction
    const record = await prisma.$transaction(async (tx) => {
      const newRecord = await tx.medicalRecord.create({
        data: {
          patientId,
          doctorId: payload.id,
          consultationDate,
          symptoms,
          diagnosis,
          bloodPressure,
          heartRate:       heartRate       ? parseInt(heartRate)       : null,
          temperature:     temperature     ? parseFloat(temperature)   : null,
          spo2:            spo2            ? parseInt(spo2)            : null,
          weight:          weight          ? parseFloat(weight)        : null,
          respiratoryRate: respiratoryRate ? parseInt(respiratoryRate) : null,
          rsExam:   rsExam   || null,
          cvsExam:  cvsExam  || null,
          cnsExam:  cnsExam  || null,
          paExam:   paExam   || null,
          rsNote:   rsNote   || null,
          cvsNote:  cvsNote  || null,
          cnsNote:  cnsNote  || null,
          paNote:   paNote   || null,
          allergy:          allergy          ?? false,
          allergyNote:      allergyNote      || null,
          edema:            edema            ?? false,
          edemaNote:        edemaNote        || null,
          clubbing:         clubbing         ?? false,
          icterus:          icterus          ?? false,
          pallor:           pallor           ?? false,
          historyDM:        historyDM        ?? false,
          historyHTN:       historyHTN       ?? false,
          historyIHD:       historyIHD       ?? false,
          historyCVA:       historyCVA       ?? false,
          historyCKD:       historyCKD       ?? false,
          historyHypothyroid: historyHypothyroid ?? false,
          historyCOPD:      historyCOPD      ?? false,
        },
      });

      if (Array.isArray(prescriptions) && prescriptions.length > 0) {
        await tx.prescription.createMany({
          data: prescriptions.map((rx) => ({
            recordId:      newRecord.id,
            medicationName: rx.medicationName || '',
            dosage:        rx.dosage        || '',
            frequency:     rx.frequency     || '',
            duration:      rx.duration      || '',
            instructions:  rx.instructions  || null,
          })),
        });
      }

      return tx.medicalRecord.findUnique({
        where: { id: newRecord.id },
        include: { prescriptions: true },
      });
    });

    return NextResponse.json({ success: true, record }, { status: 201 });
  } catch (err) {
    console.error('POST /api/consultation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/consultation?patientId=xxx — fetch all consultations for a patient
export async function GET(request) {
  const { payload, errorResponse } = await requireAuth(request);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');

    if (!patientId) {
      return NextResponse.json({ error: 'patientId query param required' }, { status: 400 });
    }

    // Patients can only fetch their own records (M1.4-04). The lookup is
    // bound to the authenticated identity (payload.id) so a forged patientId
    // parameter can never widen the query; the 403 for a foreign patientId is
    // preserved (consistent with the prescriptions list branch). Staff
    // clinic-wide read behavior is unchanged.
    if (payload.role === 'PATIENT' && patientId !== payload.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const records = await prisma.medicalRecord.findMany({
      where: payload.role === 'PATIENT' ? { patientId: payload.id } : { patientId },
      orderBy: { createdAt: 'desc' },
      include: { prescriptions: true },
    });

    return NextResponse.json({ records });
  } catch (err) {
    console.error('GET /api/consultation error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
