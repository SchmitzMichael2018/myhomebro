// frontend/src/components/SendFundingLinkButton.jsx
// v2025-12-02 — Contractor "Send Escrow Funding Link" button
//
// Props:
//   - agreementId: number (required)
//   - isFullySigned: boolean
//   - amount: number | string (optional but strongly recommended)
//   - currency?: string (default "usd")
//   - className?: string
//
// Behavior:
//   - Disabled unless agreement is fully signed AND amount > 0 AND not loading
//   - POSTs to /projects/agreements/:id/send_funding_link/ with { amount, currency }
//   - Shows toast on success/failure
//   - Displays the funding URL + copy-to-clipboard field so contractor can share it

import React, { useState, useMemo } from "react";
import toast from "react-hot-toast";
import api from "../api";

function normalizeAmount(rawAmount) {
  if (rawAmount == null) return 0;
  const n =
    typeof rawAmount === "number"
      ? rawAmount
      : parseFloat(String(rawAmount).trim());
  return Number.isFinite(n) ? n : 0;
}

export default function SendFundingLinkButton({
  agreementId,
  isFullySigned,
  amount,
  currency = "usd",
  className = "",
}) {
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { public_fund_url, amount, currency, expires_at }
  const [copied, setCopied] = useState(false);

  const normalizedAmount = useMemo(
    () => normalizeAmount(amount),
    [amount]
  );

  const disabled =
    !isFullySigned || !agreementId || loading || normalizedAmount <= 0;

  const handleClick = async () => {
    if (!agreementId) {
      toast.error("Missing agreement id.");
      return;
    }
    if (!isFullySigned) {
      toast.error("Agreement must be fully signed before funding.");
      return;
    }
    if (normalizedAmount <= 0) {
      toast.error("Please ensure the total project amount is greater than zero.");
      return;
    }

    setLoading(true);
    setCopied(false);

    try {
      const payload = {
        amount: normalizedAmount.toFixed(2),
        currency,
      };

      const { data } = await api.post(
        `/projects/agreements/${agreementId}/send_funding_link/`,
        payload
      );

      setLastResult(data || null);

      const url = data?.public_fund_url;
      const amt = data?.amount || payload.amount;
      const cur = (data?.currency || currency || "usd").toUpperCase();

      if (url) {
        toast.success(
          `Funding link sent to homeowner for $${amt} ${cur}.`
        );
      } else {
        toast.success("Funding link created.");
      }
    } catch (err) {
      console.error("Error sending funding link:", err);
      const msg =
        err?.response?.data?.detail ||
        "Unable to send escrow funding link right now.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!lastResult?.public_fund_url) return;
    try {
      await navigator.clipboard.writeText(lastResult.public_fund_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error("Unable to copy link to clipboard.");
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold border ${
          disabled
            ? "border-slate-600 bg-slate-700 text-slate-300 cursor-not-allowed"
            : "border-emerald-400/60 bg-emerald-500/90 text-slate-950 hover:bg-emerald-400"
        }`}
      >
        {loading ? "Sending funding link…" : "Send Escrow Funding Link"}
      </button>

      {!isFullySigned && (
        <p className="text-xs text-slate-400">
          Agreement must be fully signed by both parties before requesting
          escrow funding.
        </p>
      )}

      {normalizedAmount <= 0 && isFullySigned && (
        <p className="text-xs text-amber-400">
          Total amount appears to be $0. Update the agreement total before
          sending a funding request.
        </p>
      )}

      {lastResult?.public_fund_url && (
        <div className="mt-2 space-y-1 rounded-md border border-emerald-500/40 bg-emerald-900/20 px-3 py-2">
          <div className="text-xs text-emerald-200 font-semibold">
            Latest funding link
          </div>
          <div className="flex flex-col gap-1">
            <input
              type="text"
              readOnly
              className="w-full rounded-md border border-emerald-500/40 bg-slate-950 text-xs text-emerald-50 px-2 py-1"
              value={lastResult.public_fund_url}
              onFocus={(e) => e.target.select()}
            />
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-400/60 bg-emerald-500/90 text-[11px] font-semibold text-slate-950 px-2 py-1 hover:bg-emerald-400"
              >
                {copied ? "Copied!" : "Copy link"}
              </button>
              <div className="text-[10px] text-emerald-200 text-right">
                Amount: ${lastResult.amount}{" "}
                {(lastResult.currency || currency || "usd").toUpperCase()}
                {lastResult.expires_at && (
                  <>
                    {" "}
                    · Expires:{" "}
                    {new Date(lastResult.expires_at).toLocaleString()}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
