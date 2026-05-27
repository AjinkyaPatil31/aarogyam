import { useState, useEffect } from 'react';

export default function PatientList() {
  const [patients, setPatients] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchPatients = async () => {
      const token = localStorage.getItem('aarogyam_token');
      try {
        const response = await fetch('http://localhost:5000/api/patients', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await response.json();
        
        if (response.ok) {
          setPatients(data.patients);
        } else {
          setError(data.error || 'Failed to retrieve patient index');
        }
      } catch (err) {
        setError('Network error tracking system database');
      }
    };

    fetchPatients();
  }, []);

  return (
    <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #ccc' }}>
      <h3>Active Patient Records</h3>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {patients.length === 0 ? (
        <p>No records found.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
              <th>Name</th>
              <th>Age</th>
              <th>Contact</th>
            </tr>
          </thead>
<tbody>
            {patients.map((patient) => (
              <tr key={patient.patient_id} style={{ borderBottom: '1px solid #eee' }}>
                <td>{patient.full_name}</td>
                <td>{patient.age}</td>
                <td>{patient.contact_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}