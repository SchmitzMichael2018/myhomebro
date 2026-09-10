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

export default function DisputeAIRecommendationPanel({ disputeId, dispute = null, onUseResponseDraft = null }) {
  const [loading, setLoading] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [selectedCoa, setSelectedCoa] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  const hasPayload = !!result?.payload;
  const parsed = useMemo(() => parseDisputeRecommendationResponse(result || {}), [result]);
  const coursesOfAction = useMemo(() => {
    const arr = result?.payload?.courses_of_action || result?.payload?.options || parsed.options;
    return Array.isArray(arr) ? arr : [];
  }, [parsed.options, result]);

  const overview = result?.payload?.overview || null;
  const recommendation = result?.payload?.recommendation || null;
  const contractorSolutionReview = result?.payload?.contractor_solution_review || null;
  const contractorResponseDraft = result?.payload?.contractor_response_draft || null;
  const draft = result?.payload?.draft_resolution_agreement || null;
  const unsafeLanguageDetected = hasPayload && hasForbiddenLanguage(result?.payload);
  const attachments = Array.isArray(dispute?.attachments) ? dispute.attachments : [];
  const indexedEvidence = Array.isArray(dispute?.evidence_index) ? dispute.evidence_index : [];
  const hasVisualEvidence = attachments.some((item) => ["photo", "image", "video"].includes(String(item?.kind || "").toLowerCase()))
    || indexedEvidence.some((item) => ["photo", "image", "video"].includes(String(item?.category || "").toLowerCase()));
  const statements = Array.isArray(dispute?.party_statements) ? dispute.party_statements : [];
  const currentContractorStatement = statements.find((item) => item?.party_role === "contractor" && item?.is_current);
  const contractorStatementText = String(currentContractorStatement?.text || dispute?.contractor_response || "").trim();
  const hasContractorStatement = Boolean(contractorStatementText && !contractorStatementText.startsWith("MHB_PROPOSAL_V1:"));

  async function copyContractorResponse() {
    const response = String(contractorResponseDraft?.response || "").trim();
    if (!response) return;
    try {
      window.sessionStorage.setItem(`mhb:dispute:${disputeId}:contractor-response-draft`, response);
    } catch {
      // Clipboard copy can still succeed when session storage is restricted.
    }
    try {
      await navigator.clipboard.writeText(response);
      setCopyStatus("Copied. Open Send Customer Message, then choose Paste Response.");
    } catch {
      setCopyStatus("Draft saved. Open Send Customer Message, then choose Paste Response.");
    }
  }

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

  async function generate(force = false, selectedOptionId = "") {
    if (!disputeId) return;
    setErr("");
    setLoading(true);
    try {
      const res = await api.post(
        `/projects/disputes/${disputeId}/ai/recommendation/`,
        {
          force,
          selected_coa: selectedOptionId,
          context: serializeAiContext(buildAiContext({
            page: "disputes",
            entityId: disputeId || null,
            entityType: "dispute",
          })),
        },
        { timeout: 120000 },
      );
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

  useEffect(() => {
    if (recommendation?.recommended_option_id && !selectedCoa) {
      setSelectedCoa(String(recommendation.recommended_option_id));
    }
  }, [recommendation?.recommended_option_id, selectedCoa]);

  return (
    <ProjectAssistantPanel
      subtitle="Project Assistant Recommendation"
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

      {dispute && (!hasVisualEvidence || !hasContractorStatement) ? (
        <div style={{ marginTop: 12, border: "1px solid #fcd34d", background: "#fffbeb", color: "#78350f", borderRadius: 12, padding: 12, fontSize: 13 }} data-testid="dispute-ai-evidence-readiness">
          <div style={{ fontWeight: 800 }}>Complete the record before deciding on a resolution</div>
          {!hasVisualEvidence ? <div style={{ marginTop: 4 }}>Request clear photos of the specific area identified in the complaint. If the issue is unclear, ask the customer to identify the location, condition, and expected correction.</div> : null}
          {!hasContractorStatement ? <div style={{ marginTop: 4 }}>Add the contractor&apos;s account after reviewing the complaint and evidence. Project Assistant will then compare both statements with the signed agreement and submitted files.</div> : null}
        </div>
      ) : null}

      {dispute && hasVisualEvidence && hasContractorStatement ? (
        <div style={{ marginTop: 12, border: "1px solid #86efac", background: "#f0fdf4", color: "#14532d", borderRadius: 12, padding: 12, fontSize: 13 }} data-testid="dispute-ai-evidence-ready">
          <div style={{ fontWeight: 800 }}>Evidence is ready for corrective-action review</div>
          <div style={{ marginTop: 4 }}>The complaint, visual evidence, and contractor response are present. Generate a new recommendation to evaluate and improve the proposed solution.</div>
        </div>
      ) : null}

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

              {overview.timeline?.length ? (
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

              {overview.main_issues?.length ? (
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

          {contractorSolutionReview?.solution_present ? (
            <Section title="Contractor Solution Review" testId="dispute-ai-contractor-solution-review">
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>{contractorSolutionReview.summary}</div>
              <div style={{ marginTop: 12, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <div><div style={{ fontWeight: 800, marginBottom: 6 }}>What works</div><BulletList items={contractorSolutionReview.strengths} /></div>
                <div><div style={{ fontWeight: 800, marginBottom: 6 }}>What needs clarification</div><BulletList items={contractorSolutionReview.gaps} /></div>
                <div><div style={{ fontWeight: 800, marginBottom: 6 }}>Recommended improvements</div><BulletList items={contractorSolutionReview.recommended_improvements} /></div>
                <div><div style={{ fontWeight: 800, marginBottom: 6 }}>Risks to address</div><BulletList items={contractorSolutionReview.risks} /></div>
              </div>
              {contractorSolutionReview.improved_solution ? (
                <div style={{ marginTop: 12, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#172554", borderRadius: 10, padding: 12 }}>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>Suggested improved version</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{contractorSolutionReview.improved_solution}</div>
                </div>
              ) : null}
              <div style={{ marginTop: 8, fontWeight: 700 }}>{contractorSolutionReview.human_review_required}</div>
            </Section>
          ) : null}

          {recommendation ? (
            <div data-testid="dispute-ai-recommended-coa" style={{ border: "2px solid #22c55e", background: "linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)", color: "#052e16", borderRadius: 16, padding: 18, boxShadow: "0 12px 30px rgba(34, 197, 94, 0.14)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div><div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase", color: "#15803d" }}>Project Assistant&apos;s preferred course</div><h3 style={{ margin: "5px 0 0", fontSize: 20 }}>Recommended COA</h3></div>
                <span style={{ borderRadius: 999, background: "#166534", color: "#fff", padding: "6px 10px", fontSize: 12, fontWeight: 800 }}>Recommended</span>
              </div>
                <div style={{ fontSize: 13 }}>
                <div style={{ margin: "12px 0 6px" }}><b>Recommended option:</b> {coursesOfAction.find((item) => String(item.option_id) === String(recommendation.recommended_option_id))?.label || recommendation.recommended_option_id}</div>
                {recommendation.final_resolution_readiness ? (
                  <div style={{ marginBottom: 6 }}><b>Confidence in this recommended next step:</b> {confidenceLabel(recommendation.confidence)}</div>
                ) : (
                  <div style={{ marginBottom: 6 }}><b>Recommendation status:</b> This saved analysis uses a combined confidence score. Generate a new version to score the recommended next step separately from final-resolution readiness.</div>
                )}
                <div style={{ marginBottom: 10 }}><b>Readiness for a final resolution:</b> <span style={{ textTransform: "capitalize" }}>{recommendation.final_resolution_readiness || (list(recommendation.missing_evidence).length ? "low" : "medium")}</span>{recommendation.readiness_explanation ? ` — ${recommendation.readiness_explanation}` : " — More evidence is needed before selecting a final outcome."}</div>
                <div style={{ marginBottom: 8 }}><b>Why:</b> {recommendation.why_this_option}</div>
                <div style={{ marginBottom: 12, borderLeft: "4px solid #22c55e", background: "#fff", padding: "10px 12px", borderRadius: 8 }}><b>Why this is favored:</b> {recommendation.favored_over_alternatives || "This option best matches the current evidence while limiting avoidable delay and risk."}</div>
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
            </div>
          ) : null}

          {coursesOfAction.length ? (
            <Section title="Courses of Action" testId="dispute-ai-coas">
              <div style={{ display: "grid", gap: 12 }}>
                {coursesOfAction.map((opt, idx) => {
                  const optionId = String(opt.option_id || `coa_${idx + 1}`);
                  const isRecommended = optionId === String(recommendation?.recommended_option_id || "");
                  const isSelected = optionId === selectedCoa;
                  return (
                  <div key={optionId} style={{ border: isSelected ? "2px solid #2563eb" : isRecommended ? "2px solid #22c55e" : "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: isSelected ? "#eff6ff" : isRecommended ? "#f0fdf4" : "transparent", color: "#0f172a" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                      <div style={{ fontWeight: 900 }}>
                        {opt.label || `COA ${idx + 1}`} {isRecommended ? <span style={{ color: "#15803d", fontSize: 12 }}>(Recommended)</span> : null}
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
                    <button type="button" onClick={() => setSelectedCoa(optionId)} style={{ ...btnStyle, marginTop: 12, background: isSelected ? "#1d4ed8" : "#fff", color: isSelected ? "#fff" : "#0f172a" }} data-testid={`select-dispute-coa-${optionId}`}>{isSelected ? "Selected" : "Select this COA"}</button>
                  </div>
                  );
                })}
              </div>
              {selectedCoa ? <div style={{ marginTop: 14, borderTop: "1px solid #cbd5e1", paddingTop: 14 }}><button type="button" onClick={() => generate(true, selectedCoa)} disabled={loading} style={{ ...btnStyle, background: "#1d4ed8", color: "#fff" }} data-testid="generate-contractor-response">{loading ? "Drafting response..." : "Draft contractor response from selected COA"}</button><div style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>Creates a reviewable draft. Nothing is sent or saved as the contractor&apos;s statement automatically.</div></div> : null}
            </Section>
          ) : null}

          {contractorResponseDraft?.response ? (
            <Section title="Draft Contractor Response" testId="dispute-ai-contractor-response-draft">
              <div style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>Based on selected COA: {contractorResponseDraft.selected_option_id || selectedCoa}</div>
              {contractorResponseDraft.subject ? <div style={{ marginTop: 8, fontWeight: 800 }}>{contractorResponseDraft.subject}</div> : null}
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap", border: "1px solid #bfdbfe", background: "#eff6ff", color: "#172554", borderRadius: 10, padding: 12 }}>{contractorResponseDraft.response}</div>
              {contractorResponseDraft.review_note ? <div style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>{contractorResponseDraft.review_note}</div> : null}
              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 800 }}>Need more information? Send this as a contractor message. Ready to offer final terms? Continue to Proposed Resolution.</div>
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {onUseResponseDraft ? <button type="button" onClick={() => onUseResponseDraft(contractorResponseDraft.response)} style={{ ...btnStyle, background: "#1d4ed8", color: "#fff" }} data-testid="send-contractor-response">Send to Customer</button> : null}
                <button type="button" onClick={copyContractorResponse} style={{ ...btnStyle, background: "#fff", color: "#0f172a" }} data-testid="copy-contractor-response">Copy Response</button>
              </div>
              {copyStatus ? <div role="status" style={{ marginTop: 8, fontSize: 12, color: "#166534", fontWeight: 700 }}>{copyStatus}</div> : null}
            </Section>
          ) : null}

          {draft ? (
            <Section title="Human Approval Notes" testId="dispute-ai-human-approval">
              <div style={{ fontWeight: 800, marginBottom: 8 }}>{draft.title}</div>
              {draft.terms?.length ? (
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
  color: "#0f172a",
  cursor: "pointer",
  fontWeight: 600,
  opacity: 1,
};

const preStyle = {
  marginTop: 10,
  padding: 10,
  background: "#f9fafb",
  color: "#0f172a",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  whiteSpace: "pre-wrap",
  fontSize: 12,
  lineHeight: 1.4,
};
