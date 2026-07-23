import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, RefreshCw, Search } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { customerHubTabs } from "../components/dashboard/hubTabsConfig.js";
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
} from "../components/ui";

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

function statusSemantic(status) {
  const key = String(status || "").toLowerCase();
  if (["paid", "completed", "closed", "converted", "signed", "released"].includes(key)) {
    return "complete";
  }
  if (["sent", "submitted", "pending", "approved", "new", "draft", "routed"].includes(key)) {
    return key === "draft" ? "draft" : "pending";
  }
  if (["disputed", "changes_requested", "follow_up", "pending_customer_response"].includes(key)) {
    return "recommended";
  }
  if (["cancelled", "canceled", "rejected", "declined", "void"].includes(key)) {
    return "blocked";
  }
  return "draft";
}

function typeSemantic(type) {
  const key = String(type || "").toLowerCase();
  if (key === "opportunity") return "recommended";
  if (key === "agreement") return "complete";
  if (key === "request" || key === "payment") return "pending";
  return "draft";
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
        <Button
          theme="operational"
          variant="secondary"
          icon={RefreshCw}
          onClick={() => setReloadKey((current) => current + 1)}
        >
          Refresh
        </Button>
      }
    >
      <HubTabs tabs={customerHubTabs} />

      {loadError ? (
        <InlineAlert theme="operational" tone="warning" title="Customer records could not be loaded">{loadError}</InlineAlert>
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
              className={`rounded-2xl border p-4 text-left shadow-[var(--mhb-shadow-card)] transition ${
                selected
                  ? "border-[var(--mhb-border-selected)] bg-[var(--mhb-surface-selected)] text-[var(--mhb-text-primary)]"
                  : "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] text-[var(--mhb-text-secondary)] hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-surface-interactive-hover)]"
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">{card.label}</div>
              <div className="mt-2 text-2xl font-bold tabular-nums">{payload.summary?.[card.summaryKey] ?? 0}</div>
            </button>
          );
        })}
      </div>

      <Card theme="operational" padding="sm">
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
                      ? "border-[var(--mhb-border-selected)] bg-[var(--mhb-surface-selected)] text-[var(--mhb-text-primary)]"
                      : "border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] text-[var(--mhb-text-secondary)] hover:border-[var(--mhb-border-strong)] hover:text-[var(--mhb-text-primary)]"
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
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mhb-text-muted)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search customer, email, project, request..."
                className="min-h-[42px] w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] pl-9 pr-3 text-sm font-semibold text-[var(--mhb-text-primary)] outline-none placeholder:text-[var(--mhb-text-muted)] focus:border-[var(--mhb-border-focus)] focus:ring-2 focus:ring-[var(--mhb-border-focus)]/25"
              />
            </label>
            <Button type="submit" theme="operational">Search</Button>
          </form>
        </div>
      </Card>

      <section className="space-y-3" data-testid="customer-records-feed">
        {loading ? (
          <Card theme="operational"><LoadingSkeleton theme="operational" variant="list" label="Loading customer records" /></Card>
        ) : payload.results.length === 0 ? (
          <EmptyState
            theme="operational"
            data-testid="customer-records-empty"
            title="No records match this view"
            description="Clear filters or search for another customer, project, request, or agreement."
          />
        ) : (
          payload.results.map((record) => (
            <Card as="article" theme="operational" padding="sm" key={record.id} data-testid={`customer-record-${record.id}`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge theme="operational" status={typeSemantic(record.type)} label={titleCase(record.type)} />
                    {record.status ? <StatusBadge theme="operational" status={statusSemantic(record.status)} label={titleCase(record.status)} /> : null}
                    {record.needs_attention ? <StatusBadge theme="operational" status="required" label="Needs attention" /> : null}
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-[var(--mhb-text-primary)]">{record.title || "Customer record"}</h2>
                  {record.description ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--mhb-text-muted)]">{record.description}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--mhb-text-muted)]">
                    <span>{formatDate(record.timestamp)}</span>
                    <Link to={`/app/customers/${record.customer_id}`} className="font-semibold text-[var(--mhb-text-link)] hover:underline">
                      {record.customer_name || "Customer"}
                    </Link>
                    {record.customer_email ? <span>{record.customer_email}</span> : null}
                    <span className="capitalize">{String(record.source || "").replaceAll("_", " ")}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-end">
                  {record.amount ? <div className="text-base font-bold text-[var(--mhb-text-primary)]">{formatMoney(record.amount)}</div> : null}
                  <Button as={Link} theme="operational" to={record.url || `/app/customers/${record.customer_id}`} icon={ArrowRight} iconPosition="end">
                    {record.primary_action_label || "Open record"}
                  </Button>
                  <Link to={`/app/customers/${record.customer_id}`} className="text-sm font-semibold text-[var(--mhb-text-link)] hover:underline">
                    Customer workspace
                  </Link>
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      <Card theme="operational" padding="sm" className="flex flex-col gap-3 text-sm text-[var(--mhb-text-muted)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          Showing {payload.results.length ? (page - 1) * 20 + 1 : 0}-{Math.min(page * 20, payload.count)} of {payload.count}
        </div>
        <div className="flex items-center gap-2" data-testid="customer-records-pagination">
          <Button
            theme="operational"
            variant="secondary"
            size="sm"
            onClick={() => goToPage(page - 1)}
            disabled={!payload.previous || loading}
          >
            Prev
          </Button>
          <span>Page {page}</span>
          <Button
            theme="operational"
            variant="secondary"
            size="sm"
            onClick={() => goToPage(page + 1)}
            disabled={!payload.next || loading}
          >
            Next
          </Button>
        </div>
      </Card>
    </ContractorPageSurface>
  );
}
