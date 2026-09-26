import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Compass, MapPin, RefreshCw } from "lucide-react";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  MetricCard,
  StatusBadge,
  WorkspacePageHeader,
} from "../components/ui";
import { PaginationControls } from "../components/ui/PaginationControls.jsx";

const RELATIONSHIPS = [
  ["", "All relationships"],
  ["in_service_area", "In your service area"],
  ["expansion_opportunity", "Expansion opportunity"],
  ["readiness_needed", "Readiness needed"],
  ["outside_current_coverage", "Outside your current coverage"],
];

const SORTS = [
  ["strongest_demand", "Strongest demand signal"],
  ["newest_demand", "Newest demand"],
  ["largest_coverage_gap", "Largest coverage gap"],
  ["closest_to_readiness", "Closest to readiness"],
  ["area_name", "Area name"],
];

const READINESS_LABELS = {
  claimed_profile: "Claimed profile",
  approved_verification: "Approved verification",
  payment_ready: "Payment readiness",
  matching_trade: "Matching trade",
  matching_service_area: "Matching service area",
};

const relationshipTone = (relationship) => {
  if (relationship === "in_service_area") return "complete";
  if (relationship === "readiness_needed") return "required";
  if (relationship === "expansion_opportunity") return "recommended";
  return "draft";
};

const coverageLabel = (row) => {
  if (row.automatic_matching_available) return "Automatic matching available";
  if (row.automatic_matching_approval) {
    return "Approved market; local coverage still building";
  }
  return "Manual invitations available";
};

export default function ServiceAreaOpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);
  const query = searchParams.toString();

  const load = useCallback(async ({ signal } = {}) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await api.get(
        `/projects/contractor/service-area-opportunities/${query ? `?${query}` : ""}`,
        { signal }
      );
      if (requestId === requestIdRef.current) setPayload(response.data);
    } catch (requestError) {
      if (
        requestId === requestIdRef.current &&
        requestError?.code !== "ERR_CANCELED"
      ) {
        setError(
          requestError?.response?.data?.detail ||
            "Demand trends could not be loaded."
        );
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    load({ signal: controller.signal });
    return () => {
      requestIdRef.current += 1;
      controller.abort();
    };
  }, [load]);

  const updateFilter = (name, value, { resetPage = true } = {}) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, String(value));
    else next.delete(name);
    if (resetPage) next.delete("page");
    setSearchParams(next);
  };

  const resetFilters = () => setSearchParams({});
  const results = payload?.results || [];
  const summary = payload?.summary || {};
  const pagination = payload?.pagination || {
    page: Number(searchParams.get("page")) || 1,
    page_size: Number(searchParams.get("page_size")) || 25,
    total: 0,
  };

  return (
    <ContractorPageSurface
      variant="operational"
      contentClassName="mx-auto max-w-7xl"
    >
      <div className="space-y-6" data-testid="service-area-opportunities-page">
        <WorkspacePageHeader
          theme="operational"
          eyebrow="Demand intelligence"
          title="Service Area Opportunities"
          subtitle="See privacy-safe demand patterns across locations and trades relevant to your business."
        />

        <InlineAlert
          theme="operational"
          tone="info"
          title="Aggregate trends only"
          data-testid="service-area-opportunities-explainer"
        >
          These are privacy-safe demand trends, not individual job offers.
          Customers can invite you directly, and eligible contractors may
          receive automatic matches in approved markets.
        </InlineAlert>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            theme="operational"
            label="Current service areas"
            value={summary.current_service_area_signals ?? "-"}
            description="Demand signals"
          />
          <MetricCard
            theme="operational"
            label="Trades with demand"
            value={summary.trades_with_demand ?? "-"}
          />
          <MetricCard
            theme="operational"
            label="Expansion opportunities"
            value={summary.expansion_opportunities ?? "-"}
          />
          <MetricCard
            theme="operational"
            label="Readiness actions"
            value={summary.readiness_actions ?? "-"}
          />
          <MetricCard
            theme="operational"
            label="Authorized opportunities"
            value={summary.authorized_individual_opportunities ?? "-"}
            description="Individual requests you can access"
          />
        </div>

        <Card theme="operational" data-testid="service-area-opportunities-filters">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterInput
              label="State"
              value={searchParams.get("state") || ""}
              onChange={(value) => updateFilter("state", value.toUpperCase())}
              placeholder="TX"
            />
            <FilterInput
              label="City or ZIP"
              value={searchParams.get("city") || ""}
              onChange={(value) => updateFilter("city", value)}
              placeholder="Austin or 78701"
            />
            <FilterInput
              label="Trade"
              value={searchParams.get("trade") || ""}
              onChange={(value) => updateFilter("trade", value)}
              placeholder="Roofing"
            />
            <FilterSelect
              label="Service-area relationship"
              value={searchParams.get("relationship") || ""}
              options={RELATIONSHIPS}
              onChange={(value) => updateFilter("relationship", value)}
            />
            <FilterSelect
              label="Readiness"
              value={searchParams.get("readiness") || ""}
              options={[
                ["", "All readiness states"],
                ["ready", "Ready"],
                ["action_needed", "Action needed"],
              ]}
              onChange={(value) => updateFilter("readiness", value)}
            />
            <FilterSelect
              label="Time window"
              value={searchParams.get("time_window") || "all"}
              options={[
                ["all", "All open demand"],
                ["30d", "Last 30 days"],
                ["90d", "Last 90 days"],
                ["12m", "Last 12 months"],
              ]}
              onChange={(value) => updateFilter("time_window", value)}
            />
            <FilterSelect
              label="Sort"
              value={searchParams.get("sort") || "strongest_demand"}
              options={SORTS}
              onChange={(value) => updateFilter("sort", value)}
            />
            <div className="flex items-end">
              <Button
                theme="operational"
                variant="secondary"
                onClick={resetFilters}
                className="w-full"
                data-testid="service-area-opportunities-reset"
              >
                Reset filters
              </Button>
            </div>
          </div>
        </Card>

        {error ? (
          <InlineAlert
            theme="operational"
            tone="danger"
            title="Demand trends unavailable"
            actions={
              <Button theme="operational" variant="secondary" onClick={() => load()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            }
          >
            {error}
          </InlineAlert>
        ) : loading ? (
          <Card theme="operational">
            <LoadingSkeleton
              theme="operational"
              variant="table"
              label="Loading service area opportunities"
            />
          </Card>
        ) : results.length === 0 ? (
          <EmptyState
            theme="operational"
            icon={Compass}
            title="No privacy-safe demand signals match your current service areas and filters."
            description="Reset filters, review your service areas, or update the trades you offer."
            primaryAction={
              <Button theme="operational" onClick={resetFilters}>
                Reset filters
              </Button>
            }
            secondaryAction={
              <Link
                className="inline-flex min-h-10 items-center rounded-lg border border-[var(--mhb-border-default)] px-4 py-2 font-semibold"
                to="/app/profile"
              >
                Review service areas and trades
              </Link>
            }
          />
        ) : (
          <Card theme="operational" padding="none">
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[var(--mhb-border-divider)] text-[var(--mhb-text-muted)]">
                  <tr>
                    {[
                      "Area",
                      "Trade",
                      "Demand",
                      "Relationship",
                      "Local coverage",
                      "Contractor readiness",
                      "Next action",
                    ].map((heading) => (
                      <th key={heading} scope="col" className="px-4 py-3 font-bold">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row) => (
                    <OpportunityCells
                      key={`${row.state}-${row.city}-${row.zip}-${row.trade}`}
                      row={row}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="grid gap-3 p-3 lg:hidden"
              data-testid="service-area-opportunity-cards"
            >
              {results.map((row) => (
                <OpportunityCard
                  key={`${row.state}-${row.city}-${row.zip}-${row.trade}`}
                  row={row}
                />
              ))}
            </div>
            <PaginationControls
              page={pagination.page}
              pageSize={pagination.page_size}
              totalItems={pagination.total}
              pageSizeOptions={[25, 50, 100]}
              label="demand signals"
              testId="service-area-opportunities-pagination"
              onPageChange={(page) =>
                updateFilter("page", page, { resetPage: false })
              }
              onPageSizeChange={(pageSize) =>
                updateFilter("page_size", pageSize)
              }
            />
          </Card>
        )}

        <InlineAlert theme="operational" tone="warning">
          Customers can still find and invite contractors manually while
          MyHomeBro builds local coverage.
        </InlineAlert>
      </div>
    </ContractorPageSurface>
  );
}

function FilterInput({ label, value, onChange, placeholder }) {
  return (
    <label className="text-sm font-semibold text-[var(--mhb-text-secondary)]">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-[var(--mhb-text-primary)]"
      />
    </label>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label className="text-sm font-semibold text-[var(--mhb-text-secondary)]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-[var(--mhb-text-primary)]"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function Readiness({ readiness }) {
  const missing = Object.entries(readiness || {})
    .filter(([, ready]) => !ready)
    .map(([key]) => READINESS_LABELS[key]);
  return (
    <span>
      {missing.length ? `Needed: ${missing.join(", ")}` : "Account ready"}
    </span>
  );
}

function OpportunityCells({ row }) {
  return (
    <tr
      className="border-b border-[var(--mhb-border-divider)] last:border-0"
      data-testid="service-area-opportunity-row"
    >
      <td className="px-4 py-3 font-bold">{row.area}</td>
      <td className="px-4 py-3 capitalize">{row.trade}</td>
      <td className="px-4 py-3 font-semibold">{row.demand_signal}</td>
      <td className="px-4 py-3">
        <StatusBadge
          theme="operational"
          status={relationshipTone(row.relationship)}
          label={row.relationship_label}
        />
      </td>
      <td className="px-4 py-3">
        {coverageLabel(row)}
      </td>
      <td className="max-w-xs px-4 py-3 text-[var(--mhb-text-muted)]">
        <Readiness readiness={row.contractor_readiness} />
      </td>
      <td className="px-4 py-3">
        <Link className="font-bold underline" to={row.recommended_action.url}>
          {row.recommended_action.label}
        </Link>
      </td>
    </tr>
  );
}

function OpportunityCard({ row }) {
  return (
    <article className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-black">{row.area}</h2>
          <p className="mt-1 capitalize text-[var(--mhb-text-muted)]">
            {row.trade}
          </p>
        </div>
        <MapPin className="h-5 w-5 shrink-0" aria-hidden="true" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge
          theme="operational"
          status={relationshipTone(row.relationship)}
          label={row.relationship_label}
        />
        <strong>{row.demand_signal}</strong>
      </div>
      <dl className="mt-3 grid gap-2 text-sm">
        <div>
          <dt className="font-bold">Local coverage</dt>
          <dd className="text-[var(--mhb-text-muted)]">
            {coverageLabel(row)}
          </dd>
        </div>
        <div>
          <dt className="font-bold">Contractor readiness</dt>
          <dd className="text-[var(--mhb-text-muted)]">
            <Readiness readiness={row.contractor_readiness} />
          </dd>
        </div>
      </dl>
      <Link
        className="mt-4 inline-flex min-h-10 items-center font-bold underline"
        to={row.recommended_action.url}
      >
        {row.recommended_action.label}
      </Link>
    </article>
  );
}
