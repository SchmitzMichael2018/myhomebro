import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, Crosshair, Hash,
  Minus, MousePointer2, Move, Pentagon, Plus, RotateCcw, Save, Trash2, Undo2,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

import {
  actOnPlanAnnotation,
  createPlanAnnotation,
  createPlanCalibration,
  getPlanDocument,
  getPlanPdfData,
} from "../api/captures.js";
import { Button, InlineAlert, LoadingSkeleton } from "../components/ui";
import { canonicalToSvg, pointerToCanonical } from "../lib/pdfCoordinates.js";

GlobalWorkerOptions.workerSrc = workerUrl;

const TOOLS = [
  ["select", "Select", MousePointer2],
  ["pan", "Pan", Move],
  ["scale", "Set scale", Crosshair],
  ["line", "Line", Minus],
  ["polyline", "Polyline", RotateCcw],
  ["polygon", "Polygon", Pentagon],
  ["count", "Count", Hash],
];

function errorText(error, fallback) {
  return error?.response?.data?.detail || Object.values(error?.response?.data || {})?.[0] || fallback;
}

function displayResult(annotation) {
  if (annotation.annotation_type === "polygon" && annotation.perimeter_value) {
    return `${annotation.normalized_value} ${annotation.normalized_unit}; perimeter ${annotation.perimeter_value} ${annotation.calibration_unit || ""}`;
  }
  return `${annotation.normalized_value} ${annotation.normalized_unit}`;
}

export default function PlanMeasurementWorkspacePage() {
  const { sessionId, documentId } = useParams();
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const renderTaskRef = useRef(null);
  const pdfRef = useRef(null);
  const [document, setDocument] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInfo, setPageInfo] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState("select");
  const [points, setPoints] = useState([]);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [knownLength, setKnownLength] = useState("");
  const [unit, setUnit] = useState("feet");
  const [activeCalibration, setActiveCalibration] = useState("");
  const [statusText, setStatusText] = useState("Loading plan.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const next = await getPlanDocument(documentId);
    setDocument(next);
    const available = next.calibrations.find((item) => !item.invalidated_at && item.page_number === pageNumber);
    setActiveCalibration((current) => current || (available ? String(available.id) : ""));
    return next;
  }, [documentId, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [metadata, data] = await Promise.all([reload(), getPlanPdfData(documentId)]);
        if (cancelled) return;
        const task = getDocument({ data, isEvalSupported: false, disableAutoFetch: true });
        const pdf = await task.promise;
        if (pdf.numPages !== metadata.page_count) throw new Error("The plan page count changed.");
        pdfRef.current = pdf;
        setStatusText(`Page 1 of ${pdf.numPages} loaded.`);
      } catch (reason) {
        setError(errorText(reason, reason?.name === "PasswordException" ? "Password-protected PDFs are not supported." : "The PDF could not be opened."));
      }
    }
    load();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      pdfRef.current?.destroy();
    };
  }, [documentId, reload]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!pdfRef.current || !canvasRef.current) return;
      renderTaskRef.current?.cancel();
      const page = await pdfRef.current.getPage(pageNumber);
      if (cancelled) return;
      const rotation = page.rotate || 0;
      const base = page.getViewport({ scale: 1, rotation });
      const safeScale = Math.min(zoom, 4096 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: safeScale, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setPageInfo({
        width: viewport.width,
        height: viewport.height,
        rotation,
        pageBox: {
          x: String(page.view[0]), y: String(page.view[1]),
          width: String(page.view[2] - page.view[0]), height: String(page.view[3] - page.view[1]),
        },
      });
      const task = page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
        annotationMode: 0,
      });
      renderTaskRef.current = task;
      try {
        await task.promise;
        if (!cancelled) setStatusText(`Page ${pageNumber} of ${pdfRef.current.numPages} rendered.`);
      } catch (reason) {
        if (reason?.name !== "RenderingCancelledException") setError("The PDF page could not be rendered.");
      }
    }
    render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [pageNumber, zoom, document]);

  const pageAnnotations = useMemo(
    () => (document?.annotations || []).filter((item) => item.page_number === pageNumber && !item.archived_at),
    [document, pageNumber]
  );
  const pageCalibrations = useMemo(
    () => (document?.calibrations || []).filter((item) => item.page_number === pageNumber && !item.invalidated_at),
    [document, pageNumber]
  );

  function addPoint(event) {
    if (!["scale", "line", "polyline", "polygon", "count"].includes(tool) || event.pointerType === "touch" && !event.isPrimary) return;
    event.preventDefault();
    try {
      const point = pointerToCanonical(event, overlayRef.current, pageInfo?.rotation || 0);
      if (tool === "count") {
        setPoints([point]);
        return;
      }
      const next = [...points, point];
      setPoints(next);
      if ((tool === "scale" || tool === "line") && next.length === 2) setStatusText(tool === "scale" ? "Enter the known reference length." : "Review and save the line.");
    } catch {
      setError("Place points inside the PDF page.");
    }
  }

  async function saveCurrent() {
    setError("");
    setBusy(true);
    try {
      if (tool === "scale") {
        if (points.length !== 2 || !knownLength) throw new Error("Draw a reference line and enter its known length.");
        await createPlanCalibration(documentId, {
          page_number: pageNumber, calibration_type: "page",
          reference_geometry: { points }, known_length: knownLength, unit,
          page_rotation: pageInfo.rotation, page_box: pageInfo.pageBox,
          source_dimension_label: label, expected_document_version: document.version,
        });
        setStatusText("Scale saved. Plan measurements remain estimates until independently verified.");
      } else {
        const required = tool === "polygon" ? 3 : tool === "count" ? 1 : 2;
        if (points.length < required || !label.trim()) throw new Error(`Add ${required} point${required === 1 ? "" : "s"} and a label.`);
        if (tool !== "count" && !activeCalibration) throw new Error("Select or create a scale before saving.");
        const payload = {
          page_number: pageNumber, calibration_id: activeCalibration ? Number(activeCalibration) : null,
          annotation_type: tool, geometry: { points }, label: label.trim(), category: category.trim(),
          expected_document_version: document.version,
        };
        if (editing) {
          await actOnPlanAnnotation(editing.id, "revise", {
            ...payload, expected_annotation_version: editing.version,
          });
          setStatusText("Measurement annotation revision saved. Prior geometry was retained in history.");
        } else {
          await createPlanAnnotation(documentId, payload);
          setStatusText("Measurement annotation saved as an estimate.");
        }
      }
      setPoints([]);
      setLabel("");
      setEditing(null);
      const next = await reload();
      if (tool === "scale") {
        const calibration = next.calibrations.filter((item) => item.page_number === pageNumber && !item.invalidated_at).at(-1);
        setActiveCalibration(calibration ? String(calibration.id) : "");
      }
    } catch (reason) {
      setError(errorText(reason, reason.message || "The measurement could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function createProposal(annotation) {
    setBusy(true);
    setError("");
    try {
      await actOnPlanAnnotation(annotation.id, "create-proposal");
      await reload();
      setStatusText("Measurement proposal added to the Measurement Session for review.");
    } catch (reason) {
      setError(errorText(reason, "The proposal could not be created."));
    } finally {
      setBusy(false);
    }
  }

  async function archive(annotation) {
    setBusy(true);
    try {
      await actOnPlanAnnotation(annotation.id, "archive");
      setSelected(null);
      await reload();
      setStatusText("Unconfirmed annotation archived.");
    } catch (reason) {
      setError(errorText(reason, "The annotation could not be archived."));
    } finally {
      setBusy(false);
    }
  }

  function revise(annotation) {
    setEditing(annotation);
    setSelected(annotation);
    setPageNumber(annotation.page_number);
    setTool(annotation.annotation_type);
    setPoints(annotation.geometry.points.map((point) => ({ x: Number(point.x), y: Number(point.y) })));
    setLabel(annotation.label);
    setCategory(annotation.category || "");
    setActiveCalibration(annotation.calibration_id ? String(annotation.calibration_id) : "");
    setStatusText("Editing a new revision. The saved source annotation will remain in history.");
  }

  function shapePoints(annotation) {
    return annotation.geometry.points.map((point) => canonicalToSvg(point, pageInfo?.rotation || 0));
  }

  if (!document && !error) return <div className="p-4 sm:p-6"><LoadingSkeleton theme="operational" preset="workspace" label="Loading PDF measurement workspace" /></div>;

  return (
    <main className="min-w-0 p-3 sm:p-5" data-testid="plan-measurement-workspace">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to={`/app/measurements/${sessionId}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-blue-400"><ArrowLeft size={17} /> Measurement Session</Link>
          <h1 className="text-xl font-bold sm:text-2xl">{document?.original_filename || "Plan measurement"}</h1>
          <p className="text-sm text-[var(--mhb-text-secondary)]">Calibrated plan takeoff · estimates require field verification</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" aria-label="Previous page" disabled={pageNumber <= 1} onClick={() => { setPageNumber((p) => p - 1); setPoints([]); }}><ChevronLeft /></Button>
          <span className="text-sm font-bold">Page {pageNumber}/{document?.page_count || 1}</span>
          <Button variant="secondary" size="sm" aria-label="Next page" disabled={pageNumber >= (document?.page_count || 1)} onClick={() => { setPageNumber((p) => p + 1); setPoints([]); }}><ChevronRight /></Button>
        </div>
      </header>
      <div className="sr-only" role="status" aria-live="polite">{statusText}</div>
      {error ? <div className="mb-3"><InlineAlert theme="operational" tone="danger">{String(error)}</InlineAlert></div> : null}
      <InlineAlert theme="operational" tone="warning">
        Scanned plans may be distorted or contain multiple scales. Verify cabinetry, countertops, glazing, finish carpentry, structural fabrication, and custom metalwork in the field.
      </InlineAlert>
      <div className="mt-3 grid min-w-0 gap-3 xl:grid-cols-[auto_minmax(0,1fr)_20rem]">
        <nav aria-label="Measurement tools" className="order-2 flex gap-1 overflow-x-auto rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-2 xl:order-1 xl:flex-col">
          {TOOLS.map(([key, text, Icon]) => <button key={key} type="button" aria-pressed={tool === key} onClick={() => { setTool(key); setPoints([]); }} className={`flex min-h-11 min-w-11 items-center gap-2 rounded-lg px-3 text-sm font-bold ${tool === key ? "bg-[var(--mhb-interaction-primary)] text-white" : "hover:bg-[var(--mhb-interaction-ghost-hover)]"}`} title={text}><Icon size={18} /><span className="whitespace-nowrap xl:sr-only">{text}</span></button>)}
        </nav>
        <section className="order-1 min-w-0 overflow-hidden rounded-xl border border-[var(--mhb-border-default)] bg-slate-800 xl:order-2" aria-label="PDF plan">
          <div className="flex min-h-11 items-center justify-between border-b border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] px-2">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(.5, z - .25))}><Minus /></Button>
              <span className="w-14 text-center text-sm">{Math.round(zoom * 100)}%</span>
              <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + .25))}><Plus /></Button>
            </div>
            <span className="text-xs text-[var(--mhb-text-muted)]">{statusText}</span>
          </div>
          <div className={`overflow-auto p-2 ${tool === "pan" ? "touch-pan-x touch-pan-y" : "touch-none"}`} style={{ maxHeight: "72vh" }}>
            <div ref={overlayRef} className="relative mx-auto w-fit max-w-none" onPointerDown={addPoint}>
              <canvas ref={canvasRef} className="block bg-white shadow-lg" aria-label={`PDF page ${pageNumber}`} />
              {pageInfo ? <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                {pageAnnotations.map((annotation) => {
                  const mapped = shapePoints(annotation);
                  if (annotation.annotation_type === "count") return <circle key={annotation.id} cx={mapped[0].x} cy={mapped[0].y} r="12" className="fill-amber-400 stroke-slate-950" strokeWidth="3" onClick={() => setSelected(annotation)} />;
                  const coords = mapped.map((point) => `${point.x},${point.y}`).join(" ");
                  return annotation.annotation_type === "polygon"
                    ? <polygon key={annotation.id} points={coords} className="fill-blue-500/20 stroke-blue-500" vectorEffect="non-scaling-stroke" strokeWidth="3" onClick={() => setSelected(annotation)} />
                    : <polyline key={annotation.id} points={coords} className="fill-none stroke-blue-500" vectorEffect="non-scaling-stroke" strokeWidth="3" onClick={() => setSelected(annotation)} />;
                })}
                {points.length ? <polyline points={points.map((point) => { const p = canonicalToSvg(point, pageInfo.rotation); return `${p.x},${p.y}`; }).join(" ")} className="fill-none stroke-amber-400" vectorEffect="non-scaling-stroke" strokeWidth="3" /> : null}
              </svg> : null}
            </div>
          </div>
        </section>
        <aside className="order-3 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-3 xl:max-h-[78vh] xl:overflow-y-auto">
          <h2 className="font-bold">Review measurement</h2>
          <label className="mt-3 block text-sm font-bold">Active scale
            <select value={activeCalibration} onChange={(event) => setActiveCalibration(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
              <option value="">No scale selected</option>
              {pageCalibrations.map((item) => <option key={item.id} value={item.id}>{item.source_dimension_label || `Scale ${item.id}`} · {item.known_length} {item.unit}</option>)}
            </select>
          </label>
          {["scale", "line", "polyline", "polygon", "count"].includes(tool) ? <div className="mt-3 grid gap-3">
            <label className="text-sm font-bold">Label<input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" placeholder={tool === "scale" ? "Known dimension" : "Kitchen wall"} /></label>
            {tool === "scale" ? <>
              <label className="text-sm font-bold">Known length<input value={knownLength} inputMode="decimal" onChange={(event) => setKnownLength(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label>
              <label className="text-sm font-bold">Unit<select value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">{["feet", "inches", "millimeters", "centimeters", "meters"].map((item) => <option key={item}>{item}</option>)}</select></label>
            </> : <label className="text-sm font-bold">Category<input value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" placeholder="Walls, flooring, fixtures…" /></label>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={!points.length} onClick={() => setPoints((current) => current.slice(0, -1))}><Undo2 size={16} /> Undo point</Button>
              <Button variant="secondary" size="sm" disabled={!points.length && !editing} onClick={() => { setPoints([]); setEditing(null); setLabel(""); }}>Cancel</Button>
              <Button variant="primary" size="sm" loading={busy} onClick={saveCurrent}><Save size={16} /> Save</Button>
            </div>
          </div> : null}
          <h3 className="mt-5 font-bold">Page annotations</h3>
          <div className="mt-2 grid gap-2">
            {pageAnnotations.map((annotation) => <button key={annotation.id} type="button" onClick={() => setSelected(annotation)} className={`min-h-11 rounded-lg border p-2 text-left ${selected?.id === annotation.id ? "border-blue-500" : "border-[var(--mhb-border-default)]"}`}><strong className="block">{annotation.label}</strong><span className="text-xs text-[var(--mhb-text-muted)]">{annotation.annotation_type} · {displayResult(annotation)} · {annotation.confidence.replaceAll("_", " ")}</span></button>)}
            {!pageAnnotations.length ? <p className="text-sm text-[var(--mhb-text-muted)]">No annotations on this page.</p> : null}
          </div>
          {selected ? <div className="mt-3 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] p-3">
            <strong>{selected.label}</strong>
            <p className="mt-1 text-sm">{displayResult(selected)}</p>
            <p className="mt-1 text-xs">Confidence: {selected.confidence.replaceAll("_", " ")}. PDF geometry is not independently verified.</p>
            {(selected.warnings || []).map((warning) => <p key={warning} className="mt-1 text-xs text-amber-400">{warning}</p>)}
            <div className="mt-3 flex flex-wrap gap-2">
              {!selected.measurement_entry_id && !selected.measurement_result_id ? <Button variant="primary" size="sm" loading={busy} onClick={() => createProposal(selected)}><Check size={16} /> Create proposal</Button> : <span className="text-xs font-bold text-emerald-400">Added to Measurement Session</span>}
              {!selected.measurement_entry_id && !selected.measurement_result_id ? <Button variant="secondary" size="sm" onClick={() => revise(selected)}>Revise</Button> : null}
              {!selected.measurement_entry_id && !selected.measurement_result_id ? <Button variant="danger" size="sm" onClick={() => archive(selected)}><Trash2 size={16} /> Archive</Button> : null}
            </div>
          </div> : null}
        </aside>
      </div>
    </main>
  );
}
