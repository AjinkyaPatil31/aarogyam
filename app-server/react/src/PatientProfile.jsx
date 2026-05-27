import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

export default function PatientProfile() {
  // useParams extracts the dynamic ':id' variable from the browser URL
  const { id } = useParams(); 
  const navigate = useNavigate();

  // Local state management (variables that trigger UI updates when changed)
  const [activeTab, setActiveTab] = useState('vitals');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Helper function to apply active tab styling dynamically
  const getTabStyle = (tabName) => {
    const baseStyle = "px-6 py-3 font-semibold text-sm transition-colors border-b-2 ";
    return activeTab === tabName 
      ? baseStyle + "border-green-500 text-green-600 bg-white" 
      : baseStyle + "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 bg-slate-100";
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 flex relative overflow-hidden">
      
      {/* Main Content Area */}
      <div className="flex-1 max-w-5xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-3rem)]">
        
        {/* Header Section */}
        <div className="bg-slate-900 px-6 py-4 flex justify-between items-center text-white">
          <div>
            <button 
              onClick={() => navigate('/dashboard')}
              className="text-slate-300 hover:text-white text-sm mb-1 flex items-center gap-1"
            >
              ← Back to Dashboard
            </button>
            <h2 className="text-2xl font-bold">Patient File: #{id}</h2>
          </div>
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm font-medium transition-colors"
          >
            View History
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 bg-slate-100">
          <button onClick={() => setActiveTab('vitals')} className={getTabStyle('vitals')}>
            Measurable Parameters
          </button>
          <button onClick={() => setActiveTab('diagnosis')} className={getTabStyle('diagnosis')}>
            Diagnosis & Prescription
          </button>
          <button onClick={() => setActiveTab('treatment')} className={getTabStyle('treatment')}>
            Treatment Plan
          </button>
        </div>

        {/* Tab Content Area (Conditional Rendering) */}
        <div className="p-6 overflow-y-auto flex-1 bg-white">
          {activeTab === 'vitals' && (
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4">Vitals & Parameters</h3>
              <p className="text-slate-600">Input fields for SpO2, Blood Pressure, etc., will be built here.</p>
            </div>
          )}
          {activeTab === 'diagnosis' && (
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4">Diagnosis & Prescription</h3>
              <textarea 
                className="w-full h-48 p-4 border border-slate-300 rounded focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none resize-none"
                placeholder="Enter clinical diagnosis and medication..."
              ></textarea>
              <button className="mt-4 bg-green-500 hover:bg-green-600 text-white px-6 py-2 rounded font-medium">
                Save Prescription
              </button>
            </div>
          )}
          {activeTab === 'treatment' && (
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4">Long-term Treatment Plan</h3>
              <p className="text-slate-600">Follow-up schedules and care instructions will be built here.</p>
            </div>
          )}
        </div>
      </div>

      {/* History Drawer Overlay (Conditionally rendered when isHistoryOpen is true) */}
      {isHistoryOpen && (
        <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm z-40 flex justify-end">
          <div className="w-1/3 min-w-[400px] h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col slide-in-right">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 text-lg">Visit History</h3>
              <button 
                onClick={() => setIsHistoryOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-xl font-bold px-2"
              >
                ×
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-sm text-slate-500 italic">Timeline of past visits and historical prescriptions will load here.</p>
              {/* Dummy Timeline Item */}
              <div className="mt-4 border-l-2 border-green-500 pl-4 py-2">
                <p className="text-xs text-slate-400 font-semibold mb-1">Oct 12, 2025</p>
                <p className="text-sm text-slate-700">Diagnosis: Viral Pharyngitis</p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}