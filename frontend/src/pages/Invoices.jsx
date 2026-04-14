import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api, {
  getContractorDrawRequests,
  releaseDrawRequest,
  resendDrawReview,
} from "../api";
import {
  buildUnifiedPaymentRecords,
  moneyStatusLabel,
  projectClassLabel,
  summarizePaymentRecords,
} from "../utils/paymentRecords";

function useQuery() {
  const { search } = useLocation();
  return React.useMemo(() => new URLSearchParams(search), [search]);
}

const money = (value) =>
  Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function prettyDate(value) {
  const date = parseDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

function toneClasses(status) {
  if (status === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "payment_pending") return "border-indigo-200 bg-indigo-50 text-indigo-800";
  if (status === "awaiting_customer_approval") return "border-slate-200 bg-slate-50 text-slate-800";
  if (status === "issues") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

async function createInvoiceForMilestone({ milestoneId, agreementId }) {
  const payloads = [
    { milestone: milestoneId, agreement: agreementId || undefined },
    { milestone_id: milestoneId, agreement_id: agreementId || undefined },
    { milestoneId: milestoneId, agreementId: agreementId || undefined },
  ];

  const endpoints = ["/projects/invoices/", "/invoices/"];
  let lastErr = null;

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      try {
        const res = await api.post(endpoint, payload);
        return res.data;
      } catch (err) {
        lastErr = err;
        const status = err?.response?.status;
        if (status === 404) break;
      }
    }
  }

  throw lastErr || new Error("Invoice creation failed");
}

async function fetchInvoicesList() {
  try {
    const res = await api.get("/projects/invoices/");
    return Array.isArray(res.data?.results) ? res.data.results : Array.isArray(res.data) ? res.data : [];
  } catch {
    const res = await api.get("/invoices/");
    return Array.isArray(res.data?.results) ? res.data.results : Array.isArray(res.data) ? res.data : [];
  }
}

export default function Invoices() {
  const query = useQuery();
  const navigate = useNavigate();
  const location = useLocation();

  const milestoneId = query.get("milestone");
  const agreementId = query.get("agreement");

  const legacyFilter = norm(query.get("filter"));
  const projectClassFilter = norm(query.get("project_class")) || "all";
  const recordTypeFilter = norm(query.get("record_type")) || "all";
  const moneyStatusFilter = norm(query.get("money_status")) || "all";

  const [invoices, setInvoices] = useState([]);
  const [drawRequests, setDrawRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [autoCreateState, setAutoCreateState] = useState({ running: false, error: "" });
  const [actionLoadingKey, setActionLoadingKey] = useState("");

  const resolvedRecordTypeFilter =
    recordTypeFilter !== "all"
      ? recordTypeFilter
      : legacyFilter === "disputed" || legacyFilter === "direct" || legacyFilter === "escrow"
        ? "invoice"
        : "all";
  const resolvedMoneyStatusFilter =
    moneyStatusFilter !== "all"
      ? moneyStatusFilter
      : legacyFilter === "disputed"
        ? "issues"
        : "all";
  const legacyModeFilter = legacyFilter === "direct" || legacyFilter === "direct_pay" || legacyFilter === "directpay"
    ? "direct"
    : legacyFilter === "escrow"
      ? "escrow"
      : "all";

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const [invoiceItems, drawData] = await Promise.all([fetchInvoicesList(), getContractorDrawRequests()]);
      setInvoices(invoiceItems);
      setDrawRequests(Array.isArray(drawData?.results) ? drawData.results : Array.isArray(drawData) ? drawData : []);
    } catch (error) {
      console.error(error);
      toast.error("Failed to load payment records.");
      setInvoices([]);
      setDrawRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    const run = async () => {
      if (!milestoneId) return;

      setAutoCreateState({ running: true, error: "" });
      try {
        const created = await createInvoiceForMilestone({ milestoneId, agreementId });
        const newId = created?.id || created?.invoice_id || created?.pk;
        if (!newId) throw new Error("Invoice created but no ID returned.");
        toast.success("Invoice created. Opening…");
        navigate(`/app/invoices/${newId}`, { replace: true });
      } catch (err) {
        console.error(err);
        const detail =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          (typeof err?.response?.data === "string" ? err.response.data : null) ||
          err?.message ||
          "Invoice could not be created.";
        setAutoCreateState({ running: false, error: detail });
        toast.error("Could not auto-create invoice. See banner for details.");
      } finally {
        setAutoCreateState((prev) => ({ ...prev, running: false }));
      }
    };

    run();
  }, [agreementId, milestoneId, navigate]);

  const allRecords = useMemo(
    () => buildUnifiedPaymentRecords({ invoices, drawRequests }),
    [invoices, drawRequests]
  );

  const filteredRecords = useMemo(() => {
    const q = norm(search);
    return allRecords.filter((record) => {
      if (resolvedRecordTypeFilter !== "all" && record.recordType !== resolvedRecordTypeFilter) return false;
      if (projectClassFilter !== "all" && record.projectClass !== projectClassFilter) return false;
      if (resolvedMoneyStatusFilter !== "all" && record.moneyStatus !== resolvedMoneyStatusFilter) return false;
      if (legacyModeFilter !== "all" && norm(record.paymentMode) !== legacyModeFilter) return false;
      if (!q) return true;
      return (
        norm(record.title).includes(q) ||
        norm(record.subtitle).includes(q) ||
        norm(record.agreementTitle).includes(q) ||
        norm(record.recordTypeLabel).includes(q) ||
        norm(record.rawStatus).includes(q)
      );
    });
  }, [
    allRecords,
    legacyModeFilter,
    projectClassFilter,
    resolvedMoneyStatusFilter,
    resolvedRecordTypeFilter,
    search,
  ]);

  const summary = useMemo(() => summarizePaymentRecords(filteredRecords), [filteredRecords]);

  const groupedRecords = useMemo(() => {
    const shape = {
      invoice: { residential: [], commercial: [] },
      draw_request: { residential: [], commercial: [] },
    };
    for (const record of filteredRecords) {
      if (!shape[record.recordType]) continue;
      shape[record.recordType][record.projectClass].push(record);
    }
    for (const type of Object.keys(shape)) {
      for (const projectClass of Object.keys(shape[type])) {
        shape[type][projectClass].sort((a, b) => {
          const aTime = parseDate(a.sortDate)?.getTime() || 0;
          const bTime = parseDate(b.sortDate)?.getTime() || 0;
          return bTime - aTime;
        });
      }
    }
    return shape;
  }, [filteredRecords]);

  const totals = useMemo(() => {
    const count = filteredRecords.length;
    const total = filteredRecords.reduce((sum, record) => sum + Number(record.amount || 0), 0);
    return { count, total };
  }, [filteredRecords]);

  const updateFilters = useCallback(
    (updates) => {
      const params = new URLSearchParams(location.search);
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === "all") params.delete(key);
        else params.set(key, value);
      });
      navigate(`${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`, { replace: true });
    },
    [location.pathname, location.search, navigate]
  );

  const openDrawOwnerView = (record) => {
    const url = String(record?.raw?.public_review_url || "").trim();
    if (!url) {
      toast.error("Owner review link is not available yet.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const resendDrawLink = async (record) => {
    if (!record?.id) return;
    setActionLoadingKey(`resend-${record.recordType}-${record.id}`);
    try {
      const response = await resendDrawReview(record.id);
      toast.success(
        response?.email_delivery?.message || response?.detail || "Review link resent successfully."
      );
      await fetchRecords();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Could not resend the owner review link.");
    } finally {
      setActionLoadingKey("");
    }
  };

  const releaseEscrowFunds = async (record) => {
    if (!record?.id) return;
    setActionLoadingKey(`release-${record.recordType}-${record.id}`);
    try {
      const response = await releaseDrawRequest(record.id);
      toast.success(response?.detail || "Escrow funds marked as released.");
      await fetchRecords();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Could not release escrow funds.");
    } finally {
      setActionLoadingKey("");
    }
  };

  const Section = ({ title, recordType, projectClass }) => {
    const rows = groupedRecords?.[recordType]?.[projectClass] || [];
    if (!rows.length) return null;
    return (
      <section
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        data-testid={`payments-section-${recordType}-${projectClass}`}
      >
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-500">
            {rows.length} record{rows.length === 1 ? "" : "s"} •{" "}
            {money(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Agreement</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => {
                const isBusy =
                  actionLoadingKey === `resend-${record.recordType}-${record.id}` ||
                  actionLoadingKey === `release-${record.recordType}-${record.id}`;
                return (
                  <tr key={`${record.recordType}-${record.id}`} className="border-b border-slate-100 align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{record.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{record.subtitle}</div>
                      <div className="mt-1 text-xs text-slate-400">Updated {prettyDate(record.sortDate)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses(record.moneyStatus)}`}>
                        {moneyStatusLabel(record.moneyStatus)}
                      </span>
                      <div className="mt-1 text-xs text-slate-500">{record.rawStatus || "—"}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{money(record.amount)}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{record.agreementTitle}</div>
                      <div className="mt-1 text-xs text-slate-500">{projectClassLabel(record.projectClass)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {record.recordType === "invoice" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => navigate(`/app/invoices/${record.id}`)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              View
                            </button>
                            {record.agreementId ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/app/agreements/${record.agreementId}`)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Agreement
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <>
                            {["submitted", "payment_pending"].includes(norm(record.raw?.workflow_status || record.raw?.status)) ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => resendDrawLink(record)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                                Resend Link
                              </button>
                            ) : null}
                            {record.raw?.is_awaiting_release && norm(record.raw?.payment_mode) === "escrow" ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => releaseEscrowFunds(record)}
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                Release Funds
                              </button>
                            ) : null}
                            {record.agreementId ? (
                              <button
                                type="button"
                                onClick={() => navigate(`/app/agreements/${record.agreementId}`)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Edit
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => openDrawOwnerView(record)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              View
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  return (
    <div className="p-4" data-testid="payments-page">
      {milestoneId ? (
        <div className="mb-4 rounded-lg border border-purple-200 bg-purple-50 p-4 text-purple-900">
          <div className="font-semibold">Invoice creation requested for Milestone #{milestoneId}</div>
          <div className="mt-1 text-sm opacity-90">
            {autoCreateState.running
              ? "Creating invoice…"
              : autoCreateState.error
                ? `Auto-create failed: ${autoCreateState.error}`
                : "If an invoice already exists, it will appear below."}
          </div>
        </div>
      ) : null}

      <div className="mb-5">
        <div className="text-2xl font-extrabold text-slate-900">Payments</div>
        <div className="mt-1 text-sm text-slate-600">
          One contractor-facing money view across invoices and draw requests, with filters to separate the underlying record types.
        </div>
        <div className="mt-2 text-sm text-slate-500">
          {loading ? "Loading payment records…" : `${totals.count} records • ${money(totals.total)} total`}
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <SummaryCard title="Awaiting Customer Approval" summary={summary.awaiting_customer_approval} />
        <SummaryCard title="Payment Pending" summary={summary.payment_pending} />
        <SummaryCard title="Paid" summary={summary.paid} />
        <SummaryCard title="Issues / Disputes" summary={summary.issues} />
      </div>

      <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by agreement, stage, record type, or status…"
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
        />
        <select
          value={projectClassFilter}
          onChange={(event) => updateFilters({ project_class: event.target.value })}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
          data-testid="payments-filter-project-class"
        >
          <option value="all">All Projects</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
        </select>
        <select
          value={resolvedRecordTypeFilter}
          onChange={(event) => updateFilters({ record_type: event.target.value, filter: null })}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
          data-testid="payments-filter-record-type"
        >
          <option value="all">All Records</option>
          <option value="invoice">Invoices</option>
          <option value="draw_request">Draw Requests</option>
        </select>
        <select
          value={resolvedMoneyStatusFilter}
          onChange={(event) => updateFilters({ money_status: event.target.value, filter: null })}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
          data-testid="payments-filter-money-status"
        >
          <option value="all">All Money Statuses</option>
          <option value="awaiting_customer_approval">Awaiting Customer Approval</option>
          <option value="payment_pending">Payment Pending</option>
          <option value="paid">Paid</option>
          <option value="issues">Issues / Disputes</option>
        </select>
        <button
          type="button"
          onClick={() => fetchRecords()}
          className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {legacyModeFilter !== "all" ? (
        <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Legacy payment-mode filter applied: showing only {legacyModeFilter === "direct" ? "Direct Pay" : "Escrow"} invoice records.
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Loading payment records…
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
          No payment records match the current filters.
        </div>
      ) : (
        <div className="space-y-5">
          <Section title="Residential Invoices" recordType="invoice" projectClass="residential" />
          <Section title="Commercial Invoices" recordType="invoice" projectClass="commercial" />
          <Section title="Residential Draw Requests" recordType="draw_request" projectClass="residential" />
          <Section title="Commercial Draw Requests" recordType="draw_request" projectClass="commercial" />
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, summary }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-extrabold text-slate-900">{summary?.count || 0}</div>
      <div className="mt-1 text-sm font-medium text-slate-600">{money(summary?.amount || 0)}</div>
    </div>
  );
}
