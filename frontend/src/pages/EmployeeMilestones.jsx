// frontend/src/pages/EmployeeMilestones.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import EmployeeMilestoneModal from "./EmployeeMilestoneModal.jsx";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "late", label: "Late" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming (7 days)" },
  { key: "incomplete", label: "Incomplete" },
  { key: "complete", label: "Completed" },
];

function dateOnly(v) {
  if (!v) return null;
  return String(v).slice(0, 10);
}

function hasAnyContextRow(rows) {
  return rows.some(
    (m) =>
      (m.project_title && String(m.project_title).trim()) ||
      (m.customer_name && String(m.customer_name).trim()) ||
      (m.project_address && String(m.project_address).trim())
  );
}

export default function EmployeeMilestones() {
  const query = useQuery();
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [canWork, setCanWork] = useState(false);
  const [milestones, setMilestones] = useState([]);

  const [activeId, setActiveId] = useState(null);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const filter = query.get("filter") || "all";

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/projects/employee/milestones/");
      setCanWork(Boolean(res.data?.can_work));
      setMilestones(Array.isArray(res.data?.milestones) ? res.data.milestones : []);
    } catch (e) {
      console.error(e);
      setCanWork(false);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function setFilterAndUrl(next) {
    const params = new URLSearchParams(location.search);
    if (!next || next === "all") params.delete("filter");
    else params.set("filter", next);

    navigate(
      { pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : "" },
      { replace: false }
    );
  }

  const filtered = useMemo(() => {
    if (filter === "all") return milestones;

    if (filter === "late") return milestones.filter((m) => !!m.is_late && !m.completed);

    if (filter === "today") {
      return milestones.filter((m) => {
        const due = m.completion_date || m.due_date || m.start_date;
        const start = m.start_date;
        return dateOnly(due) === todayISO || dateOnly(start) === todayISO;
      });
    }

    if (filter === "upcoming") {
      const now = new Date();
      const limit = new Date();
      limit.setDate(now.getDate() + 7);

      return milestones.filter((m) => {
        if (m.completed) return false;
        const dueRaw = m.completion_date || m.due_date || m.start_date;
        const d = new Date(dueRaw);
        if (Number.isNaN(d.getTime())) return false;
        return d >= now && d <= limit;
      });
    }

    if (filter === "incomplete") return milestones.filter((m) => !m.completed);
    if (filter === "complete") return milestones.filter((m) => !!m.completed);

    return milestones;
  }, [milestones, filter, todayISO]);

  const showContextCols = useMemo(() => hasAnyContextRow(filtered), [filtered]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Assigned Milestones</h1>
          <div className="text-sm text-slate-600 mt-1">
            {loading ? "Loading…" : canWork ? "Work enabled" : "Read-only"}
          </div>
        </div>

        <button
          type="button"
          onClick={load}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 font-semibold hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilterAndUrl(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition ${
              filter === f.key
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-4 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 text-sm text-slate-600">
          {loading ? "Loading…" : `${filtered.length} milestone(s)`}
        </div>

        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Title</th>
              <th className="text-left px-4 py-3">Agreement</th>

              {showContextCols && (
                <>
                  <th className="text-left px-4 py-3">Project</th>
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3">Address</th>
                </>
              )}

              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Due</th>
              <th className="text-right px-4 py-3">Amount</th>
            </tr>
          </thead>

          <tbody>
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={showContextCols ? 8 : 5} className="px-4 py-10 text-center text-slate-500">
                  No milestones found.
                </td>
              </tr>
            ) : (
              filtered.map((m) => {
                const due = (m.completion_date || m.due_date || m.start_date || "—").toString().slice(0, 10);
                const amt = m.amount != null ? `$${Number(m.amount).toFixed(2)}` : "—";
                const agNo = m.agreement_number || m.agreement_id || "—";

                return (
                  <tr
                    key={m.id}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setActiveId(m.id)}
                    title="Open milestone details"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {m.title || `Milestone #${m.id}`}
                      {m.is_late && !m.completed ? (
                        <span className="ml-2 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded">
                          late
                        </span>
                      ) : null}
                    </td>

                    <td className="px-4 py-3">#{agNo}</td>

                    {showContextCols && (
                      <>
                        <td className="px-4 py-3">{m.project_title || "—"}</td>
                        <td className="px-4 py-3">{m.customer_name || "—"}</td>
                        <td className="px-4 py-3">{m.project_address || "—"}</td>
                      </>
                    )}

                    <td className="px-4 py-3">{m.completed ? "Completed" : "Assigned"}</td>
                    <td className="px-4 py-3">{due}</td>
                    <td className="px-4 py-3 text-right">{amt}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {activeId ? (
        <EmployeeMilestoneModal
          milestoneId={activeId}
          onClose={() => setActiveId(null)}
          onUpdated={load}
        />
      ) : null}
    </div>
  );
}
