import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";

const money = (cents = 0) => (Number(cents || 0) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
const date = (value) => value ? new Date(value).toLocaleDateString() : "—";
const title = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ReferralDashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
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
    ? `Join MyHomeBro using my contractor referral link: ${data.referral_link}`
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
  if (error) return <main className="p-6 text-rose-200">{error}</main>;
  if (!data) return <main className="p-6 text-slate-200">Loading referral activity…</main>;

  const summary = data.summary || {};
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-slate-100 sm:p-6" data-testid="referral-dashboard">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Direct referral rewards</p>
        <h1 className="mt-2 text-3xl font-black">Recommend a contractor. Share in their success.</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-300">Rewards come only from qualifying MyHomeBro platform fees. Contractor project funds, taxes, processing fees, refunds, and unresolved disputes are excluded.</p>
      </header>

      {data.founding ? (
        <section className="rounded-2xl border border-amber-300/35 bg-amber-300/10 p-5" data-testid="founding-contractor-status">
          <div className="font-bold">Founding Contractor slot #{data.founding.slot_number} · {title(data.founding.status)}</div>
          <div className="mt-1 text-sm text-amber-100">
            {data.founding.status === "awarded"
              ? `Permanent Founding Contractor recognition. Promotional referral period ends ${date(data.founding.promotion_ends_at)}.`
              : `Reserved through ${date(data.founding.qualification_deadline)} while qualification requirements are completed.`}
          </div>
        </section>
      ) : null}

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
        <img src={data.qr_code_data_url} alt="Personal contractor referral QR code" className="h-40 w-40 rounded-xl bg-white p-2" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Invitations", summary.invitations], ["Registrations", summary.registrations], ["Verified", summary.verified],
          ["Activated", summary.activated], ["Active periods", summary.active_earning_periods],
          ["Expired / disqualified", summary.expired_or_disqualified],
          ["Pending", money(summary.pending_cents)], ["Available", money(summary.available_cents)],
          ["Paid", money(summary.paid_cents)], ["Completed payouts", summary.completed_payouts],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><div className="text-xs uppercase text-slate-400">{label}</div><div className="mt-1 text-2xl font-black">{value || 0}</div></div>)}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
        <div className="border-b border-slate-700 px-5 py-4 font-bold">Referral activity</div>
        {data.referrals.length ? <div className="divide-y divide-slate-800">{data.referrals.map((row) => (
          <article key={row.id} className="grid gap-3 px-5 py-4 md:grid-cols-5" data-testid={`referral-row-${row.id}`}>
            <div><div className="font-semibold">{row.contractor_name}</div><div className="text-xs text-slate-400">Registered {date(row.registered_at)}</div></div>
            <div><div className="text-xs text-slate-400">Status</div><div>{title(row.status)}</div></div>
            <div><div className="text-xs text-slate-400">Reward</div><div>{row.reward_percent}% · {row.program_code === "founding_50_6" ? "6 months" : "3 months"}</div></div>
            <div><div className="text-xs text-slate-400">Earning window</div><div>{row.earning_starts_at ? `${date(row.earning_starts_at)}–${date(row.earning_ends_at)}` : `Activate by ${date(row.activation_deadline)}`}</div></div>
            <div><div className="text-xs text-slate-400">Earnings</div><div>{money(row.pending_cents)} pending · {money(row.available_cents)} available</div></div>
          </article>
        ))}</div> : <div className="px-5 py-10 text-center text-slate-400">No contractor registrations yet. Share your personal link to get started.</div>}
      </section>
      <p className="text-xs text-slate-400">This is a single-level referral-reward program, not an investment, ownership interest, employment arrangement, or multilevel opportunity.</p>
    </main>
  );
}
