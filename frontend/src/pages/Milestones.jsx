// src/pages/Milestones.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";
import MilestoneDetailModal from "../components/MilestoneDetailModal"; // uses your existing modal

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "incomplete", label: "Incomplete" },
  { key: "complete", label: "Complete (Ready for Review)" },
];

export default function Milestones() {
  const query = useQuery();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);

  const filterKey = query.get("filter") || "all";

  useEffect(() => {
    setLoading(true);
    // Server may accept ?status=; we also filter client-side.
    const params = new URLSearchParams();
    if (filterKey === "incomplete") params.set("status", "incomplete");
    if (filterKey === "complete") params.set("status", "complete");
    const url = params.toString() ? `/milestones/?${params}` : "/milestones/";

    api
      .get(url)
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .finally(() => setLoading(false));
  }, [filterKey]);

  const filtered = useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    if (filterKey === "all") return list;
    const statusOf = (m) =>
      (m.status || (m.completed ? "complete" : "incomplete")).toLowerCase();
    return list.filter((m) => statusOf(m) === filterKey);
  }, [items, filterKey]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Milestones</h1>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const isActive = filterKey === f.key;
          const href = `/milestones?filter=${encodeURIComponent(f.key)}`;
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

      {/* Table */}
      <div className="mt-4 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 text-sm text-slate-600">
          {loading ? "Loading…" : `${filtered.length} milestone(s)`}
        </div>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Title</th>
              <th className="text-left px-4 py-3">Agreement</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const status =
                (m.status || (m.completed ? "complete" : "incomplete")).toLowerCase();
              const date = m.completion_date || m.scheduled_date || m.start_date || "—";
              const amt =
                typeof m.amount === "number"
                  ? `$${m.amount.toFixed(2)}`
                  : m.amount
                  ? `$${Number(m.amount).toFixed(2)}`
                  : "—";
              return (
                <tr
                  key={m.id}
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setActive(m)}
                  title="Open milestone details"
                >
                  <td className="px-4 py-3">{m.title || m.name || "Untitled"}</td>
                  <td className="px-4 py-3">
                    {m.agreement_title || (m.agreement ? `Agreement #${m.agreement}` : "—")}
                  </td>
                  <td className="px-4 py-3 capitalize">{status}</td>
                  <td className="px-4 py-3">{date}</td>
                  <td className="px-4 py-3 text-right">{amt}</td>
                </tr>
              );
            })}

            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  No milestones found for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal: reuses your existing component */}
      <MilestoneDetailModal
        visible={!!active}
        milestone={active}
        onClose={() => setActive(null)}
      />
    </div>
  );
}
