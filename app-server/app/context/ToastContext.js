'use client';

import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a <ToastProvider>');
  }
  return ctx;
}

/* ────────────────────────────────────────────────────────────────────────────
   Individual Toast bubble
   ────────────────────────────────────────────────────────────────────────── */
function Toast({ toast, onClose }) {
  const styles = {
    success: {
      bg: 'bg-green-600',
      icon: '✓'},
    error: {
      bg: 'bg-red-600',
      icon: '✕'},
    info: {
      bg: 'bg-blue-600',
      icon: 'ℹ'},
    warning: {
      bg: 'bg-amber-500',
      icon: '⚠'}};

  const s = styles[toast.type] || styles.info;

  return (
    <div
      className={`${s.bg} text-white px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 min-w-[280px] max-w-sm animate-in slide-in-from-right-2 fade-in duration-200`}
    >
      <span className="text-lg font-bold shrink-0">{s.icon}</span>
      <p className="text-sm font-medium flex-1">{toast.message}</p>
      <button
        onClick={onClose}
        className="text-white/70 hover:text-white text-lg leading-none shrink-0 transition-colors"
      >
        &times;
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   ToastProvider — wraps the app and renders a toast stack in the corner
   ────────────────────────────────────────────────────────────────────────── */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}

      {/* Toast stack — fixed bottom-right corner */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast toast={toast} onClose={() => removeToast(toast.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
