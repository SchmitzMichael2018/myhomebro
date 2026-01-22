// src/components/MilestoneAssignDrawer.jsx
// v2026-01-08 — Option A milestone drawer (bulk select + assign/clear overrides)

import React, { useEffect, useMemo, useState } from "react";

function Chip({ children, tone = "neutral" }) {
  const cls =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-gray-200 bg-gray-50 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function SmallButton({ children, onClick, disabled, tone = "primary", title }) {
  const cls =
    tone === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : tone === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${cls}`}
    >
      {children}
    </button>
  );
}

export default function MilestoneAssignDrawer({
  open,
  onClose,
  busy,
  agreement,
  subs,
  selectedEmployeeId,
  onChangeSelectedEmployee,
  onRunConflictCheck,
  conflicts,
  milestones,
  milestoneOverrides,
  fmtDate,
  fmtMoney,
  onAssignSelected,
  onClearOverrides,
}) {
  const [selectedSet, setSelectedSet] = useState(new Set());
  const [localWorking, setLocalWorking] = useState(false);

  // reset selection on open/agreement change
  useEffect(() => {
    if (!open) return;
    setSelectedSet(new Set());
  }, [open, agreement?.id]);

  const allSelected = useMemo(() => {
    if (!milestones || milestones.length === 0) return false;
    return selectedSet.size === milestones.length;
  }, [milestones, selectedSet]);

  const selectedCount = selectedSet.size;

  function toggleAll(checked) {
    const next = new Set();
    if (checked) {
      for (const m of milestones || []) next.add(m.id);
    }
    setSelectedSet(next);
  }

  function toggleOne(id) {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const headerTitle = agreement
    ? agreement.title || agreement.project_title || agreement.project?.title || `Agreement #${agreement.id}`
    : "Milestones";

  const homeowner = agreement ? agreement.homeowner_name || agreement.homeowner?.full_name || "" : "";

  async function handleAssignSelected() {
    if (!agreement) return;

    setLocalWorking(true);
    try {
      const res = await onAssignSelected({
        agreementId: agreement.id,
        subaccountId: selectedEmployeeId ? Number(selectedEmployeeId) : null,
        milestoneIds: Array.from(selectedSet),
      });
      if (res?.ok) setSelectedSet(new Set());
    } finally {
      setLocalWorking(false);
    }
  }

  async function handleClearSelected() {
    if (!agreement) return;

    setLocalWorking(true);
    try {
      const res = await onClearOverrides({
        agreementId: agreement.id,
        milestoneIds: Array.from(selectedSet),
      });
      if (res?.ok) setSelectedSet(new Set());
    } finally {
      setLocalWorking(false);
    }
  }

  if (!open) return null;

  const disableUI = busy || localWorking;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* overlay */}
      <div className="absolute inset-0 bg-black/40" onMouseDown={onClose} />

      {/* drawer */}
      <div
        className="absolute right-0 top-0 h-full w-[560px] max-w-[92vw] bg-white shadow-2xl border-l border-gray-200 flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* top bar */}
        <div className="p-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-bold">Milestones</div>
            <div className="text-sm text-gray-600 truncate">
              <b>{headerTitle}</b>
              {homeowner ? <span className="text-gray-500"> — {homeowner}</span> : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* employee + actions */}
        <div className="p-4 border-b border-gray-200 space-y-3">
          <div>
            <div className="text-sm font-semibold text-gray-800 mb-2">Assign employee</div>
            <select
              value={selectedEmployeeId || ""}
              onChange={async (e) => {
                const val = e.target.value;
                onChangeSelectedEmployee(val);
                if (agreement?.id && val) {
                  await onRunConflictCheck(agreement.id, val);
                }
              }}
              disabled={disableUI}
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">— Select employee —</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {(s.display_name || "Employee")} — {s.email} ({s.role})
                </option>
              ))}
            </select>
          </div>

          {conflicts?.message ? (
            conflicts.ok === false ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <b>Blocked:</b> {conflicts.message}
              </div>
            ) : conflicts?.conflicts?.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <b>Warning:</b> {conflicts.message}
              </div>
            ) : null
          ) : null}

          <div className="flex flex-wrap gap-2">
            <SmallButton
              onClick={handleAssignSelected}
              disabled={disableUI || !selectedEmployeeId || selectedCount === 0}
              title="Assign selected milestones as overrides"
            >
              Assign Selected
            </SmallButton>

            <SmallButton
              tone="secondary"
              onClick={handleClearSelected}
              disabled={disableUI || selectedCount === 0}
              title="Clear overrides for selected milestones"
            >
              Clear Overrides
            </SmallButton>

            <div className="ml-auto text-xs text-gray-500 flex items-center">
              {selectedCount} selected
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Tip: Agreement assignment controls visibility; milestone overrides let you assign specific tasks to different employees.
          </div>
        </div>

        {/* list header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => toggleAll(e.target.checked)}
              disabled={disableUI || (milestones || []).length === 0}
            />
            Select all
          </label>

          <div className="text-xs text-gray-500">
            {agreement ? `Agreement #${agreement.id}` : ""}
          </div>
        </div>

        {/* milestone table */}
        <div className="flex-1 overflow-auto p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 border-b">
                <tr>
                  <th className="py-2 pr-3">SEL</th>
                  <th className="py-2 pr-3">TITLE</th>
                  <th className="py-2 pr-3">START</th>
                  <th className="py-2 pr-3">DUE</th>
                  <th className="py-2 pr-3">AMOUNT</th>
                  <th className="py-2 pr-3">STATUS</th>
                  <th className="py-2 pr-3">OVERRIDE</th>
                </tr>
              </thead>
              <tbody>
                {(milestones || []).map((m) => {
                  const override = milestoneOverrides?.[m.id];
                  const checked = selectedSet.has(m.id);

                  const status = m.completed ? "Completed" : m.is_invoiced ? "Invoiced" : "Open";

                  return (
                    <tr key={m.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(m.id)}
                          disabled={disableUI}
                        />
                      </td>

                      <td className="py-2 pr-3 font-semibold">
                        <div className="max-w-[220px] truncate" title={m.title}>
                          {m.title}
                        </div>
                      </td>

                      <td className="py-2 pr-3">{fmtDate(m.start_date)}</td>
                      <td className="py-2 pr-3">{fmtDate(m.completion_date)}</td>
                      <td className="py-2 pr-3">{fmtMoney(m.amount)}</td>

                      <td className="py-2 pr-3">
                        {m.completed ? <Chip>Completed</Chip> : m.is_invoiced ? <Chip tone="warn">Invoiced</Chip> : <Chip>Open</Chip>}
                      </td>

                      <td className="py-2 pr-3">
                        {override ? (
                          <Chip>
                            {override.display_name || "Employee"} ({override.email || "—"})
                          </Chip>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {(milestones || []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-3 text-gray-500">
                      No milestones found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {/* bottom bar */}
        <div className="p-4 border-t border-gray-200 flex items-center justify-end">
          <SmallButton tone="secondary" onClick={onClose} disabled={disableUI} title="Close drawer">
            Done
          </SmallButton>
        </div>
      </div>
    </div>
  );
}
