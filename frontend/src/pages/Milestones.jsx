// src/pages/Milestones.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";
import MilestoneDetailModal from "../components/MilestoneDetailModal";

/* ---------------- helpers ---------------- */

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "late", label: "Late" },
  { key: "incomplete", label: "Incomplete" },
  { key: "complete_not_invoiced", label: "Completed (Not Invoiced)" },
  { key: "invoiced", label: "Invoiced" },
  { key: "paid", label: "Paid" },
  { key: "rework", label: "Rework Work Orders" },
];

const norm = (v) => String(v || "").toLowerCase();

const isReworkMilestone = (m) => {
  const t = String(m?.title || m?.name || "").toLowerCase();
  if (!t) return false;
  if (m?.rework_origin_milestone_id) return true;
  return t.startsWith("rework — dispute #") || (t.includes("rework") && t.includes("dispute #"));
};

const getPhaseLabel = (m) => {
  const completed =
    m?.completed === true ||
    norm(m?.status) === "complete" ||
    norm(m?.status) === "completed";

  const invoiced =
    m?.is_invoiced === true ||
    Boolean(m?.invoice_id || m?.invoice || m?.invoiceId);

  const s = norm(m?.status);
  if (s.includes("paid") || s.includes("released")) return "paid";

  if (!completed) return "incomplete";
  if (completed && !invoiced) return "complete_not_invoiced";
  return "invoiced";
};

const isLate = (m) => {
  if (m?.completed === true) return false;

  const raw =
    m?.due_date ||
    m?.scheduled_for ||
    m?.date_due ||
    m?.date ||
    m?.end_date ||
    m?.completion_date ||
    m?.endDate ||
    null;

  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d < startToday;
};

/* ---------------- component ---------------- */

export default function Milestones() {
  const query = useQuery();

  const [who, setWho] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);

  const filterKey = query.get("filter") || "all";
  const isEmployee = who?.role && String(who.role).startsWith("employee_");

  /* ---------- load whoami ---------- */
  useEffect(() => {
    let mounted = true;
    api
      .get("/projects/whoami/")
      .then((res) => mounted && setWho(res.data || null))
      .catch(() => mounted && setWho(null));
    return () => {
      mounted = false;
    };
  }, []);

  /* ---------- load milestones ---------- */
  useEffect(() => {
    if (!who) return;
    setLoading(true);

    if (isEmployee) {
      api
        .get("/projects/employee/milestones/")
        .then((res) => {
          const list = Array.isArray(res.data?.milestones)
            ? res.data.milestones
            : [];
          setItems(list);
        })
        .finally(() => setLoading(false));
      return;
    }

    api
      .get("/milestones/")
      .then((res) => {
        const list = Array.isArray(res.data)
          ? res.data
          : res.data?.results || [];
        setItems(list);
      })
      .finally(() => setLoading(false));
  }, [who, isEmployee]);

  /* ---------- filtering ---------- */
  const filtered = useMemo(() => {
    let r = items;

    // ✅ Rework milestones ONLY appear in rework tab
    if (filterKey === "rework") {
      return r.filter(isReworkMilestone);
    }

    // ✅ ALL other tabs explicitly EXCLUDE rework milestones
    r = r.filter((m) => !isReworkMilestone(m));

    if (filterKey === "late") {
      return r.filter((m) => isLate(m) && getPhaseLabel(m) !== "paid");
    }
    if (filterKey === "incomplete") {
      return r.filter((m) => getPhaseLabel(m) === "incomplete");
    }
    if (filterKey === "complete_not_invoiced") {
      return r.filter((m) => getPhaseLabel(m) === "complete_not_invoiced");
    }
    if (filterKey === "invoiced") {
      return r.filter((m) => getPhaseLabel(m) === "invoiced");
    }
    if (filterKey === "paid") {
      return r.filter((m) => getPhaseLabel(m) === "paid");
    }

    return r;
  }, [items, filterKey]);

  /* ---------------- render ---------------- */

  const title =
    filterKey === "rework"
      ? "Rework Work Orders"
      : isEmployee
      ? "My Assigned Milestones"
      : "Milestones";

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">{title}</h1>

      {!isEmployee && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const isActive = filterKey === f.key;
            const href = `/app/milestones?filter=${encodeURIComponent(f.key)}`;

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
      )}

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
              const status = norm(m.status || (m.completed ? "complete" : "incomplete"));
              const date =
                m.completion_date || m.scheduled_date || m.start_date || "—";
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
                >
                  <td className="px-4 py-3">{m.title || m.name || "Untitled"}</td>
                  <td className="px-4 py-3">
                    {m.agreement_title ||
                      (m.agreement ? `Agreement #${m.agreement}` : "—")}
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
                  {filterKey === "rework"
                    ? "No rework milestones found."
                    : "No milestones found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <MilestoneDetailModal
        visible={!!active}
        milestone={active}
        onClose={() => setActive(null)}
      />
    </div>
  );
}
