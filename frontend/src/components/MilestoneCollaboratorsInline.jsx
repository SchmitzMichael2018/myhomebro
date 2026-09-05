import React, { useEffect, useMemo, useState } from "react";
import {
  addMilestoneCollaborator,
  fetchMilestoneAssignmentStatus,
  removeMilestoneCollaborator,
} from "../api/assignments";
import { listSubaccountsArray } from "../api/subaccounts";

export default function MilestoneCollaboratorsInline({ milestoneId, disabled = false, onUpdated }) {
  const [employees, setEmployees] = useState([]);
  const [collaborators, setCollaborators] = useState([]);
  const [primaryId, setPrimaryId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = async () => {
    if (!milestoneId) return;
    setError("");
    try {
      const [employeeRows, status] = await Promise.all([
        listSubaccountsArray(),
        fetchMilestoneAssignmentStatus(milestoneId),
      ]);
      setEmployees(employeeRows.filter((row) => row.is_active !== false));
      setCollaborators(status?.collaborator_subaccounts || []);
      setPrimaryId(status?.override_subaccount?.id || null);
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || "Could not load milestone crew.");
    }
  };

  useEffect(() => {
    load();
  }, [milestoneId]);

  const collaboratorIds = useMemo(
    () => new Set(collaborators.map((row) => Number(row.id))),
    [collaborators]
  );

  const toggle = async (employee) => {
    const employeeId = Number(employee.id);
    setBusyId(employeeId);
    setError("");
    try {
      if (collaboratorIds.has(employeeId)) {
        await removeMilestoneCollaborator(milestoneId, employeeId);
      } else {
        await addMilestoneCollaborator(milestoneId, employeeId);
      }
      await load();
      await onUpdated?.();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.detail || "Could not update milestone crew.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-testid={`milestone-collaborators-${milestoneId}`} className="rounded-xl border border-white/10 bg-[#041735]/80 p-4 text-white">
      <div className="font-bold">Additional Team Members</div>
      <p className="mt-1 text-sm text-sky-100/65">Add crew members who can view this milestone, upload evidence, comment, and submit the work for review.</p>
      {error ? <div className="mt-3 rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {employees.map((employee) => {
          const id = Number(employee.id);
          const checked = collaboratorIds.has(id);
          const isPrimary = id === Number(primaryId);
          return (
            <label key={employee.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${checked ? "border-emerald-300/40 bg-emerald-400/10" : "border-white/10 bg-white/5"} ${isPrimary ? "opacity-60" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                checked={checked || isPrimary}
                disabled={disabled || isPrimary || busyId === id}
                onChange={() => toggle(employee)}
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{employee.display_name || employee.email || "Team member"}</span>
                <span className="block truncate text-xs text-sky-100/55">{isPrimary ? "Primary worker" : checked ? "Collaborator" : employee.email}</span>
              </span>
            </label>
          );
        })}
      </div>
      {!employees.length ? <div className="mt-3 text-sm text-sky-100/60">No active team members are available.</div> : null}
    </div>
  );
}
