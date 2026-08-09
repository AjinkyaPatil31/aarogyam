import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireAuth, requireRole } from '@/app/lib/authHelpers';

export const runtime = 'nodejs';

// ── M1.4 — minimal input-validation helpers (POST booking only) ─────────────
function isValidDateOnly(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isPastDate(s) {
  const today = new Date();
  const todayStr =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return s < todayStr;
}

// Accepts the clinic's 12-hour slots ("10:00 AM") as well as 24-hour
// ("14:30"); rejects anything else, with a hard length cap.
const TIME_SLOT_RE = /^([01]?\d|2[0-3]):[0-5]\d(\s?(AM|PM))?$/i;

function isValidTimeSlot(s) {
  if (typeof s !== 'string' || s.length > 16) return false;
  return TIME_SLOT_RE.test(s.trim());
}

export async function GET(req) {
  try {
    const { payload, errorResponse } = await requireAuth(req);
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(req.url);

    // Stats endpoint for doctor KPI cards — DOCTOR/COMPOUNDER only (F1)
    if (searchParams.get('stats') === 'true') {
      const roleCheck = await requireRole(req, ['DOCTOR', 'COMPOUNDER']);
      if (roleCheck.errorResponse) return roleCheck.errorResponse;

      const today = new Date().toISOString().split('T')[0];
      const [totalPatients, pendingAppts, todayAppts] = await Promise.all([
        prisma.user.count({ where: { role: 'PATIENT' } }),
        prisma.appointment.count({ where: { status: 'Pending' } }),
        prisma.appointment.count({
          where: {
            appointmentDate: today,
            status: { not: 'Cancelled' },
          },
        }),
      ]);
      return NextResponse.json({
        totalPatients,
        pendingAppointments: pendingAppts,
        todayAppointments: todayAppts,
        urgentAlerts: 0,
      });
    }

    // Get available doctors list (for patient booking dropdown)
    if (searchParams.get('doctors') === 'true') {
      const doctors = await prisma.user.findMany({
        where: { role: 'DOCTOR' },
        select: { id: true, email: true },
      });
      return NextResponse.json({ doctors });
    }

    // Get blocked slots for a specific doctor and date
    // ?blockedSlots=true&doctorId=xxx&date=YYYY-MM-DD
    if (searchParams.get('blockedSlots') === 'true') {
      const doctorId = searchParams.get('doctorId');
      const date = searchParams.get('date');
      if (!doctorId || !date) {
        return NextResponse.json({ blockedSlots: [] });
      }
      const confirmed = await prisma.appointment.findMany({
        where: {
          doctorId,
          appointmentDate: date,
          status: { in: ['Confirmed', 'Pending'] },
        },
        select: { timeSlot: true },
      });
      return NextResponse.json({
        blockedSlots: confirmed.map(a => a.timeSlot),
      });
    }

    // Doctor: get all their appointments
    if (payload.role === 'DOCTOR') {
      const appointments = await prisma.appointment.findMany({
        where: { doctorId: payload.id },
        orderBy: [
          { appointmentDate: 'asc' },
          { timeSlot: 'asc' },
        ],
        include: {
          patient: {
            select: {
              id: true,
              email: true,
              patientProfile: {
                select: { fullName: true, contact: true },
              },
            },
          },
        },
      });
      return NextResponse.json({ appointments });
    }

    // Patient: get their own appointments
    if (payload.role === 'PATIENT') {
      const appointments = await prisma.appointment.findMany({
        where: { patientId: payload.id },
        orderBy: [
          { appointmentDate: 'desc' },
          { timeSlot: 'desc' },
        ],
        include: {
          doctor: {
            select: { id: true, email: true },
          },
        },
      });
      return NextResponse.json({ appointments });
    }

    return NextResponse.json({ appointments: [] });
  } catch (err) {
    console.error('GET appointments error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['PATIENT']);
    if (errorResponse) return errorResponse;


    const { doctorId, appointmentDate, timeSlot } = await req.json();

    if (!doctorId || !appointmentDate || !timeSlot) {
      return NextResponse.json(
        { error: 'Please select a doctor, date and time slot.' },
        { status: 400 }
      );
    }

    // M1.4 — minimal input validation (appointmentDate / timeSlot only).
    // All checks run before any database write; slot/doctor business logic,
    // transactions and response contracts are unchanged.
    if (!isValidDateOnly(appointmentDate)) {
      return NextResponse.json(
        { error: 'Appointment date must be a valid date in YYYY-MM-DD format' },
        { status: 400 }
      );
    }
    if (isPastDate(appointmentDate)) {
      return NextResponse.json(
        { error: 'Appointment date cannot be in the past' },
        { status: 400 }
      );
    }
    if (!isValidTimeSlot(timeSlot)) {
      return NextResponse.json(
        { error: 'Invalid time slot. Expected format like "10:00 AM".' },
        { status: 400 }
      );
    }

    // CONCURRENCY-SAFE slot check using transaction
    const appointment = await prisma.$transaction(async (tx) => {
      // Check if slot is already taken
      const existing = await tx.appointment.findFirst({
        where: {
          doctorId,
          appointmentDate,
          timeSlot,
          status: { in: ['Pending', 'Confirmed'] },
        },
      });

      if (existing) {
        throw new Error('SLOT_TAKEN');
      }

      // Check doctor exists
      const doctor = await tx.user.findUnique({
        where: { id: doctorId, role: 'DOCTOR' },
      });
      if (!doctor) throw new Error('Doctor not found');

      // Create the appointment
      return await tx.appointment.create({
        data: {
          patientId: payload.id,
          doctorId,
          appointmentDate,
          timeSlot,
          status: 'Pending',
        },
      });
    });

    return NextResponse.json({ success: true, appointment }, { status: 201 });
  } catch (err) {
    if (err.message === 'SLOT_TAKEN') {
      return NextResponse.json(
        { error: 'This time slot is already booked. Please choose another.' },
        { status: 409 }
      );
    }
    console.error('POST appointments error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const { payload, errorResponse } = await requireRole(req, ['DOCTOR']);
    if (errorResponse) return errorResponse;


    const { appointmentId, status } = await req.json();
    const validStatuses = ['Confirmed', 'Completed', 'Cancelled'];
    if (!appointmentId || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'appointmentId and valid status required' },
        { status: 400 }
      );
    }

    // M1.3 (F4) — atomic ownership-scoped status change. The conditional
    // updateMany restricts the write to the authenticated doctor's own
    // appointment, eliminating the TOCTOU window of a separate ownership
    // lookup; other doctors' appointments resolve to 404 and stay
    // unobservable.
    const result = await prisma.appointment.updateMany({
      where: { id: appointmentId, doctorId: payload.id },
      data: { status },
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 }
      );
    }

    const updated = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });
    if (!updated) {
      // Unreachable in practice (single-writer SQLite); guards the response
      // contract against a concurrent deletion between the update and read.
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, appointment: updated });
  } catch (err) {
    console.error('PATCH appointments error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
