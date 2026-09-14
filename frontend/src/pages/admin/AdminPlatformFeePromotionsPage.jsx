import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api";

const ENDPOINT = "/api/projects/admin/fees/promotions/";

const toLocalInput = (date) => {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

const initialForm = () => {
  const start = new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + 60);
  return {
    contractor_id: "",
    code: "FOUNDING-CONTRACTOR",
    waiver_percent: "100.00",
    starts_at: toLocalInput(start),
    ends_at: toLocalInput(end),
    reason: "",
  };
};

const errorText = (error) => {
  const data = error?.response?.data;
  if (!data) return "The waiver could not be saved. Try again.";
  if (typeof data.detail === "string") return data.detail;
  const first = Object.values(data).flat()[0];
  return first ? String(first) : "The waiver could not be saved. Try again.";
};

const grantStatus = (grant, serverTime) => {
  if (!grant.active) return "ended";
  const now = new Date(serverTime || Date.now()).getTime();
  if (new Date(grant.starts_at).getTime() > now) return "scheduled";
  if (new Date(grant.ends_at).getTime() <= now) return "expired";
  return "active";
};

const timeRemaining = (date, serverTime) => {
  const milliseconds = new Date(date).getTime() - new Date(serverTime || Date.now()).getTime();
  if (milliseconds <= 0) return "Expired";
  const days = Math.ceil(milliseconds / 86400000);
  return `${days} day${days === 1 ? "" : "s"} remaining`;
};

export default function AdminPlatformFeePromotionsPage() {
  const [data, setData] = useState({ results: [], contractors: [] });
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [editingGrantId, setEditingGrantId] = useState(null);
  const [editWindow, setEditWindow] = useState({ starts_at: "", ends_at: "" });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(ENDPOINT);
      setData(response.data || { results: [], contractors: [] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const contractorOptions = useMemo(() => data.contractors || [], [data.contractors]);
  const selectedContractor = useMemo(
    () => contractorOptions.find((contractor) => String(contractor.id) === String(form.contractor_id)),
    [contractorOptions, form.contractor_id]
  );
  const filteredGrants = useMemo(() => (data.results || []).filter((grant) => (
    statusFilter === "all" || grantStatus(grant, data.server_time) === statusFilter
  )), [data.results, data.server_time, statusFilter]);

  const submit = async (event) => {
    event.preventDefault();
    const confirmed = window.confirm(
      `Grant a ${Number(form.waiver_percent)}% platform fee waiver to ${selectedContractor?.name || "this contractor"} (${selectedContractor?.email || "unknown email"}, account #${selectedContractor?.id || "—"})?`
    );
    if (!confirmed) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.post(ENDPOINT, {
        ...form,
        contractor_id: Number(form.contractor_id),
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
      });
      setMessage("Platform fee waiver granted. It applies only during the dates shown below.");
      setForm(initialForm());
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (grant) => {
    if (!window.confirm(`End ${grant.code} for ${grant.contractor_name}? Future transactions will immediately use the normal platform fee.`)) return;
    setMessage("");
    setError("");
    try {
      await api.patch(`${ENDPOINT}${grant.id}/`, { active: false });
      setMessage(`${grant.code} was ended. Future platform fees will use the contractor's normal rate.`);
      await load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const beginEdit = (grant) => {
    setEditingGrantId(grant.id);
    setEditWindow({ starts_at: toLocalInput(grant.starts_at), ends_at: toLocalInput(grant.ends_at) });
  };

  const saveWindow = async (grant) => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.patch(`${ENDPOINT}${grant.id}/`, {
        starts_at: new Date(editWindow.starts_at).toISOString(),
        ends_at: new Date(editWindow.ends_at).toISOString(),
      });
      setEditingGrantId(null);
      setMessage(`${grant.code} dates were updated. The change was recorded in the promotion audit history.`);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 text-white md:px-6" data-testid="admin-platform-fee-promotions-page">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-200">Financial Operations</p>
            <h1 className="mt-1 text-3xl font-black">Platform Fee Waivers</h1>
            <p className="mt-2 max-w-3xl text-sm text-sky-100/80">
              MyHomeBro controls which contractor receives a waiver and exactly when it starts and ends. Contractors cannot activate or extend these grants.
            </p>
          </div>
          <Link to="/app/admin?view=fee_audit" className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-extrabold hover:bg-white/15">
            Back to Financial Operations
          </Link>
        </div>

        {message ? <div className="mt-5 rounded-xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-sm font-bold text-emerald-100">{message}</div> : null}
        {error ? <div role="alert" className="mt-5 rounded-xl border border-rose-300/30 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 shadow-xl">
          <h2 className="text-lg font-black">Grant a waiver</h2>
          <p className="mt-1 text-sm text-sky-100/70">A 100% waiver makes MyHomeBro&apos;s platform fee $0. Stripe processing charges are separate and are not waived.</p>
          <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">Contractor
              <select required data-testid="fee-waiver-contractor" value={form.contractor_id} onChange={(e) => setForm({ ...form, contractor_id: e.target.value })} className="mt-1 w-full rounded-xl border border-white/15 bg-[#071a35] px-3 py-2 text-white">
                <option value="">Choose contractor</option>
                {contractorOptions.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.name} — {contractor.email} — Account #{contractor.id}</option>)}
              </select>
              {selectedContractor ? (
                <span className="mt-2 block rounded-lg border border-amber-200/25 bg-amber-200/10 px-3 py-2 text-xs leading-5 text-amber-50">
                  Confirm account: <strong>{selectedContractor.name}</strong><br />{selectedContractor.email} · Contractor #{selectedContractor.id}
                </span>
              ) : null}
            </label>
            <label className="text-sm font-bold">Internal code or label
              <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="mt-1 w-full rounded-xl border border-white/15 bg-[#071a35] px-3 py-2 text-white" />
            </label>
            <label className="text-sm font-bold">Starts
              <input required type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} className="mt-1 w-full rounded-xl border border-white/15 bg-[#071a35] px-3 py-2 text-white" />
            </label>
            <label className="text-sm font-bold">Ends
              <input required type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className="mt-1 w-full rounded-xl border border-white/15 bg-[#071a35] px-3 py-2 text-white" />
            </label>
            <label className="text-sm font-bold">Platform fee waiver
              <select value={form.waiver_percent} onChange={(e) => setForm({ ...form, waiver_percent: e.target.value })} className="mt-1 w-full rounded-xl border border-white/15 bg-[#071a35] px-3 py-2 text-white">
                <option value="100.00">100% — no MyHomeBro platform fee</option>
                <option value="50.00">50% reduction</option>
                <option value="25.00">25% reduction</option>
              </select>
            </label>
            <label className="text-sm font-bold">Owner note
              <input required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Why this contractor received the waiver" className="mt-1 w-full rounded-xl border border-white/15 bg-[#071a35] px-3 py-2 text-white" />
            </label>
            <div className="md:col-span-2">
              <button disabled={saving} data-testid="grant-fee-waiver" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white hover:bg-blue-500 disabled:opacity-60">
                {saving ? "Granting…" : "Grant Platform Fee Waiver"}
              </button>
            </div>
          </form>
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Granted waivers</h2>
              <p className="mt-1 text-xs text-sky-100/65">Times are displayed in your device&apos;s local timezone.</p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Filter waivers">
              {["active", "scheduled", "expired", "ended", "all"].map((status) => (
                <button key={status} type="button" onClick={() => setStatusFilter(status)} className={`rounded-full border px-3 py-1.5 text-xs font-black capitalize ${statusFilter === status ? "border-sky-200 bg-sky-100 text-slate-950" : "border-white/15 bg-white/5 text-sky-50 hover:bg-white/10"}`}>
                  {status}
                </button>
              ))}
            </div>
          </div>
          {loading ? <p className="mt-4 text-sm text-sky-100/70">Loading waivers…</p> : null}
          {!loading && !filteredGrants.length ? <p className="mt-4 text-sm text-sky-100/70">No {statusFilter === "all" ? "" : `${statusFilter} `}platform fee waivers.</p> : null}
          <div className="mt-4 space-y-3">
            {filteredGrants.map((grant) => {
              const status = grantStatus(grant, data.server_time);
              return (
              <article key={grant.id} className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid={`fee-waiver-${grant.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black">{grant.contractor_name}</h3>
                      <span className={`rounded-full px-2 py-1 text-xs font-black ${status === "active" ? "bg-emerald-300 text-emerald-950" : status === "scheduled" ? "bg-amber-200 text-amber-950" : "bg-slate-600 text-white"}`}>
                        {status === "active" ? "Active now" : status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-sky-100/75">{grant.code} · {Number(grant.waiver_percent)}% waiver · Contractor #{grant.contractor_id}</p>
                    <p className="mt-1 text-sm text-sky-100/75">{grant.contractor_email}</p>
                    {editingGrantId === grant.id ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="text-xs font-bold">Starts<input type="datetime-local" value={editWindow.starts_at} onChange={(event) => setEditWindow((current) => ({ ...current, starts_at: event.target.value }))} className="mt-1 w-full rounded-lg border border-white/15 bg-[#071a35] px-2 py-1.5 text-white" /></label>
                        <label className="text-xs font-bold">Ends<input type="datetime-local" value={editWindow.ends_at} onChange={(event) => setEditWindow((current) => ({ ...current, ends_at: event.target.value }))} className="mt-1 w-full rounded-lg border border-white/15 bg-[#071a35] px-2 py-1.5 text-white" /></label>
                        <div className="flex gap-2 sm:col-span-2">
                          <button type="button" disabled={saving} onClick={() => saveWindow(grant)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-black text-white">Save dates</button>
                          <button type="button" onClick={() => setEditingGrantId(null)} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-black text-white">Cancel</button>
                        </div>
                      </div>
                    ) : <p className="mt-1 text-sm text-sky-100/75">{new Date(grant.starts_at).toLocaleString()} through {new Date(grant.ends_at).toLocaleString()} · {timeRemaining(grant.ends_at, data.server_time)}</p>}
                    {grant.reason ? <p className="mt-1 text-sm text-sky-100/75">Owner note: {grant.reason}</p> : null}
                  </div>
                  {grant.active && editingGrantId !== grant.id ? <div className="flex gap-2"><button type="button" onClick={() => beginEdit(grant)} className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-black text-white hover:bg-white/10">Edit dates</button><button type="button" onClick={() => deactivate(grant)} className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm font-black text-rose-100 hover:bg-rose-400/20">End waiver</button></div> : null}
                </div>
              </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
