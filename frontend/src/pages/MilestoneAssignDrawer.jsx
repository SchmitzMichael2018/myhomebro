// src/components/MilestoneAssignDrawer.jsx
// v2026-01-08 — Option A milestone drawer (bulk select + assign/clear overrides)

import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

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
      ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
      : tone === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : "border border-gray-300 bg-white text-gray-800 hover:bg-gray-50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${cls}`}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
      {children}
    </div>
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

  const employeeOptions = useMemo(
    () =>
      (subs || []).filter((sub) => {
        const role = String(sub?.role || "").toLowerCase();
        return role && !role.includes("subcontractor");
      }),
    [subs]
  );
  const subcontractorOptions = useMemo(
    () =>
      (subs || []).filter((sub) => {
        const role = String(sub?.role || "").toLowerCase();
        return role.includes("subcontractor");
      }),
    [subs]
  );

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
    : "Work";

  const homeowner = agreement ? agreement.homeowner_name || agreement.homeowner?.full_name || "" : "";
  const selectedAssignee = [...employeeOptions, ...subcontractorOptions].find(
    (sub) => String(sub.id) === String(selectedEmployeeId || "")
  );
  const assignmentMode = selectedAssignee
    ? String(selectedAssignee.role || "").toLowerCase().includes("subcontractor")
      ? "Subcontractor milestone assignment"
      : "Employee milestone assignment"
    : "Milestone assignment";

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
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onMouseDown={onClose} />

      {/* drawer */}
      <div
        className="absolute right-0 top-0 flex h-full w-[840px] max-w-[96vw] flex-col border-l border-slate-300 bg-slate-100 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        data-testid="assign-work-drawer"
      >
        {/* top bar */}
        <div className="border-b border-slate-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Assign Work</div>
              <div className="mt-1 truncate text-xl font-bold text-slate-950" title={headerTitle}>
                {headerTitle}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span>
                  Customer: <span className="font-semibold text-slate-800">{homeowner || "Not listed"}</span>
                </span>
                <span className="hidden text-slate-300 sm:inline">|</span>
                <span>{assignmentMode}</span>
                {agreement ? (
                  <>
                    <span className="hidden text-slate-300 sm:inline">|</span>
                    <span>Agreement #{agreement.id}</span>
                  </>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              title="Close"
              aria-label="Close assign work"
            >
              Close
            </button>
          </div>
          <div className="hidden">
            <div className="text-lg font-bold">Assign Work</div>
            <div className="text-sm text-gray-600 truncate">
              <b>{headerTitle}</b>
              {homeowner ? <span className="text-gray-500"> — {homeowner}</span> : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="hidden"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* employee + actions */}
        <div className="space-y-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <FieldLabel>Assignment target</FieldLabel>
                <div className="mt-1 text-sm font-semibold text-slate-900">Choose who will receive selected milestone work</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                  Employees {employeeOptions.length}
                </span>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-700">
                  Subcontractors {subcontractorOptions.length}
                </span>
              </div>
            </div>

            <div className="mt-2 text-sm text-slate-500">
              Select an employee or subcontractor to assign the selected milestones.
            </div>

            <div className="mt-4">
              <FieldLabel>Employee or subcontractor</FieldLabel>
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
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              data-testid="assign-work-assignee-select"
            >
              <option value="">— Select employee or subcontractor —</option>
              {employeeOptions.length ? (
                <optgroup label="Employees">
                  {employeeOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.display_name || "Employee")} — {s.email} ({s.role})
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {subcontractorOptions.length ? (
                <optgroup label="Subcontractors">
                  {subcontractorOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.display_name || "Subcontractor")} — {s.email} ({s.role})
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            </div>
          </div>

          {subcontractorOptions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-800">No subcontractors yet</div>
              <div className="mt-1 text-xs text-slate-500">
                Add one now if you want to assign work to a subcontractor later.
              </div>
              <div className="mt-3">
                <Link
                  to="/app/team/subcontractors"
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  data-testid="add-subcontractor-link"
                >
                  Add Subcontractor
                </Link>
              </div>
            </div>
          ) : null}

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

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <FieldLabel>Milestone actions</FieldLabel>
              <div className="mt-1 text-sm text-slate-600">
                {selectedCount} milestone{selectedCount === 1 ? "" : "s"} selected
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
            <SmallButton
              onClick={handleAssignSelected}
              disabled={disableUI || !selectedEmployeeId || selectedCount === 0}
              title="Assign selected milestones to the selected employee"
            >
              Assign selected
            </SmallButton>

            <SmallButton
              tone="secondary"
              onClick={handleClearSelected}
              disabled={disableUI || selectedCount === 0}
              title="Remove assignment from selected milestones"
            >
              Remove Assignment
            </SmallButton>
            </div>
          </div>
          </div>

          <div className="text-xs text-slate-500">
            Tip: Project owner controls visibility; milestone assignment lets you assign specific tasks to different team members.
          </div>
        </div>

        {/* list header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
          <label className="flex items-center gap-3 text-sm font-semibold text-slate-800">
            <input
              className="h-4 w-4 rounded border-slate-300"
              type="checkbox"
              checked={allSelected}
              onChange={(e) => toggleAll(e.target.checked)}
              disabled={disableUI || (milestones || []).length === 0}
            />
            Select all
          </label>

          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            {(milestones || []).length} milestone{(milestones || []).length === 1 ? "" : "s"}
          </div>
        </div>

        {/* milestone table */}
        <div className="flex-1 overflow-auto bg-slate-100 p-5">
          <div className="mb-3">
            <FieldLabel>Milestone selection</FieldLabel>
            <div className="mt-1 text-sm text-slate-600">
              Select the specific milestones to assign or remove. Existing assignment behavior is unchanged.
            </div>
          </div>
          {(milestones || []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">No milestones found</div>
              <div className="mt-1">This agreement does not have milestones available for assignment yet.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {(milestones || []).map((m) => {
                const override = milestoneOverrides?.[m.id];
                const checked = selectedSet.has(m.id);
                const statusLabel = m.completed ? "Completed" : m.is_invoiced ? "Invoiced" : "Open";

                return (
                  <label
                    key={m.id}
                    className={[
                      "grid cursor-pointer gap-3 rounded-2xl border bg-white p-4 shadow-sm transition md:grid-cols-[auto_minmax(0,1fr)_auto]",
                      checked ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300",
                    ].join(" ")}
                    data-testid={`assign-work-milestone-row-${m.id}`}
                  >
                    <div className="flex items-start pt-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(m.id)}
                        disabled={disableUI}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-base font-bold text-slate-950" title={m.title}>
                          {m.title || "Untitled milestone"}
                        </div>
                        {m.completed ? <Chip>Completed</Chip> : m.is_invoiced ? <Chip tone="warn">Invoiced</Chip> : <Chip>Open</Chip>}
                      </div>
                      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Start</div>
                          <div className="mt-1 font-semibold text-slate-800">{fmtDate(m.start_date)}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Due</div>
                          <div className="mt-1 font-semibold text-slate-800">{fmtDate(m.completion_date)}</div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Amount</div>
                          <div className="mt-1 font-semibold text-slate-800">{fmtMoney(m.amount)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-[180px] md:text-right">
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Assignment</div>
                      <div className="mt-2">
                        {override ? (
                          <Chip>
                            {override.display_name || "Employee"} ({override.email || "Not listed"})
                          </Chip>
                        ) : (
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                            Unassigned
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="sr-only">{statusLabel}</span>
                  </label>
                );
              })}
            </div>
          )}
          <div className="hidden">
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
        <div className="flex items-center justify-end border-t border-slate-200 bg-white px-5 py-4">
          <SmallButton tone="secondary" onClick={onClose} disabled={disableUI} title="Close drawer">
            Done
          </SmallButton>
        </div>
      </div>
    </div>
  );
}
