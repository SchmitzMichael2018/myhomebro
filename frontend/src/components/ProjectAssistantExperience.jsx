import React from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Eye, ShieldCheck, Sparkles } from "lucide-react";

const toneClasses = {
  default: "border-slate-200 bg-white text-slate-900",
  info: "border-sky-200 bg-sky-50 text-sky-950",
  advisory: "border-indigo-200 bg-indigo-50 text-indigo-950",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  danger: "border-rose-200 bg-rose-50 text-rose-950",
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
};

function clean(value) {
  return value == null ? "" : String(value).trim();
}

export function normalizeAssistantConfidence(value) {
  const text = clean(value).toLowerCase();
  if (!text) return "Needs more information";
  if (["needs more information", "needs_more_information", "none", "unknown", "insufficient"].includes(text)) {
    return "Needs more information";
  }
  if (text.includes("high")) return "High confidence";
  if (text.includes("medium") || text.includes("recommended") || text.includes("possible")) return "Medium confidence";
  if (text.includes("low") || text.includes("no strong")) return "Low confidence";

  const numeric = Number(text.replace("%", ""));
  if (Number.isFinite(numeric)) {
    const ratio = numeric > 1 ? numeric / 100 : numeric;
    if (ratio >= 0.8) return "High confidence";
    if (ratio >= 0.5) return "Medium confidence";
    if (ratio > 0) return "Low confidence";
  }
  return "Needs more information";
}

export function saferAssistantActionLabel(label = "") {
  const text = clean(label);
  const normalized = text.toLowerCase();
  if (normalized === "release payment" || normalized === "release now") return "Review payment release";
  if (normalized === "resolve dispute") return "Review resolution options";
  if (normalized === "approve warranty") return "Review warranty coverage";
  if (normalized === "deny coverage") return "Review coverage concern";
  if (normalized === "publish now" || normalized === "publish website") return "Review publish changes";
  if (normalized === "send message") return "Prepare message";
  if (normalized === "assign crew") return "Review crew assignment";
  if (normalized === "create agreement") return "Prepare agreement draft";
  if (normalized === "use this draft") return "Review draft";
  if (normalized === "refresh") return "Generate new version";
  if (normalized === "generate") return "Generate recommendation";
  return text;
}

export function ProjectAssistantPanel({ subtitle, children, summary = "", actions = null, className = "", testId = "" }) {
  return (
    <section
      data-testid={testId || "project-assistant-panel"}
      className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`.trim()}
    >
      <ProjectAssistantHeader subtitle={subtitle} summary={summary} actions={actions} />
      {children ? <div className="mt-4 space-y-4">{children}</div> : null}
    </section>
  );
}

export function ProjectAssistantHeader({ subtitle, summary = "", actions = null }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
          <Sparkles className="h-4 w-4 text-[#18395f]" aria-hidden="true" />
          Project Assistant
        </div>
        {subtitle ? <h2 className="mt-1 text-base font-black text-slate-950">{subtitle}</h2> : null}
        {summary ? <p className="mt-1 text-sm leading-6 text-slate-600">{summary}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function ProjectAssistantCard({ title, children, tone = "default", icon: Icon = null, testId = "" }) {
  const classes = toneClasses[tone] || toneClasses.default;
  return (
    <section
      data-testid={testId || undefined}
      className={`rounded-xl border px-4 py-3 ${classes}`.trim()}
    >
      {title ? (
        <div className="flex items-center gap-2 text-sm font-black">
          {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
          {title}
        </div>
      ) : null}
      {children ? <div className={title ? "mt-2" : ""}>{children}</div> : null}
    </section>
  );
}

export function ProjectAssistantSection({ title, children, testId = "" }) {
  return (
    <section data-testid={testId || undefined} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{title}</div>
      <div className="mt-2 text-sm leading-6 text-slate-700">{children}</div>
    </section>
  );
}

export function ProjectAssistantEvidenceList({ items = [], empty = "No source records listed yet." }) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) {
    return <div className="text-sm text-slate-500">{empty}</div>;
  }
  return (
    <div className="grid gap-2" data-testid="project-assistant-evidence-list">
      {rows.map((item, index) => {
        const row = typeof item === "object" ? item : { label: item };
        const label = clean(row.label || row.title || row.name || row.type) || "Source record";
        const type = clean(row.type || row.source_type);
        const status = clean(row.status);
        const date = clean(row.date || row.created_at || row.updated_at);
        const href = clean(row.href || row.url || row.route);
        const content = (
          <>
            <div className="font-semibold text-slate-900">{label}</div>
            <div className="mt-0.5 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
              {type ? <span>{type}</span> : null}
              {status ? <span>Status: {status}</span> : null}
              {date ? <span>{date}</span> : null}
            </div>
          </>
        );
        return href ? (
          <a
            key={`${label}-${index}`}
            href={href}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-slate-300"
          >
            {content}
          </a>
        ) : (
          <div key={`${label}-${index}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function ProjectAssistantMissingInfoList({ items = [], empty = "No missing information listed." }) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) {
    return <div className="text-sm text-slate-500">{empty}</div>;
  }
  return (
    <ul className="grid gap-2" data-testid="project-assistant-missing-info-list">
      {rows.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span>{typeof item === "object" ? item.label || item.prompt || JSON.stringify(item) : item}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProjectAssistantConfidenceBadge({ value, explanation = "" }) {
  const label = normalizeAssistantConfidence(value);
  const tone =
    label === "High confidence"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : label === "Medium confidence"
        ? "bg-amber-50 text-amber-800 border-amber-200"
        : label === "Low confidence"
          ? "bg-sky-50 text-sky-800 border-sky-200"
          : "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${tone}`}
      title={explanation || label}
      data-testid="project-assistant-confidence"
    >
      {label}
    </span>
  );
}

export function ProjectAssistantApprovalNotice({ compact = false, children = null }) {
  return (
    <ProjectAssistantCard title="Human approval required" tone="warning" icon={ShieldCheck} testId="project-assistant-human-approval">
      <p className="text-sm leading-6">
        {children ||
          (compact
            ? "Project Assistant can prepare this action, but an authorized user must approve it first."
            : "Project Assistant can prepare this action, but nothing will be sent, signed, published, assigned, approved, denied, released, refunded, routed, or closed until an authorized user approves it.")}
      </p>
    </ProjectAssistantCard>
  );
}

export function ProjectAssistantActionBar({ actions = [] }) {
  const rows = Array.isArray(actions) ? actions.filter(Boolean) : [];
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="project-assistant-action-bar">
      {rows.map((action, index) => (
        <button
          key={`${action.label || action.key || index}`}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={
            action.variant === "primary"
              ? "inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              : "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          }
        >
          {action.icon === "view" ? <Eye className="h-4 w-4" aria-hidden="true" /> : null}
          {action.icon === "list" ? <ClipboardList className="h-4 w-4" aria-hidden="true" /> : null}
          {action.icon === "check" ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : null}
          {saferAssistantActionLabel(action.label)}
        </button>
      ))}
    </div>
  );
}

export function ProjectAssistantEmptyState({ title = "No recommendation yet.", children = null }) {
  return (
    <ProjectAssistantCard title={title} tone="default" testId="project-assistant-empty-state">
      <div className="text-sm leading-6 text-slate-600">{children || "Add more context or generate a recommendation when you are ready."}</div>
    </ProjectAssistantCard>
  );
}

export function ProjectAssistantLoadingState({ label = "Preparing recommendation..." }) {
  return (
    <ProjectAssistantCard title={label} tone="info" testId="project-assistant-loading-state">
      <div className="text-sm leading-6">Reviewing source records and current workspace context.</div>
    </ProjectAssistantCard>
  );
}

export function ProjectAssistantErrorState({ message = "Project Assistant could not prepare a recommendation.", children = null }) {
  return (
    <ProjectAssistantCard title="Recommendation unavailable" tone="danger" testId="project-assistant-error-state">
      <div className="text-sm leading-6">{message}</div>
      {children ? <div className="mt-2">{children}</div> : null}
    </ProjectAssistantCard>
  );
}
