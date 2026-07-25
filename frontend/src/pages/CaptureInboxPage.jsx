import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { archiveCapture } from "../api/captures.js";
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
} from "../lib/captureFlags.js";

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["saved", "Saved"],
  ["ready_for_review", "Needs Review"],
  ["applied", "Applied"],
  ["archived", "Archived"],
  ["failed", "Failed"],
];

const TYPE_OPTIONS = [
  ["", "All types"],
  ["quick_lead", "Quick Lead"],
  ["quick_note", "Quick Note"],
  ["photo", "Photo"],
  ["receipt", "Receipt"],
  ["opportunity", "Opportunity"],
];

const STATUS_BADGES = {
  draft: "draft",
  saved: "draft",
  processing: "pending",
  ready_for_review: "required",
  needs_information: "required",
  possible_duplicate: "required",
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
  const [filters, setFilters] = useState({
    status: "",
    type: "",
    search: "",
    page: 1,
  });
  const captures = useCaptures(filters);
  const metrics = useCaptureSummary();

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }

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

  return (
    <div
      className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6 lg:p-8"
      data-testid="capture-inbox"
    >
      <WorkspacePageHeader
        theme="operational"
        title="Capture Inbox"
        subtitle="Review saved information and its current processing status."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="capture-summary">
        {[
          ["Pending", metrics.summary.pending],
          ["Needs Review", metrics.summary.needs_review],
          ["Applied", metrics.summary.applied],
          ["Failed", metrics.summary.failed],
          ["Archived", metrics.summary.archived],
          ["Today", metrics.summary.today],
        ].map(([label, value]) => (
          <MetricCard
            key={label}
            theme="operational"
            label={label}
            value={metrics.loading ? "—" : value || 0}
          />
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
                    {TYPE_OPTIONS.find(([value]) => value === capture.capture_type)?.[1] ||
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
                </div>
                <StatusBadge
                  status={STATUS_BADGES[capture.status] || "pending"}
                  label={
                    STATUS_OPTIONS.find(([value]) => value === capture.status)?.[1] ||
                    capture.status
                  }
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    theme="operational"
                    onClick={() => navigate(`/app/capture/${capture.id}`)}
                  >
                    Open
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
            onClick={() =>
              setFilters((current) => ({
                ...current,
                page: Math.max(1, current.page - 1),
              }))
            }
            className="min-h-10 rounded-lg border border-slate-300 px-4 text-sm font-bold disabled:opacity-50 dark:border-slate-700"
          >
            Previous
          </button>
          <span className="text-sm text-slate-600 dark:text-slate-300">
            Page {filters.page}
          </span>
          <button
            type="button"
            disabled={!captures.next}
            onClick={() =>
              setFilters((current) => ({ ...current, page: current.page + 1 }))
            }
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
