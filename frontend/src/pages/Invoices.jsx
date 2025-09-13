// src/pages/Invoices.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";
import InvoiceList from "../components/InvoiceList";

function useQuery() {
  const { search } = useLocation();
  return React.useMemo(() => new URLSearchParams(search), [search]);
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending_approval", label: "Pending Approval" },
  { key: "approved", label: "Approved (Ready for Payout)" },
  { key: "paid", label: "Paid / Earned" },
  { key: "disputed", label: "Disputed" },
];

export default function Invoices() {
  const query = useQuery();
  const filterKey = query.get("filter") || "all";

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch all; server may support ?status= but we also filter client-side
  useEffect(() => {
    setLoading(true);
    api.get("/invoices/")
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (filterKey === "all") return items;
    if (filterKey === "pending_approval") {
      // treat "pending" and "pending_approval" as the same bucket
      return items.filter((i) => {
        const s = String(i.status || "").toLowerCase();
        return s === "pending" || s === "pending_approval";
      });
    }
    return items.filter((i) => String(i.status || "").toLowerCase() === filterKey);
  }, [items, filterKey]);

  return (
    <div className="p-0">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Invoices</h1>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const isActive = filterKey === f.key;
            const href = `/invoices?filter=${encodeURIComponent(f.key)}`;
            return (
              <a
                key={f.key}
                href={href}
                className={`px-3 py-1.5 rounded-full text-sm border transition ${
                  isActive
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </a>
            );
          })}
        </div>
      </div>

      {/* Your grouped list UI; rows link to /invoices/:id which uses your InvoiceDetail */}
      <InvoiceList key={filterKey} initialData={filtered} />
    </div>
  );
}
