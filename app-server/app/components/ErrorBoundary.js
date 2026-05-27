'use client';

import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the crash details to your local diagnostic loggers
    console.error("🚨 Catastrophic Dashboard Crash Caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
          <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-200 max-w-md w-full space-y-5">
            <div className="w-14 h-14 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <svg className="w-7 h-7 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 13.036h.008v.008H12v-.008z"></path>
              </svg>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-900">Something went wrong</h2>
              <p className="text-sm text-slate-500 leading-relaxed font-medium">
                The Aarogyam internal data pipeline encountered an unexpected error. This might be due to a temporary network drop or local database synchronization delay.
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && (
              <div className="p-3 bg-slate-900 text-left rounded-xl overflow-x-auto text-[11px] font-mono text-rose-400 border border-slate-800 max-h-32 shadow-inner">
                {this.state.error?.toString()}
              </div>
            )}

            <button
              onClick={this.handleReset}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 px-4 rounded-xl transition-all shadow-sm text-sm"
            >
              Refresh Workspace
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
