// src/pages/EmployeeDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import EmployeeMilestoneModal from "./EmployeeMilestoneModal.jsx";

function dateOnly(v) {
  if (!v) return null;
  return String(v).slice(0, 10);
}

function moneyFmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toFixed(2)}`;
}

export default function EmployeeDashboard() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [canWork, setCanWork] = useState(false);
  const [milestones, setMilestones] = useState([]);
  const [error, setError] = useState("");

  const [activeId, setActiveId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/projects/employee/milestones/");
      setCanWork(Boolean(res.data?.can_work));
      setMilestones(Array.isArray(res.data?.milestones) ? res.data.milestones : []);
    } catch (e) {
      console.error(e);
      setError("Failed to load assigned milestones.");
      setCanWork(false);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const totalAmount = useMemo(
    () => milestones.reduce((sum, m) => sum + Number(m.amount || 0), 0),
    [milestones]
  );

  const lateItems = useMemo(
    () => milestones.filter((m) => !!m.is_late && !m.completed),
    [milestones]
  );

  const todayItems = useMemo(() => {
    return milestones.filter((m) => {
      const due = m.completion_date || m.due_date || m.start_date;
      const start = m.start_date;
      return dateOnly(due) === todayISO || dateOnly(start) === todayISO;
    });
  }, [milestones, todayISO]);

  const upcomingItems = useMemo(() => {
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
  }, [milestones]);

  function openList(filterKey) {
    navigate(`/app/employee/milestones?filter=${encodeURIComponent(filterKey)}`);
  }

  function openBucket(items, filterKey) {
    if (items.length === 1) {
      setActiveId(items[0].id);
      return;
    }
    openList(filterKey);
  }

  async function markComplete(id) {
    if (!canWork || !id) return;

    setBusyId(id);
    try {
      await api.post(`/projects/employee/milestones/${id}/complete/`);
      await load();
    } catch (e) {
      console.error(e);
      setError("Could not mark complete.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-700 via-blue-600 to-yellow-200 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Team Member</h1>
            <p className="text-slate-800/80 mt-1">
              Here are the milestones assigned to you.
            </p>
            <div className="mt-2 text-xs font-semibold text-slate-700">
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

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard title="TODAY" value={loading ? "…" : todayItems.length} onClick={() => openBucket(todayItems, "today")} />
          <StatCard title="UPCOMING (7 DAYS)" value={loading ? "…" : upcomingItems.length} onClick={() => openBucket(upcomingItems, "upcoming")} />
          <StatCard title="LATE" value={loading ? "…" : lateItems.length} accent="danger" onClick={() => openBucket(lateItems, "late")} />
          <StatCard title="TOTAL" value={loading ? "…" : milestones.length} sub={loading ? "" : moneyFmt(totalAmount)} onClick={() => navigate("/app/employee/milestones")} />
        </div>

        <Section
          title="Late Milestones"
          onHeaderClick={() => openList("late")}
          loading={loading}
          items={lateItems}
          emptyText="No late milestones."
          canWork={canWork}
          onOpen={(id) => setActiveId(id)}
          onComplete={markComplete}
          busyId={busyId}
        />

        <Section
          title="Today's Milestones"
          onHeaderClick={() => openList("today")}
          loading={loading}
          items={todayItems}
          emptyText="No milestones today."
          canWork={canWork}
          onOpen={(id) => setActiveId(id)}
          onComplete={markComplete}
          busyId={busyId}
        />

        <Section
          title="Upcoming (Next 7 Days)"
          onHeaderClick={() => openList("upcoming")}
          loading={loading}
          items={upcomingItems}
          emptyText="No upcoming milestones."
          canWork={canWork}
          onOpen={(id) => setActiveId(id)}
          onComplete={markComplete}
          busyId={busyId}
        />
      </div>

      {activeId ? (
        <EmployeeMilestoneModal milestoneId={activeId} onClose={() => setActiveId(null)} onUpdated={load} />
      ) : null}
    </div>
  );
}

function StatCard({ title, value, sub = "", accent = "normal", onClick }) {
  const ring = accent === "danger" ? "ring-2 ring-red-500" : "ring-1 ring-black/5";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={[
        "rounded-xl bg-white shadow-sm border border-slate-100 p-5",
        ring,
        "cursor-pointer hover:shadow-md transition",
      ].join(" ")}
    >
      <div className="text-xs font-semibold tracking-wider text-slate-500">{title}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-sm font-semibold text-slate-700">{sub}</div> : null}
    </div>
  );
}

function Section({ title, onHeaderClick, loading, items, emptyText, canWork, onOpen, onComplete, busyId }) {
  return (
    <div className="mt-6 rounded-xl bg-white shadow-sm border border-slate-100">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 cursor-pointer hover:underline" onClick={onHeaderClick}>
          {title}
        </h2>
        <div className="text-xs font-semibold text-slate-500">
          {loading ? "" : canWork ? "Work enabled" : "Read-only"}
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-slate-500">{emptyText}</div>
        ) : (
          <div className="space-y-3">
            {items.map((m) => {
              const due = dateOnly(m.completion_date || m.due_date || m.start_date) || "—";
              const amt = moneyFmt(m.amount);

              // Optional extra fields if present (won’t break if missing)
              const projectTitle = m.project_title || m.projectTitle || "";
              const customerName = m.customer_name || m.homeowner_name || "";
              const address = m.project_address || m.address || "";

              return (
                <div key={m.id} className="rounded-lg border border-slate-200 p-4 flex items-start justify-between gap-4">
                  <div
                    className="min-w-0 flex-1 cursor-pointer hover:bg-slate-50 rounded-lg p-2 -m-2"
                    onClick={() => onOpen?.(m.id)}
                    title="Open milestone details"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold text-slate-900 truncate">{m.title || `Milestone #${m.id}`}</div>
                      {m.is_late && !m.completed ? (
                        <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded">late</span>
                      ) : null}
                    </div>

                    <div className="text-sm text-slate-600 mt-1">
                      Agreement #{m.agreement_id || "—"} • Due: {due} • Amount: {amt}
                    </div>

                    {(projectTitle || customerName || address) ? (
                      <div className="text-xs text-slate-500 mt-1">
                        {projectTitle ? <span className="mr-2"><b>Project:</b> {projectTitle}</span> : null}
                        {customerName ? <span className="mr-2"><b>Customer:</b> {customerName}</span> : null}
                        {address ? <span><b>Address:</b> {address}</span> : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <div className="text-sm font-semibold text-slate-700">{m.completed ? "completed" : "assigned"}</div>

                    {!m.completed ? (
                      <button
                        type="button"
                        onClick={() => onComplete?.(m.id)}
                        disabled={!canWork || busyId === m.id}
                        className={[
                          "px-4 py-2 rounded-lg text-sm font-semibold",
                          !canWork
                            ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                            : "bg-blue-600 hover:bg-blue-700 text-white",
                        ].join(" ")}
                      >
                        {busyId === m.id ? "Saving…" : "Mark Complete"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
