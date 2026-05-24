import React, { useMemo, useState } from "react";
import { CreditCard, FileText, FolderKanban, Home, Inbox, LayoutDashboard } from "lucide-react";
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
          <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-400">
            Payment records will appear here after invoices, draw requests, or receipts are connected.
          </div>
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
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                Projects connected to this portal will appear here.
              </div>
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
              <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                Start a repair, maintenance, DIY, inspection, emergency, or new project request.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function CustomerDashboard({ portal, token, onPortalUpdate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [savingProperty, setSavingProperty] = useState(false);
  const [acceptingBidId, setAcceptingBidId] = useState("");

  const customerName = portal?.customer?.name || "Customer";
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
        />
      );
    }
    if (activeTab === "payments") return <PaymentsPanel payments={portal?.payments || []} />;
    return <CustomerDocuments documents={portal?.documents || []} propertyProfile={portal?.property_profile || {}} />;
  }, [activeTab, portal, creatingRequest, savingProperty, token, onPortalUpdate]);

  return (
    <div data-testid="customer-dashboard" className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-3xl border border-slate-700 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40 md:p-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">Customer Workspace</div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">{customerName}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Review projects, submit internal requests, maintain property details, and keep payments and documents in one secure workspace.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              Secure access verified for <span className="font-semibold text-white">{portal?.customer?.email}</span>
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

        <main className="mt-5">
          {tabContent}
        </main>
      </div>
    </div>
  );
}
