// src/components/RefundEscrowModal.jsx
// v2026-01-02d — FIX request storm + refund ONLY selected milestone amount
//
// - Loads refund_preview EXACTLY ONCE per (open + agreementId)
// - Uses AbortController to prevent zombie requests
// - Keeps milestone selection UI
// - Refund submits agreement-level refund amount_cents = selected milestones sum
//   POST /payments/agreements/:id/refund_escrow/

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import api from "../api";

function formatMoney(cents, currency = "usd") {
  const amount = (Number(cents || 0) / 100).toFixed(2);
  const symbol = currency?.toLowerCase() === "usd" ? "$" : "";
  return `${symbol}${amount}`;
}

function statusPill(status) {
  const s = String(status || "").toLowerCase();

  let label = status || "unknown";
  let cls = "bg-gray-100 text-gray-700 border-gray-200";

  if (s.includes("unstarted")) {
    label = "Funded (Not Started)";
    cls = "bg-green-50 text-green-800 border-green-200";
  } else if (s.includes("in_progress")) {
    label = "In Progress";
    cls = "bg-yellow-50 text-yellow-800 border-yellow-200";
  } else if (s.includes("pending_approval") || s.includes("pending")) {
    label = "Pending Approval";
    cls = "bg-blue-50 text-blue-800 border-blue-200";
  } else if (s.includes("approved") || s.includes("paid")) {
    label = "Approved / Paid";
    cls = "bg-gray-50 text-gray-700 border-gray-200";
  } else if (s.includes("dispute")) {
    label = "Disputed";
    cls = "bg-red-50 text-red-800 border-red-200";
  } else if (s.includes("refunded") || s.includes("descoped")) {
    label = "Refunded / Removed";
    cls = "bg-emerald-50 text-emerald-800 border-emerald-200";
  }

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${cls}`}>
      {label}
    </span>
  );
}

function refundedBadge() {
  return (
    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold border border-emerald-200 bg-emerald-50 text-emerald-800">
      ✅ Refunded
    </span>
  );
}

function isRefundedMilestoneRow(m) {
  const s = String(m?.status || "").toLowerCase();
  const ds = String(m?.descope_status || m?.descopeStatus || "").toLowerCase();
  if (ds === "refunded") return true;
  if (s.includes("refunded") || s.includes("descoped")) return true;
  return false;
}

export default function RefundEscrowModal({
  open,
  onClose,
  agreementId,
  agreementLabel = "",
  onRefunded,
  preselectedMilestoneIds = [],
}) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const currency = preview?.currency || "usd";
  const milestones = Array.isArray(preview?.milestones) ? preview.milestones : [];

  // ✅ Prevent request storms:
  // Only load once per open+agreementId, even if component re-renders 1000 times.
  const lastLoadKeyRef = useRef("");
  const abortRef = useRef(null);

  const refundableMilestones = useMemo(() => {
    return milestones.filter((m) => !!m.refundable && Number(m.unreleased_cents || 0) > 0);
  }, [milestones]);

  // ✅ ONLY amount we refund:
  const selectedRefundCents = useMemo(() => {
    return milestones.reduce((sum, m) => {
      if (!selected.has(m.id)) return sum;
      return sum + Number(m.unreleased_cents || 0);
    }, 0);
  }, [milestones, selected]);

  const allSelectedAreRefundable = useMemo(() => {
    if (selected.size === 0) return false;
    for (const m of milestones) {
      if (!selected.has(m.id)) continue;
      if (!m.refundable) return false;
      if (Number(m.unreleased_cents || 0) <= 0) return false;
    }
    return true;
  }, [milestones, selected]);

  const confirmPhrase = "REFUND";

  // Load preview (idempotent)
  useEffect(() => {
    if (!open || !agreementId) return;

    // Reset UI state on open
    setPreview(null);
    setSelected(new Set());
    setConfirmText("");
    setBusy(false);

    const loadKey = `${agreementId}:${open ? "open" : "closed"}`;

    // If we've already loaded for this open+agreement, do nothing
    if (lastLoadKeyRef.current === loadKey) return;
    lastLoadKeyRef.current = loadKey;

    // Abort any previous in-flight request
    try {
      abortRef.current?.abort?.();
    } catch {}
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);

    (async () => {
      try {
        const { data } = await api.get(`/projects/agreements/${agreementId}/refund_preview/`, {
          signal: controller.signal,
          params: { _ts: Date.now() },
        });

        setPreview(data || null);

        // Apply pre-selection (only for ids present in payload)
        const pre = Array.isArray(preselectedMilestoneIds) ? preselectedMilestoneIds : [];
        if (pre.length) {
          const available = new Set((data?.milestones || []).map((x) => x.id));
          const next = new Set();
          for (const id of pre) {
            if (available.has(id)) next.add(id);
          }
          if (next.size) setSelected(next);
        }
      } catch (err) {
        // If aborted, ignore
        if (err?.name === "CanceledError" || err?.name === "AbortError") return;

        console.error(err);
        const payload = err?.response?.data;
        const msg = payload?.detail || payload?.error || err?.message || "Unable to load refund preview.";
        toast.error(String(msg));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      try {
        controller.abort();
      } catch {}
    };
    // IMPORTANT: do NOT depend on preselectedMilestoneIds (often recreated each render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agreementId]);

  // ESC key closes
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const toggleMilestone = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllEligible = () => {
    setSelected(new Set(refundableMilestones.map((m) => m.id)));
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const submitRefund = async () => {
    if (!agreementId) return;

    if (String(confirmText || "").trim().toUpperCase() !== confirmPhrase) {
      toast.error(`Type ${confirmPhrase} to confirm.`);
      return;
    }

    if (selected.size === 0) {
      toast.error("Select at least one eligible milestone.");
      return;
    }

    if (!allSelectedAreRefundable) {
      toast.error("Selection includes non-refundable milestones.");
      return;
    }

    if (selectedRefundCents <= 0) {
      toast.error("Selected refund amount is $0.00.");
      return;
    }

    const msg = `Refund ONLY selected milestones: ${formatMoney(selectedRefundCents, currency)} ?`;
    if (!window.confirm(msg)) return;

    try {
      setBusy(true);

      const payload = {
        amount_cents: selectedRefundCents, // ✅ only selected milestone(s)
        reason: "requested_by_customer",
        note: `UI refund milestones: ${Array.from(selected).join(",")}`,
        milestone_ids: Array.from(selected), // audit only (backend can ignore)
      };

      const { data } = await api.post(`/payments/agreements/${agreementId}/refund_escrow/`, payload);

      toast.success(data?.detail || data?.message || "Refund submitted.");

      // Refresh preview (best effort)
      try {
        const refreshed = await api.get(`/projects/agreements/${agreementId}/refund_preview/`, {
          params: { _ts: Date.now() },
        });
        setPreview(refreshed.data || null);
      } catch {
        // ignore
      }

      setSelected(new Set());
      setConfirmText("");

      onRefunded?.(data);
      onClose?.();
    } catch (err) {
      console.error(err);
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        "Refund failed.";
      toast.error(String(detail));
    } finally {
      setBusy(false);
    }
  };

  const disableSubmit =
    busy ||
    loading ||
    !preview ||
    selected.size === 0 ||
    !allSelectedAreRefundable ||
    selectedRefundCents <= 0 ||
    String(confirmText || "").trim().toUpperCase() !== confirmPhrase;

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-5xl rounded-2xl bg-white shadow-xl border border-black/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-black/10 flex items-center justify-between">
          <div>
            <div className="text-lg font-extrabold text-slate-900">Refund Escrow</div>
            <div className="text-xs text-slate-500">
              {agreementLabel ? `${agreementLabel} — Agreement #${agreementId}` : `Agreement #${agreementId}`}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100"
            title="Close"
            disabled={busy}
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
            This tool refunds <span className="font-semibold">unreleased</span> escrow only.
            You are refunding <span className="font-semibold">ONLY the milestones you select</span>.
          </div>

          {loading ? (
            <div className="p-6 text-center text-slate-600">Loading refund preview…</div>
          ) : !preview ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              Refund preview not available.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs text-gray-500">Funded Total (Agreement)</div>
                  <div className="text-lg font-semibold">{formatMoney(preview?.escrow?.funded_total_cents, currency)}</div>
                </div>

                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs text-gray-500">Unreleased Escrow (Agreement)</div>
                  <div className="text-lg font-semibold">{formatMoney(preview?.escrow?.unreleased_total_cents, currency)}</div>
                  <div className="text-xs text-gray-500 mt-1">Refunds can only come from this amount.</div>
                </div>

                <div className="rounded-xl border bg-white p-4">
                  <div className="text-xs text-gray-500">Selected Refund (ONLY)</div>
                  <div className="text-lg font-semibold">{formatMoney(selectedRefundCents, currency)}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {selected.size} milestone{selected.size === 1 ? "" : "s"} selected
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-white overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-4 border-b">
                  <div>
                    <div className="font-semibold">Milestones</div>
                    <div className="text-xs text-gray-500">Select milestones eligible for refund.</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllEligible}
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
                      disabled={refundableMilestones.length === 0 || busy}
                    >
                      Select All Eligible
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="px-3 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50"
                      disabled={selected.size === 0 || busy}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="divide-y">
                  {milestones.length === 0 ? (
                    <div className="p-6 text-center text-gray-600">No milestones found.</div>
                  ) : (
                    milestones.map((m) => {
                      const refundable = !!m.refundable && Number(m.unreleased_cents || 0) > 0;
                      const checked = selected.has(m.id);
                      const refunded = isRefundedMilestoneRow(m);

                      return (
                        <div key={m.id} className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={checked}
                              onChange={() => toggleMilestone(m.id)}
                              disabled={!refundable || busy}
                            />

                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="font-semibold">{m.title || `Milestone #${m.id}`}</div>
                                {statusPill(m.status)}
                                {refunded ? refundedBadge() : null}

                                {!refundable ? (
                                  <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                                    Not refundable
                                  </span>
                                ) : (
                                  <span className="text-xs text-green-800 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                                    Refund eligible
                                  </span>
                                )}
                              </div>

                              <div className="text-xs text-gray-500 mt-1">
                                {m.refund_block_reason
                                  ? `Blocked: ${m.refund_block_reason}`
                                  : refundable
                                  ? "Eligible (unreleased escrow + work not started)."
                                  : "Not eligible."}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-xs text-gray-500">Funded</div>
                              <div className="font-semibold">{formatMoney(m.funded_cents, currency)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Unreleased</div>
                              <div className="font-semibold">{formatMoney(m.unreleased_cents, currency)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Released</div>
                              <div className="font-semibold">{formatMoney(m.released_cents, currency)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500">Total</div>
                              <div className="font-semibold">{formatMoney(m.amount_cents, currency)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-xl border bg-white p-4 space-y-3">
                <div className="text-sm">
                  To submit a refund, type <span className="font-semibold">{confirmPhrase}</span> below.
                </div>

                <div className="flex flex-col md:flex-row gap-3 md:items-end">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Confirmation</label>
                    <input
                      type="text"
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder={`Type ${confirmPhrase} to confirm`}
                      className="w-full mt-1 px-3 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-blue-200"
                      disabled={busy}
                    />
                  </div>

                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={onClose}
                      disabled={busy}
                      className="px-4 py-2 rounded-lg border border-black/10 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Close
                    </button>

                    <button
                      onClick={submitRefund}
                      disabled={disableSubmit}
                      className={`px-4 py-2 rounded-lg text-white font-extrabold ${
                        disableSubmit ? "bg-gray-400" : "bg-rose-600 hover:bg-rose-700"
                      }`}
                    >
                      {busy ? "Refunding…" : `Refund ${formatMoney(selectedRefundCents, currency)}`}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
