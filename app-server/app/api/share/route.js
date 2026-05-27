import { NextResponse } from 'next/server';
import { join } from 'path';
import {
  acquireLock,
  releaseLock,
  readQueue,
  writeQueue,
} from '@/app/lib/waQueue';

export const runtime = 'nodejs';

const BASE_DIR = process.cwd();

export async function POST(req) {
  try {
    const { phone, message } = await req.json();
    if (!phone || !message) {
      return NextResponse.json(
        { error: 'phone and message are required' },
        { status: 400 }
      );
    }

    // ── Atomic lock → read → append → write → unlock ──────────────
    await acquireLock(BASE_DIR);
    try {
      const queue = readQueue(BASE_DIR);

      queue.push({
        id: Date.now().toString(),
        phone: phone.replace(/[^0-9]/g, ''),
        message,
        createdAt: new Date().toISOString(),
        sent: false,
      });

      writeQueue(BASE_DIR, queue);
    } finally {
      releaseLock(BASE_DIR);
    }

    console.log(`📬 Message queued for ${phone}`);
    return NextResponse.json({ success: true, queued: true });
  } catch (err) {
    console.error('Share route error:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
