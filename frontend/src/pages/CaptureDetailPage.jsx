import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileImage } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import {
  approveCaptureReview,
  archiveCapture,
  processCapture,
  retryCapture,
  updateCaptureReview,
} from "../api/captures.js";
import { useAssistantDock } from "../components/AssistantDock.jsx";
import {
  AIActionButton,
  Button,
  Card,
  FormField,
  InlineAlert,
  LoadingSkeleton,
  StatusBadge,
  WorkspacePageHeader,
} from "../components/ui";
import { useCapture } from "../hooks/useCaptures.js";
import { isCaptureReviewEnabled } from "../lib/captureFlags.js";

const LABELS = {
  quick_lead: "Quick Lead",
  quick_note: "Quick Note",
  photo: "Photo",
  receipt: "Receipt",
  opportunity: "Opportunity",
};

const STATUS_TONES = {
  saved: "draft",
  processing: "pending",
  ready_for_review: "required",
  needs_information: "required",
  possible_duplicate: "required",
  approved: "complete",
  applied: "complete",
  archived: "complete",
  failed: "blocked",
};

function ValueRow({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="grid gap-1 border-b border-[var(--mhb-border-divider)] py-3 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm font-bold text-[var(--mhb-text-muted)]">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm text-[var(--mhb-text-primary)]">
        {String(value)}
      </dd>
    </div>
  );
}

function TextField({ label, value, onChange, multiline = false, required = false }) {
  return (
    <FormField label={label} required={required}>
      {(props) => {
        const Component = multiline ? "textarea" : "input";
        return (
          <Component
            {...props}
            rows={multiline ? 4 : undefined}
            value={value || ""}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 py-2 text-[var(--mhb-text-primary)] focus:border-[var(--mhb-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
          />
        );
      }}
    </FormField>
  );
}

export default function CaptureDetailPage() {
  const { captureId } = useParams();
  const navigate = useNavigate();
  const { openAssistant } = useAssistantDock();
  const { capture, loading, error, reload } = useCapture(captureId);
  const [draft, setDraft] = useState(null);
  const [duplicateDecision, setDuplicateDecision] = useState(null);
  const [busy, setBusy] = useState("");
  const reviewEnabled = isCaptureReviewEnabled();

  useEffect(() => {
    if (!capture) return;
    setDraft(
      capture.status === "approved"
        ? capture.approved_snapshot?.structured_draft || capture.structured_draft
        : capture.structured_draft
    );
    setDuplicateDecision(capture.review_decisions?.duplicate || null);
  }, [capture]);

  const review = useMemo(() => {
    const candidates = capture?.duplicate_candidates || [];
    const required = candidates.some((row) =>
      ["exact", "strong"].includes(row.match_strength)
    ) && !duplicateDecision;
    return {
      missing: draft?.missing_fields || [],
      uncertainties: draft?.uncertainties || [],
      warnings: draft?.warnings || [],
      duplicateRequired: required,
      canApprove: Boolean(draft) && !(draft?.missing_fields || []).length && !required,
    };
  }, [capture, draft, duplicateDecision]);

  function update(path, value) {
    setDraft((current) => {
      const next = structuredClone(current);
      let target = next;
      path.slice(0, -1).forEach((key) => {
        target = target[key];
      });
      target[path.at(-1)] = value;
      return next;
    });
  }

  async function run(name, action, success) {
    setBusy(name);
    try {
      await action();
      if (success) toast.success(success);
      await reload();
    } catch (requestError) {
      const payload = requestError?.response?.data;
      if (payload?.code === "capture_version_conflict") {
        toast.error("This Capture changed. The current review has been reloaded.");
        await reload();
      } else if (payload?.capture_saved) {
        toast.error("Capture saved. Processing failed, but manual review is available.");
        await reload();
      } else {
        toast.error(payload?.detail || "The Capture could not be updated.");
      }
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <div className="mx-auto w-full max-w-6xl p-4"><LoadingSkeleton theme="operational" variant="workspace" label="Loading Capture" /></div>;
  }
  if (error || !capture) {
    return <div className="mx-auto w-full max-w-6xl p-4"><InlineAlert theme="operational" tone="danger">{error || "Capture not found."}</InlineAlert></div>;
  }

  const raw = capture.raw_text_payload || {};
  const processable = ["quick_lead", "quick_note"].includes(capture.capture_type);
  const editable = reviewEnabled && processable && [
    "ready_for_review", "needs_information", "possible_duplicate", "failed",
  ].includes(capture.status) && Boolean(draft);

  const assistantContext = {
    workspace: "capture_review",
    workspace_mode: "capture_review",
    capture_id: capture.id,
    capture_version: capture.version,
    capture_type: capture.capture_type,
    status: capture.status,
    raw_source_summary: raw.text || raw.transcript || raw.notes || raw.name || "",
    structured_draft: draft || {},
    missing_fields: review.missing,
    uncertainties: review.uncertainties,
    warnings: review.warnings,
    duplicate_candidates: capture.duplicate_candidates || [],
    proposed_destinations: draft?.proposed_destinations || [draft?.suggested_destination].filter(Boolean),
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5 overflow-x-clip p-4 pb-28 sm:p-6 sm:pb-28 lg:p-8" data-testid="capture-detail">
      <WorkspacePageHeader
        theme="operational"
        title={LABELS[capture.capture_type] || "Capture"}
        subtitle={`Captured ${new Date(capture.created_at).toLocaleString()}`}
        status={STATUS_TONES[capture.status] || "pending"}
        secondaryActions={<Button variant="secondary" theme="operational" icon={ArrowLeft} onClick={() => navigate("/app/capture")}>Back to Inbox</Button>}
        primaryAction={reviewEnabled && processable ? (
          <AIActionButton
            theme="operational"
            onClick={() => openAssistant({ title: "Project Assistant · Capture review", context: assistantContext })}
          >
            Ask Project Assistant
          </AIActionButton>
        ) : null}
      />

      {capture.status === "failed" ? (
        <InlineAlert theme="operational" tone="warning">
          Capture saved. Processing failed. Your original content is safe and manual review remains available.
        </InlineAlert>
      ) : null}
      {capture.status === "approved" ? (
        <InlineAlert theme="operational" tone="success">
          Draft approved. No customer, opportunity, follow-up, or other business record has been created.
        </InlineAlert>
      ) : null}

      <Card theme="operational" padding="md">
        <h2 className="text-lg font-black">Original contents</h2>
        <p className="mt-1 text-xs text-[var(--mhb-text-muted)]">Original Capture</p>
        <dl className="mt-3">
          <ValueRow label="Name" value={raw.name} />
          <ValueRow label="Phone" value={raw.phone} />
          <ValueRow label="Email" value={raw.email} />
          <ValueRow label="Title" value={raw.title} />
          <ValueRow label="Text" value={raw.text} />
          <ValueRow label="Transcript" value={raw.transcript} />
          <ValueRow label="Notes" value={raw.notes} />
          <ValueRow label="Capture method" value={capture.capture_method?.replaceAll("_", " ")} />
          <ValueRow label="Creator" value={capture.captured_by_name || "Unknown creator"} />
        </dl>
        {capture.artifacts?.length ? (
          <div className="mt-4 grid gap-2">
            {capture.artifacts.map((artifact) => (
              <div key={artifact.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                <FileImage className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="truncate text-sm font-bold">{artifact.original_filename || "Artifact"}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {draft ? (
        <>
          <Card theme="operational" padding="md" data-testid="capture-interpretation">
            <h2 className="text-lg font-black">Project Assistant interpretation</h2>
            <p className="mt-2 text-sm text-[var(--mhb-text-secondary)]">
              {draft.opportunity?.summary || draft.body || "Review the prepared draft below."}
            </p>
            <ValueRow label="Proposed records" value={(draft.proposed_destinations || [draft.suggested_destination]).filter(Boolean).join(", ")} />
            {review.missing.length ? <InlineAlert theme="operational" tone="warning">Missing information: {review.missing.join(", ")}</InlineAlert> : null}
            {review.uncertainties.length ? <InlineAlert theme="operational" tone="info">Uncertainties: {review.uncertainties.join("; ")}</InlineAlert> : null}
            {review.warnings.length ? <InlineAlert theme="operational" tone="warning">Warnings: {review.warnings.join("; ")}</InlineAlert> : null}
          </Card>

          <Card theme="operational" padding="md" data-testid="capture-review-form">
            <h2 className="text-lg font-black">Editable structured draft</h2>
            <p className="mt-1 text-xs text-[var(--mhb-text-muted)]">{draft.schema_version}</p>
            <fieldset disabled={!editable} className="mt-4 grid min-w-0 gap-4">
              {capture.capture_type === "quick_lead" ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextField label="Name" required value={draft.person?.name} onChange={(value) => update(["person", "name"], value)} />
                    <TextField label="Phone" value={draft.person?.phone} onChange={(value) => update(["person", "phone"], value)} />
                    <TextField label="Email" value={draft.person?.email} onChange={(value) => update(["person", "email"], value)} />
                  </div>
                  <TextField label="Project title" value={draft.opportunity?.title} onChange={(value) => update(["opportunity", "title"], value)} />
                  <TextField label="Summary" multiline value={draft.opportunity?.summary} onChange={(value) => update(["opportunity", "summary"], value)} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Project type" value={draft.opportunity?.project_type} onChange={(value) => update(["opportunity", "project_type"], value)} />
                    <TextField label="Location" value={draft.opportunity?.location_text} onChange={(value) => update(["opportunity", "location_text"], value)} />
                  </div>
                </>
              ) : (
                <>
                  <TextField label="Title" value={draft.title} onChange={(value) => update(["title"], value)} />
                  <TextField label="Note" required multiline value={draft.body} onChange={(value) => update(["body"], value)} />
                  <FormField label="Proposed destination">
                    {(props) => (
                      <select {...props} value={draft.suggested_destination} onChange={(event) => update(["suggested_destination"], event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
                        {["unassigned_note", "customer_note", "project_note", "opportunity_note", "follow_up"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
                      </select>
                    )}
                  </FormField>
                </>
              )}
              <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
                <input type="checkbox" checked={Boolean(draft.follow_up?.suggested)} onChange={(event) => update(["follow_up", "suggested"], event.target.checked)} />
                Suggest a follow-up for Phase B.3 review
              </label>
            </fieldset>
          </Card>
        </>
      ) : null}

      {capture.duplicate_candidates?.length ? (
        <Card theme="operational" padding="md" data-testid="capture-duplicates">
          <h2 className="text-lg font-black">Possible duplicates</h2>
          <div className="mt-3 grid gap-3">
            {capture.duplicate_candidates.map((candidate) => (
              <div key={candidate.candidate_id} className="rounded-xl border border-[var(--mhb-border-default)] p-3">
                <div className="font-bold">{candidate.display_name}</div>
                <div className="text-sm text-[var(--mhb-text-muted)]">{candidate.reason} · {candidate.match_strength}</div>
                <div className="text-xs text-[var(--mhb-text-muted)]">{candidate.masked_email} {candidate.masked_phone}</div>
                {editable ? (
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input type="radio" name="duplicate-decision" checked={duplicateDecision?.decision === "link_existing" && String(duplicateDecision?.candidate_id) === String(candidate.candidate_id)} onChange={() => setDuplicateDecision({ decision: "link_existing", candidate_id: candidate.candidate_id })} />
                    Link to this existing customer later
                  </label>
                ) : null}
              </div>
            ))}
            {editable ? (
              <div className="grid gap-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="duplicate-decision" checked={duplicateDecision?.decision === "create_separate"} onChange={() => setDuplicateDecision({ decision: "create_separate", candidate_id: null })} />Create a separate customer later</label>
                <label className="flex items-center gap-2"><input type="radio" name="duplicate-decision" checked={duplicateDecision?.decision === "not_same_person"} onChange={() => setDuplicateDecision({ decision: "not_same_person", candidate_id: null })} />Not the same person</label>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card theme="operational" padding="md">
        <h2 className="text-lg font-black">History and Timeline</h2>
        <ol className="mt-3 grid gap-3">
          {(capture.events || []).map((event) => (
            <li key={event.id} className="border-l-2 border-[var(--mhb-border-selected)] pl-3">
              <div className="text-sm font-bold">{event.event_type?.replaceAll("_", " ")}</div>
              <div className="text-xs text-[var(--mhb-text-muted)]">{new Date(event.created_at).toLocaleString()}{event.to_status ? ` · ${event.to_status.replaceAll("_", " ")}` : ""}</div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--mhb-border-default)] bg-[var(--mhb-surface-elevated)]/95 p-3 shadow-lg backdrop-blur sm:left-auto sm:right-4 sm:bottom-4 sm:rounded-2xl sm:border" data-testid="capture-sticky-actions">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-end gap-2">
          {reviewEnabled && processable && capture.status === "saved" ? <Button theme="operational" loading={busy === "process"} onClick={() => run("process", () => processCapture(capture.id, { expected_version: capture.version }))}>Process</Button> : null}
          {reviewEnabled && processable && capture.status === "failed" ? (
            <>
              <Button variant="secondary" theme="operational" loading={busy === "retry"} onClick={() => run("retry", () => retryCapture(capture.id, { expected_version: capture.version }), "Draft prepared for review.")}>Retry</Button>
              <Button theme="operational" loading={busy === "manual"} onClick={() => run("manual", () => retryCapture(capture.id, { expected_version: capture.version, mode: "manual" }), "Manual draft prepared.")}>Review manually</Button>
            </>
          ) : null}
          {editable ? <Button variant="secondary" theme="operational" loading={busy === "save"} onClick={() => run("save", () => updateCaptureReview(capture.id, { expected_version: capture.version, structured_draft: draft, duplicate_decision: duplicateDecision }), "Review edits saved.")}>Save edits</Button> : null}
          {editable ? <Button theme="operational" disabled={!review.canApprove} loading={busy === "approve"} onClick={() => run("approve", async () => {
            let version = capture.version;
            const currentDraft = JSON.stringify(draft);
            if (currentDraft !== JSON.stringify(capture.structured_draft) || JSON.stringify(duplicateDecision) !== JSON.stringify(capture.review_decisions?.duplicate || null)) {
              const saved = await updateCaptureReview(capture.id, { expected_version: version, structured_draft: draft, duplicate_decision: duplicateDecision });
              version = saved.capture.version;
            }
            return approveCaptureReview(capture.id, { expected_version: version });
          }, "Draft approved.")}>Approve draft</Button> : null}
          {capture.status !== "archived" ? <Button variant="ghost" theme="operational" loading={busy === "archive"} onClick={() => run("archive", () => archiveCapture(capture.id, { expected_version: capture.version, reason: "Archived from Capture review" }), "Capture archived.")}>Archive</Button> : null}
        </div>
      </div>
    </div>
  );
}
