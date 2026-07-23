// src/components/Customers.jsx
// canonical /projects/homeowners/ first; same UX
// Company Name support: show company as primary line when present

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Edit, Trash2, Home, Phone } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import ContractorPageSurface from "./dashboard/ContractorPageSurface.jsx";
import HubTabs from "./dashboard/HubTabs.jsx";
import { customerHubTabs } from "./dashboard/hubTabsConfig.js";
import {
  Button,
  Card,
  EmptyState,
  InlineAlert,
  LoadingSkeleton,
  MetricCard,
  StatusBadge as SharedStatusBadge,
} from "./ui";

function useDebouncedValue(value, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const StatusBadge = ({ status }) => {
  const key = String(status || "").toLowerCase();
  const semanticStatus = key === "active" ? "complete" : key === "prospect" ? "pending" : "draft";
  return <SharedStatusBadge theme="operational" status={semanticStatus} label={status || "-"} />;
};

const NewBadge = () => (
  <SharedStatusBadge theme="operational" status="recommended" label="New" className="ml-2 px-2 py-0.5 text-[10px] uppercase" />
);

const formatPhoneNumber = (phoneStr) => {
  if (!phoneStr) return "N/A";
  const cleaned = `${phoneStr}`.replace(/\D/g, "");
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  return phoneStr;
};

const formatAddress = (customer) => {
  const street = customer.street_address || customer.address_line1 || "";
  const line2 = customer.address_line_2 || customer.address_line2 || "";
  const city = customer.city || "";
  const state = customer.state || "";
  const zip = customer.zip_code || customer.zip || customer.postal_code || "";
  if (!street && !city && !state && !zip) return "No address on file";
  const cityState = [city, state].filter(Boolean).join(", ");
  return [street, line2, `${cityState} ${zip}`.trim()].filter(Boolean).join(", ");
};

const formatCurrency = (value) => {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (Number.isNaN(number)) return "-";
  return number.toLocaleString(undefined, { style: "currency", currency: "USD" });
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString();
};

const getLastActivityDisplay = (customer) => {
  const timestamp = customer.last_activity_at ?? customer.updated_at ?? customer.created_at;
  const label = customer.last_activity && customer.last_activity !== timestamp ? customer.last_activity : "";
  return {
    date: formatDate(timestamp),
    label,
  };
};

const ENDPOINTS = [
  "/projects/homeowners/",
  "/homeowners/",
  "/customers/",
  "/projects/customers/",
];

function normalizeResults(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function getCustomerDisplay(customer) {
  const company = (customer?.company_name || "").trim();
  const contact =
    (customer?.full_name || customer?.name || "").trim() ||
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ").trim();

  if (company) {
    return {
      primary: company,
      secondary: contact || "-",
      hasCompany: true,
    };
  }

  return {
    primary: contact || "N/A",
    secondary: "",
    hasCompany: false,
  };
}

export default function Customers() {
  const navigate = useNavigate();
  const location = useLocation();

  const CUSTOMER_NEW_ROUTE = "/app/customers/new";
  const customerWorkspaceRoute = (id) => `/app/customers/${id}`;
  const customerEditRoute = (id) => `/app/customers/${id}/edit`;

  const [newCustomerId, setNewCustomerId] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [count, setCount] = useState(0);
  const [usedEndpoint, setUsedEndpoint] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [q, setQ] = useState("");
  const qDebounced = useDebouncedValue(q, 400);
  const [status, setStatus] = useState("");
  const [ordering, setOrdering] = useState("-created_at");

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((count || 0) / pageSize)),
    [count, pageSize]
  );

  const customerSummary = useMemo(() => {
    const total = count || customers.length || 0;
    const active = customers.filter(
      (customer) => String(customer?.status || "").toLowerCase() === "active"
    ).length;
    const recent = customers.filter((customer) => {
      if (!customer?.created_at) return false;
      const created = new Date(customer.created_at);
      if (Number.isNaN(created.getTime())) return false;
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return created >= sevenDaysAgo;
    }).length;
    return { total, active, recent };
  }, [count, customers]);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      const raw = (sp.get("new_customer_id") || "").trim();
      if (!raw) return;

      setNewCustomerId(raw);
      toast.success("Customer created successfully!");

      sp.delete("new_customer_id");
      const nextSearch = sp.toString() ? `?${sp.toString()}` : "";
      navigate(`${location.pathname}${nextSearch}`, { replace: true });
    } catch {}
  }, [location.pathname, location.search, navigate]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { page, page_size: pageSize, ordering };
      if (qDebounced) params.q = qDebounced;
      if (status) params.status = status;

      let lastErr = null;
      for (const base of ENDPOINTS) {
        try {
          const { data } = await api.get(base, { params });
          const list = normalizeResults(data);
          const total =
            (typeof data?.count === "number" ? data.count : null) ??
            (Array.isArray(list) ? list.length : 0);
          setCustomers(list);
          setCount(total);
          setUsedEndpoint(base);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const st = e?.response?.status;
          if (st && st !== 404) throw e;
        }
      }

      if (lastErr) {
        setCustomers([]);
        setCount(0);
        setUsedEndpoint("NONE");
        toast("No customers endpoint found. Showing an empty list.", { icon: "i" });
      }
    } catch (err) {
      const errorMsg =
        err?.response?.status === 401
          ? "Please log in to view customers."
          : "Failed to load customers. Please try again.";
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Fetch customers error:", err);
      setCustomers([]);
      setCount(0);
      setUsedEndpoint("");
    } finally {
      setLoading(false);
    }
  }, [ordering, page, pageSize, qDebounced, status]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleDelete = async (id) => {
    if (!id) return;
    if (!window.confirm("Delete this customer? This cannot be undone.")) return;
    try {
      if (!usedEndpoint || usedEndpoint === "NONE") {
        toast.error("Delete failed: customers endpoint not detected.");
        return;
      }
      const delPath = `${usedEndpoint.replace(/\/+$/, "")}/${id}/`;
      await api.delete(delPath);

      const nextCount = Math.max(0, count - 1);
      const lastPage = Math.max(1, Math.ceil(nextCount / pageSize));
      if (page > lastPage) setPage(lastPage);
      else fetchCustomers();
      toast.success("Customer deleted.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete customer.");
      console.error("Delete customer error:", err);
    }
  };

  return (
    <ContractorPageSurface
      eyebrow="Business"
      title="My Customers"
      subtitle="Track customer relationships, keep contact details close, and move from lead to active project with less friction."
      variant="operational"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button as={Link} to={CUSTOMER_NEW_ROUTE} theme="operational">
            + Add New Customer
          </Button>
        </div>
      }
    >
      <HubTabs tabs={customerHubTabs} />

      <div className="grid gap-3 sm:grid-cols-3" data-testid="customers-summary">
        {[
          { label: "Total customers", value: customerSummary.total },
          { label: "Active customers", value: customerSummary.active },
          { label: "Added in last 7 days", value: customerSummary.recent },
        ].map((item) => <MetricCard key={item.label} theme="operational" label={item.label} value={item.value} />)}
      </div>

      <Card theme="operational" padding="sm">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            className="min-h-[42px] rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-sm font-semibold text-[var(--mhb-text-primary)] outline-none placeholder:text-[var(--mhb-text-muted)] focus:border-[var(--mhb-border-focus)] focus:ring-2 focus:ring-[var(--mhb-border-focus)]/25"
            placeholder="Search name, company, email, phone..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 260 }}
          />
          <select
            className="min-h-[42px] rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-sm font-semibold text-[var(--mhb-text-primary)] outline-none focus:border-[var(--mhb-border-focus)]"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="prospect">Prospect</option>
            <option value="archived">Archived</option>
          </select>
          <select
            className="min-h-[42px] rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-sm font-semibold text-[var(--mhb-text-primary)] outline-none focus:border-[var(--mhb-border-focus)]"
            value={ordering}
            onChange={(e) => {
              setOrdering(e.target.value);
              setPage(1);
            }}
          >
            <option value="-created_at">Newest</option>
            <option value="created_at">Oldest</option>
            <option value="full_name">Name A-Z</option>
            <option value="-full_name">Name Z-A</option>
            <option value="name">Name A-Z (name)</option>
            <option value="-name">Name Z-A (name)</option>
          </select>
          <select
            className="min-h-[42px] rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-control)] px-3 py-2 text-sm font-semibold text-[var(--mhb-text-primary)] outline-none focus:border-[var(--mhb-border-focus)]"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>

        {loading && <LoadingSkeleton theme="operational" variant="table" label="Loading customers" className="py-6" />}
        {!loading && error && <InlineAlert theme="operational" tone="danger" title="Customers could not be loaded">{error}</InlineAlert>}

        {!loading && !error && customers.length === 0 && (
          <EmptyState
            theme="operational"
            title="No customers yet"
            description="Add your first customer to start tracking relationships, job history, and project-ready contact details in one place."
            primaryAction={<Button as={Link} to={CUSTOMER_NEW_ROUTE} theme="operational">+ Add Your First Customer</Button>}
          />
        )}

        {!loading && !error && customers.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] shadow-[var(--mhb-shadow-card)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--mhb-border-divider)] bg-[var(--mhb-surface-inset)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[var(--mhb-text-primary)]">Customer directory</div>
                <div className="text-sm text-[var(--mhb-text-muted)]">
                  {count} total customer{count === 1 ? "" : "s"} across your account
                </div>
              </div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--mhb-text-muted)]">
                Page {page} of {totalPages}
              </div>
            </div>

            <div className="divide-y divide-[var(--mhb-border-divider)] md:hidden">
              {customers.map((customer) => {
                const cid = String(customer.id ?? customer.uuid ?? customer.pk ?? "");
                const isNew = newCustomerId && cid && String(newCustomerId) === cid;
                const { primary, secondary, hasCompany } = getCustomerDisplay(customer);
                const openRequests = customer.open_requests_count ?? customer.active_requests_count ?? 0;
                const activeWork = customer.active_agreements_projects_count ?? customer.active_agreements_count ?? customer.active_projects_count ?? 0;
                const closedWork = customer.closed_work_count ?? 0;
                const openBalance = formatCurrency(customer.open_balance);
                const lastActivity = getLastActivityDisplay(customer);

                return (
                  <div
                    key={`mobile-${customer.id ?? customer.uuid ?? customer.pk ?? `${customer.email}-${customer.phone}`}`}
                    className="block w-full cursor-pointer px-4 py-4 text-left text-[var(--mhb-text-secondary)] transition hover:bg-[var(--mhb-table-row-hover)] focus:bg-[var(--mhb-table-row-selected)] focus:outline-none"
                    data-testid={`customer-row-mobile-${cid}`}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      if (event.target.closest("a,button")) return;
                      if (cid) navigate(customerWorkspaceRoute(cid));
                    }}
                    onKeyDown={(event) => {
                      if (!cid) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(customerWorkspaceRoute(cid));
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--mhb-text-primary)]">
                          {primary}
                          {isNew ? <NewBadge /> : null}
                        </div>
                        {hasCompany && secondary ? <div className="text-sm text-[var(--mhb-text-muted)]">Contact: {secondary}</div> : null}
                        <div className="mt-1 text-sm text-[var(--mhb-text-muted)]">{customer.email || "-"}</div>
                        <div className="mt-1 text-sm text-[var(--mhb-text-muted)]">{formatPhoneNumber(customer.phone_number || customer.phone)}</div>
                      </div>
                      <StatusBadge status={customer.status} />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--mhb-text-muted)]">Requests</div>
                        <div className="mt-1 font-semibold text-[var(--mhb-text-primary)]">{openRequests}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--mhb-text-muted)]">Active Work</div>
                        <div className="mt-1 font-semibold text-[var(--mhb-text-primary)]">{activeWork}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--mhb-text-muted)]">Closed Work</div>
                        <div className="mt-1 font-semibold text-[var(--mhb-text-primary)]">{closedWork}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--mhb-text-muted)]">Balance</div>
                        <div className="mt-1 font-semibold text-[var(--mhb-text-primary)]">{openBalance}</div>
                      </div>
                      <div className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                        <div className="text-xs uppercase tracking-[0.14em] text-[var(--mhb-text-muted)]">Last Activity</div>
                        <div className="mt-1 font-semibold text-[var(--mhb-text-primary)]">{lastActivity.date}</div>
                        {lastActivity.label ? <div className="mt-0.5 text-xs text-[var(--mhb-text-muted)]">{lastActivity.label}</div> : null}
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <span className="inline-flex h-9 items-center justify-center rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] px-3 text-sm font-bold text-[var(--mhb-text-primary)]">
                        Open
                      </span>
                      <Link
                        to={customerEditRoute(customer.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] text-[var(--mhb-text-secondary)]"
                        aria-label="Edit customer"
                        data-testid={`customer-edit-mobile-${cid}`}
                      >
                        <Edit size={16} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-[var(--mhb-border-divider)]">
                <thead className="bg-[var(--mhb-surface-inset)] text-[var(--mhb-text-secondary)]">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider">Open Requests</th>
                    <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider">Active Work</th>
                    <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider">Closed Work</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">Open Balance</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">Last Activity</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">Date Added</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-[var(--mhb-border-divider)]">
                  {customers.map((customer) => {
                    const cid = String(customer.id ?? customer.uuid ?? customer.pk ?? "");
                    const isNew = newCustomerId && cid && String(newCustomerId) === cid;
                    const { primary, secondary, hasCompany } = getCustomerDisplay(customer);
                    const openRequests = customer.open_requests_count ?? customer.active_requests_count ?? 0;
                    const activeWork = customer.active_agreements_projects_count ?? customer.active_agreements_count ?? customer.active_projects_count ?? 0;
                    const closedWork = customer.closed_work_count ?? 0;
                    const openBalance = formatCurrency(customer.open_balance);
                    const lastActivity = getLastActivityDisplay(customer);

                    return (
                      <tr
                        key={customer.id ?? customer.uuid ?? customer.pk ?? `${customer.email}-${customer.phone}`}
                        className="cursor-pointer text-[var(--mhb-text-secondary)] transition-colors hover:bg-[var(--mhb-table-row-hover)] focus-within:bg-[var(--mhb-table-row-selected)]"
                        data-testid={`customer-row-${cid}`}
                        tabIndex={0}
                        title="Open customer workspace"
                        onClick={(event) => {
                          if (event.target.closest("a,button")) return;
                          if (cid) navigate(customerWorkspaceRoute(cid));
                        }}
                        onKeyDown={(event) => {
                          if (!cid) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            navigate(customerWorkspaceRoute(cid));
                          }
                        }}
                      >
                        <td className="whitespace-nowrap px-6 py-5">
                          <div className="font-semibold text-[var(--mhb-text-primary)]">
                            {primary}
                            {isNew ? <NewBadge /> : null}
                          </div>

                          {hasCompany && secondary ? (
                            <div className="text-sm text-[var(--mhb-text-muted)]">Contact: {secondary}</div>
                          ) : null}

                          <div className="text-sm text-[var(--mhb-text-muted)]">{customer.email || "-"}</div>

                          <div className="mt-1 flex items-center text-sm text-[var(--mhb-text-muted)]">
                            <Phone size={12} className="mr-1.5" />{" "}
                            {formatPhoneNumber(customer.phone_number || customer.phone)}
                          </div>

                          <div className="mt-1 flex items-center text-sm text-[var(--mhb-text-muted)]">
                            <Home size={12} className="mr-1.5" /> {formatAddress(customer)}
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-6 py-5">
                          <StatusBadge status={customer.status} />
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-center text-sm font-semibold text-[var(--mhb-text-primary)]">
                          {openRequests}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-center text-sm font-semibold text-[var(--mhb-text-primary)]">
                          {activeWork}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-center text-sm font-semibold text-[var(--mhb-text-primary)]">
                          {closedWork}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-right text-sm font-semibold text-[var(--mhb-text-primary)]">
                          {openBalance}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-sm text-[var(--mhb-text-muted)]">
                          <div>{lastActivity.date}</div>
                          {lastActivity.label ? <div className="mt-1 text-xs text-[var(--mhb-text-muted)]">{lastActivity.label}</div> : null}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-sm text-[var(--mhb-text-muted)]">
                          {customer.created_at ? new Date(customer.created_at).toLocaleDateString() : "-"}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-3">
                            <Link
                              to={customerEditRoute(customer.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-interactive-secondary)] text-[var(--mhb-text-secondary)] transition hover:border-[var(--mhb-border-strong)] hover:bg-[var(--mhb-interactive-ghost-hover)] hover:text-[var(--mhb-text-primary)]"
                              data-testid={`customer-edit-${cid}`}
                              title="Edit Customer"
                            >
                              <Edit size={18} />
                            </Link>

                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDelete(customer.id);
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-rose-300/35 bg-rose-500/10 text-rose-100 transition hover:bg-rose-500/18"
                              title="Delete Customer"
                              type="button"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-[var(--mhb-border-divider)] bg-[var(--mhb-surface-inset)] px-4 py-3">
              <div className="text-sm text-[var(--mhb-text-muted)]">
                Showing {count === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, count)} of {count}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  theme="operational"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  type="button"
                >
                  &lt; Prev
                </Button>

                <span className="text-sm text-[var(--mhb-text-muted)]">
                  Page {page} of {totalPages}
                </span>

                <Button
                  theme="operational"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  type="button"
                >
                  Next &gt;
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </ContractorPageSurface>
  );
}
