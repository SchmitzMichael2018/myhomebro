import React, { useEffect, useState } from "react";
import Modal from "./Modal.jsx";

const labels = {
  schedule: "Schedule appointment", propose: "Propose another time", reschedule: "Reschedule appointment",
  decline: "Decline request", cancel: "Cancel appointment", complete: "Mark appointment completed", no_show: "Mark no-show",
  confirm: "Confirm appointment",
};

function localParts(value) {
  const date = value ? new Date(value) : new Date(Date.now() + 86400000);
  const pad = (number) => String(number).padStart(2, "0");
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

export default function AppointmentActionDialog({ open, action, appointment, defaults = {}, onClose, onSubmit }) {
  const initial = localParts(appointment?.scheduled_start);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const needsTime = ["schedule", "propose", "reschedule"].includes(action);
  const needsReason = ["decline", "cancel", "reschedule"].includes(action);

  useEffect(() => {
    if (!open) return;
    setForm({
      date: initial.date, time: initial.time,
      duration_minutes: appointment?.duration_minutes || 60,
      timezone: appointment?.timezone || defaults.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago",
      appointment_type: appointment?.appointment_type || defaults.appointment_type || (defaults.service_location ? "in_person" : "phone_call"),
      service_location: appointment?.service_location || defaults.service_location || "",
      notes: appointment?.notes || "", reason: "",
    });
    setError(""); setSubmitting(false);
  // Reset only when a new dialog action opens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action]);

  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (needsReason && !form.reason?.trim()) return setError("A reason is required.");
    if (needsTime && (!form.date || !form.time)) return setError("Choose a date and start time.");
    if (needsTime && Number(form.duration_minutes) % 15) return setError("Duration must use 15-minute increments.");
    if (needsTime && form.appointment_type === "in_person" && !form.service_location?.trim()) return setError("An address is required for an in-person appointment.");
    const scheduledStart = needsTime ? new Date(`${form.date}T${form.time}`).toISOString() : undefined;
    setSubmitting(true);
    try {
      await onSubmit({ ...form, scheduled_start: scheduledStart, duration_minutes: Number(form.duration_minutes) });
      onClose();
    } catch (err) {
      const payload = err?.response?.data;
      setError(payload?.detail || Object.values(payload || {}).flat().find(Boolean) || err?.message || "The appointment could not be updated.");
    } finally { setSubmitting(false); }
  };

  return <Modal visible={open} onClose={submitting ? undefined : onClose} title={labels[action] || "Appointment"} testId="appointment-action-dialog" overlayClassName="bg-slate-950/80 p-3" containerClassName="mx-3 max-h-[calc(100dvh-1.5rem)] max-w-xl rounded-2xl border border-slate-700 bg-[#071d3d] text-white" bodyClassName="max-h-[calc(100dvh-6rem)] p-5">
    <form onSubmit={submit} className="space-y-4">
      {appointment && ["propose", "reschedule"].includes(action) ? <p className="rounded-xl bg-white/10 p-3 text-sm">Current time: {new Date(appointment.scheduled_start).toLocaleString()}</p> : null}
      {needsTime ? <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold">Appointment type<select value={form.appointment_type || ""} onChange={change("appointment_type")} className="mt-1 min-h-11 w-full rounded-lg border-slate-500 bg-white text-slate-950"><option value="phone_call">Phone call</option><option value="video_call">Video call</option><option value="in_person">In person</option></select></label>
        <label className="text-sm font-bold">Duration<select value={form.duration_minutes || 60} onChange={change("duration_minutes")} className="mt-1 min-h-11 w-full rounded-lg border-slate-500 bg-white text-slate-950">{[15,30,45,60,90,120].map((v) => <option key={v} value={v}>{v} minutes</option>)}</select></label>
        <label className="text-sm font-bold">Date<input data-autofocus type="date" value={form.date || ""} onChange={change("date")} className="mt-1 min-h-11 w-full rounded-lg border-slate-500 bg-white text-slate-950" /></label>
        <label className="text-sm font-bold">Start time<input type="time" step="900" value={form.time || ""} onChange={change("time")} className="mt-1 min-h-11 w-full rounded-lg border-slate-500 bg-white text-slate-950" /></label>
        <label className="text-sm font-bold sm:col-span-2">Time zone<input value={form.timezone || ""} onChange={change("timezone")} className="mt-1 min-h-11 w-full rounded-lg border-slate-500 bg-white text-slate-950" /></label>
        {form.appointment_type === "in_person" ? <label className="text-sm font-bold sm:col-span-2">Address/location<input value={form.service_location || ""} onChange={change("service_location")} className="mt-1 min-h-11 w-full rounded-lg border-slate-500 bg-white text-slate-950" /></label> : null}
        <label className="text-sm font-bold sm:col-span-2">Notes or message<textarea value={form.notes || ""} onChange={change("notes")} className="mt-1 min-h-24 w-full rounded-lg border-slate-500 bg-white text-slate-950" /></label>
      </div> : null}
      {needsReason ? <label className="block text-sm font-bold">Reason<textarea data-autofocus value={form.reason || ""} onChange={change("reason")} className="mt-1 min-h-24 w-full rounded-lg border-slate-500 bg-white text-slate-950" /></label> : null}
      {action === "cancel" ? <p className="text-sm text-rose-100">This releases the reserved time and keeps the appointment in history.</p> : null}
      {error ? <div role="alert" data-testid="appointment-dialog-error" className="rounded-lg bg-rose-950 p-3 text-sm text-rose-100">{error}</div> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-xl border border-white/30 px-4 font-bold">Keep appointment</button><button type="submit" disabled={submitting} className={`min-h-11 rounded-xl px-4 font-bold text-white disabled:opacity-50 ${["decline","cancel","no_show"].includes(action) ? "bg-rose-700" : "bg-sky-700"}`}>{submitting ? "Working…" : labels[action]}</button></div>
    </form>
  </Modal>;
}
