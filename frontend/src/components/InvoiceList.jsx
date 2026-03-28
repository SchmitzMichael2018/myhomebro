import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import api, { getAccessToken } from "../api";
import { useAuth } from "../context/AuthContext";
import { handleStripeRequirementError } from "../lib/stripeRequirement.js";

// InvoiceList.jsx
// v2026-03-03b — ✅ Option A alignment + milestone numbering fix + LIVE route fix
// - Customer display prefers invoice.customer_name (fallback invoice.homeowner_name)
// - Milestone display prefers milestone_order (1..N) then milestone_label then milestone_id
// - Group headers + rows use customerName (not homeownerName)
// - Search includes milestone_order
// - ✅ FIX: Milestone "View" now uses /app/milestones/:id (and /app/employee if applicable)

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
  if (s.includes("sent")) return "bg-slate-100 text-slate-800";
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
    inv?.direct_pay_paid_at ??
    null;

  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function extractMilestoneNumber(inv) {
  const order =
    inv?.milestone_order ??
    inv?.milestoneOrder ??
    inv?.milestone_number ??
    inv?.milestoneNumber ??
    null;

  if (order !== null && order !== undefined && String(order).trim() !== "") {
    return String(order);
  }

  const label = inv?.milestone_label ?? inv?.milestoneLabel ?? null;
  if (label) {
    const m = String(label).match(/#\s*(\d+)/);
    if (m && m[1]) return String(m[1]);
  }

  const id =
    inv?.milestone_id ??
    inv?.milestone?.id ??
    inv?.milestoneId ??
    (typeof inv?.milestone === "number" ? inv.milestone : null) ??
    null;

  return id != null ? String(id) : "";
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

  const customerName =
    inv?.customer_name ??
    inv?.customerName ??
    inv?.homeowner_name ??
    inv?.homeowner?.name ??
    inv?.customer?.name ??
    inv?.agreement?.customer_name ??
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

  const milestoneNumber = extractMilestoneNumber(inv);

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

  const paymentMode =
    inv?.agreement?.payment_mode ??
    inv?.agreement?.paymentMode ??
    inv?.payment_mode ??
    inv?.paymentMode ??
    inv?.agreement_payment_mode ??
    null;

  const directPayCheckoutUrl =
    inv?.direct_pay_checkout_url ??
    inv?.directPayCheckoutUrl ??
    inv?.checkout_url ??
    "";

  const directPayPaidAt =
    inv?.direct_pay_paid_at ??
    inv?.directPayPaidAt ??
    inv?.paid_at ??
    null;

  return {
    raw: inv,
    id,
    invoiceNumber,
    amount,
    status,
    paymentMode,
    directPayCheckoutUrl,
    directPayPaidAt,
    agreementId,
    agreementNumber,
    agreementTitle,
    customerName,
    milestoneId,
    milestoneNumber,
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

function isDirectPayMode(paymentMode) {
  const s = String(paymentMode || "").toLowerCase();
  return s === "direct" || s.includes("direct");
}

async function copyToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function statusBucket(status) {
  const s = String(status || "").toLowerCase();
  if (!s) return "other";
  if (s.includes("dispute")) return "disputed";
  if (isPaidLike(s)) return "paid";
  if (s.includes("approved")) return "approved";
  if (s.includes("pending")) return "pending";
  if (s.includes("unpaid")) return "pending";
  if (s.includes("sent")) return "pending";
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
  const location = useLocation();
  const { user } = useAuth();

  // ✅ Base route for contractor vs employee console (LIVE safe)
  const BASE = useMemo(() => {
    const p = location.pathname || "";
    return p.startsWith("/app/employee") ? "/app/employee" : "/app";
  }, [location.pathname]);

  const [query, setQuery] = useState("");
  const [agreementFilter, setAgreementFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sendingIds, setSendingIds] = useState({});
  const [directPayIds, setDirectPayIds] = useState({});
  const [directPayEmailIds, setDirectPayEmailIds] = useState({});
  const [openAgreements, setOpenAgreements] = useState(() => new Set());

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
      const key =
        inv.agreementId != null ? `id:${inv.agreementId}` : `num:${inv.agreementNumber}:${inv.agreementTitle}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          agreementId: inv.agreementId,
          agreementNumber: inv.agreementNumber,
          agreementTitle: inv.agreementTitle,
          customerName: inv.customerName,
        });
      }
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const aId = Number(a.agreementId);
      const bId = Number(b.agreementId);
      if (!Number.isNaN(aId) && !Number.isNaN(bId)) return bId - aId;
      return `${a.customerName} ${a.agreementTitle}`.localeCompare(`${b.customerName} ${b.agreementTitle}`);
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
        String(x.customerName).toLowerCase().includes(q) ||
        String(x.milestoneNumber || "").toLowerCase().includes(q) ||
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

  const groups = useMemo(() => {
    const map = new Map();
    for (const inv of sorted) {
      const key =
        inv.agreementId != null ? `id:${inv.agreementId}` : `num:${inv.agreementNumber}:${inv.agreementTitle}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          agreementId: inv.agreementId,
          agreementNumber: inv.agreementNumber,
          agreementTitle: inv.agreementTitle,
          customerName: inv.customerName,
          invoices: [],
        });
      }
      map.get(key).invoices.push(inv);
    }

    const arr = Array.from(map.values());

    for (const g of arr) {
      g.invoices.sort((a, b) => {
        const aT = a.isoDate ? new Date(a.isoDate).getTime() : 0;
        const bT = b.isoDate ? new Date(b.isoDate).getTime() : 0;
        return bT - aT;
      });
    }

    arr.sort((a, b) => {
      const aId = Number(a.agreementId);
      const bId = Number(b.agreementId);
      const aHas = !Number.isNaN(aId);
      const bHas = !Number.isNaN(bId);
      if (aHas && bHas) return bId - aId;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return `${a.customerName} ${a.agreementTitle}`.localeCompare(`${b.customerName} ${b.agreementTitle}`);
    });

    return arr;
  }, [sorted]);

  const anyFiltersActive = query.trim() || agreementFilter !== "all" || statusFilter !== "all";
  useEffect(() => {
    if (!anyFiltersActive) return;
    setOpenAgreements(() => {
      const next = new Set();
      for (const g of groups) next.add(g.key);
      return next;
    });
  }, [anyFiltersActive, groups]);

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
    navigate(`${BASE}/invoices/${invoiceId}`);
  }

  function handleViewAgreement(agreementId, agreementNumber) {
    const id = agreementId ?? agreementNumber;
    if (!id) return;
    navigate(`${BASE}/agreements/${id}/wizard?step=4`);
  }

  function handleViewMilestone(milestoneId) {
    // ✅ LIVE-safe (consistent with InvoiceDetail)
    navigate(`${BASE}/milestones/${milestoneId}`);
  }

  async function handleSendOrResend(item) {
    const invoiceId = item.id;
    const isResend = Boolean(item.emailSentAt);

    setSendingIds((prev) => ({ ...prev, [invoiceId]: true }));
    try {
      const endpoint = isResend
        ? `/projects/invoices/${invoiceId}/resend/`
        : `/projects/invoices/${invoiceId}/submit/`;

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

  async function handleDirectPay(item) {
    const invoiceId = item.id;
    const isPaid =
      isPaidLike(item.status) ||
      String(item.status || "").toLowerCase() === "paid" ||
      Boolean(item.directPayPaidAt);

    if (isPaid) {
      toast("This invoice is already paid.");
      return;
    }

    const existingUrl = String(item.directPayCheckoutUrl || "").trim();
    if (existingUrl) {
      const ok = await copyToClipboard(existingUrl);
      if (ok) toast.success("Pay link copied.");
      else toast.error("Could not copy link.");
      return;
    }

    setDirectPayIds((prev) => ({ ...prev, [invoiceId]: true }));
    try {
      const { data } = await api.post(`/projects/invoices/${invoiceId}/direct_pay_link/`);
      const url = data?.checkout_url || data?.checkoutUrl || "";
      if (!url) {
        toast.error("No checkout URL returned.");
      } else {
        const ok = await copyToClipboard(url);
        toast.success(ok ? "Pay link created & copied." : "Pay link created.");
      }
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error(err);
      const stripeRequirement = handleStripeRequirementError(
        err,
        "Failed to create Direct Pay link."
      );
      toast.error(stripeRequirement.message);
    } finally {
      setDirectPayIds((prev) => ({ ...prev, [invoiceId]: false }));
    }
  }

  async function handleDirectPayEmail(item) {
    const invoiceId = item.id;
    const isPaid =
      isPaidLike(item.status) ||
      String(item.status || "").toLowerCase() === "paid" ||
      Boolean(item.directPayPaidAt);
    const hasLink = Boolean(String(item.directPayCheckoutUrl || "").trim());
    if (isPaid) {
      toast("This invoice is already paid.");
      return;
    }
    if (!hasLink) {
      toast("Create the pay link first, then email it.");
      return;
    }

    setDirectPayEmailIds((prev) => ({ ...prev, [invoiceId]: true }));
    try {
      const { data } = await api.post(`/projects/invoices/${invoiceId}/direct_pay_email/`, {});
      toast.success(`Email sent to ${data?.emailed_to || "customer"}.`);
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.error(err);
      const stripeRequirement = handleStripeRequirementError(
        err,
        "Failed to email pay link."
      );
      toast.error(stripeRequirement.message);
    } finally {
      setDirectPayEmailIds((prev) => ({ ...prev, [invoiceId]: false }));
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

  const thBase =
    "px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-slate-700 border-r border-slate-200 last:border-r-0";
  const tdBase = "px-4 py-3 border-r border-slate-100 last:border-r-0";

  const toggleGroup = (key) => {
    setOpenAgreements((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="w-full p-4">
      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-extrabold text-slate-900">Invoices</div>

          <div className="mhb-helper-text">
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
              All{" "}
              <span className={`ml-2 text-xs ${activeChip === "all" ? "text-white/80" : "text-slate-500"}`}>
                {totals.count}
              </span>
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

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          {loadingOverride ? "Loading invoices…" : "No invoices found."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-slate-100">
                <tr className="border-b border-slate-200">
                  <th className={`${thBase} text-left w-[140px]`}>Agreement #</th>
                  <th className={`${thBase} text-left`}>Project</th>
                  <th className={`${thBase} text-left w-[220px]`}>Customer</th>
                  <th className={`${thBase} text-right w-[180px]`}>Invoices Total</th>
                  <th className={`${thBase} text-center w-[140px]`}>Invoices</th>
                  <th className={`${thBase} text-center w-[90px]`}>Open</th>
                </tr>
              </thead>

              <tbody>
                {groups.map((g) => {
                  const open = openAgreements.has(g.key);
                  const invoiceTotal = g.invoices.reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
                  const agIdDisplay = g.agreementId ?? g.agreementNumber ?? "—";

                  return (
                    <React.Fragment key={g.key}>
                      <tr
                        className="odd:bg-white even:bg-slate-50 hover:bg-slate-100 cursor-pointer border-b border-slate-100"
                        onClick={() => toggleGroup(g.key)}
                        title="Click to expand / collapse invoices"
                      >
                        <td className={`${tdBase} font-extrabold text-slate-900`}>#{agIdDisplay}</td>

                        <td className={tdBase}>
                          <div className="truncate text-sm font-extrabold text-slate-900">{g.agreementTitle}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">Agreement #{g.agreementNumber}</div>
                        </td>

                        <td className={tdBase}>
                          <div className="text-sm font-extrabold text-slate-900">{g.customerName}</div>
                        </td>

                        <td className={`${tdBase} text-right text-sm font-extrabold text-slate-900`}>
                          {money(invoiceTotal)}
                        </td>

                        <td className={`${tdBase} text-center`}>
                          <span className="inline-flex rounded-full px-3 py-1 text-xs font-extrabold bg-amber-100 text-amber-900 border border-amber-200">
                            {g.invoices.length}
                          </span>
                        </td>

                        <td className={`${tdBase} text-center`}>
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-slate-200 bg-white text-slate-700 font-extrabold shadow-sm">
                            {open ? "▾" : "▸"}
                          </span>
                        </td>
                      </tr>

                      {open ? (
                        <tr className="bg-slate-50/60">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                              <div className="overflow-x-auto">
                                <table className="min-w-[1100px] w-full text-sm">
                                  <thead className="bg-slate-100">
                                    <tr className="border-b border-slate-200">
                                      <th className={`${thBase} text-left w-[260px]`}>Invoice</th>
                                      <th className={`${thBase} text-left w-[320px]`}>Milestone</th>
                                      <th className={`${thBase} text-left w-[220px]`}>Customer</th>
                                      <th className={`${thBase} text-right w-[160px]`}>Amount</th>
                                      <th className={`${thBase} text-left w-[160px]`}>Status</th>
                                      <th className={`${thBase} text-left w-[360px]`}>Actions</th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {g.invoices.map((item) => {
                                      const sending = !!sendingIds[item.id];
                                      const dpLoading = !!directPayIds[item.id];
                                      const dpEmailLoading = !!directPayEmailIds[item.id];

                                      const isDirectPay = isDirectPayMode(item.paymentMode);
                                      const hasDirectPayLink = Boolean(String(item.directPayCheckoutUrl || "").trim());
                                      const isDirectPaid =
                                        isPaidLike(item.status) ||
                                        String(item.status || "").toLowerCase() === "paid" ||
                                        Boolean(item.directPayPaidAt);

                                      const sendLabel = item.emailSentAt ? "Resend" : "Send";

                                      return (
                                        <tr
                                          key={item.id}
                                          className="odd:bg-white even:bg-slate-50 hover:bg-slate-100 border-b border-slate-100 last:border-b-0"
                                        >
                                          <td className={tdBase}>
                                            <button
                                              type="button"
                                              onClick={() => handleView(item.id)}
                                              className="block text-left font-extrabold text-slate-900 hover:underline"
                                              title="View invoice"
                                            >
                                              {item.invoiceNumber}
                                            </button>
                                            <div className="mt-1 text-xs text-slate-500">{prettyDate(item.isoDate)}</div>
                                          </td>

                                          <td className={tdBase}>
                                            <div className="flex items-baseline gap-2">
                                              <span className="text-xs font-extrabold text-slate-500">
                                                {item.milestoneNumber ? `#${item.milestoneNumber}` : "#—"}
                                              </span>
                                              <span className="truncate text-sm font-extrabold text-slate-900">
                                                {item.milestoneName}
                                              </span>
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
                                            <div className="mt-1 line-clamp-2 text-xs text-slate-600">
                                              {item.milestoneDescription || "—"}
                                            </div>
                                          </td>

                                          <td className={tdBase}>
                                            <div className="text-sm font-extrabold text-slate-900">{item.customerName}</div>
                                          </td>

                                          <td className={`${tdBase} text-right text-sm font-extrabold text-slate-900`}>
                                            {money(item.amount)}
                                          </td>

                                          <td className={tdBase}>
                                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-extrabold ${statusPillClasses(item.status)}`}>
                                              {statusLabel(item.status)}
                                            </span>
                                          </td>

                                          <td className={tdBase}>
                                            <div className="flex flex-wrap gap-2">
                                              <button
                                                type="button"
                                                onClick={() => handleView(item.id)}
                                                className="h-9 rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-extrabold text-white hover:bg-slate-800"
                                              >
                                                View
                                              </button>

                                              {isDirectPay ? (
                                                <>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleDirectPay(item)}
                                                    disabled={dpLoading || isDirectPaid}
                                                    className={`h-9 rounded-xl border px-4 text-sm font-extrabold ${
                                                      isDirectPaid
                                                        ? "border-slate-200 bg-slate-100 text-slate-400"
                                                        : hasDirectPayLink
                                                          ? "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                                                          : "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                                                    } disabled:opacity-60`}
                                                    title={isDirectPaid ? "Invoice is paid" : hasDirectPayLink ? "Copy pay link" : "Create pay link"}
                                                  >
                                                    {isDirectPaid ? "Paid" : dpLoading ? "Working…" : hasDirectPayLink ? "Copy Link" : "Create Link"}
                                                  </button>

                                                  <button
                                                    type="button"
                                                    onClick={() => handleDirectPayEmail(item)}
                                                    disabled={dpEmailLoading || isDirectPaid || !hasDirectPayLink}
                                                    className={`h-9 rounded-xl border px-4 text-sm font-extrabold ${
                                                      isDirectPaid || !hasDirectPayLink
                                                        ? "border-slate-200 bg-slate-100 text-slate-400"
                                                        : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                                                    } disabled:opacity-60`}
                                                    title={!hasDirectPayLink ? "Create link first" : "Email pay link to customer"}
                                                  >
                                                    {dpEmailLoading ? "Emailing…" : "Email"}
                                                  </button>
                                                </>
                                              ) : (
                                                canSend && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleSendOrResend(item)}
                                                    disabled={sending}
                                                    className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                                                  >
                                                    {sending ? "Sending…" : sendLabel}
                                                  </button>
                                                )
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
