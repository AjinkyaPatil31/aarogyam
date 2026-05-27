"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import DashboardHeader from '@/app/components/DashboardHeader';
import ErrorBoundary from '@/app/components/ErrorBoundary';

/* ──────────────────────────────────────────────────────────────────────────────
   Sign Out helper — flushes token from localStorage, cookie, then redirects
   ──────────────────────────────────────────────────────────────────────────── */
function signOut(router) {
  localStorage.removeItem("aarogyam_token");
  document.cookie =
    "aarogyam_token=; path=/; max-age=0; SameSite=Lax";
  router.push("/login");
}

/* ──────────────────────────────────────────────────────────────────────────────
   Main Patient Dashboard Page
   ──────────────────────────────────────────────────────────────────────────── */
export default function PatientDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("records");
  const [needsProfile, setNeedsProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({
    fullName: '', dateOfBirth: '', gender: '', contact: '', newPassword: '',
  });
  const [profileError, setProfileError] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [pwForm, setPwForm] = useState({
    currentPassword: '', newPassword: '', confirmPassword: ''
  });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [medicalRecords, setMedicalRecords] = useState([]);
  const [expandedRecord, setExpandedRecord] = useState(null);

  const fetchData = async () => {
    const token = localStorage.getItem("aarogyam_token");
    if (!token) {
      signOut(router);
      return;
    }

    try {
      const profileRes = await fetch("/api/patients/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const profileData = await profileRes.json();

      if (profileRes.ok) {
        setProfile(profileData.profile);
        setUserEmail(profileData.email || '');

        // Check if profile is complete
        if (!profileData.profileComplete) {
          setNeedsProfile(true);
          // Pre-fill form with existing data if any
          if (profileData.profile) {
            setProfileForm({
              fullName: profileData.profile.fullName || '',
              dateOfBirth: profileData.profile.dateOfBirth || '',
              gender: profileData.profile.gender || '',
              contact: profileData.profile.contact || '',
              newPassword: '',
            });
          }
        }
      } else if (profileRes.status === 401 || profileRes.status === 403) {
        setError(profileData.error || "Authentication failed");
      }
    } catch {
      setError("Cannot connect to server.");
    } finally {
      setLoading(false);
    }
  };

  async function handleProfileSubmit(e) {
    e.preventDefault();
    setProfileLoading(true);
    setProfileError('');
    const token = localStorage.getItem('aarogyam_token');
    try {
      const res = await fetch('/api/patients/profile', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profileForm),
      });
      const data = await res.json();
      if (res.ok) {
        setNeedsProfile(false);
        await fetchData();
      } else {
        setProfileError(data.error || 'Failed to save profile');
      }
    } catch (err) {
      setProfileError('Network error. Please try again.');
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match');
      return;
    }
    if (pwForm.newPassword.length < 8) {
      setPwError('Password must be at least 8 characters');
      return;
    }
    setPwLoading(true);
    setPwError('');
    setPwSuccess('');
    const token = localStorage.getItem('aarogyam_token');
    try {
      const res = await fetch('/api/patients/profile', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullName: profile?.fullName || '',
          dateOfBirth: profile?.dateOfBirth || '',
          gender: profile?.gender || '',
          contact: profile?.contact || '',
          newPassword: pwForm.newPassword,
          currentPassword: pwForm.currentPassword,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPwSuccess('Password updated successfully!');
        setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      } else {
        setPwError(data.error || 'Failed to update password');
      }
    } catch {
      setPwError('Network error. Please try again.');
    } finally {
      setPwLoading(false);
    }
  }

  async function fetchMedicalRecords() {
    const token = localStorage.getItem('aarogyam_token');
    const res = await fetch('/api/prescriptions', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      setMedicalRecords(data.records || []);
    }
  }

  useEffect(() => {
    fetchData();
    fetchMedicalRecords();
  }, []);

  const getTabStyle = (tab) => {
    const base = "px-5 py-3 text-sm font-semibold transition-colors border-b-2 ";
    return activeTab === tab
      ? base + "border-blue-500 text-blue-600 bg-white"
      : base + "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 bg-slate-100";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-pulse text-slate-400 text-sm">Loading your health dashboard…</div>
      </div>
    );
  }

  /* ── Profile setup (first login) ── */
  if (needsProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-slate-800">Complete Your Profile</h2>
            <p className="text-sm text-slate-500 mt-1">
              Please fill in your details to access your patient portal. You can also set a new password.
            </p>
          </div>

          {profileError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {profileError}
            </div>
          )}

          <form onSubmit={handleProfileSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-slate-600">Full Name *</label>
              <input
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Your full name"
                value={profileForm.fullName}
                onChange={e => setProfileForm({...profileForm, fullName: e.target.value})}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Date of Birth *</label>
              <input
                type="date"
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={profileForm.dateOfBirth}
                onChange={e => setProfileForm({...profileForm, dateOfBirth: e.target.value})}
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Gender *</label>
              <select
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={profileForm.gender}
                onChange={e => setProfileForm({...profileForm, gender: e.target.value})}
                required
              >
                <option value="">Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-600">Contact Number *</label>
              <input
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="10-digit mobile number"
                maxLength={10}
                value={profileForm.contact}
                onChange={e => setProfileForm({...profileForm, contact: e.target.value.replace(/\D/g, '')})}
                required
              />
            </div>
            <div className="border-t border-slate-100 pt-4">
              <label className="text-sm font-medium text-slate-600">
                New Password <span className="text-slate-400 font-normal">(optional — min 8 chars)</span>
              </label>
              <input
                type="password"
                className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="Set a new password"
                value={profileForm.newPassword || ''}
                onChange={e => setProfileForm({...profileForm, newPassword: e.target.value})}
                minLength={8}
              />
            </div>
            <button
              type="submit"
              disabled={profileLoading}
              className="w-full bg-green-600 text-white py-2.5 rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 mt-2"
            >
              {profileLoading ? 'Saving...' : 'Save & Continue to Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <DashboardHeader
        title="Patient Portal"
        navItems={[
          { key: 'records', label: '📄 Medical Records' },
          { key: 'history', label: '⏳ Visit History' },
          { key: 'security', label: '🔒 Security Settings' },
        ]}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        userEmail={userEmail}
        onLogout={() => signOut(router)}
      />

      <div className="flex-1 max-w-6xl mx-auto w-full p-6 space-y-6 overflow-y-auto animate-in fade-in slide-in-from-bottom-3 duration-300 ease-out">
        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg border border-red-200 text-sm">
            {error}
          </div>
        )}

        {/* ── Profile Overview Card ── */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xl font-bold">
                {profile?.fullName?.charAt(0) || "P"}
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  {profile?.fullName || "Patient"}
                </h2>
                <p className="text-sm text-slate-500">{userEmail}</p>
                <p className="text-sm text-slate-400 mt-0.5">
                  {profile?.contact || "No contact on file"}
                </p>
              </div>
            </div>
            {profile?.medicalHistory && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium border border-amber-200">
                History on file
              </span>
            )}
          </div>
        </div>

        {/* ── Tab Navigation ── */}
        <div className="flex border-b border-slate-200 bg-slate-100 rounded-t-xl overflow-hidden">
          <button onClick={() => setActiveTab("records")} className={getTabStyle("records")}>
            Personal Records
          </button>
          <button onClick={() => setActiveTab("history")} className={getTabStyle("history")}>
            Medical Log
          </button>
          <button onClick={() => setActiveTab("security")} className={getTabStyle("security")}>
            Security
          </button>
        </div>

        {/* ── Tab: Personal Records ── */}
        {activeTab === "records" && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Personal Health Records</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">
                  Full Name
                </p>
                <p className="text-slate-800 font-medium">
                  {profile?.fullName || "—"}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">
                  User ID
                </p>
                <p className="text-slate-800 font-medium">{userEmail || "—"}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">
                  Contact
                </p>
                <p className="text-slate-800 font-medium">
                  {profile?.contact || "—"}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">
                  Medical History
                </p>
                <p className="text-slate-800 font-medium">
                  {profile?.medicalHistory || "None recorded"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab: Medical Log ── */}
        {activeTab === "history" && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Visit History & Medical Log</h3>

            {medicalRecords.length === 0 ? (
              <div className="text-center py-12">
                <svg className="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
                <p className="text-slate-500 text-sm">No medical records yet. Visit the clinic for your first consultation.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {medicalRecords.map(record => (
                  <div key={record.id}
                    className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    
                    {/* Clickable header row */}
                    <div
                      onClick={() => setExpandedRecord(
                        expandedRecord === record.id ? null : record.id
                      )}
                      className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-blue-700 text-sm font-semibold">
                            {new Date(record.consultationDate).getDate()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {new Date(record.consultationDate).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'long', year: 'numeric'
                            })}
                          </p>
                          <p className="text-xs text-slate-500">
                            Dr. {record.doctor?.email} · {record.prescriptions?.length || 0} medication{record.prescriptions?.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">
                          {record.diagnosis?.substring(0, 20)}{record.diagnosis?.length > 20 ? '...' : ''}
                        </span>
                        <svg
                          className={`w-4 h-4 text-slate-400 transition-transform ${
                            expandedRecord === record.id ? 'rotate-180' : ''
                          }`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expandedRecord === record.id && (
                      <div className="border-t border-slate-100 p-4 bg-slate-50">
                        {/* ── Clinical Notes ── */}
                        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                          <div className="bg-white rounded-lg p-3 border border-slate-100">
                            <p className="text-xs font-medium text-slate-400 uppercase mb-1">Symptoms</p>
                            <p className="text-slate-700">{record.symptoms}</p>
                          </div>
                          <div className="bg-white rounded-lg p-3 border border-slate-100">
                            <p className="text-xs font-medium text-slate-400 uppercase mb-1">Diagnosis</p>
                            <p className="text-slate-700">{record.diagnosis}</p>
                          </div>
                        </div>

                        {/* ── Vitals ── */}
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {record.bloodPressure && (
                            <div className="bg-blue-50 rounded-lg p-2 text-center">
                              <p className="text-xs text-blue-400">BP</p>
                              <p className="text-sm font-semibold text-blue-800">{record.bloodPressure}</p>
                            </div>
                          )}
                          {record.heartRate && (
                            <div className="bg-red-50 rounded-lg p-2 text-center">
                              <p className="text-xs text-red-400">Heart Rate</p>
                              <p className="text-sm font-semibold text-red-800">{record.heartRate} bpm</p>
                            </div>
                          )}
                          {record.temperature && (
                            <div className="bg-orange-50 rounded-lg p-2 text-center">
                              <p className="text-xs text-orange-400">Temp</p>
                              <p className="text-sm font-semibold text-orange-800">{record.temperature} °F</p>
                            </div>
                          )}
                          {record.spo2 && (
                            <div className="bg-green-50 rounded-lg p-2 text-center">
                              <p className="text-xs text-green-400">SpO2</p>
                              <p className="text-sm font-semibold text-green-800">{record.spo2}%</p>
                            </div>
                          )}
                          {record.weight && (
                            <div className="bg-purple-50 rounded-lg p-2 text-center">
                              <p className="text-xs text-purple-400">Weight</p>
                              <p className="text-sm font-semibold text-purple-800">{record.weight} kg</p>
                            </div>
                          )}
                          {record.respiratoryRate && (
                            <div className="bg-teal-50 rounded-lg p-2 text-center">
                              <p className="text-xs text-teal-400">Resp. Rate</p>
                              <p className="text-sm font-semibold text-teal-800">{record.respiratoryRate} /min</p>
                            </div>
                          )}
                        </div>

                        {/* ── System Examinations ── */}
                        {(record.rsExam || record.cvsExam || 
                          record.cnsExam || record.paExam) && (
                          <div className="mb-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                              System Examinations
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {[
                                { label: 'RS', value: record.rsExam, note: record.rsNote },
                                { label: 'CVS', value: record.cvsExam, note: record.cvsNote },
                                { label: 'CNS', value: record.cnsExam, note: record.cnsNote },
                                { label: 'PA', value: record.paExam, note: record.paNote },
                              ].filter(e => e.value).map(e => (
                                <div key={e.label}
                                  className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-slate-100 text-xs">
                                  <span className="font-semibold text-slate-600 w-8">{e.label}</span>
                                  <span className={`px-2 py-0.5 rounded-full font-medium ${
                                    e.value === 'Normal'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-red-100 text-red-700'
                                  }`}>{e.value}</span>
                                  {e.note && <span className="text-sm text-slate-600 ml-2">— {e.note}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ── General Assessment ── */}
                        {(record.allergy || record.edema || record.clubbing ||
                          record.icterus || record.pallor) && (
                          <div className="mb-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                              General Assessment
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {record.allergy && (
                                <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">
                                  Allergy{record.allergyNote ? `: ${record.allergyNote}` : ''}
                                </span>
                              )}
                              {record.edema && (
                                <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">
                                  Edema{record.edemaNote ? `: ${record.edemaNote}` : ''}
                                </span>
                              )}
                              {record.clubbing && (
                                <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full font-medium">Clubbing</span>
                              )}
                              {record.icterus && (
                                <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full font-medium">Icterus</span>
                              )}
                              {record.pallor && (
                                <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">Pallor</span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* ── Comorbidities / Medical History ── */}
                        {(record.historyDM || record.historyHTN ||
                          record.historyIHD || record.historyCVA ||
                          record.historyCKD || record.historyHypothyroid ||
                          record.historyCOPD) && (
                          <div className="mb-4">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                              Medical History / Comorbidities
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { key: 'historyDM', label: 'DM (Diabetes)' },
                                { key: 'historyHTN', label: 'HTN (Hypertension)' },
                                { key: 'historyIHD', label: 'IHD (Heart Disease)' },
                                { key: 'historyCVA', label: 'CVA (Stroke)' },
                                { key: 'historyCKD', label: 'CKD (Kidney Disease)' },
                                { key: 'historyHypothyroid', label: 'Hypothyroid' },
                                { key: 'historyCOPD', label: 'COPD/BA' },
                              ].filter(h => record[h.key]).map(h => (
                                <span key={h.key}
                                  className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded-full font-medium border border-red-100">
                                  {h.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ── Prescriptions ── */}
                        {record.prescriptions?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                              Prescribed Medications
                            </p>
                            <div className="flex flex-col gap-1.5">
                              {record.prescriptions.map(rx => (
                                <div key={rx.id}
                                  className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-slate-100 text-sm">
                                  <span className="font-medium text-slate-700">
                                    {rx.medicationName} ({rx.dosage})
                                  </span>
                                  <div className="flex items-center gap-3 text-slate-500 text-xs">
                                    <span>{rx.frequency}</span>
                                    <span>·</span>
                                    <span>{rx.duration}</span>
                                    {rx.instructions && (
                                      <>
                                        <span>·</span>
                                        <span className="italic">{rx.instructions}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {record.specialInstructions && (
                              <div className="mt-2 p-2 bg-amber-50 rounded-lg text-xs text-amber-700">
                                <span className="font-semibold">Advice: </span>
                                {record.specialInstructions}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Security (Change Password) ── */}
        {activeTab === "security" && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-sm">
            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              Change Password
            </h3>

            {pwSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                {pwSuccess}
              </div>
            )}
            {pwError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {pwError}
              </div>
            )}

            <form onSubmit={handleChangePassword} className="max-w-md space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={pwForm.currentPassword}
                  onChange={e => setPwForm({...pwForm, currentPassword: e.target.value})}
                  required
                  className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Enter current password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  value={pwForm.newPassword}
                  onChange={e => setPwForm({...pwForm, newPassword: e.target.value})}
                  required
                  minLength={8}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Min 8 characters"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={pwForm.confirmPassword}
                  onChange={e => setPwForm({...pwForm, confirmPassword: e.target.value})}
                  required
                  minLength={8}
                  className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Re-enter new password"
                />
              </div>
              <button
                type="submit"
                disabled={pwLoading}
                className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pwLoading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
    </ErrorBoundary>
  );
}
