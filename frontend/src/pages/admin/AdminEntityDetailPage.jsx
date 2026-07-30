import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import api from "../../api";

const ADMIN_BASE = "/api/projects/admin";

function titleCase(value) {
  return String(value || "unknown").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function Status({ children }) {
  return <span className="inline-flex rounded-full border border-sky-200/30 bg-sky-400/10 px-2.5 py-1 text-xs font-bold text-sky-100">{titleCase(children)}</span>;
}

function Panel({ title, children, testId }) {
  return (
    <section className="mhb-admin-panel rounded-2xl p-5" data-testid={testId}>
      <h2 className="text-lg font-black text-white">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Facts({ items }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs font-bold uppercase tracking-wide text-sky-100/65">{label}</dt>
          <dd className="mt-1 break-words text-sm font-semibold text-slate-50">{value ?? "Not available"}</dd>
        </div>
      ))}
    </dl>
  );
}

function Empty({ children }) {
  return <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-sky-100/75">{children}</p>;
}

function RelatedTable({ columns, rows, renderRow }) {
  if (!rows?.length) return <Empty>No related records.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-white/10 text-xs uppercase tracking-wide text-sky-100/75">
          <tr>{columns.map((column) => <th className="px-3 py-2" key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
    </div>
  );
}

function StatePage({ kind, status, message }) {
  const plural = kind === "contractor" ? "contractors" : "customers";
  const listView = kind === "contractor" ? "contractors" : "homeowners";
  return (
    <main className="mhb-admin-page min-h-screen p-4 sm:p-6" data-testid={`admin-${kind}-detail-${status}`}>
      <section className="mhb-admin-panel mx-auto max-w-3xl rounded-2xl p-6" role={status === "loading" ? "status" : "alert"}>
        <h1 className="text-2xl font-black text-white">{message}</h1>
        {status !== "loading" && <Link className="mt-5 inline-flex font-bold text-sky-200 underline" to={`/app/admin?view=${listView}`}>Back to {titleCase(plural)}</Link>}
      </section>
    </main>
  );
}

function AdminTabs({ active }) {
  return (
    <nav className="mhb-admin-tabs flex gap-2 overflow-x-auto" aria-label="Admin sections">
      <Link className={`mhb-admin-tab ${active === "contractors" ? "is-active" : ""}`} aria-current={active === "contractors" ? "page" : undefined} to="/app/admin?view=contractors">Contractors</Link>
      <Link className={`mhb-admin-tab ${active === "customers" ? "is-active" : ""}`} aria-current={active === "customers" ? "page" : undefined} to="/app/admin?view=homeowners">Customers</Link>
      <Link className="mhb-admin-tab" to="/app/admin?view=agreements">Agreements</Link>
    </nav>
  );
}

function ContractorDetail({ record }) {
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Identity and contact">
          <Facts items={[
            ["Business", record.business_name], ["Contact", record.name], ["Email", record.email],
            ["Phone", record.phone], ["Location", [record.city, record.state, record.zip].filter(Boolean).join(", ")],
            ["Service area", record.service_radius_miles ? `${record.service_radius_miles} miles` : null],
          ]} />
        </Panel>
        <Panel title="Account status">
          <Facts items={[
            ["Account", titleCase(record.account_status)], ["Onboarding", titleCase(record.onboarding_status)],
            ["User active", record.user?.is_active ? "Yes" : "No"], ["Verified", record.user?.is_verified ? "Yes" : "No"],
            ["Created", formatDate(record.created_at)], ["Last login", formatDate(record.user?.last_login)],
          ]} />
        </Panel>
        <Panel title="Marketplace and public presence">
          <Facts items={[
            ["Profile", titleCase(record.public_profile_status)], ["Marketplace", titleCase(record.marketplace_verification_status)],
            ["Gallery", record.counts?.gallery], ["Reviews", record.counts?.reviews],
            ["Public visibility", record.public_profile_is_public ? "Public" : "Private or missing"],
          ]} />
        </Panel>
        <Panel title="Financial connection summary">
          <Facts items={[
            ["Stripe account", record.financial?.stripe_account_id || "Missing"], ["Connected", record.financial?.connected ? "Yes" : "No"],
            ["Charges enabled", record.financial?.charges_enabled ? "Yes" : "No"], ["Payouts enabled", record.financial?.payouts_enabled ? "Yes" : "No"],
            ["Details submitted", record.financial?.details_submitted ? "Yes" : "No"], ["Fee revenue", formatMoney(record.financial?.fee_revenue)],
          ]} />
        </Panel>
      </div>
      <Panel title="Business pipeline" testId="admin-contractor-pipeline">
        <Facts items={[
          ["Leads", record.counts?.leads], ["Agreements", record.counts?.agreements],
          ["Projects", record.counts?.projects], ["Customers", record.counts?.customers],
        ]} />
      </Panel>
      <Panel title="Related agreements">
        <RelatedTable columns={["Agreement", "Customer", "Status", "Updated"]} rows={record.agreements} renderRow={(row) => (
          <tr className="border-t border-white/10" key={row.id}>
            <td className="px-3 py-3"><Link className="font-bold text-sky-200 underline" to={`/app/admin/agreements/${row.id}`}>{row.project_title}</Link></td>
            <td className="px-3 py-3">{row.customer_name || "Not available"}</td><td className="px-3 py-3">{titleCase(row.status)}</td><td className="px-3 py-3">{formatDate(row.updated_at)}</td>
          </tr>
        )} />
      </Panel>
      <Panel title="Related projects">
        <RelatedTable columns={["Project", "Customer", "Status", "Created"]} rows={record.projects} renderRow={(row) => (
          <tr className="border-t border-white/10" key={row.id}>
            <td className="px-3 py-3 font-bold">{row.title}</td><td className="px-3 py-3">{row.customer_name || "Not available"}</td><td className="px-3 py-3">{titleCase(row.status)}</td><td className="px-3 py-3">{formatDate(row.created_at)}</td>
          </tr>
        )} />
      </Panel>
      <Panel title="Diagnostics">
        <Facts items={[
          ["Contractor ID", record.id], ["User ID", record.user_id], ["Company ID", record.company_id || "No separate company record"],
          ["Created", formatDate(record.created_at)], ["Updated", formatDate(record.updated_at)], ["Recent activity", formatDate(record.recent_activity_at)],
        ]} />
      </Panel>
    </>
  );
}

function CustomerDetail({ record }) {
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Identity and contact">
          <Facts items={[
            ["Name", record.name], ["Email", record.email], ["Phone", record.phone],
            ["Account type", titleCase(record.account_type)], ["Status", titleCase(record.status)],
          ]} />
        </Panel>
        <Panel title="Contractor relationship">
          <Facts items={[
            ["Contractor", record.contractor_id ? <Link className="text-sky-200 underline" to={`/app/admin/contractors/${record.contractor_id}`}>{record.contractor_name}</Link> : "Not assigned"],
            ["Contractor ID", record.contractor_id], ["Relationship status", titleCase(record.status)], ["Created", formatDate(record.created_at)],
          ]} />
        </Panel>
        <Panel title="Properties">
          <Facts items={[
            ["Property count", record.counts?.properties],
            ["Address", [record.address?.street, record.address?.line_2, record.address?.city, record.address?.state, record.address?.zip].filter(Boolean).join(", ") || "Not available"],
          ]} />
        </Panel>
        <Panel title="Activity">
          <Facts items={[["Created", formatDate(record.created_at)], ["Updated", formatDate(record.updated_at)], ["Recent activity", formatDate(record.recent_activity_at)]]} />
        </Panel>
      </div>
      <Panel title="Projects" testId="admin-customer-projects">
        <RelatedTable columns={["Project", "Status", "Contractor", "Address", "Created"]} rows={record.projects} renderRow={(row) => (
          <tr className="border-t border-white/10" key={row.id}>
            <td className="px-3 py-3 font-bold">{row.title}</td><td className="px-3 py-3">{titleCase(row.status)}</td><td className="px-3 py-3">{row.contractor_name}</td><td className="px-3 py-3">{row.address || "Not available"}</td><td className="px-3 py-3">{formatDate(row.created_at)}</td>
          </tr>
        )} />
      </Panel>
      <Panel title="Agreements">
        <RelatedTable columns={["Agreement", "Status", "Funded", "Created"]} rows={record.agreements} renderRow={(row) => (
          <tr className="border-t border-white/10" key={row.id}>
            <td className="px-3 py-3"><Link className="font-bold text-sky-200 underline" to={`/app/admin/agreements/${row.id}`}>{row.project_title}</Link></td><td className="px-3 py-3">{titleCase(row.status)}</td><td className="px-3 py-3">{formatMoney(row.funded)}</td><td className="px-3 py-3">{formatDate(row.created_at)}</td>
          </tr>
        )} />
      </Panel>
      <Panel title="Diagnostics">
        <Facts items={[
          ["Customer ID", record.id], ["Homeowner profile ID", record.homeowner_profile_id],
          ["Relationship ID", record.relationship_id], ["Linked user ID", record.user_id || "No linked user account"],
          ["Contractor ID", record.contractor_id], ["Updated", formatDate(record.updated_at)],
        ]} />
      </Panel>
    </>
  );
}

export default function AdminEntityDetailPage({ kind }) {
  const params = useParams();
  const id = kind === "contractor" ? params.contractorId : params.customerId;
  const plural = kind === "contractor" ? "contractors" : "customers";
  const listView = kind === "contractor" ? "contractors" : "homeowners";
  const endpoint = kind === "contractor" ? "contractors" : "homeowners";
  const [state, setState] = useState({ loading: true, record: null, error: null });

  useEffect(() => {
    let active = true;
    setState({ loading: true, record: null, error: null });
    api.get(`${ADMIN_BASE}/${endpoint}/${id}/`).then((response) => {
      if (active) setState({ loading: false, record: response.data, error: null });
    }).catch((error) => {
      if (!active) return;
      const code = error?.response?.status;
      setState({ loading: false, record: null, error: code === 403 ? "denied" : code === 404 ? "not-found" : "failed" });
    });
    return () => { active = false; };
  }, [endpoint, id]);

  if (state.loading) return <StatePage kind={kind} status="loading" message={`Loading ${kind} details…`} />;
  if (state.error === "not-found") return <StatePage kind={kind} status="not-found" message={`${titleCase(kind)} not found`} />;
  if (state.error === "denied") return <StatePage kind={kind} status="access-denied" message="You do not have permission to view this record." />;
  if (state.error) return <StatePage kind={kind} status="error" message={`Unable to load ${kind} details.`} />;

  const record = state.record;
  return (
    <main className="mhb-admin-page min-h-screen p-4 text-slate-100 sm:p-6" data-testid={`admin-${kind}-detail`}>
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="mhb-admin-header">
          <Link className="font-bold text-sky-200 underline" to={`/app/admin?view=${listView}`}>← Back to {titleCase(plural)}</Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100/65">Read-only admin record</div>
              <h1 className="mt-1 text-3xl font-black text-white">{kind === "contractor" ? record.business_name || record.name : record.name}</h1>
              <p className="mt-1 text-sm text-sky-100/75">#{record.id} · Updated {formatDate(record.recent_activity_at || record.updated_at)}</p>
            </div>
            <Status>{record.account_status || record.status}</Status>
          </div>
        </header>
        <AdminTabs active={plural} />
        {kind === "contractor" ? <ContractorDetail record={record} /> : <CustomerDetail record={record} />}
      </div>
    </main>
  );
}
