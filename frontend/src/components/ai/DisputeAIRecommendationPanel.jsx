// /home/myhomebro/backend/frontend/src/components/ai/DisputeAIRecommendationPanel.jsx
// v2026-01-22 — AI Recommendation Panel (Stage G) + Load Latest Stored

import React, { useEffect, useMemo, useState } from "react";
import api from "../../api"; // ✅ src/api.js

export default function DisputeAIRecommendationPanel({ disputeId }) {
  const [loading, setLoading] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const hasPayload = !!result?.payload;

  const options = useMemo(() => {
    const arr = result?.payload?.options;
    return Array.isArray(arr) ? arr : [];
  }, [result]);

  const overview = result?.payload?.overview || null;
  const recommendation = result?.payload?.recommendation || null;
  const draft = result?.payload?.draft_resolution_agreement || null;

  async function loadLatest() {
    if (!disputeId) return;
    setErr("");
    setLoadingLatest(true);
    try {
      const res = await api.get(
        `/projects/disputes/${disputeId}/ai/artifacts/?artifact_type=recommendation&latest=1&include_payload=1`
      );
      const item = res?.data?.items?.[0] || null;
      if (!item) {
        setResult(null);
        setErr("No stored recommendation found yet. Click Generate to create one.");
        return;
      }

      // normalize into the same shape as POST returns so the UI renders identically
      setResult({
        artifact_type: item.artifact_type,
        cached: true,
        stored: true,
        model: item.model,
        payload: item.payload,
        version: item.version,
        created_at: item.created_at,
      });
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to load latest stored recommendation.";
      setErr(msg);
    } finally {
      setLoadingLatest(false);
    }
  }

  async function generate(force = false) {
    if (!disputeId) return;
    setErr("");
    setLoading(true);
    try {
      const res = await api.post(
        `/projects/disputes/${disputeId}/ai/recommendation/`,
        { force }
      );
      setResult(res.data);
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to generate AI recommendation.";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  // Auto-load latest on mount / dispute change
  useEffect(() => {
    if (disputeId) loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId]);

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>AI Recommended Resolution</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            Advisory only — generates settlement options + a draft written resolution.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            onClick={() => loadLatest()}
            disabled={loadingLatest}
            style={btnStyle}
            title="Load most recent saved recommendation (no AI call)"
          >
            {loadingLatest ? "Loading…" : "Load Latest"}
          </button>

          <button
            onClick={() => generate(false)}
            disabled={loading}
            style={btnStyle}
          >
            {loading ? "Generating…" : "Generate"}
          </button>

          <button
            onClick={() => generate(true)}
            disabled={loading}
            style={btnStyle}
            title="Force refresh (bypass digest match + create new version)"
          >
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 600 }}>
          {err}
          <div style={{ fontSize: 12, fontWeight: 400, marginTop: 4, opacity: 0.9 }}>
            If this says “disabled”, flip flags in settings.py and reload the web app.
          </div>
        </div>
      ) : null}

      {!hasPayload ? (
        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
          Click <b>Generate</b> to produce 3 settlement options (Quick / Balanced / Strict), a recommended path,
          and a neutral draft resolution agreement. Or click <b>Load Latest</b> to view the most recent saved result.
        </div>
      ) : null}

      {hasPayload ? (
        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          {/* Meta */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.85 }}>
            <div><b>Model:</b> {result?.model || result?.payload?._model || "—"}</div>
            <div><b>Cached:</b> {String(!!result?.cached)}</div>
            <div><b>Stored:</b> {String(!!result?.stored)}</div>
            <div><b>Version:</b> {result?.version ?? "—"}</div>
            <div><b>Created:</b> {result?.created_at ? new Date(result.created_at).toLocaleString() : "—"}</div>
          </div>

          {/* Overview */}
          {overview ? (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Overview</div>
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{overview.neutral_summary}</div>

              {!!overview.main_issues?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Main issues</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {overview.main_issues.map((x, idx) => (
                      <li key={idx} style={{ fontSize: 13, lineHeight: 1.45 }}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!!overview.missing_info?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Missing info</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {overview.missing_info.map((x, idx) => (
                      <li key={idx} style={{ fontSize: 13, lineHeight: 1.45 }}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!!overview.risk_flags?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Risk flags</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {overview.risk_flags.map((x, idx) => (
                      <li key={idx} style={{ fontSize: 13, lineHeight: 1.45 }}>{x}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Recommendation */}
          {recommendation ? (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Recommendation</div>
              <div style={{ fontSize: 13 }}>
                <div style={{ marginBottom: 6 }}><b>Recommended option:</b> {recommendation.recommended_option_id}</div>
                <div style={{ marginBottom: 6 }}>
                  <b>Confidence:</b>{" "}
                  {typeof recommendation.confidence === "number" ? recommendation.confidence.toFixed(2) : "—"}
                </div>
                <div style={{ marginBottom: 8 }}><b>Why:</b> {recommendation.why_this_option}</div>
                <div style={{ opacity: 0.9 }}>{recommendation.notes_for_parties}</div>
              </div>
            </div>
          ) : null}

          {/* Options */}
          {options.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {options.map((opt) => (
                <div key={opt.option_id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <div style={{ fontWeight: 900 }}>
                      {opt.label}{" "}
                      <span style={{ fontWeight: 600, opacity: 0.7 }}>({opt.option_id})</span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{opt.outcome}</div>
                  </div>

                  {opt.proposed_financials ? (
                    <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45 }}>
                      <div><b>Refund to homeowner:</b> ${Number(opt.proposed_financials.refund_to_homeowner || 0).toFixed(2)}</div>
                      <div><b>Payout to contractor:</b> ${Number(opt.proposed_financials.payout_to_contractor || 0).toFixed(2)}</div>
                      <div><b>Hold in escrow:</b> ${Number(opt.proposed_financials.hold_in_escrow || 0).toFixed(2)}</div>
                      <div style={{ marginTop: 6, opacity: 0.9 }}>{opt.proposed_financials.explanation}</div>
                    </div>
                  ) : null}

                  {!!opt.action_plan?.length ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Action plan</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {opt.action_plan.map((x, idx) => (
                          <li key={idx} style={{ fontSize: 13, lineHeight: 1.45 }}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {!!opt.evidence_citations?.length ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>Evidence citations</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {opt.evidence_citations.map((c, idx) => (
                          <li key={idx} style={{ fontSize: 13, lineHeight: 1.45 }}>
                            <b>{c.source}</b> — {c.id}: {c.why_it_matters}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {/* Draft resolution agreement */}
          {draft ? (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Draft Resolution Agreement</div>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>{draft.title}</div>

              {!!draft.terms?.length ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {draft.terms.map((t, idx) => (
                    <li key={idx} style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 6 }}>{t}</li>
                  ))}
                </ol>
              ) : null}

              {draft.signature_block ? (
                <pre style={preStyle}>{draft.signature_block}</pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const btnStyle = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 600,
};

const preStyle = {
  marginTop: 10,
  padding: 10,
  background: "#f9fafb",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  whiteSpace: "pre-wrap",
  fontSize: 12,
  lineHeight: 1.4,
};
