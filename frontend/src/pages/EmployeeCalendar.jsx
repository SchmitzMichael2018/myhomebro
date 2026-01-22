// frontend/src/pages/EmployeeCalendar.jsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import EmployeeMilestoneModal from "./EmployeeMilestoneModal.jsx";

function dateKey(v) {
  if (!v) return null;

  // If a Date object
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }

  // If already yyyy-mm-dd
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try parsing
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseDate(v) {
  const k = dateKey(v);
  if (!k) return null;
  const d = new Date(k + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function startOfWeekSunday(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfWeekSaturday(d) {
  const x = startOfWeekSunday(d);
  x.setDate(x.getDate() + 6);
  x.setHours(23, 59, 59, 999);
  return x;
}
function fmtMonthYear(d) {
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}
function moneyFmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "$0.00";
  return `$${v.toFixed(2)}`;
}

function milestoneDate(m) {
  return m.completion_date || m.due_date || m.start_date || null;
}

export default function EmployeeCalendar() {
  const [loading, setLoading] = useState(true);
  const [canWork, setCanWork] = useState(false);
  const [milestones, setMilestones] = useState([]);
  const [error, setError] = useState("");

  const [cursorMonth, setCursorMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [activeId, setActiveId] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/projects/employee/milestones/");
      setCanWork(Boolean(res.data?.can_work));
      const list = Array.isArray(res.data?.milestones) ? res.data.milestones : [];
      setMilestones(list);

      // Option A: jump to earliest late+incomplete, else earliest incomplete, else today
      const focus = pickBestFocusDate(list) || new Date();
      setCursorMonth(new Date(focus.getFullYear(), focus.getMonth(), 1));
      setSelectedDay(focus);
    } catch (e) {
      console.error(e);
      setError("Failed to load calendar milestones.");
      setCanWork(false);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function pickBestFocusDate(list) {
    const late = list
      .filter((m) => !m.completed && m.is_late)
      .map((m) => parseDate(milestoneDate(m)))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (late.length) return late[0];

    const incomplete = list
      .filter((m) => !m.completed)
      .map((m) => parseDate(milestoneDate(m)))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (incomplete.length) return incomplete[0];

    return null;
  }

  const byDay = useMemo(() => {
    const map = {};
    for (const m of milestones) {
      const k = dateKey(milestoneDate(m));
      if (!k) continue;
      if (!map[k]) map[k] = [];
      map[k].push(m);
    }
    return map;
  }, [milestones]);

  const monthGrid = useMemo(() => {
    const start = startOfWeekSunday(startOfMonth(cursorMonth));
    const end = endOfWeekSaturday(endOfMonth(cursorMonth));

    const days = [];
    const cur = new Date(start);
    while (cur <= end) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return weeks;
  }, [cursorMonth]);

  const selectedISO = useMemo(() => dateKey(selectedDay), [selectedDay]);
  const selectedMilestones = useMemo(
    () => (selectedISO ? byDay[selectedISO] || [] : []),
    [byDay, selectedISO]
  );

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Calendar</h1>
          <div className="text-sm text-slate-600 mt-1">
            {loading ? "Loading…" : canWork ? "Work enabled" : "Read-only"} • Showing assigned milestones only
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

      <div className="mt-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCursorMonth((d) => addMonths(d, -1))} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 font-semibold">
            ◀
          </button>
          <button type="button" onClick={() => setCursorMonth((d) => addMonths(d, 1))} className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 font-semibold">
            ▶
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setCursorMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedDay(now);
            }}
            className="px-3 py-2 rounded-lg border bg-white hover:bg-slate-50 font-semibold"
          >
            Today
          </button>
        </div>

        <div className="text-lg font-extrabold text-slate-900">{fmtMonthYear(cursorMonth)}</div>

        <div className="text-sm text-slate-600">
          Selected: <span className="font-semibold">{selectedISO || "—"}</span>
        </div>
      </div>

      <div className="mt-4 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-7 bg-slate-50 text-slate-600 text-xs font-semibold">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-3 py-2 border-b border-slate-200">
              {d}
            </div>
          ))}
        </div>

        {monthGrid.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7">
            {week.map((d) => {
              const iso = dateKey(d);
              const inMonth = d.getMonth() === cursorMonth.getMonth();
              const isSelected = iso && selectedISO && iso === selectedISO;

              const items = iso ? byDay[iso] || [] : [];
              const lateCount = items.filter((m) => m.is_late && !m.completed).length;

              return (
                <div
                  key={iso}
                  className={[
                    "h-28 text-left px-3 py-2 border-t border-slate-100 border-r border-slate-100 relative",
                    inMonth ? "bg-white" : "bg-slate-50",
                    isSelected ? "ring-2 ring-blue-600 z-10" : "",
                    "hover:bg-slate-50 transition",
                  ].join(" ")}
                  onClick={() => setSelectedDay(new Date(d))}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex items-center justify-between">
                    <div className={["text-sm font-semibold", inMonth ? "text-slate-900" : "text-slate-400"].join(" ")}>
                      {d.getDate()}
                    </div>

                    {items.length > 0 ? (
                      <span className="text-[10px] font-bold bg-slate-900 text-white px-2 py-0.5 rounded-full">
                        {items.length}
                      </span>
                    ) : null}
                  </div>

                  {lateCount > 0 ? (
                    <div className="mt-2">
                      <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded">
                        {lateCount} late
                      </span>
                    </div>
                  ) : null}

                  {/* ✅ clickable milestone chips */}
                  {items.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      {items.slice(0, 2).map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveId(m.id);
                          }}
                          className="w-full text-left text-[11px] px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white truncate"
                          title={m.title}
                        >
                          {m.title}
                        </button>
                      ))}
                      {items.length > 2 ? (
                        <div className="text-[11px] text-slate-600">…</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="font-semibold text-slate-900">Milestones on {selectedISO || "—"}</div>
          <div className="text-xs text-slate-500">{selectedMilestones.length} item(s)</div>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="text-slate-500">Loading…</div>
          ) : selectedMilestones.length === 0 ? (
            <div className="text-slate-500">No assigned milestones for this day.</div>
          ) : (
            <div className="space-y-3">
              {selectedMilestones.map((m) => (
                <div key={m.id} className="rounded-lg border border-slate-200 p-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold text-slate-900 truncate">{m.title || `Milestone #${m.id}`}</div>
                      {m.is_late && !m.completed ? (
                        <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded">late</span>
                      ) : null}
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      Agreement #{m.agreement_number || m.agreement_id || "—"} • Amount {moneyFmt(m.amount)}
                    </div>
                    {(m.project_title || m.customer_name || m.project_address) ? (
                      <div className="text-xs text-slate-500 mt-1">
                        {m.project_title ? <span className="mr-2"><b>Project:</b> {m.project_title}</span> : null}
                        {m.customer_name ? <span className="mr-2"><b>Customer:</b> {m.customer_name}</span> : null}
                        {m.project_address ? <span><b>Address:</b> {m.project_address}</span> : null}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveId(m.id)}
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeId ? (
        <EmployeeMilestoneModal milestoneId={activeId} onClose={() => setActiveId(null)} onUpdated={load} />
      ) : null}
    </div>
  );
}
