import React, { useMemo, useState } from "react";

export default function AssignReviewerInline({
  reviewers = [],
  currentReviewer = null,
  onAssign,
  onClear,
  disabled = false,
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const options = useMemo(
    () =>
      (Array.isArray(reviewers) ? reviewers : []).map((item) => ({
        id: item.id,
        label: item.display_name || item.email || "Team Member",
        email: item.email || "",
      })),
    [reviewers]
  );

  async function handleAssign() {
    if (!selected || !onAssign) return;
    setBusy(true);
    setError("");
    try {
      await onAssign(Number(selected));
      setSelected("");
    } catch (err) {
      console.error(err);
      setError(
        err?.response?.data?.delegated_reviewer_subaccount?.[0] ||
          err?.response?.data?.detail ||
          "Failed to assign reviewer."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    if (!onClear) return;
    setBusy(true);
    setError("");
    try {
      await onClear();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || "Failed to clear reviewer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="font-bold">Delegated Reviewer</div>
      <div className="mt-1 text-sm text-gray-500">
        Contractor owner is the default reviewer. You can optionally assign an
        internal team reviewer.
      </div>

      <div className="mt-3 text-sm">
        <span className="font-semibold text-gray-900">Current:</span>{" "}
        {currentReviewer?.is_delegated
          ? currentReviewer?.display_name || currentReviewer?.email || "Unassigned"
          : "Contractor Owner"}
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 md:flex-row">
        <select
          data-testid="delegated-reviewer-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled || busy}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">
            {options.length === 0 ? "No eligible reviewers" : "Select delegated reviewer"}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} {option.email ? `- ${option.email}` : ""}
            </option>
          ))}
        </select>

        <button
          type="button"
          data-testid="delegated-reviewer-assign-button"
          onClick={handleAssign}
          disabled={disabled || busy || !selected}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? "Working..." : "Assign Reviewer"}
        </button>

        <button
          type="button"
          data-testid="delegated-reviewer-clear-button"
          onClick={handleClear}
          disabled={disabled || busy || !currentReviewer?.is_delegated}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50 disabled:opacity-60"
        >
          {busy ? "Working..." : "Clear"}
        </button>
      </div>
    </div>
  );
}
