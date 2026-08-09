import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireAuth } from '@/app/lib/authHelpers';

export const runtime = 'nodejs';

export async function GET(request) {
  // M1.3 — route-level authentication (previously relied solely on the
  // middleware gate). The formulary is not sensitive, but every /api route
  // should enforce its own boundary; anonymous callers already receive 401
  // from middleware, so this is a zero-behavior-change hardening.
  const { errorResponse } = await requireAuth(request);
  if (errorResponse) return errorResponse;

  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';

    if (!q || q.length < 2) {
      return NextResponse.json({ drugs: [] });
    }

    // SQLite LIKE (used by Prisma's `contains`) is case-insensitive for ASCII,
    // so this stays case-insensitive without the PostgreSQL-only `mode` filter.
    const drugs = await prisma.drug.findMany({
      where: {
        name: {
          contains: q,
        },
      },
      orderBy: { name: 'asc' },
      take: 10,
      select: { name: true },
    });

    return NextResponse.json({ drugs: drugs.map(d => d.name) });
  } catch (err) {
    console.error('GET /api/drugs error:', err);
    return NextResponse.json({ drugs: [] }, { status: 500 });
  }
}
