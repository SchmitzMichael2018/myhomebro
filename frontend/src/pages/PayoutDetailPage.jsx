import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";

function formatMoney(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function SummaryCard({ label, value, tone = "slate" }) {
  const toneMap = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    slate: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${toneMap[tone] || toneMap.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

export default function PayoutDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payout, setPayout] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError("");
        const { data } = await api.get(`/projects/payouts/history/${id}/`);
        if (!active) return;
        setPayout(data || null);
      } catch (err) {
        if (!active) return;
        console.error(err);
        const detail = err?.response?.data?.detail || "Failed to load payout detail.";
        setError(detail);
        setPayout(null);
        if (err?.response?.status !== 404) {
          toast.error(detail);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading payout detail...</div>;
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <div
          data-testid="payout-detail-missing"
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h1 className="text-2xl font-bold text-slate-900">Payout Detail</h1>
          <p className="mt-3 text-sm text-slate-600">{error}</p>
          <a
            href="/app/payouts/history"
            className="mt-4 inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back to Payout History
          </a>
        </div>
      </div>
    );
  }

  const tone =
    payout?.payout_status === "paid"
      ? "emerald"
      : payout?.payout_status === "failed"
      ? "rose"
      : payout?.payout_status === "ready_for_payout"
      ? "amber"
      : "slate";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 data-testid="payout-detail-title" className="text-2xl font-bold text-slate-900">
            Payout Detail
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Review payout status, payee context, transfer history, and related agreement references.
          </p>
        </div>
        <a
          href="/app/payouts/history"
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Back to Payout History
        </a>
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label="Status"
          value={String(payout?.payout_status || "").replaceAll("_", " ") || "—"}
          tone={tone}
        />
        <SummaryCard label="Amount" value={formatMoney(payout?.payout_amount)} />
        <SummaryCard label="Effective Date" value={formatDateTime(payout?.effective_at)} />
      </section>

      <section
        data-testid="payout-detail-surface"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Payee
              </div>
              <div className="mt-1 font-semibold text-slate-900">
                {payout?.subcontractor_display_name || payout?.subcontractor_email || "—"}
              </div>
              <div className="text-slate-600">{payout?.subcontractor_email || "—"}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Execution Mode
              </div>
              <div className="mt-1 text-slate-700">{payout?.execution_mode || "—"}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Transfer Id
              </div>
              <div className="mt-1 break-all text-slate-700">
                {payout?.stripe_transfer_id || "—"}
              </div>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agreement
              </div>
              <div className="mt-1 font-semibold text-slate-900">
                {payout?.agreement_title || "—"}
              </div>
              {payout?.agreement_id ? (
                <a
                  href={`/app/agreements/${payout.agreement_id}`}
                  className="mt-1 inline-flex text-blue-700 hover:underline"
                >
                  Open Agreement
                </a>
              ) : null}
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Milestone
              </div>
              <div className="mt-1 font-semibold text-slate-900">
                {payout?.milestone_title || "—"}
              </div>
              {payout?.milestone_id ? (
                <a
                  href={`/app/milestones/${payout.milestone_id}`}
                  className="mt-1 inline-flex text-blue-700 hover:underline"
                >
                  View Milestone
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Ready For Payout
            </div>
            <div className="mt-1 text-sm text-slate-700">
              {formatDateTime(payout?.ready_for_payout_at)}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Paid At
            </div>
            <div className="mt-1 text-sm text-slate-700">{formatDateTime(payout?.paid_at)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Failed At
            </div>
            <div className="mt-1 text-sm text-slate-700">{formatDateTime(payout?.failed_at)}</div>
          </div>
        </div>

        {payout?.failure_reason ? (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
              Failure Reason
            </div>
            <div data-testid="payout-detail-failure-reason" className="mt-1 text-sm text-rose-800">
              {payout.failure_reason}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
