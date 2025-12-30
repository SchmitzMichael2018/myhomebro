// src/pages/MagicInvoice.jsx
// v2025-12-30c — Escrow-aware magic invoice (based on your current 400+ line file)
//
// IMPORTANT:
// - If invoice GET includes escrow_funded=true or agreement_status="funded",
//   we hide Stripe card entry and show "Approve & Release Escrow".
// - If escrow is NOT funded, we keep your existing card flow.
//
// Backend expectations:
// - GET /api/projects/invoices/magic/<token>/ returns:
//     escrow_funded, agreement_status (added server-side)
// - PATCH approve returns:
//     mode:"escrow_release" OR stripe_client_secret for card pay

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

// ✅ Stripe
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

const money = (amount) =>
  Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

const isPendingish = (status) => {
  const s = String(status || "").toLowerCase();
  return s === "pending" || s === "pending_approval";
};

const statusPill = (status) => {
  const s = String(status || "").toLowerCase();
  if (s.includes("paid") || s.includes("released")) return "bg-green-100 text-green-800";
  if (s.includes("approved")) return "bg-blue-100 text-blue-800";
  if (s.includes("dispute")) return "bg-red-100 text-red-800";
  if (s.includes("pending")) return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-800";
};

function fmt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

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
    <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
      <h3 className="mb-3 text-base font-extrabold text-red-800">Dispute Details</h3>

      <div className="mb-3">
        <label className="mb-1 block text-sm font-semibold text-red-900">Reason</label>
        <select
          className="w-full rounded border border-red-200 bg-white px-3 py-2"
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
        <label className="mb-1 block text-sm font-semibold text-red-900">Description</label>
        <textarea
          className="min-h-[110px] w-full rounded border border-red-200 bg-white px-3 py-2"
          placeholder="Describe the issue, what you expected, and what you want done to resolve it…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          className="rounded-lg border border-red-200 bg-white px-4 py-2 font-bold text-red-800 hover:bg-red-100 disabled:opacity-60"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          className="rounded-lg bg-red-600 px-5 py-2 font-extrabold text-white hover:bg-red-700 disabled:opacity-60"
          onClick={() => onSubmit({ reason, description })}
          disabled={submitting || !reason}
        >
          {submitting ? "Submitting…" : "Submit Dispute"}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ✅ NEW: Escrow Release Panel
   ───────────────────────────────────────────── */
function EscrowReleasePanel({ token, invoice, actionLoading, setActionLoading, onReleased }) {
  const approveRelease = async () => {
    if (!window.confirm("Approve and release escrow funds for this invoice?")) return;

    setActionLoading(true);
    try {
      const { data } = await api.patch(`/projects/invoices/magic/${encodeURIComponent(token)}/approve/`, {});

      // Expect escrow mode
      if (data?.mode && String(data.mode).toLowerCase() === "escrow_release") {
        toast.success("Approved. Escrow funds released.");
        await onReleased?.();
        return;
      }

      // If backend returns client secret, that's a misconfiguration for funded escrow
      if (data?.stripe_client_secret) {
        toast.error("This invoice started a card payment flow, but escrow is already funded.");
        await onReleased?.();
        return;
      }

      toast.success("Approved.");
      await onReleased?.();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to release escrow.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <div className="text-sm font-extrabold text-emerald-900">Escrow</div>
      <div className="mt-2 text-sm text-emerald-800">
        This project is already funded. Approving this invoice will release escrow funds to your contractor.
      </div>

      <button
        onClick={approveRelease}
        disabled={actionLoading}
        className={`mt-4 w-full rounded-xl px-5 py-3 font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60 ${
          actionLoading ? "bg-emerald-700" : "bg-emerald-600"
        }`}
      >
        {actionLoading ? "Processing…" : "Approve & Release Escrow"}
      </button>

      <div className="mt-2 text-xs text-emerald-900/70">
        No card payment is required because escrow is already funded.
      </div>
      <div className="mt-1 text-xs text-emerald-900/60">
        A confirmation will be emailed to {invoice?.homeowner_email || "you"}.
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Stripe Payment Panel (keeps your UI intact)
   ───────────────────────────────────────────── */
function StripePaymentPanel({ token, invoice, actionLoading, setActionLoading, onPaid }) {
  const stripe = useStripe();
  const elements = useElements();

  const handleApproveAndPay = async () => {
    if (!stripe || !elements) {
      toast.error("Stripe is still loading. Please try again.");
      return;
    }

    if (!window.confirm("Approve and pay this invoice?")) return;

    setActionLoading(true);

    try {
      const { data } = await api.patch(`/projects/invoices/magic/${encodeURIComponent(token)}/approve/`, {});

      // If backend decided this is escrow release, stop and refresh
      if (data?.mode && String(data.mode).toLowerCase() === "escrow_release") {
        toast.success("Approved. Escrow funds released.");
        await onPaid?.();
        return;
      }

      const clientSecret = data?.stripe_client_secret;
      if (!clientSecret) throw new Error("Payment could not be started (missing Stripe client secret).");

      const card = elements.getElement(CardElement);
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card,
          billing_details: {
            name: invoice?.homeowner_name || "",
            email: invoice?.homeowner_email || "",
          },
        },
      });

      if (result.error) throw new Error(result.error.message || "Payment failed.");

      if (result.paymentIntent?.status === "succeeded") {
        toast.success("Payment successful. Your receipt will be emailed to you.");
        await onPaid();
      } else {
        toast.success("Payment processing. Please refresh in a moment.");
        await onPaid();
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || "Failed to approve and pay the invoice.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-sm font-extrabold text-slate-800">Payment</div>
      <div className="mt-2 text-sm text-slate-600">Enter your card details to pay this invoice.</div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <CardElement options={{ hidePostalCode: true }} />
      </div>

      <button
        onClick={handleApproveAndPay}
        disabled={actionLoading || !stripe}
        className={`mt-4 w-full rounded-xl px-5 py-3 font-extrabold text-white hover:bg-emerald-700 disabled:opacity-60 ${
          actionLoading ? "bg-emerald-700" : "bg-emerald-600"
        }`}
      >
        {actionLoading ? "Processing…" : "Approve & Pay"}
      </button>

      <div className="mt-2 text-xs text-slate-500">
        After payment completes, a receipt will be emailed to {invoice?.homeowner_email || "you"}.
      </div>
    </div>
  );
}

function InnerMagicInvoice() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const action = (searchParams.get("action") || "").toLowerCase();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDispute, setShowDispute] = useState(false);

  const fetchInvoice = useCallback(async () => {
    if (!token) {
      setError("Missing invoice token. This link is invalid.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");

    try {
      const { data } = await api.get(`/projects/invoices/magic/${encodeURIComponent(token)}/`);
      setInvoice(data);
    } catch (err) {
      const msg =
        err.response?.data?.detail ||
        "Unable to load invoice. The link may be invalid or expired.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  useEffect(() => {
    if (action === "dispute") setShowDispute(true);
  }, [action]);

  const handleDispute = async ({ reason, description }) => {
    setActionLoading(true);

    try {
      const { data } = await api.patch(`/projects/invoices/magic/${encodeURIComponent(token)}/dispute/`, {
        reason,
        description,
      });
      setInvoice(data);
      toast.success("Dispute submitted.");
      setShowDispute(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to submit dispute.");
    } finally {
      setActionLoading(false);
    }
  };

  const downloadPDF = async () => {
    if (!token) return;
    const url = `/api/projects/invoices/magic/${encodeURIComponent(token)}/pdf/`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const status = String(invoice?.status || "").toLowerCase();
  const amount = money(invoice?.amount_due ?? invoice?.amount ?? 0);

  const milestoneId = invoice?.milestone_id ?? invoice?.milestone_id_snapshot ?? null;
  const milestoneTitle = invoice?.milestone_title || invoice?.milestone_title_snapshot || "—";
  const milestoneDescription = invoice?.milestone_description || invoice?.milestone_description_snapshot || "—";
  const completionNotes = (invoice?.milestone_completion_notes || "").trim() || "—";

  const attachments = useMemo(() => {
    const arr = invoice?.milestone_attachments || invoice?.milestone_attachments_snapshot;
    return Array.isArray(arr) ? arr : [];
  }, [invoice]);

  // ✅ escrow-funded detection from public payload
  const agreementStatus = String(invoice?.agreement_status || invoice?.agreement_state || "").toLowerCase();
  const escrowFundedFlag = invoice?.escrow_funded === true || invoice?.escrow_funded === 1 || agreementStatus === "funded";

  if (loading) return <div className="p-8 text-center text-gray-600">Loading Invoice…</div>;

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        <h2 className="mb-3 text-xl font-extrabold">Access Denied</h2>
        <p>{error}</p>
        <button
          onClick={() => navigate("/")}
          className="mt-6 rounded-lg bg-blue-600 px-4 py-2 font-extrabold text-white"
        >
          Return Home
        </button>
      </div>
    );
  }

  if (!invoice) return null;

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-6 shadow-lg md:p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-bold text-slate-500">Invoice</div>
            <h1 className="text-3xl font-extrabold text-slate-900">#{invoice.invoice_number || invoice.id}</h1>
            <div className="mt-1 text-sm text-slate-600">
              Project: <b>{invoice.project_title || "—"}</b>
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Homeowner: <b>{invoice.homeowner_name || "—"}</b>
            </div>
          </div>

          <div className="md:text-right">
            <div className="text-sm font-bold text-slate-500">Amount</div>
            <div className="text-3xl font-extrabold text-slate-900">{amount}</div>
            <div className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-extrabold ${statusPill(status)}`}>
              {String(invoice.status || "").replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Issued: {invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : "—"}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-extrabold text-slate-800">Milestone</div>
          <div className="mt-1 text-base font-extrabold text-slate-900">
            {milestoneId ? `#${milestoneId} — ` : ""}
            {milestoneTitle}
          </div>
          <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{milestoneDescription}</div>
        </div>

        <div className="mt-6">
          <div className="text-sm font-extrabold text-slate-800">Completion Notes</div>
          <div className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            {completionNotes}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-sm font-extrabold text-slate-800">Attachments</div>
          {attachments.length === 0 ? (
            <div className="mt-2 text-sm text-slate-600">—</div>
          ) : (
            <div className="mt-2 space-y-2">
              {attachments.map((a, idx) => {
                const name = a?.name || a?.filename || `Attachment ${idx + 1}`;
                const url = a?.url || "";
                return (
                  <div
                    key={`${a?.id || idx}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{name}</div>
                      {a?.uploaded_at ? <div className="text-xs text-slate-500">Uploaded: {fmt(a.uploaded_at)}</div> : null}
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
                      >
                        Open
                      </a>
                    ) : (
                      <div className="text-xs text-slate-400">No URL</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <button onClick={downloadPDF} className="rounded-xl bg-slate-800 px-5 py-2 font-extrabold text-white hover:bg-slate-900">
            View / Download PDF
          </button>

          {isPendingish(status) && (
            <button
              onClick={() => setShowDispute((v) => !v)}
              disabled={actionLoading}
              className={`rounded-xl px-5 py-2 font-extrabold text-white hover:bg-red-700 disabled:opacity-60 ${
                action === "dispute" ? "bg-red-700" : "bg-red-600"
              }`}
            >
              {showDispute ? "Cancel Dispute" : "Dispute"}
            </button>
          )}
        </div>

        {/* ✅ escrow funded = release panel; not funded = Stripe panel */}
        {isPendingish(status) ? (
          escrowFundedFlag ? (
            <EscrowReleasePanel
              token={token}
              invoice={invoice}
              actionLoading={actionLoading}
              setActionLoading={setActionLoading}
              onReleased={fetchInvoice}
            />
          ) : stripePromise ? (
            <StripePaymentPanel
              token={token}
              invoice={invoice}
              actionLoading={actionLoading}
              setActionLoading={setActionLoading}
              onPaid={fetchInvoice}
            />
          ) : (
            <div className="mt-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-900">
              Stripe is not configured (missing <b>VITE_STRIPE_PUBLISHABLE_KEY</b>). Payment cannot be processed.
            </div>
          )
        ) : null}

        <DisputeForm
          open={showDispute && isPendingish(status)}
          submitting={actionLoading}
          onCancel={() => setShowDispute(false)}
          onSubmit={handleDispute}
        />

        {!isPendingish(status) && (
          <div className="mt-8 rounded-xl bg-blue-50 p-4 text-center text-blue-900">
            This invoice has already been processed. No further actions are required.
          </div>
        )}

        <div className="mt-6 text-xs text-slate-500">
          If you have questions, reply to the invoice email or contact your contractor.
        </div>
      </div>
    </div>
  );
}

export default function MagicInvoice() {
  if (!stripePromise) return <InnerMagicInvoice />;
  return (
    <Elements stripe={stripePromise}>
      <InnerMagicInvoice />
    </Elements>
  );
}
