import { useState } from 'react';

export default function AddPatient() {
  const [formData, setFormData] = useState({
    full_name: '',
    dob: '',
    gender: 'Other',
    contact_number: '',
    medical_history: ''
  });
  
  const [status, setStatus] = useState({ type: '', message: '' });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: '', message: '' });

    // 1. Grab the Digital Badge from the browser vault
    const token = localStorage.getItem('aarogyam_token');

    try {
      // 2. Send the secure request to your Node server
      const response = await fetch('http://localhost:5000/api/patients', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` // Presenting the badge!
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        setStatus({ type: 'success', message: 'Patient registered successfully! ✅' });
        // Clear the form
        setFormData({ full_name: '', dob: '', gender: 'Other', contact_number: '', medical_history: '' });
      } else {
        setStatus({ type: 'error', message: data.error || 'Failed to add patient' });
      }
    } catch (err) {
      setStatus({ type: 'error', message: 'Server connection error.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mt-8">
      <h2 className="text-xl font-bold text-gray-800 mb-6">Register New Patient</h2>

      {status.message && (
        <div className={`p-4 rounded-lg mb-6 ${status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {status.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input type="text" name="full_name" value={formData.full_name} onChange={handleChange} required className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Contact Number</label>
            <input type="text" name="contact_number" value={formData.contact_number} onChange={handleChange} required className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
            <input type="date" name="dob" value={formData.dob} onChange={handleChange} required className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
            <select name="gender" value={formData.gender} onChange={handleChange} className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none">
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Medical History (Optional)</label>
          <textarea name="medical_history" value={formData.medical_history} onChange={handleChange} rows="3" className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Allergies, previous surgeries, chronic conditions..."></textarea>
        </div>

        <button type="submit" disabled={loading} className="w-full md:w-auto px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition disabled:opacity-70">
          {loading ? 'Saving...' : 'Register Patient'}
        </button>
      </form>
    </div>
  );
}