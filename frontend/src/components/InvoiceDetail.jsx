import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, {
  getAgreementClosureStatus,
  closeAndArchiveAgreement,
} from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import SendInvoiceButton from "./SendInvoiceButton";

const money = (amount) =>
  Number(amount || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });

const statusStyles = {
  pending: "bg-yellow-100 text-yellow-800",
  pending_approval: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  disputed: "bg-red-100 text-red-800",
  paid: "bg-green-100 text-green-800",
  incomplete: "bg-gray-100 text-gray-800",
};

function fmt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function fileNameFromPath(name) {
  const s = String(name || "");
  if (!s) return "";
  const parts = s.split("/");
  return parts[parts.length - 1] || s;
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth(); // kept (you may use elsewhere)

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // ✅ Close-out modal state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeoutStatus, setCloseoutStatus] = useState(null);

  // ✅ Prevent repeat popup checks
  const checkedCloseoutRef = useRef(false);

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/invoices/${id}/`, {
        params: { _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      setInvoice(data);
    } catch (error) {
      toast.error("Could not load invoice details.");
      navigate("/app/invoices");
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  // ✅ FIX: use display_status if provided; fallback to status
  const rawStatus = String(invoice?.display_status || invoice?.status || "");
  const statusKey = rawStatus.toLowerCase();

  const agreementId =
    invoice?.agreement_id ??
    (typeof invoice?.agreement === "number"
      ? invoice.agreement
      : invoice?.agreement?.id ?? null) ??
    null;

  const milestoneId = invoice?.milestone_id ?? null;
  const milestoneTitle = invoice?.milestone_title ?? "Milestone";
  const milestoneDescription = invoice?.milestone_description ?? "";

  const completionNotes = (invoice?.milestone_completion_notes || "").trim();
  const attachments = Array.isArray(invoice?.milestone_attachments)
    ? invoice.milestone_attachments
    : [];

  const emailSentAt = invoice?.email_sent_at || null;
  const emailError = invoice?.last_email_error || "";

  // ✅ Auto-check close-out eligibility once invoice is PAID
  useEffect(() => {
    if (!invoice) return;
    if (!agreementId) return;
    if (checkedCloseoutRef.current) return;
    if (statusKey !== "paid") return;

    checkedCloseoutRef.current = true;

    (async () => {
      try {
        const status = await getAgreementClosureStatus(agreementId);
        setCloseoutStatus(status || null);

        // Only show modal if eligible and not already archived
        if (status?.eligible && !status?.already_archived) {
          setShowCloseModal(true);
        }
      } catch (err) {
        // silent fail; don't block invoice page
        console.warn("Close-out eligibility check failed:", err);
      }
    })();
  }, [invoice, agreementId, statusKey]);

  const handleConfirmCloseout = async () => {
    if (!agreementId) return;
    setClosing(true);
    try {
      await closeAndArchiveAgreement(agreementId);
      toast.success("Agreement closed and archived.");
      setShowCloseModal(false);
      navigate("/app/agreements");
    } catch (err) {
      console.error(err);
      toast.error("Unable to close and archive agreement.");
    } finally {
      setClosing(false);
    }
  };

  const handleDownloadInvoice = async () => {
    try {
      const response = await api.get(`/projects/invoices/${id}/pdf/`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `invoice_${invoice.invoice_number || id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error(err);
      toast.error("Failed to download invoice PDF (server error).");
    }
  };

  // Signed agreement (auth-safe): fetch as blob via api, then open in new tab
  const handleOpenSignedAgreement = async () => {
    if (!agreementId) {
      toast.error("No agreement linked to this invoice.");
      return;
    }
    setActionLoading(true);
    try {
      const response = await api.get(
        `/projects/agreements/${agreementId}/preview_pdf/?stream=1`,
        { responseType: "blob" }
      );

      const blobUrl = window.URL.createObjectURL(
        new Blob([response.data], { type: "application/pdf" })
      );

      const w = window.open(blobUrl, "_blank", "noopener,noreferrer");
      if (!w) {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `agreement_${agreementId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      console.error(err);
      toast.error("Unable to open signed agreement (auth or server error).");
    } finally {
      setActionLoading(false);
    }
  };

  const handleMilestoneDetail = () => {
    if (!milestoneId) {
      toast.error("No milestone linked to this invoice.");
      return;
    }
    navigate(`/app/milestones/${milestoneId}`);
  };

  if (loading)
    return (
      <div className="p-6 text-center text-gray-500">
        Loading invoice details...
      </div>
    );
  if (!invoice)
    return (
      <div className="p-6 text-center text-red-500">Invoice not found.</div>
    );

  return (
    <>
      {/* ✅ Agreement close-out modal */}
      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-extrabold text-gray-900">
              Agreement Complete
            </h3>

            <p className="mt-2 text-sm text-gray-700">
              All milestones have been completed and all invoices have been paid
              for this agreement.
            </p>

            <p className="mt-2 text-sm text-gray-700">
              Would you like to <b>close and archive</b> this agreement now?
            </p>

            {/* Optional debug totals if you want visibility */}
            {closeoutStatus?.totals ? (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                <div className="font-semibold text-gray-800 mb-1">
                  Close-out checklist
                </div>
                <div>
                  Milestones: {closeoutStatus.totals.milestones_completed}/
                  {closeoutStatus.totals.milestones_total} completed
                </div>
                <div>
                  Invoices: {closeoutStatus.totals.invoices_paid}/
                  {closeoutStatus.totals.invoices_total} paid
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setShowCloseModal(false)}
                disabled={closing}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                Not yet
              </button>

              <button
                onClick={handleConfirmCloseout}
                disabled={closing}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-extrabold text-white hover:bg-green-700 disabled:bg-green-400"
              >
                {closing ? "Closing…" : "Yes, close & archive"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 max-w-4xl mx-auto bg-white rounded-xl shadow-lg space-y-6">
        <div>
          <button
            onClick={() => navigate("/app/invoices")}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back to All Invoices
          </button>

          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-800">
                  Invoice #{invoice.invoice_number || id}
                </h1>

                <p className="text-gray-500 mt-1">
                  For project:{" "}
                  <span className="font-semibold text-gray-700">
                    {invoice.project_title || "—"}
                  </span>
                </p>

                <p className="text-gray-500 mt-1">
                  Milestone:{" "}
                  <span className="font-semibold text-gray-700">
                    {milestoneId ? `#${milestoneId} — ${milestoneTitle}` : "—"}
                  </span>
                </p>
              </div>

              <div className="text-right">
                <h3 className="font-semibold text-gray-600">Status</h3>
                <span
                  className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
                    statusStyles[statusKey] || "bg-gray-100 text-gray-700"
                  }`}
                >
                  {rawStatus || "—"}
                </span>
              </div>
            </div>

            {/* ✅ Button row: same send/resend logic as list via shared component */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleMilestoneDetail}
                disabled={!milestoneId}
                className={`rounded-lg px-4 py-2 font-semibold text-sm transition-colors ${
                  milestoneId
                    ? "bg-slate-100 text-slate-800 hover:bg-slate-200"
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                }`}
              >
                Milestone Detail
              </button>

              <button
                type="button"
                onClick={handleOpenSignedAgreement}
                disabled={!agreementId || actionLoading}
                className={`rounded-lg px-4 py-2 font-semibold text-sm transition-colors ${
                  agreementId
                    ? "bg-slate-100 text-slate-800 hover:bg-slate-200"
                    : "bg-slate-100 text-slate-400 cursor-not-allowed"
                }`}
              >
                Signed Agreement
              </button>

              <button
                onClick={handleDownloadInvoice}
                disabled={actionLoading}
                className="rounded-lg bg-gray-700 px-4 py-2 font-semibold text-white text-sm transition-colors hover:bg-gray-800 disabled:bg-gray-400"
              >
                Download Invoice
              </button>

              <SendInvoiceButton
                invoice={invoice}
                onUpdated={(updated) => setInvoice(updated)}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 border-t pt-6 md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-gray-600">Customer</h3>
            <p>{invoice.homeowner_name || "-"}</p>
            <p className="text-sm text-gray-500">{invoice.homeowner_email || "-"}</p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-600">Amount</h3>
            <p className="text-xl font-bold">{money(invoice.amount)}</p>
          </div>

          <div>
            <h3 className="font-semibold text-gray-600">Date Issued</h3>
            <p>
              {invoice.created_at
                ? new Date(invoice.created_at).toLocaleDateString()
                : "-"}
            </p>
          </div>

          <div className="md:col-span-2">
            <h3 className="font-semibold text-gray-600">Milestone Details</h3>
            <div className="text-sm text-gray-700 mt-1">
              <div>
                <b>Title:</b> {milestoneTitle || "—"}
              </div>
              <div className="mt-1 whitespace-pre-wrap">
                <b>Description:</b> {milestoneDescription || "—"}
              </div>
            </div>
          </div>

          <div className="md:col-span-2">
            <h3 className="font-semibold text-gray-600">Completion Notes</h3>
            <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
              {completionNotes || "—"}
            </div>
          </div>

          <div className="md:col-span-2">
            <h3 className="font-semibold text-gray-600">Attachments</h3>
            {attachments.length === 0 ? (
              <div className="mt-1 text-sm text-gray-700">—</div>
            ) : (
              <div className="mt-2 space-y-2">
                {attachments.map((a, idx) => {
                  const rawName = a?.name || a?.filename || `Attachment ${idx + 1}`;
                  const niceName = fileNameFromPath(rawName);
                  const url = a?.url || "";
                  return (
                    <div
                      key={`${a?.id || idx}`}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-800 truncate">
                          {niceName}
                        </div>
                        {a?.uploaded_at ? (
                          <div className="text-xs text-gray-500">
                            Uploaded: {fmt(a.uploaded_at)}
                          </div>
                        ) : null}
                      </div>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-900"
                        >
                          Open
                        </a>
                      ) : (
                        <div className="text-xs text-gray-400">No URL</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <h3 className="font-semibold text-gray-600">Email Delivery</h3>
            <div className="text-sm text-gray-700 mt-1">
              <div>
                <b>Sent:</b> {emailSentAt ? fmt(emailSentAt) : "Not sent"}
              </div>
              {invoice.email_message_id ? (
                <div className="text-xs text-gray-500">
                  Message ID: {invoice.email_message_id}
                </div>
              ) : null}
              {emailError ? (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 whitespace-pre-wrap">
                  <b>Last Error:</b> {emailError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
