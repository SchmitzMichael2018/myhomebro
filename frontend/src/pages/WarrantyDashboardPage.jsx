import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarClock, ClipboardCheck, FileText, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../api";

const statusLabel = (value) =>
  String(value || "submitted")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

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

  const openRequests = useMemo(
    () => requests.filter((row) => !["completed", "denied", "closed", "escalated_to_resolution"].includes(row.status)),
    [requests]
  );

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

            <section className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-extrabold">Open Warranty Requests</h2>
                <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">{openRequests.length}</span>
              </div>
              <div className="mt-3 grid gap-3">
                {openRequests.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">No open warranty requests.</div>
                ) : (
                  openRequests.map((row) => (
                    <article key={row.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid={`warranty-request-${row.id}`}>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-bold">{row.title}</h3>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{statusLabel(row.status)}</span>
                            <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">{statusLabel(row.severity)}</span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-600">{row.description}</p>
                          <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
                            <span>Customer: {row.customer_name || "Customer"}</span>
                            <span>Area: {row.area_affected || "Not specified"}</span>
                            <span>Noticed: {row.date_noticed || "Not provided"}</span>
                            <span>Evidence: {row.evidence?.length || 0}</span>
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
