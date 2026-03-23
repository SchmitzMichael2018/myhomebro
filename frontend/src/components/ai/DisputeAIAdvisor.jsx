// src/components/ai/DisputeAIAdvisor.jsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import toast from "react-hot-toast";

/**
 * DisputeAIAdvisor (Phase 2 — Evidence Summary only)
 *
 * ✅ Read-only
 * ✅ Evidence-based (uses /evidence-context endpoint)
 * ✅ No dispute mutations
 * ✅ No money actions
 *
 * Later phases will add:
 * - AI-generated summary + issue list + missing evidence checklist
 * - AI recommended neutral options (still advisory-only)
 */

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? null;

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function fmtMoney(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function Badge({ tone = "default", children, title = "" }) {
  const t = {
    default: ["bg-slate-200", "text-slate-800"],
    warn: ["bg-amber-100", "text-amber-800"],
    good: ["bg-emerald-100", "text-emerald-800"],
    info: ["bg-blue-100", "text-blue-800"],
    danger: ["bg-rose-100", "text-rose-800"],
    indigo: ["bg-indigo-100", "text-indigo-800"],
  }[tone];

  return (
    <span
      title={title}
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-extrabold ${t[0]} ${t[1]}`}
    >
      {children}
    </span>
  );
}

function SmallRow({ label, value }) {
  return (
    <div className="grid grid-cols-12 gap-2 text-sm">
      <div className="col-span-4 text-slate-600 font-bold">{label}</div>
      <div className="col-span-8 text-slate-900">{value}</div>
    </div>
  );
}

export default function DisputeAIAdvisor({ disputeId, enabled }) {
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState(null);
  const [error, setError] = useState("");

  const agreement = context?.agreement || null;
  const dispute = context?.dispute || null;
  const milestones = Array.isArray(context?.milestones) ? context.milestones : [];
  const invoices = Array.isArray(context?.invoices) ? context.invoices : [];
  const evidence = Array.isArray(context?.evidence) ? context.evidence : [];

  const counts = useMemo(() => {
    const total = milestones.length;
    const rework = milestones.filter((m) => m?.is_rework).length;
    const completed = milestones.filter((m) => m?.completed === true).length;
    return { total, rework, completed };
  }, [milestones]);

  useEffect(() => {
    if (!enabled || !disputeId) return;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`/projects/disputes/${disputeId}/evidence-context/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        setContext(data);
      } catch (e) {
        console.error(e);
        const msg =
          e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Unable to load evidence context.";
        setError(msg);
        toast.error("AI Advisor: failed to load evidence context.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [enabled, disputeId]);

  if (!enabled) return null;

  return (
    <div
      data-testid="dispute-ai-advisor"
      className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-extrabold text-indigo-900">🤖 AI Advisor</div>
          <Badge tone="indigo" title="This panel is read-only and advisory.">
            Evidence Snapshot
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info" title="No actions are taken automatically.">Read-only</Badge>
          <Badge tone="default" title="Generated from dispute records and uploaded evidence.">
            {context?.meta?.generated_at ? fmtDateTime(context.meta.generated_at) : "—"}
          </Badge>
        </div>
      </div>

      <div className="text-xs text-indigo-800">
        This panel displays a deterministic evidence snapshot used for future AI summaries and neutral recommendations.
        It does not move funds or change dispute status.
      </div>

      {loading ? (
        <div className="rounded-xl border border-indigo-200 bg-white/70 p-3 text-sm text-indigo-800">
          Loading evidence context…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 font-bold">
          {error}
        </div>
      ) : !context ? (
        <div className="rounded-xl border border-indigo-200 bg-white/70 p-3 text-sm text-indigo-800">
          No evidence context loaded.
        </div>
      ) : (
        <>
          {/* Agreement */}
          <div className="rounded-xl border border-indigo-200 bg-white/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
                Agreement
              </div>
              <div className="flex items-center gap-2">
                {agreement?.agreement_number ? (
                  <Badge tone="default">#{agreement.agreement_number}</Badge>
                ) : agreement?.id ? (
                  <Badge tone="default">ID {agreement.id}</Badge>
                ) : null}
                {agreement?.total_amount != null ? (
                  <Badge tone="good" title="Agreement total (best-effort field)">
                    {fmtMoney(agreement.total_amount)}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="mt-2 text-sm font-extrabold text-slate-900">
              {agreement?.title || "—"}
            </div>

            <div className="mt-2 space-y-1">
              <SmallRow label="Homeowner" value={pick(agreement?.homeowner_name, agreement?.homeowner_email, "—")} />
              <SmallRow label="Contractor" value={pick(agreement?.contractor_name, agreement?.contractor_email, "—")} />
              <SmallRow label="Created" value={fmtDateTime(agreement?.created_at)} />
            </div>
          </div>

          {/* Dispute */}
          <div className="rounded-xl border border-indigo-200 bg-white/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
                Dispute
              </div>
              <div className="flex items-center gap-2">
                {dispute?.status ? <Badge tone="warn">{String(dispute.status).replaceAll("_", " ")}</Badge> : null}
                {dispute?.escrow_frozen ? <Badge tone="info">🧊 Escrow Frozen</Badge> : <Badge tone="default">Escrow Not Frozen</Badge>}
                {dispute?.fee_paid ? <Badge tone="good">Fee Paid</Badge> : <Badge tone="warn">Fee Unpaid</Badge>}
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <SmallRow label="Category" value={pick(dispute?.category, "—")} />
              <SmallRow label="Initiator" value={pick(dispute?.initiator, "—")} />
              <SmallRow label="Created" value={fmtDateTime(dispute?.created_at)} />
              <SmallRow label="Last activity" value={fmtDateTime(dispute?.last_activity_at)} />
            </div>

            {dispute?.complaint ? (
              <div className="mt-3">
                <div className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Complaint</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-slate-900">
                  {String(dispute.complaint).trim()}
                </div>
              </div>
            ) : null}
          </div>

          {/* Milestones */}
          <div className="rounded-xl border border-indigo-200 bg-white/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
                Milestones
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="default">Total {counts.total}</Badge>
                <Badge tone="good">Completed {counts.completed}</Badge>
                {counts.rework ? <Badge tone="info">Rework {counts.rework}</Badge> : null}
              </div>
            </div>

            {milestones.length === 0 ? (
              <div className="mt-2 text-sm text-slate-600">—</div>
            ) : (
              <div className="mt-2 grid gap-2">
                {milestones.slice(0, 8).map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-black/10 bg-white/80 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-extrabold text-slate-900">
                        #{m.id} — {m.title || "Milestone"}
                      </div>
                      <div className="flex items-center gap-2">
                        {m.is_rework ? <Badge tone="info">Rework</Badge> : null}
                        {m.completed === true ? <Badge tone="good">Completed</Badge> : <Badge tone="warn">Incomplete</Badge>}
                        {m.amount != null ? <Badge tone="default">{fmtMoney(m.amount)}</Badge> : null}
                      </div>
                    </div>
                    {m.description ? (
                      <div className="mt-1 text-xs text-slate-700 whitespace-pre-wrap">
                        {String(m.description).trim()}
                      </div>
                    ) : null}
                  </div>
                ))}
                {milestones.length > 8 ? (
                  <div className="text-xs text-slate-600">
                    Showing 8 of {milestones.length} milestones…
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Invoices */}
          <div className="rounded-xl border border-indigo-200 bg-white/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
                Invoices (best-effort)
              </div>
              <Badge tone="default">{invoices.length}</Badge>
            </div>

            {invoices.length === 0 ? (
              <div className="mt-2 text-sm text-slate-600">
                No invoices linked in evidence context (this is OK for v1).
              </div>
            ) : (
              <div className="mt-2 grid gap-2">
                {invoices.map((inv) => (
                  <div
                    key={inv.id || Math.random()}
                    className="rounded-lg border border-black/10 bg-white/80 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-extrabold text-slate-900">
                        Invoice #{inv.invoice_number || inv.id || "—"}
                      </div>
                      <div className="flex items-center gap-2">
                        {inv.display_status ? (
                          <Badge tone="info">{String(inv.display_status).replaceAll("_", " ")}</Badge>
                        ) : inv.status ? (
                          <Badge tone="default">{String(inv.status).replaceAll("_", " ")}</Badge>
                        ) : null}
                        {inv.amount != null ? <Badge tone="default">{fmtMoney(inv.amount)}</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Created: {fmtDateTime(inv.created_at)}
                      {inv.paid_at ? ` • Paid: ${fmtDateTime(inv.paid_at)}` : ""}
                      {inv.approved_at ? ` • Approved: ${fmtDateTime(inv.approved_at)}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Evidence */}
          <div className="rounded-xl border border-indigo-200 bg-white/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
                Evidence
              </div>
              <Badge tone="default">{evidence.length}</Badge>
            </div>

            {evidence.length === 0 ? (
              <div className="mt-2 text-sm text-slate-600">
                No evidence uploaded yet. (AI will likely return “insufficient evidence”.)
              </div>
            ) : (
              <div className="mt-2 grid md:grid-cols-2 gap-2">
                {evidence.map((e) => (
                  <div
                    key={e.id || `${e.kind}-${e.file}`}
                    className="rounded-lg border border-black/10 bg-white/80 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-extrabold text-slate-900">
                          {e.kind || "file"}
                        </div>
                        <div className="truncate text-xs text-slate-700">
                          {e.file || "—"}
                        </div>
                      </div>
                      {e.uploaded_at ? (
                        <Badge tone="default" title="Uploaded at">
                          {fmtDateTime(e.uploaded_at)}
                        </Badge>
                      ) : null}
                    </div>
                    {e.uploaded_by ? (
                      <div className="mt-1 text-xs text-slate-600">
                        Uploaded by: <b>{e.uploaded_by}</b>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-indigo-800">
            Next step: we’ll add AI-generated neutral summaries and resolution options using this evidence snapshot,
            without changing dispute status or moving funds.
          </div>
        </>
      )}
    </div>
  );
}
