// src/components/Customers.jsx
// v2025-11-11 — canonical /projects/homeowners/ first; same UX
// v2026-02-09 — NEW badge + toast when arriving from invite acceptance
// v2026-02-09b — FIX: route all customer navigation under /app/* to avoid landing fallback
// v2026-02-11 — Company Name support (subcontractor customers): show company as primary line when present

import React, { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Edit, Trash2, Home, Phone } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";

/** Debounce helper (local, no deps) */
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
    active: "bg-green-100 text-green-800",
    prospect: "bg-blue-100 text-blue-800",
    archived: "bg-gray-100 text-gray-800",
    inactive: "bg-gray-100 text-gray-800",
  };
  const key = String(status || "").toLowerCase();
  return (
    <span
      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full capitalize ${
        statusStyles[key] || "bg-gray-100 text-gray-800"
      }`}
    >
      {status || "—"}
    </span>
  );
};

const NewBadge = () => (
  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
    NEW
  </span>
);

const formatPhoneNumber = (phoneStr) => {
  if (!phoneStr) return "N/A";
  const cleaned = ("" + phoneStr).replace(/\D/g, "");
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
  return phoneStr;
};

/** Format structured address for display */
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

/** Candidate API paths to try, in order (canonical first) */
const ENDPOINTS = [
  "/projects/homeowners/", // canonical
  "/homeowners/", // legacy; api.js remaps this to /projects/homeowners now
  "/customers/",
  "/projects/customers/",
];

/** Normalize payload (paginated or array) to a plain list */
function normalizeResults(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

// ✅ NEW: helper to display company/contact cleanly
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

  // ✅ App base routes
  const CUSTOMER_LIST_ROUTE = "/app/customers";
  const CUSTOMER_NEW_ROUTE = "/app/customers/new";
  const customerEditRoute = (id) => `/app/customers/${id}/edit`;

  // "NEW" highlight from invite acceptance
  const [newCustomerId, setNewCustomerId] = useState(null);

  // Data
  const [customers, setCustomers] = useState([]);
  const [count, setCount] = useState(0);

  // Which endpoint worked (used for delete)
  const [usedEndpoint, setUsedEndpoint] = useState("");

  // UI / query params
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

  // Parse ?new_customer_id=... and show a toast + badge
  useEffect(() => {
    try {
      const sp = new URLSearchParams(location.search || "");
      const raw = (sp.get("new_customer_id") || "").trim();
      if (!raw) return;

      setNewCustomerId(raw);
      toast.success("Customer created successfully!");

      // Remove only the param so the badge/toast doesn't repeat on refresh
      sp.delete("new_customer_id");
      const nextSearch = sp.toString() ? `?${sp.toString()}` : "";
      navigate(`${location.pathname}${nextSearch}`, { replace: true });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          if (st && st !== 404) {
            throw e;
          }
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
  }, [page, pageSize, ordering, qDebounced, status]);

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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-3xl font-bold text-gray-800">My Customers</h1>

        {/* ✅ FIX: use /app/customers/new */}
        <Link
          to={CUSTOMER_NEW_ROUTE}
          className="inline-flex items-center bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg shadow-sm transition-transform hover:scale-105"
        >
          + Add New Customer
        </Link>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="border rounded px-3 py-2"
          placeholder="Search name, company, email, phone…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 260 }}
        />
        <select
          className="border rounded px-2 py-2"
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
          className="border rounded px-2 py-2"
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
          className="border rounded px-2 py-2"
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

      {/* Content */}
      {loading && <p className="text-center text-gray-500 py-10">Loading customers...</p>}
      {!loading && error && <p className="text-center text-red-500 py-10">{error}</p>}

      {!loading && !error && customers.length === 0 && (
        <div className="text-center py-10 bg-white rounded-lg shadow-md">
          <h3 className="text-lg font-semibold text-gray-700">No Customers Yet</h3>
          <p className="text-gray-500 mt-2 mb-4">Add your first customer to get started.</p>

          {/* ✅ FIX: use /app/customers/new */}
          <Link
            to={CUSTOMER_NEW_ROUTE}
            className="mt-4 inline-block bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg"
          >
            + Add Your First Customer
          </Link>
        </div>
      )}

      {!loading && !error && customers.length > 0 && (
        <div className="overflow-x-auto bg-white shadow-md rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="py-3 px-6 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Active Projects
                </th>
                <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date Added
                </th>
                <th className="py-3 px-6 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="bg-white divide-y divide-gray-200">
              {customers.map((customer) => {
                const cid = String(customer.id ?? customer.uuid ?? customer.pk ?? "");
                const isNew = newCustomerId && cid && String(newCustomerId) === cid;

                const { primary, secondary, hasCompany } = getCustomerDisplay(customer);

                return (
                  <tr
                    key={customer.id ?? customer.uuid ?? customer.pk ?? `${customer.email}-${customer.phone}`}
                  >
                    <td className="py-4 px-6 whitespace-nowrap">
                      <div className="font-medium text-gray-900">
                        {primary}
                        {isNew ? <NewBadge /> : null}
                      </div>

                      {/* ✅ show contact name when company is present */}
                      {hasCompany && secondary ? (
                        <div className="text-sm text-gray-600">
                          Contact: {secondary}
                        </div>
                      ) : null}

                      <div className="text-sm text-gray-500">{customer.email || "—"}</div>

                      <div className="text-sm text-gray-500 flex items-center mt-1">
                        <Phone size={12} className="mr-1.5" />{" "}
                        {formatPhoneNumber(customer.phone_number || customer.phone)}
                      </div>

                      <div className="text-sm text-gray-500 flex items-center mt-1">
                        <Home size={12} className="mr-1.5" /> {formatAddress(customer)}
                      </div>
                    </td>

                    <td className="py-4 px-6 whitespace-nowrap">
                      <StatusBadge status={customer.status} />
                    </td>

                    <td className="py-4 px-6 whitespace-nowrap text-center text-sm font-medium">
                      {customer.active_projects_count ?? 0}
                    </td>

                    <td className="py-4 px-6 whitespace-nowrap text-sm text-gray-500">
                      {customer.created_at ? new Date(customer.created_at).toLocaleDateString() : "—"}
                    </td>

                    <td className="py-4 px-6 whitespace-nowrap text-right text-sm font-medium space-x-4">
                      {/* ✅ FIX: navigate under /app */}
                      <button
                        onClick={() => navigate(customerEditRoute(customer.id))}
                        className="text-blue-600 hover:text-blue-800 transition-colors"
                        title="Edit Customer"
                        type="button"
                      >
                        <Edit size={18} />
                      </button>

                      <button
                        onClick={() => handleDelete(customer.id)}
                        className="text-red-600 hover:text-red-800 transition-colors"
                        title="Delete Customer"
                        type="button"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="text-sm text-gray-600">
              Showing {count === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)} of {count}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="border rounded px-3 py-1 disabled:opacity-50"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                type="button"
              >
                ‹ Prev
              </button>

              <span className="text-sm">
                Page {page} of {totalPages}
              </span>

              <button
                className="border rounded px-3 py-1 disabled:opacity-50"
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
  );
}
