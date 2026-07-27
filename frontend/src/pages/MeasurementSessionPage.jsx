import React, { useEffect, useState } from "react";
import { ArrowLeft, Camera, FileUp, Ruler } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  createPlanDocument,
  createPlanDocumentFromArtifact,
  createPhotoMeasurementDocument,
  createPhotoMeasurementDocumentFromArtifact,
  getCaptureArtifacts,
  getMeasurementSession,
} from "../api/captures.js";
import { InlineAlert } from "../components/ui";
import CreateTakeoffModal from "../components/takeoff/CreateTakeoffModal.jsx";

function friendly(value) {
  return String(value || "").replaceAll("_", " ");
}

export default function MeasurementSessionPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [takeoffOpen, setTakeoffOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [availablePlans, setAvailablePlans] = useState([]);
  const [availablePhotos, setAvailablePhotos] = useState([]);
  const takeoffEnabled = String(import.meta.env.VITE_TAKEOFF_ENABLED || "").toLowerCase() === "true";
  const pdfMeasurementEnabled = String(import.meta.env.VITE_MEASUREMENT_PDF_ENABLED || "").toLowerCase() === "true";
  const photoMeasurementEnabled = String(import.meta.env.VITE_MEASUREMENT_PHOTO_ASSISTED_ENABLED || "").toLowerCase() === "true";

  useEffect(() => {
    if (!pdfMeasurementEnabled || !session?.source_capture_id) return;
    const associated = new Set((session.plan_documents || []).map((item) => String(item.artifact_id)));
    getCaptureArtifacts(session.source_capture_id)
      .then((rows) => setAvailablePlans((Array.isArray(rows) ? rows : rows?.results || []).filter((item) => item.mime_type === "application/pdf" && !associated.has(String(item.id)))))
      .catch(() => setAvailablePlans([]));
  }, [pdfMeasurementEnabled, session?.source_capture_id]);

  useEffect(() => {
    if (!photoMeasurementEnabled || !session?.source_capture_id) return;
    const associated = new Set((session.photo_documents || []).map((item) => String(item.artifact_id)));
    getCaptureArtifacts(session.source_capture_id)
      .then((rows) => setAvailablePhotos((Array.isArray(rows) ? rows : rows?.results || []).filter((item) => ["image/jpeg", "image/png", "image/webp"].includes(item.mime_type) && !associated.has(String(item.id)))))
      .catch(() => setAvailablePhotos([]));
  }, [photoMeasurementEnabled, session?.source_capture_id]);

  async function uploadPlan(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPlanBusy(true);
    setError("");
    try {
      const document = await createPlanDocument(sessionId, file);
      navigate(`/app/measurements/${sessionId}/plans/${document.id}`);
    } catch (reason) {
      setError(reason?.response?.data?.detail || Object.values(reason?.response?.data || {})?.[0] || "The PDF could not be uploaded.");
    } finally {
      setPlanBusy(false);
      event.target.value = "";
    }
  }

  async function selectPlanArtifact(artifactId) {
    setPlanBusy(true);
    setError("");
    try {
      const document = await createPlanDocumentFromArtifact(sessionId, artifactId);
      navigate(`/app/measurements/${sessionId}/plans/${document.id}`);
    } catch (reason) {
      setError(reason?.response?.data?.detail || Object.values(reason?.response?.data || {})?.[0] || "The PDF could not be selected.");
    } finally {
      setPlanBusy(false);
    }
  }

  async function openPhoto(file, artifactId) {
    setPlanBusy(true);
    setError("");
    try {
      const document = artifactId
        ? await createPhotoMeasurementDocumentFromArtifact(sessionId, artifactId)
        : await createPhotoMeasurementDocument(sessionId, file);
      navigate(`/app/measurements/${sessionId}/photos/${document.id}`);
    } catch (reason) {
      setError(reason?.response?.data?.detail || Object.values(reason?.response?.data || {})?.[0] || "The photo could not be prepared.");
    } finally {
      setPlanBusy(false);
    }
  }

  useEffect(() => {
    getMeasurementSession(sessionId).then(setSession).catch((reason) => setError(reason?.response?.data?.detail || "Measurement session could not be loaded."));
  }, [sessionId]);

  if (error) return <div className="p-4 sm:p-6"><InlineAlert theme="operational" tone="danger">{error}</InlineAlert></div>;
  if (!session) return <div className="p-6 text-[var(--mhb-text-muted)]">Loading measurement session…</div>;

  return (
    <main className="min-w-0 p-4 sm:p-6" data-testid="measurement-session-page">
      <Link to={`/app/capture/${session.source_capture_id}`} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-blue-400"><ArrowLeft size={17} /> Source Capture receipt</Link>
      <header className="mb-5">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--mhb-text-muted)]">Measurement session</div>
        <h1 className="mt-1 text-2xl font-bold">{session.room_name}</h1>
        <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">{session.project_title} · {friendly(session.purpose)} · Version {session.version}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {pdfMeasurementEnabled ? <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] px-4 font-bold"><FileUp size={18} />{planBusy ? "Uploading…" : "Measure from Plan"}<input type="file" accept="application/pdf,.pdf" className="sr-only" disabled={planBusy} onChange={uploadPlan} data-testid="measure-from-plan-input" /></label> : null}
          {photoMeasurementEnabled ? <><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] px-4 font-bold"><Camera size={18} />Take Photo<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={planBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) openPhoto(file); event.target.value = ""; }} data-testid="measure-from-camera-input" /></label><label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] px-4 font-bold"><FileUp size={18} />Upload Photo<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={planBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) openPhoto(file); event.target.value = ""; }} data-testid="measure-from-photo-input" /></label></> : null}
          {takeoffEnabled ? <button type="button" onClick={() => setTakeoffOpen(true)} className="min-h-11 rounded-xl bg-[var(--mhb-interaction-primary)] px-4 font-bold text-white" data-testid="create-takeoff">Create Takeoff</button> : null}
        </div>
      </header>
      <InlineAlert theme="operational" tone={session.status === "confirmed" ? "success" : "warning"}>
        Status: {friendly(session.status)}. Calculations cannot be more reliable than their least-trusted input.
      </InlineAlert>
      <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-2">
        {pdfMeasurementEnabled && session.plan_documents?.length ? <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4 lg:col-span-2">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><FileUp size={19} /> Plans</h2>
          <div className="grid gap-2 sm:grid-cols-2">{session.plan_documents.map((document) => <Link key={document.id} to={`/app/measurements/${sessionId}/plans/${document.id}`} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3 font-bold text-blue-400">{document.original_filename} · {document.page_count} page(s)</Link>)}</div>
        </section> : null}
        {pdfMeasurementEnabled && availablePlans.length ? <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4 lg:col-span-2">
          <h2 className="mb-3 text-lg font-bold">Available PDF artifacts</h2>
          <div className="grid gap-2 sm:grid-cols-2">{availablePlans.map((artifact) => <button key={artifact.id} type="button" disabled={planBusy} onClick={() => selectPlanArtifact(artifact.id)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3 text-left font-bold text-blue-400 disabled:opacity-60">Measure {artifact.original_filename}</button>)}</div>
        </section> : null}
        {photoMeasurementEnabled && session.photo_documents?.length ? <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4 lg:col-span-2"><h2 className="mb-3 text-lg font-bold">Photo measurements</h2><div className="grid gap-2 sm:grid-cols-2">{session.photo_documents.map((document) => <Link key={document.id} to={`/app/measurements/${sessionId}/photos/${document.id}`} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3 font-bold text-blue-400">{document.original_filename}</Link>)}</div></section> : null}
        {photoMeasurementEnabled && availablePhotos.length ? <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4 lg:col-span-2"><h2 className="mb-3 text-lg font-bold">Available photo artifacts</h2><div className="grid gap-2 sm:grid-cols-2">{availablePhotos.map((artifact) => <button key={artifact.id} type="button" disabled={planBusy} onClick={() => openPhoto(null, artifact.id)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3 text-left font-bold text-blue-400">Measure {artifact.original_filename}</button>)}</div></section> : null}
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Ruler size={19} /> Readings</h2>
          <div className="grid gap-3">
            {session.entries.map((entry) => (
              <article key={entry.id} className="min-w-0 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                <div className="flex flex-wrap justify-between gap-2"><strong>{entry.label}</strong><span className="rounded-full border border-[var(--mhb-border-default)] px-2 py-0.5 text-xs font-bold">{friendly(entry.verification_status)}</span></div>
                <div className="mt-1 break-words text-lg">{entry.raw_value}</div>
                <div className="mt-1 text-xs text-[var(--mhb-text-muted)]">{friendly(entry.dimension_type)} · {friendly(entry.source_method)} · {entry.measured_by_name || "Unknown"} · {new Date(entry.measured_at).toLocaleString()}</div>
              </article>
            ))}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 text-lg font-bold">Deterministic calculations</h2>
          <div className="grid gap-3">
            {session.calculated_results.map((result) => (
              <article key={result.id} className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
                <div className="flex flex-wrap justify-between gap-2"><strong>{result.label}</strong><span>{result.display_value} {friendly(result.display_unit)}</span></div>
                <div className="mt-1 text-xs text-[var(--mhb-text-muted)]">{result.formula_key} · calculation v{result.calculation_version} · {friendly(result.verification_status)}</div>
                <div className="mt-1 break-all text-xs text-[var(--mhb-text-muted)]">Inputs: {result.source_entry_keys.join(", ")}</div>
              </article>
            ))}
            {!session.calculated_results.length ? <p className="text-sm text-[var(--mhb-text-muted)]">No complete guided calculation is available yet.</p> : null}
          </div>
        </section>
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Camera size={19} /> Photos and annotations</h2>
          {session.attachments.length ? session.attachments.map((attachment) => <a key={attachment.id} href={attachment.download_url} className="block min-h-11 break-words text-blue-400">{attachment.filename} · {attachment.annotations.length} annotation(s)</a>) : <p className="text-sm text-[var(--mhb-text-muted)]">No reference photos attached.</p>}
        </section>
        <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-3 text-lg font-bold">Revision history</h2>
          <ol className="grid gap-2 text-sm">{session.events.map((event) => <li key={event.id}><strong>{friendly(event.event_type)}</strong> · v{event.session_version} · {event.actor_name} · {new Date(event.created_at).toLocaleString()}</li>)}</ol>
        </section>
      </div>
      {takeoffEnabled ? <CreateTakeoffModal measurement={session} visible={takeoffOpen} onClose={() => setTakeoffOpen(false)} /> : null}
    </main>
  );
}
