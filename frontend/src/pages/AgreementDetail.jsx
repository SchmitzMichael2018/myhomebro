// src/pages/AgreementDetail.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const AgreementDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [agreement, setAgreement] = useState(null);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('access');

  useEffect(() => {
    const fetchAgreement = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8080/api/projects/agreements/${id}/`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) throw new Error('Failed to fetch agreement');
        const data = await res.json();
        setAgreement(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchAgreement();
  }, [id, token]);

  if (loading) return <p>Loading agreement details...</p>;
  if (!agreement) return <p>Agreement not found.</p>;

  return (
    <div className="p-4 bg-white rounded shadow-lg max-w-3xl mx-auto">
      <button onClick={() => navigate(-1)} className="mb-4 text-blue-500 hover:underline">
        ← Back to Agreements
      </button>
      <h2 className="text-2xl font-bold mb-2">{agreement.project_name}</h2>
      <p className="text-gray-600">Homeowner: {agreement.homeowner_name}</p>
      <p className="text-gray-600">Email: {agreement.homeowner_email}</p>
      <p className="text-gray-600">Phone: {agreement.homeowner_phone}</p>
      <p className="text-gray-600 mt-2">Start: {agreement.start_date}</p>
      <p className="text-gray-600">End: {agreement.end_date}</p>
      <p className="text-gray-600">Total Cost: ${agreement.total_cost}</p>

      <h3 className="text-xl font-semibold mt-6 mb-2">Milestones</h3>
      {agreement.milestone_invoices?.length > 0 ? (
        <ul className="divide-y divide-gray-200">
          {agreement.milestone_invoices.map((invoice) => (
            <li key={invoice.id} className="py-2">
              <p><strong>Title:</strong> {invoice.title}</p>
              <p><strong>Due:</strong> {invoice.due_date}</p>
              <p><strong>Status:</strong> {invoice.status}</p>
              <p><strong>Amount:</strong> ${invoice.amount}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No milestones yet.</p>
      )}
    </div>
  );
};

export default AgreementDetail;


