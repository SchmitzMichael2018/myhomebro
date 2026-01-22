// src/components/ai/DisputeAIAdvisor.jsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import toast from "react-hot-toast";

/**
 * DisputeAIAdvisor (Phase 2 — Evidence Snapshot + AI Summary)
 *
 * ✅ Read-only
 * ✅ Evidence-based (uses /evidence-context endpoint)
 * ✅ AI summary (calls /ai-summary endpoint; gated by backend settings flags)
 * ✅ No dispute mutations
 * ✅ No money actions
 */

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? null;

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
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

function SectionTitle({ children }) {
  return (
    <div className="text-xs font-extrabold uppercase tracking-wide text-indigo-700">
      {children}
    </div>
  );
}

function JsonFallback({ value }) {
  return (
    <pre className="mt-2 rounded-lg border border-black/10 bg-white/80 p-3 text-xs overflow-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function DisputeAIAdvisor({ disputeId, enabled }) {
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [context, setContext] = useState(null);
  const [ctxError, setCtxError] = useState("");

  const [running, setRunning] = useState(false);
  const [aiResp, setAiResp] = useState(null);
  const [aiError, setAiError] = useState("");

  const agreement = context?.agreement || null;
  const dispute = context?.dispute || null;
  const milestones = Array.isArray(context?.milestones) ? context.milestones : [];
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
      setLoadingCtx(true);
      setCtxError("");
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
        setCtxError(msg);
        toast.error("AI Advisor: failed to load evidence context.");
      } finally {
        setLoadingCtx(false);
      }
    };

    load();
  }, [enabled, disputeId]);

  const runSummary = async () => {
    if (!disputeId) return;
    setRunning(true);
    setAiError("");
    try {
      const { data } = await api.post(`/projects/disputes/${disputeId}/ai-summary/`, {});
      setAiResp(data);
      if (data?.ok) toast.success("AI summary generated.");
      else toast.error("AI summary returned an error (see panel).");
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.detail || e?.response?.data?.error || "AI summary failed.";
      setAiError(msg);
      toast.error(msg);
    } finally {
      setRunning(false);
    }
  };

  if (!enabled) return null;

  const aiOk = aiResp?.ok === true;
  const result = aiOk ? aiResp?.result : null;

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="text-sm font-extrabold text-indigo-900">🤖 AI Advisor</div>
          <Badge tone="indigo" title="This panel is read-only and advisory.">
            Evidence + Summary
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info" title="No actions are taken automatically.">Read-only</Badge>
          <Badge tone="default" title="Evidence snapshot generation time">
            {context?.meta?.generated_at ? fmtDateTime(context.meta.generated_at) : "—"}
          </Badge>
        </div>
      </div>

      <div className="text-xs text-indigo-800">
        Evidence-based summaries only. No blame. No money actions. Any recommendation is advisory.
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={runSummary}
          disabled={running}
          className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-extrabold text-white hover:bg-indigo-800 disabled:opacity-60"
          title="Generate an evidence-based neutral summary"
        >
          {running ? "Generating…" : "Generate AI Summary"}
        </button>

        {aiResp?.model ? (
          <Badge tone="default" title="Model used">
            {aiResp.model}
          </Badge>
        ) : null}
      </div>

      {/* Evidence Context */}
      {loadingCtx ? (
        <div className="rounded-xl border border-indigo-200 bg-white/70 p-3 text-sm text-indigo-800">
          Loading evidence context…
        </div>
      ) : ctxError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 font-bold">
          {ctxError}
        </div>
      ) : !context ? (
        <div className="rounded-xl border border-indigo-200 bg-white/70 p-3 text-sm text-indigo-800">
          No evidence context loaded.
        </div>
      ) : (
        <div className="rounded-xl border border-indigo-200 bg-white/70 p-3 space-y-2">
          <SectionTitle>Snapshot</SectionTitle>

          <div className="text-sm font-extrabold text-slate-900">
            {agreement?.title || "Agreement"}{" "}
            {agreement?.agreement_number ? `(#${agreement.agreement_number})` : agreement?.id ? `(ID ${agreement.id})` : ""}
          </div>

          <div className="text-sm text-slate-800">
            <b>Dispute status:</b> {dispute?.status || "—"}{" "}
            {dispute?.escrow_frozen ? " • 🧊 escrow frozen" : ""}
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge tone="default">Milestones {counts.total}</Badge>
            <Badge tone="good">Completed {counts.completed}</Badge>
            {counts.rework ? <Badge tone="info">Rework {counts.rework}</Badge> : null}
            <Badge tone="default">Evidence {evidence.length}</Badge>
          </div>
        </div>
      )}

      {/* AI Summary Output */}
      {aiError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 font-bold">
          {aiError}
        </div>
      ) : null}

      {aiResp && !aiOk ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-extrabold">AI summary not available</div>
          <div className="mt-1 text-xs">
            {aiResp?.error || "Unknown error"} {aiResp?.detail ? `— ${aiResp.detail}` : ""}
          </div>
          {aiResp?.raw ? (
            <pre className="mt-2 rounded-lg border border-black/10 bg-white/80 p-3 text-xs overflow-auto">
              {String(aiResp.raw)}
            </pre>
          ) : null}
        </div>
      ) : null}

      {aiOk && result ? (
        <div className="rounded-xl border border-indigo-200 bg-white/70 p-3 space-y-3">
          <SectionTitle>AI Summary</SectionTitle>

          {/* Summary bullets */}
          {typeof result.summary === "string" ? (
            <div className="whitespace-pre-wrap text-sm text-slate-900">{result.summary}</div>
          ) : (
            <JsonFallback value={result.summary} />
          )}

          {/* Timeline */}
          {Array.isArray(result.timeline) && result.timeline.length ? (
            <div>
              <SectionTitle>Timeline</SectionTitle>
              <div className="mt-2 space-y-2">
                {result.timeline.map((t, idx) => (
                  <div key={idx} className="rounded-lg border border-black/10 bg-white/80 p-3">
                    <div className="text-sm font-extrabold text-slate-900">
                      {t.when ? String(t.when) : "—"}
                    </div>
                    <div className="mt-1 text-sm text-slate-800">{t.event}</div>
                    {Array.isArray(t.citations) && t.citations.length ? (
                      <div className="mt-2 text-xs text-slate-600">
                        Citations: <b>{t.citations.join(", ")}</b>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Issues */}
          {Array.isArray(result.issues) && result.issues.length ? (
            <div>
              <SectionTitle>Issues Detected</SectionTitle>
              <div className="mt-2 space-y-2">
                {result.issues.map((it, idx) => (
                  <div key={idx} className="rounded-lg border border-black/10 bg-white/80 p-3">
                    <div className="text-sm font-extrabold text-slate-900">{it.label}</div>
                    <div className="mt-1 text-sm text-slate-800">{it.why_it_matters}</div>
                    {Array.isArray(it.citations) && it.citations.length ? (
                      <div className="mt-2 text-xs text-slate-600">
                        Citations: <b>{it.citations.join(", ")}</b>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Missing evidence */}
          {Array.isArray(result.missing_evidence) && result.missing_evidence.length ? (
            <div>
              <SectionTitle>Missing Evidence</SectionTitle>
              <ul className="mt-2 list-disc pl-5 text-sm text-slate-800 space-y-1">
                {result.missing_evidence.map((m, idx) => (
                  <li key={idx}>
                    <b>{m.item}</b> — {m.why_needed}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Neutral options */}
          {Array.isArray(result.neutral_options) && result.neutral_options.length ? (
            <div>
              <SectionTitle>Neutral Resolution Options</SectionTitle>
              <div className="mt-2 space-y-2">
                {result.neutral_options.map((o, idx) => (
                  <div key={idx} className="rounded-lg border border-black/10 bg-white/80 p-3">
                    <div className="text-sm font-extrabold text-slate-900">{o.title}</div>
                    <div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{o.description}</div>
                    {Array.isArray(o.prerequisites) && o.prerequisites.length ? (
                      <div className="mt-2 text-xs text-slate-700">
                        <b>Prerequisites:</b> {o.prerequisites.join("; ")}
                      </div>
                    ) : null}
                    {Array.isArray(o.citations) && o.citations.length ? (
                      <div className="mt-2 text-xs text-slate-600">
                        Citations: <b>{o.citations.join(", ")}</b>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {typeof result.notes === "string" ? (
            <div className="text-xs text-slate-600 whitespace-pre-wrap">
              <b>Notes:</b> {result.notes}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
