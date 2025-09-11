import React, { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

const money = (amount) =>
  Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const isPendingish = (status) => {
  const s = String(status || "").toLowerCase();
  return s === "pending" || s === "pending_approval";
};

function DisputeForm({ open, submitting, onCancel, onSubmit }) {
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setReason("");
      setDescription("");
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="mt-6 rounded-xl border p-4">
      <h3 className="mb-3 text-base font-semibold text-gray-800">Dispute Details</h3>
      <div className="mb-3">
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
      <div className="mb-4">
        <label className="mb-1 block text-sm font-semibold">Description</label>
        <textarea
          className="min-h-[120px] w-full rounded border px-3 py-2"
          placeholder="Describe the issue, proposed resolution, and any details…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
        />
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          className="rounded border bg-white px-4 py-2 hover:bg-gray-50"
          onClick={onCancel}
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
  );
}

export default function MagicInvoice() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDispute, setShowDispute] = useState(false);

  const fetchInvoice = useCallback(async () => {
    if (!token) {
      setError("Missing access token. This link is invalid.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/invoices/magic/${id}/`, { params: { token } });
      setInvoice(data);
    } catch (err) {
      const msg = err.response?.data?.detail || "Unable to load invoice. The link may be invalid or expired.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleApprove = async () => {
    if (!window.confirm("Approve this invoice?")) return;
    setActionLoading(true);
    try {
      const { data } = await api.patch(`/invoices/magic/${id}/approve/`, {}, { params: { token } });
      setInvoice(data);
      toast.success("Invoice approved.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to approve the invoice.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDispute = async ({ reason, description }) => {
    setActionLoading(true);
    try {
      const { data } = await api.patch(
        `/invoices/magic/${id}/dispute/`,
        { reason, description },
        { params: { token } }
      );
      setInvoice(data);
      toast.success("Dispute submitted.");
      setShowDispute(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to submit dispute.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-600">Loading Invoice...</div>;

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        <h2 className="mb-4 text-xl font-bold">Access Denied</h2>
        <p>{error}</p>
        <button onClick={() => navigate("/")} className="mt-6 rounded-lg bg-blue-600 px-4 py-2 text-white">
          Return Home
        </button>
      </div>
    );
  }

  if (!invoice) return null;

  const status = String(invoice.status || "").toLowerCase();

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mx-auto w-full max-w-2xl rounded-xl bg-white p-8 shadow-lg">
        <h1 className="text-3xl font-bold text-gray-800">
          Invoice #{invoice.invoice_number || id}
        </h1>
        <p className="mb-6 text-gray-500">For project: {invoice.project_title || "-"}</p>

        <div className="grid grid-cols-2 gap-6 rounded-lg border p-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-600">Amount Due</h3>
            <p className="text-2xl font-bold text-gray-900">
              {money(invoice.amount_due ?? invoice.amount)}
            </p>
          </div>
          <div className="text-right">
            <h3 className="text-sm font-semibold text-gray-600">Status</h3>
            <p className="font-bold capitalize">{status.replace("_", " ")}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-600">Customer</h3>
            <p>{invoice.homeowner_name || "-"}</p>
          </div>
          <div className="text-right">
            <h3 className="text-sm font-semibold text-gray-600">Date Issued</h3>
            <p>{invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : "-"}</p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          {/* Use the magic PDF endpoint with token */}
          <a
            href={`/api/invoices/magic/${invoice.id}/pdf/?token=${encodeURIComponent(token || "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-gray-600 px-5 py-2 font-semibold text-white transition-colors hover:bg-gray-700"
          >
            Download PDF
          </a>

          {isPendingish(status) && (
            <>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                className="rounded-lg bg-green-600 px-5 py-2 font-semibold text-white transition-colors hover:bg-green-700 disabled:bg-gray-400"
              >
                {actionLoading ? "Processing..." : "Approve Invoice"}
              </button>
              <button
                onClick={() => setShowDispute((v) => !v)}
                disabled={actionLoading}
                className="rounded-lg bg-red-600 px-5 py-2 font-semibold text-white transition-colors hover:bg-red-700 disabled:bg-gray-400"
              >
                {showDispute ? "Cancel Dispute" : "Dispute Invoice"}
              </button>
            </>
          )}
        </div>

        {/* Inline dispute form for magic links */}
        <DisputeForm
          open={showDispute}
          submitting={actionLoading}
          onCancel={() => setShowDispute(false)}
          onSubmit={handleDispute}
        />

        {!isPendingish(status) && (
          <div className="mt-8 rounded-lg bg-blue-50 p-4 text-center text-blue-800">
            This invoice has already been processed. No further actions are required.
          </div>
        )}
      </div>
    </div>
  );
}
