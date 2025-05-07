import { useState, useEffect } from 'react';

export default function InvoiceList({ token }) {
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    fetch('http://127.0.0.1:8080/api/projects/invoices/', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setInvoices(data));
  }, [token]);

  const handleAction = async (id, action) => {
    const response = await fetch(`http://127.0.0.1:8080/api/projects/invoices/${id}/${action}/`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      alert(`${action} successful`);
      const updated = await fetch('http://127.0.0.1:8080/api/projects/invoices/', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setInvoices(await updated.json());
    } else {
      alert(`${action} failed`);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Invoices</h2>
      {invoices.map(inv => (
        <div key={inv.id} className="bg-white shadow rounded p-4 mb-4">
          <div className="mb-2 font-semibold">Project: {inv.project_name}</div>
          <div>Homeowner: {inv.homeowner_name}</div>
          <div>Amount Due: ${inv.amount_due}</div>
          <div>Status: 
            {inv.is_paid ? ' ✅ Paid' :
             inv.pending_approval ? ' 🕒 Pending Approval' :
             inv.is_disputed ? ' ⚠️ Disputed' :
             inv.is_complete ? ' ⏳ Completed' : ' 🔘 Open'}
          </div>
          <div className="mt-3 flex gap-2">
            {!inv.is_complete && (
              <button
                className="bg-blue-500 text-white px-3 py-1 rounded"
                onClick={() => handleAction(inv.id, 'mark_complete')}
              >
                Mark Complete
              </button>
            )}
            {inv.pending_approval && (
              <button
                className="bg-green-600 text-white px-3 py-1 rounded"
                onClick={() => handleAction(inv.id, 'approve')}
              >
                Approve
              </button>
            )}
            {!inv.is_disputed && !inv.is_paid && (
              <button
                className="bg-red-600 text-white px-3 py-1 rounded"
                onClick={() => handleAction(inv.id, 'dispute')}
              >
                Dispute
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

