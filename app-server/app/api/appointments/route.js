import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { verifyToken } from '@/app/api/lib/jwt';

export const runtime = 'nodejs';

// Helper to extract and verify token
async function getPayload(req) {
  const authHeader = req.headers.get('authorization')
                  ?? req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try { return await verifyToken(token); } 
  catch { return null; }
}

export async function GET(req) {
  try {
    const payload = await getPayload(req);
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);

    // Stats endpoint for doctor KPI cards
    if (searchParams.get('stats') === 'true') {
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const payload = await getPayload(req);
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (payload.role !== 'PATIENT') {
      return NextResponse.json(
        { error: 'Only patients can book appointments' },
        { status: 403 }
      );
    }

    const { doctorId, appointmentDate, timeSlot } = await req.json();

    if (!doctorId || !appointmentDate || !timeSlot) {
      return NextResponse.json(
        { error: 'Please select a doctor, date and time slot.' },
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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  try {
    const payload = await getPayload(req);
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (payload.role !== 'DOCTOR') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { appointmentId, status } = await req.json();
    const validStatuses = ['Confirmed', 'Completed', 'Cancelled'];
    if (!appointmentId || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'appointmentId and valid status required' },
        { status: 400 }
      );
    }

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
    });

    return NextResponse.json({ success: true, appointment: updated });
  } catch (err) {
    console.error('PATCH appointments error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
