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
          // Evict stored credentials
          localStorage.removeItem('aarogyam_token');
          document.cookie =
            'aarogyam_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';

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