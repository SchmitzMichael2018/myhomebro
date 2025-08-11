// src/components/InvoiceList.jsx

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';
import { HiOutlineDownload } from 'react-icons/hi';

const InvoiceRow = ({ invoice, statusStyles }) => {
  const amount = parseFloat(invoice.amount || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

  const status = invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1);

  const handlePDFDownload = async (e) => {
    e.stopPropagation(); // prevent row navigation
    try {
      const response = await api.get(`/invoices/${invoice.id}/pdf/`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `invoice_${invoice.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      toast.error("Failed to download invoice PDF.");
    }
  };

  return (
    <div className="bg-white shadow-sm rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition-colors">
      <Link
        to={`/invoices/${invoice.id}`}
        aria-label={`Invoice ${invoice.invoice_number} for ${invoice.homeowner_name}`}
        className="flex-1"
      >
        <div>
          <div className="font-semibold text-gray-800">{invoice.invoice_number}</div>
          <div className="text-sm text-gray-600">For Homeowner: {invoice.homeowner_name}</div>
        </div>
      </Link>
      <div className="text-right flex items-center space-x-3">
        <div className="font-semibold text-lg text-gray-900">{amount}</div>
        <span className={`px-3 py-1 text-xs font-medium rounded-full ${statusStyles[invoice.status] || "bg-gray-200 text-gray-800"}`}>
          {status}
        </span>
        <button
          onClick={handlePDFDownload}
          title="Download PDF"
          className="text-blue-600 hover:text-blue-800"
        >
          <HiOutlineDownload size={18} />
        </button>
      </div>
    </div>
  );
};

export default function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [openGroups, setOpenGroups] = useState({});

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/invoices/");
      setInvoices(data);
      const initialOpenState = data.reduce((acc, inv) => {
        acc[inv.agreement] = true;
        return acc;
      }, {});
      setOpenGroups(initialOpenState);
    } catch (err) {
      setError("Failed to load invoices.");
      toast.error("Could not load invoices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const filteredInvoices = useMemo(() => {
    if (!searchTerm) return invoices;
    const term = searchTerm.trim().toLowerCase();
    return invoices.filter(inv =>
      (inv.project_title || "").toLowerCase().includes(term) ||
      (inv.homeowner_name || "").toLowerCase().includes(term) ||
      (inv.invoice_number || "").toLowerCase().includes(term)
    );
  }, [invoices, searchTerm]);

  const groupedInvoices = useMemo(() => {
    return filteredInvoices.reduce((acc, inv) => {
      const key = inv.agreement;
      if (!acc[key]) {
        acc[key] = { agreementId: key, projectTitle: inv.project_title, items: [] };
      }
      acc[key].items.push(inv);
      return acc;
    }, {});
  }, [filteredInvoices]);

  const statusStyles = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-blue-100 text-blue-800",
    disputed: "bg-red-100 text-red-800",
    paid: "bg-green-100 text-green-800",
    incomplete: "bg-gray-100 text-gray-800",
  };

  const toggleGroup = (agreementId) => {
    setOpenGroups(prev => ({ ...prev, [agreementId]: !prev[agreementId] }));
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Loading invoices...</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Invoices</h1>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by project, customer, or invoice #"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="border px-4 py-2 rounded-lg shadow-sm focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={fetchInvoices}
            className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="text-red-500 mb-4 text-center">{error}</p>}
      {Object.keys(groupedInvoices).length === 0 && !error && (
        <p className="text-gray-500 text-center py-10">No invoices found.</p>
      )}

      <div className="space-y-6">
        {Object.values(groupedInvoices).map(group => (
          <div key={group.agreementId} className="bg-gray-50 rounded-lg p-4">
            <button
              onClick={() => toggleGroup(group.agreementId)}
              className="w-full flex justify-between items-center text-left text-xl font-semibold mb-2"
            >
              <span>{group.projectTitle}</span>
              {openGroups[group.agreementId] ? <FaChevronUp /> : <FaChevronDown />}
            </button>
            {openGroups[group.agreementId] && (
              <div className="space-y-3 pl-2 border-l-2 border-blue-200 ml-1">
                {group.items.map(invoice => (
                  <InvoiceRow key={invoice.id} invoice={invoice} statusStyles={statusStyles} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
