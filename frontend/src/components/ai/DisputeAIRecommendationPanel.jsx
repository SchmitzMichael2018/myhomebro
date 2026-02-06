// frontend/src/components/ai/DisputeAIRecommendationPanel.jsx
// v2026-01-22 — Step B: Stripe Checkout unlock for AI recommendation

import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";

function getQueryParam(name) {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get(name);
  } catch {
    return null;
  }
}

export default function DisputeAIRecommendationPanel({ disputeId }) {
  const [loading, setLoading] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [loadingPay, setLoadingPay] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const [payInfo, setPayInfo] = useState(null); // { suggested_price_cents, ... }

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
        return;
      }
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
      // don't hard error on loadLatest
    } finally {
      setLoadingLatest(false);
    }
  }

  async function generate(force = false) {
    if (!disputeId) return;
    setErr("");
    setPayInfo(null);
    setLoading(true);
    try {
      const res = await api.post(`/projects/disputes/${disputeId}/ai/recommendation/`, { force });
      setResult(res.data);
    } catch (e) {
      const status = e?.response?.status;
      const data = e?.response?.data;

      if (status === 402 && data?.code === "ai_quota_exceeded") {
        setPayInfo(data);
        setErr(data?.detail || "Payment required to generate.");
      } else {
        const msg =
          data?.detail ||
          data?.error ||
          e?.message ||
          "Failed to generate AI recommendation.";
        setErr(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function startCheckout() {
    if (!disputeId) return;
    setLoadingPay(true);
    setErr("");
    try {
      const res = await api.post(`/projects/ai/checkout/recommendation/`, { dispute_id: disputeId });
      if (res.data?.already_paid) {
        // If already paid for this digest, just generate again (force=false is fine; digest-matched may exist)
        await generate(true);
        return;
      }
      const url = res.data?.checkout_url;
      if (!url) throw new Error("No checkout_url returned.");
      window.location.assign(url);
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to start checkout.";
      setErr(msg);
    } finally {
      setLoadingPay(false);
    }
  }

  async function verifyCheckoutAndGenerate() {
    const sessionId = getQueryParam("session_id");
    const aiCheckout = getQueryParam("ai_checkout");
    if (!sessionId || aiCheckout !== "success") return;

    setErr("");
    setLoading(true);
    try {
      const res = await api.get(`/projects/ai/checkout/status/?session_id=${encodeURIComponent(sessionId)}`);
      if (res.data?.paid) {
        // Paid — generate a fresh recommendation now (force true => new version)
        await generate(true);
      } else {
        setErr("Payment not completed yet. If you just paid, refresh once.");
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.message ||
        "Failed to verify checkout status.";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (disputeId) loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId]);

  useEffect(() => {
    verifyCheckoutAndGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payDollars = payInfo?.suggested_price_cents ? (payInfo.suggested_price_cents / 100).toFixed(2) : "29.00";

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
          <button onClick={loadLatest} disabled={loadingLatest} style={btnStyle}>
            {loadingLatest ? "Loading…" : "Load Latest"}
          </button>
          <button onClick={() => generate(false)} disabled={loading} style={btnStyle}>
            {loading ? "Generating…" : "Generate"}
          </button>
          <button onClick={() => generate(true)} disabled={loading} style={btnStyle} title="Force new version">
            Refresh
          </button>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>
          {err}

          {payInfo ? (
            <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={startCheckout} disabled={loadingPay} style={btnStyle}>
                {loadingPay ? "Opening Checkout…" : `Pay $${payDollars} to Generate`}
              </button>
              <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>
                (Or upgrade to Pro later for unlimited AI)
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasPayload ? (
        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
          Click <b>Generate</b> to produce 3 settlement options (Quick / Balanced / Strict), a recommended path,
          and a neutral draft resolution agreement.
        </div>
      ) : null}

      {hasPayload ? (
        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.85 }}>
            <div><b>Model:</b> {result?.model || result?.payload?._model || "—"}</div>
            <div><b>Cached:</b> {String(!!result?.cached)}</div>
            <div><b>Stored:</b> {String(!!result?.stored)}</div>
            <div><b>Version:</b> {result?.version ?? "—"}</div>
            <div><b>Created:</b> {result?.created_at ? new Date(result.created_at).toLocaleString() : "—"}</div>
          </div>

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
            </div>
          ) : null}

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
                </div>
              ))}
            </div>
          ) : null}

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
              {draft.signature_block ? <pre style={preStyle}>{draft.signature_block}</pre> : null}
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
