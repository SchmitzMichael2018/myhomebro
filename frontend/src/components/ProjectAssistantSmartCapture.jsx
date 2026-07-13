import React, { useEffect, useMemo, useState } from "react";
import { Camera, FileImage, RotateCcw, ShieldCheck, Upload, X } from "lucide-react";

import api from "../api.js";
import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantCard,
  ProjectAssistantMissingInfoList,
  ProjectAssistantSection,
} from "./ProjectAssistantExperience.jsx";
import {
  CUSTOMER_SMART_CAPTURE_TYPES,
  SMART_CAPTURE_TYPES,
  smartCaptureApprovalSummary,
  smartCaptureFieldsForType,
  smartCaptureStatusLabel,
  smartCaptureTypeLabel,
} from "../lib/projectAssistantSmartCapture.js";

function FieldConfidence({ value }) {
  const label = String(value || "needs_review").replaceAll("_", " ");
  const tone = value === "confirmed" || value === "high_confidence" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-amber-50 text-amber-900 border-amber-200";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${tone}`}>{label}</span>;
}

function updatePayloadValue(setDraft, key, value) {
  setDraft((current) => ({ ...current, [key]: value }));
}

export default function ProjectAssistantSmartCapture({
  compact = false,
  mode = "contractor",
  endpoints = null,
  propertyOptions = [],
  defaultPropertyId = "",
  onComplete,
}) {
  const customerMode = mode === "customer";
  const typeOptions = customerMode ? CUSTOMER_SMART_CAPTURE_TYPES : SMART_CAPTURE_TYPES;
  const defaultCaptureType = customerMode ? "home_system_label" : "receipt";
  const [captureType, setCaptureType] = useState(defaultCaptureType);
  const [propertyId, setPropertyId] = useState(defaultPropertyId || propertyOptions[0]?.id || "");
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [session, setSession] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fields = useMemo(() => smartCaptureFieldsForType(session?.capture_type || captureType), [session?.capture_type, captureType]);
  const approvalSummary = smartCaptureApprovalSummary(session || {});
  const apiEndpoints = {
    create: endpoints?.create || "/projects/project-assistant/smart-capture/sessions/",
    detail: endpoints?.detail || ((id) => `/projects/project-assistant/smart-capture/sessions/${id}/`),
    retry: endpoints?.retry || ((id) => `/projects/project-assistant/smart-capture/sessions/${id}/retry/`),
    approve: endpoints?.approve || ((id) => `/projects/project-assistant/smart-capture/sessions/${id}/approve/`),
    cancel: endpoints?.cancel || ((id) => `/projects/project-assistant/smart-capture/sessions/${id}/cancel/`),
  };

  useEffect(() => {
    if (!customerMode || propertyId) return;
    const nextId = defaultPropertyId || propertyOptions[0]?.id || "";
    if (nextId) setPropertyId(nextId);
  }, [customerMode, defaultPropertyId, propertyId, propertyOptions]);

  function selectFile(nextFile) {
    setFile(nextFile || null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(nextFile && nextFile.type?.startsWith("image/") ? URL.createObjectURL(nextFile) : "");
  }

  async function uploadCapture(event) {
    event?.preventDefault?.();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("capture_type", captureType);
      if (customerMode) form.append("property_id", propertyId || "");
      form.append("file", file);
      const response = await api.post(apiEndpoints.create, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSession(response.data);
      setDraft(response.data.structured_payload || {});
    } catch (err) {
      setError(err?.response?.data?.detail || "Smart Capture could not process this file.");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!session?.id) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.patch(apiEndpoints.detail(session.id), {
        structured_payload: customerMode ? { ...draft, property_id: propertyId || draft.property_id } : draft,
      });
      setSession(response.data);
      setDraft(response.data.structured_payload || {});
    } catch (err) {
      setError(err?.response?.data?.detail || "Smart Capture could not save your edits.");
    } finally {
      setBusy(false);
    }
  }

  async function approveCapture() {
    if (!session?.id) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post(apiEndpoints.approve(session.id), {
        structured_payload: customerMode ? { ...draft, property_id: propertyId || draft.property_id } : draft,
      });
      setSession(response.data);
      setDraft(response.data.structured_payload || {});
      onComplete?.(response.data);
    } catch (err) {
      const nextSession = err?.response?.data?.session;
      if (nextSession) {
        setSession(nextSession);
        setDraft(nextSession.structured_payload || {});
      }
      setError(err?.response?.data?.detail || "Smart Capture could not approve this draft.");
    } finally {
      setBusy(false);
    }
  }

  async function retryExtraction() {
    if (!session?.id) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.post(apiEndpoints.retry(session.id), {});
      setSession(response.data);
      setDraft(response.data.structured_payload || {});
    } catch (err) {
      setError(err?.response?.data?.detail || "Smart Capture could not retry extraction.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelCapture() {
    if (!session?.id) {
      setSession(null);
      setDraft({});
      selectFile(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await api.post(apiEndpoints.cancel(session.id), {});
      setSession(response.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Smart Capture could not cancel this session.");
    } finally {
      setBusy(false);
    }
  }

  const completed = session?.status === "completed";
  const cancelled = session?.status === "cancelled";
  const sourceUrl = previewUrl || session?.source_url || "";

  return (
    <ProjectAssistantSection title="Smart Capture" testId="project-assistant-smart-capture">
      <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]"}`}>
        <form onSubmit={uploadCapture} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="smart-capture-upload-form">
          <div className="flex items-center gap-2 text-sm font-black text-slate-950">
            <Camera className="h-4 w-4" />
            {customerMode ? "Add to My Home" : "Scan or upload a business record"}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(typeOptions).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCaptureType(key)}
                className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-black ${captureType === key ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200 bg-white text-slate-700"}`}
                data-testid={`smart-capture-type-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
          {customerMode ? (
            <label className="grid gap-1 text-sm font-semibold text-slate-700">
              Save to property
              <select
                value={propertyId || ""}
                onChange={(event) => setPropertyId(event.target.value)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-3 text-sm font-normal"
                data-testid="smart-capture-property-select"
              >
                <option value="">Choose property</option>
                {propertyOptions.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.display_name || property.address || `Property #${property.id}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="grid min-h-[132px] cursor-pointer place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-semibold text-slate-700" data-testid="smart-capture-dropzone">
            <FileImage className="mb-2 h-7 w-7 text-slate-400" />
            <span>{file ? file.name : "Upload Existing Photo or Take Photo"}</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="sr-only"
              onChange={(event) => selectFile(event.target.files?.[0])}
              data-testid="smart-capture-file-input"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !file || (customerMode && !propertyId)}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
            data-testid="smart-capture-upload"
          >
            <Upload className="h-4 w-4" />
            {busy ? "Processing..." : "Extract Fields"}
          </button>
        </form>

        <div className="grid gap-3">
          {error ? (
            <ProjectAssistantCard title="Smart Capture needs attention" tone="danger" testId="smart-capture-error">
              {error}
            </ProjectAssistantCard>
          ) : null}

          {session ? (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4" data-testid="smart-capture-review">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-950">{smartCaptureTypeLabel(session.capture_type)}</div>
                  <div className="mt-1 text-xs font-black text-slate-500">{smartCaptureStatusLabel(session.status)}</div>
                </div>
                <div className="text-xs font-semibold text-slate-500">{session.original_filename}</div>
              </div>

              {session.billable_price ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="smart-capture-price-disclosure">
                  Smart Capture extraction: ${session.billable_price}. You will only be charged after a successful extraction.
                </div>
              ) : null}

              {customerMode ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950" data-testid="smart-capture-property-destination">
                  Save to: {propertyOptions.find((property) => String(property.id) === String(propertyId || draft.property_id))?.address || propertyOptions.find((property) => String(property.id) === String(propertyId || draft.property_id))?.display_name || "Choose a property"}
                </div>
              ) : null}

              {sourceUrl ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50" data-testid="smart-capture-image-preview">
                  {String(session.mime_type || file?.type || "").includes("pdf") ? (
                    <div className="p-4 text-sm font-semibold text-slate-700">PDF uploaded: {session.original_filename || file?.name}</div>
                  ) : (
                    <img src={sourceUrl} alt="Smart Capture source preview" className="max-h-72 w-full object-contain" />
                  )}
                </div>
              ) : null}

              <ProjectAssistantMissingInfoList items={session.missing_fields || []} empty="No required fields are missing." />

              <div className="grid gap-3 sm:grid-cols-2" data-testid="smart-capture-fields">
                {fields.map(([key, label]) => (
                  <label key={key} className={key === "notes" ? "grid gap-1 text-sm font-semibold text-slate-700 sm:col-span-2" : "grid gap-1 text-sm font-semibold text-slate-700"}>
                    <span className="flex items-center justify-between gap-2">
                      {label}
                      <FieldConfidence value={session.field_confidence?.[key]} />
                    </span>
                    {key === "notes" ? (
                      <textarea
                        value={draft[key] || ""}
                        onChange={(event) => updatePayloadValue(setDraft, key, event.target.value)}
                        rows={3}
                        className="min-h-[88px] rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal"
                        data-testid={`smart-capture-field-${key}`}
                      />
                    ) : (
                      <input
                        value={draft[key] || ""}
                        onChange={(event) => updatePayloadValue(setDraft, key, event.target.value)}
                        className="min-h-[44px] rounded-lg border border-slate-200 px-3 text-sm font-normal"
                        data-testid={`smart-capture-field-${key}`}
                      />
                    )}
                  </label>
                ))}
              </div>

              {session.warnings?.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="smart-capture-warnings">
                  {session.warnings.join(" ")}
                </div>
              ) : null}

              {session.possible_matches?.length ? (
                <div className="grid gap-2" data-testid="smart-capture-matches">
                  {session.possible_matches.map((match) => (
                    <div key={`${match.type}-${match.id}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                      <div className="font-black text-slate-900">{match.label}</div>
                      <div className="mt-1 text-slate-600">{match.reason}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              <ProjectAssistantApprovalNotice compact>
                Nothing will be created from this scan until you approve the reviewed fields on screen.
              </ProjectAssistantApprovalNotice>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-950" data-testid="smart-capture-approval-summary">
                  <div className="font-black">If you approve:</div>
                <ul className="mt-1 grid gap-1">
                  {approvalSummary.map((item) => <li key={item}>- {item}</li>)}
                </ul>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={saveDraft}
                  disabled={busy || completed || cancelled}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
                  data-testid="smart-capture-save-draft"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={retryExtraction}
                  disabled={busy || completed || cancelled}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
                  data-testid="smart-capture-retry"
                >
                  <RotateCcw className="h-4 w-4" />
                  Retry Extraction
                </button>
                <button
                  type="button"
                  onClick={approveCapture}
                  disabled={busy || completed || cancelled}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
                  data-testid="smart-capture-approve"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Review & Save
                </button>
                <button
                  type="button"
                  onClick={cancelCapture}
                  disabled={busy || completed || cancelled}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
                  data-testid="smart-capture-cancel"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
              </div>

              {completed ? (
                <ProjectAssistantCard title="Smart Capture saved" tone="success" testId="smart-capture-completed">
                  Created record: {session.created_property_intelligence_record ? `Home record #${session.created_property_intelligence_record}` : session.created_expense ? `Expense #${session.created_expense}` : session.created_asset ? `Asset #${session.created_asset}` : `Property record #${session.created_property_record}`}.
                </ProjectAssistantCard>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600" data-testid="smart-capture-empty">
              {customerMode ? "Upload a label, receipt, warranty, manual, or home photo to prepare an editable home record draft. Manual entry remains available." : "Upload a receipt or product label to prepare an editable draft. Manual entry remains available in the normal workspace."}
            </div>
          )}
        </div>
      </div>
    </ProjectAssistantSection>
  );
}
