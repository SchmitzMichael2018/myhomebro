import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";
import { buildAiContext, serializeAiContext } from "../../lib/aiContext.js";
import { parseDisputeRecommendationResponse } from "../../lib/aiResponseParser.js";
import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantConfidenceBadge,
  ProjectAssistantPanel,
  ProjectAssistantSection,
} from "../ProjectAssistantExperience.jsx";

const FORBIDDEN_LEGAL_LANGUAGE = [
  "liable",
  "negligent",
  "breached",
  "entitled",
  "violation",
  "guilty",
  "at fault",
  "you should",
];

function list(value) {
  return Array.isArray(value)
    ? value.filter((item) => item !== null && item !== undefined && String(item).trim() !== "")
    : [];
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function hasForbiddenLanguage(value) {
  const text = textOf(value).toLowerCase();
  return FORBIDDEN_LEGAL_LANGUAGE.some((word) => text.includes(word));
}

function confidenceLabel(value) {
  return <ProjectAssistantConfidenceBadge value={value} explanation="Resolution confidence depends on evidence completeness and consistency." />;
}

function Section({ title, children, testId }) {
  return (
    <ProjectAssistantSection title={title} testId={testId}>{children}</ProjectAssistantSection>
  );
}

function BulletList({ items, empty = "None identified." }) {
  const rows = list(items);
  if (!rows.length) return <div style={{ fontSize: 13, color: "#64748b" }}>{empty}</div>;
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {rows.map((item, idx) => (
        <li key={idx} style={{ fontSize: 13, lineHeight: 1.45 }}>{String(item)}</li>
      ))}
    </ul>
  );
}

export default function DisputeAIRecommendationPanel({ disputeId }) {
  const [loading, setLoading] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const hasPayload = !!result?.payload;
  const parsed = useMemo(() => parseDisputeRecommendationResponse(result || {}), [result]);
  const coursesOfAction = useMemo(() => {
    const arr = result?.payload?.courses_of_action || result?.payload?.options || parsed.options;
    return Array.isArray(arr) ? arr : [];
  }, [parsed.options, result]);

  const overview = result?.payload?.overview || null;
  const recommendation = result?.payload?.recommendation || null;
  const draft = result?.payload?.draft_resolution_agreement || null;
  const unsafeLanguageDetected = hasPayload && hasForbiddenLanguage(result?.payload);

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
    } catch {
      // non-fatal
    } finally {
      setLoadingLatest(false);
    }
  }

  async function generate(force = false) {
    if (!disputeId) return;
    setErr("");
    setLoading(true);
    try {
      const res = await api.post(`/projects/disputes/${disputeId}/ai/recommendation/`, {
        force,
        context: serializeAiContext(buildAiContext({
          page: "disputes",
          entityId: disputeId || null,
          entityType: "dispute",
        })),
      });
      const parsedResponse = parseDisputeRecommendationResponse(res.data?.payload || res.data);
      if (!parsedResponse.overview && !parsedResponse.recommendation) {
        setErr("Resolution Assistant returned an unexpected response. Please try again.");
        return;
      }
      setResult(res.data);
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to generate Resolution Assistant recommendation.";
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (disputeId) loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disputeId]);

  return (
    <ProjectAssistantPanel
      subtitle="Resolution Assistant"
      summary="Based on the available evidence, this creates review guidance only. Humans decide every outcome."
      testId="dispute-ai-recommendation-panel"
      className="mt-4"
      actions={
        <>
          <button onClick={loadLatest} disabled={loadingLatest} style={btnStyle}>
            {loadingLatest ? "Loading..." : "Load Latest"}
          </button>
          <button onClick={() => generate(false)} disabled={loading} style={btnStyle}>
            {loading ? "Generating..." : "Generate recommendation"}
          </button>
          <button onClick={() => generate(true)} disabled={loading} style={btnStyle} title="Force new version">
            Generate new version
          </button>
        </>
      }
    >

      {err ? <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>{err}</div> : null}

      {!hasPayload ? (
        <div style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}>
          Click <b>Generate</b> to organize evidence, identify missing information, compare three
          courses of action, and show one recommendation for human review.
        </div>
      ) : null}

      {hasPayload ? (
        <div style={{ display: "grid", gap: 14 }}>
          <ProjectAssistantApprovalNotice>
            Recommendation only. This does not resolve the dispute, release payment, refund money,
            assign blame, or make a legal conclusion. A human must accept, reject, counter, or escalate.
          </ProjectAssistantApprovalNotice>

          {unsafeLanguageDetected ? (
            <div
              data-testid="dispute-ai-language-warning"
              style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 12, padding: 12, fontSize: 13, color: "#991b1b", fontWeight: 700 }}
            >
              Review language before sharing. The assistant response may contain wording that should be softened.
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, opacity: 0.85 }}>
            <div><b>Model:</b> {result?.model || result?.payload?._model || "-"}</div>
            <div><b>Cached:</b> {String(!!result?.cached)}</div>
            <div><b>Stored:</b> {String(!!result?.stored)}</div>
            <div><b>Version:</b> {result?.version ?? "-"}</div>
            <div><b>Created:</b> {result?.created_at ? new Date(result.created_at).toLocaleString() : "-"}</div>
          </div>

          {overview ? (
            <Section title="Neutral Case Summary" testId="dispute-ai-neutral-summary">
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{overview.neutral_summary}</div>

              {!!overview.timeline?.length ? (
                <div style={{ marginTop: 12 }} data-testid="dispute-ai-timeline">
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Timeline</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {overview.timeline.map((row, idx) => (
                      <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, fontSize: 13 }}>
                        <b>{row.date || "Date not provided"}</b> - {row.event || "Event not provided"}
                        {row.source ? <div style={{ color: "#64748b", fontSize: 12 }}>Source: {row.source}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!!overview.main_issues?.length ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Main issues</div>
                  <BulletList items={overview.main_issues} />
                </div>
              ) : null}

              <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <div data-testid="dispute-ai-disputed-facts">
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Disputed facts</div>
                  <BulletList items={overview.disputed_facts} />
                </div>
                <div data-testid="dispute-ai-undisputed-facts">
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Undisputed facts</div>
                  <BulletList items={overview.undisputed_facts} />
                </div>
              </div>
            </Section>
          ) : null}

          <Section title="Evidence Used" testId="dispute-ai-evidence-table">
            {list(overview?.evidence_used).length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {overview.evidence_used.map((row, idx) => (
                  <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 10, fontSize: 13 }}>
                    <b>{row.type || "Evidence"}:</b> {row.label || "Unnamed evidence"}
                    <div style={{ color: "#475569" }}>{row.supports || "Support not specified."}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#64748b" }}>No specific evidence table was returned.</div>
            )}
          </Section>

          <Section title="Missing Evidence" testId="dispute-ai-missing-evidence">
            <BulletList items={overview?.missing_evidence || overview?.missing_info} empty="Insufficient evidence to determine additional missing items." />
          </Section>

          {recommendation ? (
            <Section title="Recommended COA" testId="dispute-ai-recommended-coa">
                <div style={{ fontSize: 13 }}>
                <div style={{ marginBottom: 6 }}><b>Recommended option:</b> {recommendation.recommended_option_id}</div>
                <div style={{ marginBottom: 6 }}><b>Confidence:</b> {confidenceLabel(recommendation.confidence)}</div>
                <div style={{ marginBottom: 8 }}><b>Why:</b> {recommendation.why_this_option}</div>
                <div style={{ marginBottom: 8 }}>
                  <b>Supporting evidence:</b>
                  <BulletList items={recommendation.supporting_evidence} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <b>Missing evidence:</b>
                  <BulletList items={recommendation.missing_evidence} empty="No additional missing evidence listed." />
                </div>
                <div style={{ opacity: 0.9 }}>{recommendation.notes_for_parties}</div>
                {recommendation.advisory_boundary ? (
                  <div style={{ marginTop: 8, fontWeight: 800 }}>{recommendation.advisory_boundary}</div>
                ) : null}
              </div>
            </Section>
          ) : null}

          {coursesOfAction.length ? (
            <Section title="Courses of Action" testId="dispute-ai-coas">
              <div style={{ display: "grid", gap: 12 }}>
                {coursesOfAction.map((opt, idx) => (
                  <div key={opt.option_id || idx} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 900 }}>
                        {opt.label || `COA ${idx + 1}`} <span style={{ fontWeight: 600, opacity: 0.7 }}>({opt.option_id || `coa_${idx + 1}`})</span>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>{opt.estimated_impact || opt.outcome}</div>
                    </div>
                    {opt.description ? <div style={{ marginTop: 8, fontSize: 13 }}>{opt.description}</div> : null}
                    <div style={{ marginTop: 10, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                      <div><b>Pros</b><BulletList items={opt.pros} /></div>
                      <div><b>Cons</b><BulletList items={opt.cons} /></div>
                      <div><b>Evidence supporting</b><BulletList items={opt.evidence_supporting} /></div>
                      <div><b>Risks</b><BulletList items={opt.risks} /></div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          {draft ? (
            <Section title="Human Approval Notes" testId="dispute-ai-human-approval">
              <div style={{ fontWeight: 800, marginBottom: 8 }}>{draft.title}</div>
              {!!draft.terms?.length ? (
                <ol style={{ margin: 0, paddingLeft: 18 }}>
                  {draft.terms.map((term, idx) => (
                    <li key={idx} style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 6 }}>{term}</li>
                  ))}
                </ol>
              ) : null}
              {draft.human_approval_required ? (
                <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800 }}>{draft.human_approval_required}</div>
              ) : null}
              {draft.signature_block ? <pre style={preStyle}>{draft.signature_block}</pre> : null}
            </Section>
          ) : null}
        </div>
      ) : null}
    </ProjectAssistantPanel>
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
