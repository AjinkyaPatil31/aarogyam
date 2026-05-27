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

    const drugs = await prisma.drug.findMany({
      where: {
        name: {
          contains: q,
          mode: 'insensitive',
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
