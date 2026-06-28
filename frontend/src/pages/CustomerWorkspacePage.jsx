import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
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
  Upload,
} from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

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

function statusBadge(status) {
  const key = String(status || "").toLowerCase();
  if (["active", "paid", "signed", "converted", "completed"].includes(key)) {
    return "border-emerald-300/35 bg-emerald-400/12 text-emerald-100";
  }
  if (["prospect", "submitted", "pending", "sent", "draft", "open", "new"].includes(key)) {
    return "border-sky-300/35 bg-sky-400/12 text-sky-100";
  }
  if (["overdue", "unpaid"].includes(key)) {
    return "border-amber-300/35 bg-amber-400/12 text-amber-100";
  }
  if (["disputed", "cancelled", "rejected", "declined"].includes(key)) {
    return "border-rose-300/35 bg-rose-400/12 text-rose-100";
  }
  return "border-white/15 bg-white/8 text-sky-100/75";
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
    <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm text-sky-100/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 font-semibold text-white">
            <Icon size={17} className="text-sky-200/80" />
            {title}
          </div>
          <p className="mt-1 leading-6">{children}</p>
          {actionNote ? <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/45">{actionNote}</p> : null}
        </div>
        {actionLabel ? (
          <button
            type="button"
            disabled
            className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-2 rounded-xl border border-white/12 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-sky-100/55"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sublabel, icon: Icon }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-slate-950/50 p-4 shadow-sm" data-testid={`customer-workspace-summary-${label.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100/60">{label}</div>
        {Icon ? <Icon size={17} className="text-sky-200/70" /> : null}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</div>
      {sublabel ? <div className="mt-1 text-xs text-sky-100/55">{sublabel}</div> : null}
    </div>
  );
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
          {status ? <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusBadge(status)}`}>{String(status).replaceAll("_", " ")}</span> : null}
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
                  {event.status ? <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusBadge(event.status)}`}>{String(event.status).replaceAll("_", " ")}</span> : null}
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
            <Link to="/app/customers" className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15" data-testid="customer-workspace-back-link">
              <ArrowLeft size={16} /> Back to Customers
            </Link>
            <Link to={`/app/customers/${id}/edit`} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 bg-slate-950/60 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15">
              <Edit size={16} /> Edit Customer
            </Link>
            <Link to={`/app/agreements/new/wizard?customerId=${id}`} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/70 bg-white px-3 py-2 text-sm font-bold text-slate-950 hover:bg-sky-50">
              <Plus size={16} /> New Agreement
            </Link>
            <Link to={`/app/intake/new?customerId=${id}`} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 bg-slate-950/60 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15">
              <FileText size={16} /> Create Estimate
            </Link>
            <Link to={`/app/payments?customerId=${id}`} className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 bg-slate-950/60 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15">
              <Receipt size={16} /> New Invoice
            </Link>
            <button
              type="button"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 bg-slate-950/60 px-3 py-2 text-sm font-semibold text-sky-100 hover:border-sky-300/40 hover:bg-sky-500/15"
              onClick={() => {
                setActiveTab("Communication");
                setShowCommunicationForm(true);
              }}
            >
              <MessageSquare size={16} /> Add Note
            </button>
          </div>
        ) : null
      }
    >
      {loading ? <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-6 text-sky-100/70">Loading customer workspace...</div> : null}
      {!loading && error ? <div className="rounded-2xl border border-rose-300/35 bg-rose-400/10 p-6 text-rose-100">{error}</div> : null}
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
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${statusBadge(contact.status)}`}>{safeText(contact.status, "active")}</span>
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
                      ? "border-sky-300/50 bg-sky-400/15 text-white"
                      : "border-white/12 bg-slate-950/35 text-sky-100/65 hover:border-sky-300/35 hover:text-white"
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
                    <Timeline events={(workspace.timeline || []).slice(0, 5)} />
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
            <PreviewList
              rows={projectAgreementRows}
              emptyTitle="No projects or agreements yet"
              emptyText="Created agreements and linked projects for this customer will appear here."
              testId="customer-workspace-projects"
              renderRow={(row) => <RowCard key={`${row.type || "project"}-${row.id}`} title={row.title} subtitle={row.description} meta={row.type || "project"} status={row.status} amount={row.total} url={row.url} />}
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
                    meta={`${row.communication_type_label || "Communication"} • ${row.direction_label || row.direction || "Internal"}`}
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
