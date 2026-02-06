import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api, { getAccessToken } from "../api";
import { useAuth } from "../context/AuthContext";

// InvoiceList.jsx
// v2026-01-23 — token detection uses getAccessToken() (canonical+legacy read)

const money = (amount) =>
  Number(amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function statusLabel(status) {
  const s = String(status || "");
  if (!s) return "—";
  return s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

function statusPillClasses(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("paid") || s.includes("released")) return "bg-green-100 text-green-800";
  if (s.includes("approved")) return "bg-blue-100 text-blue-800";
  if (s.includes("dispute")) return "bg-red-100 text-red-800";
  if (s.includes("pending")) return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-800";
}

function chipClasses(active) {
  return active
    ? "bg-slate-900 text-white border-slate-900"
    : "bg-white text-slate-800 border-slate-200 hover:bg-slate-50";
}

function getUserType(user) {
  const t =
    user?.type ??
    user?.role ??
    user?.user?.type ??
    user?.user?.role ??
    user?.profile?.type ??
    user?.profile?.role ??
    "";
  return String(t || "").toLowerCase();
}

function tokenPresent() {
  try {
    return Boolean(getAccessToken());
  } catch {
    return false;
  }
}

function pickDateValue(inv) {
  const v =
    inv?.updated_at ??
    inv?.created_at ??
    inv?.issued_at ??
    inv?.date ??
    inv?.sent_at ??
    inv?.email_sent_at ??
    inv?.last_sent_at ??
    inv?.paid_at ??
    inv?.released_at ??
    null;

  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeInvoice(inv) {
  const agreementId =
    inv?.agreement?.id ??
    inv?.agreement_id ??
    inv?.agreementId ??
    (typeof inv?.agreement === "number" ? inv.agreement : null) ??
    null;

  const agreementNumber =
    inv?.agreement?.agreement_number ??
    inv?.agreement?.number ??
    inv?.agreement_number ??
    inv?.agreementNumber ??
    (agreementId != null ? String(agreementId) : "—");

  const agreementTitle =
    inv?.agreement?.project_title ??
    inv?.agreement?.title ??
    inv?.agreement_title ??
    inv?.project_title ??
    inv?.projectTitle ??
    "Untitled Agreement";

  const homeownerName =
    inv?.homeowner_name ??
    inv?.homeowner?.name ??
    inv?.customer_name ??
    inv?.customer?.name ??
    inv?.agreement?.homeowner_name ??
    inv?.agreement?.homeowner?.name ??
    "Unknown Customer";

  const id = inv?.id ?? inv?.pk ?? inv?.invoice_id ?? null;
  const invoiceNumber = inv?.invoice_number ?? inv?.number ?? (id != null ? `INV-${id}` : "INV-—");
  const amount = Number(inv?.amount ?? inv?.amount_due ?? inv?.total ?? inv?.total_amount ?? 0) || 0;

  const status = inv?.display_status ?? inv?.status_label ?? inv?.status ?? "pending";

  const milestoneId =
    inv?.milestone_id ??
    inv?.milestone?.id ??
    inv?.milestoneId ??
    (typeof inv?.milestone === "number" ? inv.milestone : null) ??
    null;

  const milestoneName =
    inv?.milestone_title ??
    inv?.milestone?.title ??
    inv?.milestone?.name ??
    inv?.milestoneName ??
    inv?.title ??
    "Milestone";

  const milestoneDescription =
    inv?.milestone_description ??
    inv?.milestone?.description ??
    inv?.milestone?.notes ??
    inv?.notes ??
    inv?.description ??
    "";

  const emailSentAt = inv?.email_sent_at ?? inv?.emailed_at ?? inv?.sent_at ?? inv?.last_sent_at ?? null;

  const isoDate = pickDateValue(inv);

  return {
    raw: inv,
    id,
    invoiceNumber,
    amount,
    status,
    agreementId,
    agreementNumber,
    agreementTitle,
    homeownerName,
    milestoneId,
    milestoneName,
    milestoneDescription,
    emailSentAt,
    isoDate,
  };
}

function isPaidLike(status) {
  const s = String(status || "").toLowerCase();
  return s.includes("paid") || s.includes("released");
}

function statusBucket(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return "other";
  if (s.includes("dispute")) return "disputed";
  if (isPaidLike(s)) return "paid";
  if (s.includes("approved")) return "approved";
  if (s.includes("pending")) return "pending";
  if (s.includes("unpaid")) return "pending";
  return "other";
}

function prettyDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

export default function InvoiceList({ initialData = [], loadingOverride = false, onRefresh = null }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [agreementFilter, setAgreementFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sendingIds, setSendingIds] = useState({});

  const uType = useMemo(() => getUserType(user), [user]);
  const hasToken = useMemo(() => tokenPresent(), []);
  const canSend = useMemo(() => uType.includes("contractor") || hasToken, [uType, hasToken]);

  const normalized = useMemo(() => {
    const list = Array.isArray(initialData) ? initialData : [];
    return list.map(normalizeInvoice).filter((x) => x.id != null);
  }, [initialData]);

  const agreements = useMemo(() => {
    const map = new Map();
    for (const inv of normalized) {
      const key = inv.agreementId != null ? `id:${inv.agreementId}` : `num:${inv.agreementNumber}:${inv.agreementTitle}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          agreementId: inv.agreementId,
          agreementNumber: inv.agreementNumber,
          agreementTitle: inv.agreementTitle,
          homeownerName: inv.homeownerName,
        });
      }
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const aId = Number(a.agreementId);
      const bId = Number(b.agreementId);
      if (!Number.isNaN(aId) && !Number.isNaN(bId)) return bId - aId;
      return `${a.homeownerName} ${a.agreementTitle}`.localeCompare(`${b.homeownerName} ${b.agreementTitle}`);
    });
    return arr;
  }, [normalized]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return normalized.filter((x) => {
      if (agreementFilter !== "all") {
        if (x.agreementId != null) {
          const matchKey = `id:${x.agreementId}`;
          if (matchKey !== agreementFilter) return false;
        } else {
          const matchKey = `num:${x.agreementNumber}:${x.agreementTitle}`;
          if (matchKey !== agreementFilter) return false;
        }
      }

      if (statusFilter !== "all") {
        const b = statusBucket(x.status);
        if (b !== statusFilter) return false;
      }

      if (!q) return true;

      return (
        String(x.invoiceNumber).toLowerCase().includes(q) ||
        String(x.agreementTitle).toLowerCase().includes(q) ||
        String(x.agreementNumber).toLowerCase().includes(q) ||
        String(x.homeownerName).toLowerCase().includes(q) ||
        String(x.milestoneId ?? "").toLowerCase().includes(q) ||
        String(x.milestoneName).toLowerCase().includes(q) ||
        String(x.milestoneDescription || "").toLowerCase().includes(q) ||
        String(x.status || "").toLowerCase().includes(q)
      );
    });
  }, [normalized, query, agreementFilter, statusFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const aPaid = isPaidLike(a.status);
      const bPaid = isPaidLike(b.status);
      if (aPaid !== bPaid) return aPaid ? 1 : -1;

      const aT = a.isoDate ? new Date(a.isoDate).getTime() : NaN;
      const bT = b.isoDate ? new Date(b.isoDate).getTime() : NaN;
      const aHas = !Number.isNaN(aT);
      const bHas = !Number.isNaN(bT);

      if (aHas && bHas && aT !== bT) return bT - aT;
      if (aHas !== bHas) return aHas ? -1 : 1;

      return Number(b.id) - Number(a.id);
    });
    return copy;
  }, [filtered]);

  const totals = useMemo(() => {
    const count = sorted.length;
    const total = sorted.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
    const unpaidCount = sorted.filter((x) => !isPaidLike(x.status)).length;
    const disputedCount = sorted.filter((x) => statusBucket(x.status) === "disputed").length;
    const paidCount = sorted.filter((x) => isPaidLike(x.status)).length;
    return { count, total, unpaidCount, disputedCount, paidCount };
  }, [sorted]);

  async function handleRefresh() {
    if (!onRefresh) {
      toast("Refresh isn’t wired on this page yet.");
      return;
    }
    try {
      await onRefresh();
    } catch (e) {
      console.error(e);
      toast.error("Failed to refresh invoices.");
    }
  }

  function handleView(invoiceId) {
    navigate(`/app/invoices/${invoiceId}`);
  }

  function handleViewAgreement(agreementId, agreementNumber) {
    const id = agreementId ?? agreementNumber;
    if (!id) return;
    navigate(`/app/agreements/${id}/wizard?step=4`);
  }

  function handleViewMilestone(milestoneId) {
    navigate(`/milestones/${milestoneId}`);
  }

  async function handleSendOrResend(item) {
    const invoiceId = item.id;
    const isResend = Boolean(item.emailSentAt);

    setSendingIds((prev) => ({ ...prev, [invoiceId]: true }));
    try {
      const endpoint = isResend ? `/projects/invoices/${invoiceId}/resend/` : `/projects/invoices/${invoiceId}/submit/`;

      await api.post(endpoint);
      toast.success(isResend ? "Invoice email resent." : "Invoice email sent.");
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || err?.response?.data?.error || "Failed to send invoice email.");
    } finally {
      setSendingIds((prev) => ({ ...prev, [invoiceId]: false }));
    }
  }

  function resetAllFilters() {
    setQuery("");
    setAgreementFilter("all");
    setStatusFilter("all");
  }

  function setQuickFilter(kind) {
    if (kind === "all") {
      setStatusFilter("all");
      return;
    }
    setStatusFilter(kind);
  }

  const activeChip =
    statusFilter === "all"
      ? "all"
      : statusFilter === "pending"
        ? "pending"
        : statusFilter === "disputed"
          ? "disputed"
          : statusFilter === "paid"
            ? "paid"
            : "other";

  const anyFiltersActive = query.trim() || agreementFilter !== "all" || statusFilter !== "all";

  return (
    <div className="w-full p-4">
      <div className="mb-2 text-xs text-white/80">
        InvoiceList debug — userType: <b>{uType || "(empty)"}</b> • tokenPresent: <b>{String(hasToken)}</b> • canSend:{" "}
        <b>{String(canSend)}</b>
      </div>

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-extrabold text-slate-900">Invoices</div>
          <div className="text-sm text-slate-600">
            {loadingOverride ? (
              "Loading…"
            ) : (
              <>
                <b>{totals.count}</b> invoice{totals.count === 1 ? "" : "s"} •{" "}
                <b>{totals.unpaidCount}</b> unpaid • <b>{money(totals.total)}</b> total
                {anyFiltersActive ? " (filtered)" : ""}
              </>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setQuickFilter("all")}
              className={`h-9 rounded-full border px-4 text-sm font-extrabold ${chipClasses(activeChip === "all")}`}
              title="Show all invoices"
            >
              All <span className={`ml-2 text-xs ${activeChip === "all" ? "text-white/80" : "text-slate-500"}`}>{totals.count}</span>
            </button>

            <button
              type="button"
              onClick={() => setQuickFilter("pending")}
              className={`h-9 rounded-full border px-4 text-sm font-extrabold ${chipClasses(activeChip === "pending")}`}
              title="Show unpaid/pending invoices"
            >
              Unpaid{" "}
              <span className={`ml-2 text-xs ${activeChip === "pending" ? "text-white/80" : "text-slate-500"}`}>
                {totals.unpaidCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setQuickFilter("disputed")}
              className={`h-9 rounded-full border px-4 text-sm font-extrabold ${chipClasses(activeChip === "disputed")}`}
              title="Show disputed invoices"
            >
              Disputed{" "}
              <span className={`ml-2 text-xs ${activeChip === "disputed" ? "text-white/80" : "text-slate-500"}`}>
                {totals.disputedCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setQuickFilter("paid")}
              className={`h-9 rounded-full border px-4 text-sm font-extrabold ${chipClasses(activeChip === "paid")}`}
              title="Show paid invoices"
            >
              Paid{" "}
              <span className={`ml-2 text-xs ${activeChip === "paid" ? "text-white/80" : "text-slate-500"}`}>
                {totals.paidCount}
              </span>
            </button>

            {anyFiltersActive && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                title="Clear filters"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by customer, agreement, milestone, invoice…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300 md:w-[360px]"
          />

          <select
            value={agreementFilter}
            onChange={(e) => setAgreementFilter(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300 md:w-[240px]"
            title="Filter by agreement"
          >
            <option value="all">All Agreements</option>
            {agreements.map((a) => (
              <option key={a.key} value={a.key}>
                {a.agreementTitle} • #{a.agreementNumber}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300 md:w-[170px]"
            title="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending / Unpaid</option>
            <option value="approved">Approved</option>
            <option value="disputed">Disputed</option>
            <option value="paid">Paid / Released</option>
            <option value="other">Other</option>
          </select>

          <button
            onClick={handleRefresh}
            disabled={loadingOverride}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {loadingOverride ? "Loading invoices…" : "No invoices found."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="hidden grid-cols-12 gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-extrabold text-slate-600 md:grid">
            <div className="col-span-2">Invoice</div>
            <div className="col-span-2">Agreement</div>
            <div className="col-span-3">Milestone</div>
            <div className="col-span-2">Customer</div>
            <div className="col-span-1">Amount</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>

          <div className="divide-y divide-slate-200">
            {sorted.map((item) => {
              const sending = !!sendingIds[item.id];
              const sendLabel = item.emailSentAt ? "Resend" : "Send";

              return (
                <div key={item.id} className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-12 md:gap-3">
                  <div className="md:col-span-2">
                    <div className="font-extrabold text-slate-900">{item.invoiceNumber}</div>
                    <div className="mt-1 text-xs text-slate-500">{prettyDate(item.isoDate)}</div>
                  </div>

                  <div className="min-w-0 md:col-span-2">
                    <button
                      type="button"
                      onClick={() => handleViewAgreement(item.agreementId, item.agreementNumber)}
                      className="block w-full text-left"
                      title="Open agreement"
                    >
                      <div className="truncate text-sm font-extrabold text-slate-900 hover:underline">
                        {item.agreementTitle}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">#{item.agreementNumber}</div>
                    </button>
                  </div>

                  <div className="min-w-0 md:col-span-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-extrabold text-slate-500">
                        {item.milestoneId != null ? `#${item.milestoneId}` : "#—"}
                      </span>
                      <span className="truncate text-sm font-extrabold text-slate-900">{item.milestoneName}</span>
                      {item.milestoneId != null && (
                        <button
                          type="button"
                          onClick={() => handleViewMilestone(item.milestoneId)}
                          className="ml-2 text-xs font-extrabold text-blue-700 hover:underline"
                        >
                          View
                        </button>
                      )}
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-slate-600">{item.milestoneDescription || "—"}</div>
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-sm font-extrabold text-slate-900">{item.homeownerName}</div>
                  </div>

                  <div className="md:col-span-1">
                    <div className="text-sm font-extrabold text-slate-900">{money(item.amount)}</div>
                  </div>

                  <div className="md:col-span-1">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-extrabold ${statusPillClasses(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 md:col-span-1 md:justify-end">
                    <button
                      type="button"
                      onClick={() => handleView(item.id)}
                      className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                    >
                      View
                    </button>

                    {canSend && (
                      <button
                        type="button"
                        onClick={() => handleSendOrResend(item)}
                        disabled={sending}
                        className="h-9 rounded-xl border border-slate-200 bg-slate-900 px-3 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        {sending ? "Sending…" : sendLabel}
                      </button>
                    )}
                  </div>

                  <div className="md:hidden">
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="font-bold text-slate-500">Agreement:</span>
                      <button
                        type="button"
                        onClick={() => handleViewAgreement(item.agreementId, item.agreementNumber)}
                        className="font-extrabold text-slate-900 hover:underline"
                      >
                        {item.agreementTitle} #{item.agreementNumber}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
