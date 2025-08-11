// src/components/AgreementMilestoneStep.jsx (Enhanced with Drag-and-Drop)

import React, { useState } from "react";
import { DragDropContext, Droppable, Draggable } from "react-beautiful-dnd";

const daysOptions = Array.from({ length: 31 }, (_, i) => i);
const hoursOptions = Array.from({ length: 24 }, (_, i) => i);
const minutesOptions = [0, 15, 30, 45];

export default function AgreementMilestoneStep({ step1Data, onBack, onSubmit }) {
  const [milestones, setMilestones] = useState([
    {
      order: 1,
      title: "",
      description: "",
      amount: "",
      start_date: "",
      completion_date: "",
      days: 0,
      hours: 0,
      minutes: 0,
    },
  ]);
  const [error, setError] = useState("");

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(milestones);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    const updated = items.map((m, idx) => ({ ...m, order: idx + 1 }));
    setMilestones(updated);
  };

  const handleMilestoneChange = (i, field, value) => {
    setMilestones((ms) => ms.map((m, idx) => (idx === i ? { ...m, [field]: value } : m)));
  };

  const addMilestone = () =>
    setMilestones((ms) => [
      ...ms,
      {
        order: ms.length + 1,
        title: "",
        description: "",
        amount: "",
        start_date: "",
        completion_date: "",
        days: 0,
        hours: 0,
        minutes: 0,
      },
    ]);

  const removeMilestone = (i) =>
    setMilestones((ms) => ms.filter((_, idx) => idx !== i).map((m, idx) => ({ ...m, order: idx + 1 })));

  const validate = () => {
    for (let m of milestones) {
      if (!m.title.trim()) return "Milestone title is required.";
      if (parseFloat(m.amount) <= 0) return "Milestone amount must be > 0.";
      if (!m.start_date || !m.completion_date) return "Both dates required for each milestone.";
      if (new Date(m.completion_date) < new Date(m.start_date)) return "Completion date must be >= start date.";
      if (Number(m.days) + Number(m.hours) + Number(m.minutes) <= 0) return "Each milestone must have a time estimate.";
    }
    return null;
  };

  const durationToSeconds = (d, h, m) => d * 86400 + h * 3600 + m * 60;
  const secondsToDurationStr = (seconds) => {
    const days = Math.floor(seconds / 86400);
    seconds %= 86400;
    const hours = Math.floor(seconds / 3600);
    seconds %= 3600;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return days > 0 ? `${days} ${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  };

  const totalCost = milestones.reduce((acc, m) => acc + (parseFloat(m.amount) || 0), 0);
  const totalSeconds = milestones.reduce((acc, m) => acc + durationToSeconds(Number(m.days), Number(m.hours), Number(m.minutes)), 0);
  const totalDurationStr = secondsToDurationStr(totalSeconds);

  const handleNext = () => {
    const err = validate();
    if (err) return setError(err);
    const outputMilestones = milestones.map((m) => ({
      ...m,
      title: m.title.trim(),
      description: m.description.trim(),
      amount: parseFloat(m.amount),
      days: Number(m.days),
      hours: Number(m.hours),
      minutes: Number(m.minutes),
    }));
    onSubmit({ milestones: outputMilestones, milestoneTotalCost: totalCost, milestoneTotalDuration: totalDurationStr });
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto mt-6">
      <div className="mb-4 flex justify-between">
        <button type="button" onClick={onBack} className="text-blue-600 hover:underline font-medium">← Back</button>
        <div>
          <span className="mr-6 font-semibold text-blue-800">Total Cost: ${totalCost.toFixed(2)}</span>
          <span className="font-semibold text-blue-800">Total Duration: {totalDurationStr}</span>
        </div>
      </div>
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Step 2: Milestones</h2>
      {error && <p className="text-red-500 mb-2">{error}</p>}

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="milestones">
          {(provided) => (
            <div {...provided.droppableProps} ref={provided.innerRef}>
              {milestones.map((m, idx) => (
                <Draggable key={m.order} draggableId={String(m.order)} index={idx}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`border p-3 rounded space-y-2 mb-6 bg-white flex flex-col ${snapshot.isDragging ? "bg-blue-50 shadow-lg" : ""}`}
                      style={provided.draggableProps.style}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold"><span className="cursor-grab mr-2 text-xl">⋮⋮</span>Milestone #{m.order}</span>
                        {milestones.length > 1 && (
                          <button type="button" onClick={() => removeMilestone(idx)} className="text-red-600">Remove</button>
                        )}
                      </div>
                      <input value={m.title} onChange={(e) => handleMilestoneChange(idx, "title", e.target.value)} placeholder="Milestone Title" className="w-full p-2 border rounded" required />
                      <input value={m.description} onChange={(e) => handleMilestoneChange(idx, "description", e.target.value)} placeholder="Milestone Description" className="w-full p-2 border rounded" />
                      <div className="flex space-x-2">
                        <input type="number" step="0.01" value={m.amount} onChange={(e) => handleMilestoneChange(idx, "amount", e.target.value)} placeholder="Amount" className="flex-1 p-2 border rounded" required />
                        <input type="date" value={m.start_date} onChange={(e) => handleMilestoneChange(idx, "start_date", e.target.value)} className="flex-1 p-2 border rounded" required />
                        <input type="date" value={m.completion_date} onChange={(e) => handleMilestoneChange(idx, "completion_date", e.target.value)} className="flex-1 p-2 border rounded" required />
                      </div>
                      <div className="flex space-x-2 items-end">
                        <div>
                          <label className="block text-sm font-semibold">Days</label>
                          <select value={m.days} onChange={(e) => handleMilestoneChange(idx, "days", e.target.value)} className="p-2 border rounded">
                            {daysOptions.map((d) => (<option key={d} value={d}>{d}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold">Hours</label>
                          <select value={m.hours} onChange={(e) => handleMilestoneChange(idx, "hours", e.target.value)} className="p-2 border rounded">
                            {hoursOptions.map((h) => (<option key={h} value={h}>{h}</option>))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold">Minutes</label>
                          <select value={m.minutes} onChange={(e) => handleMilestoneChange(idx, "minutes", e.target.value)} className="p-2 border rounded">
                            {minutesOptions.map((mm) => (<option key={mm} value={mm}>{mm.toString().padStart(2, "0")}</option>))}
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

      <button type="button" onClick={addMilestone} className="bg-green-500 text-white px-4 py-2 rounded mb-6">+ Add Milestone</button>
      <div className="flex justify-end">
        <button type="button" onClick={handleNext} className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-bold">Next</button>
      </div>
    </div>
  );
}
