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
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamHubTabs } from "../components/dashboard/hubTabsConfig.js";

function Chip({ children, tone = "neutral" }) {
  const cls =
    tone === "danger"
      ? "border-rose-300/35 bg-rose-400/15 text-rose-100"
      : tone === "warn"
      ? "border-amber-300/35 bg-amber-400/15 text-amber-100"
      : "border-white/12 bg-slate-400/15 text-sky-100/75";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function BoardMetric({ label, value, tone = "neutral" }) {
  const cls =
    tone === "good"
      ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-50"
      : tone === "warn"
      ? "border-amber-300/35 bg-amber-400/15 text-amber-50"
      : tone === "danger"
      ? "border-rose-300/35 bg-rose-400/15 text-rose-50"
      : "border-white/12 bg-slate-900/55 text-white";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${cls}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em] opacity-75">{label}</div>
      <div className="mt-2 text-2xl font-bold">{Number(value || 0).toLocaleString()}</div>
    </div>
  );
}

function roleLabel(role) {
  const value = String(role || "").replaceAll("_", " ").trim();
  return value ? value.replace(/\b\w/g, (c) => c.toUpperCase()) : "Team member";
}

function primaryCapability(member) {
  const capabilities = Array.isArray(member?.capabilities) ? member.capabilities : [];
  const first = capabilities[0];
  if (!first) return "Capability not listed";
  const skill = first.skill_name || first.skill_slug || "Capability";
  const level = first.skill_level_label || first.skill_level || "";
  return level ? `${skill} - ${level}` : skill;
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

function dayFieldForDate(date = new Date()) {
  return DAY_FIELDS[date.getDay()] || "work_mon";
}

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

function eventStatusLabel(event) {
  const type = String(event?.extendedProps?.type || "").toLowerCase();
  if (type.includes("warranty")) return "Warranty Work";
  if (type.includes("milestone")) return "Milestone";
  if (type.includes("assignment")) return "Agreement";
  return "Scheduled";
}

function eventDurationLabel(event) {
  const estimated = Number(event?.extendedProps?.estimated_duration_minutes || 0);
  if (estimated > 0) {
    const hours = Math.floor(estimated / 60);
    const minutes = estimated % 60;
    return [hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ") || `${estimated}m`;
  }
  const start = event?._start || (event?.start ? new Date(event.start) : null);
  const end = event?._end || (event?.end ? new Date(event.end) : null);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Date only";
  const diffMs = Math.max(end.getTime() - start.getTime(), 0);
  const days = Math.max(Math.ceil(diffMs / 86400000), 1);
  return `${days} day${days === 1 ? "" : "s"}`;
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
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [workFilter, setWorkFilter] = useState("all");
  const [rangeDays, setRangeDays] = useState("7");
  const [employeePage, setEmployeePage] = useState(1);
  const [employeePageSize, setEmployeePageSize] = useState(20);

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

  const selectedRangeDays = Number(rangeDays || 7);

  const operationalEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + selectedRangeDays);

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
  }, [assignmentEvents, selectedRangeDays]);

  const todaysEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return assignmentEvents
      .map((event) => {
        const start = event?.start ? new Date(event.start) : null;
        return { ...event, _start: start };
      })
      .filter((event) => event._start && event._start >= today && event._start < tomorrow);
  }, [assignmentEvents]);

  const scheduleSummary = useMemo(() => {
    const assignmentCount = assignmentEvents.filter((event) =>
      String(event?.extendedProps?.type || "").includes("assignment")
    ).length;
    const milestoneCount = assignmentEvents.filter((event) =>
      String(event?.extendedProps?.type || "").includes("milestone")
    ).length;
    const warrantyCount = assignmentEvents.filter((event) =>
      String(event?.extendedProps?.type || "").includes("warranty")
    ).length;
    const workingDays = DAY_FIELDS.filter((field) => !!schedule?.[field]).length;
    return { assignmentCount, milestoneCount, warrantyCount, workingDays };
  }, [assignmentEvents, schedule]);

  const capabilityOptions = useMemo(() => {
    const byId = new Map();
    subs.forEach((sub) => {
      (Array.isArray(sub.capabilities) ? sub.capabilities : []).forEach((capability) => {
        if (!capability?.skill_id) return;
        byId.set(String(capability.skill_id), {
          id: String(capability.skill_id),
          name: capability.skill_name || capability.skill_slug || "Capability",
        });
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [subs]);

  const filteredEmployees = useMemo(() => {
    return subs.filter((sub) => {
      const capabilities = Array.isArray(sub.capabilities) ? sub.capabilities : [];
      const activeCount = Number(sub.active_assignment_count || 0);
      const capabilityMatches =
        !capabilityFilter || capabilities.some((capability) => String(capability.skill_id) === String(capabilityFilter));
      const workMatches =
        workFilter === "assigned" ? activeCount > 0 : workFilter === "available" ? activeCount === 0 : true;
      return capabilityMatches && workMatches;
    });
  }, [capabilityFilter, subs, workFilter]);

  useEffect(() => {
    setEmployeePage(1);
  }, [capabilityFilter, workFilter]);

  const totalEmployeePages = Math.max(Math.ceil(filteredEmployees.length / employeePageSize), 1);
  const safeEmployeePage = Math.min(employeePage, totalEmployeePages);
  const pagedEmployees = filteredEmployees.slice(
    (safeEmployeePage - 1) * employeePageSize,
    safeEmployeePage * employeePageSize
  );

  const todayWorking = Boolean(selectedId && schedule?.[dayFieldForDate(new Date())]);
  const availableCount = subs.filter((sub) => Number(sub.active_assignment_count || 0) === 0).length;
  const conflictCount = assignmentEvents.filter(
    (event) => event?.extendedProps?.conflict || event?.extendedProps?.has_conflict
  ).length;
  const activeFilterSummary = [
    selectedEmployee ? selectedEmployee.display_name || selectedEmployee.email : "all employees",
    capabilityOptions.find((option) => option.id === capabilityFilter)?.name,
    workFilter !== "all" ? workFilter : null,
    `${selectedRangeDays} days`,
  ].filter(Boolean).join(" | ");

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
      eyebrow="Team"
      title="Schedule"
      subtitle="Set weekly work days and exception dates so contractor scheduling stays predictable and easy to review."
      className="max-w-[1680px]"
      variant="operational"
    >
      <div className="space-y-4">
        <HubTabs tabs={teamHubTabs} />

        <section className="rounded-[24px] border border-white/12 bg-slate-950/55 p-4 text-white shadow-sm" data-testid="team-schedule-board-summary">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">Daily Operations Board</div>
              <h2 className="mt-2 text-2xl font-bold">Who is doing what today</h2>
              <p className="mt-2 text-sm leading-6 text-sky-100/75">
                Review employee availability, today's workload, and upcoming assignment context without changing schedule behavior.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigate("/app/team/assignments")}
                disabled={saving}
                className="mhb-operational-filter-chip is-active rounded-xl px-4 py-2 font-extrabold disabled:opacity-60"
              >
                View Assignments
              </button>
              <button
                onClick={loadEmployees}
                disabled={saving}
                className="mhb-operational-filter-chip rounded-xl px-4 py-2 font-extrabold disabled:opacity-60"
              >
                Refresh employees
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <BoardMetric label="Employees Working Today" value={todayWorking ? 1 : 0} tone={todayWorking ? "good" : "neutral"} />
            <BoardMetric label="Available Employees" value={availableCount} tone="good" />
            <BoardMetric label="Scheduled Assignments" value={scheduleSummary.assignmentCount} />
            <BoardMetric label="Conflicts" value={conflictCount} tone={conflictCount ? "danger" : "neutral"} />
            <BoardMetric label="Warranty Work" value={scheduleSummary.warrantyCount} tone="warn" />
          </div>
        </section>

        <section className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm" data-testid="team-schedule-filters">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.75fr)_minmax(150px,0.6fr)_minmax(150px,0.6fr)]">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-sky-100/80">Employee</span>
              <select
                value={selectedId}
                onChange={(e) => updateSelectedEmployee(e.target.value)}
                className="mhb-operational-control w-full rounded-lg px-3 py-2"
                disabled={loading || saving}
                data-testid="team-schedule-employee-filter"
              >
                <option value="">{loading ? "Loading..." : "Choose employee"}</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.display_name || "Employee")} - {s.email} ({s.role})
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-sky-100/80">Capability</span>
              <select
                value={capabilityFilter}
                onChange={(e) => setCapabilityFilter(e.target.value)}
                className="mhb-operational-control w-full rounded-lg px-3 py-2"
                data-testid="team-schedule-capability-filter"
              >
                <option value="">All capabilities</option>
                {capabilityOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-sky-100/80">Workload</span>
              <select
                value={workFilter}
                onChange={(e) => setWorkFilter(e.target.value)}
                className="mhb-operational-control w-full rounded-lg px-3 py-2"
                data-testid="team-schedule-work-filter"
              >
                <option value="all">All employees</option>
                <option value="assigned">Assigned</option>
                <option value="available">Available</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-sky-100/80">Date range</span>
              <select
                value={rangeDays}
                onChange={(e) => setRangeDays(e.target.value)}
                className="mhb-operational-control w-full rounded-lg px-3 py-2"
                data-testid="team-schedule-range-filter"
              >
                <option value="7">Next 7 days</option>
                <option value="14">Next 14 days</option>
                <option value="30">Next 30 days</option>
              </select>
            </label>
          </div>
          <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/45 px-3 py-2 text-sm text-sky-100/75" data-testid="team-schedule-filter-summary">
            Showing {Math.min(safeEmployeePage * employeePageSize, filteredEmployees.length)} of {filteredEmployees.length} employees | {activeFilterSummary}
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3" data-testid="team-schedule-employee-board">
          {loading ? (
            <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 text-sm text-sky-100/70">Loading employees...</div>
          ) : filteredEmployees.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/14 bg-slate-950/45 p-5 text-sm text-sky-100/70">
              No employees match these filters.
            </div>
          ) : (
            pagedEmployees.map((employee) => {
              const isSelected = String(employee.id) === String(selectedId);
              const activeCount = Number(employee.active_assignment_count || 0);
              const reviewCount = Number(employee.pending_review_count || 0);
              const isAvailable = activeCount === 0;
              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => updateSelectedEmployee(String(employee.id))}
                  className={[
                    "rounded-2xl border p-4 text-left shadow-sm transition",
                    isSelected
                      ? "border-sky-300/60 bg-sky-400/15"
                      : "border-white/12 bg-slate-950/45 hover:border-sky-300/35",
                  ].join(" ")}
                  data-testid={`team-schedule-employee-card-${employee.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-bold text-white">{employee.display_name || "Employee"}</div>
                      <div className="mt-1 truncate text-xs text-sky-100/60">{primaryCapability(employee)}</div>
                    </div>
                    <Chip tone={isAvailable ? "neutral" : "warn"}>{isAvailable ? "Available" : "Assigned"}</Chip>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Chip>{roleLabel(employee.role)}</Chip>
                    <Chip tone="warn">Today {isSelected ? todaysEvents.length : 0}</Chip>
                    <Chip tone={reviewCount ? "warn" : "neutral"}>Review {reviewCount}</Chip>
                  </div>
                  <div className="mt-3 text-xs text-sky-100/65">
                    {isSelected && todaysEvents.length
                      ? todaysEvents.map((event) => event.extendedProps?.project_title || event.title).join(", ")
                      : isAvailable
                        ? "No active assignments listed."
                        : `${activeCount} active assignment${activeCount === 1 ? "" : "s"} listed.`}
                  </div>
                </button>
              );
            })
          )}
        </section>

        <div className="flex flex-col gap-3 rounded-2xl border border-white/12 bg-slate-950/45 p-3 text-sm text-sky-100/75 sm:flex-row sm:items-center sm:justify-between" data-testid="team-schedule-pagination">
          <div>
            Showing {pagedEmployees.length ? (safeEmployeePage - 1) * employeePageSize + 1 : 0}-
            {Math.min(safeEmployeePage * employeePageSize, filteredEmployees.length)} of {filteredEmployees.length} employees
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <span>Page size</span>
              <select
                value={employeePageSize}
                onChange={(event) => {
                  setEmployeePageSize(Number(event.target.value));
                  setEmployeePage(1);
                }}
                className="mhb-operational-control rounded-lg px-2 py-1"
                data-testid="team-schedule-page-size"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setEmployeePage((page) => Math.max(page - 1, 1))}
              disabled={safeEmployeePage <= 1}
              className="mhb-operational-filter-chip rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50"
              data-testid="team-schedule-prev-page"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setEmployeePage((page) => Math.min(page + 1, totalEmployeePages))}
              disabled={safeEmployeePage >= totalEmployeePages}
              className="mhb-operational-filter-chip rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50"
              data-testid="team-schedule-next-page"
            >
              Next
            </button>
          </div>
        </div>

      <div className="hidden">
        <div>
          <div className="text-sm font-semibold text-sky-100/75">
            Set weekly work days (Sun–Sat), add exceptions, and see the assigned work tied to the selected employee.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => navigate("/app/team/assignments")}
            disabled={saving}
            className="mhb-operational-filter-chip is-active rounded-xl px-4 py-2 font-extrabold disabled:opacity-60"
          >
            View Assignments
          </button>
          <button
            onClick={loadEmployees}
            disabled={saving}
            className="mhb-operational-filter-chip rounded-xl px-4 py-2 font-extrabold disabled:opacity-60"
          >
            Refresh employees
          </button>
        </div>
      </div>

      <div className="hidden">
        <label className="block text-sm font-semibold text-sky-100/80 mb-2">Select employee</label>
        <select
          value={selectedId}
          onChange={(e) => updateSelectedEmployee(e.target.value)}
          className="mhb-operational-control w-full rounded-lg px-3 py-2"
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
        <div className="rounded-2xl border border-dashed border-white/14 bg-slate-950/45 px-6 py-12 text-center shadow-sm">
          <div className="text-base font-semibold text-white">Select an employee to review their schedule and active work.</div>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-sky-100/70">
            Weekly availability, exceptions, and the related assignments list will appear here once you choose a team member.
          </div>
        </div>
      ) : !schedule ? (
        <div className="rounded-2xl border border-white/12 bg-slate-950/45 px-6 py-10 text-center text-sm font-semibold text-sky-100/70 shadow-sm">Loading schedule…</div>
      ) : (
        <div className="space-y-4">
          <div data-testid="team-schedule-summary" className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">Working Days</div>
              <div className="mt-2 text-2xl font-bold text-white">{scheduleSummary.workingDays}</div>
            </div>
            <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">Assignments</div>
              <div className="mt-2 text-2xl font-bold text-white">{scheduleSummary.assignmentCount}</div>
            </div>
            <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">Milestone Links</div>
              <div className="mt-2 text-2xl font-bold text-white">{scheduleSummary.milestoneCount}</div>
            </div>
            <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/60">Upcoming Items</div>
              <div className="mt-2 text-2xl font-bold text-white">{operationalEvents.length}</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm" data-testid="team-schedule-editor">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-white">Weekly work days</div>
                <div className="mt-1 text-sm text-sky-100/70">Toggle which days they typically work.</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveSchedule}
                  disabled={saving}
                  className="mhb-operational-filter-chip is-active rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save schedule"}
                </button>
              </div>
            </div>

            {/* ✅ UPDATED COLORS */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
              {DAY_FIELDS.map((f) => {
                const on = !!schedule[f];

                const cls = on
                  ? "mhb-operational-filter-chip is-active"
                  : "mhb-operational-filter-chip";

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
                <label className="mb-1 block text-sm font-semibold text-sky-100/80">Timezone</label>
                <input
                  value={schedule.timezone || "America/Chicago"}
                  onChange={(e) => setSchedule((prev) => ({ ...prev, timezone: e.target.value }))}
                  className="mhb-operational-control w-full rounded-lg px-3 py-2"
                  disabled={saving}
                />
                <div className="mt-1 text-xs text-sky-100/60">Default: America/Chicago</div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-sky-100/80">Work start (optional)</label>
                <input
                  type="time"
                  value={schedule.start_time || ""}
                  onChange={(e) => setTime("start_time", e.target.value)}
                  className="mhb-operational-control w-full rounded-lg px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-sky-100/80">Work end (optional)</label>
                <input
                  type="time"
                  value={schedule.end_time || ""}
                  onChange={(e) => setTime("end_time", e.target.value)}
                  className="mhb-operational-control w-full rounded-lg px-3 py-2"
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm" data-testid="team-schedule-operational-view">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-bold text-white">Operational work view</div>
                <div className="mt-1 text-sm text-sky-100/70">
                  Work items currently tied to this employee.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/app/team/assignments?subaccount=${selectedId}`)}
                className="mhb-operational-filter-chip rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Open Assignments
              </button>
            </div>

            {calendarLoading ? (
              <div className="mt-4 text-sm text-slate-500">Loading assignments…</div>
            ) : operationalEvents.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-white/14 bg-slate-900/45 px-5 py-7 text-center">
                <div className="text-sm font-semibold text-white">No active work items yet</div>
                <div className="mt-1 text-sm text-sky-100/70">
                  Assign a project or milestone to this employee and their work will appear here.
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {operationalEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-white/12 bg-slate-900/45 p-4" data-testid={`team-schedule-assignment-${event.id}`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-white">{event.title}</div>
                        <div className="mt-1 text-sm text-sky-100/70">
                          {event.extendedProps?.project_title || "Project"} - {eventStatusLabel(event)}
                        </div>
                      </div>
                      <span className="inline-flex rounded-full border border-white/12 bg-slate-950/55 px-2.5 py-1 text-xs font-semibold text-sky-100/80">
                        {formatRangeDate(event.start)}
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-sky-100/60">
                      <span className="sr-only">Date range</span>
                      <div className="mt-3 grid gap-3 text-xs text-sky-100/70 sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <div className="font-semibold uppercase tracking-[0.12em] text-sky-100/45">Status</div>
                          <div className="mt-1">{eventStatusLabel(event)}</div>
                        </div>
                        <div>
                          <div className="font-semibold uppercase tracking-[0.12em] text-sky-100/45">Duration</div>
                          <div className="mt-1">{eventDurationLabel(event)}</div>
                        </div>
                        <div>
                          <div className="font-semibold uppercase tracking-[0.12em] text-sky-100/45">Owner</div>
                          <div className="mt-1">{event.extendedProps?.employee_name || selectedEmployee?.display_name || "Team member"}</div>
                        </div>
                        <div>
                          <div className="font-semibold uppercase tracking-[0.12em] text-sky-100/45">Linked record</div>
                          <div className="mt-1">
                            {event.extendedProps?.warranty_request_id
                              ? `Warranty #${event.extendedProps.warranty_request_id}`
                              : event.extendedProps?.milestone_count || event.extendedProps?.milestone_id
                              ? "1 linked"
                              : "Agreement-level"}
                          </div>
                        </div>
                      </div>
                      {formatRangeDateTime(event.start)} {event.end ? `→ ${formatRangeDateTime(event.end)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          </div>

          <div className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="font-bold text-white">Schedule exceptions</div>
                <div className="mt-1 text-sm text-sky-100/70">
                  Add day-specific overrides (vacation/day off or extra work day).
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-sky-100/80">Date</label>
                <input
                  type="date"
                  value={exDate}
                  onChange={(e) => setExDate(e.target.value)}
                  className="mhb-operational-control w-full rounded-lg px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-semibold text-sky-100/80">
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
                <label className="mb-1 block text-sm font-semibold text-sky-100/80">Note</label>
                <input
                  value={exNote}
                  onChange={(e) => setExNote(e.target.value)}
                  placeholder="e.g., Vacation / Half day / Site visit"
                  className="mhb-operational-control w-full rounded-lg px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div className="flex items-end">
                <button
                  onClick={addException}
                  disabled={saving || !exDate}
                  className="mhb-operational-filter-chip is-active w-full rounded-lg px-4 py-2 font-semibold disabled:opacity-60"
                >
                  Add exception
                </button>
              </div>
            </div>

            <div className="mt-4">
              {exceptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/14 bg-slate-900/45 px-5 py-7 text-center">
                  <div className="text-sm font-semibold text-white">No exceptions yet</div>
                  <div className="mt-1 text-sm text-sky-100/70">
                    Add a day off or extra work day here when the schedule needs a one-time change.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-white/12 text-left text-sky-100/70">
                      <tr>
                        <th className="py-2 pr-3">DATE</th>
                        <th className="py-2 pr-3">TYPE</th>
                        <th className="py-2 pr-3">NOTE</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {exceptions.map((ex) => (
                        <tr key={ex.id} className="border-b border-white/10 last:border-b-0">
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
                              className="rounded-lg border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-sm font-semibold text-rose-100 hover:bg-rose-500/18 disabled:opacity-60"
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
