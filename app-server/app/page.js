'use client';

import Link from 'next/link';

export default function LandingPage() {
  const roles = [
    {
      title: "Doctor Portal",
      desc: "Manage patient registrations, issue smart digital prescriptions, and view clinical queues.",
      icon: "🩺",
      color: "border-blue-100 hover:border-blue-500 bg-blue-50/30"
    },
    {
      title: "Compounder Portal",
      desc: "Track daily clinic check-ins, update patient contact vitals, and handle dispensary queues.",
      icon: "📋",
      color: "border-indigo-100 hover:border-indigo-500 bg-indigo-50/30"
    },
    {
      title: "Patient Portal",
      desc: "Access your prescription history securely, download diagnostic summaries, and manage account details.",
      icon: "👤",
      color: "border-emerald-100 hover:border-emerald-500 bg-emerald-50/30"
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between selection:bg-blue-500 selection:text-white">
      {/* Top Header Navbar Row */}
      <nav className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between border-b border-slate-200/60">
        <div className="flex items-center space-x-2">
          <span className="text-2xl font-black tracking-tight bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Aarogyam
          </span>
          <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wider">
            v1.0 Local
          </span>
        </div>
        <Link 
          href="/login" 
          className="bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-all shadow-sm hover:shadow"
        >
          Access Portal
        </Link>
      </nav>

      {/* Main Center Hero Section */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 flex flex-col items-center justify-center py-12 text-center my-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight max-w-3xl leading-tight">
          The Intelligent, Unified Operating System for <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Modern Clinics</span>
        </h1>
        <p className="text-base md:text-lg text-slate-500 mt-4 max-w-2xl font-medium">
          Streamlining medical prescriptions, patient record check-ins, and automated dispensary workflows locally and securely.
        </p>

        {/* Dynamic Role Profile Grid Stack */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mt-12 text-left">
          {roles.map((role, idx) => (
            <div 
              key={idx} 
              className={`p-6 rounded-2xl border bg-white transition-all duration-200 shadow-sm hover:shadow-md flex flex-col justify-between ${role.color}`}
            >
              <div>
                <span className="text-3xl bg-white p-2 rounded-xl shadow-inner border border-slate-100 inline-block mb-4">
                  {role.icon}
                </span>
                <h3 className="text-lg font-bold text-slate-900">{role.title}</h3>
                <p className="text-sm text-slate-500 mt-2 font-medium leading-relaxed">{role.desc}</p>
              </div>
              <div className="mt-5 pt-3 border-t border-slate-100/60">
                <Link 
                  href="/login" 
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center space-x-1 group"
                >
                  <span>Go to login</span>
                  <span className="transform group-hover:translate-x-0.5 transition-transform">→</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Fixed Sticky Footer Row */}
      <footer className="w-full bg-white border-t border-slate-200 py-4 text-center text-xs font-medium text-slate-400">
        &copy; {new Date().getFullYear()} Aarogyam Health Platform. Running fully local on secured clinic intranet.
      </footer>
    </div>
  );
}
