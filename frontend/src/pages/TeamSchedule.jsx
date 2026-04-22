// src/pages/TeamSchedule.jsx
// v2026-01-03 — Contractor-only Team Schedule UI (Sun–Sat)
// UPDATED: selected day buttons use MyHomeBro blue theme

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";

import { listSubaccounts } from "../api/subaccounts";
import api from "../api";
import {
  fetchSubaccountSchedule,
  updateSubaccountSchedule,
  addScheduleException,
  deleteScheduleException,
} from "../api/schedule";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

function Chip({ children, tone = "neutral" }) {
  const cls =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-gray-200 bg-gray-50 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function dayLabel(key) {
  switch (key) {
    case "work_sun":
      return "Sun";
    case "work_mon":
      return "Mon";
    case "work_tue":
      return "Tue";
    case "work_wed":
      return "Wed";
    case "work_thu":
      return "Thu";
    case "work_fri":
      return "Fri";
    case "work_sat":
      return "Sat";
    default:
      return key;
  }
}

const DAY_FIELDS = ["work_sun", "work_mon", "work_tue", "work_wed", "work_thu", "work_fri", "work_sat"];

function formatRangeDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function formatRangeDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

export default function TeamSchedule() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  const [schedule, setSchedule] = useState(null);
  const [exceptions, setExceptions] = useState([]);
  const [assignmentEvents, setAssignmentEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [exDate, setExDate] = useState("");
  const [exIsWorking, setExIsWorking] = useState(false);
  const [exNote, setExNote] = useState("");

  async function loadEmployees() {
    setLoading(true);
    try {
      const data = await listSubaccounts();
      setSubs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load employees.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSchedule(subaccountId) {
    if (!subaccountId) return;
    setSaving(true);
    try {
      const data = await fetchSubaccountSchedule(subaccountId);
      setSchedule(data?.schedule || null);
      setExceptions(Array.isArray(data?.exceptions) ? data.exceptions : []);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load schedule.");
      setSchedule(null);
      setExceptions([]);
    } finally {
      setSaving(false);
    }
  }

  async function loadAssignmentCalendar(subaccountId) {
    if (!subaccountId) return;
    setCalendarLoading(true);
    try {
      const { data } = await api.get("/projects/assignments/calendar/", {
        params: { subaccount_id: subaccountId },
      });
      setAssignmentEvents(Array.isArray(data?.events) ? data.events : []);
    } catch (e) {
      console.error(e);
      setAssignmentEvents([]);
    } finally {
      setCalendarLoading(false);
    }
  }

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const subaccountId = params.get("subaccount");
    if (subaccountId && subaccountId !== selectedId) {
      setSelectedId(subaccountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  useEffect(() => {
    if (!selectedId) return;
    loadSchedule(selectedId);
    loadAssignmentCalendar(selectedId);
  }, [selectedId]);

  const selectedEmployee = useMemo(() => {
    const idNum = Number(selectedId);
    return subs.find((s) => s.id === idNum) || null;
  }, [subs, selectedId]);

  const operationalEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    return assignmentEvents
      .map((event) => {
        const start = event?.start ? new Date(event.start) : null;
        const end = event?.end ? new Date(event.end) : null;
        return { ...event, _start: start, _end: end };
      })
      .filter((event) => !event._start || event._start >= today)
      .filter((event) => !event._start || event._start <= weekEnd)
      .sort((a, b) => (a._start?.getTime() || 0) - (b._start?.getTime() || 0))
      .slice(0, 8);
  }, [assignmentEvents]);

  const scheduleSummary = useMemo(() => {
    const assignmentCount = assignmentEvents.filter((event) =>
      String(event?.extendedProps?.type || "").includes("assignment")
    ).length;
    const milestoneCount = assignmentEvents.filter((event) =>
      String(event?.extendedProps?.type || "").includes("milestone")
    ).length;
    const workingDays = DAY_FIELDS.filter((field) => !!schedule?.[field]).length;
    return { assignmentCount, milestoneCount, workingDays };
  }, [assignmentEvents, schedule]);

  function toggleDay(field) {
    setSchedule((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: !prev[field] };
    });
  }

  function setTime(field, value) {
    setSchedule((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value || null };
    });
  }

  async function saveSchedule() {
    if (!selectedId || !schedule) return;
    setSaving(true);
    try {
      const payload = {
        timezone: schedule.timezone || "America/Chicago",
        work_sun: !!schedule.work_sun,
        work_mon: !!schedule.work_mon,
        work_tue: !!schedule.work_tue,
        work_wed: !!schedule.work_wed,
        work_thu: !!schedule.work_thu,
        work_fri: !!schedule.work_fri,
        work_sat: !!schedule.work_sat,
        start_time: schedule.start_time || null,
        end_time: schedule.end_time || null,
      };
      const data = await updateSubaccountSchedule(selectedId, payload);
      setSchedule(data?.schedule || schedule);
      setExceptions(Array.isArray(data?.exceptions) ? data.exceptions : exceptions);
      toast.success("Schedule saved.");
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Failed to save schedule.");
    } finally {
      setSaving(false);
    }
  }

  const updateSelectedEmployee = (value) => {
    setSelectedId(value);
    const params = new URLSearchParams(location.search);
    if (!value) params.delete("subaccount");
    else params.set("subaccount", value);
    navigate(`${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`, {
      replace: true,
    });
  };

  async function addException() {
    if (!selectedId) return;
    if (!exDate) return toast.error("Pick a date.");
    setSaving(true);
    try {
      await addScheduleException(selectedId, {
        date: exDate,
        is_working: !!exIsWorking,
        note: exNote || "",
      });
      toast.success("Exception saved.");
      setExDate("");
      setExIsWorking(false);
      setExNote("");
      await loadSchedule(selectedId);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Failed to add exception.");
    } finally {
      setSaving(false);
    }
  }

  async function removeException(exceptionId) {
    if (!selectedId) return;
    setSaving(true);
    try {
      await deleteScheduleException(selectedId, exceptionId);
      toast.success("Exception deleted.");
      await loadSchedule(selectedId);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Failed to delete exception.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ContractorPageSurface
      eyebrow="Work"
      title="Team Schedule"
      subtitle="Set weekly work days and exception dates so contractor scheduling stays predictable and easy to review."
      className="max-w-[1360px]"
    >
      <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm text-slate-700">
            Set weekly work days (Sun–Sat), add exceptions, and see the assigned work tied to the selected employee.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate("/app/assignments")}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold hover:bg-slate-50 disabled:opacity-60"
          >
            View Assignments
          </button>
          <button
            onClick={loadEmployees}
            disabled={saving}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50 disabled:opacity-60"
          >
            Refresh employees
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Select employee</label>
        <select
          value={selectedId}
          onChange={(e) => updateSelectedEmployee(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2"
          disabled={loading || saving}
        >
          <option value="">{loading ? "Loading…" : "— Choose —"}</option>
          {subs.map((s) => (
            <option key={s.id} value={s.id}>
              {(s.display_name || "Employee")} — {s.email} ({s.role})
            </option>
          ))}
        </select>

        {selectedEmployee ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip>{selectedEmployee.display_name || "Employee"}</Chip>
            <Chip>{selectedEmployee.email}</Chip>
            <Chip tone={selectedEmployee.role === "employee_supervisor" ? "warn" : "neutral"}>
              {selectedEmployee.role}
            </Chip>
            <Chip tone="warn">
              Active {Number(selectedEmployee.active_assignment_count || 0)}
            </Chip>
            <Chip tone="warn">
              Awaiting Review {Number(selectedEmployee.pending_review_count || 0)}
            </Chip>
          </div>
        ) : null}
      </div>

      {!selectedId ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-12 text-center shadow-sm">
          <div className="text-base font-semibold text-slate-900">Select an employee to review their schedule and active work.</div>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-700">
            Weekly availability, exceptions, and the related assignments list will appear here once you choose a team member.
          </div>
        </div>
      ) : !schedule ? (
        <div className="text-gray-500">Loading schedule…</div>
      ) : (
        <div className="space-y-4">
          <div data-testid="team-schedule-summary" className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Working Days</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{scheduleSummary.workingDays}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Assignments</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{scheduleSummary.assignmentCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Milestone Links</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{scheduleSummary.milestoneCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Upcoming Items</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{operationalEvents.length}</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="team-schedule-editor">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-slate-950">Weekly work days</div>
                <div className="mt-1 text-sm text-slate-700">Toggle which days they typically work.</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveSchedule}
                  disabled={saving}
                  className="rounded-lg bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save schedule"}
                </button>
              </div>
            </div>

            {/* ✅ UPDATED COLORS */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {DAY_FIELDS.map((f) => {
                const on = !!schedule[f];

                // Selected day: MyHomeBro blue
                const cls = on
                  ? "bg-blue-600 border-blue-700 text-white hover:bg-blue-700"
                  : "bg-white border-slate-200 text-slate-800 hover:bg-slate-50";

                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleDay(f)}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition ${cls}`}
                    disabled={saving}
                    title={on ? "Working day" : "Day off"}
                  >
                    {dayLabel(f)}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Timezone</label>
                <input
                  value={schedule.timezone || "America/Chicago"}
                  onChange={(e) => setSchedule((prev) => ({ ...prev, timezone: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  disabled={saving}
                />
                <div className="mt-1 text-xs text-slate-600">Default: America/Chicago</div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Work start (optional)</label>
                <input
                  type="time"
                  value={schedule.start_time || ""}
                  onChange={(e) => setTime("start_time", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Work end (optional)</label>
                <input
                  type="time"
                  value={schedule.end_time || ""}
                  onChange={(e) => setTime("end_time", e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="team-schedule-operational-view">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-slate-950">Operational work view</div>
                <div className="mt-1 text-sm text-slate-700">
                  Work items currently tied to this employee.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/app/assignments?subaccount=${selectedId}`)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open Assignments
              </button>
            </div>

            {calendarLoading ? (
              <div className="mt-4 text-sm text-slate-500">Loading assignments…</div>
            ) : operationalEvents.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-5 py-7 text-center">
                <div className="text-sm font-semibold text-slate-900">No active work items yet</div>
                <div className="mt-1 text-sm text-slate-700">
                  Assign a project or milestone to this employee and their work will appear here.
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {operationalEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{event.title}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {event.extendedProps?.project_title || "Project"} · {event.extendedProps?.type === "milestone_override" ? "Milestone override" : "Agreement assignment"}
                        </div>
                      </div>
                      <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {formatRangeDate(event.start)}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatRangeDateTime(event.start)} {event.end ? `→ ${formatRangeDateTime(event.end)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="font-bold text-slate-950">Schedule exceptions</div>
                <div className="mt-1 text-sm text-slate-700">
                  Add day-specific overrides (vacation/day off or extra work day).
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Date</label>
                <input
                  type="date"
                  value={exDate}
                  onChange={(e) => setExDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={exIsWorking}
                    onChange={(e) => setExIsWorking(e.target.checked)}
                    disabled={saving}
                  />
                  Extra work day
                </label>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Note</label>
                <input
                  value={exNote}
                  onChange={(e) => setExNote(e.target.value)}
                  placeholder="e.g., Vacation / Half day / Site visit"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={addException}
                  disabled={saving || !exDate}
                  className="w-full rounded-lg bg-slate-900 text-white px-4 py-2 font-semibold hover:bg-slate-800 disabled:opacity-60"
                >
                  Add exception
                </button>
              </div>
            </div>

            <div className="mt-4">
              {exceptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-5 py-7 text-center">
                  <div className="text-sm font-semibold text-slate-900">No exceptions yet</div>
                  <div className="mt-1 text-sm text-slate-700">
                    Add a day off or extra work day here when the schedule needs a one-time change.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b text-left text-slate-600">
                      <tr>
                        <th className="py-2 pr-3">DATE</th>
                        <th className="py-2 pr-3">TYPE</th>
                        <th className="py-2 pr-3">NOTE</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {exceptions.map((ex) => (
                        <tr key={ex.id} className="border-b last:border-b-0">
                          <td className="py-2 pr-3">{ex.date}</td>
                          <td className="py-2 pr-3">
                            {ex.is_working ? (
                              <Chip tone="warn">Extra work day</Chip>
                            ) : (
                              <Chip tone="danger">Day off</Chip>
                            )}
                          </td>
                          <td className="py-2 pr-3">{ex.note || "—"}</td>
                          <td className="py-2 pr-3 text-right">
                            <button
                              onClick={() => removeException(ex.id)}
                              disabled={saving}
                              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </ContractorPageSurface>
  );
}
