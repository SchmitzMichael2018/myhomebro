import React, { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

const money = (cents = 0) => (Number(cents || 0) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
const date = (value) => value ? new Date(value).toLocaleDateString() : "—";
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ReferralDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [creditOption, setCreditOption] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const loadData = useCallback(() => api.get("/projects/referrals/dashboard/").then(({ data: payload }) => {
    setData(payload);
    setError("");
  }).catch((err) => {
    setError(err?.response?.data?.detail || "Referral activity could not be loaded.");
  }), []);
  useEffect(() => {
    let active = true;
    api.get("/projects/referrals/dashboard/").then(({ data: payload }) => {
      if (active) setData(payload);
    }).catch((err) => {
      if (active) setError(err?.response?.data?.detail || "Referral activity could not be loaded.");
    });
    return () => { active = false; };
  }, []);

  const shareText = useMemo(() => data?.referral_link
    ? `Join MyHomeBro using my referral link: ${data.referral_link}`
    : "", [data?.referral_link]);
  const recordInvitation = (channel) => {
    api.post("/projects/referrals/dashboard/", { channel }).catch(() => {});
    setData((current) => current ? {
      ...current,
      summary: { ...current.summary, invitations: Number(current.summary?.invitations || 0) + 1 },
    } : current);
  };
  const copyLink = async () => {
    await navigator.clipboard.writeText(data.referral_link);
    recordInvitation("copy");
    toast.success("Referral link copied.");
  };
  const cashOut = async () => {
    setBusyAction("cash");
    try {
      const { data: result } = await api.post("/projects/referrals/dashboard/", { action: "cash_out" });
      toast.success(result.requires_onboarding
        ? "Rewards reserved. Complete supported payout onboarding before payment."
        : "Cash-out request submitted for review.");
      await loadData();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Cash-out request could not be submitted.");
    } finally {
      setBusyAction("");
    }
  };
  const applyProjectCredit = async () => {
    const option = (data.credit_options || []).find((row) => String(row.invoice_id) === creditOption);
    if (!option) {
      toast.error("Choose a qualifying project invoice.");
      return;
    }
    const amountCents = Math.round(Number(creditAmount || 0) * 100);
    if (amountCents <= 0) {
      toast.error("Enter a positive reward amount.");
      return;
    }
    setBusyAction("credit");
    try {
      const { data: result } = await api.post("/projects/referrals/dashboard/", {
        action: "project_credit",
        project_id: option.project_id,
        invoice_id: option.invoice_id,
        amount_cents: amountCents,
      });
      toast.success(result.integration_required
        ? "Rewards reserved for this invoice. They will not reduce payment until funding integration is verified."
        : "Referral rewards applied to the project.");
      setCreditAmount("");
      await loadData();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Project credit could not be reserved.");
    } finally {
      setBusyAction("");
    }
  };
  if (error) return <main className="p-6 text-rose-200">{error}</main>;
  if (!data) return <main className="p-6 text-slate-200">Loading referral activity…</main>;

  const summary = data.summary || {};
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-slate-100 sm:p-6" data-testid="referral-dashboard">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">MyHomeBro referral rewards</p>
        <h1 className="mt-2 text-3xl font-black">Share MyHomeBro. Track every qualifying reward.</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">Refer contractors, homeowners, or property managers with one stable link. Rewards come only from eligible MyHomeBro platform fees; project funds, taxes, refunds, reversals, and unresolved disputes are excluded.</p>
      </header>

      {(data.founding || []).map((award) => (
        <section key={`${award.pool}-${award.slot_number}`} className="rounded-2xl border border-amber-300/35 bg-amber-300/10 p-5" data-testid="founding-referral-status">
          <div className="font-bold">Founding {award.pool === "contractor" ? "Contractor" : "Homeowner / Property Manager"} slot #{award.slot_number} · {title(award.status)}</div>
          <div className="mt-1 text-sm text-amber-100">
            {award.status === "awarded"
              ? `Founding-rate referrals may be made through ${date(award.promotion_ends_at)}.`
              : `Reserved through ${date(award.qualification_deadline)} while qualification requirements are completed.`}
          </div>
        </section>
      ))}

      <section className="grid gap-5 rounded-2xl border border-slate-700 bg-slate-900 p-5 md:grid-cols-[1fr_auto]">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Personal referral link</div>
          <div className="mt-2 break-all rounded-xl bg-slate-950 px-4 py-3 font-mono text-sm" data-testid="personal-referral-link">{data.referral_link}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={copyLink} className="rounded-lg bg-amber-300 px-4 py-2 font-bold text-slate-950">Copy link</button>
            <a onClick={() => recordInvitation("text")} href={`sms:?&body=${encodeURIComponent(shareText)}`} className="rounded-lg border border-slate-600 px-4 py-2 font-semibold">Text</a>
            <a onClick={() => recordInvitation("email")} href={`mailto:?subject=${encodeURIComponent("MyHomeBro contractor referral")}&body=${encodeURIComponent(shareText)}`} className="rounded-lg border border-slate-600 px-4 py-2 font-semibold">Email</a>
            <a onClick={() => recordInvitation("qr")} href={data.qr_code_data_url} download={`myhomebro-referral-${data.code}.png`} className="rounded-lg border border-slate-600 px-4 py-2 font-semibold">Download QR</a>
            <button type="button" onClick={() => { recordInvitation("print"); window.print(); }} className="rounded-lg border border-slate-600 px-4 py-2 font-semibold">Print referral card</button>
          </div>
        </div>
        <img src={data.qr_code_data_url} alt="Personal MyHomeBro referral QR code" className="h-40 w-40 rounded-xl bg-white p-2" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Invitations", summary.invitations], ["Registrations", summary.registrations], ["Verified", summary.verified],
          ["Activated", summary.activated], ["Active periods", summary.active_earning_periods],
          ["Expired / disqualified", summary.expired_or_disqualified],
          ["Pending", money(summary.pending_cents)], ["Available", money(summary.available_cents)],
          ["Cash-out requested", money(summary.cash_out_requested_cents)], ["Cash paid", money(summary.cash_paid_cents)],
          ["Applied to projects", money(summary.project_credit_cents)],
          ["Lifetime", money(summary.lifetime_cents)], ["Completed payouts", summary.completed_payouts],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="text-xs uppercase text-slate-400">{label}</div><div className="mt-1 text-2xl font-black">{value || 0}</div></div>)}
      </section>

      <section className="grid gap-4 rounded-2xl border border-slate-700 bg-slate-900 p-5 lg:grid-cols-2" data-testid="referral-redemption-options">
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <h2 className="font-bold">Cash out available rewards</h2>
          <p className="mt-2 text-sm text-slate-300">
            Contractors use their existing Stripe Connect payout account. Homeowners and property managers can earn first and complete supported payout onboarding only when cashing out.
          </p>
          <button type="button" onClick={cashOut} disabled={!summary.available_cents || busyAction} className="mt-4 rounded-lg bg-amber-300 px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
            {busyAction === "cash" ? "Submitting…" : `Cash out ${money(summary.available_cents)}`}
          </button>
          {data.payout_readiness?.requires_onboarding ? <p className="mt-2 text-xs text-amber-200">Cash payment remains gated until an approved Stripe payout identity is ready.</p> : null}
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <h2 className="font-bold">Apply rewards to a project invoice</h2>
          <p className="mt-2 text-sm text-slate-300">Only available rewards can be reserved. The same reward cannot be spent twice, and the credit cannot exceed the selected invoice.</p>
          <select value={creditOption} onChange={(event) => setCreditOption(event.target.value)} className="mt-4 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm">
            <option value="">Choose a project invoice</option>
            {(data.credit_options || []).map((option) => (
              <option key={option.invoice_id} value={option.invoice_id}>
                {option.project_title} · {option.invoice_number} · {money(option.invoice_amount_cents)}
              </option>
            ))}
          </select>
          <div className="mt-3 flex gap-2">
            <input type="number" min="0.01" step="0.01" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} placeholder="Reward amount" className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm" />
            <button type="button" onClick={applyProjectCredit} disabled={!summary.available_cents || !creditOption || busyAction} className="rounded-lg border border-amber-300 px-4 py-2 font-bold text-amber-200 disabled:cursor-not-allowed disabled:opacity-50">
              {busyAction === "credit" ? "Reserving…" : "Apply"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Production payment reduction remains gated until the Stripe funding integration is verified; a reservation does not claim that the contractor has been funded.</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
        <div className="border-b border-slate-700 px-5 py-4 font-bold">Referral activity</div>
        {data.referrals.length ? <div className="divide-y divide-slate-800">{data.referrals.map((row) => (
          <article key={row.id} className="grid gap-3 px-5 py-4 md:grid-cols-5" data-testid={`referral-row-${row.id}`}>
            <div><div className="font-semibold">{row.account_name || row.contractor_name}</div><div className="text-xs text-slate-400">{title(row.referred_role)} · Registered {date(row.registered_at)}</div></div>
            <div><div className="text-xs text-slate-400">Status</div><div>{title(row.status)}</div></div>
            <div><div className="text-xs text-slate-400">Reward</div><div>{row.reward_percent}% · {row.earning_months} months</div></div>
            <div><div className="text-xs text-slate-400">Earning window</div><div>{row.earning_starts_at ? `${date(row.earning_starts_at)}–${date(row.earning_ends_at)}` : `Activate by ${date(row.activation_deadline)}`}</div></div>
            <div><div className="text-xs text-slate-400">Earnings</div><div>{money(row.pending_cents)} pending · {money(row.available_cents)} available</div></div>
          </article>
        ))}</div> : <div className="px-5 py-10 text-center text-slate-400">No referred accounts yet. Share your personal link to get started.</div>}
      </section>
      <p className="text-xs text-slate-400">This is a single-level referral-reward program, not an investment, ownership interest, employment arrangement, or multilevel opportunity.</p>
    </main>
  );
}
