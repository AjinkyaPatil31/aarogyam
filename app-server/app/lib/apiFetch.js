'use client';

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers}});

  if (res.status === 401) {
    // Redirect to login on 401 (HttpOnly cookie will be managed by browser/backend)
    const currentPath = window.location.pathname;
    if (currentPath !== '/login') {
      window.location.href = '/login?reason=expired';
    }
    return null;
  }

  return res;
}
