import { NextResponse } from 'next/server';
import { config } from '@/app/lib/config/index.mjs';

export const runtime = 'nodejs';

export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(config.session.cookieName, '', {
    ...config.session.cookie,
    maxAge: 0,
  });
  return response;
}
