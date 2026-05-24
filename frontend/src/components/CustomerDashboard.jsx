import React, { useMemo, useState } from "react";
import { Bell, CreditCard, FileText, FolderKanban, Home, Inbox, LayoutDashboard } from "lucide-react";
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
];

function StatCard({ label, value, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function Badge({ children }) {
  return (
    <span className="inline-flex rounded-full border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200">
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

function PaymentsPanel({ payments = [] }) {
  return (
    <div data-testid="customer-portal-payments" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
      <h2 className="text-xl font-semibold text-white">Payments</h2>
      <div className="mt-4 space-y-3">
        {payments.length ? (
          payments.map((payment) => (
            <div key={payment.id} className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-white">{payment.project_title}</div>
                <div className="mt-1 text-xs text-slate-500">{payment.record_type_label} - {payment.date ? new Date(payment.date).toLocaleDateString() : "No date"}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{payment.amount_label || "$0.00"}</Badge>
                <Badge>{payment.status_label || "Pending"}</Badge>
              </div>
            </div>
          ))
        ) : (
          <EmptyState title="No payment records yet" testId="customer-payments-empty">
            Invoices, escrow funding, draw releases, and receipts will appear here when they are connected to this secure customer record.
          </EmptyState>
        )}
      </div>
    </div>
  );
}

function OverviewPanel({ portal }) {
  const summary = portal?.summary || {};
  const latestRequests = (portal?.requests || []).slice(0, 3);
  const latestProjects = (portal?.projects || []).slice(0, 3);

  return (
    <div data-testid="customer-dashboard-overview" className="space-y-5">
      <div data-testid="customer-portal-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Projects" value={summary.active_projects ?? 0} testId="customer-portal-summary-projects" />
        <StatCard label="Requests" value={summary.active_requests ?? 0} testId="customer-portal-summary-active-requests" />
        <StatCard label="Agreements" value={summary.active_agreements ?? 0} testId="customer-portal-summary-agreements" />
        <StatCard label="Payments" value={summary.payments ?? 0} testId="customer-portal-summary-payments" />
        <StatCard label="Documents" value={summary.documents ?? 0} testId="customer-portal-summary-documents" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <h2 className="text-lg font-semibold text-white">Current projects</h2>
          <div className="mt-3 space-y-3">
            {latestProjects.length ? latestProjects.map((project) => (
              <div key={project.id} className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-3">
                <div className="text-sm font-semibold text-white">{project.title}</div>
                <div className="mt-1 text-xs text-slate-500">{project.status_label || "Project"} - {project.contractor_name || "Contractor"}</div>
              </div>
            )) : (
              <EmptyState title="No active projects yet" testId="customer-overview-projects-empty">
                Projects will appear here after a request becomes an agreement or a contractor connects project records to your email.
              </EmptyState>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
          <h2 className="text-lg font-semibold text-white">Recent requests</h2>
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
    if (activeTab === "overview") return <OverviewPanel portal={portal} />;
    if (activeTab === "projects") return <CustomerProjectWorkspace projects={portal?.projects || []} agreements={portal?.agreements || []} />;
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
    return (
      <CustomerDocuments
        documents={portal?.documents || []}
        propertyProfile={portal?.property_profile || {}}
        uploading={uploadingPropertyFile}
        uploadError={uploadError}
        onUpload={uploadPropertyFile}
      />
    );
  }, [activeTab, portal, creatingRequest, savingProperty, uploadingPropertyFile, uploadError, token, onPortalUpdate]);

  return (
    <div data-testid="customer-dashboard" className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40 sm:p-6 md:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">MyHomeBro Records</div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Customer Workspace</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                {customerName ? `${customerName}, you can ` : "You can "}review projects, save internal requests, maintain property details, and keep payments and documents in one secure workspace.
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
                    ? "border-sky-300/60 bg-sky-400/15 text-sky-100"
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
          onMarkRead={async (notification) => {
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
          }}
        />

        <main className="mt-5">
          {tabContent}
        </main>
      </div>
    </div>
  );
}
