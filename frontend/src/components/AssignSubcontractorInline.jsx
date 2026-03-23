import React, { useMemo, useState } from "react";

export default function AssignSubcontractorInline({
  acceptedSubcontractors = [],
  currentAssignment = null,
  onAssign,
  onUnassign,
  disabled = false,
}) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const options = useMemo(
    () =>
      (Array.isArray(acceptedSubcontractors) ? acceptedSubcontractors : []).map((item) => ({
        id: item.id,
        label:
          item.accepted_name ||
          item.invite_name ||
          item.invite_email ||
          "Subcontractor",
        email: item.invite_email || "",
      })),
    [acceptedSubcontractors]
  );

  async function handleAssign() {
    setErr("");
    if (!selected) {
      setErr("Select a subcontractor first.");
      return;
    }
    if (!onAssign) return;

    setBusy(true);
    try {
      await onAssign(Number(selected));
      setSelected("");
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.assigned_subcontractor_invitation?.[0] || e?.response?.data?.detail || "Assign failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnassign() {
    setErr("");
    if (!onUnassign) return;

    setBusy(true);
    try {
      await onUnassign();
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || "Unassign failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="font-bold">Assigned Subcontractor</div>
      <div className="mt-1 text-sm text-gray-500">
        Only accepted subcontractors for this agreement can be assigned.
      </div>

      <div className="mt-3 text-sm">
        <span className="font-semibold text-gray-900">Current:</span>{" "}
        {currentAssignment?.display_name || currentAssignment?.email || "Unassigned"}
      </div>

      {err ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 md:flex-row">
        <select
          data-testid="subcontractor-assignment-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled || busy}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
        >
          <option value="">
            {options.length === 0 ? "No accepted subcontractors" : "— Select subcontractor —"}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} {option.email ? `— ${option.email}` : ""}
            </option>
          ))}
        </select>

        <button
          data-testid="subcontractor-assign-button"
          type="button"
          onClick={handleAssign}
          disabled={disabled || busy || !selected}
          className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Working..." : "Assign"}
        </button>

        <button
          data-testid="subcontractor-unassign-button"
          type="button"
          onClick={handleUnassign}
          disabled={disabled || busy || !currentAssignment}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50 disabled:opacity-60"
        >
          {busy ? "Working..." : "Remove"}
        </button>
      </div>
    </div>
  );
}
