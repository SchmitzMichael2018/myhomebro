import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

function money(value) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function statusClasses(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("paid")) return "bg-emerald-100 text-emerald-800";
  if (normalized.includes("approved")) return "bg-blue-100 text-blue-800";
  if (normalized.includes("change")) return "bg-amber-100 text-amber-800";
  if (normalized.includes("submitted")) return "bg-slate-100 text-slate-800";
  return "bg-gray-100 text-gray-700";
}

export default function MagicDrawRequest() {
  const { token } = useParams();
  const [draw, setDraw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [changeNote, setChangeNote] = useState("");

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/projects/draws/magic/${encodeURIComponent(token)}/`);
      setDraw(data);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Unable to load this draw request.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const paymentMode = String(draw?.payment_mode || "").toLowerCase();
  const isDirect = paymentMode === "direct";
  const canReview = ["submitted", "approved"].includes(String(draw?.status || "").toLowerCase());
  const canContinuePayment =
    isDirect &&
    ["approved", "paid"].includes(String(draw?.status || "").toLowerCase()) &&
    !!String(draw?.stripe_checkout_url || "").trim();

  const title = useMemo(() => {
    if (!draw) return "Draw request";
    return `Draw ${draw.draw_number}: ${draw.title}`;
  }, [draw]);

  const approveDraw = async () => {
    if (!token) return;
    setActing(true);
    try {
      const { data } = await api.patch(`/projects/draws/magic/${encodeURIComponent(token)}/approve/`, {});
      setDraw(data);
      if (data?.mode === "direct_checkout" && data?.checkout_url) {
        toast.success("Approved. Continue to secure payment when you're ready.");
      } else {
        toast.success("Draw approved.");
      }
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Unable to approve this draw.");
    } finally {
      setActing(false);
    }
  };

  const requestChanges = async () => {
    if (!token) return;
    setActing(true);
    try {
      const { data } = await api.patch(`/projects/draws/magic/${encodeURIComponent(token)}/request_changes/`, {
        note: changeNote,
      });
      setDraw(data);
      toast.success("Change request sent.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Unable to request changes.");
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-4xl p-6 text-sm text-slate-500">Loading draw request…</div>;
  }

  if (!draw) {
    return <div className="mx-auto max-w-4xl p-6 text-sm text-slate-500">Draw request not found.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Commercial draw review
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Review the requested stage billing, respond in MyHomeBro, and continue to payment here when this agreement uses Direct Pay.
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusClasses(draw.status)}`}>
            {String(draw.status || "").replaceAll("_", " ")}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Requested Now</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{money(draw.net_amount)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Gross Amount</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{money(draw.gross_amount)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Retainage</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">{money(draw.retainage_amount)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Payment Mode</div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {isDirect ? "Direct Pay" : "Escrow"}
            </div>
          </div>
        </div>

        {Number(draw.retainage_amount || 0) > 0 ? (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            Retainage is included in this draw. Final released amounts can differ from scheduled values until retainage is released.
          </div>
        ) : null}

        {draw.notes ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contractor notes</div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{draw.notes}</div>
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Stage</th>
                <th className="px-4 py-3">Scheduled Value</th>
                <th className="px-4 py-3">% Complete</th>
                <th className="px-4 py-3">This Draw</th>
                <th className="px-4 py-3">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(draw.line_items) ? draw.line_items : []).map((item) => (
                <tr key={item.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 text-slate-800">{item.milestone_title || item.description}</td>
                  <td className="px-4 py-3 text-slate-700">{money(item.scheduled_value)}</td>
                  <td className="px-4 py-3 text-slate-700">{Number(item.percent_complete || 0).toFixed(2)}%</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{money(item.this_draw_amount)}</td>
                  <td className="px-4 py-3 text-slate-700">{money(item.remaining_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {String(draw.status || "").toLowerCase() === "paid" ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
            This draw has been paid. Thank you.
          </div>
        ) : canContinuePayment ? (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
            <div className="text-sm font-semibold text-emerald-900">Payment ready</div>
            <div className="mt-1 text-sm text-emerald-800">
              This draw has been approved. Continue to secure Stripe payment when you’re ready.
            </div>
            <a
              href={draw.stripe_checkout_url}
              className="mt-4 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Continue to Secure Payment
            </a>
            <div className="mt-2 text-xs text-emerald-900/80">Stripe supports card and ACH for this direct-payment draw.</div>
          </div>
        ) : canReview ? (
          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
              <div className="text-sm font-semibold text-slate-900">Approve</div>
              <div className="mt-1 text-sm text-slate-600">
                Approve this draw if the work and requested amount look right.
              </div>
              <button
                type="button"
                onClick={approveDraw}
                disabled={acting}
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {acting ? "Working…" : isDirect ? "Approve & Continue" : "Approve Draw"}
              </button>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="text-sm font-semibold text-amber-900">Request changes</div>
              <div className="mt-1 text-sm text-amber-800">
                Ask for clarification or updated progress before this draw moves forward.
              </div>
              <textarea
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                className="mt-3 min-h-[110px] w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-800"
                placeholder="Optional note for your contractor"
              />
              <button
                type="button"
                onClick={requestChanges}
                disabled={acting}
                className="mt-3 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
              >
                {acting ? "Working…" : "Request Changes"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
            This draw is currently {String(draw.status || "").replaceAll("_", " ")}.
            {draw.homeowner_review_notes ? (
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{draw.homeowner_review_notes}</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
