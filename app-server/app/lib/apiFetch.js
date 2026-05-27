'use client';

export async function apiFetch(url, options = {}) {
  const token = localStorage.getItem('aarogyam_token');

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Clear token and redirect to login
    localStorage.removeItem('aarogyam_token');
    document.cookie = 'aarogyam_token=; Max-Age=0; path=/';
    const currentPath = window.location.pathname;
    if (currentPath !== '/login') {
      window.location.href = '/login?reason=expired';
    }
    return null;
  }

  return res;
}
