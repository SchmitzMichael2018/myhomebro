// src/pages/InvoiceList.jsx

import React, { useState, useEffect, useMemo } from "react";
import api from "../api";

export default function InvoiceList() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadingId, setLoadingId] = useState(null);

  const fetchInvoices = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/projects/invoices/");
      setInvoices(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load invoices. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, []);

  const filteredInvoices = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (statusFilter === "all") return true;
        return inv.status === statusFilter;
      })
      .filter((inv) => {
        if (!searchTerm) return true;
        const proj = inv.project_title?.toLowerCase() || "";
        const home = inv.homeowner_name?.toLowerCase() || "";
        return (
          proj.includes(searchTerm.toLowerCase()) ||
          home.includes(searchTerm.toLowerCase())
        );
      });
  }, [invoices, searchTerm, statusFilter]);

  const summary = useMemo(() => {
    const total = invoices.length;
    const pending = invoices.filter((inv) => inv.status === "pending").length;
    const approved = invoices.filter((inv) => inv.status === "approved").length;
    const disputed = invoices.filter((inv) => inv.status === "disputed").length;
    const paid = invoices.filter((inv) => inv.status === "paid").length;
    return { total, pending, approved, disputed, paid };
  }, [invoices]);

  const handleAction = async (id, action) => {
    setLoadingId(id);
    setError("");
    try {
      const { data: updated } = await api.patch(`/projects/invoices/${id}/${action}/`);
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === updated.id ? updated : inv))
      );
    } catch (err) {
      console.error(err);
      setError(`Failed to ${action} invoice.`);
    } finally {
      setLoadingId(null);
    }
  };

  const statusStyles = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-blue-100 text-blue-800",
    disputed: "bg-red-100 text-red-800",
    paid: "bg-green-100 text-green-800",
  };

  return (
    <div className="p-6">
      <div className="flex flex-wrap justify-between items-center mb-4 gap-4">
        <div>
          <h2 className="text-2xl font-bold">Invoices</h2>
          <p className="text-sm text-gray-500">
            Total: {summary.total}, Pending: {summary.pending}, Approved: {summary.approved}, Disputed: {summary.disputed}, Paid: {summary.paid}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            placeholder="Search by project or homeowner..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border px-4 py-2 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border px-3 py-2 rounded shadow-sm"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="disputed">Disputed</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <p className="text-blue-500">Loading invoices...</p>
        </div>
      ) : error ? (
        <p className="text-red-500 mb-4">{error}</p>
      ) : filteredInvoices.length === 0 ? (
        <p className="text-gray-500">No invoices found.</p>
      ) : (
        filteredInvoices.map((inv) => {
          const amount = inv.amount_due ?? inv.amount;
          const statusLabel = inv.status.charAt(0).toUpperCase() + inv.status.slice(1);
          return (
            <div key={inv.id} className="bg-white shadow rounded p-4 mb-4 space-y-2">
              <div className="font-semibold">Project: {inv.project_title || "-"}</div>
              <div>Homeowner: {inv.homeowner_name || "-"}</div>
              <div>
                Amount Due: {parseFloat(amount || 0).toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                })}
              </div>
              <div>
                Status: <span className={`px-2 py-1 rounded ${statusStyles[inv.status] || "bg-gray-200"}`}>{statusLabel}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {inv.status === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleAction(inv.id, "approve")}
                      disabled={loadingId === inv.id}
                      className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
                    >
                      {loadingId === inv.id ? "..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAction(inv.id, "dispute")}
                      disabled={loadingId === inv.id}
                      className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600"
                    >
                      {loadingId === inv.id ? "..." : "Dispute"}
                    </button>
                  </>
                )}

                {inv.status === "approved" && (
                  <button
                    type="button"
                    onClick={() => handleAction(inv.id, "mark_paid")}
                    disabled={loadingId === inv.id}
                    className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                  >
                    {loadingId === inv.id ? "..." : "Mark Paid"}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
