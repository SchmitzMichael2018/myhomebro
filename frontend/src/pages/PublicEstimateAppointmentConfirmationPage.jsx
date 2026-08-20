import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";

export default function PublicEstimateAppointmentConfirmationPage() {
  const { token = "" } = useParams();
  const [appointment, setAppointment] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/projects/public/estimate-appointments/${encodeURIComponent(token)}/`).then(({ data }) => setAppointment(data.appointment)).catch(() => setError("This appointment link is invalid or no longer available.")); }, [token]);
  async function act(action) {
    setBusy(true); setError("");
    try { const { data } = await api.post(`/projects/public/estimate-appointments/${encodeURIComponent(token)}/`, { action, reason }); setAppointment(data.appointment); setMessage(data.message); }
    catch { setError("This appointment link is invalid or no longer available."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950 sm:py-12"><section className="mx-auto w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl" data-testid="public-appointment-confirmation">
    <header className="bg-slate-950 px-5 py-6 text-white sm:px-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">MyHomeBro</p><h1 className="mt-2 text-2xl font-black">Estimate appointment</h1><p className="mt-2 text-sm text-slate-200">Review this appointment without creating an account.</p></header>
    <div className="space-y-5 p-5 sm:p-8">
      {error ? <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 font-semibold text-rose-900">{error}</div> : null}
      {!appointment && !error ? <p className="text-sm font-semibold text-slate-600">Loading appointment…</p> : null}
      {appointment ? <><dl className="grid gap-3 text-sm sm:grid-cols-2">{[["Status", appointment.display_status], ["Contractor", appointment.contractor_name], ["Date", appointment.local_date], ["Time", appointment.local_time], ["Time zone", appointment.timezone_label], ["Type", appointment.appointment_type_label], ["Location", appointment.location || "Provided separately"]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-100 p-3"><dt className="font-bold text-slate-600">{label}</dt><dd className="mt-1 font-black text-slate-950">{value}</dd></div>)}</dl>
        {message ? <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">{message}</div> : null}
        {appointment.status === "proposed" ? <><div><label htmlFor="appointment-customer-reason" className="block text-sm font-bold text-slate-800">Message to contractor (optional)</label><textarea id="appointment-customer-reason" value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-slate-400 bg-white p-3 text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500" /></div><div className="grid gap-3 sm:grid-cols-3"><button disabled={busy} onClick={() => act("confirm")} className="min-h-11 rounded-xl bg-emerald-700 px-4 py-3 font-black text-white">Confirm appointment</button><button disabled={busy} onClick={() => act("request_another_time")} className="min-h-11 rounded-xl border border-slate-400 bg-white px-4 py-3 font-black text-slate-900">Request another time</button><button disabled={busy} onClick={() => act("decline")} className="min-h-11 rounded-xl border border-rose-400 bg-white px-4 py-3 font-black text-rose-800">Decline appointment</button></div></> : null}
        {appointment.confirmed ? <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><a href={appointment.google_calendar_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-3 font-black text-white">Add to Google Calendar</a><a href={appointment.ics_url} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-400 bg-white px-4 py-3 font-black text-slate-950">Add to Apple/Outlook Calendar</a></div><p className="text-xs font-semibold text-slate-600">{appointment.calendar_export_note}</p></div> : null}
      </> : null}
    </div></section></main>;
}
