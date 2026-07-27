import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Camera,
  ClipboardPenLine,
  FileText,
  Images,
  Lightbulb,
  MessageSquare,
  Mic,
  Receipt,
  Square,
  Ruler,
  Sparkles,
  UserRound,
} from "lucide-react";
import toast from "react-hot-toast";

import {
  createCapture,
  completeConversationalHandoff,
  createPhotoCapture,
  createProjectCapture,
  getCaptureProjectOptions,
} from "../../api/captures.js";
import { createVoiceService } from "../../lib/voiceService.js";
import { useWhoAmI } from "../../hooks/useWhoAmI.js";
import { Button, FormField, InlineAlert, Modal } from "../ui";
import ProjectAssistantSmartCapture from "../ProjectAssistantSmartCapture.jsx";
import MeasurementCaptureForm from "./MeasurementCaptureForm.jsx";
import ConversationalCapture from "./ConversationalCapture.jsx";

const EQUIPMENT_ENABLED = String(import.meta.env.VITE_CAPTURE_EQUIPMENT_ENABLED || "").toLowerCase() === "true";
const WARRANTY_ENABLED = String(import.meta.env.VITE_CAPTURE_WARRANTY_ENABLED || "").toLowerCase() === "true";
const MEASUREMENT_ENABLED = String(import.meta.env.VITE_CAPTURE_MEASUREMENT_ENABLED || "").toLowerCase() === "true";
const FIELD_FINDINGS_ENABLED = String(import.meta.env.VITE_CAPTURE_FIELD_FINDINGS_ENABLED || "").toLowerCase() === "true";
const CHANGE_REQUEST_ENABLED = String(import.meta.env.VITE_CAPTURE_CHANGE_REQUEST_ENABLED || "").toLowerCase() === "true";
const CONVERSATIONAL_ENABLED = String(import.meta.env.VITE_CAPTURE_CONVERSATIONAL_ENABLED || "").toLowerCase() === "true";

const ACTIONS = [
  { key: "lead", label: "I met someone", icon: UserRound },
  { key: "note", label: "I need to remember something", icon: ClipboardPenLine },
  { key: "photo", label: "Save a photo", icon: Camera },
  { key: "receipt", label: "Capture a receipt", icon: Receipt },
  { key: "project_update", label: "Project update", icon: ClipboardPenLine },
  { key: "progress_photo", label: "Progress photos", icon: Images },
  { key: "issue", label: "Document an issue", icon: AlertTriangle },
  { key: "communication", label: "Log a communication", icon: MessageSquare },
  { key: "document", label: "Add a project document", icon: FileText },
  ...(MEASUREMENT_ENABLED ? [{ key: "measurement", label: "Enter Measurements", icon: Ruler }] : []),
  ...(EQUIPMENT_ENABLED ? [{ key: "equipment", label: "Add Equipment", icon: Camera }] : []),
  ...(WARRANTY_ENABLED ? [
    { key: "warranty_document", label: "Save Warranty Information", icon: FileText },
    { key: "warranty_concern", label: "Report Warranty Concern", icon: AlertTriangle },
  ] : []),
];

function VoiceInput({ value, onChange, onVoiceUsed, label }) {
  const service = useMemo(() => createVoiceService(), []);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState("");

  useEffect(() => () => service.cancelListening(), [service]);

  function startVoice() {
    setVoiceError("");
    service.startListening({
      lang: "en-US",
      onStart: () => setListening(true),
      onResult: ({ transcript }) => {
        onChange(transcript);
        onVoiceUsed("en-US");
      },
      onError: () => {
        setListening(false);
        setVoiceError("Voice is unavailable. Continue by typing.");
      },
      onEnd: () => setListening(false),
    });
  }

  function stopVoice() {
    service.stopListening();
    setListening(false);
  }

  return (
    <div className="grid gap-2">
      <FormField label={label} required>
        {(fieldProps) => (
          <textarea
            {...fieldProps}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={4}
            data-testid="capture-text-input"
            className="w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 py-2 text-[var(--mhb-text-primary)] focus:border-[var(--mhb-border-focus)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
          />
        )}
      </FormField>
      <Button
        type="button"
        variant="secondary"
        theme="operational"
        onClick={listening ? stopVoice : startVoice}
        icon={listening ? Square : Mic}
        data-testid="capture-voice-toggle"
      >
        {listening ? "Stop listening" : "Use voice"}
      </Button>
      {voiceError ? (
        <InlineAlert theme="operational" tone="warning">
          {voiceError}
        </InlineAlert>
      ) : null}
    </div>
  );
}

function QuickLeadForm({ onSaved, onCancel, initialText = "" }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    text: initialText,
    notes: initialText ? "Suggested from conversational Capture. Review before saving." : "",
  });
  const [voiceLanguage, setVoiceLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...form,
        transcript: voiceLanguage ? form.text : "",
        language: voiceLanguage,
      };
      const capture = await createCapture({
        capture_type: "quick_lead",
        capture_method: voiceLanguage ? "voice_transcript" : "typed",
        raw_text_payload: payload,
      });
      onSaved(capture);
    } catch (requestError) {
      setError(
        requestError?.response?.data?.detail ||
          requestError?.response?.data?.raw_text_payload ||
          "The interaction could not be saved."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" data-testid="capture-quick-lead">
      <FormField label="Name" required>
        {(fieldProps) => (
          <input
            {...fieldProps}
            data-autofocus
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-[var(--mhb-text-primary)]"
          />
        )}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Phone" helperText="Optional">
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="tel"
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-[var(--mhb-text-primary)]"
            />
          )}
        </FormField>
        <FormField label="Email" helperText="Optional">
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="email"
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-[var(--mhb-text-primary)]"
            />
          )}
        </FormField>
      </div>
      <VoiceInput
        label="What did you discuss?"
        value={form.text}
        onChange={(value) => update("text", value)}
        onVoiceUsed={setVoiceLanguage}
      />
      <FormField label="Notes" helperText="Optional">
        {(fieldProps) => (
          <textarea
            {...fieldProps}
            value={form.notes}
            onChange={(event) => update("notes", event.target.value)}
            rows={2}
            className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 py-2 text-[var(--mhb-text-primary)]"
          />
        )}
      </FormField>
      {error ? <InlineAlert theme="operational" tone="danger">{String(error)}</InlineAlert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" theme="operational" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          theme="operational"
          loading={busy}
          disabled={!form.name.trim() || !form.text.trim()}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

function QuickNoteForm({ onSaved, onCancel }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [voiceLanguage, setVoiceLanguage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const capture = await createCapture({
        capture_type: "quick_note",
        capture_method: voiceLanguage ? "voice_transcript" : "typed",
        raw_text_payload: {
          title,
          text: note,
          transcript: voiceLanguage ? note : "",
          language: voiceLanguage,
        },
      });
      onSaved(capture);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "The note could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" data-testid="capture-quick-note">
      <FormField label="Title" helperText="Optional">
        {(fieldProps) => (
          <input
            {...fieldProps}
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 text-[var(--mhb-text-primary)]"
          />
        )}
      </FormField>
      <VoiceInput
        label="Note"
        value={note}
        onChange={setNote}
        onVoiceUsed={setVoiceLanguage}
      />
      {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" theme="operational" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" theme="operational" loading={busy} disabled={!note.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

function PhotoForm({ onSaved, onCancel }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onSaved(await createPhotoCapture(file));
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "The photo could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" data-testid="capture-photo">
      <FormField label="Photo" required>
        {(fieldProps) => (
          <input
            {...fieldProps}
            data-autofocus
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3 text-sm text-[var(--mhb-text-primary)]"
          />
        )}
      </FormField>
      {file ? <p className="text-sm text-[var(--mhb-text-secondary)]">{file.name}</p> : null}
      {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" theme="operational" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" theme="operational" loading={busy} disabled={!file}>
          Save
        </Button>
      </div>
    </form>
  );
}

const PROJECT_CAPTURE_CONFIG = {
  project_update: {
    title: "Project update",
    textLabel: "What work was completed?",
    files: "optional_photos",
  },
  progress_photo: {
    title: "Progress photos",
    textLabel: "Description",
    files: "required_photos",
  },
  issue: {
    title: "Document an issue",
    textLabel: "What needs attention?",
  },
  punch_item: {
    title: "Add Punch Items",
    textLabel: "List each closeout item on its own line",
    captureType: "issue",
    profile: "punch_item",
  },
  site_condition: {
    title: "Record Site Condition",
    textLabel: "Describe each observed condition on its own line",
    captureType: "issue",
    profile: "site_condition",
  },
  change_request: {
    title: "Request a Change",
    textLabel: "Describe the requested project change",
    captureType: "communication",
    profile: "change_request",
    files: "optional_evidence",
  },
  communication: {
    title: "Log a communication",
    textLabel: "What was discussed?",
  },
  document: {
    title: "Add a project document",
    textLabel: "Description",
    files: "required_document",
  },
  equipment: {
    title: "Add Equipment",
    textLabel: "Equipment description",
    files: "required_source",
  },
  warranty_document: {
    title: "Save Warranty Information",
    textLabel: "Warranty notes",
    files: "required_source",
  },
  warranty_concern: {
    title: "Report Warranty Concern",
    textLabel: "Describe the potential warranty concern",
    files: "required_source",
  },
};

function ProjectCaptureForm({ captureType, profile = "", initialProjectId = "", initialMilestoneId = "", initialText = "", initialFiles = [], onSaved, onCancel }) {
  const config = PROJECT_CAPTURE_CONFIG[profile || captureType];
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(String(initialProjectId || ""));
  const [milestoneId, setMilestoneId] = useState(String(initialMilestoneId || ""));
  const [agreementId, setAgreementId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState(initialFiles);
  const [customerVisible, setCustomerVisible] = useState(false);
  const [issueClassification, setIssueClassification] = useState(profile || "project_issue");
  const [communicationType, setCommunicationType] = useState("phone_call");
  const [communicationDirection, setCommunicationDirection] = useState("internal");
  const [details, setDetails] = useState({
    category: "", manufacturer: "", model: "", serial_number: "",
    installation_date: "", start_date: "", expiration_date: "", urgency: "normal",
    change_kind: "add_scope", reason: "", location_or_scope_area: "",
    requested_timing: "", known_price_expectation: "",
    known_schedule_expectation: "", decision_boundary: "change_request",
  });
  const [voiceLanguage, setVoiceLanguage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getCaptureProjectOptions()
      .then(setProjects)
      .catch(() => setError("Available projects could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const project = projects.find((row) => String(row.id) === String(projectId));
  const requiresText = ["project_update", "issue", "communication", "warranty_concern"].includes(captureType);
  const requiresFiles = ["progress_photo", "document", "equipment", "warranty_document", "warranty_concern"].includes(captureType);
  const isD2 = ["equipment", "warranty_document", "warranty_concern"].includes(captureType);
  const isChangeRequest = profile === "change_request";

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const capture = await createProjectCapture(
        {
          capture_type: captureType,
          capture_method: voiceLanguage ? "voice_transcript" : files.length ? "file_upload" : "typed",
          project_id: projectId,
          agreement_id: isChangeRequest ? agreementId : null,
          milestone_id: milestoneId || null,
          raw_text_payload: {
            title,
            text,
            transcript: voiceLanguage ? text : "",
            language: voiceLanguage,
            capture_profile: profile,
            input_metadata: {
              customer_visible: customerVisible,
              issue_classification: captureType === "issue" ? issueClassification : "",
              capture_profile: profile,
              communication_type: captureType === "communication" ? communicationType : "",
              communication_direction: captureType === "communication"
                ? communicationDirection
                : "",
              ...details,
            },
          },
        },
        files
      );
      onSaved(capture);
    } catch (requestError) {
      const payload = requestError?.response?.data;
      setError(
        payload?.detail ||
        payload?.raw_text_payload ||
        payload?.project_id ||
        "The project information could not be saved."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" data-testid={`capture-${captureType}`}>
      <FormField label="Project" required>
        {(fieldProps) => (
          <select
            {...fieldProps}
            data-autofocus
            value={projectId}
            disabled={loading}
            onChange={(event) => {
              setProjectId(event.target.value);
              setMilestoneId("");
              setAgreementId("");
            }}
            className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
          >
            <option value="">{loading ? "Loading projects…" : "Select a project"}</option>
            {projects.map((row) => (
              <option key={row.id} value={row.id}>
                {row.number} · {row.title}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {isChangeRequest ? (
        <FormField label="Agreement" required helperText="The request remains non-binding until the existing amendment workflow is completed.">
          {(fieldProps) => (
            <select
              {...fieldProps}
              value={agreementId}
              disabled={!project}
              onChange={(event) => setAgreementId(event.target.value)}
              className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
            >
              <option value="">Select an agreement</option>
              {(project?.agreements || []).map((row) => (
                <option key={row.id} value={row.id}>{row.title}</option>
              ))}
            </select>
          )}
        </FormField>
      ) : null}
      <FormField label="Milestone" helperText="Optional">
        {(fieldProps) => (
          <select
            {...fieldProps}
            value={milestoneId}
            disabled={!project}
            onChange={(event) => setMilestoneId(event.target.value)}
            className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
          >
            <option value="">No milestone</option>
            {(project?.milestones || []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}{row.completed ? " (completed)" : ""}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label="Title" helperText="Optional">
        {(fieldProps) => (
          <input
            {...fieldProps}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3"
          />
        )}
      </FormField>
      {requiresText ? (
        <VoiceInput
          label={config.textLabel}
          value={text}
          onChange={setText}
          onVoiceUsed={setVoiceLanguage}
        />
      ) : (
        <FormField label={config.textLabel} helperText="Optional">
          {(fieldProps) => (
            <textarea
              {...fieldProps}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 py-2"
            />
          )}
        </FormField>
      )}
      {captureType === "issue" && !profile ? (
        <FormField label="Issue classification" required helperText="You confirm this classification. Project Assistant does not choose it automatically.">
          {(fieldProps) => (
            <select {...fieldProps} value={issueClassification} onChange={(event) => setIssueClassification(event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
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
      {captureType === "communication" && !isChangeRequest ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Communication type" required>
            {(fieldProps) => (
              <select {...fieldProps} value={communicationType} onChange={(event) => setCommunicationType(event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
                <option value="phone_call">Phone call</option>
                <option value="in_person">On-site discussion</option>
                <option value="email">Email summary</option>
                <option value="sms">Text message</option>
                <option value="other">Crew conversation / Other</option>
              </select>
            )}
          </FormField>
          <FormField label="Direction" required>
            {(fieldProps) => (
              <select {...fieldProps} value={communicationDirection} onChange={(event) => setCommunicationDirection(event.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
                <option value="internal">Internal</option>
                <option value="inbound">Customer to company</option>
                <option value="outbound">Company to customer</option>
              </select>
            )}
          </FormField>
        </div>
      ) : null}
      {isChangeRequest ? (
        <div className="grid gap-4">
          <FormField label="Change category" required>
            {(fieldProps) => (
              <select {...fieldProps} value={details.change_kind} onChange={(event) => setDetails((value) => ({ ...value, change_kind: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
                <option value="add_scope">Add work</option>
                <option value="remove_scope">Remove work</option>
                <option value="material_substitution">Substitute material</option>
                <option value="design_change">Change design</option>
                <option value="quantity_change">Change quantity</option>
                <option value="changed_condition">Changed site condition</option>
                <option value="schedule_impact">Schedule-impacting request</option>
                <option value="access_or_sequence">Access or sequencing change</option>
                <option value="customer_revision">Customer-requested revision</option>
                <option value="contractor_scope_concern">Contractor-discovered scope concern</option>
                <option value="other">Other</option>
              </select>
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Reason" helperText="Optional">
              {(fieldProps) => <textarea {...fieldProps} rows={2} value={details.reason} onChange={(event) => setDetails((value) => ({ ...value, reason: event.target.value }))} className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 py-2" />}
            </FormField>
            <FormField label="Area or location" helperText="Optional">
              {(fieldProps) => <input {...fieldProps} value={details.location_or_scope_area} onChange={(event) => setDetails((value) => ({ ...value, location_or_scope_area: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />}
            </FormField>
            <FormField label="Requested timing" helperText="Requester input, not a promised date">
              {(fieldProps) => <input {...fieldProps} value={details.requested_timing} onChange={(event) => setDetails((value) => ({ ...value, requested_timing: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />}
            </FormField>
            <FormField label="Known price expectation" helperText="Requester assertion only">
              {(fieldProps) => <input {...fieldProps} value={details.known_price_expectation} onChange={(event) => setDetails((value) => ({ ...value, known_price_expectation: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />}
            </FormField>
          </div>
        </div>
      ) : null}
      {["equipment", "warranty_document"].includes(captureType) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {captureType === "equipment" ? (
            <FormField label="Equipment category" required>
              {(fieldProps) => <input {...fieldProps} value={details.category} onChange={(event) => setDetails((value) => ({ ...value, category: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />}
            </FormField>
          ) : null}
          {["manufacturer", "model", "serial_number"].map((field) => (
            <FormField key={field} label={field === "serial_number" ? "Serial number" : field[0].toUpperCase() + field.slice(1)} helperText="Editable during review">
              {(fieldProps) => <input {...fieldProps} value={details[field]} onChange={(event) => setDetails((value) => ({ ...value, [field]: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />}
            </FormField>
          ))}
          <FormField label="Installation date" helperText="Optional">
            {(fieldProps) => <input {...fieldProps} type="date" value={details.installation_date} onChange={(event) => setDetails((value) => ({ ...value, installation_date: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />}
          </FormField>
        </div>
      ) : null}
      {captureType === "warranty_document" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {["start_date", "expiration_date"].map((field) => (
            <FormField key={field} label={field === "start_date" ? "Warranty start" : "Warranty expiration"} helperText="Optional">
              {(fieldProps) => <input {...fieldProps} type="date" value={details[field]} onChange={(event) => setDetails((value) => ({ ...value, [field]: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />}
            </FormField>
          ))}
        </div>
      ) : null}
      {captureType === "warranty_concern" ? (
        <FormField label="Urgency" required>
          {(fieldProps) => (
            <select {...fieldProps} value={details.urgency} onChange={(event) => setDetails((value) => ({ ...value, urgency: event.target.value }))} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
              <option value="low">Low</option><option value="normal">Normal</option>
              <option value="high">High</option><option value="critical">Critical</option>
            </select>
          )}
        </FormField>
      ) : null}
      {config.files ? (
        <FormField
          label={["required_document", "required_source", "optional_evidence"].includes(config.files) ? "Photos or documents" : "Photos"}
          required={requiresFiles}
          helperText={config.files === "optional_photos" ? "Optional" : "Up to 10 files"}
        >
          {(fieldProps) => (
            <input
              {...fieldProps}
              type="file"
              multiple={config.files !== "required_document"}
              accept={["required_document", "required_source", "optional_evidence"].includes(config.files) ? ".pdf,.jpg,.jpeg,.png,.webp,.txt" : "image/*"}
              capture={["required_document", "required_source", "optional_evidence"].includes(config.files) ? undefined : "environment"}
              onChange={(event) => setFiles(Array.from(event.target.files || []))}
              className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3"
            />
          )}
        </FormField>
      ) : null}
      {["project_update", "progress_photo", "document", "equipment", "warranty_document"].includes(captureType) ? (
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={customerVisible}
            onChange={(event) => setCustomerVisible(event.target.checked)}
            className="mt-1"
          />
          Make the applied update and files visible in the Customer Portal
        </label>
      ) : null}
      <InlineAlert theme="operational" tone={isChangeRequest ? "warning" : "info"}>
        {isChangeRequest
          ? "This prepares a change request for review. It does not change the agreement, approve pricing, or authorize work."
          : isD2
          ? "This saves a review draft. It does not decide warranty coverage, authorize repair, or publish anything."
          : "This saves a Capture for review. It does not complete a milestone or publish anything yet."}
      </InlineAlert>
      {error ? <InlineAlert theme="operational" tone="danger">{String(error)}</InlineAlert> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" theme="operational" onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          theme="operational"
          loading={busy}
          disabled={!projectId || (isChangeRequest && !agreementId) || (requiresText && !text.trim()) || (requiresFiles && !files.length) || (captureType === "equipment" && !details.category.trim())}
        >
          Save for review
        </Button>
      </div>
    </form>
  );
}

export default function CaptureLauncher() {
  const { data: identity, loading } = useWhoAmI();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("");
  const [context, setContext] = useState({});

  useEffect(() => {
    function openCapture(event) {
      const requested = String(event.detail?.mode || "");
      if (
        ACTIONS.some((action) => action.key === requested)
        || (CONVERSATIONAL_ENABLED && requested === "conversational")
        || (FIELD_FINDINGS_ENABLED && ["punch_item", "site_condition"].includes(requested))
        || (CHANGE_REQUEST_ENABLED && requested === "change_request")
      ) {
        setContext(event.detail || {});
        setMode(requested);
        setOpen(true);
      }
    }
    window.addEventListener("mhb:open-capture", openCapture);
    return () => window.removeEventListener("mhb:open-capture", openCapture);
  }, []);

  function close() {
    setOpen(false);
    setMode("");
    setContext({});
  }

  async function saved(capture) {
    if (context.routingAttemptId && capture?.id) {
      try {
        await completeConversationalHandoff({
          attempt_id: context.routingAttemptId,
          capture_id: capture.id,
        });
      } catch {
        toast.error("Capture saved, but its conversational routing link needs review.");
      }
    }
    window.dispatchEvent(new CustomEvent("mhb:capture-saved", { detail: capture }));
    toast.success("Capture saved.");
    close();
  }

  const title =
    (mode === "conversational" ? "What happened?" : "")
    ||
    ACTIONS.find((action) => action.key === mode)?.label
    || PROJECT_CAPTURE_CONFIG[mode]?.title
    || "Capture";
  const role = String(identity?.type || identity?.role || "").toLowerCase();

  if (loading || !["contractor", "contractor_owner", "subaccount"].includes(role)) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        theme="operational"
        size="sm"
          icon={Camera}
        onClick={() => setOpen(true)}
        data-testid="global-capture-trigger"
      >
        <span className="hidden sm:inline">Capture</span>
      </Button>
      <Modal
        visible={open}
        title={title}
        onClose={close}
        testId="capture-launcher"
        overlayClassName="items-end sm:items-center"
        containerClassName="h-[100dvh] max-h-[100dvh] bg-[var(--mhb-surface-card-elevated)] text-[var(--mhb-text-primary)] sm:mx-4 sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl"
        bodyClassName="h-[calc(100dvh-3.75rem)] overflow-y-auto p-4 sm:h-auto sm:max-h-[calc(90vh-3.75rem)] sm:p-5"
      >
        {!mode ? (
          <div className="grid gap-3" data-testid="capture-launcher-actions">
            {CONVERSATIONAL_ENABLED ? (
              <button
                type="button"
                onClick={() => setMode("conversational")}
                className="flex min-h-16 items-center gap-3 rounded-xl border border-blue-500/50 bg-blue-500/10 px-4 text-left font-bold text-[var(--mhb-text-primary)] hover:bg-blue-500/15 focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
                data-testid="capture-action-conversational"
              >
                <Sparkles className="h-5 w-5 text-blue-500" aria-hidden="true" />
                <span>
                  <span className="block">What happened?</span>
                  <span className="mt-1 block text-sm font-normal text-[var(--mhb-text-secondary)]">
                    Describe it and Project Assistant will suggest the right Capture.
                  </span>
                </span>
              </button>
            ) : null}
            {ACTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className="flex min-h-14 items-center gap-3 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-interactive)] px-4 text-left font-bold text-[var(--mhb-text-primary)] hover:bg-[var(--mhb-surface-interactive-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--mhb-border-focus)]"
                data-testid={`capture-action-${key}`}
              >
                <Icon className="h-5 w-5 text-blue-500" aria-hidden="true" />
                {label}
              </button>
            ))}
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-[var(--mhb-text-muted)]">
              <Lightbulb className="h-4 w-4" aria-hidden="true" />
              More coming soon
            </div>
          </div>
        ) : null}
        {mode === "conversational" ? (
          <ConversationalCapture
            context={context}
            onSaved={saved}
            onCancel={close}
            onChooseExplicit={() => setMode("")}
            onHandoff={(handoff) => {
              setContext((current) => ({
                ...current,
                projectId: handoff.project_id || current.projectId,
                milestoneId: handoff.milestone_id || current.milestoneId,
                agreementId: handoff.agreement_id || current.agreementId,
                dimensions: handoff.dimensions || null,
                sourceText: handoff.source_text || current.sourceText || "",
                files: handoff.files || current.files || [],
                routingAttemptId: handoff.routing_attempt_id || "",
              }));
              setMode({
                quick_lead: "lead",
                manual_measurement: "measurement",
                equipment: "equipment",
                warranty_document: "warranty_document",
                warranty_concern: "warranty_concern",
              }[handoff.profile_key] || "");
            }}
          />
        ) : null}
        {mode === "lead" ? <QuickLeadForm onSaved={saved} onCancel={close} initialText={context.sourceText || ""} /> : null}
        {mode === "note" ? <QuickNoteForm onSaved={saved} onCancel={close} /> : null}
        {mode === "photo" ? <PhotoForm onSaved={saved} onCancel={close} /> : null}
        {mode === "receipt" ? <ProjectAssistantSmartCapture compact /> : null}
        {mode === "measurement" ? <MeasurementCaptureForm onSaved={saved} onCancel={close} initialProjectId={context.projectId || ""} initialDimensions={context.dimensions || null} initialSourceText={context.sourceText || ""} initialFiles={context.files || []} /> : null}
        {PROJECT_CAPTURE_CONFIG[mode] ? (
          <ProjectCaptureForm
            captureType={PROJECT_CAPTURE_CONFIG[mode].captureType || mode}
            profile={PROJECT_CAPTURE_CONFIG[mode].profile || ""}
            initialProjectId={context.projectId || ""}
            initialMilestoneId={context.milestoneId || ""}
            initialText={context.sourceText || ""}
            initialFiles={context.files || []}
            onSaved={saved}
            onCancel={close}
          />
        ) : null}
      </Modal>
    </>
  );
}
