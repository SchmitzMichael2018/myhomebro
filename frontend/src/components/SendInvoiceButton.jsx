import React, { useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";

const isPendingish = (status) => {
  const s = String(status || "").trim().toLowerCase();
  return s === "pending" || s === "pending_approval";
};

export default function SendInvoiceButton({
  invoice,
  onUpdated,
  className = "",
  forceEnable = false,
}) {
  const [loading, setLoading] = useState(false);

  const invoiceId = invoice?.id;
  const emailSentAt = invoice?.email_sent_at || null;
  const status = invoice?.status || "";

  const label = emailSentAt ? "Resend Invoice" : "Send Invoice";

  const disabled = useMemo(() => {
    if (!invoiceId) return true;
    if (loading) return true;
    if (forceEnable) return false;
    return !isPendingish(status);
  }, [invoiceId, loading, forceEnable, status]);

  const title = useMemo(() => {
    if (!invoiceId) return "Invoice not loaded yet.";
    if (loading) return "Working…";
    if (forceEnable) return "Send or resend invoice email.";
    if (!isPendingish(status)) return "Invoice is no longer pending.";
    return emailSentAt ? "Resend invoice email" : "Send invoice email";
  }, [invoiceId, loading, forceEnable, status, emailSentAt]);

  const endpoint = emailSentAt
    ? `/projects/invoices/${invoiceId}/resend/`
    : `/projects/invoices/${invoiceId}/submit/`;

  const handleClick = async () => {
    if (!invoiceId) return;

    setLoading(true);
    try {
      const { data } = await api.post(endpoint);

      toast.success(emailSentAt ? "Invoice resent." : "Invoice sent.");

      // If backend returns updated invoice, use it.
      // Otherwise, refetch invoice detail and pass to parent.
      const looksLikeInvoice = data && typeof data === "object" && (data.id || data.invoice_number);
      if (typeof onUpdated === "function") {
        if (looksLikeInvoice) {
          onUpdated(data);
        } else {
          try {
            const refreshed = await api.get(`/projects/invoices/${invoiceId}/`, {
              params: { _ts: Date.now() },
              headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
            });
            onUpdated(refreshed.data);
          } catch {
            // If refresh fails, still fine — toast already succeeded.
          }
        }
      }
    } catch (err) {
      const statusCode = err?.response?.status;
      const msg =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message ||
        "Failed to send invoice.";

      if (statusCode === 401 || statusCode === 403) {
        toast.error("Not authorized to send invoices from this account.");
      } else if (statusCode === 404) {
        toast.error("Send endpoint not found. Backend route may be missing.");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      className={[
        "rounded-lg px-4 py-2 font-semibold text-sm transition-colors text-white",
        loading ? "bg-blue-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700",
        disabled ? "opacity-60" : "",
        className,
      ].join(" ")}
    >
      {loading ? "Sending…" : label}
    </button>
  );
}
