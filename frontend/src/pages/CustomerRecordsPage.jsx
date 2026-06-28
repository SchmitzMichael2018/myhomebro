import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { customerHubTabs } from "../components/dashboard/hubTabsConfig.js";

const FILTERS = [
  { key: "", label: "All" },
  { key: "request", label: "Requests" },
  { key: "opportunity", label: "Opportunities" },
  { key: "agreement", label: "Agreements" },
  { key: "payment", label: "Payments" },
  { key: "communication", label: "Communication" },
  { key: "attention", label: "Needs Attention" },
];

const SUMMARY_CARDS = [
  { key: "", summaryKey: "all", label: "All Records" },
  { key: "request", summaryKey: "requests", label: "Active Requests" },
  { key: "opportunity", summaryKey: "opportunities", label: "Opportunities" },
  { key: "agreement", summaryKey: "agreements", label: "Agreements" },
  { key: "payment", summaryKey: "payments", label: "Payments" },
  { key: "attention", summaryKey: "needs_attention", label: "Needs Attention" },
];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatMoney(value) {
  if (value == null || value === "") return "";
  const number = Number(value || 0);
  if (Number.isNaN(number)) return "";
  return number.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function titleCase(value) {
  const text = String(value || "").replaceAll("_", " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "-";
}

function statusClass(status) {
  const key = String(status || "").toLowerCase();
  if (["paid", "completed", "closed", "converted", "signed", "released"].includes(key)) {
    return "border-emerald-300/35 bg-emerald-400/12 text-emerald-100";
  }
  if (["sent", "submitted", "pending", "approved", "new", "draft", "routed"].includes(key)) {
    return "border-sky-300/35 bg-sky-400/12 text-sky-100";
  }
  if (["disputed", "changes_requested", "follow_up", "pending_customer_response"].includes(key)) {
    return "border-amber-300/35 bg-amber-400/12 text-amber-100";
  }
  if (["cancelled", "canceled", "rejected", "declined", "void"].includes(key)) {
    return "border-rose-300/35 bg-rose-400/12 text-rose-100";
  }
  return "border-white/15 bg-white/8 text-sky-100/75";
}

function typeClass(type) {
  const key = String(type || "").toLowerCase();
  if (key === "request") return "border-sky-300/35 bg-sky-400/12 text-sky-100";
  if (key === "opportunity") return "border-indigo-300/35 bg-indigo-400/12 text-indigo-100";
  if (key === "agreement") return "border-emerald-300/35 bg-emerald-400/12 text-emerald-100";
  if (key === "payment") return "border-amber-300/35 bg-amber-400/12 text-amber-100";
  return "border-white/15 bg-white/8 text-sky-100/75";
}

function buildParams({ activeFilter, search, page }) {
  const params = { page, page_size: 20 };
  if (activeFilter === "attention") params.needs_attention = "true";
  else if (activeFilter) params.type = activeFilter;
  if (search.trim()) params.search = search.trim();
  return params;
}

export default function CustomerRecordsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [activeFilter, setActiveFilter] = useState(query.get("type") || (query.get("needs_attention") ? "attention" : ""));
  const [search, setSearch] = useState(query.get("search") || "");
  const [page, setPage] = useState(Number(query.get("page") || 1));
  const [payload, setPayload] = useState({ results: [], count: 0, summary: {}, facets: {}, next: null, previous: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const nextFilter = query.get("type") || (query.get("needs_attention") ? "attention" : "");
    setActiveFilter(nextFilter);
    setSearch(query.get("search") || "");
    setPage(Number(query.get("page") || 1));
  }, [query]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const { data } = await api.get("/projects/customers/records/", {
          params: buildParams({ activeFilter, search, page }),
        });
        if (!alive) return;
        setPayload({
          results: Array.isArray(data?.results) ? data.results : [],
          count: Number(data?.count || 0),
          summary: data?.summary || {},
          facets: data?.facets || {},
          next: data?.next ?? null,
          previous: data?.previous ?? null,
        });
      } catch (err) {
        if (!alive) return;
        setLoadError("Customer records could not be loaded.");
        toast.error("Customer records could not be loaded.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [activeFilter, search, page, reloadKey]);

  const setFilter = (key) => {
    const params = new URLSearchParams();
    if (key === "attention") params.set("needs_attention", "true");
    else if (key) params.set("type", key);
    if (search.trim()) params.set("search", search.trim());
    navigate(`/app/customers/records${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    const params = new URLSearchParams();
    if (activeFilter === "attention") params.set("needs_attention", "true");
    else if (activeFilter) params.set("type", activeFilter);
    if (search.trim()) params.set("search", search.trim());
    navigate(`/app/customers/records${params.toString() ? `?${params.toString()}` : ""}`);
  };

  const goToPage = (nextPage) => {
    const params = new URLSearchParams(location.search);
    params.set("page", String(nextPage));
    navigate(`/app/customers/records?${params.toString()}`);
  };

  return (
    <ContractorPageSurface
      eyebrow="Customers"
      title="Customer Records"
      subtitle="A chronological CRM feed of customer requests, opportunities, agreements, payments, and communication."
      variant="operational"
      actions={
        <button
          type="button"
          onClick={() => setReloadKey((current) => current + 1)}
          className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/16 bg-slate-900/70 px-4 py-2.5 text-sm font-semibold text-sky-100 hover:border-sky-300/35 hover:bg-sky-500/15"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      }
    >
      <HubTabs tabs={customerHubTabs} />

      {loadError ? (
        <div className="rounded-2xl border border-amber-300/35 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="customer-records-summary">
        {SUMMARY_CARDS.map((card) => {
          const selected = activeFilter === card.key || (!activeFilter && !card.key);
          return (
            <button
              key={card.summaryKey}
              type="button"
              onClick={() => setFilter(card.key)}
              data-testid={`customer-records-summary-${card.summaryKey}`}
              className={`rounded-2xl border p-4 text-left shadow-sm transition ${
                selected
                  ? "border-sky-300/45 bg-sky-400/15 text-white"
                  : "border-white/12 bg-slate-950/45 text-sky-100/75 hover:border-sky-300/35 hover:bg-sky-500/10"
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">{card.label}</div>
              <div className="mt-2 text-2xl font-bold tabular-nums">{payload.summary?.[card.summaryKey] ?? 0}</div>
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2" data-testid="customer-records-filter-chips">
            {FILTERS.map((filter) => {
              const selected = activeFilter === filter.key || (!activeFilter && !filter.key);
              return (
                <button
                  key={filter.label}
                  type="button"
                  onClick={() => setFilter(filter.key)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    selected
                      ? "border-white/70 bg-white text-slate-950"
                      : "border-white/12 bg-slate-950/35 text-sky-100/70 hover:border-sky-300/35 hover:text-white"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2 lg:max-w-md">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search records</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-100/45" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer, email, project, request..."
                className="min-h-[42px] w-full rounded-xl border border-white/15 bg-slate-950/55 pl-9 pr-3 text-sm font-semibold text-sky-50 outline-none placeholder:text-sky-100/40 focus:border-sky-300/60"
              />
            </label>
            <button type="submit" className="rounded-xl border border-white/70 bg-white px-4 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50">
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-3" data-testid="customer-records-feed">
        {loading ? (
          <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-6 text-sky-100/70">Loading customer records...</div>
        ) : payload.results.length === 0 ? (
          <div data-testid="customer-records-empty" className="rounded-2xl border border-dashed border-white/15 bg-slate-950/35 p-8 text-center">
            <h2 className="text-lg font-semibold text-white">No records match this view</h2>
            <p className="mt-2 text-sm text-sky-100/65">Clear filters or search for another customer, project, request, or agreement.</p>
          </div>
        ) : (
          payload.results.map((record) => (
            <article key={record.id} data-testid={`customer-record-${record.id}`} className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${typeClass(record.type)}`}>{titleCase(record.type)}</span>
                    {record.status ? <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusClass(record.status)}`}>{titleCase(record.status)}</span> : null}
                    {record.needs_attention ? <span className="rounded-full border border-amber-300/35 bg-amber-400/12 px-2.5 py-1 text-xs font-semibold text-amber-100">Needs attention</span> : null}
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-white">{record.title || "Customer record"}</h2>
                  {record.description ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-sky-100/65">{record.description}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-sky-100/60">
                    <span>{formatDate(record.timestamp)}</span>
                    <Link to={`/app/customers/${record.customer_id}`} className="font-semibold text-sky-100 hover:text-white">
                      {record.customer_name || "Customer"}
                    </Link>
                    {record.customer_email ? <span>{record.customer_email}</span> : null}
                    <span className="capitalize">{String(record.source || "").replaceAll("_", " ")}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-end">
                  {record.amount ? <div className="text-base font-bold text-white">{formatMoney(record.amount)}</div> : null}
                  <Link to={record.url || `/app/customers/${record.customer_id}`} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50">
                    {record.primary_action_label || "Open record"}
                    <ArrowRight size={15} />
                  </Link>
                  <Link to={`/app/customers/${record.customer_id}`} className="text-sm font-semibold text-sky-100/75 hover:text-white">
                    Customer workspace
                  </Link>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-white/12 bg-slate-950/45 px-4 py-3 text-sm text-sky-100/70 sm:flex-row sm:items-center sm:justify-between">
        <div>
          Showing {payload.results.length ? (page - 1) * 20 + 1 : 0}-{Math.min(page * 20, payload.count)} of {payload.count}
        </div>
        <div className="flex items-center gap-2" data-testid="customer-records-pagination">
          <button
            type="button"
            onClick={() => goToPage(page - 1)}
            disabled={!payload.previous || loading}
            className="rounded-xl border border-white/16 bg-slate-900/70 px-3 py-1.5 font-semibold text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <span>Page {page}</span>
          <button
            type="button"
            onClick={() => goToPage(page + 1)}
            disabled={!payload.next || loading}
            className="rounded-xl border border-white/16 bg-slate-900/70 px-3 py-1.5 font-semibold text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </ContractorPageSurface>
  );
}
