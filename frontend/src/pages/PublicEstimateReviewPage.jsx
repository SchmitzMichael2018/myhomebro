import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import CustomerConversation from "../components/CustomerConversation.jsx";

const ACKNOWLEDGEMENT = "I approve this estimate as the basis for preparing the project agreement. This does not sign or execute the agreement.";
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));

export default function PublicEstimateReviewPage() {
  const { token = "" } = useParams();
  const [review, setReview] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    api.get(`/projects/proposal-reviews/${encodeURIComponent(token)}/`).then(({ data }) => setReview(data)).catch((err) => setError(err?.response?.data?.detail || "This estimate could not be opened."));
  }, [token]);

  async function decide(action) {
    setBusy(true); setError("");
    try {
      const payload = { action };
      if (action === "accept") payload.acknowledgement = acknowledged ? ACKNOWLEDGEMENT : "";
      if (action === "request_changes") payload.message = message;
      if (action === "decline") payload.reason = reason;
      const { data } = await api.post(`/projects/proposal-reviews/${encodeURIComponent(token)}/`, payload);
      setReview(data); setMode("");
    } catch (err) {
      setError(err?.response?.data?.detail || Object.values(err?.response?.data || {})?.flat()?.[0] || "Your response could not be saved.");
    } finally { setBusy(false); }
  }

  if (error && !review) return <main className="min-h-screen bg-slate-950 px-4 py-16 text-white"><div className="mx-auto max-w-2xl rounded-2xl border border-red-300/30 bg-red-950/30 p-6"><h1 className="text-2xl font-black">Estimate unavailable</h1><p className="mt-2">{error}</p></div></main>;
  if (!review) return <main className="min-h-screen bg-slate-950 p-8 text-center text-white" role="status">Loading estimate…</main>;
  const estimate = review.estimate || {}; const project = estimate.project || {}; const pricing = estimate.pricing || {};
  const pending = ["sent", "viewed"].includes(review.status) && !review.is_expired;
  return <main className="min-h-screen overflow-x-hidden bg-slate-950 px-3 py-6 text-slate-100 sm:px-6" data-testid="customer-estimate-review">
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="rounded-2xl border border-sky-200/15 bg-slate-900 p-5 shadow-xl"><p className="text-sm font-bold text-sky-200">Estimate from {estimate.contractor?.name}</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">{project.title || "Project estimate"}</h1><p className="mt-2 text-slate-300">{project.property}</p></header>
      {review.is_expired ? <div className="rounded-xl border border-amber-300/30 bg-amber-950/30 p-4 font-semibold">This estimate is no longer valid. Contact the contractor for an updated estimate.</div> : null}
      {review.status === "accepted" ? <div className="rounded-xl border border-emerald-300/30 bg-emerald-950/30 p-4"><strong>Estimate accepted</strong><p className="mt-1 text-sm">Accepted as the basis for preparing the agreement. This is not an Agreement signature.</p></div> : null}
      {review.status === "revision_requested" ? <div className="rounded-xl border border-sky-300/30 bg-sky-950/30 p-4"><strong>Changes requested</strong><p className="mt-1">{review.revision_request_message}</p></div> : null}
      {review.status === "declined" ? <div className="rounded-xl border border-slate-400/30 bg-slate-900 p-4"><strong>Estimate declined</strong>{review.decline_reason ? <p className="mt-1">{review.decline_reason}</p> : null}</div> : null}
      <section className="rounded-2xl border border-white/10 bg-slate-900 p-5"><h2 className="text-xl font-black">Project</h2>{project.description ? <p className="mt-3 whitespace-pre-wrap text-slate-300">{project.description}</p> : null}{[["Included work", project.included_work], ["Exclusions", project.excluded_work], ["Assumptions", project.assumptions], ["Allowances", project.allowances]].filter(([,v]) => v).map(([label,v]) => <div key={label} className="mt-4"><h3 className="font-bold text-sky-200">{label}</h3><p className="mt-1 whitespace-pre-wrap text-slate-300">{v}</p></div>)}</section>
      <section className="rounded-2xl border border-white/10 bg-slate-900 p-5" data-testid="customer-estimate-pricing"><h2 className="text-xl font-black">Pricing</h2><table className="mt-3 w-full table-fixed text-left"><thead className="text-sm text-slate-400"><tr><th className="w-auto py-2 pr-4">Description</th><th className="w-32 py-2 text-right sm:w-40">Price</th></tr></thead><tbody>{(pricing.line_items || []).map((item, i) => <tr key={`${item.description}-${i}`} className="border-t border-white/10" data-testid="customer-estimate-line-item"><td className="break-words py-3 pr-4 font-semibold">{item.description}</td><td className="whitespace-nowrap py-3 text-right text-base font-bold text-slate-100" data-testid="customer-estimate-line-price">{money(item.total)}</td></tr>)}</tbody></table><dl className="ml-auto mt-4 max-w-sm space-y-2 border-t border-white/10 pt-4"><div className="flex items-baseline justify-between gap-4"><dt>Subtotal</dt><dd className="whitespace-nowrap font-semibold">{money(pricing.subtotal)}</dd></div>{Number(pricing.incidentals_reserve) ? <div className="flex items-baseline justify-between gap-4"><dt>Incidentals</dt><dd className="whitespace-nowrap font-semibold">{money(pricing.incidentals_reserve)}</dd></div> : null}{Number(pricing.tax) ? <div className="flex items-baseline justify-between gap-4"><dt>Tax</dt><dd className="whitespace-nowrap font-semibold">{money(pricing.tax)}</dd></div> : null}{Number(pricing.discounts) ? <div className="flex items-baseline justify-between gap-4"><dt>Discounts</dt><dd className="whitespace-nowrap font-semibold">-{money(pricing.discounts)}</dd></div> : null}<div className="flex items-baseline justify-between gap-4 border-t border-white/15 pt-3 text-xl font-black"><dt>Estimate Total</dt><dd className="whitespace-nowrap">{money(pricing.total)}</dd></div></dl></section>
      {error ? <p role="alert" className="rounded-lg border border-red-300/30 bg-red-950/30 p-3">{error}</p> : null}
      {pending ? <section className="rounded-2xl border border-white/10 bg-slate-900 p-5"><h2 className="text-lg font-black">Your response</h2>{!mode ? <div className="mt-4 flex flex-col gap-2 sm:flex-row"><button className="rounded-lg bg-amber-300 px-4 py-3 font-black text-slate-950" onClick={() => setMode("accept")}>Accept Estimate</button><button className="rounded-lg border border-sky-200/30 px-4 py-3 font-bold" onClick={() => setMode("request_changes")}>Request Changes</button><button className="rounded-lg border border-white/15 px-4 py-3 font-bold" onClick={() => setMode("decline")}>Decline</button></div> : null}{mode === "accept" ? <div className="mt-4"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /><span>{ACKNOWLEDGEMENT}</span></label><button disabled={!acknowledged || busy} onClick={() => decide("accept")} className="mt-4 rounded-lg bg-amber-300 px-4 py-3 font-black text-slate-950 disabled:opacity-50">Confirm acceptance</button></div> : null}{mode === "request_changes" ? <div className="mt-4"><label className="font-bold" htmlFor="revision-message">What should change?</label><textarea id="revision-message" value={message} onChange={(e) => setMessage(e.target.value)} className="mt-2 min-h-28 w-full rounded-lg border border-white/20 bg-slate-950 p-3"/><button disabled={!message.trim() || busy} onClick={() => decide("request_changes")} className="mt-3 rounded-lg bg-sky-300 px-4 py-3 font-black text-slate-950 disabled:opacity-50">Send request</button></div> : null}{mode === "decline" ? <div className="mt-4"><label className="font-bold" htmlFor="decline-reason">Reason (optional)</label><select id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-2 w-full rounded-lg border border-white/20 bg-slate-950 p-3"><option value="">Prefer not to say</option>{["Not ready", "Price", "Scope", "Timing", "Chose another provider", "Other"].map(v => <option key={v}>{v}</option>)}</select><button disabled={busy} onClick={() => decide("decline")} className="mt-3 rounded-lg border border-red-300/40 px-4 py-3 font-black">Confirm decline</button></div> : null}{mode ? <button className="mt-3 text-sm font-bold underline" onClick={() => setMode("")}>Cancel</button> : null}</section> : null}
      {review.portal ? <aside className="rounded-2xl border border-sky-200/15 bg-slate-900/70 p-4" data-testid="estimate-portal-promotion"><h2 className="font-black">{review.portal.account_exists ? "Keep everything together in MyHomeBro" : "Keep your project in one place"}</h2><p className="mt-1 text-sm text-slate-300">{review.portal.account_exists ? "View this estimate alongside your agreements, projects, payments, documents, and updates." : "Create a MyHomeBro account to keep estimates, agreements, project updates, payments, and documents together. You can review this estimate now without an account."}</p><a href={review.portal.url} className="mt-3 inline-flex rounded-lg border border-sky-200/30 px-3 py-2 text-sm font-bold text-sky-100 underline underline-offset-2">{review.portal.label}</a></aside> : null}
      <CustomerConversation endpoint={`/projects/proposal-reviews/${encodeURIComponent(token)}/messages/`} initialConversation={review.conversation} customerMode title="Ask a Question" />
    </div>
  </main>;
}
