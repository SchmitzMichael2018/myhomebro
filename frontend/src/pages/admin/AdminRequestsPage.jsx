import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api";

const views = [
  ["active", "Active"], ["needs_review", "Needs Review"], ["customer_pending", "Customer Pending"],
  ["contractor_pending", "Contractor Pending"], ["ready_to_route", "Ready to Route"],
  ["routed", "Routed"], ["converted", "Converted / Closed"], ["test_spam", "Test / Spam"], ["archived", "Archived"],
];
const actions = [
  ["mark_real", "Mark Real"], ["mark_test", "Mark Test"], ["mark_suspicious", "Mark Suspicious"],
  ["mark_spam_fraud", "Mark Spam/Fraud"], ["archive", "Archive"], ["restore", "Restore"],
];
const inputClass = "mhb-admin-control min-h-10";

function label(value) {
  return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function compactDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function Trust({ row }) {
  if (row.classification === "test") return <span title="Administrative classification: Test">Test</span>;
  if (row.classification === "spam_fraud") return <span title="Administrative classification: Spam/Fraud">Spam/Fraud</span>;
  if (row.trust === "suspicious" || row.classification === "suspicious") return <span title="Requires administrative review">Suspicious</span>;
  if (row.verification === "verified") return <span title="Email and mobile verified">✓ Verified</span>;
  if (row.verification === "legacy_unverified") return <span title="Verification was not historically established">Legacy</span>;
  if (["pending_email", "pending_phone"].includes(row.verification)) return <span title="Account verification is incomplete">Pending</span>;
  return <span title="No linked account verification evidence">Unknown</span>;
}

function DetailPanel({ detail, onClose }) {
  if (!detail) return null;
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70" role="dialog" aria-modal="true" aria-label={`Request ${detail.reference}`}>
    <div className="h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-slate-950 p-6 text-sky-50 shadow-2xl">
      <button type="button" onClick={onClose} className="float-right rounded-lg border border-white/15 px-3 py-2">Close</button>
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-200/70">{detail.reference}</p>
      <h2 className="mt-2 text-2xl font-black">{detail.title}</h2>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Info title="Customer" value={`${detail.customer?.name || "Unknown"}\n${detail.customer?.email || ""}\n${detail.customer?.phone || ""}`} />
        <Info title="Location" value={[detail.location?.city, detail.location?.state, detail.location?.zip].filter(Boolean).join(", ") || "Not provided"} />
        <Info title="Workflow" value={`${label(detail.workflow_status)} · ${label(detail.routing_status)}`} />
        <Info title="Trust" value={`${label(detail.verification)} · ${label(detail.trust)} · ${label(detail.classification)}`} />
      </div>
      <Info title="Request" value={detail.description || "No description supplied."} wide />
      <Info title="Analysis" value={detail.analysis || "No analysis available."} wide />
      <h3 className="mt-7 font-bold">Classification history</h3>
      <div className="mt-3 space-y-2">
        {(detail.classification_events || []).length ? detail.classification_events.map((event, index) => <div key={`${event.at}-${index}`} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
          <strong>{label(event.from)} → {label(event.to)}</strong><div className="text-sky-100/65">{event.actor || "System"} · {compactDate(event.at)}</div>{event.reason ? <p>{event.reason}</p> : null}
        </div>) : <p className="text-sm text-sky-100/60">No administrative classification changes recorded.</p>}
      </div>
    </div>
  </div>;
}

function Info({ title, value, wide = false }) {
  return <div className={`${wide ? "mt-4" : ""} rounded-xl border border-white/10 bg-white/5 p-4`}><div className="text-xs font-bold uppercase tracking-wide text-sky-200/60">{title}</div><div className="mt-2 whitespace-pre-line text-sm">{value}</div></div>;
}

export default function AdminRequestsPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState({ results: [], summary: {}, pagination: {}, permissions: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);
  const [action, setAction] = useState("mark_test");
  const [detail, setDetail] = useState(null);
  const query = params.toString();

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const response = await api.get(`/projects/admin/requests/${query ? `?${query}` : ""}`); setData(response.data); }
    catch (requestError) { setError(requestError?.response?.data?.detail || "Requests could not be loaded."); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected([]); }, [query]);

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setParams(next);
  };
  const allSelected = data.results.length > 0 && data.results.every((row) => selected.includes(row.id));
  const togglePage = () => setSelected(allSelected ? [] : data.results.map((row) => row.id));
  const summaryCards = useMemo(() => [
    ["active", "Active"], ["needs_review", "Needs Review"], ["ready_to_route", "Ready to Route"],
    ["routed", "Routed"], ["test_spam", "Test / Spam"], ["archived", "Archived"],
  ], []);

  const runBulk = async () => {
    if (!selected.length) return;
    const highImpact = ["mark_spam_fraud", "archive"].includes(action);
    if (!window.confirm(`${label(action)} for ${selected.length} selected request${selected.length === 1 ? "" : "s"}?${highImpact ? " These records will leave the active queue." : ""}`)) return;
    try {
      await api.post("/projects/admin/requests/bulk-action/", { action, ids: selected, confirmed: highImpact });
      await load();
    } catch (requestError) { setError(requestError?.response?.data?.detail || "The bulk action could not be completed."); }
  };
  const openDetail = async (id) => {
    try { const response = await api.get(`/projects/admin/requests/${id}/`); setDetail(response.data); }
    catch { setError("Request details could not be loaded."); }
  };

  return <main className="min-h-screen bg-slate-950 px-4 py-6 text-sky-50 sm:px-6" data-testid="admin-requests-page">
    <div className="mx-auto max-w-[1600px]">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-sky-200/60">Admin Console</p>
      <h1 className="mt-2 text-3xl font-black">Request Management</h1>
      <p className="mt-2 max-w-3xl text-sm text-sky-100/65">Triage active requests and safely classify known test or abusive records without deleting history.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map(([key, title]) => <button key={key} type="button" onClick={() => update("view", key)} className="mhb-admin-panel rounded-xl p-4 text-left" data-testid={`request-summary-${key}`}><div className="text-xs font-bold uppercase text-sky-200/60">{title}</div><div className="mt-1 text-2xl font-black">{data.summary?.[key] || 0}</div></button>)}
      </div>

      <div className="mt-5 flex gap-2 overflow-x-auto pb-2" aria-label="Request views">
        {views.map(([key, title]) => <button key={key} type="button" onClick={() => update("view", key)} className={`whitespace-nowrap rounded-full border px-3 py-2 text-xs font-bold ${(params.get("view") || "active") === key ? "border-sky-300 bg-sky-300/20" : "border-white/15 bg-white/5"}`}>{title}</button>)}
      </div>

      <section className="mhb-admin-panel mt-3 rounded-2xl p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <input className={`${inputClass} xl:col-span-2`} aria-label="Search requests" placeholder="Search requests, customers, location…" value={params.get("q") || ""} onChange={(event) => update("q", event.target.value)} />
          <select className={inputClass} aria-label="Workflow status" value={params.get("status") || ""} onChange={(event) => update("status", event.target.value)}><option value="">All workflow states</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="analyzed">Analyzed</option><option value="converted">Converted</option></select>
          <select className={inputClass} aria-label="Classification" value={params.get("classification") || ""} onChange={(event) => update("classification", event.target.value)}><option value="">All classifications</option><option value="real">Real</option><option value="test">Test</option><option value="suspicious">Suspicious</option><option value="spam_fraud">Spam/Fraud</option><option value="archived">Archived</option></select>
          <input className={inputClass} aria-label="Service" placeholder="Service" value={params.get("service") || ""} onChange={(event) => update("service", event.target.value)} />
          <input className={inputClass} aria-label="City" placeholder="City" value={params.get("city") || ""} onChange={(event) => update("city", event.target.value)} />
          <input className={inputClass} aria-label="State" placeholder="State" value={params.get("state") || ""} onChange={(event) => update("state", event.target.value)} />
          <select className={inputClass} aria-label="Routing" value={params.get("routing") || ""} onChange={(event) => update("routing", event.target.value)}><option value="">All routing</option><option value="not_routed">Not routed</option><option value="routed">Routed</option></select>
          <select className={inputClass} aria-label="Verification" value={params.get("verification") || ""} onChange={(event) => update("verification", event.target.value)}><option value="">All verification</option><option value="verified">Verified</option><option value="legacy_unverified">Legacy</option><option value="pending_email">Pending email</option><option value="pending_phone">Pending mobile</option><option value="disabled">Disabled</option></select>
          <input type="date" className={inputClass} aria-label="Submitted from" value={params.get("date_from") || ""} onChange={(event) => update("date_from", event.target.value)} />
          <input type="date" className={inputClass} aria-label="Submitted to" value={params.get("date_to") || ""} onChange={(event) => update("date_to", event.target.value)} />
          <select className={inputClass} aria-label="Sort" value={params.get("sort") || "submitted_desc"} onChange={(event) => update("sort", event.target.value)}><option value="submitted_desc">Newest submitted</option><option value="submitted_asc">Oldest submitted</option><option value="updated_desc">Recently updated</option><option value="customer_asc">Customer A–Z</option><option value="location_asc">Location</option><option value="service_asc">Service</option><option value="status_asc">Workflow status</option></select>
        </div>
      </section>

      {data.permissions?.can_classify ? <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <span className="text-sm font-semibold">{selected.length} selected on this page</span><select className={inputClass} value={action} onChange={(event) => setAction(event.target.value)}>{actions.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select><button type="button" disabled={!selected.length} onClick={runBulk} className="rounded-lg bg-sky-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-40">Apply</button>
      </div> : null}
      {error ? <div className="mt-4 rounded-xl border border-rose-300/30 bg-rose-400/10 p-4 text-rose-100" role="alert">{error}</div> : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
        {loading ? <div className="p-10 text-center">Loading requests…</div> : data.results.length ? <>
          <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-white/[0.06] text-xs uppercase text-sky-100/60"><tr><th className="p-3"><input type="checkbox" aria-label="Select current page" checked={allSelected} onChange={togglePage} /></th>{["Request", "Customer", "Location", "Service", "Source", "Trust", "Workflow", "Submitted", "Actions"].map((head) => <th key={head} className="p-3">{head}</th>)}</tr></thead><tbody>{data.results.map((row) => <tr key={row.id} className="border-t border-white/10 hover:bg-white/[0.04]"><td className="p-3"><input type="checkbox" aria-label={`Select ${row.reference}`} checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></td><td className="max-w-xs p-3"><button type="button" onClick={() => openDetail(row.id)} className="text-left font-bold text-sky-100 hover:underline">{row.title}</button><div className="text-xs text-sky-100/50">{row.reference}</div></td><td className="p-3">{row.customer.name || "Unknown"}<div className="text-xs text-sky-100/50">{row.customer.email}</div></td><td className="p-3">{[row.location.city, row.location.state].filter(Boolean).join(", ") || "—"}</td><td className="p-3">{row.service}</td><td className="p-3">{row.source.label}</td><td className="p-3"><Trust row={row} /></td><td className="p-3">{label(row.workflow_status)}<div className="text-xs text-sky-100/50">{label(row.routing_status)}</div></td><td className="p-3">{compactDate(row.submitted_at)}</td><td className="p-3"><button type="button" onClick={() => openDetail(row.id)} className="rounded-lg border border-white/15 px-3 py-2">View</button></td></tr>)}</tbody></table></div>
          <div className="divide-y divide-white/10 lg:hidden">{data.results.map((row) => <article key={row.id} className="p-4"><div className="flex gap-3"><input type="checkbox" aria-label={`Select ${row.reference}`} checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /><button type="button" className="text-left" onClick={() => openDetail(row.id)}><strong>{row.title}</strong><div className="text-xs text-sky-100/55">{row.reference} · {row.customer.name || "Unknown"}</div></button></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>{row.service}</span><span>{row.source.label}</span><span><Trust row={row} /></span><span>{label(row.workflow_status)}</span></div></article>)}</div>
        </> : <div className="p-12 text-center"><h2 className="text-lg font-bold">No requests match this view</h2><p className="mt-2 text-sm text-sky-100/60">Adjust the filters or choose another workflow view.</p></div>}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span>Page {data.pagination?.page || 1} of {data.pagination?.total_pages || 1} · {data.pagination?.total || 0} matching requests</span><div className="flex items-center gap-2"><select className={inputClass} aria-label="Rows per page" value={params.get("page_size") || "25"} onChange={(event) => update("page_size", event.target.value)}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select><button type="button" disabled={!data.pagination?.has_previous} onClick={() => update("page", String((data.pagination?.page || 1) - 1))} className="rounded-lg border border-white/15 px-3 py-2 disabled:opacity-40">Previous</button><button type="button" disabled={!data.pagination?.has_next} onClick={() => update("page", String((data.pagination?.page || 1) + 1))} className="rounded-lg border border-white/15 px-3 py-2 disabled:opacity-40">Next</button></div></div>
    </div>
    <DetailPanel detail={detail} onClose={() => setDetail(null)} />
  </main>;
}
