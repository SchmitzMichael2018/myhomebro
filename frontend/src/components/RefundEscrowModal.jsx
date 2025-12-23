import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

export default function RefundEscrowModal({
  open,
  onClose,
  agreementId,
  agreementLabel = "",
}) {
  const [amount, setAmount] = useState(""); // dollars, optional
  const [reason, setReason] = useState("requested_by_customer");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => {
    if (!agreementId) return false;
    if (busy) return false;
    if (!amount) return true; // blank = full refund
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  }, [agreementId, amount, busy]);

  useEffect(() => {
    if (open) {
      setAmount("");
      setReason("requested_by_customer");
      setNote("");
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const dollarsToCents = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  };

  const submit = async () => {
    if (!agreementId) return;

    // confirm
    const full = !amount;
    const msg = full
      ? `Issue a FULL escrow refund for Agreement #${agreementId}?`
      : `Issue a PARTIAL escrow refund of $${Number(amount).toFixed(
          2
        )} for Agreement #${agreementId}?`;

    if (!window.confirm(msg)) return;

    try {
      setBusy(true);

      const payload = {
        reason,
        note: note?.trim() || "",
      };

      if (amount) {
        const cents = dollarsToCents(amount);
        if (!cents || cents <= 0) {
          toast.error("Enter a valid refund amount.");
          return;
        }
        payload.amount_cents = cents;
      }

      const { data } = await api.post(
        `/payments/agreements/${agreementId}/refund_escrow/`,
        payload
      );

      toast.success(
        `Refund issued. Refunded $${(data?.refunded_amount_cents / 100).toFixed(
          2
        )}`
      );
      onClose?.();
    } catch (err) {
      console.error(err);
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        "Refund failed.";
      toast.error(String(detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-2xl bg-white shadow-xl border border-black/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
          <div>
            <div className="text-lg font-extrabold text-slate-900">
              Refund Escrow
            </div>
            <div className="text-xs text-slate-500">
              {agreementLabel
                ? `${agreementLabel} — Agreement #${agreementId}`
                : `Agreement #${agreementId}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            This refunds funds that are still sitting in escrow (unreleased).
            If escrow has already been paid out, this should be blocked.
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Refund amount (optional)
            </label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Leave blank for FULL refund (e.g. 50.00)"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
              inputMode="decimal"
            />
            <div className="mt-1 text-[11px] text-slate-500">
              Blank = refund the remaining unreleased escrow.
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Reason
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
            >
              <option value="requested_by_customer">Requested by customer</option>
              <option value="duplicate">Duplicate</option>
              <option value="fraudulent">Fraudulent</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Note (recommended)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Example: Contractor sick — cannot perform work. Refund escrow."
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm min-h-[90px]"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-black/10 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-black/10 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-extrabold disabled:opacity-60"
          >
            {busy ? "Refunding…" : "Issue Refund"}
          </button>
        </div>
      </div>
    </div>
  );
}
