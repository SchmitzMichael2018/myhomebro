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
  disabled = false,
}) {
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
    if (!selected) return setErr("Select an employee first.");
    if (!onAssign) return;

    setBusy(true);
    try {
      await onAssign(Number(selected));
    } catch (e) {
      console.error(e);
      setErr(e?.response?.data?.detail || "Assign failed.");
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
      setErr(e?.response?.data?.detail || "Unassign failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="font-bold">{label}</div>
          {help ? <div className="text-sm text-gray-500 mt-1">{help}</div> : null}
        </div>
      </div>

      {err ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
          {err}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col md:flex-row gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={disabled || loading || busy}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
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
          disabled={disabled || loading || busy || !selected}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          {busy ? "Working..." : "Assign"}
        </button>

        <button
          onClick={handleUnassign}
          disabled={disabled || loading || busy || !selected}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50 disabled:opacity-60"
        >
          {busy ? "Working..." : "Unassign"}
        </button>
      </div>
    </div>
  );
}
