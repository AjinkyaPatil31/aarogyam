import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireAuth, requireRole } from '@/app/lib/authHelpers';

export const runtime = 'nodejs';

// GET — fetch prescriptions for a patient or by record
export async function GET(req) {
  try {
    const { payload, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get('patientId');
    const recordId = searchParams.get('recordId');

    if (recordId) {
      const record = await prisma.medicalRecord.findUnique({
        where: { id: recordId },
        include: {
          prescriptions: true,
          patient: {
            select: {
              email: true,
              patientProfile: true,
            },
          },
          doctor: {
            select: { email: true },
          },
        },
      });
      if (!record) {
        return NextResponse.json(
          { error: 'Record not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ record });
    }

    const targetId = patientId || payload.id;
    const records = await prisma.medicalRecord.findMany({
      where: { patientId: targetId },
      orderBy: { createdAt: 'desc' },
      include: {
        prescriptions: true,
        doctor: { select: { email: true } },
      },
    });

    return NextResponse.json({ records });
  } catch (err) {
    console.error('GET prescriptions error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────────────────────────────
//  Validation helpers
// ────────────────────────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isParsableNumeric(v) {
  if (v === null || v === undefined || v === '') return false;
  return !isNaN(Number(v));
}

// ────────────────────────────────────────────────────────────────────────────
//  POST — create medical record + prescriptions in one transaction
// ────────────────────────────────────────────────────────────────────────────
export async function POST(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['DOCTOR']);
    if (errorResponse) return errorResponse;

    const body = await req.json();

    const {
      patientId,
      consultationDate,
      symptoms,
      diagnosis,
      bloodPressure,
      heartRate,
      temperature,
      spo2,
      weight,
      respiratoryRate,
      rsExam,
      cvsExam,
      cnsExam,
      paExam,
      rsNote,
      cvsNote,
      cnsNote,
      paNote,
      allergy,
      allergyNote,
      edema,
      edemaNote,
      clubbing,
      icterus,
      pallor,
      historyDM,
      historyHTN,
      historyIHD,
      historyCVA,
      historyCKD,
      historyHypothyroid,
      historyCOPD,
      medications,
      specialInstructions,
      appointmentId,
    } = body;

    // ── Required string fields ───────────────────────────────────────────
    if (!isNonEmptyString(patientId)) {
      return NextResponse.json(
        { error: 'Validation failed: patientId is required and must be a non-empty string' },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(symptoms)) {
      return NextResponse.json(
        { error: 'Validation failed: symptoms is required and must be a non-empty string' },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(diagnosis)) {
      return NextResponse.json(
        { error: 'Validation failed: diagnosis is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // ── Vitals — type checks when provided ───────────────────────────────
    if (bloodPressure !== undefined && bloodPressure !== null && bloodPressure !== '') {
      if (typeof bloodPressure !== 'string' || !/^\d+\/\d+$/.test(bloodPressure.trim())) {
        return NextResponse.json(
          { error: 'Validation failed: bloodPressure must be in format "120/80"' },
          { status: 400 }
        );
      }
    }
    if (heartRate !== undefined && heartRate !== null && heartRate !== '' && !isParsableNumeric(heartRate)) {
      return NextResponse.json(
        { error: 'Validation failed: heartRate must be a numeric value' },
        { status: 400 }
      );
    }
    if (temperature !== undefined && temperature !== null && temperature !== '' && !isParsableNumeric(temperature)) {
      return NextResponse.json(
        { error: 'Validation failed: temperature must be a numeric value' },
        { status: 400 }
      );
    }
    if (spo2 !== undefined && spo2 !== null && spo2 !== '' && !isParsableNumeric(spo2)) {
      return NextResponse.json(
        { error: 'Validation failed: spo2 must be a numeric value' },
        { status: 400 }
      );
    }
    if (weight !== undefined && weight !== null && weight !== '' && !isParsableNumeric(weight)) {
      return NextResponse.json(
        { error: 'Validation failed: weight must be a numeric value' },
        { status: 400 }
      );
    }
    if (respiratoryRate !== undefined && respiratoryRate !== null && respiratoryRate !== '' && !isParsableNumeric(respiratoryRate)) {
      return NextResponse.json(
        { error: 'Validation failed: respiratoryRate must be a numeric value' },
        { status: 400 }
      );
    }

    // ── Medications array ────────────────────────────────────────────────
    if (!Array.isArray(medications) || medications.length === 0) {
      return NextResponse.json(
        { error: 'Validation failed: medications must be a non-empty array' },
        { status: 400 }
      );
    }

    for (let i = 0; i < medications.length; i++) {
      const med = medications[i];
      const idx = i + 1;

      if (!isNonEmptyString(med.name)) {
        return NextResponse.json(
          { error: `Validation failed: medication #${idx} is missing a non-empty name` },
          { status: 400 }
        );
      }
      // Only the medication name is mandatory. Dosage, duration and
      // frequency are optional — the doctor decides what to specify.
    }

    // ── Transaction: create record + all prescription rows atomically ────
    const record = await prisma.$transaction(async (tx) => {
      const medRecord = await tx.medicalRecord.create({
        data: {
          patientId,
          doctorId: payload.id,
          consultationDate: consultationDate ||
            new Date().toISOString().split('T')[0],
          symptoms,
          diagnosis,
          bloodPressure: bloodPressure || null,
          heartRate: heartRate ? parseInt(heartRate) : null,
          temperature: temperature ? parseFloat(temperature) : null,
          spo2: spo2 ? parseInt(spo2) : null,
          weight: weight ? parseFloat(weight) : null,
          respiratoryRate: respiratoryRate ? parseInt(respiratoryRate) : null,
          rsExam: rsExam || null,
          cvsExam: cvsExam || null,
          cnsExam: cnsExam || null,
          paExam: paExam || null,
          rsNote: rsNote || null,
          cvsNote: cvsNote || null,
          cnsNote: cnsNote || null,
          paNote: paNote || null,
          allergy: allergy || false,
          allergyNote: allergyNote || null,
          edema: edema || false,
          edemaNote: edemaNote || null,
          clubbing: clubbing || false,
          icterus: icterus || false,
          pallor: pallor || false,
          historyDM: historyDM || false,
          historyHTN: historyHTN || false,
          historyIHD: historyIHD || false,
          historyCVA: historyCVA || false,
          historyCKD: historyCKD || false,
          historyHypothyroid: historyHypothyroid || false,
          historyCOPD: historyCOPD || false,
        },
      });

      // Create all prescription rows
      for (const med of medications) {
        // Store an empty frequency when no time slot is selected so the
        // preview / PDF / WhatsApp fall back to '—' instead of '0-0-0'.
        const hasFreqSlot =
          med.frequency?.morning ||
          med.frequency?.afternoon ||
          med.frequency?.night;
        const freq = hasFreqSlot
          ? [
              med.frequency.morning ? '1' : '0',
              med.frequency.afternoon ? '1' : '0',
              med.frequency.night ? '1' : '0',
            ].join('-')
          : '';

        await tx.prescription.create({
          data: {
            recordId: medRecord.id,
            medicationName: med.name,
            dosage: med.dosage || '',
            frequency: freq,
            duration: isNonEmptyString(med.durationValue)
              ? `${med.durationValue} ${med.durationUnit || 'Days'}`
              : '',
            instructions: med.instructions || null,
          },
        });
      }

      // Mark appointment as Completed if appointmentId provided
      if (appointmentId) {
        await tx.appointment.update({
          where: { id: appointmentId },
          data: { status: 'Completed' },
        });
      }

      return await tx.medicalRecord.findUnique({
        where: { id: medRecord.id },
        include: { prescriptions: true },
      });
    });

    return NextResponse.json(
      { success: true, record },
      { status: 201 }
    );
  } catch (err) {
    console.error('POST prescriptions error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
