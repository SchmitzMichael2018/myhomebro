// src/pages/Milestones.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";
import MilestoneDetailModal from "../components/MilestoneDetailModal";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

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
  return t.startsWith("rework") || (t.includes("rework") && t.includes("dispute #"));
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

export default function Milestones() {
  const query = useQuery();

  const [who, setWho] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);

  const filterKey = query.get("filter") || "all";
  const isEmployee = who?.role && String(who.role).startsWith("employee_");

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

  useEffect(() => {
    if (!who) return;
    setLoading(true);

    if (isEmployee) {
      api
        .get("/projects/employee/milestones/")
        .then((res) => {
          const list = Array.isArray(res.data?.milestones) ? res.data.milestones : [];
          setItems(list);
        })
        .finally(() => setLoading(false));
      return;
    }

    api
      .get("/milestones/")
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data : res.data?.results || [];
        setItems(list);
      })
      .finally(() => setLoading(false));
  }, [who, isEmployee]);

  const filtered = useMemo(() => {
    let rows = items;

    if (filterKey === "rework") return rows.filter(isReworkMilestone);

    rows = rows.filter((m) => !isReworkMilestone(m));

    if (filterKey === "late") {
      return rows.filter((m) => isLate(m) && getPhaseLabel(m) !== "paid");
    }
    if (filterKey === "incomplete") {
      return rows.filter((m) => getPhaseLabel(m) === "incomplete");
    }
    if (filterKey === "complete_not_invoiced") {
      return rows.filter((m) => getPhaseLabel(m) === "complete_not_invoiced");
    }
    if (filterKey === "invoiced") {
      return rows.filter((m) => getPhaseLabel(m) === "invoiced");
    }
    if (filterKey === "paid") {
      return rows.filter((m) => getPhaseLabel(m) === "paid");
    }

    return rows;
  }, [items, filterKey]);

  const title =
    filterKey === "rework"
      ? "Rework Work Orders"
      : isEmployee
        ? "My Assigned Milestones"
        : "Milestones";

  const summary = useMemo(() => {
    const total = items.length;
    const activeCount = items.filter((m) => {
      const phase = getPhaseLabel(m);
      return phase === "incomplete" || phase === "complete_not_invoiced";
    }).length;
    const lateCount = items.filter((m) => isLate(m) && getPhaseLabel(m) !== "paid").length;
    const recentCompleted = items.filter((m) => {
      if (!m?.completion_date) return false;
      const completed = new Date(m.completion_date);
      if (Number.isNaN(completed.getTime())) return false;
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      return completed >= sevenDaysAgo;
    }).length;
    return { total, activeCount, lateCount, recentCompleted };
  }, [items]);

  return (
    <ContractorPageSurface
      eyebrow="Work"
      title={title}
      subtitle="Track progress, review late work, and keep each agreement moving without digging through every project."
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="milestones-summary">
        {[
          { label: "Total milestones", value: summary.total },
          { label: "Active work", value: summary.activeCount },
          { label: "Late items", value: summary.lateCount },
          { label: "Completed in last 7 days", value: summary.recentCompleted },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              {item.label}
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
              {item.value}
            </div>
          </div>
        ))}
      </div>

      {!isEmployee && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm text-slate-600">
            Use filters to focus on what needs attention first, then open any milestone for details, review, or payout context.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => {
              const isActive = filterKey === f.key;
              const href = `/app/milestones?filter=${encodeURIComponent(f.key)}`;

              return (
                <a
                  key={f.key}
                  href={href}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    isActive
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {f.label}
                </a>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3 text-sm text-slate-600">
          {loading ? "Loading…" : `${filtered.length} milestone(s)`}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Title</th>
                <th className="px-4 py-3 text-left">Agreement</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((m) => {
                const status = norm(m.status || (m.completed ? "complete" : "incomplete"));
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
                    className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50/80"
                    onClick={() => setActive(m)}
                  >
                    <td className="px-4 py-4 font-medium text-slate-900">
                      {m.title || m.name || "Untitled"}
                    </td>
                    <td className="px-4 py-3">
                      {m.agreement_title || (m.agreement ? `Agreement #${m.agreement}` : "—")}
                    </td>
                    <td className="px-4 py-3 capitalize">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{date}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">{amt}</td>
                  </tr>
                );
              })}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                    <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8">
                      <div className="text-base font-semibold text-slate-900">
                        {filterKey === "rework" ? "No rework milestones found" : "No milestones found"}
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">
                        {filterKey === "rework"
                          ? "Rework items will appear here once a dispute or corrective workflow creates them."
                          : "Track milestone progress here as agreements move into active work, completion, and payout review."}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <MilestoneDetailModal
        visible={!!active}
        milestone={active}
        onClose={() => setActive(null)}
      />
    </ContractorPageSurface>
  );
}
