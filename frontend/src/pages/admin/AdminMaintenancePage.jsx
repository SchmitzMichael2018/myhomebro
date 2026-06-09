import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCcw } from "lucide-react";

import api from "../../api";

const shell = "min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_28%),linear-gradient(135deg,#020617,#082f49_52%,#020617)] p-4 text-slate-100 sm:p-6";
const panel = "rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-slate-950/30";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-sky-50 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50";

function fmtDate(value) {
  if (!value) return "Not scheduled";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    good: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
    warn: "border-amber-300/40 bg-amber-400/10 text-amber-100",
    bad: "border-rose-300/40 bg-rose-400/10 text-rose-100",
    slate: "border-slate-500/40 bg-slate-800/80 text-slate-200",
  };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tones[tone] || tones.slate}`}>{children}</span>;
}

function Metric({ label, value, sub, tone = "slate", testId }) {
  const color = tone === "bad" ? "text-rose-100" : tone === "warn" ? "text-amber-100" : tone === "good" ? "text-emerald-100" : "text-white";
  return (
    <div data-testid={testId} className="rounded-2xl border border-white/10 bg-white/10 p-4">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100/60">{label}</div>
      <div className={`mt-2 text-3xl font-black ${color}`}>{value ?? 0}</div>
      {sub ? <div className="mt-1 text-xs font-semibold text-slate-300">{sub}</div> : null}
    </div>
  );
}

function ActionLink({ href, children }) {
  if (!href) return null;
  return (
    <a href={href} className="inline-flex items-center gap-1 rounded-lg border border-sky-300/30 bg-sky-400/10 px-2.5 py-1.5 text-xs font-bold text-sky-100 hover:bg-sky-400/20">
      {children}
      <ExternalLink size={12} />
    </a>
  );
}

function QueueSection({ title, subtitle, rows = [], empty, testId, renderRow }) {
  return (
    <section data-testid={testId} className={panel}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-white">{title}</h2>
          {subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}
        </div>
        <Badge tone={rows.length ? "warn" : "good"}>{rows.length}</Badge>
      </div>
      <div className="mt-4 space-y-3">
        {rows.length ? rows.map((row) => renderRow(row)) : <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-300">{empty}</div>}
      </div>
    </section>
  );
}

function WorkOrderRow({ row, overdue = false }) {
  return (
    <article data-testid={`admin-maintenance-work-order-${row.id}`} className={`rounded-2xl border p-4 ${overdue ? "border-rose-300/35 bg-rose-400/10" : "border-slate-700 bg-slate-900/65"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-white">{row.title || "Maintenance work order"}</h3>
            <Badge tone={overdue ? "bad" : row.status === "completed" ? "good" : "warn"}>{row.status_label || row.status || "Scheduled"}</Badge>
            {overdue ? <Badge tone="bad">{row.days_overdue || 0} day(s) overdue</Badge> : null}
          </div>
          <div className="mt-2 grid gap-1 text-sm text-slate-300 md:grid-cols-2">
            <div>Property: <span className="font-semibold text-white">{row.property || "Property pending"}</span></div>
            <div>Customer: <span className="font-semibold text-white">{row.customer || row.customer_email || "Customer pending"}</span></div>
            <div>Contractor: <span className="font-semibold text-white">{row.contractor || "Contractor pending"}</span></div>
            <div>Scheduled: <span className="font-semibold text-white">{fmtDate(row.scheduled_date)}</span></div>
          </div>
          {row.description ? <p className="mt-2 text-sm leading-6 text-slate-300">{row.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionLink href={row.work_order_url}>Open work order</ActionLink>
          <ActionLink href={row.property_url}>Open property</ActionLink>
          <ActionLink href={row.agreement_url}>Open agreement</ActionLink>
          <ActionLink href={row.contractor_url}>Open contractor</ActionLink>
        </div>
      </div>
    </article>
  );
}

function ContractRow({ row }) {
  const expired = Number(row.expires_in_days) < 0;
  return (
    <article data-testid={`admin-maintenance-contract-${row.id}`} className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-white">{row.title || "Maintenance contract"}</h3>
            <Badge tone={expired ? "bad" : "warn"}>{expired ? "Expired" : row.expires_in_days === null ? "No end date" : `${row.expires_in_days} day(s)`}</Badge>
          </div>
          <div className="mt-2 text-sm text-slate-300">
            {row.customer || "Customer"} | {row.contractor || "Contractor"} | Next visit {fmtDate(row.next_occurrence_date)}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            Ends {fmtDate(row.recurrence_end_date)} | {row.recurrence_pattern || "recurrence pending"}
          </div>
        </div>
        <ActionLink href={row.agreement_url}>Review agreement</ActionLink>
      </div>
    </article>
  );
}

function PropertyAttentionRow({ row }) {
  return (
    <article data-testid={`admin-maintenance-property-${row.property_id}`} className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-black text-white">{row.property}</h3>
            <Badge tone={row.health_status === "needs_attention" ? "bad" : "warn"}>{row.health_label || row.health_status || "Review"}</Badge>
            <Badge>{row.health_score ?? 0}/100</Badge>
          </div>
          <div className="mt-2 text-sm text-slate-300">{row.customer_email} | {row.confidence || "low"} confidence</div>
          {Array.isArray(row.priority_insights) && row.priority_insights.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-100">
              {row.priority_insights.map((insight) => <li key={insight.id}>{insight.title}</li>)}
            </ul>
          ) : null}
        </div>
        <ActionLink href={row.property_url}>Open property</ActionLink>
      </div>
    </article>
  );
}

export default function AdminMaintenancePage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/projects/admin/maintenance/");
      setPayload(data || {});
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load maintenance operations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const kpis = payload?.kpis || {};
  const queues = payload?.queues || {};
  const audit = payload?.audit || {};
  const hasData = useMemo(() => Boolean(payload && !loading), [payload, loading]);

  return (
    <div className={shell} data-testid="admin-maintenance-page">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-amber-200/25 bg-slate-900/85 p-5 shadow-2xl shadow-slate-950/40 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.24em] text-amber-200">Admin Operations</div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-white">Maintenance Operations</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Track recurring contracts, upcoming service, overdue work, property intelligence, and contractor maintenance performance in one place.
              </p>
            </div>
            <button type="button" onClick={load} disabled={loading} className={button}>
              <RefreshCcw size={16} />
              Refresh
            </button>
          </div>
        </header>

        {error ? <div className="rounded-2xl border border-rose-300/40 bg-rose-400/10 p-4 text-sm font-semibold text-rose-100">{error}</div> : null}
        {loading ? <div className={panel}>Loading maintenance operations...</div> : null}

        {hasData ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="admin-maintenance-kpis">
              <Metric label="Active Contracts" value={kpis.active_contracts || 0} sub={`${kpis.inactive_contracts || 0} inactive/cancelled`} testId="admin-maintenance-kpi-active-contracts" />
              <Metric label="Expiring Soon" value={kpis.contracts_expiring_soon || 0} sub="Next 45 days" tone={Number(kpis.contracts_expiring_soon || 0) > 0 ? "warn" : "good"} testId="admin-maintenance-kpi-expiring" />
              <Metric label="Upcoming Work Orders" value={kpis.upcoming_work_orders || 0} sub={`${kpis.due_this_week || 0} due this week`} testId="admin-maintenance-kpi-upcoming" />
              <Metric label="Overdue Work Orders" value={kpis.overdue_work_orders || 0} sub={`${kpis.completed_this_month || 0} completed this month`} tone={Number(kpis.overdue_work_orders || 0) > 0 ? "bad" : "good"} testId="admin-maintenance-kpi-overdue" />
              <Metric label="Properties With Plans" value={kpis.properties_with_active_plans || 0} sub="Active maintenance coverage" tone="good" testId="admin-maintenance-kpi-properties" />
              <Metric label="Properties Needing Attention" value={kpis.properties_needing_attention || 0} sub={`${kpis.high_priority_property_items || 0} high-priority item(s)`} tone={Number(kpis.high_priority_property_items || 0) > 0 ? "warn" : "good"} testId="admin-maintenance-kpi-property-attention" />
            </section>

            <div className="grid gap-5 xl:grid-cols-2">
              <QueueSection
                title="Upcoming Work Orders"
                subtitle="Scheduled recurring service that operations can monitor before it becomes overdue."
                rows={queues.upcoming || []}
                empty="No upcoming maintenance work orders."
                testId="admin-maintenance-upcoming-queue"
                renderRow={(row) => <WorkOrderRow key={row.id} row={row} />}
              />
              <QueueSection
                title="Overdue Work Orders"
                subtitle="Past-due service visits that need follow-up."
                rows={queues.overdue || []}
                empty="No overdue maintenance work orders."
                testId="admin-maintenance-overdue-queue"
                renderRow={(row) => <WorkOrderRow key={row.id} row={row} overdue />}
              />
              <QueueSection
                title="Recently Completed"
                subtitle="Completed service visits for operational auditing."
                rows={queues.recently_completed || []}
                empty="No maintenance work orders completed this month."
                testId="admin-maintenance-completed-queue"
                renderRow={(row) => <WorkOrderRow key={row.id} row={row} />}
              />
              <QueueSection
                title="Contract Renewal Queue"
                subtitle="Expiring, expired, or unscheduled recurring contracts."
                rows={queues.renewals || []}
                empty="No maintenance contracts need renewal review."
                testId="admin-maintenance-renewal-queue"
                renderRow={(row) => <ContractRow key={row.id} row={row} />}
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <QueueSection
                title="Property Intelligence"
                subtitle="Advisory property signals from home records, service history, warranties, and maintenance data."
                rows={queues.property_attention || []}
                empty="No property intelligence items need attention."
                testId="admin-maintenance-property-intelligence"
                renderRow={(row) => <PropertyAttentionRow key={row.property_id} row={row} />}
              />
              <QueueSection
                title="Contractor Maintenance Performance"
                subtitle="Advisory completion and overdue counts for maintenance operations."
                rows={queues.contractor_performance || []}
                empty="No contractor maintenance performance data yet."
                testId="admin-maintenance-contractor-performance"
                renderRow={(row) => (
                  <article key={row.contractor_id} data-testid={`admin-maintenance-contractor-${row.contractor_id}`} className="rounded-2xl border border-slate-700 bg-slate-900/65 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-sm font-black text-white">{row.contractor || "Contractor"}</h3>
                        <div className="mt-2 text-sm text-slate-300">
                          {row.completed || 0} completed | {row.overdue || 0} overdue
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          On-time rate: {row.on_time_rate === null || row.on_time_rate === undefined ? "Not enough data" : `${row.on_time_rate}%`}
                        </div>
                      </div>
                      <ActionLink href={row.contractor_url}>Open contractor</ActionLink>
                    </div>
                  </article>
                )}
              />
            </div>

            <section className={panel} data-testid="admin-maintenance-audit">
              <h2 className="text-lg font-black text-white">Maintenance Data Inventory</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100/60">Metrics</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                    {(audit.available_metrics || []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100/60">Dates</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                    {(audit.available_dates || []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100/60">Ownership</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                    {(audit.ownership_fields || []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

