import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import PatientList from './PatientList';
import AddPatient from './AddPatient';
import PatientProfile from './PatientProfile';

export default function App() {
  // Authentication check primitive
  const isAuthenticated = !!localStorage.getItem('aarogyam_token');

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
        
        <Routes>
          {/* Route 1: Login Gate */}
          <Route 
            path="/" 
            element={
              isAuthenticated ? <Navigate to="/dashboard" /> : <div>Login Component Placeholder</div>
            } 
          />

          {/* Route 2: The Main Dashboard */}
          <Route 
            path="/dashboard" 
            element={
              !isAuthenticated ? <Navigate to="/" /> : (
                <div className="p-6">
                  <h1 className="text-2xl font-bold text-slate-900 mb-6">Patient Directory</h1>
                  <AddPatient />
                  <div className="mt-8">
                    <PatientList />
                  </div>
                </div>
              )
            } 
          />

          {/* Route 3: The Specific Patient File */}
          <Route 
            path="/patient/:id" 
            element={
              !isAuthenticated ? <Navigate to="/" /> : <PatientProfile />
            } 
          />
        </Routes>

      </div>
    </Router>
  );
}