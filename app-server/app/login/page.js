"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Check if redirected due to session expiry
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('reason') === 'expired' || params.get('message') === 'expired') {
        setSessionMessage('Your session has expired. Please log in again.');
      }
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          email,
          password,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Persist JWT session token in both localStorage (SPA use)
        // and a server-readable cookie (middleware auth check)
        localStorage.setItem("aarogyam_token", data.token);
        document.cookie = `aarogyam_token=${data.token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;

        // Start token auto-refresh after login
        startTokenRefresh();

        // Zero-page-reload redirect — prefer the intended destination
        // (set by middleware when blocking an unauthenticated request),
        // otherwise fall back to the user's dashboard based on role.
        const role = data.user?.role;
        if (redirectTo && (role === "PATIENT" || role === "DOCTOR" || role === "COMPOUNDER")) {
          router.push(redirectTo);
        } else if (role === "PATIENT") {
          router.push("/dashboard/patient");
        } else if (role === "COMPOUNDER") {
          router.push("/dashboard/compounder");
        } else if (role === "DOCTOR") {
          router.push("/dashboard/doctor");
        } else {
          setError("Unknown user role. Contact support.");
        }
      } else {
        setError(data.error || "Login failed");
      }
    } catch (err) {
      setError("Cannot connect to server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  function startTokenRefresh() {
    // Clear any existing interval
    if (window._tokenRefreshInterval) {
      clearInterval(window._tokenRefreshInterval);
    }

    window._tokenRefreshInterval = setInterval(async () => {
      const token = localStorage.getItem('aarogyam_token');
      if (!token) {
        clearInterval(window._tokenRefreshInterval);
        return;
      }

      try {
        // Decode token to check expiry
        const parts = token.split('.');
        const payload = JSON.parse(atob(parts[1]));
        const expiresIn = payload.exp - Math.floor(Date.now() / 1000);

        // Refresh if less than 60 minutes remaining
        if (expiresIn < 3600) {
          const res = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (res.ok) {
            const data = await res.json();
            localStorage.setItem('aarogyam_token', data.token);
            document.cookie = `aarogyam_token=${data.token}; path=/; SameSite=Strict`;
            console.log('Token refreshed successfully');
          } else {
            // Refresh failed — clear token
            localStorage.removeItem('aarogyam_token');
            document.cookie = 'aarogyam_token=; Max-Age=0; path=/';
            window.location.href = '/login?reason=expired';
          }
        }
      } catch (err) {
        console.error('Token refresh error:', err);
      }
    }, 15 * 60 * 1000); // check every 15 minutes
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">

        {/* Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-blue-600 text-white text-2xl font-bold mb-4 shadow-md">
            A
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">
            Aarogyam
          </h1>
          <p className="text-slate-500 text-sm">
            Healthcare Ecosystem — Authorized Personnel Only
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-6 text-center border border-red-100 animate-[fadeIn_0.2s_ease-in]">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          {/* Session expired banner */}
          {sessionMessage && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex items-center gap-2">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {sessionMessage}
            </div>
          )}

          {/* Email field */}
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              User ID
            </label>
            <input
              id="email"
              type="text"
              placeholder="Enter your User ID (e.g. Vinod Patil)"
              className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow placeholder:text-slate-400"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              minLength={2}
            />
          </div>

          {/* Password field */}
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow placeholder:text-slate-400"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
                Authenticating…
              </span>
            ) : (
              "Secure Login"
            )}
          </button>
        </form>

        {/* Footer hint */}
        <p className="mt-6 text-center text-xs text-slate-400">
          Secure portal — your session is encrypted end-to-end
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
          <div className="animate-pulse text-slate-400 text-sm">Loading…</div>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
