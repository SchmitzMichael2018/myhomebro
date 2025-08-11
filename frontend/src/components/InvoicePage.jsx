// src/pages/InvoicePage.jsx

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import toast from 'react-hot-toast';
import api from "../api";
import InvoiceModal from "../components/InvoiceModal"; // Assuming this is the detailed modal view

export default function InvoicePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchPublicInvoice = useCallback(async (invoiceId, token) => {
    setLoading(true);
    setError('');
    try {
      // Correctly call the public "magic link" endpoint, passing the token as a query parameter.
      const { data } = await api.get(`/invoices/magic/${invoiceId}/`, {
        params: { token }
      });
      setInvoice(data);
    } catch (err) {
      const errorMsg = err.response?.data?.detail || "Could not load invoice. The link may be invalid or expired.";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = searchParams.get("token");
    if (id && token) {
      fetchPublicInvoice(id, token);
    } else {
      setError("Invalid URL. Invoice ID and access token are required.");
    }
  }, [id, searchParams, fetchPublicInvoice]);

  // Handler to refresh data after an action in the modal
  const handleDataChanged = () => {
    const token = searchParams.get("token");
    if (id && token) {
      fetchPublicInvoice(id, token);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading Invoice...</div>;
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-500">
        <h2 className="text-xl font-bold mb-4">Access Denied</h2>
        <p>{error}</p>
        <button onClick={() => navigate('/')} className="mt-6 bg-blue-600 text-white px-4 py-2 rounded-lg">
          Return Home
        </button>
      </div>
    );
  }

  if (!invoice) {
    // This case will likely be covered by the error state, but it's a good fallback.
    return null;
  }

  return (
    // This page's entire purpose is to show the modal for a single invoice.
    <InvoiceModal
      visible={true}
      onClose={() => navigate("/")} // Go to the homepage when the modal is closed
      invoices={[invoice]}
      category={invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
      isContractor={false} // This is a homeowner-facing view
      onDataChanged={handleDataChanged} // Pass the refresh handler to the modal
    />
  );
}