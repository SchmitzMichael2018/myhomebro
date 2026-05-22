// src/components/Customers.jsx
// canonical /projects/homeowners/ first; same UX
// Company Name support: show company as primary line when present

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Edit, Trash2, Home, Phone } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import ContractorPageSurface from "./dashboard/ContractorPageSurface.jsx";

function useDebouncedValue(value, delay = 400) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const StatusBadge = ({ status }) => {
  const statusStyles = {
    active: "border border-emerald-300/35 bg-emerald-400/15 text-emerald-100",
    prospect: "border border-sky-300/35 bg-sky-400/15 text-sky-100",
    archived: "border border-slate-300/25 bg-slate-400/15 text-sky-100/75",
    inactive: "border border-slate-300/25 bg-slate-400/15 text-sky-100/75",
  };
  const key = String(status || "").toLowerCase();
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
        statusStyles[key] || "border border-slate-300/25 bg-slate-400/15 text-sky-100/75"
      }`}
    >
      {status || "—"}
    </span>
  );
};

const NewBadge = () => (
  <span className="ml-2 inline-flex items-center rounded-full border border-amber-300/40 bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-100">
    NEW
  </span>
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
      secondary: contact || "—",
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
        toast("No customers endpoint found. Showing an empty list.", { icon: "ℹ️" });
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
          <Link
            to="/app/customer-records"
            className="inline-flex min-h-[42px] items-center rounded-xl border border-white/16 bg-slate-900/70 px-4 py-2.5 text-sm font-semibold text-sky-100 shadow-sm transition hover:border-sky-300/35 hover:bg-sky-500/15"
          >
            Records
          </Link>
          <Link
            to={CUSTOMER_NEW_ROUTE}
            className="inline-flex min-h-[42px] items-center rounded-xl border border-white/70 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-sky-50"
          >
            + Add New Customer
          </Link>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3" data-testid="customers-summary">
        {[
          { label: "Total customers", value: customerSummary.total },
          { label: "Active customers", value: customerSummary.active },
          { label: "Added in last 7 days", value: customerSummary.recent },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-100/60">
              {item.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-white">
              {item.value}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none placeholder:text-sky-100/45 focus:border-sky-300/60"
            placeholder="Search name, company, email, phone…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 260 }}
          />
          <select
            className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60"
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
            className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60"
            value={ordering}
            onChange={(e) => {
              setOrdering(e.target.value);
              setPage(1);
            }}
          >
            <option value="-created_at">Newest</option>
            <option value="created_at">Oldest</option>
            <option value="full_name">Name A→Z</option>
            <option value="-full_name">Name Z→A</option>
            <option value="name">Name A→Z (name)</option>
            <option value="-name">Name Z→A (name)</option>
          </select>
          <select
            className="min-h-[42px] rounded-xl border border-white/15 bg-slate-950/55 px-3 py-2 text-sm font-semibold text-sky-50 outline-none focus:border-sky-300/60"
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

        {loading && <p className="py-10 text-center text-sky-100/65">Loading customers...</p>}
        {!loading && error && <p className="py-10 text-center text-rose-200">{error}</p>}

        {!loading && !error && customers.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/14 bg-slate-950/35 px-6 py-12 text-center">
            <h3 className="text-lg font-semibold text-white">No customers yet</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-sky-100/70">
              Add your first customer to start tracking relationships, job history, and project-ready contact details in one place.
            </p>
            <Link
              to={CUSTOMER_NEW_ROUTE}
              className="mt-5 inline-flex min-h-[42px] items-center rounded-xl border border-white/70 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-sky-50"
            >
              + Add Your First Customer
            </Link>
          </div>
        )}

        {!loading && !error && customers.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/35 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-white/8 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-white">Customer directory</div>
                <div className="text-sm text-sky-100/65">
                  {count} total customer{count === 1 ? "" : "s"} across your account
                </div>
              </div>
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-sky-100/60">
                Page {page} of {totalPages}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-white/10">
                <thead className="bg-white/8 text-sky-100/75">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider">Active Projects</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider">Date Added</th>
                    <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-white/10">
                  {customers.map((customer) => {
                    const cid = String(customer.id ?? customer.uuid ?? customer.pk ?? "");
                    const isNew = newCustomerId && cid && String(newCustomerId) === cid;
                    const { primary, secondary, hasCompany } = getCustomerDisplay(customer);

                    return (
                      <tr
                        key={customer.id ?? customer.uuid ?? customer.pk ?? `${customer.email}-${customer.phone}`}
                        className="text-sky-100/78 transition-colors hover:bg-sky-500/10"
                      >
                        <td className="whitespace-nowrap px-6 py-5">
                          <div className="font-semibold text-white">
                            {primary}
                            {isNew ? <NewBadge /> : null}
                          </div>

                          {hasCompany && secondary ? (
                            <div className="text-sm text-sky-100/65">Contact: {secondary}</div>
                          ) : null}

                          <div className="text-sm text-sky-100/60">{customer.email || "—"}</div>

                          <div className="mt-1 flex items-center text-sm text-sky-100/60">
                            <Phone size={12} className="mr-1.5" />{" "}
                            {formatPhoneNumber(customer.phone_number || customer.phone)}
                          </div>

                          <div className="mt-1 flex items-center text-sm text-sky-100/60">
                            <Home size={12} className="mr-1.5" /> {formatAddress(customer)}
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-6 py-5">
                          <StatusBadge status={customer.status} />
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-center text-sm font-semibold text-white">
                          {customer.active_projects_count ?? 0}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-sm text-sky-100/60">
                          {customer.created_at ? new Date(customer.created_at).toLocaleDateString() : "—"}
                        </td>

                        <td className="whitespace-nowrap px-6 py-5 text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => navigate(customerEditRoute(customer.id))}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/16 bg-slate-900/70 text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-500/15 hover:text-white"
                              title="Edit Customer"
                              type="button"
                            >
                              <Edit size={18} />
                            </button>

                            <button
                              onClick={() => handleDelete(customer.id)}
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

            <div className="flex items-center justify-between border-t border-white/10 bg-white/8 px-4 py-3">
              <div className="text-sm text-sky-100/65">
                Showing {count === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)} of {count}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-xl border border-white/16 bg-slate-900/70 px-3 py-1.5 text-sm font-semibold text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                  type="button"
                >
                  ‹ Prev
                </button>

                <span className="text-sm text-sky-100/65">
                  Page {page} of {totalPages}
                </span>

                <button
                  className="rounded-xl border border-white/16 bg-slate-900/70 px-3 py-1.5 text-sm font-semibold text-sky-100 transition hover:border-sky-300/35 hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                  type="button"
                >
                  Next ›
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ContractorPageSurface>
  );
}
