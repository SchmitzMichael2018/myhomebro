// src/pages/InvoiceDetail.jsx

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

const formatCurrency = (amount) => {
  return parseFloat(amount || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
};

const statusStyles = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  disputed: 'bg-red-100 text-red-800',
  paid: 'bg-green-100 text-green-800',
  incomplete: 'bg-gray-100 text-gray-800',
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/invoices/${id}/`);
      setInvoice(data);
    } catch (error) {
      toast.error('Could not load invoice details.');
      navigate('/invoices');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleAction = async (actionType) => {
    if (!['approve', 'dispute'].includes(actionType)) return;
    setActionLoading(true);
    try {
      const response = await api.patch(`/invoices/${id}/${actionType}/`);
      toast.success(`Invoice successfully ${actionType}d!`);
      setInvoice(response.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || `Failed to ${actionType} invoice.`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const response = await api.get(`/invoices/${id}/pdf/`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `invoice_${invoice.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      toast.error("Failed to download PDF.");
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading invoice details...</div>;
  }
  if (!invoice) {
    return <div className="p-6 text-center text-red-500">Invoice not found.</div>;
  }

  const isHomeowner = user?.id === invoice.agreement?.project?.homeowner?.id;

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-lg space-y-6">
      <div>
        <button onClick={() => navigate("/invoices")} className="text-sm text-blue-600 hover:underline">
          ← Back to All Invoices
        </button>
        <h1 className="text-3xl font-bold text-gray-800 mt-2">
          Invoice #{invoice.invoice_number}
        </h1>
        <p className="text-gray-500">
          For project:{' '}
          <Link to={`/projects/${invoice.agreement?.project?.id}`} className="text-blue-600 hover:underline">
            {invoice.project_title}
          </Link>{' | '}
          <Link to={`/agreements/${invoice.agreement?.id}`} className="text-blue-600 hover:underline">
            View Agreement
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t pt-6">
        <div>
          <h3 className="font-semibold text-gray-600">Customer</h3>
          <p>{invoice.homeowner_name}</p>
        </div>
        <div className="text-right">
          <h3 className="font-semibold text-gray-600">Status</h3>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${statusStyles[invoice.status] || 'bg-gray-100 text-gray-700'}`}>
            {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
          </span>
        </div>
        <div>
          <h3 className="font-semibold text-gray-600">Amount</h3>
          <p className="text-xl font-bold">{formatCurrency(invoice.amount)}</p>
        </div>
        <div className="text-right">
          <h3 className="font-semibold text-gray-600">Date Issued</h3>
          <p>{new Date(invoice.created_at).toLocaleDateString()}</p>
        </div>
      </div>

      <div className="border-t pt-6 flex items-center space-x-3">
        <button
          onClick={handleDownloadPDF}
          className="px-4 py-2 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors"
        >
          Download PDF
        </button>

        {isHomeowner && invoice.status === 'pending' && (
          <>
            <button
              onClick={() => handleAction('approve')}
              disabled={actionLoading}
              className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
            >
              {actionLoading ? 'Processing...' : 'Approve Payment'}
            </button>
            <button
              onClick={() => handleAction('dispute')}
              disabled={actionLoading}
              className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:bg-gray-400 transition-colors"
            >
              {actionLoading ? 'Processing...' : 'Dispute Invoice'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
