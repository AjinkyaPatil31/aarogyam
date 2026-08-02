'use client';
import { useState, useEffect, useRef } from 'react';
import DrugAutocomplete from '@/app/components/DrugAutocomplete';
import { generatePrescriptionPDF } from '@/app/lib/generatePrescriptionPDF';
import { calculateAge } from '@/app/lib/ageUtils';

function generateId() {
  return Math.random().toString(36).substring(2) +
         Date.now().toString(36);
}

export default function ConsultationModal({ patient, onClose, onSaved }) {
  // Patient's current age — computed on the fly from DOB at generation time
  // (never stored; refreshes automatically as time passes).
  const patientAge = calculateAge(patient.dateOfBirth);

  const [vitals, setVitals] = useState({
    symptoms: '',
    diagnosis: '',
    // Vital Signs (mandatory)
    bloodPressure: '',
    heartRate: '',
    temperature: '',
    spo2: '',
    weight: '',
    respiratoryRate: '',
    // System Examinations
    rsExam: 'Normal',
    cvsExam: 'Normal',
    cnsExam: 'Normal',
    paExam: 'Normal',
    // General Assessment
    allergy: false,
    allergyNote: '',
    edema: false,
    edemaNote: '',
    clubbing: false,
    icterus: false,
    pallor: false,
    // Medical History
    historyDM: false,
    historyHTN: false,
    historyIHD: false,
    historyCVA: false,
    historyCKD: false,
    historyHypothyroid: false,
    historyCOPD: false});

  const [medications, setMedications] = useState([
    {
      id: generateId(),
      name: '',
      dosage: '',
      dosageUnit: 'mg',
      frequency: { morning: false, afternoon: false, night: false },
      durationValue: '',
      durationUnit: 'Days',
      instructions: ''},
  ]);

  const [specialInstructions, setSpecialInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedRecord, setSavedRecord] = useState(null);
  const [showPrintView, setShowPrintView] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const [whatsAppSent, setWhatsAppSent] = useState(false);
  const [revealActions, setRevealActions] = useState(false);
  const printEndRef = useRef(null);

  // Reveal the bottom action bar only once the doctor scrolls to the end
  // of the prescription content (review-before-send workflow).
  useEffect(() => {
    if (!showPrintView || !savedRecord) return;
    setRevealActions(false);
    const sentinel = printEndRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealActions(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [showPrintView, savedRecord]);

  function addMedRow() {
    setMedications([...medications, {
      id: generateId(),
      name: '',
      dosage: '',
      dosageUnit: 'mg',
      frequency: { morning: false, afternoon: false, night: false },
      durationValue: '',
      durationUnit: 'Days',
      instructions: ''}]);
  }

  function removeMedRow(id) {
    setMedications(medications.filter(m => m.id !== id));
  }

  function updateMed(id, field, value) {
    setMedications(medications.map(m =>
      m.id === id ? { ...m, [field]: value } : m
    ));
  }

  function updateFreq(id, period) {
    setMedications(medications.map(m =>
      m.id === id
        ? { ...m, frequency: { ...m.frequency, [period]: !m.frequency[period] } }
        : m
    ));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');    if (!vitals.bloodPressure || !vitals.heartRate || 
        !vitals.temperature || !vitals.spo2 || 
        !vitals.weight || !vitals.respiratoryRate) {
      setError('All vital signs are required: BP, Heart Rate, Temperature, SpO2, Weight, and Respiratory Rate.');
      return;
    }

    if (medications.length === 0) {
      setError('Add at least one medication.');
      return;
    }
    for (const med of medications) {
      // Only the medication name is mandatory — dosage, duration and
      // frequency are optional so the doctor can decide what to specify.
      if (!med.name) {
        setError('Every medication must have a name.');
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch('/api/prescriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'},
        body: JSON.stringify({
          patientId: patient.patientId,
          appointmentId: patient.appointmentId,
          consultationDate: new Date().toISOString().split('T')[0],
          symptoms: vitals.symptoms,
          diagnosis: vitals.diagnosis,
          bloodPressure: vitals.bloodPressure,
          heartRate: vitals.heartRate,
          temperature: vitals.temperature,
          spo2: vitals.spo2,
          weight: vitals.weight,
          respiratoryRate: vitals.respiratoryRate,
          rsExam: vitals.rsExam,
          cvsExam: vitals.cvsExam,
          cnsExam: vitals.cnsExam,
          paExam: vitals.paExam,
          rsNote: vitals.rsExamNote || '',
          cvsNote: vitals.cvsExamNote || '',
          cnsNote: vitals.cnsExamNote || '',
          paNote: vitals.paExamNote || '',
          allergy: vitals.allergy,
          allergyNote: vitals.allergyNote,
          edema: vitals.edema,
          edemaNote: vitals.edemaNote,
          clubbing: vitals.clubbing,
          icterus: vitals.icterus,
          pallor: vitals.pallor,
          historyDM: vitals.historyDM,
          historyHTN: vitals.historyHTN,
          historyIHD: vitals.historyIHD,
          historyCVA: vitals.historyCVA,
          historyCKD: vitals.historyCKD,
          historyHypothyroid: vitals.historyHypothyroid,
          historyCOPD: vitals.historyCOPD,
          medications: medications.map(m => ({
            ...m,
            // Only append the unit when a dosage was actually entered
            dosage: m.dosage ? `${m.dosage}${m.dosageUnit}` : ''})),
          specialInstructions})});
      const data = await res.json();
      if (res.ok) {
        // Store record for print/WhatsApp
        setSavedRecord(data.record);
        setShowPrintView(true);
      } else {
        setError(data.error || 'Failed to save consultation.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePrintAndSend() {
    setSendingWhatsApp(true);
    try {
      // 1. Generate PDF
      const doc = generatePrescriptionPDF(
        {
          ...savedRecord,
          specialInstructions: savedRecord?.specialInstructions || savedRecord?.instructions || savedRecord?.advice || specialInstructions || ''
        },
        patient.patientName,
        patientAge
      );

      // 2. Open print dialog in new tab
      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const printWindow = window.open(pdfUrl, '_blank');
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
        };
      }

      // 3. Also download as backup
      const fileName = `prescription_${patient.patientName.replace(/\s+/g, '_')}_${savedRecord.consultationDate}.pdf`;
      doc.save(fileName);

      // 4. Send WhatsApp message
      const meds = savedRecord.prescriptions?.map(rx =>
        `• *${rx.medicationName}${rx.dosage ? ` (${rx.dosage})` : ''}* | ${rx.frequency || '—'} | ${rx.duration || '—'}${rx.instructions ? '\n  _' + rx.instructions + '_' : ''}`
      ).join('\n') || 'No medications';

      let message =
        `*AAROGYAM HEALTHCARE* 🏥\n` +
        `──────────────────\n` +
        `*Patient:* ${patient.patientName}\n`;
      if (patientAge != null) {
        message += `*Age:* ${patientAge} Years\n`;
      }
      message +=
        `*Date:* ${savedRecord.consultationDate}\n` +
        `*Diagnosis:* ${savedRecord.diagnosis}\n\n` +
        `*Rx Prescribed:*\n${meds}\n\n` +
        (savedRecord.specialInstructions
          ? `*Advice:* ${savedRecord.specialInstructions}\n\n`
          : '') +
        `──────────────────\n` +
        `_Issued by Aarogyam Healthcare_`;

      const phone = patient.contact || '';
      if (phone) {
        await fetch('/api/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, message })});
      }

      setWhatsAppSent(true);
    } catch (err) {
      console.error('Print or WhatsApp failed:', err);
    } finally {
      setSendingWhatsApp(false);
    }
  }

  /* ── Print Preview Screen ── */
  if (showPrintView && savedRecord) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
          {/* Print preview header */}
          <div className="p-6 border-b border-slate-100 no-print">
            <h2 className="text-lg font-semibold text-slate-800">
              Prescription Ready
            </h2>
          </div>

          {/* Prescription print body */}
          <div id="prescription-print" className="p-8">
            {/* Letterhead */}
            <div className="flex justify-between items-start mb-6 pb-4 border-b-2 border-slate-800">
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-wide">
                  AAROGYAM HEALTHCARE CENTER
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  Quality Healthcare for Everyone
                </p>
              </div>
              <div className="text-right text-sm text-slate-600">
                <p className="font-semibold">Consulting Physician</p>
                <p className="text-slate-500">Aarogyam Medical Team</p>
              </div>
            </div>

            {/* Patient metadata ribbon */}
            <div className="grid grid-cols-4 gap-4 p-3 bg-slate-50 rounded-lg mb-6 text-sm">
              <div>
                <p className="text-xs text-slate-400 uppercase">Patient</p>
                <p className="font-semibold text-slate-800">{patient.patientName}</p>
                {patientAge != null && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Age: {patientAge} Years
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase">Date</p>
                <p className="font-semibold text-slate-800">{savedRecord.consultationDate}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase">Diagnosis</p>
                <p className="font-semibold text-slate-800">{savedRecord.diagnosis}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase">Symptoms</p>
                <p className="font-semibold text-slate-800">{savedRecord.symptoms}</p>
              </div>
            </div>

            {/* Vitals row */}
            {(savedRecord.bloodPressure || savedRecord.heartRate ||
              savedRecord.temperature || savedRecord.spo2 ||
              savedRecord.weight || savedRecord.respiratoryRate) && (
              <div className="grid grid-cols-3 gap-3 mb-6">
                {savedRecord.bloodPressure && (
                  <div className="p-2 bg-blue-50 rounded-lg text-center">
                    <p className="text-xs text-blue-400">BP</p>
                    <p className="text-sm font-semibold text-blue-800">{savedRecord.bloodPressure}</p>
                  </div>
                )}
                {savedRecord.heartRate && (
                  <div className="p-2 bg-red-50 rounded-lg text-center">
                    <p className="text-xs text-red-400">Heart Rate</p>
                    <p className="text-sm font-semibold text-red-800">{savedRecord.heartRate} bpm</p>
                  </div>
                )}
                {savedRecord.temperature && (
                  <div className="p-2 bg-orange-50 rounded-lg text-center">
                    <p className="text-xs text-orange-400">Temp</p>
                    <p className="text-sm font-semibold text-orange-800">{savedRecord.temperature}°C</p>
                  </div>
                )}
                {savedRecord.spo2 && (
                  <div className="p-2 bg-green-50 rounded-lg text-center">
                    <p className="text-xs text-green-400">SpO2</p>
                    <p className="text-sm font-semibold text-green-800">{savedRecord.spo2}%</p>
                  </div>
                )}
                {savedRecord.weight && (
                  <div className="p-2 bg-purple-50 rounded-lg text-center">
                    <p className="text-xs text-purple-400">Weight</p>
                    <p className="text-sm font-semibold text-purple-800">{savedRecord.weight} kg</p>
                  </div>
                )}
                {savedRecord.respiratoryRate && (
                  <div className="p-2 bg-teal-50 rounded-lg text-center">
                    <p className="text-xs text-teal-400">Resp. Rate</p>
                    <p className="text-sm font-semibold text-teal-800">{savedRecord.respiratoryRate} /min</p>
                  </div>
                )}
              </div>
            )}

            {/* System Examinations */}
            {(savedRecord.rsExam || savedRecord.cvsExam || 
              savedRecord.cnsExam || savedRecord.paExam) && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
                  System Examinations
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'RS (Respiratory System)', value: savedRecord.rsExam, note: savedRecord.rsNote || vitals?.rsExamNote || '' },
                    { label: 'CVS (Cardiovascular System)', value: savedRecord.cvsExam, note: savedRecord.cvsNote || vitals?.cvsExamNote || '' },
                    { label: 'CNS (Central Nervous System)', value: savedRecord.cnsExam, note: savedRecord.cnsNote || vitals?.cnsExamNote || '' },
                    { label: 'PA (Physical Appearance)', value: savedRecord.paExam, note: savedRecord.paNote || vitals?.paExamNote || '' },
                  ].filter(e => e.value).map(e => (
                    <div key={e.label} className="bg-white rounded-lg p-3 border border-slate-100">
                      <span className="text-xs font-medium text-slate-500 block mb-1">{e.label}</span>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                          e.value === 'Abnormal' 
                            ? 'bg-red-50 text-red-600' 
                            : 'bg-green-50 text-green-600'
                        }`}>{e.value}</span>
                        {e.note && (
                          <span className="text-sm text-slate-600">{e.note}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Prescription table */}
            <div className="mb-6">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3">
                Rx — Prescribed Medications
              </h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600 rounded-tl-lg">Medication</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">Dosage</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600">Frequency</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-600 rounded-tr-lg">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {savedRecord.prescriptions?.map((rx, i) => (
                    <tr key={rx.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="py-2 px-3 font-medium text-slate-800">{rx.medicationName}</td>
                      <td className="py-2 px-3 text-slate-600">{rx.dosage}</td>
                      <td className="py-2 px-3 text-slate-600">{rx.frequency}</td>
                      <td className="py-2 px-3 text-slate-600">{rx.duration}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Special Instructions / Advice */}
            {(savedRecord.specialInstructions || savedRecord.instructions || savedRecord.advice || specialInstructions) && (
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-lg mb-6">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Special Instructions / Advice
                </span>
                <p className="text-sm text-slate-700 whitespace-pre-wrap">
                  {savedRecord.specialInstructions || savedRecord.instructions || savedRecord.advice || specialInstructions}
                </p>
              </div>
            )}

            {/* Footer signature — acts as the "end of prescription" sentinel */}
            <div ref={printEndRef} className="flex justify-end mt-8 pt-4 border-t border-slate-200">
              <div className="text-right">
                <p className="text-sm font-script text-slate-600 italic">
                  Digitally Signed by Aarogyam Healthcare
                </p>
                <p className="text-xs text-slate-400 mt-1">{savedRecord.consultationDate}</p>
              </div>
            </div>
          </div>

          {whatsAppSent && (
            <div className="mx-6 mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 no-print">
              ✅ Prescription sent to patient via WhatsApp
            </div>
          )}

          {/* Bottom action bar — appears only after the doctor scrolls to the
              end of the prescription (review-before-send workflow) */}
          <div
            className={`no-print border-t border-slate-100 p-4 sm:p-6 transition-all duration-500 ease-out ${
              revealActions
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-3 pointer-events-none'
            }`}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end sm:items-center">
              <button
                onClick={handlePrintAndSend}
                disabled={sendingWhatsApp}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
              >
                {sendingWhatsApp ? 'Generating...' : '🖨️ Print & Send WhatsApp'}
              </button>
              <button
                onClick={() => { onSaved(savedRecord); }}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              Consultation — {patient.patientName}
              {!patient.appointmentId && (
                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                  Walk-in
                </span>
              )}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {new Date().toLocaleDateString('en-IN', {
                day: 'numeric', month: 'long', year: 'numeric'
              })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 flex flex-col gap-6">

            {/* ── SECTION 1: Symptoms & Diagnosis ── */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Clinical Notes
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Symptoms <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="Presenting symptoms..."
                    value={vitals.symptoms}
                    onChange={e => setVitals({...vitals, symptoms: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Diagnosis <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={2}
                    placeholder="Clinical diagnosis..."
                    value={vitals.diagnosis}
                    onChange={e => setVitals({...vitals, diagnosis: e.target.value})}
                    required
                  />
                </div>
              </div>
            </div>

            {/* ── SECTION 2: Vital Signs (all mandatory) ── */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Vital Signs <span className="text-red-500">*</span> (all required)
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Blood Pressure (mmHg)
                  </label>
                  <input
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 120/80"
                    value={vitals.bloodPressure}
                    onChange={e => setVitals({...vitals, bloodPressure: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Heart Rate (bpm)
                  </label>
                  <input
                    type="number"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 72"
                    min="30" max="200"
                    value={vitals.heartRate}
                    onChange={e => setVitals({...vitals, heartRate: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Temperature (°F)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 98.6"
                    value={vitals.temperature}
                    onChange={e => setVitals({...vitals, temperature: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    SpO2 (%)
                  </label>
                  <input
                    type="number"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 98"
                    min="0" max="100"
                    value={vitals.spo2}
                    onChange={e => setVitals({...vitals, spo2: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 70"
                    value={vitals.weight}
                    onChange={e => setVitals({...vitals, weight: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500">
                    Respiratory Rate (breaths/min)
                  </label>
                  <input
                    type="number"
                    className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. 16"
                    min="8" max="40"
                    value={vitals.respiratoryRate}
                    onChange={e => setVitals({...vitals, respiratoryRate: e.target.value})}
                    required
                  />
                </div>
              </div>
            </div>

            {/* ── SECTION 3: System Examinations (Normal/Abnormal + notes) ── */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                System Examinations (optional)
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'rsExam', label: 'RS — Respiratory System' },
                  { key: 'cvsExam', label: 'CVS — Cardiovascular System' },
                  { key: 'cnsExam', label: 'CNS — Central Nervous System' },
                  { key: 'paExam', label: 'PA — Physical Appearance / Pulmonary Artery' },
                ].map(field => (
                  <div key={field.key}>
                    <label className="text-xs font-medium text-slate-500">{field.label}</label>
                    <div className="flex gap-2 mt-1">
                      <button
                        type="button"
                        onClick={() => setVitals({...vitals, [field.key]: 'Normal'})}
                        className={`flex-1 py-1.5 text-xs rounded-lg font-medium border transition-all
                          ${vitals[field.key] === 'Normal'
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-white text-slate-500 border-slate-200 hover:border-green-400'}`}
                      >
                        Normal
                      </button>
                      <button
                        type="button"
                        onClick={() => setVitals({...vitals, [field.key]: 'Abnormal'})}
                        className={`flex-1 py-1.5 text-xs rounded-lg font-medium border transition-all
                          ${vitals[field.key] === 'Abnormal'
                            ? 'bg-red-600 text-white border-red-600'
                            : 'bg-white text-slate-500 border-slate-200 hover:border-red-400'}`}
                      >
                        Abnormal
                      </button>
                      <input
                        className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Notes..."
                        value={vitals[field.key + 'Note'] || ''}
                        onChange={e => setVitals({...vitals, [field.key + 'Note']: e.target.value})}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── SECTION 4: General Assessment ── */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                General Assessment (optional)
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {/* Allergy — checkbox + note */}
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded accent-blue-600"
                      checked={vitals.allergy}
                      onChange={e => setVitals({...vitals, allergy: e.target.checked})}
                    />
                    <span className="text-xs font-medium text-slate-600">Allergy</span>
                  </label>
                  {vitals.allergy && (
                    <input
                      className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Specify allergy..."
                      value={vitals.allergyNote}
                      onChange={e => setVitals({...vitals, allergyNote: e.target.value})}
                    />
                  )}
                </div>
                {/* Edema — checkbox + note */}
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded accent-blue-600"
                      checked={vitals.edema}
                      onChange={e => setVitals({...vitals, edema: e.target.checked})}
                    />
                    <span className="text-xs font-medium text-slate-600">Edema</span>
                  </label>
                  {vitals.edema && (
                    <input
                      className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Location/description..."
                      value={vitals.edemaNote}
                      onChange={e => setVitals({...vitals, edemaNote: e.target.value})}
                    />
                  )}
                </div>
                {/* Simple checkboxes */}
                {[
                  { key: 'clubbing', label: 'Clubbing', desc: 'Abnormal curving of fingernail' },
                  { key: 'icterus', label: 'Icterus', desc: 'Jaundice (yellowing of skin/eyes)' },
                  { key: 'pallor', label: 'Pallor', desc: 'Paleness of the skin' },
                ].map(item => (
                  <label key={item.key} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded accent-blue-600 mt-0.5"
                      checked={vitals[item.key]}
                      onChange={e => setVitals({...vitals, [item.key]: e.target.checked})}
                    />
                    <div>
                      <span className="text-xs font-medium text-slate-600">{item.label}</span>
                      <p className="text-xs text-slate-400">{item.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* ── SECTION 5: Medical History ── */}
            <div>
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">
                Medical History (optional)
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: 'historyDM', label: 'DM', desc: 'Diabetes Mellitus' },
                  { key: 'historyHTN', label: 'HTN', desc: 'Hypertension' },
                  { key: 'historyIHD', label: 'IHD', desc: 'Ischemic Heart Disease' },
                  { key: 'historyCVA', label: 'CVA', desc: 'Cerebrovascular Accident (Stroke)' },
                  { key: 'historyCKD', label: 'CKD', desc: 'Chronic Kidney Disease' },
                  { key: 'historyHypothyroid', label: 'HYPOTHYROID', desc: 'Hypothyroidism' },
                  { key: 'historyCOPD', label: 'COPD/BA', desc: 'COPD / Bronchial Asthma' },
                ].map(item => (
                  <label key={item.key} className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded accent-blue-600 mt-0.5"
                      checked={vitals[item.key]}
                      onChange={e => setVitals({...vitals, [item.key]: e.target.checked})}
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-700">{item.label}</span>
                      <p className="text-xs text-slate-400">{item.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Medications */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
                Prescription
              </h3>

              <div className="flex flex-col gap-3">
                {medications.map((med, idx) => (
                  <div key={med.id}
                    className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          Medication Name *
                        </label>
                        <div className="mt-1">
                          <DrugAutocomplete
                            value={med.name}
                            onChange={(val) => updateMed(med.id, 'name', val)}
                            placeholder="Search drug name..."
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          Dosage
                        </label>
                        <div className="flex gap-1 mt-1">
                          <input
                            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="e.g. 500"
                            value={med.dosage}
                            onChange={e => updateMed(med.id, 'dosage', e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => updateMed(med.id, 'dosageUnit', 'mg')}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all
                              ${med.dosageUnit === 'mg'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-blue-400'}`}
                          >
                            mg
                          </button>
                          <button
                            type="button"
                            onClick={() => updateMed(med.id, 'dosageUnit', 'ml')}
                            className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all
                              ${med.dosageUnit === 'ml'
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-slate-500 border-slate-200 hover:border-blue-400'}`}
                          >
                            ml
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div>
                        <label className="text-xs font-medium text-slate-500 block mb-1">
                          Frequency
                        </label>
                        <div className="flex gap-1">
                          {['morning','afternoon','night'].map(period => (
                            <button
                              key={period}
                              type="button"
                              onClick={() => updateFreq(med.id, period)}
                              className={`flex-1 py-1.5 text-xs rounded-lg font-medium border transition-all
                                ${med.frequency[period]
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                                }`}
                            >
                              {period === 'morning' ? 'M' : period === 'afternoon' ? 'A' : 'N'}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-slate-400 mt-1 text-center">
                          {[
                            med.frequency.morning ? '1' : '0',
                            med.frequency.afternoon ? '1' : '0',
                            med.frequency.night ? '1' : '0',
                          ].join('-')}
                        </p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          Duration
                        </label>
                        <div className="flex gap-1 mt-1">
                          <input
                            className="w-16 px-2 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="5"
                            value={med.durationValue}
                            onChange={e => updateMed(med.id, 'durationValue', e.target.value)}
                          />
                          <select
                            className="flex-1 px-2 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={med.durationUnit}
                            onChange={e => updateMed(med.id, 'durationUnit', e.target.value)}
                          >
                            <option>Days</option>
                            <option>Weeks</option>
                            <option>Months</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500">
                          Instructions
                        </label>
                        <input
                          className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="e.g. After meals"
                          value={med.instructions}
                          onChange={e => updateMed(med.id, 'instructions', e.target.value)}
                        />
                      </div>
                    </div>

                    {medications.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeMedRow(med.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium"
                      >
                        Remove this medication
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addMedRow}
                className="mt-3 text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-medium"
              >
                + Add Medication
              </button>
            </div>

            {/* Special Instructions */}
            <div>
              <label className="text-sm font-semibold text-slate-700 uppercase tracking-wide text-xs">
                Special Instructions / Advice
              </label>
              <textarea
                className="w-full mt-2 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="e.g. Take after meals with warm water. Avoid dairy for 2 hours after intake."
                value={specialInstructions}
                onChange={e => setSpecialInstructions(e.target.value)}
              />
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-3 p-6 border-t border-slate-100">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 text-sm"
            >
              {loading ? 'Saving...' : 'Issue & Sign Prescription'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 bg-slate-100 text-slate-700 py-2.5 rounded-xl font-medium hover:bg-slate-200 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
