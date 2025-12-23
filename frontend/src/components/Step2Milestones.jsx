// frontend/src/components/Step2Milestones.jsx
// v2025-12-05-tz — timezone-safe date display, aligned with Step4Finalize.
// Uses start_date for "Start" and completion_date for "Due".

import React, { useMemo } from "react";

// Local helpers (kept in sync with AgreementWizard)
function toDateOnly(v) {
  if (!v) return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function friendly(d) {
  const iso = toDateOnly(d);
  if (!iso) return "";
  const [yStr, mStr, dStr] = iso.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const day = Number(dStr);
  if (!y || !m || !day) return iso;
  const dt = new Date(y, m - 1, day);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ───────── Step 2 ───────── */
export default function Step2Milestones({
  agreementId,
  milestones,
  mLocal,
  onLocalChange,
  onMLocalChange,
  saveMilestone,
  deleteMilestone,
  editMilestone,
  setEditMilestone,
  updateMilestone,
  onBack,
  onNext,
}) {
  const total = milestones.reduce((s, m) => s + Number(m.amount || 0), 0);

  // Schedule range:
  //   Start = min(start_date)
  //   End   = max(completion_date)
  const minStart = useMemo(() => {
    const s = milestones
      .map((m) => toDateOnly(m.start_date || m.start))
      .filter(Boolean)
      .sort()[0];
    return s || "";
  }, [milestones]);

  const maxEnd = useMemo(() => {
    const e = milestones
      .map((m) => toDateOnly(m.completion_date || m.end_date || m.end))
      .filter(Boolean)
      .sort()
      .slice(-1)[0];
    return e || "";
  }, [milestones]);

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Milestones</h3>
        <div className="text-sm text-gray-600">
          Schedule:{" "}
          {minStart && maxEnd ? (
            <span className="font-medium">
              {friendly(minStart)} → {friendly(maxEnd)} (est.)
            </span>
          ) : (
            <span className="text-gray-400">add dates to see range</span>
          )}
        </div>
      </div>

      {/* Inline add form */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 mb-2">
        <input
          className="md:col-span-4 rounded border px-3 py-2 text-sm"
          placeholder="Title"
          name="title"
          value={mLocal.title}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
        />
        <input
          type="date"
          className="md:col-span-3 rounded border px-3 py-2 text-sm"
          name="start"
          value={mLocal.start || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          aria-label="Start date"
        />
        <input
          type="date"
          className="md:col-span-3 rounded border px-3 py-2 text-sm"
          name="end"
          value={mLocal.end || ""}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          aria-label="Completion date"
        />
        <input
          type="number"
          min="0"
          step="0.01"
          className="md:col-span-2 rounded border px-3 py-2 text-sm"
          placeholder="Amount"
          name="amount"
          value={mLocal.amount}
          onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
        />
        <div className="md:col-span-12">
          <textarea
            className="w-full rounded border px-3 py-2 text-sm resize-y"
            rows={3}
            placeholder="Description (details, materials, notes)…"
            name="description"
            value={mLocal.description}
            onChange={(e) => onMLocalChange(e.target.name, e.target.value)}
          />
        </div>
      </div>

      <div className="mb-6">
        <button
          onClick={() => saveMilestone(mLocal)}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
        >
          + Add Milestone
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="[&>*]:px-3 [&>*]:py-2 text-left">
              <th>#</th>
              <th>Title</th>
              <th>Description</th>
              <th>Start</th>
              <th>Due</th>
              <th>Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {milestones.map((m, idx) => (
              <tr key={m.id || `${m.title}-${idx}`} className="border-t align-top">
                <td className="[&>*]:px-3 [&>*]:py-2">{idx + 1}</td>
                <td className="[&>*]:px-3 [&>*]:py-2">{m.title || "—"}</td>
                <td className="[&>*]:px-3 [&>*]:py-2 whitespace-pre-wrap">
                  {m.description || "—"}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {friendly(toDateOnly(m.start_date || m.start))}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {friendly(
                    toDateOnly(
                      m.completion_date || m.end_date || m.end
                    )
                  )}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2">
                  {Number(m.amount || 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                  })}
                </td>
                <td className="[&>*]:px-3 [&>*]:py-2 text-right">
                  <div className="inline-flex gap-2">
                    <button
                      className="rounded border px-2 py-1"
                      onClick={() => setEditMilestone(m)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded border px-2 py-1"
                      onClick={() => deleteMilestone(m.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!milestones.length && (
              <tr>
                <td
                  colSpan={7}
                  className="text-center text-gray-400 py-6"
                >
                  No milestones yet.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold [&>*]:px-3 [&>*]:py-2">
              <td colSpan={5}>Total</td>
              <td>
                {total.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                })}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button onClick={onBack} className="rounded border px-3 py-2 text-sm">
          Back
        </button>
        <button
          onClick={onNext}
          className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700"
        >
          Save &amp; Next
        </button>
      </div>
    </div>
  );
}
