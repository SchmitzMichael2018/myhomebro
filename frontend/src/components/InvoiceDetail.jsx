import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";

// Utilities
const money = (amount) =>
  Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const isPendingish = (status) => {
  const s = String(status || "").toLowerCase();
  return s === "pending" || s === "pending_approval";
};

const statusStyles = {
  pending: "bg-yellow-100 text-yellow-800",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  disputed: "bg-red-100 text-red-800",
  paid: "bg-green-100 text-green-800",
  incomplete: "bg-gray-100 text-gray-800",
};

// Inline modal for creating a dispute (reason + description)
function DisputeModal({ isOpen, onClose, onSubmit, submitting }) {
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (isOpen) {
      setReason("");
      setDescription("");
    }
  }, [isOpen]);

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Create Dispute</h3>
          <button
            className="rounded bg-gray-800 px-3 py-1 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
            onClick={onClose}
            disabled={submitting}
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold">Reason</label>
            <select
              className="w-full rounded border px-3 py-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
            >
              <option value="">Select a reason…</option>
              <option value="quality_issue">Quality issue</option>
              <option value="scope_disagreement">Scope disagreement</option>
              <option value="delay">Delay / missed deadline</option>
              <option value="billing_error">Billing error</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold">Description</label>
            <textarea
              className="min-h-[120px] w-full rounded border px-3 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the issue, proposed resolution, and any details…"
              disabled={submitting}
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <button
              className="rounded border bg-white px-4 py-2 hover:bg-gray-50"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              className="rounded bg-red-600 px-5 py-2 text-white hover:bg-red-700 disabled:opacity-50"
              onClick={() => onSubmit({ reason, description })}
              disabled={submitting || !reason}
            >
              {submitting ? "Submitting…" : "Submit Dispute"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isDisputeOpen, setIsDisputeOpen] = useState(false);

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/invoices/${id}/`);
      setInvoice(data);
    } catch (error) {
      toast.error("Could not load invoice details.");
      navigate("/invoices");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleApprove = async () => {
    setActionLoading(true);
    try {
      const { data } = await api.patch(`/invoices/${id}/approve/`);
      toast.success("Invoice approved!");
      setInvoice(data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to approve invoice.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateDispute = async ({ reason, description }) => {
    setActionLoading(true);
    try {
      // Send reason + description in the dispute action body
      const { data } = await api.patch(`/invoices/${id}/dispute/`, { reason, description });
      toast.success("Invoice disputed!");
      setInvoice(data);
      setIsDisputeOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to dispute invoice.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      const response = await api.get(`/invoices/${id}/pdf/`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `invoice_${invoice.invoice_number || id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      toast.error("Failed to download PDF.");
    }
  };

  if (loading) return <div className="p-6 text-center text-gray-500">Loading invoice details...</div>;
  if (!invoice) return <div className="p-6 text-center text-red-500">Invoice not found.</div>;

  const isHomeowner = user?.id === invoice.agreement?.project?.homeowner?.id;
  const status = String(invoice.status || "").toLowerCase();

  return (
    <div className="p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-lg space-y-6">
      <div>
        <button onClick={() => navigate("/invoices")} className="text-sm text-blue-600 hover:underline">
          ← Back to All Invoices
        </button>
        <h1 className="mt-2 text-3xl font-bold text-gray-800">
          Invoice #{invoice.invoice_number || id}
        </h1>
        <p className="text-gray-500">
          For project:{" "}
          <Link
            to={`/projects/${invoice.agreement?.project?.id}`}
            className="text-blue-600 hover:underline"
          >
            {invoice.project_title}
          </Link>{" "}
          {" | "}
          <Link
            to={`/agreements/${invoice.agreement?.id}`}
            className="text-blue-600 hover:underline"
          >
            View Agreement
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 border-t pt-6 md:grid-cols-2">
        <div>
          <h3 className="font-semibold text-gray-600">Customer</h3>
          <p>{invoice.homeowner_name || "-"}</p>
        </div>
        <div className="text-right">
          <h3 className="font-semibold text-gray-600">Status</h3>
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
              statusStyles[status] || "bg-gray-100 text-gray-700"
            }`}
          >
            {status.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
          </span>
        </div>
        <div>
          <h3 className="font-semibold text-gray-600">Amount</h3>
          <p className="text-xl font-bold">{money(invoice.amount_due ?? invoice.amount)}</p>
        </div>
        <div className="text-right">
          <h3 className="font-semibold text-gray-600">Date Issued</h3>
          <p>{invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : "-"}</p>
        </div>
        <div className="md:col-span-2">
          <h3 className="font-semibold text-gray-600">Notes</h3>
          <p className="whitespace-pre-wrap">{invoice.description || invoice.notes || "-"}</p>
        </div>
      </div>

      <div className="flex items-center space-x-3 border-t pt-6">
        <button
          onClick={handleDownloadPDF}
          className="rounded-lg bg-gray-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-gray-700"
        >
          Download PDF
        </button>

        {isHomeowner && isPendingish(status) && (
          <>
            <button
              onClick={handleApprove}
              disabled={actionLoading}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-emerald-700 disabled:bg-gray-400"
            >
              {actionLoading ? "Processing…" : "Approve Payment"}
            </button>
            <button
              onClick={() => setIsDisputeOpen(true)}
              disabled={actionLoading}
              className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-red-700 disabled:bg-gray-400"
            >
              {actionLoading ? "Processing…" : "Dispute Invoice"}
            </button>
          </>
        )}
      </div>

      {/* Dispute modal */}
      <DisputeModal
        isOpen={isDisputeOpen}
        onClose={() => setIsDisputeOpen(false)}
        submitting={actionLoading}
        onSubmit={handleCreateDispute}
      />
    </div>
  );
}
