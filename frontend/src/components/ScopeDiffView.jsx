import React, { useState } from "react";
import { formatDiff } from "../lib/scopeDiff.js";

// ScopeDiffView — shows a structured diff between original and AI-improved scope.
// Props:
//   original: string   — current scope text (may be empty for generate-from-scratch)
//   improved: string   — AI-suggested scope text
//   onAccept: (text: string) => void  — called with the accepted text
//   onReject: () => void              — called when user cancels
//   locked: boolean    — disables accept when true
export default function ScopeDiffView({ original = "", improved = "", onAccept, onReject, locked = false }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(improved);

  const { addedCount, removedCount, unchangedCount, lines } = formatDiff(original, improved);
  const hasChanges = addedCount > 0 || removedCount > 0;

  function handleAccept() {
    if (locked) return;
    const text = editing ? editValue : improved;
    if (typeof onAccept === "function") onAccept(text);
  }

  function handleReject() {
    if (typeof onReject === "function") onReject();
  }

  function handleToggleEdit() {
    if (!editing) setEditValue(improved);
    setEditing((prev) => !prev);
  }

  return (
    <div
      data-testid="scope-diff-view"
      className="mt-3 overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-3">
        <div>
          <div className="text-xs font-bold text-indigo-900">AI Scope Review</div>
          {hasChanges ? (
            <div className="mt-0.5 text-[11px] text-indigo-700">
              {addedCount > 0 && (
                <span className="mr-2 font-semibold text-emerald-700">+{addedCount} added</span>
              )}
              {removedCount > 0 && (
                <span className="font-semibold text-rose-700">−{removedCount} removed</span>
              )}
              {unchangedCount > 0 && (
                <span className="ml-2 text-slate-500">{unchangedCount} unchanged</span>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-[11px] text-indigo-700">No changes detected</div>
          )}
        </div>
        <div className="text-[11px] text-indigo-600">Review before accepting</div>
      </div>

      {/* Diff view or edit area */}
      {editing ? (
        <div className="p-4">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            rows={10}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
          />
        </div>
      ) : (
        <div className="divide-y divide-slate-100 p-2">
          {lines.map((line, idx) => (
            <DiffLine key={idx} line={line} />
          ))}
          {lines.length === 0 && (
            <div className="px-3 py-4 text-sm text-slate-500">No content to display.</div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-indigo-100 bg-indigo-50/50 px-4 py-3">
        <button
          type="button"
          onClick={handleAccept}
          disabled={locked}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          Accept changes
        </button>

        <button
          type="button"
          onClick={handleReject}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Keep original
        </button>

        <button
          type="button"
          onClick={handleToggleEdit}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          {editing ? "View diff" : "Edit before accepting"}
        </button>
      </div>
    </div>
  );
}

function DiffLine({ line }) {
  const { type, text } = line;

  if (type === "added") {
    return (
      <div className="flex items-start gap-2 rounded px-3 py-1 text-sm leading-5">
        <span className="mt-px shrink-0 font-mono text-xs font-bold text-emerald-600 select-none">+</span>
        <span className="text-emerald-900 bg-emerald-50 w-full rounded px-1">{text}</span>
      </div>
    );
  }

  if (type === "removed") {
    return (
      <div className="flex items-start gap-2 rounded px-3 py-1 text-sm leading-5">
        <span className="mt-px shrink-0 font-mono text-xs font-bold text-rose-500 select-none">−</span>
        <span className="text-rose-700 bg-rose-50 w-full rounded px-1 line-through opacity-75">{text}</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded px-3 py-1 text-sm leading-5">
      <span className="mt-px shrink-0 font-mono text-xs font-bold text-slate-300 select-none"> </span>
      <span className="text-slate-600">{text}</span>
    </div>
  );
}
