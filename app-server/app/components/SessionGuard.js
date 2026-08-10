'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function SessionGuard({ children }) {
  const pathname = usePathname();

  // 1. All React hooks are defined first at the top of the function scope
  useEffect(() => {
    const originalFetch = window.fetch;

    window.fetch = async function guardedFetch(input, init) {
      const response = await originalFetch(input, init);

      if (response.status === 401) {
        const currentPath = window.location.pathname;
        if (currentPath !== '/login') {
          // M1.5-F5 — evict the session through the server-side logout
          // endpoint. The authentication cookie is HttpOnly and cannot be
          // reliably cleared with document.cookie; the server clears it with
          // the exact attributes used by login.
          try {
            await fetch('/api/auth/logout', { method: 'POST' });
          } catch {
            // Best-effort — redirect regardless of the eviction result.
          }

          // Redirect to login
          window.location.href = '/login?message=expired';
        }
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // 2. Conditional check is executed only AFTER all hooks are safely locked down
  if (pathname === '/') {
    return <>{children}</>;
  }

  return children;
}