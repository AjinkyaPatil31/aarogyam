import { NextResponse } from 'next/server';
import { verifyToken } from '@/app/api/lib/jwt';

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get('aarogyam_token')?.value;

  const roleRoutes = {
    '/dashboard/doctor':     'DOCTOR',
    '/dashboard/compounder': 'COMPOUNDER',
    '/dashboard/patient':    'PATIENT',
  };

  const matchedRole = Object.keys(roleRoutes).find(path =>
    pathname.startsWith(path)
  );

  if (!matchedRole) return NextResponse.next();

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const payload = await verifyToken(token);
    const requiredRole = roleRoutes[matchedRole];
    if (payload.role !== requiredRole) {
      const redirectMap = {
        DOCTOR:     '/dashboard/doctor',
        COMPOUNDER: '/dashboard/compounder',
        PATIENT:    '/dashboard/patient',
      };
      return NextResponse.redirect(
        new URL(redirectMap[payload.role] ?? '/login', req.url)
      );
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
