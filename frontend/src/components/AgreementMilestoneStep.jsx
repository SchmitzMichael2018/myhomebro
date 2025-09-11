// src/components/AgreementMilestoneStep.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";
import DateField from "./DateField.jsx";

const daysOptions = Array.from({ length: 31 }, (_, i) => i);
const hoursOptions = Array.from({ length: 24 }, (_, i) => i);
const minutesOptions = [0, 15, 30, 45];

const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const mk = (order) => ({
  id: genId(),
  order,
  title: "",
  description: "",
  amount: "",
  start_date: "",
  completion_date: "",
  days: 0,
  hours: 0,
  minutes: 0,
});

const san = (m, idx) => ({
  id: m.id || genId(),
  order: typeof m.order === "number" ? m.order : idx + 1,
  title: m.title ?? "",
  description: m.description ?? "",
  amount: m.amount ?? "",
  start_date: m.start_date ?? "",
  completion_date: m.completion_date ?? "",
  days: Number(m.days ?? 0),
  hours: Number(m.hours ?? 0),
  minutes: Number(m.minutes ?? 0),
});

export default function AgreementMilestoneStep({ step1Data, onBack, onSubmit, draftKey: draftKeyProp }) {
  const draftKey = useMemo(() => {
    const base =
      draftKeyProp ||
      step1Data?.agreementId ||
      step1Data?.projectId ||
      (step1Data?.title ? step1Data.title.replace(/\s+/g, "_").slice(0, 40) : "new");
    return `agreement:milestones:${base}`;
  }, [draftKeyProp, step1Data]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [milestones, setMilestones] = useState([mk(1)]);
  const [error, setError] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [loadedFromDraft, setLoadedFromDraft] = useState(false);

  useEffect(() => {
    let loaded = null;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.milestones)) loaded = parsed;
      }
    } catch {}
    if (!loaded && Array.isArray(step1Data?.milestones) && step1Data.milestones.length > 0) {
      loaded = { milestones: step1Data.milestones, lastSavedAt: null };
    }
    if (loaded) {
      const sanitized = loaded.milestones.map(san).map((m, i) => ({ ...m, order: i + 1 }));
      setMilestones(sanitized);
      setLastSavedAt(loaded.lastSavedAt || null);
      setLoadedFromDraft(!!loaded.lastSavedAt);
    } else {
      setMilestones([mk(1)]);
      setLastSavedAt(null);
      setLoadedFromDraft(false);
    }
  }, [draftKey, step1Data]);

  const onDragEnd = (result) => {
    if (!result.destination) return;
    setMilestones((prev) => {
      const items = Array.from(prev);
      const [reordered] = items.splice(result.source.index, 1);
      items.splice(result.destination.index, 0, reordered);
      return items.map((m, idx) => ({ ...m, order: idx + 1 }));
    });
  };

  const setField = (i, field, value) => {
    setMilestones((ms) =>
      ms.map((m, idx) => (idx === i ? {
        ...m,
        [field]: ["days","hours","minutes"].includes(field) ? Number(value) : value,
      } : m)),
    );
  };

  const add = () => setMilestones((ms) => [...ms, mk(ms.length + 1)]);
  const remove = (i) =>
    setMilestones((ms) =>
      ms.filter((_, idx) => idx !== i).map((m, idx) => ({ ...m, order: idx + 1 })),
    );

  const validate = useCallback(() => {
    for (let m of milestones) {
      const amt = parseFloat(m.amount);
      if (!String(m.title || "").trim()) return "Milestone title is required.";
      if (!Number.isFinite(amt) || amt <= 0) return "Milestone amount must be > 0.";
      if (!m.start_date || !m.completion_date) return "Both dates are required.";
      if (new Date(m.completion_date) < new Date(m.start_date)) return "Completion date must be on/after start.";
      if (Number(m.days) + Number(m.hours) + Number(m.minutes) <= 0) return "Each milestone needs a time estimate.";
    }
    return null;
  }, [milestones]);

  const dur = (d,h,m)=>d*86400+h*3600+m*60;
  const secStr = (s)=>{let x=s;const D=Math.floor(x/86400);x%=86400;const H=Math.floor(x/3600);x%=3600;const M=Math.floor(x/60),C=x%60;const p=n=>String(n).padStart(2,"0");return D>0?`${D} ${p(H)}:${p(M)}:${p(C)}`:`${p(H)}:${p(M)}:${p(C)}`;};

  const totalCost = milestones.reduce((a,m)=>a+(parseFloat(m.amount)||0),0);
  const totalSecs = milestones.reduce((a,m)=>a+dur(Number(m.days),Number(m.hours),Number(m.minutes)),0);
  const totalDur = secStr(totalSecs);

  const saveDraft = useCallback(() => {
    try {
      const ts = new Date().toISOString();
      localStorage.setItem(draftKey, JSON.stringify({ milestones, lastSavedAt: ts }));
      setLastSavedAt(ts);
      setLoadedFromDraft(true);
    } catch {}
  }, [draftKey, milestones]);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch {}
    setLastSavedAt(null);
    setLoadedFromDraft(false);
  }, [draftKey]);

  const next = () => {
    const err = validate();
    if (err) return setError(err);
    saveDraft();
    const out = milestones.map((m,i)=>({
      order:i+1,
      title:String(m.title||"").trim(),
      description:String(m.description||"").trim(),
      amount:parseFloat(m.amount),
      start_date:m.start_date,
      completion_date:m.completion_date,
      days:Number(m.days), hours:Number(m.hours), minutes:Number(m.minutes),
    }));
    onSubmit?.({
      milestones: out,
      milestoneTotalCost: totalCost,
      milestoneTotalDuration: totalDur,
    });
  };

  const back = () => { saveDraft(); onBack?.(); };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto mt-6">
      <div className="mb-4 flex justify-between items-start">
        <button type="button" onClick={back} className="text-blue-600 hover:underline font-medium">
          ← Back
        </button>
        <div className="text-right">
          <div className="text-sm text-gray-500">
            {loadedFromDraft && lastSavedAt
              ? `Draft loaded • Last saved ${new Date(lastSavedAt).toLocaleString()}`
              : lastSavedAt
              ? `Last saved ${new Date(lastSavedAt).toLocaleString()}`
              : "Not saved yet"}
          </div>
          <div className="mt-1">
            <span className="mr-6 font-semibold text-blue-800">Total Cost: ${totalCost.toFixed(2)}</span>
            <span className="font-semibold text-blue-800">Total Duration: {totalDur}</span>
          </div>
        </div>
      </div>

      <h2 className="text-2xl font-bold mb-4 text-gray-800">Step 2: Milestones</h2>
      {error && <p className="text-red-500 mb-3">{error}</p>}

      <div className="flex items-center gap-2 mb-4">
        <button type="button" onClick={saveDraft} className="px-3 py-2 rounded border hover:bg-gray-50">Save Draft</button>
        {lastSavedAt && <button type="button" onClick={clearDraft} className="px-3 py-2 rounded border hover:bg-gray-50 text-red-600">Discard Draft</button>}
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="milestones">
          {(provided) => (
            <div {...provided.droppableProps} ref={provided.innerRef}>
              {milestones.map((m, idx) => (
                <Draggable key={m.id} draggableId={m.id} index={idx}>
                  {(provided, snapshot) => (
                    <div ref={provided.innerRef} {...provided.draggableProps}
                      className={`border p-3 rounded space-y-2 mb-6 bg-white ${snapshot.isDragging ? "bg-blue-50 shadow-lg" : ""}`}
                      style={provided.draggableProps.style}>

                      <div className="flex justify-between items-center">
                        <span className="font-semibold">
                          <span {...provided.dragHandleProps} className="cursor-grab mr-2 text-xl select-none">⋮⋮</span>
                          Milestone #{m.order}
                        </span>
                        {milestones.length > 1 && (
                          <button type="button" onClick={() => remove(idx)} className="text-red-600">Remove</button>
                        )}
                      </div>

                      <input value={m.title} onChange={(e)=>setField(idx,"title",e.target.value)} placeholder="Milestone Title" className="w-full p-2 border rounded" />
                      <input value={m.description} onChange={(e)=>setField(idx,"description",e.target.value)} placeholder="Milestone Description" className="w-full p-2 border rounded" />

                      <div className="flex flex-col sm:flex-row gap-2">
                        <input type="number" step="0.01" value={m.amount} onChange={(e)=>setField(idx,"amount",e.target.value)} placeholder="Amount" className="flex-1 p-2 border rounded" />
                        <DateField value={m.start_date} onChange={(e)=>setField(idx,"start_date",e.target.value)} min={today} className="flex-1" debug />
                        <DateField value={m.completion_date} onChange={(e)=>setField(idx,"completion_date",e.target.value)} min={m.start_date||today} className="flex-1" debug />
                      </div>

                      <div className="flex gap-4 items-end">
                        <div>
                          <label className="block text-sm font-semibold">Days</label>
                          <select value={m.days} onChange={(e)=>setField(idx,"days",e.target.value)} className="p-2 border rounded">
                            {daysOptions.map(d=><option key={d} value={d}>{d}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold">Hours</label>
                          <select value={m.hours} onChange={(e)=>setField(idx,"hours",e.target.value)} className="p-2 border rounded">
                            {hoursOptions.map(h=><option key={h} value={h}>{h}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold">Minutes</label>
                          <select value={m.minutes} onChange={(e)=>setField(idx,"minutes",e.target.value)} className="p-2 border rounded">
                            {minutesOptions.map(mm=><option key={mm} value={mm}>{mm.toString().padStart(2,"0")}</option>)}
                          </select>
                        </div>
                      </div>

                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <button type="button" onClick={add} className="bg-green-500 text-white px-4 py-2 rounded mb-6">+ Add Milestone</button>

      <div className="flex justify-end">
        <button type="button" onClick={next} className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-bold">Save & Next</button>
      </div>
    </div>
  );
}
