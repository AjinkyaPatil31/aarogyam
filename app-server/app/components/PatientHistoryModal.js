'use client';
import { useState, useEffect } from 'react';
import { generatePrescriptionPDF } from '../lib/generatePrescriptionPDF';

const vitalsColorMap = {
  blue: 'bg-blue-100 text-blue-800',
  red: 'bg-red-100 text-red-800',
  orange: 'bg-orange-100 text-orange-800',
  green: 'bg-green-100 text-green-800',
  purple: 'bg-purple-100 text-purple-800',
  teal: 'bg-teal-100 text-teal-800',
};

export default function PatientHistoryModal({ patient, onClose }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedRecord, setExpandedRecord] = useState(null);

  useEffect(() => {
    fetchHistory();
  }, []);

  async function handleReprint(record) {
    try {
      const doc = await generatePrescriptionPDF(record, patient.patientName);
      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const printWindow = window.open(pdfUrl, '_blank');
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
        };
      }
      const fileName = `prescription_${patient.patientName.replace(/\s+/g, '_')}_${record.consultationDate}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error('Reprint failed:', err);
    }
  }

  async function fetchHistory() {
    setLoading(true);
    const token = localStorage.getItem('aarogyam_token');
    try {
      const res = await fetch(
        `/api/prescriptions?patientId=${patient.patientId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8">

        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              {patient.patientName} — Visit History
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {records.length} visit{records.length !== 1 ? 's' : ''} on record
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[1,2,3].map(i => (
                <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-slate-500 text-sm font-medium">No visits recorded yet</p>
              <p className="text-slate-400 text-xs mt-1">
                Start a consultation to create the first record
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {records.map(record => (
                <div key={record.id}
                  className="border border-slate-200 rounded-xl overflow-hidden">

                  {/* Clickable visit row */}
                  <div
                    onClick={() => setExpandedRecord(
                      expandedRecord === record.id ? null : record.id
                    )}
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-700 text-sm font-bold">
                          {new Date(record.consultationDate).getDate()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {new Date(record.consultationDate).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'long', year: 'numeric'
                          })}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {record.diagnosis} · {record.prescriptions?.length || 0} medication{record.prescriptions?.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleReprint(record)}
                        className="px-3 py-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors border border-emerald-200 flex items-center gap-1"
                      >
                        🖨️ Reprint
                      </button>
                      <svg
                        className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
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
                    <div className="border-t border-slate-100 bg-slate-50 p-4">

                      {/* Clinical notes */}
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-white rounded-lg p-3 border border-slate-100">
                          <p className="text-xs font-medium text-slate-400 uppercase mb-1">Symptoms</p>
                          <p className="text-sm text-slate-700">{record.symptoms}</p>
                        </div>
                        <div className="bg-white rounded-lg p-3 border border-slate-100">
                          <p className="text-xs font-medium text-slate-400 uppercase mb-1">Diagnosis</p>
                          <p className="text-sm text-slate-700">{record.diagnosis}</p>
                        </div>
                      </div>

                      {/* Vitals */}
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        {[
                          { label: 'BP', value: record.bloodPressure, unit: 'mmHg', color: 'blue' },
                          { label: 'Heart Rate', value: record.heartRate, unit: 'bpm', color: 'red' },
                          { label: 'Temp', value: record.temperature, unit: '°F', color: 'orange' },
                          { label: 'SpO2', value: record.spo2, unit: '%', color: 'green' },
                          { label: 'Weight', value: record.weight, unit: 'kg', color: 'purple' },
                          { label: 'Resp. Rate', value: record.respiratoryRate, unit: '/min', color: 'teal' },
                        ].filter(v => v.value).map(v => (
                          <div key={v.label}
                            className={`p-2 rounded-lg text-center ${vitalsColorMap[v.color]}`}>
                            <p className="text-xs opacity-60">{v.label}</p>
                            <p className="text-sm font-semibold">
                              {v.value} {v.unit}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* System examinations */}
                      {(record.rsExam || record.cvsExam || 
                        record.cnsExam || record.paExam) && (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            System Examinations
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: 'RS', value: record.rsExam, note: record.rsNote, fullLabel: 'RS (Respiratory System)' },
                              { label: 'CVS', value: record.cvsExam, note: record.cvsNote, fullLabel: 'CVS (Cardiovascular System)' },
                              { label: 'CNS', value: record.cnsExam, note: record.cnsNote, fullLabel: 'CNS (Central Nervous System)' },
                              { label: 'PA', value: record.paExam, note: record.paNote, fullLabel: 'PA (Physical Appearance)' },
                            ].filter(e => e.value).map(e => (
                              <div key={e.label}
                                className="flex flex-col bg-white rounded-lg px-3 py-2 border border-slate-100 text-xs gap-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-600 w-8">{e.label}</span>
                                  <span className={`px-2 py-0.5 rounded-full font-medium ${
                                    e.value === 'Normal' 
                                      ? 'bg-green-100 text-green-700' 
                                      : 'bg-red-100 text-red-700'
                                  }`}>{e.value}</span>
                                </div>
                                {e.note && (
                                  <p className="text-slate-500 ml-10 leading-relaxed">{e.note}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* General assessment */}
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

                      {/* Medical history */}
                      {(record.historyDM || record.historyHTN || 
                        record.historyIHD || record.historyCVA ||
                        record.historyCKD || record.historyHypothyroid || 
                        record.historyCOPD) && (
                        <div className="mb-4">
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            Medical History
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { key: 'historyDM', label: 'DM' },
                              { key: 'historyHTN', label: 'HTN' },
                              { key: 'historyIHD', label: 'IHD' },
                              { key: 'historyCVA', label: 'CVA' },
                              { key: 'historyCKD', label: 'CKD' },
                              { key: 'historyHypothyroid', label: 'HYPOTHYROID' },
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

                      {/* Prescriptions */}
                      {record.prescriptions?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                            Prescribed Medications
                          </p>
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-white border border-slate-100">
                                <th className="text-left py-2 px-3 font-semibold text-slate-500">Medication</th>
                                <th className="text-left py-2 px-3 font-semibold text-slate-500">Dosage</th>
                                <th className="text-left py-2 px-3 font-semibold text-slate-500">Frequency</th>
                                <th className="text-left py-2 px-3 font-semibold text-slate-500">Duration</th>
                              </tr>
                            </thead>
                            <tbody>
                              {record.prescriptions.map((rx, i) => (
                                <tr key={rx.id}
                                  className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                  <td className="py-2 px-3 font-medium text-slate-700">
                                    {rx.medicationName}
                                  </td>
                                  <td className="py-2 px-3 text-slate-600">{rx.dosage}</td>
                                  <td className="py-2 px-3 text-slate-600">{rx.frequency}</td>
                                  <td className="py-2 px-3 text-slate-600">{rx.duration}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* Special Instructions / Advice */}
                          {(record.specialInstructions || record.instructions || record.advice) && (
                            <div className="mt-4 p-3 bg-slate-50 border border-slate-100 rounded-lg">
                              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                                Special Instructions / Advice
                              </span>
                              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                                {record.specialInstructions || record.instructions || record.advice}
                              </p>
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
      </div>
    </div>
  );
}
