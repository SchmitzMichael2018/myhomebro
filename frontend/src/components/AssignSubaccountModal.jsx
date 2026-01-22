// frontend/src/components/AssignSubaccountModal.jsx
import React, { useEffect, useState } from "react";
import Modal from "../components/Modal"; // you said you have a reusable Modal.jsx
import { listSubaccounts } from "../api/subaccounts";

export default function AssignSubaccountModal({
  isOpen,
  onClose,
  title = "Assign Employee",
  onAssign,
  currentSubaccountId = null,
}) {
  const [loading, setLoading] = useState(true);
  const [subs, setSubs] = useState([]);
  const [selected, setSelected] = useState(currentSubaccountId || "");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isOpen) return;

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
        setErr("Failed to load employees.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  async function handleAssign() {
    setErr("");
    if (!selected) return setErr("Please select an employee.");
    try {
      await onAssign(Number(selected));
      onClose?.();
    } catch (e) {
      console.error(e);
      const msg = e?.response?.data?.detail || "Assignment failed.";
      setErr(msg);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="p-4">
        {loading ? (
          <div className="text-sm opacity-80">Loading employees…</div>
        ) : (
          <>
            {err && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
                {err}
              </div>
            )}

            <label className="block text-sm font-semibold mb-2">Select Employee</label>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">— Choose —</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {(s.display_name || "Employee")} — {s.email} ({s.role})
                </option>
              ))}
            </select>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAssign}
                className="rounded-lg bg-blue-600 text-white px-4 py-2 font-semibold hover:bg-blue-700"
              >
                Assign
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
