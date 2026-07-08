import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, ClipboardCheck, FileText, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../api";

const statusLabel = (value) =>
  String(value || "submitted")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

function daysBetween(start, end) {
  if (!start || !end) return 0;
  try {
    const left = start instanceof Date ? start : new Date(start);
    const right = end instanceof Date ? end : new Date(end);
    if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return 0;
    return Math.max(Math.floor((right.getTime() - left.getTime()) / 86400000), 0);
  } catch {
    return 0;
  }
}

const metricTone = {
  active_warranties: "border-emerald-200 bg-emerald-50 text-emerald-900",
  open_warranty_requests: "border-sky-200 bg-sky-50 text-sky-900",
  repairs_scheduled: "border-indigo-200 bg-indigo-50 text-indigo-900",
  expiring_soon: "border-amber-200 bg-amber-50 text-amber-900",
};

function MetricCard({ label, value, id, icon: Icon }) {
  return (
    <div className={`rounded-lg border p-4 ${metricTone[id] || "border-slate-200 bg-white text-slate-900"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-[0.16em] opacity-70">{label}</div>
        <Icon className="h-5 w-5 opacity-75" />
      </div>
      <div className="mt-3 text-3xl font-extrabold">{value ?? 0}</div>
    </div>
  );
}

export default function WarrantyDashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [filters, setFilters] = useState({
    status: "",
    warrantyType: "",
    expiringSoon: false,
    overdue: false,
    assigned: "",
    search: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/projects/warranty/dashboard/");
      setData(res.data || {});
    } catch (err) {
      setError(err?.response?.data?.detail || "Unable to load warranties.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const metrics = data?.metrics || {};
  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const warranties = Array.isArray(data?.warranties) ? data.warranties : [];

  const warrantyById = useMemo(() => {
    const map = new Map();
    warranties.forEach((row) => map.set(String(row.id), row));
    return map;
  }, [warranties]);

  const openRequests = useMemo(
    () => requests.filter((row) => !["completed", "denied", "closed", "escalated_to_resolution"].includes(row.status)),
    [requests]
  );

  const filteredRequests = useMemo(() => {
    const today = new Date();
    return openRequests.filter((row) => {
      const warranty = warrantyById.get(String(row.warranty)) || {};
      const workOrder = row.work_order || {};
      const text = `${row.title || ""} ${row.customer_name || ""} ${row.agreement_title || ""} ${row.area_affected || ""}`.toLowerCase();
      const daysSince = daysBetween(row.created_at, today);
      const expirationDays = warranty.end_date ? daysBetween(today, warranty.end_date) : null;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.warrantyType && warranty.applies_to !== filters.warrantyType) return false;
      if (filters.expiringSoon && !(expirationDays !== null && expirationDays >= 0 && expirationDays <= 30)) return false;
      if (filters.overdue && !(row.response_due_at && new Date(row.response_due_at) < today) && !(daysSince > 2 && ["submitted", "under_review"].includes(row.status))) return false;
      if (filters.assigned && String(workOrder.assigned_user || "") !== String(filters.assigned)) return false;
      if (filters.search && !text.includes(filters.search.toLowerCase())) return false;
      return true;
    });
  }, [filters, openRequests, warrantyById]);

  const buckets = useMemo(() => {
    const today = new Date();
    const isOverdue = (row) => {
      const daysSince = daysBetween(row.created_at, today);
      return (row.response_due_at && new Date(row.response_due_at) < today) || (daysSince > 2 && ["submitted", "under_review"].includes(row.status));
    };
    return [
      { key: "needs_response", title: "Needs Response", rows: filteredRequests.filter((row) => ["submitted", "under_review", "follow_up_needed"].includes(row.status)) },
      { key: "scheduled_repairs", title: "Scheduled Repairs", rows: filteredRequests.filter((row) => ["inspection_scheduled", "repair_scheduled", "repair_in_progress"].includes(row.status)) },
      { key: "waiting_customer", title: "Waiting on Customer", rows: filteredRequests.filter((row) => ["more_information_requested", "waiting_on_customer", "acknowledgment_requested"].includes(row.status)) },
      { key: "overdue", title: "Overdue", rows: filteredRequests.filter(isOverdue) },
      { key: "recent_completed", title: "Recently Completed", rows: requests.filter((row) => ["completed", "closed"].includes(row.status)).slice(0, 8) },
    ];
  }, [filteredRequests, requests]);

  const statusOptions = useMemo(() => Array.from(new Set(requests.map((row) => row.status).filter(Boolean))).sort(), [requests]);
  const warrantyTypes = useMemo(() => Array.from(new Set(warranties.map((row) => row.applies_to).filter(Boolean))).sort(), [warranties]);
  const assignedOptions = useMemo(() => {
    const map = new Map();
    requests.forEach((row) => {
      const userId = row.work_order?.assigned_user;
      if (userId) map.set(String(userId), row.work_order?.assigned_team_notes || `User #${userId}`);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [requests]);

  async function runAction(row, action, payload = {}) {
    setBusyId(`${row.id}:${action}`);
    try {
      if (action === "ai") {
        await api.post(`/projects/warranty-requests/${row.id}/ai-review/`);
      } else if (action === "work-order") {
        await api.post(`/projects/warranty-requests/${row.id}/work-order/`, {
          title: row.title,
          scope: row.description,
          ...payload,
        });
      } else if (action === "status") {
        await api.post(`/projects/warranty-requests/${row.id}/status/`, payload);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-6 lg:px-8" data-testid="warranty-dashboard">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Operations</div>
            <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Warranties</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Track active coverage, customer warranty requests, advisory reviews, and repair work orders after project completion.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {error ? (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>
        ) : null}

        {loading ? (
          <div className="mt-8 rounded-lg border border-slate-200 bg-white p-8 text-sm font-semibold text-slate-600">Loading warranties...</div>
        ) : (
          <>
            <section className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard id="active_warranties" label="Active Warranties" value={metrics.active_warranties} icon={ShieldCheck} />
              <MetricCard id="open_warranty_requests" label="Open Requests" value={metrics.open_warranty_requests} icon={AlertCircle} />
              <MetricCard id="repairs_scheduled" label="Repairs Scheduled" value={metrics.repairs_scheduled} icon={CalendarClock} />
              <MetricCard id="expiring_soon" label="Expiring Soon" value={metrics.expiring_soon} icon={ClipboardCheck} />
            </section>

            <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 h-5 w-5 text-emerald-600" />
                <div>
                  <h2 className="text-base font-bold">Warranty Assistant Summary</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    {data?.assistant_summary || "No warranty activity needs attention right now."}
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="warranty-dashboard-filters">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                  placeholder="Search customer, project, issue"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">All statuses</option>
                  {statusOptions.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                </select>
                <select value={filters.warrantyType} onChange={(event) => setFilters((prev) => ({ ...prev, warrantyType: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">All warranty types</option>
                  {warrantyTypes.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
                </select>
                <select value={filters.assigned} onChange={(event) => setFilters((prev) => ({ ...prev, assigned: event.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">All technicians</option>
                  {assignedOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">
                  <input type="checkbox" checked={filters.expiringSoon} onChange={(event) => setFilters((prev) => ({ ...prev, expiringSoon: event.target.checked }))} />
                  Expiring soon
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold">
                  <input type="checkbox" checked={filters.overdue} onChange={(event) => setFilters((prev) => ({ ...prev, overdue: event.target.checked }))} />
                  Overdue
                </label>
              </div>
            </section>

            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold">Warranty Workload</h2>
                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">{filteredRequests.length}</span>
              </div>
              <div className="mt-3 grid gap-4 xl:grid-cols-2">
                {filteredRequests.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No open warranty requests.</div>
                ) : (
                  buckets.map((bucket) => (
                    <div key={bucket.key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid={`warranty-bucket-${bucket.key}`}>
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-extrabold">{bucket.title}</h3>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{bucket.rows.length}</span>
                      </div>
                      <div className="mt-3 space-y-3">
                        {bucket.rows.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-500">Nothing here right now.</div>
                        ) : bucket.rows.map((row) => (
                    <article key={`${bucket.key}-${row.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid={`warranty-request-${row.id}`}>
                      <div className="flex flex-col gap-4 lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold">{row.title}</h3>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{statusLabel(row.status)}</span>
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">{statusLabel(row.severity)}</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{row.description}</p>
                          <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                            <span>Customer: {row.customer_name || "Customer"}</span>
                            <span>Project: {row.agreement_title || "Project"}</span>
                            <span>Area: {row.area_affected || "Not specified"}</span>
                            <span>Submitted: {daysBetween(row.created_at, new Date())} day(s) ago</span>
                            <span>Noticed: {row.date_noticed || "Not provided"}</span>
                            <span>Evidence: {row.evidence?.length || 0}</span>
                          </div>
                          <div className="mt-2 text-xs font-semibold text-slate-500">
                            Next action: {row.next_expected_action || "Review warranty request."}
                            {row.work_order?.scheduled_for ? ` Scheduled: ${new Date(row.work_order.scheduled_for).toLocaleString()}` : ""}
                          </div>
                          {row.ai_review?.summary ? (
                            <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm text-sky-900">
                              <div className="font-bold">Advisory review</div>
                              <p className="mt-1">{row.ai_review.summary}</p>
                              <p className="mt-1 text-xs font-semibold">Recommendation only: {row.ai_review.recommended_next_step}</p>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50" onClick={() => runAction(row, "ai")} disabled={busyId === `${row.id}:ai`}>
                            Review
                          </button>
                          <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800" onClick={() => runAction(row, "work-order")} disabled={busyId === `${row.id}:work-order`}>
                            Create Work Order
                          </button>
                          <button className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50" onClick={() => runAction(row, "status", { status: "completed", note: "Warranty work completed." })} disabled={busyId === `${row.id}:status`}>
                            Complete
                          </button>
                        </div>
                      </div>
                    </article>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-xl font-extrabold">Active Warranty Records</h2>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {warranties.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No warranty records have been generated yet.</div>
                ) : (
                  warranties.map((row) => (
                    <article key={row.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid={`warranty-record-${row.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold">{row.title}</h3>
                          <p className="mt-1 text-sm text-slate-600">{row.customer_name || "Customer"} - {row.agreement_title || `Agreement #${row.agreement}`}</p>
                        </div>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">{statusLabel(row.status)}</span>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">{row.coverage_details || row.covered_work || "Coverage details not recorded."}</p>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-slate-500">
                        <span>{row.start_date || "-"} to {row.end_date || "-"}</span>
                        <span>{row.open_request_count || 0} open request(s)</span>
                      </div>
                      <div className="mt-4 flex gap-2">
                        <Link to={`/app/agreements/${row.agreement}`} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                          <FileText className="h-4 w-4" />
                          Agreement
                        </Link>
                        <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                          <Wrench className="h-4 w-4" />
                          Warranty Work
                        </span>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
