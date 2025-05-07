import { useState, useEffect } from 'react';
import Modal from 'react-modal';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';

// REMOVE any problematic CSS imports from node_modules
// Instead, load this in index.html:
// <link href="https://cdn.jsdelivr.net/npm/@fullcalendar/daygrid@6.1.8/main.min.css" rel="stylesheet" />

Modal.setAppElement('#root');

export default function AgreementForm({ token }) {
  const [formData, setFormData] = useState({
    contractor: '',
    project: '',
    homeowner_name: '',
    homeowner_email: '',
    project_name: '',
    description: '',
    start_date: '',
    end_date: '',
    total_cost: '',
    milestone_count: '',
  });

  const [contractors, setContractors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [milestoneInvoices, setMilestoneInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const headers = { Authorization: `Bearer ${token}` };
        const [contractorRes, projectRes] = await Promise.all([
          fetch('http://127.0.0.1:8080/api/projects/contractors/', { headers }),
          fetch('http://127.0.0.1:8080/api/projects/projects/', { headers }),
        ]);
        setContractors(await contractorRes.json());
        setProjects(await projectRes.json());
      } catch (err) {
        console.error('Failed to fetch dropdown data:', err);
      }
    };
    fetchData();

    // TEMP: Show test invoice
    setMilestoneInvoices([
      {
        id: 1,
        amount_due: 250,
        due_date: '2025-05-10',
        is_paid: false,
        is_approved: false,
        is_complete: false,
      },
    ]);
  }, [token]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMilestoneInvoices([]);

    try {
      const payload = {
        ...formData,
        total_cost: parseFloat(formData.total_cost),
        milestone_count: parseInt(formData.milestone_count),
      };

      const res = await fetch('http://127.0.0.1:8080/api/projects/agreements/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || 'Failed to create agreement.');

      alert('Agreement created successfully!');

      await fetch(
        `http://127.0.0.1:8080/api/projects/agreements/${data.id}/fund_escrow/`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
      );

      const updatedRes = await fetch(
        `http://127.0.0.1:8080/api/projects/agreements/${data.id}/`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const updatedAgreement = await updatedRes.json();
      setMilestoneInvoices(updatedAgreement.milestone_invoices);
    } catch (error) {
      console.error(error);
      alert(error.message || 'Error creating agreement.');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (invoiceId, action) => {
    const endpointMap = {
      complete: `http://127.0.0.1:8080/api/projects/invoices/${invoiceId}/mark_complete/`,
      approve: `http://127.0.0.1:8080/api/projects/invoices/${invoiceId}/approve/`,
      dispute: `http://127.0.0.1:8080/api/projects/invoices/${invoiceId}/dispute/`,
    };

    try {
      const res = await fetch(endpointMap[action], {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to ${action} invoice.`);
      const updatedInvoice = await res.json();

      setMilestoneInvoices(prev =>
        prev.map(inv => (inv.id === updatedInvoice.id ? updatedInvoice : inv))
      );
      setSelectedInvoice(updatedInvoice);
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };

  return (
    <div className="p-4">
      <form onSubmit={handleSubmit} className="bg-white shadow p-6 rounded max-w-xl mx-auto mb-8">
        <h2 className="text-xl font-bold mb-4">Create Agreement</h2>

        {/* Contractor / Project Select */}
        {[{ name: 'contractor', label: 'Contractor', options: contractors, labelKey: 'name' },
          { name: 'project', label: 'Project', options: projects, labelKey: 'project_title' },
        ].map(({ name, label, options, labelKey }) => (
          <div className="mb-4" key={name}>
            <label className="block text-sm font-medium mb-1" htmlFor={name}>{label}</label>
            <select
              id={name}
              name={name}
              value={formData[name]}
              onChange={handleChange}
              className="w-full border p-2 rounded"
              required
            >
              <option value="">Select {label}</option>
              {options.map(opt => (
                <option key={opt.id} value={opt.id}>{opt[labelKey]}</option>
              ))}
            </select>
          </div>
        ))}

        {/* Remaining Fields */}
        {[ 'homeowner_name', 'homeowner_email', 'project_name', 'description', 'start_date', 'end_date', 'total_cost', 'milestone_count'
        ].map(field => (
          <div className="mb-4" key={field}>
            <label className="block text-sm font-medium mb-1" htmlFor={field}>
              {field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </label>
            <input
              type={field.includes('date') ? 'date' : field.includes('cost') || field.includes('count') ? 'number' : 'text'}
              id={field}
              name={field}
              value={formData[field]}
              onChange={handleChange}
              className="w-full border p-2 rounded"
              required
            />
          </div>
        ))}

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          disabled={loading}
        >
          {loading ? 'Submitting...' : 'Submit Agreement'}
        </button>
      </form>

      {/* Calendar View */}
      {milestoneInvoices.length > 0 && (
        <div className="max-w-4xl mx-auto mt-8">
          <h3 className="text-lg font-semibold mb-2">Milestone Calendar</h3>
          <FullCalendar
            plugins={[dayGridPlugin]}
            initialView="dayGridMonth"
            height="auto"
            events={milestoneInvoices.map(inv => ({
              id: String(inv.id),
              title: `Invoice #${inv.id} - $${inv.amount_due}`,
              date: inv.due_date,
              backgroundColor: inv.is_paid ? '#16a34a' : inv.is_approved ? '#f59e0b' : '#3b82f6',
              allDay: true,
            }))}
            eventClick={(info) => {
              const invoice = milestoneInvoices.find(i => i.id === parseInt(info.event.id));
              setSelectedInvoice(invoice);
            }}
          />

          <Modal
            isOpen={!!selectedInvoice}
            onRequestClose={() => setSelectedInvoice(null)}
            contentLabel="Invoice Details"
            className="bg-white p-6 max-w-md mx-auto mt-24 rounded shadow-lg outline-none"
            overlayClassName="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-start z-50"
          >
            {selectedInvoice && (
              <>
                <h2 className="text-xl font-bold mb-4">Invoice #{selectedInvoice.id}</h2>
                <p><strong>Amount:</strong> ${selectedInvoice.amount_due.toFixed(2)}</p>
                <p><strong>Due Date:</strong> {selectedInvoice.due_date}</p>
                <p><strong>Status:</strong> {
                  selectedInvoice.is_paid ? 'Paid' :
                  selectedInvoice.is_approved ? 'Approved' :
                  selectedInvoice.is_complete ? 'Completed' : 'Pending'
                }</p>

                {!selectedInvoice.is_paid && (
                  <div className="mt-4 space-x-2">
                    {!selectedInvoice.is_complete && (
                      <button
                        onClick={() => handleAction(selectedInvoice.id, 'complete')}
                        className="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                      >Mark Complete</button>
                    )}
                    {selectedInvoice.is_complete && !selectedInvoice.is_approved && (
                      <>
                        <button
                          onClick={() => handleAction(selectedInvoice.id, 'approve')}
                          className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                        >Approve</button>
                        <button
                          onClick={() => handleAction(selectedInvoice.id, 'dispute')}
                          className="bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700"
                        >Dispute</button>
                      </>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setSelectedInvoice(null)}
                  className="mt-6 text-gray-500 hover:underline"
                >Close</button>
              </>
            )}
          </Modal>
        </div>
      )}
    </div>
  );
}

