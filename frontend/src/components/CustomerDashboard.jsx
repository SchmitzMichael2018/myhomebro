import React, { useMemo, useState } from "react";
import { Bell, CreditCard, ExternalLink, FileText, FolderKanban, Home, Inbox, LayoutDashboard } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import CustomerDocuments from "./CustomerDocuments.jsx";
import CustomerProjectWorkspace from "./CustomerProjectWorkspace.jsx";
import CustomerPropertyProfile from "./CustomerPropertyProfile.jsx";
import CustomerRequests from "./CustomerRequests.jsx";

const TABS = [
  ["overview", "Overview", LayoutDashboard],
  ["projects", "Projects", FolderKanban],
  ["requests", "Requests", Inbox],
  ["property", "Property", Home],
  ["payments", "Payments", CreditCard],
  ["documents", "Documents", FileText],
  ["notifications", "Notifications", Bell],
];

function StatCard({ label, value, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    gold: "border-amber-300/50 bg-amber-300/15 text-amber-100",
    slate: "border-slate-600 bg-slate-900 text-slate-200",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function EmptyState({ title, children, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5 text-sm text-slate-300">
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-1 leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function paymentActionLabel(payment) {
  const status = String(payment?.status || payment?.status_label || "").toLowerCase();
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  if (status.includes("paid") || status.includes("released")) return payment?.receipt_url ? "View Receipt" : "View Record";
  if (type.includes("draw")) return "Review Release";
  if (type.includes("invoice")) return "Pay Invoice";
  return "Open";
}

function isInvoicePayment(payment) {
  const type = String(payment?.record_type || payment?.record_type_label || "").toLowerCase();
  return type.includes("invoice");
}

function isPaidPayment(payment) {
  const status = String(payment?.status || payment?.status_label || "").toLowerCase();
  return status.includes("paid") || status.includes("released");
}

function hasOpenDispute(payment) {
  const value = String(payment?.dispute_status || payment?.dispute_status_label || "").toLowerCase();
  return value && !value.includes("no dispute") && value !== "none";
}

function normalizeInvoiceMagicUrl(actionTarget = "") {
  const value = String(actionTarget || "");
  const invoiceMatch = value.match(/\/invoice\/([^/?#]+)/);
  if (invoiceMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(invoiceMatch[1]))}`;
  const magicMatch = value.match(/\/invoices\/magic\/([^/?#]+)/);
  if (magicMatch) return `/invoices/magic/${encodeURIComponent(decodeURIComponent(magicMatch[1]))}`;
  return value;
}

function PaymentsPanel({ payments = [] }) {
  const attention = payments.filter((payment) => {
    return !isPaidPayment(payment);
  });
  const paid = payments.filter((payment) => !attention.includes(payment));

  return (
    <div data-testid="customer-portal-payments" className="space-y-5">
      <section className="rounded-2xl border border-amber-300/35 bg-amber-300/10 p-5">
        <h2 className="text-xl font-semibold text-white">Payments Action Center</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-100">
          Review payments before funds are released. Invoices, draw reviews, escrow releases, direct pay items, and receipts stay connected here.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-white">Needs attention</h3>
          <Badge>{attention.length} open</Badge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {attention.length ? (
            attention.map((payment) => (
              <PaymentActionCard key={payment.id} payment={payment} />
            ))
          ) : (
            <div className="lg:col-span-2">
              <EmptyState title="No payments need review" testId="customer-payments-attention-empty">
                When an invoice needs payment or a milestone release needs review, it will appear here with a clear action.
              </EmptyState>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-semibold text-white">Payment history</h3>
          <Badge>{paid.length} records</Badge>
        </div>
        <div className="mt-4 space-y-3">
          {paid.length ? (
            paid.map((payment) => (
              <PaymentActionCard key={payment.id} payment={payment} compact />
            ))
          ) : payments.length ? null : (
            <EmptyState title="No payment records yet" testId="customer-payments-empty">
              Invoices, escrow funding, draw releases, and receipts will appear here when they are connected to this secure customer record.
            </EmptyState>
          )}
        </div>
      </section>
    </div>
  );
}

function PaymentActionCard({ payment, compact = false }) {
  const invoiceUrl = isInvoicePayment(payment) ? normalizeInvoiceMagicUrl(payment.action_target) : payment.action_target;
  const target = payment.receipt_url || invoiceUrl || "#";
  const disputeUrl = isInvoicePayment(payment) && invoiceUrl ? `${invoiceUrl}?action=dispute` : "";
  const paid = isPaidPayment(payment);
  return (
    <article data-testid={`customer-payment-action-${payment.id}`} className={`rounded-2xl border border-slate-700 bg-slate-900/70 p-4 ${compact ? "" : "shadow-xl shadow-slate-950/20"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge>{payment.record_type_label || "Payment"}</Badge>
            <Badge>{payment.status_label || "Pending"}</Badge>
          </div>
          <div className="mt-3 text-sm font-semibold text-white">{payment.project_title}</div>
          <div className="mt-1 text-xs text-slate-500">
            {payment.date ? new Date(payment.date).toLocaleDateString() : "No date"}
            {payment.reference ? ` - ${payment.reference}` : ""}
          </div>
          <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
            <span>{payment.contractor_name ? `Contractor: ${payment.contractor_name}` : "Contractor: Your contractor"}</span>
            <span>{payment.payment_mode_label ? `Method: ${payment.payment_mode_label}` : "Method: Secure payment"}</span>
            {payment.due_date ? <span>Due: {new Date(payment.due_date).toLocaleDateString()}</span> : null}
            {payment.invoice_number ? <span>Invoice: {payment.invoice_number}</span> : null}
            {hasOpenDispute(payment) ? <span className="text-rose-100">Issue: {payment.dispute_status_label || payment.dispute_status}</span> : null}
          </div>
          {payment.notes ? <p className="mt-2 text-sm text-slate-300">{payment.notes}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <div className="text-lg font-bold text-white">{payment.amount_label || "$0.00"}</div>
          <div className="flex w-full flex-col gap-2 sm:w-auto">
            {target && target !== "#" ? (
              <a
                data-testid={`customer-payment-primary-${payment.id}`}
                href={target}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200/45 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25"
              >
                {paymentActionLabel(payment)}
                <ExternalLink size={14} />
              </a>
            ) : null}
            {isInvoicePayment(payment) && invoiceUrl && !paid ? (
              <>
                <a
                  data-testid={`customer-payment-view-invoice-${payment.id}`}
                  href={invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-300/35 bg-sky-400/10 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                >
                  View Invoice
                  <ExternalLink size={14} />
                </a>
                <a
                  data-testid={`customer-payment-open-dispute-${payment.id}`}
                  href={disputeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
                >
                  Open Dispute
                  <ExternalLink size={14} />
                </a>
              </>
            ) : null}
            {hasOpenDispute(payment) && payment.dispute_url ? (
              <a
                data-testid={`customer-payment-track-dispute-${payment.id}`}
                href={payment.dispute_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-400/20"
              >
                Track Issue Status
                <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function OverviewPanel({ portal, onOpenTab }) {
  const summary = portal?.summary || {};
  const latestRequests = (portal?.requests || []).slice(0, 3);
  const latestProjects = (portal?.projects || []).slice(0, 3);
  const notifications = portal?.notifications || [];
  const openPayments = (portal?.payments || []).filter((payment) => {
    return !isPaidPayment(payment);
  });
  const openDisputes = (portal?.payments || []).filter(hasOpenDispute);
  const needsAttention = [
    ...openDisputes.slice(0, 2).map((payment) => ({
      id: `dispute-${payment.id}`,
      title: `Open issue for ${payment.project_title || "your project"}`,
      body: `${payment.dispute_status_label || payment.dispute_status} - ${payment.amount_label || "$0.00"}`,
      action: "Track Issue Status",
      tab: "payments",
    })),
    ...notifications.filter((notification) => notification.status !== "read").slice(0, 3).map((notification) => ({
      id: `notification-${notification.id}`,
      title: notification.title || "Workspace update",
      body: notification.message || "A project update is available.",
      action: "Open Notifications",
      tab: "notifications",
    })),
    ...openPayments.slice(0, 2).map((payment) => ({
      id: `payment-${payment.id}`,
      title: `${payment.record_type_label || "Payment"} for ${payment.project_title || "your project"}`,
      body: `${payment.amount_label || "$0.00"} - ${payment.status_label || "Pending"}`,
      action: "Open Payments",
      tab: "payments",
    })),
  ];

  return (
    <div data-testid="customer-dashboard-overview" className="space-y-5">
      <section className="rounded-2xl border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_34%),rgba(15,23,42,0.76)] p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Needs Attention</div>
        <h2 className="mt-1 text-xl font-semibold text-white">What needs my attention?</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-300">
          Track your project from agreement to completion, review payments before funds are released, and keep documents in one place.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {needsAttention.length ? (
            needsAttention.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenTab?.(item.tab)}
                className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-left hover:border-amber-300/50"
              >
                <div className="text-sm font-semibold text-white">{item.title}</div>
                <p className="mt-1 text-sm leading-5 text-slate-300">{item.body}</p>
                <div className="mt-3 text-xs font-semibold text-amber-100">{item.action}</div>
              </button>
            ))
          ) : (
            <div className="lg:col-span-2 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              Nothing needs your attention right now. New signatures, payment reviews, and project updates will appear here.
            </div>
          )}
        </div>
      </section>

      <div data-testid="customer-portal-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Projects" value={summary.active_projects ?? 0} testId="customer-portal-summary-projects" />
        <StatCard label="Requests" value={summary.active_requests ?? 0} testId="customer-portal-summary-active-requests" />
        <StatCard label="Agreements" value={summary.active_agreements ?? 0} testId="customer-portal-summary-agreements" />
        <StatCard label="Payments" value={summary.payments ?? 0} testId="customer-portal-summary-payments" />
        <StatCard label="Documents" value={summary.documents ?? 0} testId="customer-portal-summary-documents" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <h2 className="text-lg font-semibold text-white">Active Projects</h2>
          <div className="mt-3 space-y-3">
            {latestProjects.length ? latestProjects.map((project) => (
              <button key={project.id} type="button" onClick={() => onOpenTab?.("projects")} className="w-full rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-3 text-left hover:border-amber-300/45">
                <div className="text-sm font-semibold text-white">{project.title}</div>
                <div className="mt-1 text-xs text-slate-500">{project.status_label || "Project"} - {project.contractor_name || "Contractor"}</div>
              </button>
            )) : (
              <EmptyState title="No active projects yet" testId="customer-overview-projects-empty">
                Projects will appear here after a request becomes an agreement or a contractor connects project records to your email.
              </EmptyState>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
          <div className="mt-3 space-y-3">
            {latestRequests.length ? latestRequests.map((request) => (
              <div key={request.id} className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-3">
                <div className="text-sm font-semibold text-white">{request.project_title}</div>
                <div className="mt-1 text-xs text-slate-500">{request.status_label || "Submitted"}</div>
              </div>
            )) : (
              <EmptyState title="No requests yet" testId="customer-overview-requests-empty">
                You can save repair, maintenance, DIY, inspection, emergency, or new project requests here. They stay internal until they are ready to route.
              </EmptyState>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function NotificationsCenter({ notifications = [], unreadCount = 0, markingId = "", onMarkRead }) {
  const [filter, setFilter] = useState("unread");
  const filtered = filter === "unread" ? notifications.filter((notification) => notification.status !== "read") : notifications;

  return (
    <section data-testid="customer-notifications-center" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Notifications Center</h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">Action-oriented history for project, payment, document, request, and signing updates.</p>
        </div>
        <Badge>{unreadCount} unread</Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {["unread", "all"].map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`customer-notifications-filter-${value}`}
            onClick={() => setFilter(value)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
              filter === value
                ? "border-amber-300/55 bg-amber-300/15 text-amber-100"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
            }`}
          >
            {value === "unread" ? "Unread" : "All"}
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {filtered.length ? (
          filtered.map((notification) => {
            const isUnread = notification.status !== "read";
            return (
              <article key={notification.id} data-testid={`customer-notifications-center-item-${notification.id}`} className={`rounded-2xl border p-4 ${isUnread ? "border-amber-300/45 bg-amber-300/10" : "border-slate-700 bg-slate-900/70"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{notification.title || "Update"}</h3>
                      <Badge>{eventLabel(notification.event_type)}</Badge>
                      {isUnread ? <Badge tone="gold">Unread</Badge> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{notification.message || "A workspace update is available."}</p>
                    <div className="mt-2 text-xs text-slate-500">{notification.created_at ? new Date(notification.created_at).toLocaleString() : "No date"}</div>
                    {notification.action_url ? (
                      <a href={notification.action_url} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-100 hover:text-amber-50">
                        Open related item
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </div>
                  {isUnread ? (
                    <button
                      type="button"
                      data-testid={`customer-notifications-center-mark-read-${notification.id}`}
                      disabled={markingId === String(notification.id)}
                      onClick={() => onMarkRead?.(notification)}
                      className="shrink-0 rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white disabled:opacity-50"
                    >
                      {markingId === String(notification.id) ? "Saving..." : "Mark as read"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState title={filter === "unread" ? "No unread notifications" : "No notifications yet"} testId="customer-notifications-center-empty">
            Project activity, payment reviews, signing reminders, document updates, and request history will appear here.
          </EmptyState>
        )}
      </div>
    </section>
  );
}

function eventLabel(eventType = "") {
  return String(eventType || "notification").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function NotificationPanel({ notifications = [], unreadCount = 0, markingId = "", onMarkRead }) {
  const recent = notifications.slice(0, 4);

  return (
    <section data-testid="customer-notifications-panel" className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/70 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-sky-200" />
            <h2 className="text-lg font-semibold text-white">Updates</h2>
          </div>
          <p className="mt-1 text-sm text-slate-300">Recent project, payment, request, and property notifications.</p>
        </div>
        <span data-testid="customer-notifications-unread-count" className="inline-flex w-fit rounded-full border border-sky-300/35 bg-sky-400/10 px-3 py-1 text-xs font-semibold text-sky-100 shadow-[0_0_16px_rgba(56,189,248,0.12)]">
          {unreadCount} unread
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {recent.length ? (
          recent.map((notification) => {
            const isUnread = notification.status !== "read";
            return (
              <article
                key={notification.id}
                data-testid={`customer-notification-${notification.id}`}
                className={`rounded-xl border p-4 ${
                  isUnread
                    ? "border-sky-300/45 bg-sky-400/10 shadow-[inset_3px_0_0_rgba(56,189,248,0.55)]"
                    : "border-slate-700 bg-slate-900/60"
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">{notification.title || "Update"}</h3>
                      <span className="rounded-full border border-slate-600 bg-slate-950/70 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
                        {eventLabel(notification.event_type)}
                      </span>
                      {isUnread ? (
                        <span className="rounded-full border border-sky-300/40 bg-sky-400/15 px-2 py-0.5 text-[11px] font-semibold text-sky-100">
                          Unread
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-5 text-slate-300">{notification.message || "A workspace update is available."}</p>
                    <div className="mt-2 text-xs text-slate-500">
                      {notification.created_at ? new Date(notification.created_at).toLocaleString() : "No date"}
                    </div>
                  </div>
                  {isUnread ? (
                    <button
                      type="button"
                      data-testid={`customer-notification-mark-read-${notification.id}`}
                      disabled={markingId === String(notification.id)}
                      onClick={() => onMarkRead?.(notification)}
                      className="shrink-0 rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-300/50 hover:text-white disabled:opacity-50"
                    >
                      {markingId === String(notification.id) ? "Saving..." : "Mark as read"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <div className="lg:col-span-2">
            <EmptyState title="No updates yet" testId="customer-notifications-empty">
              Project, request, payment, document, and signing updates will appear here when there is something useful to review.
            </EmptyState>
          </div>
        )}
      </div>
    </section>
  );
}

export default function CustomerDashboard({ portal, token, onPortalUpdate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [savingProperty, setSavingProperty] = useState(false);
  const [uploadingPropertyFile, setUploadingPropertyFile] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [acceptingBidId, setAcceptingBidId] = useState("");
  const [markingNotificationId, setMarkingNotificationId] = useState("");

  const customerName = portal?.customer?.name || "Customer";
  const notifications = portal?.notifications || [];
  const unreadCount = notifications.filter((notification) => notification.status !== "read").length;

  const refreshPortal = async () => {
    if (!token) return;
    try {
      const { data } = await api.get(`/projects/customer-portal/${encodeURIComponent(token)}/`);
      onPortalUpdate?.(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not refresh your workspace.");
    }
  };

  const markNotificationRead = async (notification) => {
    if (!notification?.id) return;
    setMarkingNotificationId(String(notification.id));
    try {
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/notifications/${notification.id}/read/`
      );
      onPortalUpdate?.(data);
      toast.success("Update marked as read.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update that notification.");
    } finally {
      setMarkingNotificationId("");
    }
  };

  const uploadPropertyFile = async ({ file, title, documentType, kind }) => {
    if (!file) return false;
    setUploadError("");
    setUploadingPropertyFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title || file.name || "Property file");
      if (documentType) formData.append("document_type", documentType);
      const uploadKind = kind === "photo" ? "photos" : "documents";
      const { data } = await api.post(
        `/projects/customer-portal/${encodeURIComponent(token)}/property/${uploadKind}/`,
        formData
      );
      onPortalUpdate?.(data);
      toast.success(uploadKind === "photos" ? "Photo uploaded." : "Document uploaded.");
      return true;
    } catch (error) {
      const message = error?.response?.data?.detail || "Could not upload that file.";
      setUploadError(message);
      toast.error(message);
      return false;
    } finally {
      setUploadingPropertyFile(false);
    }
  };
  const tabContent = useMemo(() => {
    if (activeTab === "overview") return <OverviewPanel portal={portal} onOpenTab={setActiveTab} />;
    if (activeTab === "projects") {
      return (
        <CustomerProjectWorkspace
          projects={portal?.projects || []}
          agreements={portal?.agreements || []}
          payments={portal?.payments || []}
          documents={portal?.documents || []}
          notifications={portal?.notifications || []}
          token={token}
          onRefresh={(nextPortal) => {
            if (nextPortal) {
              onPortalUpdate?.(nextPortal);
              return;
            }
            refreshPortal();
          }}
        />
      );
    }
    if (activeTab === "requests") {
      return (
        <CustomerRequests
          requests={portal?.requests || []}
          bids={portal?.bids || []}
          propertyProfile={portal?.property_profile || {}}
          creating={creatingRequest}
          acceptingBidId={acceptingBidId}
          onAcceptBid={async (bid) => {
            const bidKey = bid?.id || "";
            if (!bidKey) return;
            setAcceptingBidId(bidKey);
            try {
              const { data } = await api.post(
                `/projects/customer-portal/${encodeURIComponent(token)}/bids/${encodeURIComponent(bidKey)}/accept/`
              );
              if (data?.portal) onPortalUpdate?.(data.portal);
              toast.success(data?.created ? "Bid accepted." : "Bid already linked.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not accept that bid.");
            } finally {
              setAcceptingBidId("");
            }
          }}
          onCreateRequest={async (payload) => {
            setCreatingRequest(true);
            try {
              const { data } = await api.post(`/projects/customer-portal/${encodeURIComponent(token)}/requests/`, payload);
              onPortalUpdate?.(data);
              toast.success("Request saved.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not save that request.");
            } finally {
              setCreatingRequest(false);
            }
          }}
        />
      );
    }
    if (activeTab === "property") {
      return (
        <CustomerPropertyProfile
          profile={portal?.property_profile || {}}
          saving={savingProperty}
          uploading={uploadingPropertyFile}
          uploadError={uploadError}
          onSave={async (payload) => {
            setSavingProperty(true);
            try {
              const { data } = await api.patch(`/projects/customer-portal/${encodeURIComponent(token)}/property/`, payload);
              onPortalUpdate?.(data);
              toast.success("Property profile saved.");
            } catch (error) {
              toast.error(error?.response?.data?.detail || "Could not save the property profile.");
            } finally {
              setSavingProperty(false);
            }
          }}
          onUpload={uploadPropertyFile}
        />
      );
    }
    if (activeTab === "payments") return <PaymentsPanel payments={portal?.payments || []} />;
    if (activeTab === "notifications") {
      return (
        <NotificationsCenter
          notifications={notifications}
          unreadCount={unreadCount}
          markingId={markingNotificationId}
          onMarkRead={markNotificationRead}
        />
      );
    }
    return (
      <CustomerDocuments
        documents={portal?.documents || []}
        propertyProfile={portal?.property_profile || {}}
        uploading={uploadingPropertyFile}
        uploadError={uploadError}
        onUpload={uploadPropertyFile}
      />
    );
  }, [activeTab, portal, creatingRequest, savingProperty, uploadingPropertyFile, uploadError, token, onPortalUpdate, notifications, unreadCount, markingNotificationId]);

  return (
    <div data-testid="customer-dashboard" className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.16),transparent_28%),linear-gradient(135deg,#020617,#082f49_52%,#020617)] px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-amber-200/20 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40 sm:p-6 md:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">MyHomeBro Records</div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Customer Workspace</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                {customerName ? `${customerName}, you can ` : "You can "}track your project from agreement to completion, review payments before funds are released, and keep your project documents and home records in one place.
              </p>
            </div>
            <div className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300 lg:w-auto">
              <div>Secure access verified for <span className="font-semibold text-white">{portal?.customer?.email}</span></div>
              <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-sky-300/35 bg-sky-400/10 px-2.5 py-1 text-xs font-semibold text-sky-100">
                <Bell size={13} />
                {unreadCount} unread updates
              </div>
            </div>
          </div>

          <nav className="mt-6 flex gap-2 overflow-x-auto pb-1" aria-label="Customer workspace tabs">
            {TABS.map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                data-testid={`customer-dashboard-tab-${key}`}
                onClick={() => setActiveTab(key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  activeTab === key
                    ? "border-amber-300/60 bg-amber-300/15 text-amber-100"
                    : "border-slate-700 bg-slate-950/40 text-slate-300 hover:border-slate-500 hover:bg-slate-900"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>
        </header>

        <NotificationPanel
          notifications={notifications}
          unreadCount={unreadCount}
          markingId={markingNotificationId}
          onMarkRead={markNotificationRead}
        />

        <main className="mt-5">
          {tabContent}
        </main>
      </div>
    </div>
  );
}
