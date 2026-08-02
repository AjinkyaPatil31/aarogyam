"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ConsultationModal from '@/app/components/ConsultationModal';
import PatientHistoryModal from '@/app/components/PatientHistoryModal';
import DashboardHeader from '@/app/components/DashboardHeader';
import ErrorBoundary from '@/app/components/ErrorBoundary';
import { calculateAge } from '@/app/lib/ageUtils';

/* ──────────────────────────────────────────────────────────────────────────────
   Main Doctor Dashboard Page
   ──────────────────────────────────────────────────────────────────────────── */
export default function DoctorDashboard() {
  const router = useRouter();
  const [view, setView] = useState('directory');
  const [patients, setPatients] = useState([]);
  const [staff, setStaff] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [consultationPatient, setConsultationPatient] = useState(null);
  const [consultSuccess, setConsultSuccess] = useState('');
  const [editPatient, setEditPatient] = useState(null);
  const [historyPatient, setHistoryPatient] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [staffForm, setStaffForm] = useState({ email: '', password: '', role: 'DOCTOR' });
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffSuccess, setStaffSuccess] = useState('');
  const [staffError, setStaffError] = useState('');
  const [deleteStaffTarget, setDeleteStaffTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [regForm, setRegForm] = useState({ fullName: '', dob: '', gender: '', contact: '', medicalHistory: '' });
  const [regLoading, setRegLoading] = useState(false);
  const [regSuccess, setRegSuccess] = useState('');
  const [regError, setRegError] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [accountForm, setAccountForm] = useState({
    currentPassword: '',
    newEmail: '',
    newPassword: '',
    confirmPassword: ''});
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountSuccess, setAccountSuccess] = useState('');
  const [accountError, setAccountError] = useState('');

  /* ── API Functions ── */

  async function fetchPatients() {
    const res = await fetch('/api/patients', {
      
    });
    if (res.ok) {
      const data = await res.json();
      setPatients(data.patients || []);
    }
  }

  async function fetchStaff() {
    const res = await fetch('/api/staff', {
      
    });
    if (res.ok) {
      const data = await res.json();
      setStaff(data.staff || []);
    }
  }

  async function handleRegisterPatient(e) {
    e.preventDefault();
    setRegLoading(true);
    setRegError('');
    setRegSuccess('');
    try {
      const res = await fetch('/api/patients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify({
          fullName: regForm.fullName,
          dob: regForm.dob,
          gender: regForm.gender,
          contact: regForm.contact,
          medicalHistory: regForm.medicalHistory})});
      const data = await res.json();
      if (res.ok) {
        await fetchPatients();
        const newPatientId = data.user?.id || data.patient?.id || data.id;
        setRegForm({ fullName: '', dob: '', gender: '', contact: '', medicalHistory: '' });
        setRegSuccess('');
        if (newPatientId) {
          setConsultationPatient({
            patientId: newPatientId,
            patientName: regForm.fullName,
            contact: regForm.contact,
            dateOfBirth: regForm.dob,
            appointmentId: null});
          setView('directory');
        } else {
          setRegSuccess('Patient registered! Password sent via WhatsApp.');
          setTimeout(() => setView('directory'), 2000);
        }
      } else {
        setRegError(data.error || 'Registration failed');
      }
    } catch {
      setRegError('Network error. Please try again.');
    } finally {
      setRegLoading(false);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    setActionLoading(true);
    try {
      const res = await fetch('/api/patients', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify({
          patientId: editPatient.id,
          fullName: editPatient.fullName,
          contact: editPatient.contact,
          dateOfBirth: editPatient.dateOfBirth,
          gender: editPatient.gender,
          medicalHistory: editPatient.medicalHistory})});
      if (res.ok) {
        setEditPatient(null);
        await fetchPatients();
      }
    } catch (err) {
      console.error(err);
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

  async function handleAddStaff(e) {
    e.preventDefault();
    setStaffLoading(true);
    setStaffError('');
    setStaffSuccess('');
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify(staffForm)});
      const data = await res.json();
      if (res.ok) {
        setStaffSuccess(`${staffForm.role === 'DOCTOR' ? 'Doctor' : 'Compounder'} added successfully!`);
        setStaffForm({ email: '', password: '', role: 'DOCTOR' });
        await fetchStaff();
      } else {
        setStaffError(data.error || 'Failed to add staff');
      }
    } catch {
      setStaffError('Network error.');
    } finally {
      setStaffLoading(false);
    }
  }

  async function handleDeleteStaff() {
    setStaffLoading(true);
    try {
      const res = await fetch('/api/staff', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify({ userId: deleteStaffTarget.id })});
      if (res.ok) {
        setDeleteStaffTarget(null);
        await fetchStaff();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setStaffLoading(false);
    }
  }

  /* ── Mount Effect ── */
  useEffect(() => {
    const email = sessionStorage.getItem('aarogyam_user_email');
    const role = sessionStorage.getItem('aarogyam_user_role');
    if (!email || !role) { router.push('/login'); return; }
    if (role !== 'DOCTOR') { router.push('/login'); return; }
    setUserEmail(email);
    Promise.all([fetchPatients(), fetchStaff()]).finally(() => setLoading(false));
  }, []);

  async function handleAccountUpdate(e) {
    e.preventDefault();
    setAccountError('');
    setAccountSuccess('');

    if (accountForm.newPassword && 
        accountForm.newPassword !== accountForm.confirmPassword) {
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
        // If email changed, force re-login after 2 seconds
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

  function handleSignOut() {
    document.cookie = 'aarogyam_token=; Max-Age=0; path=/';
    sessionStorage.removeItem('aarogyam_user_email');
    sessionStorage.removeItem('aarogyam_user_role');
    router.push('/login');
  }

  const filtered = patients.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (p.fullName?.toLowerCase() || '').includes(q)
        || (p.contact?.toLowerCase() || '').includes(q);
  });

  /* ── Navigation Buttons ── */
  const navItems = [
    { key: 'register', label: 'Register Patient' },
    { key: 'directory', label: 'Patient Directory' },
    { key: 'staff', label: 'Staff Management' },
    { key: 'account', label: 'My Account' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        {/* Skeleton Top Header Navbar */}
        <div className="w-full bg-white h-16 border-b border-slate-200 animate-pulse flex items-center justify-between px-6">
          <div className="h-6 w-32 bg-slate-200 rounded-md"></div>
          <div className="flex space-x-3">
            <div className="h-8 w-24 bg-slate-200 rounded-lg"></div>
            <div className="h-8 w-8 bg-slate-200 rounded-full"></div>
          </div>
        </div>

        {/* Main Container Layout Body */}
        <div className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
          {/* Metric Cards Shimmer Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm animate-pulse space-y-3">
                <div className="h-4 w-20 bg-slate-200 rounded"></div>
                <div className="h-8 w-16 bg-slate-300 rounded"></div>
                <div className="h-3 w-32 bg-slate-200 rounded"></div>
              </div>
            ))}
          </div>

          {/* Two Column Split Content Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Waiting Queue Area (Takes 2 Cols) */}
            <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-pulse space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <div className="h-5 w-40 bg-slate-300 rounded"></div>
                <div className="h-7 w-20 bg-slate-200 rounded-lg"></div>
              </div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-none">
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-1/3 bg-slate-200 rounded"></div>
                    <div className="h-3 w-1/4 bg-slate-100 rounded"></div>
                  </div>
                  <div className="h-8 w-24 bg-slate-200 rounded-lg"></div>
                </div>
              ))}
            </div>

            {/* Side Panels Area */}
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-pulse space-y-4">
              <div className="h-5 w-32 bg-slate-300 rounded mb-2"></div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-lg space-y-2">
                  <div className="h-3.5 w-1/2 bg-slate-200 rounded"></div>
                  <div className="h-2.5 w-3/4 bg-slate-100 rounded"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-slate-50 flex flex-col transition-opacity duration-300 ease-in-out opacity-100">
      <DashboardHeader
        title="Doctor Portal"
        navItems={navItems}
        activeTab={view}
        onTabChange={setView}
        userEmail={userEmail}
        onLogout={handleSignOut}
      />

      {/* ── Content Area ── */}
      <div className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6 animate-in fade-in slide-in-from-bottom-3 duration-300 ease-out">
        {consultSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700 flex items-center gap-2">
            <span>✅</span> {consultSuccess}
          </div>
        )}

        {regSuccess && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            {regSuccess}
          </div>
        )}

        <div key={view} className="animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out">
        {/* ════════════════════════════════════════════
            VIEW: Register Patient
            ════════════════════════════════════════════ */}
        {view === 'register' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center gap-3 mb-6">
                <button
                  onClick={() => setView('directory')}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                >
                  ←
                </button>
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">Register New Patient</h2>
                  <p className="text-sm text-slate-500">Create a patient record and start consultation</p>
                </div>
              </div>

              {regError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                  {regError}
                </div>
              )}

              <form onSubmit={handleRegisterPatient} className="flex flex-col gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-600">Full Name *</label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter patient's full name"
                    value={regForm.fullName}
                    onChange={e => setRegForm({...regForm, fullName: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-600">Date of Birth *</label>
                  <input
                    type="date"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={regForm.dob}
                    onChange={e => setRegForm({...regForm, dob: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-600">Gender *</label>
                  <select
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={regForm.gender}
                    onChange={e => setRegForm({...regForm, gender: e.target.value})}
                    required
                  >
                    <option value="">Select gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-600">Contact Number * <span className="text-slate-400 font-normal">(10 digits)</span></label>
                  <input
                    type="tel"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 9876543210"
                    maxLength={10}
                    value={regForm.contact}
                    onChange={e => setRegForm({...regForm, contact: e.target.value.replace(/\D/g, '')})}
                    required
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-600">Medical History <span className="text-slate-400 font-normal">(optional)</span></label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    rows={3}
                    placeholder="Allergies, chronic conditions, past surgeries..."
                    value={regForm.medicalHistory}
                    onChange={e => setRegForm({...regForm, medicalHistory: e.target.value})}
                  />
                </div>
                <button
                  type="submit"
                  disabled={regLoading}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 mt-2"
                >
                  {regLoading ? 'Registering...' : 'Register & Start Consultation'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            VIEW: Patient Directory
            ════════════════════════════════════════════ */}
        {view === 'directory' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="sticky top-16 z-30 bg-white border-b border-slate-100 px-6 pt-6 pb-3">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">Patient Directory</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {patients.length} patient{patients.length !== 1 ? 's' : ''} registered
                  </p>
                </div>
                <div className="relative">
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name or contact..."
                    className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none w-56 placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Patient</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Age</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Sex</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Contact</th>
                    <th className="text-left py-3.5 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-sm text-slate-400">
                        {searchQuery
                          ? 'No patients match your search.'
                          : 'No patients registered yet.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map(patient => (
                      <tr key={patient.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-sm font-bold shrink-0">
                              {patient.fullName?.charAt(0) || '?'}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-800">
                                {patient.fullName || 'Unknown'}
                              </p>
                              <p className="text-xs text-slate-400">{patient.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-sm text-slate-600">
                          {calculateAge(patient.dateOfBirth) ?? '—'}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-slate-600">
                          {patient.gender || '—'}
                        </td>
                        <td className="py-3.5 px-4 text-sm text-slate-600">
                          {patient.contact || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={() => setConsultationPatient({
                                patientId: patient.id,
                                patientName: patient.fullName,
                                contact: patient.contact,
                                dateOfBirth: patient.dateOfBirth,
                                appointmentId: null})}
                              className="text-xs px-3 py-1 rounded-md bg-green-50 text-green-700 hover:bg-green-100 font-medium transition-colors"
                            >
                              Consult
                            </button>
                            <button
                              onClick={() => setHistoryPatient({
                                patientId: patient.id,
                                patientName: patient.fullName,
                                dateOfBirth: patient.dateOfBirth})}
                              className="text-xs px-3 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium transition-colors"
                            >
                              History
                            </button>
                            <button
                              onClick={() => setEditPatient({
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
                              onClick={() => setDeleteTarget(patient)}
                              className="text-xs px-3 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 font-medium transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════
            VIEW: Staff Management
            ════════════════════════════════════════════ */}
        {view === 'staff' && (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h2 className="text-lg font-semibold text-slate-800 mb-1">Staff Management</h2>
            <p className="text-sm text-slate-500 mb-5">Add doctors and compounders who can access the portal</p>

            {staffSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                {staffSuccess}
              </div>
            )}
            {staffError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {staffError}
              </div>
            )}

            <form onSubmit={handleAddStaff} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">User ID</label>
                <input
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Vinod Patil"
                  value={staffForm.email}
                  onChange={e => setStaffForm({...staffForm, email: e.target.value})}
                  required
                  type="text"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Password</label>
                <input
                  type="password"
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Min 8 characters"
                  value={staffForm.password}
                  onChange={e => setStaffForm({...staffForm, password: e.target.value})}
                  required
                  minLength={8}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Role</label>
                <select
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={staffForm.role}
                  onChange={e => setStaffForm({...staffForm, role: e.target.value})}
                >
                  <option value="DOCTOR">Doctor</option>
                  <option value="COMPOUNDER">Compounder</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={staffLoading}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {staffLoading ? 'Adding...' : 'Add Staff Member'}
                </button>
              </div>
            </form>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wide">User ID</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Role</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Added</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody>
                {staff.map(member => (
                  <tr key={member.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-3 px-3 text-slate-700">{member.email}</td>
                    <td className="py-3 px-3">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        member.role === 'DOCTOR'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-purple-50 text-purple-700'
                      }`}>
                        {member.role}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-400 text-xs">
                      {new Date(member.createdAt).toLocaleDateString('en-IN')}
                    </td>
                    <td className="py-3 px-3">
                      <button
                        onClick={() => setDeleteStaffTarget(member)}
                        className="text-xs px-3 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 font-medium"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {staff.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-400 text-sm">
                      No staff members added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ════════════════════════════════════════════
            VIEW: My Account
            ════════════════════════════════════════════ */}
        {view === 'account' && (
          <div className="max-w-lg mx-auto mt-8">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">
                My Account
              </h2>
              <p className="text-sm text-slate-500 mb-6">
                Update your User ID or password. Current password 
                is required for any change.
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
                    onChange={e => setAccountForm({
                      ...accountForm, currentPassword: e.target.value
                    })}
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
                    onChange={e => setAccountForm({
                      ...accountForm, newEmail: e.target.value
                    })}
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
                        onChange={e => setAccountForm({
                          ...accountForm, newPassword: e.target.value
                        })}
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
                        onChange={e => setAccountForm({
                          ...accountForm, confirmPassword: e.target.value
                        })}
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
      </div>

      {/* ── Patient History Modal ── */}
      {historyPatient && (
        <PatientHistoryModal
          patient={historyPatient}
          onClose={() => setHistoryPatient(null)}
        />
      )}

      {/* ── Consultation Modal ── */}
      {consultationPatient && (
        <ConsultationModal
          patient={consultationPatient}
          onClose={() => setConsultationPatient(null)}
          onSaved={async (record) => {
            const name = consultationPatient.patientName;
            setConsultationPatient(null);
            await fetchPatients();
            setConsultSuccess(`Prescription saved for ${name}.`);
            setTimeout(() => setConsultSuccess(''), 5000);
            setView('directory');
          }}
        />
      )}

      {/* ── Edit Patient Modal ── */}
      {editPatient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Edit Patient</h3>
            <form onSubmit={handleEdit} className="flex flex-col gap-3">
              <div>
                <label className="text-sm font-medium text-slate-600">Full Name</label>
                <input
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  value={editPatient.fullName}
                  onChange={e => setEditPatient({...editPatient, fullName: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Contact</label>
                <input
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  value={editPatient.contact}
                  onChange={e => setEditPatient({...editPatient, contact: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Date of Birth</label>
                <input
                  type="date"
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  value={editPatient.dateOfBirth}
                  onChange={e => setEditPatient({...editPatient, dateOfBirth: e.target.value})}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Gender</label>
                <select
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
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
                  className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm"
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
                  onClick={() => setEditPatient(null)}
                  className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Patient Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Delete Patient?</h3>
            <p className="text-sm text-slate-500 mb-6">
              This will permanently delete <strong>{deleteTarget.fullName}</strong> and all their appointments, medical records, and prescriptions. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={actionLoading}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {actionLoading ? 'Deleting...' : 'Yes, Delete'}
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Staff Confirmation Modal ── */}
      {deleteStaffTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Remove Staff Member?</h3>
            <p className="text-sm text-slate-500 mb-6">
              This will permanently remove <strong>{deleteStaffTarget.email}</strong> ({deleteStaffTarget.role}) from the portal. They will no longer be able to log in.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDeleteStaff}
                disabled={staffLoading}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {staffLoading ? 'Removing...' : 'Yes, Remove'}
              </button>
              <button
                onClick={() => setDeleteStaffTarget(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
