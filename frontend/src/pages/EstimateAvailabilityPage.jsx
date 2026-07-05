import { useEffect, useMemo, useState } from "react";

import api, { extractApiErrorMessage } from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamHubTabs } from "../components/dashboard/hubTabsConfig.js";

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

const APPOINTMENT_TYPES = [
  { value: "phone_call", label: "Phone call" },
  { value: "video_call", label: "Video call" },
  { value: "in_person", label: "In-person estimate" },
];

const DEFAULT_FORM = {
  weekday: "0",
  start_time: "09:00",
  end_time: "12:00",
  timezone: "America/Chicago",
  appointment_type: "in_person",
  duration_minutes: "30",
  notes: "",
  is_active: true,
};

function normalizeListResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function formatTime(value) {
  if (!value) return "";
  const [hourRaw, minuteRaw] = String(value).split(":");
  const hour = Number(hourRaw || 0);
  const minute = Number(minuteRaw || 0);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function minutesFromTime(value) {
  const [hourRaw, minuteRaw] = String(value || "00:00").split(":");
  return Number(hourRaw || 0) * 60 + Number(minuteRaw || 0);
}

function timeFromMinutes(value) {
  const normalized = Math.max(0, Math.min(value, 24 * 60 - 1));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildPreview(windows) {
  const grouped = WEEKDAYS.map((day) => ({ ...day, slots: [] }));
  windows
    .filter((window) => window.is_active)
    .forEach((window) => {
      const duration = Number(window.duration_minutes || 0);
      if (duration <= 0) return;
      const start = minutesFromTime(window.start_time);
      const end = minutesFromTime(window.end_time);
      const day = grouped.find((item) => Number(item.value) === Number(window.weekday));
      if (!day || end <= start) return;
      for (let cursor = start; cursor + duration <= end; cursor += duration) {
        day.slots.push({
          time: timeFromMinutes(cursor),
          appointment_type_label: window.appointment_type_label,
          source_id: window.id,
        });
      }
    });
  grouped.forEach((day) => {
    day.slots.sort((a, b) => minutesFromTime(a.time) - minutesFromTime(b.time));
  });
  return grouped;
}

function fieldError(error, field) {
  const value = error?.[field];
  if (Array.isArray(value)) return value.join(" ");
  if (typeof value === "string") return value;
  return "";
}

function WindowBadge({ active }) {
  const classes = active
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-slate-200 bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}>
      {active ? "Active" : "Disabled"}
    </span>
  );
}

export default function EstimateAvailabilityPage() {
  const [windows, setWindows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState("");

  async function loadWindows() {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get("/projects/estimate-availability/");
      setWindows(normalizeListResponse(response.data));
      setNotice(response.data?.warning || "");
    } catch (err) {
      console.error(err);
      setWindows([]);
      setError({ detail: extractApiErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWindows();
  }, []);

  const preview = useMemo(() => buildPreview(windows), [windows]);
  const activeCount = windows.filter((window) => window.is_active).length;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setError(null);
  }

  function editWindow(window) {
    setEditingId(window.id);
    setForm({
      weekday: String(window.weekday),
      start_time: window.start_time,
      end_time: window.end_time,
      timezone: window.timezone || "America/Chicago",
      appointment_type: window.appointment_type || "in_person",
      duration_minutes: String(window.duration_minutes || 30),
      notes: window.notes || "",
      is_active: Boolean(window.is_active),
    });
    setError(null);
  }

  async function saveWindow(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      ...form,
      weekday: Number(form.weekday),
      duration_minutes: Number(form.duration_minutes),
      is_active: Boolean(form.is_active),
    };
    try {
      if (editingId) {
        await api.patch(`/projects/estimate-availability/${editingId}/`, payload);
      } else {
        await api.post("/projects/estimate-availability/", payload);
      }
      resetForm();
      await loadWindows();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data || { detail: extractApiErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteWindow(windowId) {
    setError(null);
    try {
      await api.delete(`/projects/estimate-availability/${windowId}/`);
      if (editingId === windowId) resetForm();
      await loadWindows();
    } catch (err) {
      console.error(err);
      setError({ detail: extractApiErrorMessage(err) });
    }
  }

  async function toggleWindow(window) {
    setError(null);
    try {
      await api.patch(`/projects/estimate-availability/${window.id}/`, {
        is_active: !window.is_active,
      });
      await loadWindows();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data || { detail: extractApiErrorMessage(err) });
    }
  }

  return (
    <ContractorPageSurface
      title="Estimate Availability"
      subtitle="Publish recurring windows when customers may request estimate appointments."
      kicker="Team Settings"
      actions={<HubTabs tabs={teamHubTabs} />}
    >
      <div className="space-y-6" data-testid="estimate-availability-page">
        <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-semibold">
            Customers will only see these published estimate windows.
          </p>
          <p className="mt-1">
            Appointments are requested first and require your confirmation.
          </p>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
          <form
            onSubmit={saveWindow}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            data-testid="estimate-availability-form"
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-950">
                {editingId ? "Edit availability window" : "Add availability window"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Set recurring estimate windows by weekday and appointment type.
              </p>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block text-sm font-semibold text-slate-700">
                Weekday
                <select
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={form.weekday}
                  onChange={(event) => updateField("weekday", event.target.value)}
                  data-testid="estimate-availability-weekday"
                >
                  {WEEKDAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
                {fieldError(error, "weekday") ? (
                  <span className="mt-1 block text-xs font-semibold text-rose-700">{fieldError(error, "weekday")}</span>
                ) : null}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-700">
                  Start Time
                  <input
                    type="time"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    value={form.start_time}
                    onChange={(event) => updateField("start_time", event.target.value)}
                    data-testid="estimate-availability-start"
                  />
                  {fieldError(error, "start_time") ? (
                    <span className="mt-1 block text-xs font-semibold text-rose-700">{fieldError(error, "start_time")}</span>
                  ) : null}
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  End Time
                  <input
                    type="time"
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    value={form.end_time}
                    onChange={(event) => updateField("end_time", event.target.value)}
                    data-testid="estimate-availability-end"
                  />
                  {fieldError(error, "end_time") ? (
                    <span className="mt-1 block text-xs font-semibold text-rose-700">{fieldError(error, "end_time")}</span>
                  ) : null}
                </label>
              </div>

              <label className="block text-sm font-semibold text-slate-700">
                Timezone
                <input
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={form.timezone}
                  onChange={(event) => updateField("timezone", event.target.value)}
                  data-testid="estimate-availability-timezone"
                />
                {fieldError(error, "timezone") ? (
                  <span className="mt-1 block text-xs font-semibold text-rose-700">{fieldError(error, "timezone")}</span>
                ) : null}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-slate-700">
                  Appointment Type
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    value={form.appointment_type}
                    onChange={(event) => updateField("appointment_type", event.target.value)}
                    data-testid="estimate-availability-type"
                  >
                    {APPOINTMENT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  {fieldError(error, "appointment_type") ? (
                    <span className="mt-1 block text-xs font-semibold text-rose-700">{fieldError(error, "appointment_type")}</span>
                  ) : null}
                </label>
                <label className="block text-sm font-semibold text-slate-700">
                  Duration
                  <select
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                    value={form.duration_minutes}
                    onChange={(event) => updateField("duration_minutes", event.target.value)}
                    data-testid="estimate-availability-duration"
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">60 minutes</option>
                    <option value="90">90 minutes</option>
                    <option value="120">120 minutes</option>
                  </select>
                  {fieldError(error, "duration_minutes") ? (
                    <span className="mt-1 block text-xs font-semibold text-rose-700">
                      {fieldError(error, "duration_minutes")}
                    </span>
                  ) : null}
                </label>
              </div>

              <label className="block text-sm font-semibold text-slate-700">
                Notes
                <textarea
                  className="mt-1 min-h-[84px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  data-testid="estimate-availability-notes"
                  placeholder="Optional instructions for this window"
                />
              </label>

              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) => updateField("is_active", event.target.checked)}
                  data-testid="estimate-availability-active"
                />
                Active and visible for future customer requests
              </label>

              {error?.detail ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
                  {error.detail}
                </div>
              ) : null}
              {fieldError(error, "non_field_errors") ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
                  {fieldError(error, "non_field_errors")}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={saving}
                  data-testid="estimate-availability-save"
                >
                  {saving ? "Saving..." : editingId ? "Save changes" : "Add window"}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={resetForm}
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </div>
          </form>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Published windows</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {activeCount} active of {windows.length} configured.
                </p>
              </div>
              <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                Requests require confirmation
              </span>
            </div>

            {loading ? (
              <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                Loading estimate availability...
              </div>
            ) : windows.length ? (
              <div className="mt-5 space-y-3" data-testid="estimate-availability-list">
                {windows.map((window) => (
                  <article
                    key={window.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                    data-testid={`estimate-availability-row-${window.id}`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-slate-950">{window.weekday_label}</h3>
                          <WindowBadge active={window.is_active} />
                          <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">
                            {window.appointment_type_label}
                          </span>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-slate-800">
                          {formatTime(window.start_time)} to {formatTime(window.end_time)}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {window.duration_minutes} minute appointments, {window.timezone}
                        </p>
                        {window.notes ? <p className="mt-2 text-sm text-slate-600">{window.notes}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        <button
                          type="button"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          onClick={() => editWindow(window)}
                          data-testid={`estimate-availability-edit-${window.id}`}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          onClick={() => toggleWindow(window)}
                          data-testid={`estimate-availability-toggle-${window.id}`}
                        >
                          {window.is_active ? "Disable" : "Enable"}
                        </button>
                        <button
                          type="button"
                          className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                          onClick={() => deleteWindow(window.id)}
                          data-testid={`estimate-availability-delete-${window.id}`}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div
                className="mt-5 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-5 text-sm text-amber-900"
                data-testid="estimate-availability-empty"
              >
                <p className="font-semibold">No availability configured.</p>
                <p className="mt-1">
                  Add at least one active window before customer-requested estimate scheduling is enabled in a future phase.
                </p>
                {notice ? <p className="mt-2">{notice}</p> : null}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="estimate-availability-preview">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Weekly preview</h2>
            <p className="mt-1 text-sm text-slate-600">
              A visualization of active published windows only. This does not check calendars or create bookings.
            </p>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {preview.map((day) => (
              <div
                key={day.value}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                data-testid={`estimate-availability-preview-day-${day.value}`}
              >
                <div className="font-semibold text-slate-950">{day.label}</div>
                {day.slots.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {day.slots.map((slot) => (
                      <span
                        key={`${slot.source_id}-${slot.time}`}
                        className="rounded-full border border-blue-100 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800"
                      >
                        {formatTime(slot.time)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No published slots</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </ContractorPageSurface>
  );
}
