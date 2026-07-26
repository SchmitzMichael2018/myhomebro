import React, { useEffect, useMemo, useState } from "react";
import { Copy, Mic, Plus, Ruler, Square, Trash2 } from "lucide-react";

import { createProjectCapture, getCaptureProjectOptions } from "../../api/captures.js";
import { createVoiceService } from "../../lib/voiceService.js";
import { Button, InlineAlert } from "../ui";

const FRACTIONS = ["", "1/2", "1/4", "3/4", "1/8", "3/8", "5/8", "7/8", "1/16", "3/16", "5/16", "7/16", "9/16", "11/16", "13/16", "15/16"];
const PURPOSES = ["flooring", "wall_finish", "painting", "ceiling", "door", "window", "cabinetry", "countertop", "fencing", "roofing", "general_room", "custom"];
const PROFILES = [
  ["rectangular_room", "Rectangular room / floor"],
  ["wall", "Wall"],
  ["opening", "Door or window opening"],
  ["linear_run", "Linear run"],
  ["rectangular_volume", "Rectangular volume"],
];

function newReading(dimension = "length", label = "Length") {
  return {
    client_key: crypto.randomUUID(), label, dimension_type: dimension,
    feet: "", inches: "", fraction: "", natural: "", source_method: "manual_entry",
    verification_status: "needs_verification", tool_description: "", reading_group: "",
  };
}

function rawValue(row) {
  if (row.natural.trim()) return row.natural.trim();
  const feet = row.feet || "0";
  const inches = row.inches || "0";
  return `${feet} ft ${inches}${row.fraction ? ` ${row.fraction}` : ""} in`;
}

export default function MeasurementCaptureForm({ onSaved, onCancel, initialProjectId = "" }) {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [roomName, setRoomName] = useState("");
  const [purpose, setPurpose] = useState("general_room");
  const [profile, setProfile] = useState("rectangular_room");
  const [readings, setReadings] = useState([newReading("length", "Length"), newReading("width", "Width")]);
  const [files, setFiles] = useState([]);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const voice = useMemo(() => createVoiceService(), []);

  useEffect(() => {
    getCaptureProjectOptions().then(setProjects).catch(() => setError("Projects could not be loaded. Check your connection and try again."));
    return () => voice.cancelListening();
  }, [voice]);

  function update(index, key, value) {
    setReadings((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }

  function addReading(copy) {
    setReadings((current) => [...current, copy ? { ...copy, client_key: crypto.randomUUID(), label: `${copy.label} repeat` } : newReading()]);
  }

  function startVoice() {
    voice.startListening({
      lang: "en-US",
      onStart: () => setListening(true),
      onResult: ({ transcript: value }) => setTranscript(value),
      onError: () => { setListening(false); setError("Voice is unavailable. Your typed measurements are still here."); },
      onEnd: () => setListening(false),
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const capture = await createProjectCapture({
        capture_type: "measurement",
        capture_method: transcript ? "voice" : "typed",
        project_id: Number(projectId),
        raw_text_payload: {
          transcript,
          input_metadata: {
            room_name: roomName, room_type: "general_room", purpose, guided_profile: profile,
            tolerance_profile: purpose === "cabinetry" ? "cabinetry" : purpose === "countertop" ? "countertop" : "general_construction",
            entries: readings.map((row) => ({
              client_key: row.client_key, label: row.label, dimension_type: row.dimension_type,
              raw_value: rawValue(row), display_unit: "feet_inches",
              source_method: transcript && row.natural ? "voice_transcript" : row.source_method,
              verification_status: row.verification_status, tool_description: row.tool_description,
              reading_group: row.reading_group, selected_for_calculation: true, selection_method: "",
              notes: transcript && row.natural ? `Raw transcript: ${transcript}` : "",
            })),
            adjustments: [], annotations: [],
          },
        },
      }, files);
      onSaved(capture);
    } catch (reason) {
      setError(reason?.response?.data?.detail || "Measurement could not be saved. Your entries remain on this screen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid min-w-0 gap-4 pb-20 sm:pb-0" data-testid="measurement-capture-form">
      <InlineAlert theme="operational" tone="info">
        Enter readings from your tools. MyHomeBro calculates from them but does not measure the space or manufacture precision.
      </InlineAlert>
      <label className="grid gap-1 text-sm font-semibold">
        Project
        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} required className="min-h-12 w-full rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
          <option value="">Choose a project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Room or area
        <input value={roomName} onChange={(event) => setRoomName(event.target.value)} required placeholder="Living Room" className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Purpose
          <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
            {PURPOSES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Guided form
          <select value={profile} onChange={(event) => setProfile(event.target.value)} className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
            {PROFILES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-3">
        {readings.map((row, index) => (
          <section key={row.client_key} className="min-w-0 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-3" data-testid="measurement-reading">
            <div className="mb-3 flex items-center gap-2">
              <Ruler size={18} aria-hidden="true" />
              <input aria-label={`Measurement ${index + 1} label`} value={row.label} onChange={(event) => update(index, "label", event.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2 py-2 font-bold" />
              <button type="button" aria-label="Duplicate measurement" onClick={() => addReading(row)} className="min-h-11 min-w-11 rounded-lg border border-[var(--mhb-border-default)]"><Copy className="mx-auto" size={17} /></button>
              {readings.length > 1 ? <button type="button" aria-label="Remove measurement" onClick={() => setReadings((current) => current.filter((_, rowIndex) => rowIndex !== index))} className="min-h-11 min-w-11 rounded-lg border border-[var(--mhb-border-default)]"><Trash2 className="mx-auto" size={17} /></button> : null}
            </div>
            <select aria-label="Dimension type" value={row.dimension_type} onChange={(event) => update(index, "dimension_type", event.target.value)} className="mb-3 min-h-11 w-full rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2">
              {["length", "width", "height", "depth", "thickness", "perimeter_segment", "opening_width", "opening_height", "area_manual", "volume_manual", "other"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-2">
              <label className="grid gap-1 text-xs">Feet<input inputMode="decimal" value={row.feet} onChange={(event) => update(index, "feet", event.target.value)} className="min-h-12 min-w-0 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2 text-lg" /></label>
              <label className="grid gap-1 text-xs">Inches<input inputMode="decimal" value={row.inches} onChange={(event) => update(index, "inches", event.target.value)} className="min-h-12 min-w-0 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2 text-lg" /></label>
              <label className="grid gap-1 text-xs">Fraction<select value={row.fraction} onChange={(event) => update(index, "fraction", event.target.value)} className="min-h-12 min-w-0 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-1">{FRACTIONS.map((value) => <option key={value || "none"} value={value}>{value || "None"}</option>)}</select></label>
            </div>
            <label className="mt-3 grid gap-1 text-xs">Or natural entry<input value={row.natural} onChange={(event) => update(index, "natural", event.target.value)} placeholder={'12 ft 4 3/8 in'} className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs">Source<select value={row.source_method} onChange={(event) => update(index, "source_method", event.target.value)} className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2">{["manual_entry", "tape_measure", "laser_manual_entry", "existing_plan", "photo_reference", "other"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
              <label className="grid gap-1 text-xs">Verification<select value={row.verification_status} onChange={(event) => update(index, "verification_status", event.target.value)} className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2"><option value="needs_verification">Needs verification</option><option value="estimated">Estimated</option><option value="verified">Verified against tool/plan</option></select></label>
            </div>
          </section>
        ))}
      </div>
      <Button type="button" variant="secondary" theme="operational" icon={Plus} onClick={() => addReading()}>Next measurement</Button>
      <label className="grid gap-1 text-sm font-semibold">Voice transcript (optional)
        <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={2} placeholder="Living room length twelve feet four and three eighths inches" className="rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3 py-2" />
      </label>
      <Button type="button" variant="secondary" theme="operational" icon={listening ? Square : Mic} onClick={listening ? () => voice.stopListening() : startVoice}>{listening ? "Stop listening" : "Use voice"}</Button>
      <label className="grid gap-1 text-sm font-semibold">Reference photos (optional)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setFiles([...event.target.files])} /></label>
      {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card-elevated)] p-4 sm:static sm:mx-0 sm:justify-end sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="button" variant="secondary" theme="operational" onClick={onCancel}>Cancel</Button>
        <Button type="submit" theme="operational" loading={busy} disabled={!projectId || !roomName.trim() || !readings.length}>Save for review</Button>
      </div>
    </form>
  );
}
