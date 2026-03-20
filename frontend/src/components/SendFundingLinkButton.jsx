// /frontend/src/components/SendFundingLinkButton.jsx
import React, { useMemo, useState } from "react";
import { getAccessToken } from "../api";

/**
 * SendFundingLinkButton
 *
 * Sends a funding link to homeowner for a specific dollar amount (typically remaining escrow).
 *
 * Default endpoint:
 *   POST /api/projects/agreements/:id/send_funding_link/
 *
 * Important:
 * - Pass `amount` as the remaining escrow needed (e.g., 25.00 for an amendment top-up)
 * - Backend should use request.data.amount if present.
 */
export default function SendFundingLinkButton({
  agreementId,
  isFullySigned = true,
  amount = null, // IMPORTANT: pass remaining needed (e.g. 25.00)
  disabled = false,
  variant = "brand",
  className = "",
  endpoint = null,
  onSuccess,
  onError,
  label = "Send Escrow Funding Link",
}) {
  const [isSending, setIsSending] = useState(false);
  const [lastError, setLastError] = useState("");

  const resolvedEndpoint = useMemo(() => {
    if (endpoint) return endpoint;
    if (agreementId === undefined || agreementId === null) return null;
    return `/api/projects/agreements/${agreementId}/send_funding_link/`;
  }, [endpoint, agreementId]);

  const normalizedAmount = useMemo(() => {
    if (amount === null || amount === undefined || amount === "") return null;
    const n = Number(amount);
    if (Number.isNaN(n)) return null;
    return Math.round(n * 100) / 100;
  }, [amount]);

  const isDisabled = useMemo(() => {
    if (disabled) return true;
    if (isSending) return true;
    if (!resolvedEndpoint) return true;
    if (!isFullySigned) return true;
    if (normalizedAmount === null) return true;
    if (normalizedAmount <= 0) return true;
    return false;
  }, [disabled, isSending, resolvedEndpoint, isFullySigned, normalizedAmount]);

  const baseClass =
    "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold transition " +
    "border shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2";

  const variants = {
    brand:
      "bg-gradient-to-r from-indigo-600 to-violet-600 text-white border-indigo-700 " +
      "hover:from-indigo-700 hover:to-violet-700 focus:ring-violet-500",
    success: "bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-700 focus:ring-emerald-500",
    secondary: "bg-white text-gray-900 border-gray-300 hover:bg-gray-50 focus:ring-gray-400",
    danger: "bg-red-600 text-white border-red-700 hover:bg-red-700 focus:ring-red-500",
  };

  const disabledClass =
    "opacity-60 cursor-not-allowed shadow-none hover:from-indigo-600 hover:to-violet-600 hover:bg-inherit";

  async function handleSend() {
    setLastError("");
    if (isDisabled) return;

    try {
      setIsSending(true);

      const token = getAccessToken() || "";

      const payload = { amount: normalizedAmount };

      const res = await fetch(resolvedEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      let data = null;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = { detail: text };
      }

      if (!res.ok) {
        const msg =
          data?.detail ||
          data?.error ||
          data?.message ||
          `Failed to send funding link (HTTP ${res.status})`;
        setLastError(msg);
        if (onError) onError(msg);
        return;
      }

      if (onSuccess) onSuccess(data);
      // eslint-disable-next-line no-alert
      alert(data?.detail || "Funding link sent to customer.");
    } catch (err) {
      const msg = err?.message || "Unexpected error while sending funding link.";
      setLastError(msg);
      if (onError) onError(msg);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-2">
      <button
        type="button"
        onClick={handleSend}
        disabled={isDisabled}
        className={[baseClass, variants[variant] || variants.brand, isDisabled ? disabledClass : "", className].join(" ")}
        title={
          !isFullySigned
            ? "Agreement must be fully signed before sending funding link."
            : normalizedAmount === null || normalizedAmount <= 0
              ? "Funding amount must be greater than zero."
              : "Send escrow funding link"
        }
      >
        {isSending ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            Sending…
          </>
        ) : (
          label
        )}
      </button>

      {lastError ? <div className="text-sm text-red-600">{lastError}</div> : null}
    </div>
  );
}
