// src/components/AssignEmployeeInline.jsx
import React, { useEffect, useState } from "react";
import { listSubaccounts } from "../api/subaccounts";

/**
 * Employee dropdown + assign/unassign buttons.
 * - Loads employees (subaccounts)
 * - Lets contractor select an employee
 * - Calls provided callbacks
 */
export default function AssignEmployeeInline({
  label = "Assign Employee",
  help = "",
  onAssign,
  onUnassign,
  assignButtonLabel = "Assign",
  unassignButtonLabel = "Remove Assignment",
  disabled = false,
  theme = "default",
  currentAssignment = null,
  unassignRequiresSelection = true,
}) {
  const operational = theme === "operational";
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState([]);
  const [selected, setSelected] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      setLoading(true);
      setErr("");
      try {
        const data = await listSubaccounts();
        if (!mounted) return;
        setSubs(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error(e);
        setErr("Could not load employees.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleAssign() {
    setErr("");
    if (unassignRequiresSelection && !selected) return setErr("Select an employee first.");
    if (!onAssign) return;

    setBusy(true);
    try {
      await onAssign(Number(selected));
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || e?.message || "Assign failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnassign() {
    setErr("");
    if (!selected) return setErr("Select an employee first.");
    if (!onUnassign) return;

    setBusy(true);
    try {
      await onUnassign(Number(selected));
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || e?.message || "Unassign failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${operational ? "border-white/10 bg-[#041735]/80 text-white" : "border-gray-200 bg-white"}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-bold">{label}</div>
          {help ? <div className={`mt-1 text-sm ${operational ? "text-sky-100/65" : "text-gray-500"}`}>{help}</div> : null}
        </div>
      </div>

      {err ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {err}
        </div>
      ) : null}

      {currentAssignment ? (
        <div className={`mt-3 text-sm ${operational ? "text-sky-100/75" : "text-gray-600"}`}>
          <span className={operational ? "font-semibold text-white" : "font-semibold text-gray-900"}>Current:</span>{" "}
          {currentAssignment.display_name || currentAssignment.email || "Assigned team member"}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col md:flex-row gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled || loading || busy}
          className={operational ? "mhb-operational-control flex-1 rounded-lg px-3 py-2" : "flex-1 rounded-lg border border-gray-300 px-3 py-2"}
        >
          <option value="">
            {loading ? "Loading employees..." : "— Select employee —"}
          </option>
          {subs.map((s) => (
            <option key={s.id} value={s.id}>
              {(s.display_name || "Employee")} — {s.email} ({s.role})
            </option>
          ))}
        </select>

        <button
          onClick={handleAssign}
          disabled={disabled || loading || busy || (unassignRequiresSelection && !selected) || (!unassignRequiresSelection && !currentAssignment)}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Working..." : assignButtonLabel}
        </button>

        <button
          onClick={handleUnassign}
          disabled={disabled || loading || busy || !selected}
          className={operational ? "rounded-lg border border-white/15 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/15 disabled:opacity-60" : "rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50 disabled:opacity-60"}
        >
          {busy ? "Working..." : unassignButtonLabel}
        </button>
      </div>
    </div>
  );
}
