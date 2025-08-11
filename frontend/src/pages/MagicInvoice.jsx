// src/pages/MagicInvoice.jsx

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import toast from 'react-hot-toast';
import api from "../api";

// A helper to format currency
const formatCurrency = (amount) => {
  return parseFloat(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
};

export default function MagicInvoice() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchInvoice = useCallback(async () => {
    if (!token) {
      setError("Missing access token. This link is invalid.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // Corrected: Use the public "magic" endpoint and pass the token as a param.
      const { data } = await api.get(`/invoices/magic/${id}/`, { params: { token } });
      setInvoice(data);
    } catch (err) {
      const errorMsg = err.response?.data?.detail || "Unable to load invoice. The link may be invalid or expired.";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleAction = async (actionType) => {
    // A consolidated handler for both approve and dispute actions.
    if (!window.confirm(`Are you sure you want to ${actionType} this invoice?`)) return;
    
    setActionLoading(true);
    try {
      // Corrected: Use the public "magic" action endpoints with the token.
      const response = await api.patch(`/invoices/magic/${id}/${actionType}/`, {}, { params: { token } });
      setInvoice(response.data); // Update state with the returned object
      toast.success(`Invoice successfully ${actionType}d.`);
    } catch (err) {
      toast.error(err.response?.data?.detail || `Failed to ${actionType} the invoice.`);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading Invoice...</div>;
  }
  
  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        <h2 className="text-xl font-bold mb-4">Access Denied</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/')} className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-lg">
          Return Home
        </button>
      </div>
    );
  }
  
  if (!invoice) return null; // Should be covered by error state, but a good fallback.

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-2xl mx-auto p-8 bg-white rounded-xl shadow-lg w-full">
        <h1 className="text-3xl font-bold text-gray-800">Invoice #{invoice.invoice_number}</h1>
        <p className="text-gray-500 mb-6">For project: {invoice.project_title}</p>

        <div className="grid grid-cols-2 gap-6 p-4 border rounded-lg">
          <div>
            <h3 className="font-semibold text-gray-600 text-sm">Amount Due</h3>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(invoice.amount)}</p>
          </div>
          <div className="text-right">
            <h3 className="font-semibold text-gray-600 text-sm">Status</h3>
            <p className="font-bold capitalize">{invoice.status}</p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-600 text-sm">Customer</h3>
            <p>{invoice.homeowner_name}</p>
          </div>
          <div className="text-right">
            <h3 className="font-semibold text-gray-600 text-sm">Date Issued</h3>
            <p>{new Date(invoice.created_at).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-8 flex flex-wrap gap-4">
          {/* Note: The PDF download should also use the magic link endpoint */}
          <a
            href={`/api/invoices/${invoice.id}/pdf/?token=${token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors"
          >
            Download PDF
          </a>

          {invoice.status === 'pending' && (
            <>
              <button
                onClick={() => handleAction('approve')}
                disabled={actionLoading}
                className="px-5 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400"
              >
                {actionLoading ? "Processing..." : "Approve Invoice"}
              </button>
              <button
                onClick={() => handleAction('dispute')}
                disabled={actionLoading}
                className="px-5 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:bg-gray-400"
              >
                {actionLoading ? "Processing..." : "Dispute Invoice"}
              </button>
            </>
          )}
        </div>

        {invoice.status !== 'pending' && (
            <div className="mt-8 p-4 bg-blue-50 text-blue-800 rounded-lg text-center">
                This invoice has already been processed. No further actions are required.
            </div>
        )}
      </div>
    </div>
  );
}