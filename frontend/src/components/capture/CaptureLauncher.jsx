import React, { useEffect, useMemo, useState } from "react";
import {
  Camera,
  ClipboardPenLine,
  Lightbulb,
  Mic,
  Receipt,
  Square,
  UserRound,
} from "lucide-react";
import toast from "react-hot-toast";

import { createCapture, createPhotoCapture } from "../../api/captures.js";
import { createVoiceService } from "../../lib/voiceService.js";
import { useWhoAmI } from "../../hooks/useWhoAmI.js";
import { Button, FormField, InlineAlert, Modal } from "../ui";
import ProjectAssistantSmartCapture from "../ProjectAssistantSmartCapture.jsx";

const ACTIONS = [
  { key: "lead", label: "I met someone", icon: UserRound },
  { key: "note", label: "I need to remember something", icon: ClipboardPenLine },
  { key: "photo", label: "Save a photo", icon: Camera },
  { key: "receipt", label: "Capture a receipt", icon: Receipt },
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

function QuickLeadForm({ onSaved, onCancel }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    text: "",
    notes: "",
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

export default function CaptureLauncher() {
  const { data: identity, loading } = useWhoAmI();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("");

  function close() {
    setOpen(false);
    setMode("");
  }

  function saved(capture) {
    window.dispatchEvent(new CustomEvent("mhb:capture-saved", { detail: capture }));
    toast.success("Capture saved.");
    close();
  }

  const title =
    ACTIONS.find((action) => action.key === mode)?.label || "Capture";
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
        {mode === "lead" ? <QuickLeadForm onSaved={saved} onCancel={close} /> : null}
        {mode === "note" ? <QuickNoteForm onSaved={saved} onCancel={close} /> : null}
        {mode === "photo" ? <PhotoForm onSaved={saved} onCancel={close} /> : null}
        {mode === "receipt" ? <ProjectAssistantSmartCapture compact /> : null}
      </Modal>
    </>
  );
}
