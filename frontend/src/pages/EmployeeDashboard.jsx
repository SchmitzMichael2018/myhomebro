// src/pages/EmployeeDashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import EmployeeMilestoneModal from "./EmployeeMilestoneModal.jsx";
import RoleAwareWorkboard from "../components/RoleAwareWorkboard.jsx";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

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
    <ContractorPageSurface
      eyebrow="Team workspace"
      title="My Assigned Work"
      subtitle="Review your schedule, open assigned milestones, and submit completed work for lead-contractor review."
      variant="operational"
      className="mx-auto max-w-[1180px]"
      contentClassName="space-y-5"
      actions={
        <div className="flex items-center gap-3">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${canWork ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-100" : "border-amber-300/35 bg-amber-400/10 text-amber-100"}`}>
            {loading ? "Loading…" : canWork ? "Work enabled" : "Read-only"}
          </span>
          <button
            type="button"
            onClick={load}
            className="mhb-btn primary px-4 py-2 text-sm font-semibold"
          >
            Refresh
          </button>
        </div>
      }
    >
      <div data-testid="employee-dashboard-operational" className="space-y-5">

        {error ? (
          <div className="rounded-xl border border-red-300/35 bg-red-400/10 p-4 text-red-100">
            {error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-white/10 bg-[#071d42]/80 p-4 shadow-[0_18px_46px_rgba(2,8,23,0.2)] md:p-5">
          <div className="mb-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-100/60">Today</div>
            <h2 className="mt-1 text-xl font-bold text-white">Workboard</h2>
            <p className="mt-1 text-sm text-sky-100/70">Your most urgent assigned work and recent updates.</p>
          </div>
          <RoleAwareWorkboard />
        </section>

        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-100/60">Milestones</div>
            <h2 className="mt-1 text-xl font-bold text-white">Assigned milestone schedule</h2>
          </div>
          <button type="button" onClick={() => navigate("/app/employee/milestones")} className="mhb-btn px-4 py-2 text-sm font-semibold">
            View all {loading ? "" : `(${milestones.length})`}
          </button>
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
    </ContractorPageSurface>
  );
}

function Section({ title, onHeaderClick, loading, items, emptyText, canWork, onOpen, onComplete, busyId }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-[#071d42]/80 shadow-[0_18px_46px_rgba(2,8,23,0.2)]">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-900">
          <button type="button" className="cursor-pointer hover:underline" onClick={onHeaderClick}>
          {title}
          </button>
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
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen?.(m.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
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
    </section>
  );
}
