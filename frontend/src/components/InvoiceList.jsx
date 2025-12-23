import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";
import { useAuth } from "../context/AuthContext";

// InvoiceList.jsx
// v2025-12-18-send-button-failsafe
// - Show Send/Resend if user is contractor OR token exists (backend still enforces permissions)
// - View goes to /app/invoices/:id

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
    // support common names
    const t =
      localStorage.getItem("access") ||
      localStorage.getItem("access_token") ||
      localStorage.getItem("token") ||
      "";
    return Boolean(t);
  } catch {
    return false;
  }
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
  const status = inv?.status_label ?? inv?.status ?? "pending";

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
  };
}

export default function InvoiceList({ initialData = [], loadingOverride = false, onRefresh = null }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState({});
  const [sendingIds, setSendingIds] = useState({});

  const uType = useMemo(() => getUserType(user), [user]);
  const hasToken = useMemo(() => tokenPresent(), []);
  const canSend = useMemo(() => uType.includes("contractor") || hasToken, [uType, hasToken]);

  const normalized = useMemo(() => {
    const list = Array.isArray(initialData) ? initialData : [];
    return list.map(normalizeInvoice).filter((x) => x.id != null);
  }, [initialData]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((x) => {
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
  }, [normalized, query]);

  const groups = useMemo(() => {
    const map = new Map();

    for (const item of filtered) {
      const key =
        item.agreementId != null
          ? `agreement:${item.agreementId}`
          : `agreement:${item.agreementNumber}:${item.agreementTitle}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          agreementId: item.agreementId,
          agreementNumber: item.agreementNumber,
          agreementTitle: item.agreementTitle,
          homeownerName: item.homeownerName,
          totalAmount: 0,
          items: [],
        });
      }

      const g = map.get(key);
      g.items.push(item);
      g.totalAmount += item.amount;
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => {
      const aId = Number(a.agreementId);
      const bId = Number(b.agreementId);
      if (!Number.isNaN(aId) && !Number.isNaN(bId)) return bId - aId;
      return `${a.homeownerName} ${a.agreementTitle}`.localeCompare(`${b.homeownerName} ${b.agreementTitle}`);
    });

    for (const g of arr) {
      g.items.sort((a, b) => String(a.invoiceNumber).localeCompare(String(b.invoiceNumber)));
    }

    return arr;
  }, [filtered]);

  useEffect(() => {
    if (groups.length === 1) setOpenGroups((prev) => ({ ...prev, [groups[0].key]: true }));
  }, [groups]);

  function toggleGroup(key) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

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

  function handleViewMilestone(milestoneId) {
    navigate(`/milestones/${milestoneId}`);
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

  return (
    <div className="w-full p-4">
      {/* small debug line (remove later) */}
      <div className="mb-2 text-xs text-white/80">
        InvoiceList debug — userType: <b>{uType || "(empty)"}</b> • tokenPresent:{" "}
        <b>{String(hasToken)}</b> • canSend: <b>{String(canSend)}</b>
      </div>

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-2xl font-extrabold text-slate-900">Invoices</div>
          <div className="text-sm text-slate-600">
            {loadingOverride ? "Loading…" : `${filtered.length} invoice${filtered.length === 1 ? "" : "s"}`}
            {query ? " (filtered)" : ""}
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by customer, agreement, milestone, invoice…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300 md:w-[420px]"
          />
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
        <div className="space-y-3">
          {groups.map((g) => {
            const open = !!openGroups[g.key];
            return (
              <div key={g.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <div className="text-base font-extrabold text-slate-900">{g.agreementTitle}</div>
                      <div className="text-xs font-bold text-slate-500">Agreement #{g.agreementNumber}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <div>
                        <span className="font-semibold">Customer:</span> {g.homeownerName}
                      </div>
                      <div>
                        <span className="font-semibold">Total:</span> {money(g.totalAmount)}
                      </div>
                      <div>
                        <span className="font-semibold">Count:</span> {g.items.length}
                      </div>
                    </div>
                  </div>

                  <div className="text-lg font-black text-slate-500">{open ? "▾" : "▸"}</div>
                </button>

                {open && (
                  <div className="border-t border-slate-200">
                    <div className="hidden grid-cols-12 gap-3 bg-slate-50 px-4 py-2 text-xs font-extrabold text-slate-600 md:grid">
                      <div className="col-span-3">Invoice</div>
                      <div className="col-span-5">Milestone</div>
                      <div className="col-span-2">Amount</div>
                      <div className="col-span-2 text-right">Actions</div>
                    </div>

                    <div className="divide-y divide-slate-200">
                      {g.items.map((item) => {
                        const sending = !!sendingIds[item.id];
                        const sendLabel = item.emailSentAt ? "Resend" : "Send";

                        return (
                          <div key={item.id} className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-12 md:gap-3">
                            <div className="md:col-span-3">
                              <div className="font-extrabold text-slate-900">{item.invoiceNumber}</div>
                              <div className="mt-1 text-xs text-slate-600">For Homeowner: {item.homeownerName}</div>
                              <div className="mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold">
                                <span className={`rounded-full px-3 py-1 ${statusPillClasses(item.status)}`}>
                                  {statusLabel(item.status)}
                                </span>
                              </div>
                            </div>

                            <div className="min-w-0 md:col-span-5">
                              <div className="flex items-baseline gap-2">
                                <span className="text-xs font-extrabold text-slate-500">
                                  {item.milestoneId != null ? `#${item.milestoneId}` : "#—"}
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
                                    View milestone
                                  </button>
                                )}
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs text-slate-600">
                                {item.milestoneDescription || "—"}
                              </div>
                            </div>

                            <div className="md:col-span-2">
                              <div className="text-sm font-extrabold text-slate-900">{money(item.amount)}</div>
                            </div>

                            <div className="flex items-center gap-2 md:col-span-2 md:justify-end">
                              <button
                                type="button"
                                onClick={() => handleView(item.id)}
                                className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-800 hover:bg-slate-50"
                              >
                                View
                              </button>

                              {/* ✅ Send/Resend visible if canSend */}
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
                          </div>
                        );
                      })}
                    </div>

                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
