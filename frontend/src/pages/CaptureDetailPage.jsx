import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Download, FileImage } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import {
  approveCaptureReview,
  applyCapture,
  archiveCapture,
  getCaptureReceipt,
  listCaptureCustomers,
  previewCaptureApplication,
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
import {
  useCapture,
  useCaptureArtifacts,
  useCaptureTimeline,
} from "../hooks/useCaptures.js";
import {
  isCaptureApplicationEnabled,
  isCaptureReviewEnabled,
} from "../lib/captureFlags.js";

const LABELS = {
  quick_lead: "Quick Lead",
  quick_note: "Quick Note",
  photo: "Photo",
  receipt: "Receipt",
  opportunity: "Opportunity",
  project_update: "Project Update",
  progress_photo: "Progress Photo",
  issue: "Issue",
  communication: "Communication",
  document: "Document",
  equipment: "Equipment",
  warranty_document: "Warranty Document",
  warranty_concern: "Warranty Concern",
};

const PROJECT_CAPTURE_TYPES = [
  "project_update",
  "progress_photo",
  "issue",
  "communication",
  "document",
];
const D2_CAPTURE_TYPES = ["equipment", "warranty_document", "warranty_concern"];

const STATUS_TONES = {
  saved: "draft",
  processing: "pending",
  ready_for_review: "required",
  needs_information: "required",
  possible_duplicate: "required",
  approved: "complete",
  applying: "pending",
  applied: "complete",
  apply_failed: "blocked",
  archived: "complete",
  failed: "blocked",
};

const EVENT_LABELS = {
  created: "Created",
  draft_prepared: "Processed",
  draft_updated: "Edited",
  review_updated: "Edited",
  duplicate_resolved: "Duplicate resolved",
  draft_approved: "Approved",
  application_started: "Application started",
  application_completed: "Applied",
  application_failed: "Application failed",
  processing_failed: "Processing failed",
  retry_started: "Retry started",
  archived: "Archived",
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
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [artifactsEnabled, setArtifactsEnabled] = useState(false);
  const timeline = useCaptureTimeline(captureId, { enabled: timelineEnabled });
  const artifacts = useCaptureArtifacts(captureId, { enabled: artifactsEnabled });
  const [draft, setDraft] = useState(null);
  const [duplicateDecision, setDuplicateDecision] = useState(null);
  const [busy, setBusy] = useState("");
  const [applicationPreview, setApplicationPreview] = useState(null);
  const [applicationReceipt, setApplicationReceipt] = useState(null);
  const [applicationConfirmed, setApplicationConfirmed] = useState(false);
  const [includeFollowUp, setIncludeFollowUp] = useState(false);
  const [noteDestination, setNoteDestination] = useState("unassigned_note");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customers, setCustomers] = useState([]);
  const reviewEnabled = isCaptureReviewEnabled();
  const applicationEnabled = isCaptureApplicationEnabled();

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(String(value || ""));
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`${label} could not be copied. Select the text and copy it manually.`);
    }
  }

  useEffect(() => {
    if (!capture) return;
    setDraft(
      ["approved", "applying", "applied", "apply_failed"].includes(capture.status)
        ? capture.approved_snapshot?.structured_draft || capture.structured_draft
        : capture.structured_draft
    );
    setDuplicateDecision(capture.review_decisions?.duplicate || null);
    const approvedDraft = capture.approved_snapshot?.structured_draft;
    if (capture.capture_type === "quick_note") {
      setNoteDestination(
        approvedDraft?.suggested_destination === "customer_note"
          ? "customer_note"
          : "unassigned_note"
      );
    }
    setApplicationPreview(null);
    setApplicationConfirmed(false);
  }, [capture]);

  useEffect(() => {
    if (!applicationEnabled || !capture) return;
    if (capture.capture_type === "quick_note" && ["approved", "apply_failed"].includes(capture.status)) {
      listCaptureCustomers().then(setCustomers).catch(() => setCustomers([]));
    }
    if (capture.status === "applied") {
      getCaptureReceipt(capture.id)
        .then((data) => setApplicationReceipt(data?.receipts?.[0]?.receipt_payload || null))
        .catch(() => setApplicationReceipt(null));
    }
  }, [applicationEnabled, capture]);

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

  function applicationPayload({ confirmed = false, idempotencyKey } = {}) {
    const isLead = capture.capture_type === "quick_lead";
    const isProjectCapture = [...PROJECT_CAPTURE_TYPES, ...D2_CAPTURE_TYPES].includes(capture.capture_type);
    const destinations = isLead
      ? ["customer", "opportunity"]
      : isProjectCapture
      ? (draft?.proposed_destinations || []).filter((value) => value !== "follow_up")
      : [noteDestination];
    if (includeFollowUp) destinations.push("follow_up");
    const duplicate = capture.approved_snapshot?.review_decisions?.duplicate;
    return {
      expected_version: capture.version,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      destinations,
      adapter_versions: Object.fromEntries(destinations.map((name) => [name, "1"])),
      application_options: {
        include_follow_up: includeFollowUp,
        ...(noteDestination === "customer_note" && selectedCustomerId
          ? { customer_id: Number(selectedCustomerId) }
          : {}),
        ...(duplicate
          ? {
              duplicate_resolution: {
                action: {
                  link_existing: "link",
                  create_separate: "create_separate",
                  not_same_person: "not_same_person",
                  not_same_item: "not_same_item",
                }[duplicate.decision],
                ...(capture.capture_type === "equipment"
                  ? { equipment_id: duplicate.candidate_id }
                  : { customer_id: duplicate.candidate_id }),
              },
            }
          : {}),
      },
      confirmed,
    };
  }

  async function previewApplication() {
    setBusy("preview-application");
    try {
      setApplicationPreview(
        await previewCaptureApplication(capture.id, applicationPayload())
      );
      setApplicationConfirmed(false);
    } catch (requestError) {
      const payload = requestError?.response?.data;
      if (payload?.code === "capture_version_conflict") await reload();
      toast.error(payload?.detail || "Application preview could not be prepared.");
    } finally {
      setBusy("");
    }
  }

  async function applyApprovedDraft() {
    setBusy("apply-application");
    try {
      const result = await applyCapture(
        capture.id,
        applicationPayload({
          confirmed: true,
          idempotencyKey: crypto.randomUUID(),
        })
      );
      setApplicationReceipt(result.receipt);
      toast.success("Approved Capture applied.");
      await reload();
    } catch (requestError) {
      const payload = requestError?.response?.data;
      if (payload?.code === "capture_version_conflict") {
        toast.error("This Capture changed. Reloaded the current application state.");
      } else {
        toast.error(payload?.detail || "Application failed safely. No partial records were kept.");
      }
      await reload();
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <div className="mx-auto w-full max-w-6xl p-4"><LoadingSkeleton theme="operational" variant="workspace" label="Loading Capture" /></div>;
  }
  if (error || !capture) {
    return (
      <div className="mx-auto grid w-full max-w-6xl gap-3 p-4">
        <InlineAlert theme="operational" tone="danger">
          {navigator.onLine
            ? error || "Capture not found or is no longer available."
            : "You appear to be offline. Reconnect, then try again."}
        </InlineAlert>
        <div>
          <Button theme="operational" onClick={reload}>Try again</Button>
        </div>
      </div>
    );
  }

  const raw = capture.raw_text_payload || {};
  const processable = ["quick_lead", "quick_note", ...PROJECT_CAPTURE_TYPES, ...D2_CAPTURE_TYPES].includes(capture.capture_type);
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
      {capture.status === "applying" ? (
        <InlineAlert theme="operational" tone="info">
          Applying the approved records. Duplicate submissions are disabled.
        </InlineAlert>
      ) : null}
      {capture.status === "apply_failed" ? (
        <InlineAlert theme="operational" tone="danger">
          Application failed safely. No partial records were kept. Review the preview and retry with a new application attempt.
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
          <ValueRow label="Project" value={capture.project_title} />
          <ValueRow label="Milestone" value={capture.milestone_title} />
          <ValueRow label="Capture method" value={capture.capture_method?.replaceAll("_", " ")} />
          <ValueRow label="Creator" value={capture.captured_by_name || "Unknown creator"} />
        </dl>
        {raw.transcript ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            theme="operational"
            startIcon={<Copy aria-hidden="true" />}
            onClick={() => copyText(raw.transcript, "Transcript")}
          >
            Copy transcript
          </Button>
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
              ) : capture.capture_type === "quick_note" ? (
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
              ) : D2_CAPTURE_TYPES.includes(capture.capture_type) ? (
                <>
                  <ValueRow label="Project ID" value={draft.project_id} />
                  <ValueRow label="Field confidence" value={Object.entries(draft.field_confidence || {}).map(([field, confidence]) => `${field}: ${confidence}`).join(", ")} />
                  {capture.capture_type === "equipment" ? (
                    <>
                      {["category", "manufacturer", "model", "serial_number", "installation_date"].map((field) => (
                        <TextField key={field} label={field.replaceAll("_", " ")} required={field === "category"} value={draft.equipment?.[field]} onChange={(value) => update(["equipment", field], value)} />
                      ))}
                      <TextField label="Description" multiline value={draft.equipment?.description} onChange={(value) => update(["equipment", "description"], value)} />
                      <TextField label="Maintenance notes" multiline value={draft.maintenance?.notes} onChange={(value) => update(["maintenance", "notes"], value)} />
                    </>
                  ) : capture.capture_type === "warranty_document" ? (
                    <>
                      {["manufacturer", "product_name", "model", "serial_number", "purchase_date", "installation_date", "start_date", "expiration_date", "duration_text", "parts_coverage", "labor_coverage", "workmanship_coverage"].map((field) => (
                        <TextField key={field} label={field.replaceAll("_", " ")} multiline={field.endsWith("coverage")} value={draft.warranty?.[field]} onChange={(value) => update(["warranty", field], value)} />
                      ))}
                    </>
                  ) : (
                    <>
                      <TextField label="Title" required value={draft.title} onChange={(value) => update(["title"], value)} />
                      <TextField label="Description" required multiline value={draft.description} onChange={(value) => update(["description"], value)} />
                      <FormField label="Urgency" required>
                        {(props) => <select {...props} value={draft.urgency} onChange={(event) => update(["urgency"], event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select>}
                      </FormField>
                      <TextField label="Customer-visible summary" multiline value={draft.customer_summary} onChange={(value) => update(["customer_summary"], value)} />
                      <TextField label="Internal notes" multiline value={draft.internal_notes} onChange={(value) => update(["internal_notes"], value)} />
                      <InlineAlert theme="operational" tone="info">Warranty review requested. Coverage is not yet determined.</InlineAlert>
                    </>
                  )}
                  {capture.capture_type !== "warranty_concern" ? (
                    <label className="flex min-h-11 items-start gap-3 text-sm font-bold">
                      <input type="checkbox" className="mt-1" checked={Boolean(draft.customer_visible)} onChange={(event) => update(["customer_visible"], event.target.checked)} />
                      Visible in the Customer Portal after application
                    </label>
                  ) : null}
                </>
              ) : (
                <>
                  <ValueRow label="Project" value={draft.project?.title} />
                  <ValueRow label="Milestone" value={draft.milestone?.title} />
                  <TextField label="Title" value={draft.title} onChange={(value) => update(["title"], value)} />
                  <TextField
                    label={capture.capture_type === "issue" ? "Issue details" : capture.capture_type === "communication" ? "Communication summary" : "Project update"}
                    required={["project_update", "issue", "communication"].includes(capture.capture_type)}
                    multiline
                    value={draft.body}
                    onChange={(value) => update(["body"], value)}
                  />
                  {capture.capture_type === "issue" ? (
                    <FormField label="Issue classification" required helperText="Confirm this classification before approval.">
                      {(props) => (
                        <select {...props} value={draft.issue_classification} onChange={(event) => update(["issue_classification"], event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
                          <option value="project_issue">Project issue</option>
                          <option value="punch_item">Punch item</option>
                          <option value="customer_concern">Customer concern</option>
                          <option value="potential_warranty">Potential warranty</option>
                          <option value="potential_change_request">Potential change request</option>
                          <option value="internal_note">Internal note</option>
                        </select>
                      )}
                    </FormField>
                  ) : null}
                  {capture.capture_type === "communication" ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Communication type" required>
                        {(props) => (
                          <select {...props} value={draft.communication_type} onChange={(event) => update(["communication_type"], event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
                            <option value="phone_call">Phone call</option>
                            <option value="in_person">On-site discussion</option>
                            <option value="email">Email summary</option>
                            <option value="sms">Text message</option>
                            <option value="other">Other</option>
                          </select>
                        )}
                      </FormField>
                      <FormField label="Direction" required>
                        {(props) => (
                          <select {...props} value={draft.communication_direction} onChange={(event) => update(["communication_direction"], event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
                            <option value="internal">Internal</option>
                            <option value="inbound">Customer to company</option>
                            <option value="outbound">Company to customer</option>
                          </select>
                        )}
                      </FormField>
                    </div>
                  ) : null}
                  {["project_update", "progress_photo", "document"].includes(capture.capture_type) ? (
                    <label className="flex min-h-11 items-start gap-3 text-sm font-bold">
                      <input type="checkbox" className="mt-1" checked={Boolean(draft.customer_visible)} onChange={(event) => update(["customer_visible"], event.target.checked)} />
                      Visible in the Customer Portal after application
                    </label>
                  ) : null}
                </>
              )}
              <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
                <input type="checkbox" checked={Boolean(draft.follow_up?.suggested)} onChange={(event) => update(["follow_up", "suggested"], event.target.checked)} />
                Suggest a follow-up
              </label>
              {draft.follow_up?.suggested ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Follow-up subject" value={draft.follow_up?.subject} onChange={(value) => update(["follow_up", "subject"], value)} />
                  <FormField label="Follow-up due" required>
                    {(props) => (
                      <input
                        {...props}
                        type="datetime-local"
                        value={draft.follow_up?.due_at || ""}
                        onChange={(event) => update(["follow_up", "due_at"], event.target.value)}
                        className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
                      />
                    )}
                  </FormField>
                </div>
              ) : null}
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
                    Link to this existing {capture.capture_type === "equipment" ? "equipment" : "customer"} later
                  </label>
                ) : null}
              </div>
            ))}
            {editable ? (
              <div className="grid gap-2 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="duplicate-decision" checked={duplicateDecision?.decision === "create_separate"} onChange={() => setDuplicateDecision({ decision: "create_separate", candidate_id: null })} />Create a separate {capture.capture_type === "equipment" ? "equipment record" : "customer"} later</label>
                <label className="flex items-center gap-2"><input type="radio" name="duplicate-decision" checked={duplicateDecision?.decision === (capture.capture_type === "equipment" ? "not_same_item" : "not_same_person")} onChange={() => setDuplicateDecision({ decision: capture.capture_type === "equipment" ? "not_same_item" : "not_same_person", candidate_id: null })} />Not the same {capture.capture_type === "equipment" ? "item" : "person"}</label>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {applicationEnabled && ["approved", "apply_failed"].includes(capture.status) ? (
        <Card theme="operational" padding="md" data-testid="capture-application">
          <h2 className="text-lg font-black">Apply approved draft</h2>
          <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">
            Preview the exact records before anything is created or linked.
          </p>

          {capture.capture_type === "quick_note" ? (
            <fieldset className="mt-4 grid gap-3">
              <legend className="text-sm font-bold">Note destination</legend>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="note-application-destination"
                  checked={noteDestination === "unassigned_note"}
                  onChange={() => {
                    setNoteDestination("unassigned_note");
                    setApplicationPreview(null);
                  }}
                />
                Keep as an unassigned Capture note
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="note-application-destination"
                  checked={noteDestination === "customer_note"}
                  onChange={() => {
                    setNoteDestination("customer_note");
                    setApplicationPreview(null);
                  }}
                />
                Add as a Customer note
              </label>
              {noteDestination === "customer_note" ? (
                <FormField label="Customer" required>
                  {(props) => (
                    <select
                      {...props}
                      value={selectedCustomerId}
                      onChange={(event) => {
                        setSelectedCustomerId(event.target.value);
                        setApplicationPreview(null);
                      }}
                      className="min-h-11 w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
                    >
                      <option value="">Select a customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.full_name || customer.email || `Customer ${customer.id}`}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              ) : null}
            </fieldset>
          ) : null}

          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-bold">
            <input
              type="checkbox"
              checked={includeFollowUp}
              disabled={
                !draft?.follow_up?.due_at
                || (capture.capture_type === "quick_note" && noteDestination === "unassigned_note")
              }
              onChange={(event) => {
                setIncludeFollowUp(event.target.checked);
                setApplicationPreview(null);
              }}
            />
            Include approved follow-up
          </label>
          {!draft?.follow_up?.due_at ? (
            <p className="text-xs text-[var(--mhb-text-muted)]">
              No approved due date is available, so no follow-up will be created.
            </p>
          ) : null}

          {applicationPreview ? (
            <div className="mt-5 grid gap-3" data-testid="capture-application-preview">
              <h3 className="font-black">Application preview</h3>
              {applicationPreview.records.map((record, index) => (
                <div
                  key={`${record.record_type}-${index}`}
                  className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3"
                >
                  <div className="text-sm font-black">
                    {record.action === "link" ? "Link" : record.action === "retain" ? "Keep" : "Create"}{" "}
                    {record.record_type.replaceAll("_", " ")}
                  </div>
                  <div className="mt-1 text-sm text-[var(--mhb-text-secondary)]">{record.label}</div>
                  {Object.entries(record.fields || {}).map(([key, value]) =>
                    value ? <ValueRow key={key} label={key.replaceAll("_", " ")} value={value} /> : null
                  )}
                </div>
              ))}
              {applicationPreview.warnings?.length ? (
                <InlineAlert theme="operational" tone="warning">
                  {applicationPreview.warnings.join(" ")}
                </InlineAlert>
              ) : null}
              <label className="flex min-h-11 items-start gap-3 text-sm font-bold">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={applicationConfirmed}
                  onChange={(event) => setApplicationConfirmed(event.target.checked)}
                />
                I understand these records will be created or linked.
              </label>
            </div>
          ) : null}
        </Card>
      ) : null}

      {applicationEnabled && (applicationReceipt || capture.status === "applied") ? (
        <Card theme="operational" padding="md" data-testid="capture-application-receipt">
          <h2 className="text-lg font-black">Application receipt</h2>
          {applicationReceipt ? (
            <>
              <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">
                Applied {new Date(applicationReceipt.applied_at).toLocaleString()}
              </p>
              <div className="mt-4 grid gap-2">
                {[...(applicationReceipt.created_records || []), ...(applicationReceipt.linked_records || [])].map((record) => (
                  <a
                    key={`${record.type}-${record.id}`}
                    href={record.url}
                    className="rounded-xl border border-[var(--mhb-border-default)] p-3 text-sm font-bold text-[var(--mhb-text-link)]"
                  >
                    {record.label} · {record.type.replaceAll("_", " ")}
                  </a>
                ))}
              </div>
              <p className="mt-4 text-xs text-[var(--mhb-text-muted)]">
                {PROJECT_CAPTURE_TYPES.includes(capture.capture_type)
                  ? "No milestone was completed and no warranty, dispute, agreement, estimate, or payment record was changed."
                  : "No notifications, estimates, agreements, projects, or payments were created."}
              </p>
            </>
          ) : (
            <LoadingSkeleton theme="operational" variant="list" label="Loading application receipt" />
          )}
        </Card>
      ) : null}

      <Card theme="operational" padding="md">
        <details
          onToggle={(event) => {
            if (event.currentTarget.open) setArtifactsEnabled(true);
          }}
        >
          <summary className="flex min-h-11 cursor-pointer items-center text-lg font-black">
            Artifacts
          </summary>
          {artifacts.loading ? (
            <LoadingSkeleton theme="operational" variant="list" label="Loading Capture files" />
          ) : null}
          {artifacts.error ? (
            <InlineAlert theme="operational" tone="danger">
              {artifacts.error} <button type="button" className="underline" onClick={artifacts.reload}>Try again</button>
            </InlineAlert>
          ) : null}
          {!artifacts.loading && !artifacts.error && !artifacts.results.length ? (
            <p className="py-3 text-sm text-[var(--mhb-text-muted)]">No files are attached.</p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {artifacts.results.map((artifact) => {
              const ocr = artifact.sanitization_metadata?.ocr_text || "";
              return (
                <div key={artifact.id} className="min-w-0 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                  {artifact.mime_type?.startsWith("image/") && artifact.download_url ? (
                    <img
                      src={artifact.download_url}
                      alt={artifact.original_filename || "Capture image"}
                      loading="lazy"
                      className="mb-3 aspect-video w-full rounded-lg object-cover"
                    />
                  ) : <FileImage className="mb-3 h-8 w-8" aria-hidden="true" />}
                  <div className="truncate text-sm font-bold">{artifact.original_filename || "Artifact"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {artifact.download_url ? (
                      <a
                        href={artifact.download_url}
                        download
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--mhb-border-default)] px-3 text-sm font-bold"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" /> Download
                      </a>
                    ) : null}
                    {ocr ? (
                      <Button size="sm" variant="secondary" theme="operational" onClick={() => copyText(ocr, "OCR text")}>
                        Copy OCR
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </Card>

      <Card theme="operational" padding="md">
        <details
          onToggle={(event) => {
            if (event.currentTarget.open) setTimelineEnabled(true);
          }}
        >
          <summary className="flex min-h-11 cursor-pointer items-center text-lg font-black">
            History and Timeline
          </summary>
          {timeline.loading ? (
            <LoadingSkeleton theme="operational" variant="list" label="Loading Capture history" />
          ) : null}
          {timeline.error ? (
            <InlineAlert theme="operational" tone="danger">
              {timeline.error} <button type="button" className="underline" onClick={timeline.reload}>Try again</button>
            </InlineAlert>
          ) : null}
          <ol className="mt-3 grid gap-3" aria-label="Capture timeline">
            {timeline.results.map((event) => (
              <li key={event.id} className="border-l-2 border-[var(--mhb-border-selected)] pl-3">
                <div className="text-sm font-bold">
                  {EVENT_LABELS[event.event_type] || event.event_type?.replaceAll("_", " ")}
                </div>
                <div className="text-xs text-[var(--mhb-text-muted)]">
                  {event.actor_name || "System"} · {new Date(event.created_at).toLocaleString()}
                  {event.to_status ? ` · ${event.to_status.replaceAll("_", " ")}` : ""}
                </div>
                {event.reason ? <p className="mt-1 text-sm">{event.reason}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      </Card>

      <Card theme="operational" padding="md">
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center text-lg font-black">
            Metadata
          </summary>
          <dl className="mt-3">
            <ValueRow label="Capture ID" value={capture.id} />
            <ValueRow label="Version" value={capture.version} />
            <ValueRow label="Source" value={capture.source_detail || capture.source_category} />
            <ValueRow label="Processing engine" value={capture.processing_engine} />
            <ValueRow label="Retry count" value={capture.retry_count} />
            <ValueRow
              label="Last updated"
              value={capture.updated_at ? new Date(capture.updated_at).toLocaleString() : ""}
            />
          </dl>
        </details>
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
          {applicationEnabled && ["approved", "apply_failed"].includes(capture.status) ? (
            <Button
              variant={applicationPreview ? "secondary" : "primary"}
              theme="operational"
              loading={busy === "preview-application"}
              disabled={capture.capture_type === "quick_note" && noteDestination === "customer_note" && !selectedCustomerId}
              onClick={previewApplication}
            >
              {capture.status === "apply_failed" ? "Preview retry" : "Preview application"}
            </Button>
          ) : null}
          {applicationEnabled && applicationPreview ? (
            <Button
              theme="operational"
              loading={busy === "apply-application"}
              disabled={!applicationConfirmed}
              onClick={applyApprovedDraft}
            >
              {capture.status === "apply_failed" ? "Retry application" : "Apply approved draft"}
            </Button>
          ) : null}
          {capture.status !== "archived" ? <Button variant="ghost" theme="operational" loading={busy === "archive"} onClick={() => run("archive", () => archiveCapture(capture.id, { expected_version: capture.version, reason: "Archived from Capture review" }), "Capture archived.")}>Archive</Button> : null}
        </div>
      </div>
    </div>
  );
}
