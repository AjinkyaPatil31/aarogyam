import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';

export const runtime = 'nodejs';

export async function GET(request) {
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
