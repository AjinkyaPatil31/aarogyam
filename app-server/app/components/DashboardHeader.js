'use client';

import React, { useState } from 'react';

export default function DashboardHeader({ title, navItems, activeTab, onTabChange, userEmail, onLogout }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <header className="bg-slate-900 text-white px-6 py-4 sticky top-0 z-50 shadow-md">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        
        {/* Left Side: Brand Identity & Sub-Title */}
        <div className="flex items-center space-x-3">
          <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Aarogyam
          </span>
          <span className="text-slate-500 font-medium">|</span>
          <span className="text-sm font-semibold text-slate-300 tracking-wide uppercase">
            {title}
          </span>
        </div>

        {/* Desktop Layout Navigation Controls (Screens >= 768px) */}
        {navItems && navItems.length > 0 && (
          <nav className="hidden md:flex items-center space-x-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => onTabChange(item.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                  activeTab === item.key
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}

        {/* Right Side Actions Panel (Desktop) */}
        <div className="hidden md:flex items-center space-x-4">
          {userEmail && (
            <span className="text-xs font-medium text-slate-400 border border-slate-800 px-2.5 py-1 rounded-md bg-slate-950/40">
              {userEmail}
            </span>
          )}
          {onLogout && (
            <button
              onClick={onLogout}
              className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition-colors bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/30 px-3 py-1.5 rounded-lg"
            >
              Sign Out
            </button>
          )}
        </div>

        {/* Mobile Hamburger Menu Interface Trigger (Screens < 768px) */}
        <div className="flex items-center md:hidden">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 focus:outline-none transition-colors"
            aria-label="Toggle Menu"
          >
            {isMenuOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"></path></svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu Dropdown Panel Wrapper with Smooth Shutter Opening */}
      {isMenuOpen && (
        <div className="md:hidden mt-4 pt-4 border-t border-slate-800 animate-in fade-in slide-in-from-top-4 duration-200 space-y-3">
          {navItems && navItems.length > 0 && (
            <nav className="flex flex-col space-y-1.5">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  onClick={() => {
                    onTabChange(item.key);
                    setIsMenuOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    activeTab === item.key
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}
          
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between px-2">
            {userEmail && (
              <span className="text-xs font-medium text-slate-400 truncate max-w-[200px]">
                {userEmail}
              </span>
            )}
            {onLogout && (
              <button
                onClick={onLogout}
                className="text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-950/20 px-3 py-1.5 rounded-lg border border-rose-900/30"
              >
                Sign Out
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
