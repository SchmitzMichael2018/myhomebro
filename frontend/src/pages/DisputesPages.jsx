// src/pages/DisputesPage.jsx

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';

// A sub-component for rendering the table, keeping the main component clean.
const DisputesTable = ({ disputes }) => (
  <div className="overflow-x-auto bg-white rounded-lg shadow">
    <table className="min-w-full text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="p-3 text-left font-semibold text-gray-600">Invoice #</th>
          <th className="p-3 text-left font-semibold text-gray-600">Project</th>
          <th className="p-3 text-left font-semibold text-gray-600">Homeowner</th>
          <th className="p-3 text-right font-semibold text-gray-600">Amount</th>
          <th className="p-3 text-center font-semibold text-gray-600">Disputed On</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {disputes.map(invoice => (
          <tr key={invoice.id} className="hover:bg-gray-50">
            <td className="p-3 font-mono">
              <Link to={`/invoices/${invoice.id}`} className="text-blue-600 hover:underline">
                {invoice.invoice_number}
              </Link>
            </td>
            <td className="p-3">{invoice.project_title}</td>
            <td className="p-3">{invoice.homeowner_name}</td>
            <td className="p-3 text-right font-semibold">
              {parseFloat(invoice.amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}
            </td>
            <td className="p-3 text-center">
              {new Date(invoice.disputed_at || invoice.created_at).toLocaleDateString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);


export default function DisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Use useCallback to memoize the fetching function.
  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Efficiently fetch ONLY disputed invoices from the backend.
      const { data } = await api.get('/invoices/', {
        params: { status: 'disputed' }
      });
      setDisputes(data);
    } catch (err) {
      const errorMsg = 'Failed to load disputed invoices.';
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Fetch disputes error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const renderContent = () => {
    if (loading) {
      return <p className="text-center text-gray-500 py-10">Loading disputes...</p>;
    }
    if (error) {
      return <p className="text-center text-red-500 py-10">{error}</p>;
    }
    if (disputes.length === 0) {
      return <p className="text-center text-gray-500 py-10">🎉 No disputed invoices found.</p>;
    }
    return <DisputesTable disputes={disputes} />;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Dispute Center</h1>
        <button
            onClick={fetchDisputes}
            disabled={loading}
            className="text-blue-600 text-sm hover:underline disabled:text-gray-400"
        >
            Refresh
        </button>
      </div>
      <p className="text-gray-600 mb-6">Review and manage all invoices that have been marked as "disputed" by homeowners.</p>
      
      {renderContent()}
    </div>
  );
}