"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

/* ──────────────────────────────────────────────────────────────────────────────
   Sign Out helper
   ──────────────────────────────────────────────────────────────────────────── */
function signOut(router) {
  document.cookie = "aarogyam_token=; path=/; max-age=0; SameSite=Lax";
  sessionStorage.removeItem('aarogyam_user_email');
  sessionStorage.removeItem('aarogyam_user_role');
  router.push("/login");
}

/* ──────────────────────────────────────────────────────────────────────────────
   Status badge — profileComplete flag
   ──────────────────────────────────────────────────────────────────────────── */
function StatusBadge({ active }) {
  if (active) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-green-50 text-green-700 border-green-200">
        Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-amber-50 text-amber-700 border-amber-200">
      Pending
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Header
   ──────────────────────────────────────────────────────────────────────────── */
function CompounderHeader({ email, onSignOut, activeTab, onToggleSettings }) {
  return (
    <header className="bg-slate-900 px-6 py-4 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500 text-white text-sm font-bold">
          A
        </div>
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">
            Compounder Portal
          </h1>
          <p className="text-xs text-slate-400">
            Patient Registration &amp; Management
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-300 hidden sm:inline">
            <span className="text-slate-500">User ID: </span>{email}</span>
        <button
          onClick={onToggleSettings}
          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors bg-slate-100 hover:bg-slate-200 text-slate-700"
        >
          {activeTab === 'directory' ? '⚙️ My Account' : '📋 Patient Directory'}
        </button>
        <button
          onClick={onSignOut}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-red-600 text-slate-200 hover:text-white text-sm font-medium transition-all duration-200"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"
            />
          </svg>
          Sign Out
        </button>
      </div>
    </header>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Loading skeleton for the patient table
   ──────────────────────────────────────────────────────────────────────────── */
function TableSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-4 py-3 border-b border-slate-100">
          <div className="w-9 h-9 rounded-full bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-slate-200 rounded w-1/3" />
            <div className="h-2.5 bg-slate-100 rounded w-1/4" />
          </div>
          <div className="h-6 bg-slate-200 rounded-full w-16" />
          <div className="h-3 bg-slate-200 rounded w-20 hidden sm:block" />
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Patient Directory (Section 1)
   ──────────────────────────────────────────────────────────────────────────── */
function PatientDirectory({ patients, loading, searchQuery, onSearchChange, onEdit, onDelete }) {
  const filtered = patients.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = (p.fullName || "").toLowerCase();
    const contact = (p.contact || "").toLowerCase();
    return name.includes(q) || contact.includes(q);
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 pb-0">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              Registered Patients
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {patients.length} patient{patients.length !== 1 ? "s" : ""}{" "}
              registered
            </p>
          </div>
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by name…"
              className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none w-56 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-6">
          <TableSkeleton />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Full Name
                </th>
                <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Registered
                </th>
                <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>                    <td
                      colSpan={5}
                      className="text-center py-12 text-sm text-slate-400"
                  >
                    {searchQuery
                      ? "No patients match your search."
                      : "No patients registered yet."}
                  </td>
                </tr>
              ) : (
                filtered.map((patient) => {
                  return (
                    <tr
                      key={patient.id}
                      className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-sm font-bold shrink-0">
                            {(patient.fullName || "?").charAt(0)}
                          </div>
                          <span className="text-sm font-medium text-slate-800">
                            {patient.fullName || "Unknown"}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-sm text-slate-600">
                        {patient.contact || "\u2014"}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge active={patient.profileComplete} />
                      </td>
                      <td className="py-3.5 px-4 text-sm text-slate-600">
                        {new Date(patient.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            year: "numeric"}
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            onClick={() => onEdit({
                              id: patient.id,
                              fullName: patient.fullName,
                              contact: patient.contact,
                              dateOfBirth: patient.dateOfBirth || '',
                              gender: patient.gender || '',
                              medicalHistory: patient.medicalHistory || ''})}
                            className="text-xs px-3 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => onDelete(patient)}
                            className="text-xs px-3 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Register New Patient Form (Section 2)
   ──────────────────────────────────────────────────────────────────────────── */
function RegisterPatientForm({ onRegistered }) {
  const [form, setForm] = useState({
    fullName: "",
    dob: "",
    gender: "",
    contact: "",
    medicalHistory: ""});
  const [status, setStatus] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const isValidContact = (value) => /^\d{10}$/.test(value.replace(/[^0-9]/g, ""));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: "", message: "" });

    // Validate 10-digit contact
    if (!isValidContact(form.contact)) {
      setStatus({
        type: "error",
        message: "Contact number must be exactly 10 digits."});
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/patients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"},
        body: JSON.stringify({
          fullName: form.fullName,
          contact: form.contact,
          dob: form.dob,
          gender: form.gender,
          medicalHistory: form.medicalHistory})});
      const data = await res.json();
      if (res.ok) {
        setStatus({
          type: "success",
          message: "Patient registered! Password sent via WhatsApp."});
        setForm({
          fullName: "",
          dob: "",
          gender: "",
          contact: "",
          medicalHistory: ""});
        onRegistered?.();
      } else {
        setStatus({
          type: "error",
          message: data.error || "Failed to register patient."});
      }
    } catch {
      setStatus({
        type: "error",
        message: "Server connection error. Please try again."});
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
        <svg
          className="w-5 h-5 text-emerald-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
          />
        </svg>
        Register New Patient
      </h3>

      {status.message && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm border ${
            status.type === "success"
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-red-50 text-red-700 border-red-200"
          }`}
        >
          {status.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Full Name */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Full Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            name="fullName"
            value={form.fullName}
            onChange={handleChange}
            required
            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none placeholder:text-slate-400"
            placeholder="Enter patient's full name"
          />
        </div>

        {/* Date of Birth */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Date of Birth <span className="text-red-400">*</span>
          </label>
          <input
            type="date"
            name="dob"
            value={form.dob}
            onChange={handleChange}
            required
            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-slate-700"
          />
        </div>

        {/* Gender */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Gender <span className="text-red-400">*</span>
          </label>
          <select
            name="gender"
            value={form.gender}
            onChange={handleChange}
            required
            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-slate-700"
          >
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Contact Number */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Contact Number <span className="text-red-400">*</span>
            <span className="text-slate-400 font-normal ml-1">
              (10 digits)
            </span>
          </label>
          <input
            type="tel"
            name="contact"
            value={form.contact}
            onChange={handleChange}
            required
            maxLength={10}
            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none placeholder:text-slate-400"
            placeholder="e.g. 9876543210"
          />
        </div>

        {/* Medical History */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Medical History{" "}
            <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            name="medicalHistory"
            value={form.medicalHistory}
            onChange={handleChange}
            rows={3}
            className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none placeholder:text-slate-400 resize-none"
            placeholder="Allergies, chronic conditions, past surgeries..."
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-2.5 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
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
              Registering\u2026
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              Register &amp; Send Password via WhatsApp
            </>
          )}
        </button>
      </form>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Main Compounder Dashboard Page
   ──────────────────────────────────────────────────────────────────────────── */
export default function CompounderDashboard() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState("");
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [verified, setVerified] = useState(false);
  const [editPatient, setEditPatient] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [confirmName, setConfirmName] = useState('');
  const [editStatus, setEditStatus] = useState({ type: '', message: '' });
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('directory');
  const [accountForm, setAccountForm] = useState({
    currentPassword: '',
    newEmail: '',
    newPassword: '',
    confirmPassword: ''});
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountSuccess, setAccountSuccess] = useState('');
  const [accountError, setAccountError] = useState('');

  const fetchPatients = async () => {
    try {
      const res = await fetch("/api/patients");
      const data = await res.json();
      if (res.ok) setPatients(data.patients || []);
      else setError(data.error || "Failed to load patients");
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const email = sessionStorage.getItem('aarogyam_user_email');
    const role = sessionStorage.getItem('aarogyam_user_role');
    if (!email || !role) {
      signOut(router);
      return;
    }
    if (role !== "COMPOUNDER") {
      signOut(router);
      return;
    }
    setUserEmail(email);
    setVerified(true);
    fetchPatients();
  }, []);

  async function handleEdit(e) {
    e.preventDefault();
    setEditStatus({ type: '', message: '' });

    // Validate 10-digit contact
    const digitsOnly = editPatient.contact.replace(/[^0-9]/g, '');
    if (digitsOnly.length !== 10) {
      setEditStatus({ type: 'error', message: 'Contact number must be exactly 10 digits.' });
      return;
    }

    setActionLoading(true);
    try {
      const res = await fetch('/api/patients', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify({
          patientId: editPatient.id,
          fullName: editPatient.fullName,
          contact: digitsOnly,
          dateOfBirth: editPatient.dateOfBirth,
          gender: editPatient.gender,
          medicalHistory: editPatient.medicalHistory})});
      if (res.ok) {
        setEditStatus({ type: 'success', message: 'Patient updated successfully!' });
        setTimeout(() => {
          setEditPatient(null);
          setEditStatus({ type: '', message: '' });
        }, 800);
        await fetchPatients();
      } else {
        const data = await res.json();
        setEditStatus({ type: 'error', message: data.error || 'Failed to update patient.' });
      }
    } catch (err) {
      console.error(err);
      setEditStatus({ type: 'error', message: 'Server connection error.' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    setActionLoading(true);
    try {
      const res = await fetch('/api/patients', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify({ patientId: deleteTarget.id })});
      if (res.ok) {
        setDeleteTarget(null);
        await fetchPatients();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAccountUpdate(e) {
    e.preventDefault();
    setAccountError('');
    setAccountSuccess('');

    if (accountForm.newPassword && accountForm.newPassword !== accountForm.confirmPassword) {
      setAccountError('New passwords do not match');
      return;
    }
    if (accountForm.newPassword && accountForm.newPassword.length < 8) {
      setAccountError('New password must be at least 8 characters');
      return;
    }

    setAccountLoading(true);
    try {
      const res = await fetch('/api/staff/account', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify({
          currentPassword: accountForm.currentPassword,
          newEmail: accountForm.newEmail || undefined,
          newPassword: accountForm.newPassword || undefined})});
      const data = await res.json();
      if (res.ok) {
        setAccountSuccess(
          `Updated successfully!${data.emailChanged 
            ? ' Your User ID has changed — please log in again.' 
            : ''}`
        );
        setAccountForm({
          currentPassword: '',
          newEmail: '',
          newPassword: '',
          confirmPassword: ''});
        if (data.emailChanged) {
          setTimeout(() => {
            document.cookie = 'aarogyam_token=; Max-Age=0; path=/';
            router.push('/login');
          }, 2500);
        }
      } else {
        setAccountError(data.error || 'Update failed');
      }
    } catch {
      setAccountError('Network error. Please try again.');
    } finally {
      setAccountLoading(false);
    }
  }

  if (!verified) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-pulse text-slate-400 text-sm">
          Verifying session\u2026
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <CompounderHeader
        email={userEmail}
        onSignOut={() => signOut(router)}
        activeTab={activeTab}
        onToggleSettings={() => setActiveTab(activeTab === 'directory' ? 'settings' : 'directory')}
      />

      <div className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6 overflow-y-auto">
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-200 text-sm">
            {error}
          </div>
        )}

        {activeTab === 'directory' && (
          <>
            {/* Two-column layout: directory (left) + registration (right) */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Patient Directory — takes 2/3 on desktop */}
              <div className="lg:col-span-2">
                <PatientDirectory
                  patients={patients}
                  loading={loading}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onEdit={setEditPatient}
                  onDelete={setDeleteTarget}
                />
              </div>

              {/* Register New Patient — takes 1/3 on desktop */}
              <div className="lg:col-span-1">
                <RegisterPatientForm onRegistered={fetchPatients} />
              </div>
            </div>
          </>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-lg mx-auto mt-8">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">
                My Account
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Update your User ID or password. Current password is required for any change.
              </p>

              {accountSuccess && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  {accountSuccess}
                </div>
              )}
              {accountError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {accountError}
                </div>
              )}

              <form onSubmit={handleAccountUpdate} className="flex flex-col gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-600">
                    Current Password <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter current password"
                    value={accountForm.currentPassword}
                    onChange={e => setAccountForm({ ...accountForm, currentPassword: e.target.value })}
                    required
                  />
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Change User ID (optional)
                  </p>
                  <label className="text-sm font-medium text-slate-600">
                    New User ID
                  </label>
                  <input
                    type="text"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={userEmail}
                    value={accountForm.newEmail}
                    onChange={e => setAccountForm({ ...accountForm, newEmail: e.target.value })}
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Letters and spaces only (e.g. Vinod Patil). Leave blank to keep current: {userEmail}
                  </p>
                </div>

                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Change Password (optional)
                  </p>
                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-sm font-medium text-slate-600">
                        New Password
                      </label>
                      <input
                        type="password"
                        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Min 8 characters"
                        minLength={8}
                        value={accountForm.newPassword}
                        onChange={e => setAccountForm({ ...accountForm, newPassword: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-slate-600">
                        Confirm New Password
                      </label>
                      <input
                        type="password"
                        className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Re-enter new password"
                        value={accountForm.confirmPassword}
                        onChange={e => setAccountForm({ ...accountForm, confirmPassword: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={accountLoading}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 mt-2 text-sm"
                >
                  {accountLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* ── Edit Patient Modal ── */}
      {editPatient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Patient
            </h3>

            {editStatus.message && (
              <div className={`mb-4 p-3 rounded-lg text-sm border ${editStatus.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                {editStatus.message}
              </div>
            )}

            <form onSubmit={handleEdit} className="flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium text-slate-600">Full Name <span className="text-red-400">*</span></label>
                <input
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editPatient.fullName}
                  onChange={e => setEditPatient({...editPatient, fullName: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">
                  Contact <span className="text-red-400">*</span>
                  <span className="text-slate-400 font-normal ml-1">(10 digits)</span>
                </label>
                <input
                  type="tel"
                  maxLength={10}
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editPatient.contact}
                  onChange={e => setEditPatient({...editPatient, contact: e.target.value.replace(/[^0-9]/g, '')})}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Date of Birth</label>
                <input
                  type="date"
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editPatient.dateOfBirth}
                  onChange={e => setEditPatient({...editPatient, dateOfBirth: e.target.value})}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Gender</label>
                <select
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={editPatient.gender}
                  onChange={e => setEditPatient({...editPatient, gender: e.target.value})}
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Medical History</label>
                <textarea
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  value={editPatient.medicalHistory}
                  onChange={e => setEditPatient({...editPatient, medicalHistory: e.target.value})}
                />
              </div>
              <div className="flex gap-3 mt-2">
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditPatient(null); setEditStatus({ type: '', message: '' }); }}
                  className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setDeleteTarget(null); setConfirmName(''); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Delete Patient?</h3>
            <p className="text-sm text-slate-500 mb-4">
              This will permanently delete <strong>{deleteTarget.fullName}</strong> and all their appointments, medical records, and prescriptions. This cannot be undone.
            </p>
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              Type the patient's name below to confirm.
            </p>
            <input
              type="text"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
              placeholder="Type patient name to confirm..."
              value={confirmName}
              onChange={e => setConfirmName(e.target.value)}
              autoComplete="off"
            />
            <div className="flex gap-3">
              <button
                onClick={async () => {
                  await handleDelete();
                  setConfirmName('');
                }}
                disabled={actionLoading || confirmName !== deleteTarget.fullName}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {actionLoading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                onClick={() => { setDeleteTarget(null); setConfirmName(''); }}
                className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
