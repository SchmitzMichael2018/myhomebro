// src/pages/TeamSchedule.jsx
// v2026-01-03 — Contractor-only Team Schedule UI (Sun–Sat)
// UPDATED: selected day buttons use MyHomeBro blue theme

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { listSubaccounts } from "../api/subaccounts";
import {
  fetchSubaccountSchedule,
  updateSubaccountSchedule,
  addScheduleException,
  deleteScheduleException,
} from "../api/schedule";

function Chip({ children, tone = "neutral" }) {
  const cls =
    tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-gray-200 bg-gray-50 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
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

export default function TeamSchedule() {
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState([]);
  const [selectedId, setSelectedId] = useState("");

  const [schedule, setSchedule] = useState(null);
  const [exceptions, setExceptions] = useState([]);
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

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    loadSchedule(selectedId);
  }, [selectedId]);

  const selectedEmployee = useMemo(() => {
    const idNum = Number(selectedId);
    return subs.find((s) => s.id === idNum) || null;
  }, [subs, selectedId]);

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
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Team Schedule</h1>
          <div className="text-sm text-gray-500">
            Set weekly work days (Sun–Sat) and add exceptions (days off / extra work days).
          </div>
        </div>
        <button
          onClick={loadEmployees}
          disabled={saving}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50 disabled:opacity-60"
        >
          Refresh employees
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Select employee</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
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
          </div>
        ) : null}
      </div>

      {!selectedId ? (
        <div className="text-gray-500">Select an employee to edit their schedule.</div>
      ) : !schedule ? (
        <div className="text-gray-500">Loading schedule…</div>
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="font-bold">Weekly work days</div>
                <div className="text-sm text-gray-500 mt-1">Toggle which days they typically work.</div>
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
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
              {DAY_FIELDS.map((f) => {
                const on = !!schedule[f];

                // Selected day: MyHomeBro blue
                const cls = on
                  ? "bg-blue-600 border-blue-700 text-white hover:bg-blue-700"
                  : "bg-white border-gray-200 text-gray-800 hover:bg-gray-50";

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

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Timezone</label>
                <input
                  value={schedule.timezone || "America/Chicago"}
                  onChange={(e) => setSchedule((prev) => ({ ...prev, timezone: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  disabled={saving}
                />
                <div className="text-xs text-gray-500 mt-1">Default: America/Chicago</div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Work start (optional)</label>
                <input
                  type="time"
                  value={schedule.start_time || ""}
                  onChange={(e) => setTime("start_time", e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Work end (optional)</label>
                <input
                  type="time"
                  value={schedule.end_time || ""}
                  onChange={(e) => setTime("end_time", e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="font-bold">Schedule exceptions</div>
                <div className="text-sm text-gray-500 mt-1">
                  Add day-specific overrides (vacation/day off or extra work day).
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  value={exDate}
                  onChange={(e) => setExDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
                  disabled={saving}
                />
              </div>

              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
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
                <label className="block text-sm font-semibold text-gray-700 mb-1">Note</label>
                <input
                  value={exNote}
                  onChange={(e) => setExNote(e.target.value)}
                  placeholder="e.g., Vacation / Half day / Site visit"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2"
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
                <div className="text-sm text-gray-500">No exceptions yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-gray-500 border-b">
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
        </>
      )}
    </div>
  );
}
