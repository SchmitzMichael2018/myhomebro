import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";
import logo from "../assets/myhomebro_logo.png";

function formatDateTime(value) {
  if (!value) return "To be coordinated";
  try {
    return new Date(value).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value);
  }
}

export default function PropertyWorkOrderInvitationPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.get(
        `/projects/work-order-invitations/${encodeURIComponent(token)}/details/`
      );
      setData(response.data);
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          "This work-order invitation is invalid or no longer available."
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const invitation = data?.invitation;
  const workOrder = data?.work_order;
  const statusLabel = useMemo(
    () => invitation?.status_label || invitation?.status || "Pending response",
    [invitation]
  );

  const respond = async (action) => {
    try {
      setSubmitting(action);
      setError("");
      const response = await api.post(
        `/projects/work-order-invitations/${encodeURIComponent(token)}/${action}/`,
        {}
      );
      setData(response.data);
      toast.success(action === "accept" ? "Work order accepted." : "Work order declined.");
    } catch (err) {
      const message = err?.response?.data?.detail || "We could not record your response.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting("");
    }
  };

  const canRespond = ["pending", "sent"].includes(String(invitation?.status || ""));

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <main className="mx-auto max-w-3xl">
        <Link to="/" className="inline-flex items-center gap-3">
          <img src={logo} alt="MyHomeBro" className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
          <span className="text-sm font-black uppercase tracking-[0.2em] text-amber-100">MyHomeBro</span>
        </Link>

        <section data-testid="property-work-order-invitation" className="mt-6 rounded-3xl border border-slate-700 bg-slate-900/90 p-5 shadow-2xl shadow-black/30 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-200">Work Order Invitation</div>
              <h1 className="mt-2 text-2xl font-black text-white sm:text-3xl">Review the job before responding</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">Nothing is accepted until you choose Accept Work Order.</p>
            </div>
            {!loading && !error ? (
              <span data-testid="property-work-order-invitation-status" className="rounded-full border border-sky-300/35 bg-sky-400/10 px-3 py-1 text-xs font-bold text-sky-100">
                {statusLabel}
              </span>
            ) : null}
          </div>

          {loading ? (
            <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/70 p-5 text-sm text-slate-300">Loading work order…</div>
          ) : error ? (
            <div data-testid="property-work-order-invitation-error" className="mt-6 rounded-2xl border border-rose-300/35 bg-rose-400/10 p-5 text-sm text-rose-100">{error}</div>
          ) : (
            <>
              <div className="mt-6 rounded-2xl border border-slate-700 bg-slate-950/70 p-5">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{workOrder?.work_order_number || "Work order"}</div>
                <h2 className="mt-2 text-xl font-black text-white">{workOrder?.title || "Maintenance work"}</h2>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{workOrder?.description || "No description was provided."}</p>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div><dt className="font-semibold text-slate-400">Property manager</dt><dd className="mt-1 text-white">{data?.company?.name || "Property management team"}</dd></div>
                  <div><dt className="font-semibold text-slate-400">Property</dt><dd className="mt-1 text-white">{workOrder?.property_name || "Managed property"}{workOrder?.unit_label ? ` · ${workOrder.unit_label}` : ""}</dd></div>
                  <div><dt className="font-semibold text-slate-400">Priority</dt><dd className="mt-1 text-white">{workOrder?.priority_label || "Normal"}</dd></div>
                  <div><dt className="font-semibold text-slate-400">Scheduled visit</dt><dd className="mt-1 text-white">{formatDateTime(workOrder?.scheduled_for)}</dd></div>
                </dl>
              </div>

              {canRespond ? (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button data-testid="property-work-order-invitation-accept" type="button" disabled={!!submitting} onClick={() => respond("accept")} className="rounded-xl bg-emerald-300 px-5 py-3 text-sm font-extrabold text-slate-950 hover:bg-emerald-200 disabled:opacity-50">
                    {submitting === "accept" ? "Accepting…" : "Accept Work Order"}
                  </button>
                  <button data-testid="property-work-order-invitation-decline" type="button" disabled={!!submitting} onClick={() => respond("decline")} className="rounded-xl border border-slate-600 px-5 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50">
                    {submitting === "decline" ? "Declining…" : "Decline Work Order"}
                  </button>
                </div>
              ) : (
                <div data-testid="property-work-order-invitation-complete" className="mt-6 rounded-2xl border border-emerald-300/35 bg-emerald-400/10 p-4 text-sm font-semibold text-emerald-100">
                  Your response has been recorded. You may close this page.
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
