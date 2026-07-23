import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  ClipboardList,
  DollarSign,
  Edit,
  FileSignature,
  FileText,
  FolderOpen,
  Home,
  MessageSquare,
  Plus,
  Receipt,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import {
  Button,
  EmptyState as SharedEmptyState,
  InlineAlert,
  LoadingSkeleton,
  MetricCard,
  StatusBadge,
} from "../components/ui";

const TABS = [
  "Overview",
  "Timeline",
  "Requests & Opportunities",
  "Projects & Agreements",
  "Payments",
  "Properties",
  "Documents",
  "Communication",
];

const OVERVIEW_TIMELINE_PREVIEW_LIMIT = 5;

// Full workspace tabs intentionally render the complete payload returned by
// the workspace endpoint in Phase 1A. Add pagination/filter controls before
// increasing backend workspace limits or exposing larger customer histories.

const COMMUNICATION_TYPE_OPTIONS = [
  ["all", "All communication"],
  ["internal_note", "Internal notes"],
  ["phone_call", "Phone calls"],
  ["email", "Email"],
  ["sms", "SMS"],
  ["in_person", "In-person"],
  ["other", "Other"],
];

const LOG_TYPE_OPTIONS = COMMUNICATION_TYPE_OPTIONS.filter(([value]) => value !== "all");
const DIRECTION_OPTIONS = [
  ["internal", "Internal"],
  ["inbound", "Inbound"],
  ["outbound", "Outbound"],
];

const PROJECT_STATUS_FILTERS = [
  ["all", "All"],
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["signed", "Signed"],
  ["active", "Active"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["archived", "Archived"],
];

const ACTIVE_PROJECT_STATUSES = new Set(["active", "signed", "funded", "in_progress", "sent"]);

function safeText(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatDate(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value, fallback = "-") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function dateTimeInputValue(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function toApiDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function money(value) {
  const number = Number(value || 0);
  return number.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function statusSemantic(status) {
  const key = String(status || "").toLowerCase();
  if (["active", "paid", "signed", "converted", "completed"].includes(key)) {
    return "complete";
  }
  if (["prospect", "submitted", "pending", "sent", "draft", "open", "new"].includes(key)) {
    return key === "draft" ? "draft" : "pending";
  }
  if (["overdue", "unpaid"].includes(key)) {
    return "required";
  }
  if (["disputed", "cancelled", "rejected", "declined"].includes(key)) {
    return "blocked";
  }
  return "draft";
}

function formatAddress(contact = {}) {
  const address = contact.address || {};
  const cityState = [address.city, address.state].filter(Boolean).join(", ");
  return [address.street_address, address.address_line_2, `${cityState} ${address.zip_code || ""}`.trim()]
    .filter(Boolean)
    .join(", ");
}

function EmptyState({ title, children, actionLabel, actionNote, icon: Icon = FolderOpen }) {
  return (
    <SharedEmptyState
      theme="operational"
      title={title}
      description={children}
      icon={Icon}
      secondaryAction={actionLabel ? <Button theme="operational" variant="secondary" disabled>{actionLabel}</Button> : null}
      tips={actionNote ? [actionNote] : []}
    />
  );
}

function SummaryCard({ label, value, sublabel, icon: Icon }) {
  return <MetricCard theme="operational" label={label} value={value} description={sublabel} icon={Icon} data-testid={`customer-workspace-summary-${label.toLowerCase().replaceAll(" ", "-")}`} />;
}

function PreviewList({ rows, emptyTitle, emptyText, renderRow, testId, actionLabel, actionNote, icon }) {
  if (!rows.length) {
    return (
      <div data-testid={testId}>
        <EmptyState title={emptyTitle} actionLabel={actionLabel} actionNote={actionNote} icon={icon}>
          {emptyText}
        </EmptyState>
      </div>
    );
  }
  return (
    <div data-testid={testId} className="grid gap-3">
      {rows.map(renderRow)}
    </div>
  );
}

function RowCard({ title, subtitle, meta, status, amount, url }) {
  const content = (
    <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 transition hover:border-sky-300/35 hover:bg-sky-500/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-semibold text-white">{safeText(title, "Untitled")}</div>
          {subtitle ? <div className="mt-1 line-clamp-2 text-sm leading-6 text-sky-100/65">{subtitle}</div> : null}
          {meta ? <div className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/45">{meta}</div> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {amount != null ? <span className="text-sm font-bold text-white">{money(amount)}</span> : null}
          {status ? <StatusBadge theme="operational" status={statusSemantic(status)} label={String(status).replaceAll("_", " ")} /> : null}
          {url ? <ArrowRight size={16} className="text-sky-100/55" /> : null}
        </div>
      </div>
    </div>
  );
  return url ? (
    <Link key={`${title}-${url}`} to={url} className="block">
      {content}
    </Link>
  ) : (
    <div key={`${title}-${meta}`}>{content}</div>
  );
}

function normalizeStatus(value) {
  const key = String(value || "").toLowerCase();
  return key === "canceled" ? "cancelled" : key;
}

function projectRecordType(row = {}) {
  return row.record_kind || row.type || (row.agreement_id ? "project" : "agreement");
}

function projectRecordKey(row = {}) {
  return `${projectRecordType(row)}-${row.id}`;
}

function projectActionLabel(row = {}) {
  if (row.action_label) return row.action_label;
  if (projectRecordType(row) === "project") return row.action_url || row.url ? "Open Project" : "No linked record";
  return normalizeStatus(row.status) === "draft" ? "Continue Draft" : "Open Agreement";
}

function ProjectAgreementCard({ row, selectionMode, selected, onToggle }) {
  const key = projectRecordKey(row);
  const status = normalizeStatus(row.status);
  const meta = [projectRecordType(row), row.project_type].filter(Boolean).join(" | ");
  const actionUrl = row.action_url || row.url || "";
  const label = projectActionLabel(row);
  const management = row.management || {};
  const canArchive = Boolean(management.can_archive);
  const canDelete = Boolean(management.can_delete);
  const blocker = (canArchive && !canDelete)
    ? "Archive instead"
    : (management.delete_blockers || management.archive_blockers || [])[0];

  return (
    <div className={`rounded-2xl border p-4 transition ${selected ? "border-sky-300/55 bg-sky-400/12" : "border-white/12 bg-slate-950/45"}`} data-testid={`project-agreement-card-${key}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          {selectionMode ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(row)}
              aria-label={`Select ${row.title || "project record"}`}
              className="mt-1 h-4 w-4 shrink-0 accent-sky-400"
            />
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold text-white">{safeText(row.title, "Untitled")}</div>
              {row.is_archived ? <span className="rounded-full border border-white/15 bg-white/8 px-2 py-0.5 text-xs font-semibold text-sky-100/65">Archived</span> : null}
            </div>
            {row.description ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-sky-100/65">{row.description}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/45">
              {meta ? <span>{meta}</span> : null}
              {row.updated_at ? <span>Updated {formatDate(row.updated_at)}</span> : null}
            </div>
            {selectionMode && blocker ? <p className="mt-2 text-xs font-semibold text-amber-100/80">{blocker}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
          {row.total != null ? <span className="text-sm font-bold text-white">{money(row.total)}</span> : null}
          {row.status ? <StatusBadge theme="operational" status={statusSemantic(row.status)} label={status.replaceAll("_", " ")} /> : null}
          {actionUrl ? (
            <Link to={actionUrl} className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15">
              {label} <ArrowRight size={14} />
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title={row.action_disabled_reason || "No destination is available for this record."}
              className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-white/12 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-sky-100/45"
            >
              No linked record
            </button>
          )}
        </div>
      </div>
      {!actionUrl && row.action_disabled_reason ? <p className="mt-3 text-xs text-sky-100/50">{row.action_disabled_reason}</p> : null}
    </div>
  );
}

function ProjectActionDialog({ action, summary, saving, results, onCancel, onConfirm }) {
  if (!action) return null;
  const isDelete = action === "delete";
  return (
    <div className="rounded-2xl border border-amber-200/35 bg-amber-400/10 p-4" data-testid={`project-${action}-confirmation`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="font-semibold text-white">
            {isDelete
              ? "Delete selected draft records? This can only be done for drafts with no signatures, payments, invoices, escrow, approvals, or completed work."
              : "Archive selected records? They will be hidden from active views but remain in customer history."}
          </h3>
          <div className="mt-3 grid gap-2 text-sm text-sky-100/70 sm:grid-cols-4">
            <span>Selected: <strong className="text-white">{summary.selected}</strong></span>
            <span>Deletable: <strong className="text-white">{summary.deletable}</strong></span>
            <span>Archive-only: <strong className="text-white">{summary.archiveOnly}</strong></span>
            <span>Blocked: <strong className="text-white">{summary.blocked}</strong></span>
          </div>
          {results?.length ? (
            <div className="mt-3 space-y-1 text-sm">
              {results.map((result) => (
                <p key={`${result.type}-${result.id}-${result.action}`} className={result.ok ? "text-emerald-100" : "text-amber-100"}>
                  {result.message || (result.ok ? "Updated." : "Blocked.")}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
          <button type="button" onClick={onCancel} disabled={saving} className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/15 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={saving || !summary.selected} className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60">
            {isDelete ? <Trash2 size={15} /> : <Archive size={15} />}
            {saving ? "Working..." : isDelete ? "Delete safe drafts" : "Archive selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectAgreementsManager({
  rows,
  totalRows,
  filter,
  onFilterChange,
  search,
  onSearchChange,
  selectionMode,
  onSelectionModeChange,
  selectedKeys,
  onToggleSelected,
  onClearSelection,
  onOpenDialog,
  actionDialog,
  actionSummary,
  actionSaving,
  actionResults,
  onCancelDialog,
  onConfirmAction,
}) {
  if (!totalRows) {
    return (
      <div data-testid="customer-workspace-projects">
        <EmptyState title="No projects or agreements yet">Created agreements and linked projects for this customer will appear here.</EmptyState>
      </div>
    );
  }

  return (
    <section className="space-y-4" data-testid="customer-workspace-projects">
      <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Projects & Agreements</h2>
            <p className="mt-1 text-sm text-sky-100/60">Filter old drafts, cancelled work, and archived records without losing customer history.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block min-w-0 sm:w-72">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sky-100/45" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search title, type, status, amount..."
                className="min-h-[40px] w-full rounded-xl border border-white/12 bg-slate-950/50 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/45"
                data-testid="project-agreement-search"
              />
            </label>
            <button
              type="button"
              onClick={() => onSelectionModeChange(!selectionMode)}
              className={`inline-flex min-h-[40px] items-center justify-center rounded-xl border px-3 py-2 text-sm font-semibold ${selectionMode ? "border-sky-300/50 bg-sky-400/15 text-white" : "border-white/15 bg-slate-950/40 text-sky-100 hover:border-sky-300/35"}`}
            >
              {selectionMode ? "Exit selection" : "Select records"}
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" data-testid="project-agreement-filters">
          {PROJECT_STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${filter === value ? "border-sky-300/50 bg-sky-400/15 text-white" : "border-white/12 bg-slate-950/35 text-sky-100/65 hover:border-sky-300/35 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {selectionMode ? (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/12 bg-slate-950/40 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="project-selection-toolbar">
            <div className="text-sm text-sky-100/70">
              <strong className="text-white">{actionSummary.selected}</strong> selected.
              <span className="ml-2">Deletable {actionSummary.deletable}</span>
              <span className="ml-2">Archive-only {actionSummary.archiveOnly}</span>
              <span className="ml-2">Blocked {actionSummary.blocked}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={onClearSelection} className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-white/15 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35">
                Clear
              </button>
              <button type="button" onClick={() => onOpenDialog("archive")} disabled={!actionSummary.selected} className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 disabled:cursor-not-allowed disabled:opacity-50">
                <Archive size={15} /> Archive selected
              </button>
              <button type="button" onClick={() => onOpenDialog("delete")} disabled={!actionSummary.selected} className="inline-flex min-h-[38px] items-center justify-center gap-2 rounded-xl border border-rose-200/35 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-50">
                <Trash2 size={15} /> Delete selected drafts only
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <ProjectActionDialog action={actionDialog} summary={actionSummary} saving={actionSaving} results={actionResults} onCancel={onCancelDialog} onConfirm={onConfirmAction} />

      {rows.length ? (
        <div className="grid gap-3">
          {rows.map((row) => (
            <ProjectAgreementCard key={projectRecordKey(row)} row={row} selectionMode={selectionMode} selected={selectedKeys.has(projectRecordKey(row))} onToggle={onToggleSelected} />
          ))}
        </div>
      ) : (
        <EmptyState title="No records match these filters">Try another status or search term. Archived records only appear when the Archived filter is selected.</EmptyState>
      )}
    </section>
  );
}

function sourceKind(value) {
  const key = String(value || "").toLowerCase();
  if (["internal_note", "phone_call", "email", "sms", "in_person", "other"].includes(key) || key.includes("communication")) return "communication";
  if (key.includes("opportunity") || key.includes("lead") || key.includes("intake")) return "opportunity";
  if (key.includes("request")) return "request";
  if (key.includes("agreement")) return "agreement";
  if (key.includes("invoice")) return "invoice";
  if (key.includes("payment")) return "payment";
  if (key.includes("project")) return "project";
  if (key.includes("document")) return "document";
  return "source";
}

function timelineMeta(event = {}) {
  const kind = sourceKind(event.source === "communication_log" ? event.type : event.source || event.type);
  const communicationLabels = {
    internal_note: "Internal note",
    phone_call: "Phone call",
    email: "Email",
    sms: "SMS",
    in_person: "In-person meeting",
    other: "Communication",
  };
  const config = {
    communication: { label: communicationLabels[event.type] || "Communication", cta: "Open communication", icon: MessageSquare },
    opportunity: { label: "Opportunity", cta: "Open opportunity", icon: ClipboardList },
    request: { label: "Request", cta: "Open request", icon: MessageSquare },
    agreement: { label: "Agreement", cta: "Open agreement", icon: FileSignature },
    invoice: { label: "Invoice", cta: "Open invoice", icon: Receipt },
    payment: { label: "Payment", cta: "Open payment", icon: DollarSign },
    project: { label: "Project", cta: "Open project", icon: FileText },
    document: { label: "Document", cta: "Open document", icon: FolderOpen },
    source: { label: safeText(event.type, "Activity"), cta: "Open item", icon: Clock },
  };
  return config[kind] || config.source;
}

function isActionableStatus(status, values) {
  return values.includes(String(status || "").toLowerCase());
}

function pickFirstActionable(rows = [], statuses = []) {
  return rows.find((row) => isActionableStatus(row.status, statuses) && row.url) || rows.find((row) => row.url) || rows[0] || null;
}

function customerScopedUrl(url, customerId) {
  if (!url) return "";
  return `${url}${url.includes("?") ? "&" : "?"}customerId=${customerId}`;
}

function getCustomerNextAction({ related = {}, stats = {}, customerId }) {
  const now = new Date();
  const dueCommunication = (related.communication || []).find((row) => {
    if (!row.follow_up_at) return false;
    const due = new Date(row.follow_up_at);
    return !Number.isNaN(due.getTime()) && due <= now;
  });
  if (dueCommunication) {
    return {
      tone: "amber",
      title: "Follow up with this customer",
      why: "A logged communication has a due or overdue follow-up reminder.",
      related: dueCommunication.subject || dueCommunication.communication_type_label || "Customer communication",
      ctaLabel: "Open communication",
      ctaUrl: "#communication",
      icon: MessageSquare,
      tab: "Communication",
    };
  }

  const requests = [...(related.customer_requests || []), ...(related.project_intakes || [])];
  const request = pickFirstActionable(requests, ["new", "submitted", "pending", "open"]);
  if (request) {
    return {
      tone: "sky",
      title: "Respond to this request",
      why: "A customer-facing request is waiting for contractor review or follow-up.",
      related: request.title || request.description,
      ctaLabel: "Open request",
      ctaUrl: request.url,
      secondaryLabel: "Create estimate",
      secondaryUrl: customerScopedUrl("/app/intake/new", customerId),
      icon: MessageSquare,
    };
  }

  const opportunity = pickFirstActionable([...(related.leads || []), ...(related.opportunities || [])], ["new", "open", "submitted", "prospect", "follow_up"]);
  if (opportunity) {
    return {
      tone: "sky",
      title: "Follow up on this opportunity",
      why: "There is an active lead or opportunity that has not moved into work yet.",
      related: opportunity.title || opportunity.description,
      ctaLabel: "Open opportunity",
      ctaUrl: opportunity.url,
      secondaryLabel: "New agreement",
      secondaryUrl: customerScopedUrl("/app/agreements/new/wizard", customerId),
      icon: ClipboardList,
    };
  }

  const agreement = pickFirstActionable(related.agreements || [], ["sent", "pending", "awaiting_signature", "signature_requested", "draft"]);
  if (agreement) {
    const draft = String(agreement.status || "").toLowerCase() === "draft";
    return {
      tone: "amber",
      title: draft ? "Finish the draft agreement" : "Agreement needs signature",
      why: draft ? "A draft agreement is started but not ready for the customer yet." : "The agreement is not fully signed, so the work may be blocked.",
      related: agreement.title || agreement.description,
      ctaLabel: "Open agreement",
      ctaUrl: agreement.url,
      icon: FileSignature,
    };
  }

  const payment = pickFirstActionable(related.payments || [], ["sent", "unpaid", "overdue", "pending", "payment_pending"]);
  if (payment) {
    return {
      tone: "amber",
      title: "Check the open invoice",
      why: "There is invoice or payment activity that may need collection or confirmation.",
      related: payment.title || payment.invoice_number,
      ctaLabel: sourceKind(payment.type || payment.source || "invoice") === "payment" ? "Open payment" : "Open invoice",
      ctaUrl: payment.url,
      icon: Receipt,
    };
  }

  const completedWork = [...(related.agreements || []), ...(related.projects || [])].find((row) => isActionableStatus(row.status, ["completed", "closed", "paid"]));
  if (completedWork) {
    return {
      tone: "emerald",
      title: "Ask for a review",
      why: "Completed work is a good moment to request a review for your public profile.",
      related: completedWork.title || completedWork.description,
      ctaLabel: "Open work",
      ctaUrl: completedWork.url,
      icon: CheckCircle2,
    };
  }

  const lastActivity = stats.last_activity ? new Date(stats.last_activity) : null;
  if (lastActivity && !Number.isNaN(lastActivity.getTime())) {
    const days = Math.floor((Date.now() - lastActivity.getTime()) / 86400000);
    if (days >= 30) {
      return {
        tone: "slate",
        title: "Reconnect with this customer",
        why: `No customer activity has been recorded in ${days} days.`,
        related: "Recent contact is useful before work goes stale.",
        ctaLabel: "Log communication",
        comingSoon: true,
        icon: MessageSquare,
      };
    }
  }

  return {
    tone: "emerald",
    title: "Customer is caught up",
    why: "No urgent requests, agreements, or payments need attention from this workspace.",
    related: "Keep an eye on new activity or start the next piece of work when the customer is ready.",
    ctaLabel: "New agreement",
    ctaUrl: customerScopedUrl("/app/agreements/new/wizard", customerId),
    icon: CheckCircle2,
  };
}

function CustomerNextActionCard({ action, onSelectTab }) {
  const Icon = action.icon || AlertCircle;
  const toneClass =
    action.tone === "amber"
      ? "border-amber-200/35 bg-amber-400/10"
      : action.tone === "emerald"
      ? "border-emerald-200/35 bg-emerald-400/10"
      : action.tone === "slate"
      ? "border-white/12 bg-slate-950/45"
      : "border-sky-200/35 bg-sky-400/10";

  return (
    <section className={`rounded-2xl border p-5 ${toneClass}`} data-testid="customer-next-action-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100/60">
            <Icon size={17} className="text-sky-100/75" />
            Next action
          </div>
          <h2 className="mt-2 text-xl font-bold text-white">{action.title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-sky-100/70">{action.why}</p>
          {action.related ? <p className="mt-2 text-sm font-semibold text-sky-50">{action.related}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {action.tab ? (
            <button
              type="button"
              onClick={() => onSelectTab?.(action.tab)}
              className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50"
            >
              {action.ctaLabel} <ArrowRight size={15} />
            </button>
          ) : action.ctaUrl && !action.comingSoon ? (
            <Link to={action.ctaUrl} className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50">
              {action.ctaLabel} <ArrowRight size={15} />
            </Link>
          ) : (
            <button type="button" disabled className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-white/12 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-sky-100/55">
              {action.ctaLabel} coming soon
            </button>
          )}
          {action.secondaryUrl ? (
            <Link to={action.secondaryUrl} className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-950/45 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15">
              {action.secondaryLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Timeline({ events }) {
  if (!events.length) {
    return <EmptyState title="No timeline yet">Customer activity will appear here as leads, requests, agreements, invoices, and notes are created.</EmptyState>;
  }
  return (
    <div data-testid="customer-workspace-timeline" className="relative space-y-3">
      {events.map((event) => {
        const meta = timelineMeta(event);
        const Icon = meta.icon;
        return (
          <div key={`${event.source}-${event.source_id}-${event.type}-${event.timestamp}`} className="rounded-2xl border border-white/12 bg-slate-950/45 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/30 bg-sky-400/10 px-2.5 py-1 text-xs font-semibold text-sky-100">
                    <Icon size={13} />
                    {meta.label}
                  </span>
                  {event.status ? <StatusBadge theme="operational" status={statusSemantic(event.status)} label={String(event.status).replaceAll("_", " ")} /> : null}
                </div>
                <div className="mt-2 font-semibold text-white">{safeText(event.title, "Customer activity")}</div>
                {event.description ? <p className="mt-1 text-sm leading-6 text-sky-100/65">{event.description}</p> : null}
                {event.amount != null ? <div className="mt-2 text-sm font-bold text-white">{money(event.amount)}</div> : null}
              </div>
              <div className="text-sm text-sky-100/55">{formatDateTime(event.timestamp)}</div>
            </div>
            {event.url ? (
              <Link to={event.url} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-sky-100 hover:text-white">
                {meta.cta} <ArrowRight size={14} />
              </Link>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function CustomerWorkspacePage() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState("Overview");
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [communicationFilter, setCommunicationFilter] = useState("all");
  const [showCommunicationForm, setShowCommunicationForm] = useState(false);
  const [savingCommunication, setSavingCommunication] = useState(false);
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSelectionMode, setProjectSelectionMode] = useState(false);
  const [selectedProjectRecords, setSelectedProjectRecords] = useState(new Set());
  const [projectActionDialog, setProjectActionDialog] = useState(null);
  const [projectActionSaving, setProjectActionSaving] = useState(false);
  const [projectActionResults, setProjectActionResults] = useState([]);
  const [communicationForm, setCommunicationForm] = useState({
    communication_type: "internal_note",
    direction: "internal",
    subject: "",
    body: "",
    occurred_at: dateTimeInputValue(new Date()),
    follow_up_at: "",
  });

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`/projects/homeowners/${id}/workspace/`);
        if (!alive) return;
        setWorkspace(data);
      } catch (err) {
        if (!alive) return;
        const msg = err?.response?.status === 404 ? "Customer not found." : "Failed to load customer workspace.";
        setError(msg);
        toast.error(msg);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, [id]);

  const contact = workspace?.contact || {};
  const stats = workspace?.stats || {};
  const related = workspace?.related || {};
  const requestOpportunityRows = useMemo(
    () => [
      ...(related.customer_requests || []),
      ...(related.project_intakes || []),
      ...(related.leads || []),
      ...(related.opportunities || []),
    ],
    [related]
  );
  const projectAgreementRows = useMemo(
    () => [...(related.agreements || []), ...(related.projects || [])],
    [related]
  );
  const filteredProjectAgreementRows = useMemo(() => {
    const searchTerm = projectSearch.trim().toLowerCase();
    return projectAgreementRows.filter((row) => {
      const status = normalizeStatus(row.status);
      if (projectStatusFilter === "archived") {
        if (!row.is_archived) return false;
      } else if (row.is_archived) {
        return false;
      } else if (projectStatusFilter === "active") {
        if (!ACTIVE_PROJECT_STATUSES.has(status)) return false;
      } else if (projectStatusFilter !== "all" && status !== projectStatusFilter) {
        return false;
      }
      if (!searchTerm) return true;
      return [row.title, row.description, row.project_type, row.status, row.total]
        .join(" ")
        .toLowerCase()
        .includes(searchTerm);
    });
  }, [projectAgreementRows, projectSearch, projectStatusFilter]);
  const nextAction = useMemo(() => getCustomerNextAction({ related, stats, customerId: id }), [related, stats, id]);
  const communicationRows = useMemo(() => {
    const rows = related.communication || [];
    if (communicationFilter === "all") return rows;
    return rows.filter((row) => row.communication_type === communicationFilter);
  }, [related, communicationFilter]);

  const title = contact.company_name || contact.name || "Customer Workspace";
  const subtitleParts = [contact.email, contact.phone, formatAddress(contact)].filter(Boolean);

  const handleCommunicationChange = (event) => {
    const { name, value } = event.target;
    setCommunicationForm((prev) => ({ ...prev, [name]: value }));
  };

  const selectedProjectRows = useMemo(
    () => projectAgreementRows.filter((row) => selectedProjectRecords.has(projectRecordKey(row))),
    [projectAgreementRows, selectedProjectRecords]
  );
  const projectActionSummary = useMemo(() => {
    const selected = selectedProjectRows.length;
    const deletable = selectedProjectRows.filter((row) => row.management?.can_delete).length;
    const archiveOnly = selectedProjectRows.filter((row) => row.management?.can_archive && !row.management?.can_delete).length;
    const blocked = selectedProjectRows.filter((row) => !row.management?.can_archive && !row.management?.can_delete).length;
    return { selected, deletable, archiveOnly, blocked };
  }, [selectedProjectRows]);

  const toggleProjectRecord = (row) => {
    const key = projectRecordKey(row);
    setSelectedProjectRecords((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateWorkspaceProjectRecords = (results = []) => {
    setWorkspace((prev) => {
      const updateRows = (rows = [], type) =>
        rows
          .filter((row) => !results.some((result) => result.ok && result.status === "deleted" && result.type === type && String(result.id) === String(row.id)))
          .map((row) => {
            const archived = results.find((result) => result.ok && result.status === "archived" && result.type === type && String(result.id) === String(row.id));
            if (!archived) return row;
            return {
              ...row,
              is_archived: true,
              management: {
                ...(row.management || {}),
                can_archive: false,
                archive_blockers: ["Record is already archived."],
              },
            };
          });
      return {
        ...prev,
        related: {
          ...(prev?.related || {}),
          agreements: updateRows(prev?.related?.agreements || [], "agreement"),
          projects: updateRows(prev?.related?.projects || [], "project"),
        },
      };
    });
  };

  const handleProjectActionConfirm = async () => {
    if (!projectActionDialog || !selectedProjectRows.length) return;
    setProjectActionSaving(true);
    setProjectActionResults([]);
    try {
      const { data } = await api.post(`/projects/homeowners/${id}/project-record-actions/`, {
        action: projectActionDialog,
        records: selectedProjectRows.map((row) => ({ type: projectRecordType(row), id: row.id })),
      });
      const results = data?.results || [];
      setProjectActionResults(results);
      updateWorkspaceProjectRecords(results);
      const succeeded = results.filter((result) => result.ok).length;
      const blocked = results.length - succeeded;
      if (succeeded) toast.success(`${succeeded} record${succeeded === 1 ? "" : "s"} updated.`);
      if (blocked) toast.error(`${blocked} record${blocked === 1 ? "" : "s"} blocked by safety rules.`);
      setSelectedProjectRecords(new Set(results.filter((result) => !result.ok).map((result) => `${result.type}-${result.id}`)));
      if (!blocked) {
        setProjectActionDialog(null);
        setProjectSelectionMode(false);
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update selected records.");
    } finally {
      setProjectActionSaving(false);
    }
  };

  const handleCommunicationSubmit = async (event) => {
    event.preventDefault();
    if (!communicationForm.subject.trim() && !communicationForm.body.trim()) {
      toast.error("Add a subject or note body.");
      return;
    }
    setSavingCommunication(true);
    try {
      const payload = {
        ...communicationForm,
        occurred_at: toApiDateTime(communicationForm.occurred_at),
        follow_up_at: toApiDateTime(communicationForm.follow_up_at),
      };
      const { data } = await api.post(`/projects/homeowners/${id}/communications/`, payload);
      setWorkspace((prev) => {
        const previousRelated = prev?.related || {};
        const previousTimeline = prev?.timeline || [];
        const communication = [data, ...(previousRelated.communication || [])];
        const eventRow = {
          type: data.communication_type,
          title: data.subject || data.communication_type_label,
          description: data.body,
          timestamp: data.occurred_at,
          source: "communication_log",
          source_id: data.id,
          url: "",
          amount: null,
          status: data.direction,
        };
        return {
          ...prev,
          related: {
            ...previousRelated,
            communication,
          },
          timeline: [eventRow, ...previousTimeline].sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || ""))),
          stats: {
            ...(prev?.stats || {}),
            last_activity: data.occurred_at || prev?.stats?.last_activity,
          },
        };
      });
      setShowCommunicationForm(false);
      setCommunicationForm({
        communication_type: "internal_note",
        direction: "internal",
        subject: "",
        body: "",
        occurred_at: dateTimeInputValue(new Date()),
        follow_up_at: "",
      });
      toast.success("Communication logged.");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to log communication.");
    } finally {
      setSavingCommunication(false);
    }
  };

  return (
    <ContractorPageSurface
      eyebrow="Customers"
      title={loading ? "Customer Workspace" : title}
      subtitle={loading ? "Loading customer relationship..." : subtitleParts.join(" • ")}
      variant="operational"
      actions={
        workspace ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button as={Link} to="/app/customers" theme="operational" variant="ghost" icon={ArrowLeft} data-testid="customer-workspace-back-link">Back to Customers</Button>
            <Button as={Link} to={`/app/customers/${id}/edit`} theme="operational" variant="secondary" icon={Edit}>Edit Customer</Button>
            <Button as={Link} to={`/app/agreements/new/wizard?customerId=${id}`} theme="operational" icon={Plus}>New Agreement</Button>
            <Button as={Link} to={`/app/intake/new?customerId=${id}`} theme="operational" variant="secondary" icon={FileText}>Create Estimate</Button>
            <Button as={Link} to={`/app/payments?customerId=${id}`} theme="operational" variant="secondary" icon={Receipt}>New Invoice</Button>
            <Button
              theme="operational"
              variant="secondary"
              icon={MessageSquare}
              onClick={() => {
                setActiveTab("Communication");
                setShowCommunicationForm(true);
              }}
            >
              Add Note
            </Button>
          </div>
        ) : null
      }
    >
      {loading ? <LoadingSkeleton theme="operational" variant="workspace" label="Loading customer workspace" /> : null}
      {!loading && error ? <InlineAlert theme="operational" tone="danger" title="Customer workspace could not be loaded">{error}</InlineAlert> : null}
      {!loading && workspace ? (
        <>
          <nav className="text-sm text-sky-100/65" aria-label="Breadcrumb">
            <Link to="/app/customers" className="font-semibold text-sky-100 hover:text-white">Customers</Link>
            <span className="mx-2 text-sky-100/35">/</span>
            <span className="text-white">{title}</span>
          </nav>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="customer-workspace-overview-cards">
            <SummaryCard label="Active Requests" value={stats.active_requests || 0} sublabel="Requests, leads, and opportunities" icon={Clock} />
            <SummaryCard label="Active Work" value={stats.active_agreements_projects || 0} sublabel="Agreements and projects" icon={FileText} />
            <SummaryCard label="Open Balance" value={money(stats.open_balance)} sublabel="Unpaid invoice activity" icon={DollarSign} />
            <SummaryCard label="Lifetime Value" value={money(stats.lifetime_value)} sublabel={`Since ${formatDate(stats.customer_since)}`} icon={Receipt} />
          </div>

          <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge theme="operational" status={statusSemantic(contact.status)} label={safeText(contact.status, "active")} />
                <span className="text-sm text-sky-100/65">Customer since {formatDate(stats.customer_since)}</span>
              </div>
              <div className="text-sm text-sky-100/60">Last activity {formatDateTime(stats.last_activity)}</div>
            </div>
          </div>

          <div className="overflow-x-auto pb-1" data-testid="customer-workspace-tabs">
            <div className="flex min-w-max gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    activeTab === tab
                      ? "border-[var(--mhb-border-selected)] bg-[var(--mhb-surface-selected)] text-[var(--mhb-text-primary)]"
                      : "border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] text-[var(--mhb-text-secondary)] hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-surface-interactive-hover)] hover:text-[var(--mhb-text-primary)]"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          {activeTab === "Overview" ? (
            <div className="space-y-5" data-testid="customer-workspace-overview">
              <CustomerNextActionCard action={nextAction} onSelectTab={setActiveTab} />
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                <section className="rounded-2xl border border-white/12 bg-slate-950/45 p-5">
                  <h2 className="text-lg font-semibold text-white">What is happening with this customer?</h2>
                  <div className="mt-4">
                    <Timeline events={(workspace.timeline || []).slice(0, OVERVIEW_TIMELINE_PREVIEW_LIMIT)} />
                  </div>
                </section>
                <section className="rounded-2xl border border-white/12 bg-slate-950/45 p-5">
                  <h2 className="text-lg font-semibold text-white">Quick CRM Snapshot</h2>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-sky-100/55">Customer since</dt><dd className="text-right font-semibold text-white">{formatDate(stats.customer_since)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-sky-100/55">Last activity</dt><dd className="text-right font-semibold text-white">{formatDateTime(stats.last_activity)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-sky-100/55">Properties</dt><dd className="text-right font-semibold text-white">{(related.properties || []).length}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-sky-100/55">Documents</dt><dd className="text-right font-semibold text-white">{(related.documents || []).length}</dd></div>
                  </dl>
                </section>
              </div>
            </div>
          ) : null}

          {activeTab === "Timeline" ? <Timeline events={workspace.timeline || []} /> : null}

          {activeTab === "Requests & Opportunities" ? (
            <PreviewList
              rows={requestOpportunityRows}
              emptyTitle="No requests or opportunities yet"
              emptyText="New leads, customer requests, and opportunities for this customer will appear here."
              testId="customer-workspace-requests"
              renderRow={(row) => <RowCard key={`${row.type}-${row.id}`} title={row.title} subtitle={row.description} meta={row.type} status={row.status} url={row.url} />}
            />
          ) : null}

          {activeTab === "Projects & Agreements" ? (
            <ProjectAgreementsManager
              rows={filteredProjectAgreementRows}
              totalRows={projectAgreementRows.length}
              filter={projectStatusFilter}
              onFilterChange={setProjectStatusFilter}
              search={projectSearch}
              onSearchChange={setProjectSearch}
              selectionMode={projectSelectionMode}
              onSelectionModeChange={(next) => {
                setProjectSelectionMode(next);
                setProjectActionDialog(null);
                setProjectActionResults([]);
                if (!next) setSelectedProjectRecords(new Set());
              }}
              selectedKeys={selectedProjectRecords}
              onToggleSelected={toggleProjectRecord}
              onClearSelection={() => {
                setSelectedProjectRecords(new Set());
                setProjectActionDialog(null);
                setProjectActionResults([]);
              }}
              onOpenDialog={(actionName) => {
                setProjectActionDialog(actionName);
                setProjectActionResults([]);
              }}
              actionDialog={projectActionDialog}
              actionSummary={projectActionSummary}
              actionSaving={projectActionSaving}
              actionResults={projectActionResults}
              onCancelDialog={() => {
                setProjectActionDialog(null);
                setProjectActionResults([]);
              }}
              onConfirmAction={handleProjectActionConfirm}
            />
          ) : null}

          {activeTab === "Payments" ? (
            <PreviewList
              rows={related.payments || []}
              emptyTitle="No payment activity yet"
              emptyText="Invoices and payment records for this customer will appear here."
              testId="customer-workspace-payments"
              renderRow={(row) => <RowCard key={`payment-${row.id}`} title={row.title || row.invoice_number} meta="invoice" status={row.status} amount={row.amount} url={row.url} />}
            />
          ) : null}

          {activeTab === "Communication" ? (
            <section className="space-y-4" data-testid="customer-workspace-communication">
              <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Communication Log</h2>
                    <p className="mt-1 text-sm leading-6 text-sky-100/60">Track internal notes, calls, emails, SMS, and in-person interactions. Nothing here is sent to the customer yet.</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={communicationFilter}
                      onChange={(event) => setCommunicationFilter(event.target.value)}
                      className="min-h-[40px] rounded-xl border border-white/12 bg-slate-950/50 px-3 py-2 text-sm font-semibold text-sky-100 outline-none focus:border-sky-300/45"
                      aria-label="Filter communication type"
                    >
                      {COMMUNICATION_TYPE_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowCommunicationForm((prev) => !prev)}
                      className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50"
                    >
                      <Plus size={16} /> Log Communication
                    </button>
                  </div>
                </div>

                {showCommunicationForm ? (
                  <form onSubmit={handleCommunicationSubmit} className="mt-5 grid gap-4 rounded-2xl border border-white/12 bg-slate-950/40 p-4" data-testid="communication-log-form">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-sm font-semibold text-sky-100/80">
                        Type
                        <select name="communication_type" value={communicationForm.communication_type} onChange={handleCommunicationChange} className="mt-1 w-full rounded-xl border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-300/45">
                          {LOG_TYPE_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm font-semibold text-sky-100/80">
                        Direction
                        <select name="direction" value={communicationForm.direction} onChange={handleCommunicationChange} className="mt-1 w-full rounded-xl border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-300/45">
                          {DIRECTION_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="text-sm font-semibold text-sky-100/80">
                      Subject
                      <input name="subject" value={communicationForm.subject} onChange={handleCommunicationChange} className="mt-1 w-full rounded-xl border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/45" placeholder="Short summary" />
                    </label>
                    <label className="text-sm font-semibold text-sky-100/80">
                      Notes
                      <textarea name="body" value={communicationForm.body} onChange={handleCommunicationChange} className="mt-1 min-h-28 w-full rounded-xl border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/45" placeholder="What happened? What should the team know?" />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-sm font-semibold text-sky-100/80">
                        Occurred
                        <input type="datetime-local" name="occurred_at" value={communicationForm.occurred_at} onChange={handleCommunicationChange} className="mt-1 w-full rounded-xl border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-300/45" />
                      </label>
                      <label className="text-sm font-semibold text-sky-100/80">
                        Follow-up date <span className="text-sky-100/45">(optional)</span>
                        <input type="datetime-local" name="follow_up_at" value={communicationForm.follow_up_at} onChange={handleCommunicationChange} className="mt-1 w-full rounded-xl border border-white/12 bg-slate-950/60 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-300/45" />
                      </label>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button type="button" onClick={() => setShowCommunicationForm(false)} className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/15 bg-slate-950/35 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/35">
                        Cancel
                      </button>
                      <button type="submit" disabled={savingCommunication} className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60">
                        {savingCommunication ? "Saving..." : "Save Communication"}
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>

              <PreviewList
                rows={communicationRows}
                emptyTitle="No communication logged yet"
                emptyText="Log internal notes, phone calls, emails, SMS, or in-person conversations so the next person has the full customer context."
                icon={MessageSquare}
                testId="customer-workspace-communication-list"
                renderRow={(row) => (
                  <RowCard
                    key={`communication-${row.id}`}
                    title={row.subject || row.communication_type_label}
                    subtitle={row.body}
                    meta={`${row.communication_type_label || "Communication"} | ${row.direction_label || row.direction || "Internal"}`}
                    status={row.follow_up_at ? `Follow up ${formatDateTime(row.follow_up_at)}` : row.visibility_label || row.visibility}
                  />
                )}
              />
            </section>
          ) : null}

          {["Properties", "Documents"].includes(activeTab) ? (
            <PreviewList
              rows={activeTab === "Properties" ? related.properties || [] : related.documents || []}
              emptyTitle={
                activeTab === "Properties"
                  ? "No linked properties yet"
                  : "No customer documents yet"
              }
              emptyText={
                activeTab === "Properties"
                  ? "Property links will make service history and site context easier to find from this customer workspace."
                  : "Uploaded files and generated customer documents will appear here once document linking is available."
              }
              actionLabel={activeTab === "Properties" ? "Add property" : "Upload document"}
              actionNote="Coming soon"
              icon={activeTab === "Properties" ? Home : Upload}
              testId={`customer-workspace-${activeTab.toLowerCase()}`}
              renderRow={(row) => <RowCard key={`${activeTab}-${row.id}`} title={row.display_name || row.title} subtitle={row.address_line1 || row.document_type} meta={activeTab} />}
            />
          ) : null}
        </>
      ) : null}
    </ContractorPageSurface>
  );
}
