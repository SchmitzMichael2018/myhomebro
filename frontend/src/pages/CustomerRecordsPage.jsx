import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import DashboardSection from "../components/dashboard/DashboardSection.jsx";
import { buildUnifiedPaymentRecords, moneyStatusLabel, projectClassLabel } from "../utils/paymentRecords.js";
import { normalizeProjectClass } from "../utils/projectClass.js";

const RECENT_LIMIT = 5;

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeListPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function formatMoney(value) {
  const number = Number(value || 0);
  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function titleCaseStatus(value) {
  const text = String(value || "").replaceAll("_", " ").trim();
  if (!text) return "—";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function statusTone(status) {
  const key = normalize(status);
  if (["awarded", "converted", "paid"].includes(key)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (["under_review", "submitted", "analyzed", "payment_pending"].includes(key)) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (["declined", "expired", "rejected", "issues"].includes(key)) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusLabel(status, fallback = "—") {
  const text = String(status || "").trim();
  if (!text) return fallback;
  return titleCaseStatus(text);
}

function SummaryCard({ label, value, sublabel, tone = "slate", testId }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
    slate: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <div data-testid={testId} className={`rounded-xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {sublabel ? <div className="mt-1 text-xs opacity-70">{sublabel}</div> : null}
    </div>
  );
}

function SectionActionLink({ to, label }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      {label}
      <ExternalLink size={14} />
    </Link>
  );
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function SectionTable({ rows, columns, rowKey, emptyText, testId, onRowClick }) {
  if (!rows.length) {
    return (
      <div
        data-testid={`${testId}-empty`}
        className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600"
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div data-testid={testId} className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-2">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              data-testid={`${testId}-row-${rowKey(row)}`}
              className={`border-b border-slate-100 align-top last:border-b-0 ${onRowClick ? "cursor-pointer hover:bg-slate-50" : ""}`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-3">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function requestStatusTone(value) {
  const key = normalize(value);
  if (key === "converted") return "emerald";
  if (key === "analyzed") return "amber";
  if (key === "submitted") return "indigo";
  return "slate";
}

function normalizeRequests(items) {
  return (items || [])
    .map((item) => ({
      id: item.id,
      projectTitle:
        item.ai_project_title ||
        item.project_title ||
        item.accomplishment_text ||
        `Request #${item.id}`,
      customerName: item.customer_name || item.customer_email || "Customer",
      projectClass: normalizeProjectClass(item.project_class),
      status: item.status || "draft",
      statusLabel: statusLabel(item.status, "Draft"),
      submittedAt: item.submitted_at || item.analyzed_at || item.converted_at || item.created_at,
      agreementId: item.agreement || item.agreement_id || null,
    }))
    .sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")));
}

function normalizeAgreements(items) {
  return (items || [])
    .map((item) => ({
      id: item.id,
      projectTitle: item.project_title || item.title || `Agreement #${item.id}`,
      customerName: item.customer_name || item.homeowner_name || "Customer",
      projectClass: normalizeProjectClass(item.project_class),
      status: item.display_status || item.status || "draft",
      statusLabel: statusLabel(item.display_status || item.status, "Draft"),
      total: item.total_cost ?? item.display_total ?? item.total ?? item.amount ?? null,
      updatedAt: item.updated_at || item.created_at || null,
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function normalizeBidRow(row) {
  return {
    ...row,
    projectTitle: row.project_title || row.project_name || `Bid #${row.bid_id || row.id}`,
    customerName: row.customer_name || row.customer_email || "Customer",
    projectClass: normalizeProjectClass(row.project_class),
    projectClassLabel: row.project_class_label || projectClassLabel(row.project_class),
    statusLabel: row.status_label || statusLabel(row.status, "Submitted"),
    nextActionLabel: row.next_action?.label || "View details",
    agreementId: row.linked_agreement_id || null,
    actionHref: row.linked_agreement_url || "/app/bids",
    submittedAt: row.submitted_at || null,
  };
}

function normalizePaymentRow(record, agreementsById) {
  const agreement = agreementsById[String(record.agreementId || "")] || {};
  const customerName =
    record.raw?.customer_name ||
    record.raw?.homeowner_name ||
    agreement.customerName ||
    agreement.homeowner_name ||
    "Customer";

  const projectTitle =
    record.agreementTitle ||
    agreement.projectTitle ||
    agreement.project_title ||
    record.title ||
    "Payment";

  return {
    ...record,
    typeLabel: record.recordType === "invoice" ? "Invoice" : "Draw",
    customerName,
    projectTitle,
    projectClassLabel: projectClassLabel(record.projectClass),
    statusText: moneyStatusLabel(record.moneyStatus),
    paidAt: record.raw?.paid_at || record.raw?.released_at || record.sortDate || null,
    actionHref:
      record.recordType === "invoice"
        ? `/app/invoices/${record.id}`
        : record.agreementId
          ? `/app/agreements/${record.agreementId}`
          : "/app/invoices",
    actionLabel: record.recordType === "invoice" ? "Open Invoice" : "Open Agreement",
  };
}

export default function CustomerRecordsPage() {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [bids, setBids] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setLoadError("");

      const settled = await Promise.allSettled([
        api.get("/projects/intakes/", { params: { page_size: 200 } }),
        api.get("/projects/contractor/bids/"),
        api.get("/projects/agreements/", { params: { include_archived: 1, page_size: 200 } }),
        api.get("/projects/invoices/", { params: { page_size: 200 } }),
        api.get("/projects/draws/"),
      ]);

      if (!active) return;

      const errors = [];
      const [requestsRes, bidsRes, agreementsRes, invoicesRes, drawsRes] = settled;

      if (requestsRes.status === "fulfilled") {
        setRequests(normalizeListPayload(requestsRes.value?.data));
      } else {
        setRequests([]);
        errors.push("requests");
        console.error("Failed to load customer requests:", requestsRes.reason);
      }

      if (bidsRes.status === "fulfilled") {
        setBids(normalizeListPayload(bidsRes.value?.data));
      } else {
        setBids([]);
        errors.push("bids");
        console.error("Failed to load customer bids:", bidsRes.reason);
      }

      if (agreementsRes.status === "fulfilled") {
        setAgreements(normalizeListPayload(agreementsRes.value?.data));
      } else {
        setAgreements([]);
        errors.push("agreements");
        console.error("Failed to load customer agreements:", agreementsRes.reason);
      }

      const invoiceList = invoicesRes.status === "fulfilled" ? normalizeListPayload(invoicesRes.value?.data) : [];
      const drawList = drawsRes.status === "fulfilled" ? normalizeListPayload(drawsRes.value?.data) : [];

      if (invoicesRes.status !== "fulfilled") {
        errors.push("payments");
        console.error("Failed to load customer invoices:", invoicesRes.reason);
      }
      if (drawsRes.status !== "fulfilled") {
        errors.push("payments");
        console.error("Failed to load customer draw requests:", drawsRes.reason);
      }

      const agreementLookup = {};
      const normalizedAgreements = normalizeAgreements(agreementsRes.status === "fulfilled" ? normalizeListPayload(agreementsRes.value?.data) : []);
      for (const agreement of normalizedAgreements) {
        agreementLookup[String(agreement.id)] = agreement;
      }

      const paymentRecords = buildUnifiedPaymentRecords({
        invoices: invoiceList,
        drawRequests: drawList,
      }).map((record) => normalizePaymentRow(record, agreementLookup));

      setPayments(paymentRecords);

      if (errors.length) {
        setLoadError("Some record sections could not be loaded. The rest of the page is still available.");
        toast.error("Some record sections could not be loaded.");
      }

      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const requestRows = useMemo(() => normalizeRequests(requests), [requests]);
  const bidRows = useMemo(() => bids.map(normalizeBidRow).sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || ""))), [bids]);
  const agreementRows = useMemo(() => normalizeAgreements(agreements), [agreements]);
  const paymentRows = useMemo(
    () =>
      payments
        .slice()
        .sort((a, b) => String(b.paidAt || "").localeCompare(String(a.paidAt || ""))),
    [payments]
  );

  const summary = useMemo(
    () => ({
      activeRequests: requestRows.filter((row) => normalize(row.status) !== "converted").length,
      bids: bidRows.length,
      agreements: agreementRows.length,
      payments: paymentRows.length,
    }),
    [agreementRows.length, bidRows.length, paymentRows.length, requestRows]
  );

  const requestColumns = [
    {
      key: "project",
      label: "Request",
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.projectTitle}</div>
          <div className="mt-1 text-xs text-slate-500">{row.customerName}</div>
        </div>
      ),
    },
    {
      key: "class",
      label: "Project Class",
      render: (row) => <Badge tone="slate">{projectClassLabel(row.projectClass)}</Badge>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge tone={requestStatusTone(row.status)}>{row.statusLabel}</Badge>,
    },
    {
      key: "submitted",
      label: "Submitted",
      render: (row) => <span className="text-slate-700">{formatDate(row.submittedAt)}</span>,
    },
    {
      key: "action",
      label: "Actions",
      render: (row) => (
        <Link
          to={row.agreementId ? `/app/agreements/${row.agreementId}` : `/app/intake/new?intakeId=${row.id}`}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {row.agreementId ? "Open Agreement" : "Open Request"}
          <ArrowRight size={14} />
        </Link>
      ),
    },
  ];

  const bidColumns = [
    {
      key: "project",
      label: "Project",
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.projectTitle}</div>
          <div className="mt-1 text-xs text-slate-500">{row.customerName}</div>
        </div>
      ),
    },
    {
      key: "class",
      label: "Project Class",
      render: (row) => <Badge tone="slate">{row.projectClassLabel}</Badge>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge tone={requestStatusTone(row.status)}>{row.statusLabel}</Badge>,
    },
    {
      key: "submitted",
      label: "Submitted",
      render: (row) => <span className="text-slate-700">{formatDate(row.submittedAt)}</span>,
    },
    {
      key: "action",
      label: "Actions",
      render: (row) => (
        <Link
          to={row.actionHref || "/app/bids"}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {row.agreementId ? "Open Agreement" : "Open Bid Workspace"}
          <ArrowRight size={14} />
        </Link>
      ),
    },
  ];

  const agreementColumns = [
    {
      key: "project",
      label: "Agreement",
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.projectTitle}</div>
          <div className="mt-1 text-xs text-slate-500">{row.customerName}</div>
        </div>
      ),
    },
    {
      key: "class",
      label: "Project Class",
      render: (row) => <Badge tone="slate">{projectClassLabel(row.projectClass)}</Badge>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge tone={row.statusLabel.toLowerCase().includes("signed") ? "emerald" : "slate"}>{row.statusLabel}</Badge>,
    },
    {
      key: "total",
      label: "Total",
      render: (row) => <span className="font-semibold text-slate-900">{row.total == null ? "—" : formatMoney(row.total)}</span>,
    },
    {
      key: "action",
      label: "Actions",
      render: (row) => (
        <Link
          to={`/app/agreements/${row.id}`}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Open Agreement
          <ArrowRight size={14} />
        </Link>
      ),
    },
  ];

  const paymentColumns = [
    {
      key: "date",
      label: "Date",
      render: (row) => <span className="text-slate-700">{formatDate(row.paidAt)}</span>,
    },
    {
      key: "type",
      label: "Type",
      render: (row) => <Badge tone={row.recordType === "invoice" ? "indigo" : "emerald"}>{row.typeLabel}</Badge>,
    },
    {
      key: "project",
      label: "Project",
      render: (row) => (
        <div>
          <div className="font-semibold text-slate-900">{row.projectTitle}</div>
          <div className="mt-1 text-xs text-slate-500">{row.customerName}</div>
        </div>
      ),
    },
    {
      key: "class",
      label: "Project Class",
      render: (row) => <Badge tone="slate">{row.projectClassLabel}</Badge>,
    },
    {
      key: "status",
      label: "Status",
      render: (row) => <Badge tone={row.moneyStatus === "paid" ? "emerald" : row.moneyStatus === "issues" ? "rose" : "amber"}>{row.statusText}</Badge>,
    },
    {
      key: "amount",
      label: "Amount",
      render: (row) => <span className="font-semibold text-slate-900">{formatMoney(row.amount)}</span>,
    },
    {
      key: "action",
      label: "Actions",
      render: (row) => (
        <Link
          to={row.actionHref}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {row.actionLabel}
          <ExternalLink size={14} />
        </Link>
      ),
    },
  ];

  return (
    <ContractorPageSurface
      eyebrow="Customers"
      title="Customer Records"
      subtitle="A single view of requests, bids, agreements, and payments across residential and commercial work."
      actions={
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      }
    >
      {loadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {loadError}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard
          label="Active Requests"
          value={String(summary.activeRequests)}
          sublabel="Draft, submitted, and analyzed"
          tone="slate"
          testId="customer-records-summary-requests"
        />
        <SummaryCard
          label="Bids"
          value={String(summary.bids)}
          sublabel="Residential + commercial"
          tone="indigo"
          testId="customer-records-summary-bids"
        />
        <SummaryCard
          label="Agreements"
          value={String(summary.agreements)}
          sublabel="Open and archived records"
          tone="emerald"
          testId="customer-records-summary-agreements"
        />
        <SummaryCard
          label="Payments"
          value={String(summary.payments)}
          sublabel="Invoices + draw records"
          tone="amber"
          testId="customer-records-summary-payments"
        />
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">Loading customer records...</div>
      ) : (
        <div className="space-y-6">
          <DashboardSection
            title="My Requests"
            subtitle="Recent intake and request records."
            actions={<SectionActionLink to="/app/customers" label="View all customers" />}
            testId="customer-records-requests"
          >
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <SectionTable
                rows={requestRows.slice(0, RECENT_LIMIT)}
                columns={requestColumns}
                rowKey={(row) => row.id}
                emptyText="No requests yet. New project requests will appear here once they are created."
                testId="customer-records-requests-table"
              />
            </section>
          </DashboardSection>

          <DashboardSection
            title="Bids"
            subtitle="Bid activity across residential and commercial projects."
            actions={<SectionActionLink to="/app/bids" label="View all bids" />}
            testId="customer-records-bids"
          >
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <SectionTable
                rows={bidRows.slice(0, RECENT_LIMIT)}
                columns={bidColumns}
                rowKey={(row) => row.bid_id || row.id}
                emptyText="No bids yet. New bid activity will appear here once it lands."
                testId="customer-records-bids-table"
              />
            </section>
          </DashboardSection>

          <DashboardSection
            title="Agreements"
            subtitle="Signed and draft agreements for your customers."
            actions={<SectionActionLink to="/app/agreements" label="View all agreements" />}
            testId="customer-records-agreements"
          >
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <SectionTable
                rows={agreementRows.slice(0, RECENT_LIMIT)}
                columns={agreementColumns}
                rowKey={(row) => row.id}
                emptyText="No agreements yet. Agreement records will appear here once they are created."
                testId="customer-records-agreements-table"
              />
            </section>
          </DashboardSection>

          <DashboardSection
            title="Payments"
            subtitle="Invoices and draw records in one payment history."
            actions={<SectionActionLink to="/app/invoices" label="View all payments" />}
            testId="customer-records-payments"
          >
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <SectionTable
                rows={paymentRows.slice(0, RECENT_LIMIT)}
                columns={paymentColumns}
                rowKey={(row) => `${row.recordType}-${row.id}`}
                emptyText="No payment records yet. Completed invoices and draw payments will appear here."
                testId="customer-records-payments-table"
              />
            </section>
          </DashboardSection>
        </div>
      )}
    </ContractorPageSurface>
  );
}
