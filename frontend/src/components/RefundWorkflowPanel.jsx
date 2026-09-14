import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';

const TERMINAL = new Set(['refunded', 'denied', 'cancelled']);

function money(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function sourcePayload(option) {
  return {
    source_type: option?.source_type,
    ...(option?.invoice_id ? { invoice_id: option.invoice_id } : {}),
    ...(option?.draw_request_id
      ? { draw_request_id: option.draw_request_id }
      : {}),
    ...(option?.milestone_id ? { milestone_id: option.milestone_id } : {}),
    ...(option?.external_payment_id
      ? { external_payment_id: option.external_payment_id }
      : {}),
  };
}

export default function RefundWorkflowPanel({ agreementId }) {
  const [data, setData] = useState({ source_options: [], refund_requests: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [form, setForm] = useState({
    amount: '',
    reason: '',
    evidence_note: '',
    confirm: '',
  });
  const [response, setResponse] = useState({});

  const load = useCallback(async () => {
    if (!agreementId) return;
    setLoading(true);
    try {
      const result = await api.get(
        `/projects/agreements/${agreementId}/refund-requests/`
      );
      const next = result?.data || { source_options: [], refund_requests: [] };
      setData(next);
      const query = new URLSearchParams(window.location.search);
      const milestoneId = query.get('refund_milestone');
      const requestedKey = milestoneId ? `escrow:milestone:${milestoneId}` : '';
      setSelectedKey((current) =>
        next.source_options?.some((item) => item.key === requestedKey)
          ? requestedKey
          : current || next.source_options?.[0]?.key || ''
      );
      const requestId = query.get('refund_request');
      if (requestId) {
        window.setTimeout(
          () =>
            document
              .getElementById(`refund-request-${requestId}`)
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
          0
        );
      }
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || 'Could not load refund options.'
      );
    } finally {
      setLoading(false);
    }
  }, [agreementId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => data.source_options?.find((item) => item.key === selectedKey) || null,
    [data.source_options, selectedKey]
  );

  const issueRefund = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      await api.post(`/projects/agreements/${agreementId}/refund-requests/`, {
        ...sourcePayload(selected),
        requested_amount: form.amount,
        reason: form.reason,
        evidence_note: form.evidence_note,
        execute_now: true,
        confirm: form.confirm,
      });
      toast.success(
        selected.record_only
          ? 'External refund recorded'
          : 'Refund submitted successfully'
      );
      setForm({ amount: '', reason: '', evidence_note: '', confirm: '' });
      await load();
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || 'The refund could not be completed.'
      );
    } finally {
      setBusy(false);
    }
  };

  const respond = async (request, action) => {
    const state = response[request.id] || {};
    setBusy(true);
    try {
      await api.post(`/projects/refund-requests/${request.id}/respond/`, {
        action,
        approved_amount:
          state.amount ||
          request.requested_amount ||
          request.maximum_refundable_amount,
        note: state.note || '',
        confirm: ['approve', 'retry'].includes(action) ? state.confirm : '',
      });
      toast.success(
        action === 'approve'
          ? 'Refund completed'
          : action === 'retry'
            ? 'Refund retried'
            : 'Refund request updated'
      );
      await load();
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || 'Could not update the refund request.'
      );
    } finally {
      setBusy(false);
    }
  };

  const setResponseField = (id, field, value) =>
    setResponse((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), [field]: value },
    }));

  return (
    <section
      data-testid="agreement-refund-workflow"
      className="rounded-2xl border border-amber-200/25 bg-[#071b3c] p-5 text-sky-100 shadow-sm"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/75">
            Refunds
          </div>
          <h3 className="mt-1 text-lg font-semibold text-white">
            Request or issue a refund
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-sky-100/70">
            Choose the exact payment being returned. Escrow, Direct Pay
            invoices, and paid draws are processed back through their recorded
            source. External payments are recorded here for audit purposes only.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-sky-100/60">
          Loading refundable payments…
        </p>
      ) : null}

      {!loading && data.source_options?.length ? (
        <form
          onSubmit={issueRefund}
          className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 lg:grid-cols-2"
        >
          <label className="text-sm font-semibold text-sky-50 lg:col-span-2">
            Payment source
            <select
              value={selectedKey}
              onChange={(event) => setSelectedKey(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/15 bg-[#04152f] px-3 py-2.5 text-white"
            >
              {data.source_options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-xl border border-white/10 bg-black/15 p-3 text-sm">
            <span className="text-sky-100/60">Available to refund</span>
            <div className="mt-1 text-xl font-bold text-white">
              {money(selected?.maximum_refundable_amount)}
            </div>
            <div className="mt-1 text-xs text-sky-100/60">
              {selected?.record_only
                ? 'Record only — no money moves through MyHomeBro.'
                : `${selected?.payment_mode === 'direct' ? 'Direct Pay' : 'Escrow'} refund to the original payment method.`}
            </div>
          </div>
          <label className="text-sm font-semibold text-sky-50">
            Refund amount
            <input
              required
              inputMode="decimal"
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
              placeholder={selected?.maximum_refundable_amount || '0.00'}
              className="mt-2 w-full rounded-xl border border-white/15 bg-[#04152f] px-3 py-2.5 text-white"
            />
          </label>
          <label className="text-sm font-semibold text-sky-50 lg:col-span-2">
            Reason
            <textarea
              required
              rows={3}
              value={form.reason}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              className="mt-2 w-full rounded-xl border border-white/15 bg-[#04152f] px-3 py-2.5 text-white"
              placeholder="Explain what is being returned and why."
            />
          </label>
          <label className="text-sm font-semibold text-sky-50">
            Supporting note, optional
            <input
              value={form.evidence_note}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  evidence_note: event.target.value,
                }))
              }
              className="mt-2 w-full rounded-xl border border-white/15 bg-[#04152f] px-3 py-2.5 text-white"
              placeholder="Receipt, written agreement, or reference"
            />
          </label>
          <label className="text-sm font-semibold text-sky-50">
            Type REFUND to authorize
            <input
              required
              value={form.confirm}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  confirm: event.target.value,
                }))
              }
              className="mt-2 w-full rounded-xl border border-amber-200/30 bg-[#04152f] px-3 py-2.5 text-white"
            />
          </label>
          <div className="lg:col-span-2 flex justify-end">
            <button
              disabled={busy || form.confirm.trim().toUpperCase() !== 'REFUND'}
              className="rounded-xl bg-amber-300 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy
                ? 'Processing…'
                : selected?.record_only
                  ? 'Record Refunded Payment'
                  : 'Issue Refund'}
            </button>
          </div>
        </form>
      ) : !loading ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/15 p-4 text-sm text-sky-100/65">
          No refundable payment source is currently available.
        </div>
      ) : null}

      {data.refund_requests?.length ? (
        <div className="mt-5 space-y-3">
          <h4 className="text-sm font-semibold text-white">
            Refund history and open requests
          </h4>
          {data.refund_requests.map((request) => {
            const needsResponse = [
              'refund_requested',
              'contractor_response_needed',
              'under_review',
              'failed',
            ].includes(request.status);
            const state = response[request.id] || {};
            return (
              <article
                key={request.id}
                id={`refund-request-${request.id}`}
                className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <span className="font-semibold text-white">
                      Request #{request.id}
                    </span>{' '}
                    · {request.source_type_label} · {request.payment_mode_label}
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${request.status === 'refunded' ? 'bg-emerald-300/20 text-emerald-100' : TERMINAL.has(request.status) ? 'bg-white/10 text-sky-100/70' : 'bg-amber-300/20 text-amber-100'}`}
                  >
                    {request.status_label}
                  </span>
                </div>
                <p className="mt-2 text-sky-100/80">{request.reason}</p>
                <div className="mt-2 text-xs text-sky-100/60">
                  Requested:{' '}
                  {request.requested_amount
                    ? money(request.requested_amount)
                    : 'amount not specified'}
                  {request.approved_amount
                    ? ` · Approved/proposed: ${money(request.approved_amount)}`
                    : ''}
                </div>
                {request.response_note ? (
                  <div className="mt-2 rounded-lg bg-black/20 p-2 text-sky-100/75">
                    Response: {request.response_note}
                  </div>
                ) : null}
                {request.failure_reason ? (
                  <div className="mt-2 rounded-lg bg-rose-400/10 p-2 text-rose-100">
                    Processing issue: {request.failure_reason}
                  </div>
                ) : null}
                {needsResponse ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <input
                      inputMode="decimal"
                      value={state.amount ?? request.requested_amount ?? ''}
                      onChange={(event) =>
                        setResponseField(
                          request.id,
                          'amount',
                          event.target.value
                        )
                      }
                      placeholder="Refund amount"
                      className="rounded-lg border border-white/15 bg-[#04152f] px-3 py-2 text-white"
                    />
                    <input
                      value={state.note || ''}
                      onChange={(event) =>
                        setResponseField(request.id, 'note', event.target.value)
                      }
                      placeholder="Response or explanation"
                      className="rounded-lg border border-white/15 bg-[#04152f] px-3 py-2 text-white"
                    />
                    <input
                      value={state.confirm || ''}
                      onChange={(event) =>
                        setResponseField(
                          request.id,
                          'confirm',
                          event.target.value
                        )
                      }
                      placeholder="Type REFUND to approve"
                      className="rounded-lg border border-white/15 bg-[#04152f] px-3 py-2 text-white"
                    />
                    <div className="flex flex-wrap gap-2 md:col-span-3">
                      <button
                        type="button"
                        disabled={
                          busy ||
                          state.confirm?.trim().toUpperCase() !== 'REFUND'
                        }
                        onClick={() =>
                          respond(
                            request,
                            request.status === 'failed' ? 'retry' : 'approve'
                          )
                        }
                        className="rounded-lg bg-emerald-500 px-3 py-2 font-semibold text-white disabled:opacity-40"
                      >
                        {request.status === 'failed'
                          ? 'Retry Refund'
                          : 'Approve & Refund'}
                      </button>
                      {request.status !== 'failed' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => respond(request, 'counter')}
                          className="rounded-lg border border-amber-200/30 px-3 py-2 font-semibold text-amber-100"
                        >
                          Propose Different Amount
                        </button>
                      ) : null}
                      {request.status !== 'failed' ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => respond(request, 'deny')}
                          className="rounded-lg border border-rose-200/30 px-3 py-2 font-semibold text-rose-100"
                        >
                          Deny with Reason
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
