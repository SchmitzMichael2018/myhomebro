import React, { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api";

export default function CustomerPortalActivationPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [setup, setSetup] = useState(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/projects/proposal-portal-activations/${encodeURIComponent(token)}/`).then(({ data }) => setSetup(data)).catch((err) => setError(err?.response?.data?.detail || "This setup link is unavailable.")); }, [token]);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const { data } = await api.post(`/projects/proposal-portal-activations/${encodeURIComponent(token)}/`, { password, password_confirm: confirm });
      navigate(data.portal_url);
    } catch (err) { setError(err?.response?.data?.detail || err?.response?.data?.password?.[0] || err?.response?.data?.password_confirm?.[0] || "Your account could not be created."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen overflow-x-hidden bg-slate-950 px-4 py-10 text-white" data-testid="customer-portal-activation"><div className="mx-auto max-w-lg rounded-3xl border border-white/12 bg-slate-900 p-6 shadow-2xl"><p className="text-sm font-black uppercase tracking-wide text-amber-200">MyHomeBro Customer Portal</p><h1 className="mt-2 text-3xl font-black">Keep your project in one place</h1><p className="mt-3 text-slate-300">Choose your own password to access estimates, agreements, project updates, payments, and documents. Your estimate remains available without an account.</p>{error ? <p role="alert" className="mt-4 rounded-xl border border-red-300/30 bg-red-950/30 p-3">{error}</p> : null}{setup?.account_exists ? <div className="mt-5"><p>An account already exists for <strong>{setup.email}</strong>.</p><Link to="/portal" className="mt-4 inline-flex rounded-xl bg-amber-300 px-4 py-3 font-black text-slate-950">Sign in to MyHomeBro</Link></div> : setup ? <form onSubmit={submit} className="mt-6 space-y-4"><label className="block"><span className="font-bold">Email</span><input value={setup.email} readOnly className="mt-2 w-full rounded-xl border border-white/12 bg-slate-950 px-4 py-3 text-slate-300" /></label><label className="block"><span className="font-bold">Create password</span><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-2 w-full rounded-xl border border-white/20 bg-slate-950 px-4 py-3" /></label><label className="block"><span className="font-bold">Confirm password</span><input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="mt-2 w-full rounded-xl border border-white/20 bg-slate-950 px-4 py-3" /></label><button disabled={busy} className="w-full rounded-xl bg-amber-300 px-4 py-3 font-black text-slate-950 disabled:opacity-50">{busy ? "Creating account…" : "Create MyHomeBro Account"}</button><Link to={setup.estimate_url} className="block text-center text-sm font-bold text-sky-200 underline">Return to estimate without creating an account</Link></form> : !error ? <p className="mt-5" role="status">Checking setup link…</p> : null}</div></main>;
}
