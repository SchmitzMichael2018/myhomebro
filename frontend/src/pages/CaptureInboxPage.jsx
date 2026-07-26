import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";

import { archiveCapture, processCapture, retryCapture } from "../api/captures.js";
import {
  Button,
  Card,
  EmptyState,
  FilterToolbar,
  InlineAlert,
  LoadingSkeleton,
  MetricCard,
  StatusBadge,
  WorkspacePageHeader,
} from "../components/ui";
import { useCaptures, useCaptureSummary } from "../hooks/useCaptures.js";
import {
  captureFlags,
  isCaptureInboxEnabled,
  isCaptureQrEnabled,
  isCaptureReviewEnabled,
} from "../lib/captureFlags.js";

const STATUS_OPTIONS = [
  ["", "All"],
  ["pending", "Pending"],
  ["needs_review", "Needs Review"],
  ["approved", "Approved"],
  ["applied", "Applied"],
  ["failed", "Failed"],
  ["archived", "Archived"],
];

const STATUS_LABELS = [
  ["saved", "Saved"],
  ["processing", "Processing"],
  ["ready_for_review", "Needs Review"],
  ["needs_information", "Needs Information"],
  ["possible_duplicate", "Possible Duplicate"],
  ["approved", "Approved"],
  ["applying", "Applying"],
  ["applied", "Applied"],
  ["apply_failed", "Apply Failed"],
  ["archived", "Archived"],
];

const TYPE_OPTIONS = [
  ["", "All types"],
  ["quick_lead", "Quick Lead"],
  ["quick_note", "Quick Note"],
  ["photo", "Photo"],
  ["receipt", "Receipt"],
];

const SORT_OPTIONS = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["updated", "Recently Updated"],
  ["attention", "Needs Attention"],
  ["alphabetical", "Alphabetical"],
];

function cursorFromLink(link) {
  if (!link) return "";
  try {
    return new URL(link, window.location.origin).searchParams.get("cursor") || "";
  } catch {
    return "";
  }
}

const STATUS_BADGES = {
  draft: "draft",
  saved: "draft",
  processing: "pending",
  ready_for_review: "required",
  needs_information: "required",
  possible_duplicate: "required",
  approved: "complete",
  failed: "blocked",
  apply_failed: "blocked",
  applied: "complete",
  archived: "complete",
};

export function CaptureInboxFeatureGate({
  flags = captureFlags,
  children,
  fallback = null,
}) {
  return isCaptureInboxEnabled(flags) ? children : fallback;
}

export function CaptureInboxContent() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    status: searchParams.get("status") || "",
    type: searchParams.get("type") || "",
    search: searchParams.get("search") || "",
    creator: searchParams.get("creator") || "",
    date_from: searchParams.get("date_from") || "",
    date_to: searchParams.get("date_to") || "",
    has_duplicates: searchParams.get("has_duplicates") || "",
    has_follow_up: searchParams.get("has_follow_up") || "",
    sort: searchParams.get("sort") || "newest",
    cursor: searchParams.get("cursor") || "",
  }));
  const [queryFilters, setQueryFilters] = useState(filters);
  useEffect(() => {
    const timer = window.setTimeout(() => setQueryFilters(filters), 250);
    return () => window.clearTimeout(timer);
  }, [filters]);
  useEffect(() => {
    const next = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && !(key === "sort" && value === "newest")) next.set(key, value);
    });
    setSearchParams(next, { replace: true });
  }, [filters, setSearchParams]);
  const captures = useCaptures(queryFilters);
  const metrics = useCaptureSummary();
  const reviewEnabled = isCaptureReviewEnabled();
  const [workingId, setWorkingId] = useState("");

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, cursor: "" }));
  }

  const creators = useMemo(() => {
    if (Array.isArray(metrics.summary.creators)) {
      return metrics.summary.creators.map((creator) => [String(creator.id), creator.name]);
    }
    const unique = new Map();
    captures.results.forEach((capture) => {
      if (capture.captured_by_id) {
        unique.set(String(capture.captured_by_id), capture.captured_by_name || "Team member");
      }
    });
    return [...unique.entries()];
  }, [captures.results, metrics.summary.creators]);

  async function archive(capture) {
    try {
      await archiveCapture(capture.id, {
        expected_version: capture.version,
        reason: "Archived from Capture Inbox",
      });
      toast.success("Capture archived.");
      await Promise.all([captures.reload(), metrics.reload()]);
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "Capture could not be archived.");
    }
  }

  async function primary(capture) {
    if (!["saved", "failed"].includes(capture.status)) {
      navigate(`/app/capture/${capture.id}`);
      return;
    }
    setWorkingId(capture.id);
    try {
      const action = capture.status === "failed" ? retryCapture : processCapture;
      await action(capture.id, { expected_version: capture.version });
      navigate(`/app/capture/${capture.id}`);
    } catch (requestError) {
      if (requestError?.response?.data?.capture_saved) {
        navigate(`/app/capture/${capture.id}`);
      } else {
        toast.error(requestError?.response?.data?.detail || "Capture could not be processed.");
      }
    } finally {
      setWorkingId("");
    }
  }

  function actionLabel(capture) {
    return {
      saved: "Process",
      processing: "Processing…",
      ready_for_review: "Review",
      needs_information: "Complete information",
      possible_duplicate: "Resolve duplicate",
      approved: "Apply",
      applying: "Applying…",
      applied: "View receipt",
      apply_failed: "Review failure / Retry application",
      failed: "Retry",
    }[capture.status] || "Open";
  }

  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8"
      data-testid="capture-inbox"
    >
      <WorkspacePageHeader
        theme="operational"
        title="Capture Inbox"
        subtitle="Review saved information and its current processing status."
        secondaryActions={isCaptureQrEnabled() ? (
          <Button theme="operational" variant="secondary" onClick={() => navigate("/app/capture/qr")}>
            Manage QR
          </Button>
        ) : null}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="capture-summary">
        {[
          ["Pending", metrics.summary.pending],
          ["Needs Review", metrics.summary.needs_review],
          ["Approved", metrics.summary.approved, "approved"],
          ["Applied Today", metrics.summary.applied_today, "applied"],
          ["Failed", metrics.summary.failed, "failed"],
          ["Archived", metrics.summary.archived, "archived"],
        ].map(([label, value, statusFilter]) => (
          <button
            key={label}
            type="button"
            className="min-h-11 rounded-2xl text-left focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
            aria-label={`Show ${label} Captures`}
            onClick={() => updateFilter(
              "status",
              statusFilter || (label === "Pending" ? "pending" : "needs_review")
            )}
          >
            <MetricCard
              theme="operational"
              label={label}
              value={metrics.loading ? "—" : value || 0}
            />
          </button>
        ))}
      </div>

      <FilterToolbar
        theme="operational"
        search={
          <label className="min-w-0 flex-1">
            <span className="sr-only">Search Captures</span>
            <input
              type="search"
              value={filters.search}
              onChange={(event) => updateFilter("search", event.target.value)}
              placeholder="Search Captures"
              className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
        }
        filters={
          <>
            <label>
            <span className="sr-only">Filter by status</span>
            <select
              value={filters.status}
              onChange={(event) => updateFilter("status", event.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            </label>
            <label>
            <span className="sr-only">Filter by type</span>
            <select
              value={filters.type}
              onChange={(event) => updateFilter("type", event.target.value)}
              className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              {TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            </label>
            <label>
              <span className="sr-only">Filter by creator</span>
              <select
                value={filters.creator}
                onChange={(event) => updateFilter("creator", event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-sm"
              >
                <option value="">All creators</option>
                {creators.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-bold">
              From
              <input
                type="date"
                value={filters.date_from}
                onChange={(event) => updateFilter("date_from", event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs font-bold">
              To
              <input
                type="date"
                value={filters.date_to}
                onChange={(event) => updateFilter("date_to", event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-sm"
              />
            </label>
            <label>
              <span className="sr-only">Sort Captures</span>
              <select
                value={filters.sort}
                onChange={(event) => updateFilter("sort", event.target.value)}
                className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-sm"
              >
                {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={filters.has_duplicates === "true"}
                onChange={(event) => updateFilter("has_duplicates", event.target.checked ? "true" : "")}
              />
              Has duplicates
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={filters.has_follow_up === "true"}
                onChange={(event) => updateFilter("has_follow_up", event.target.checked ? "true" : "")}
              />
              Has follow-up
            </label>
          </>
        }
      />

      {captures.loading ? (
        <LoadingSkeleton
          theme="operational"
          variant="list"
          label="Loading Capture Inbox"
        />
      ) : null}

      {!captures.loading && captures.error ? (
        <InlineAlert theme="operational" tone="danger">
          {captures.error}
        </InlineAlert>
      ) : null}

      {!captures.loading && !captures.error && !captures.results.length ? (
        <EmptyState
          theme="operational"
          title="No Captures found"
          description="Saved Captures will appear here when Capture workflows are enabled."
        />
      ) : null}

      {!captures.loading && captures.results.length ? (
        <div className="grid gap-3" aria-label="Capture results">
          {captures.results.map((capture) => (
            <Card key={capture.id} theme="operational" padding="md">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-slate-950 dark:text-slate-100">
                    {capture.source_category === "qr"
                      ? "Public QR Lead"
                      : TYPE_OPTIONS.find(([value]) => value === capture.capture_type)?.[1] ||
                        capture.capture_type}
                  </div>
                  <div className="mt-1 truncate text-sm text-slate-600 dark:text-slate-300">
                    {capture.raw_text_payload?.name ||
                      capture.raw_text_payload?.title ||
                      capture.raw_text_payload?.text ||
                      capture.raw_text_payload?.transcript ||
                      capture.artifacts?.[0]?.original_filename ||
                      "Saved Capture"}
                  </div>
                  <div className="mt-1 text-xs text-[var(--mhb-text-muted)]">
                    {new Date(capture.created_at).toLocaleString()} ·{" "}
                    {capture.captured_by_name || "Unknown creator"}
                  </div>
                  {capture.source_category === "qr" ? (
                    <div className="mt-1 text-xs font-semibold text-[var(--mhb-text-secondary)]">
                      QR · {capture.qr_asset_label || capture.source_detail}
                      {capture.attribution_metadata?.campaign
                        ? ` · ${capture.attribution_metadata.campaign}`
                        : ""}
                      {capture.artifacts?.length
                        ? ` · ${capture.artifacts.length} photo${capture.artifacts.length === 1 ? "" : "s"}`
                        : ""}
                    </div>
                  ) : null}
                </div>
                <StatusBadge
                  status={STATUS_BADGES[capture.status] || "pending"}
                  label={
                    STATUS_LABELS.find(([value]) => value === capture.status)?.[1] ||
                    capture.status
                  }
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={reviewEnabled ? "primary" : "secondary"}
                    theme="operational"
                    loading={workingId === capture.id}
                    disabled={["processing", "applying"].includes(capture.status)}
                    onClick={() =>
                      reviewEnabled
                        ? primary(capture)
                        : navigate(`/app/capture/${capture.id}`)
                    }
                  >
                    {reviewEnabled ? actionLabel(capture) : "Open"}
                  </Button>
                  {capture.status !== "archived" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      theme="operational"
                      onClick={() => archive(capture)}
                    >
                      Archive
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {!captures.loading && !captures.error && captures.count > 0 ? (
        <nav
          className="flex items-center justify-between gap-3"
          aria-label="Capture Inbox pagination"
        >
          <button
            type="button"
            disabled={!captures.previous}
            onClick={() => setFilters((current) => ({
              ...current,
              cursor: cursorFromLink(captures.previous),
            }))}
            className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold disabled:opacity-50 dark:border-slate-700"
          >
            Previous
          </button>
          <span className="text-sm text-[var(--mhb-text-secondary)]" aria-live="polite">
            {captures.count} Capture{captures.count === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            disabled={!captures.next}
            onClick={() => setFilters((current) => ({
              ...current,
              cursor: cursorFromLink(captures.next),
            }))}
            className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold disabled:opacity-50 dark:border-slate-700"
          >
            Next
          </button>
        </nav>
      ) : null}
    </div>
  );
}

export default function CaptureInboxPage() {
  return (
    <CaptureInboxFeatureGate>
      <CaptureInboxContent />
    </CaptureInboxFeatureGate>
  );
}
