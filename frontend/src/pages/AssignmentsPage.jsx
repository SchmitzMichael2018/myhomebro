// frontend/src/pages/AssignmentsPage.jsx
// v2026-01-09 â€” Assignments Option A (ROW DENSITY UPDATE)
// Goal: compact row layout so it scales cleanly to 10+ agreements (no big blocks)
// v2026-02-09 â€” remove "UI v2026-01-09 (Row Density)" label

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api";

import { listSubaccounts } from "../api/subaccounts";
import {
  assignAgreementToSubaccount,
  unassignAgreementFromSubaccount,
  assignMilestoneToSubaccount,
  unassignMilestone,
  fetchAgreementAssignmentStatus,
  fetchMilestoneAssignmentStatus,
} from "../api/assignments";
import { normalizeProjectClass } from "../utils/projectClass.js";

// Drawer is in SAME pages directory (your current setup)
import MilestoneAssignDrawer from "./MilestoneAssignDrawer";

/* -----------------------------
   Helpers
----------------------------- */
const fmtMoney = (v) => {
  const n = Number(v || 0);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (d) => {
  if (!d) return "â€”";
  try {
    if (typeof d === "string" && d.length >= 10) return d.slice(0, 10);
    const dd = new Date(d);
    if (Number.isNaN(dd.getTime())) return String(d);
    return dd.toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
};

function Badge({ children, tone = "neutral" }) {
  const cls =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-gray-200 bg-gray-50 text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, disabled, tone = "primary", title, ...rest }) {
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
      {...rest}
      className={`rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60 ${cls}`}
    >
      {children}
    </button>
  );
}

function normalizeProjectClassFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "commercial" || normalized === "residential" ? normalized : "all";
}

function normalizeAssignmentStatusFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "assigned_work") return "assigned";
  if (normalized === "unassigned_work") return "unassigned";
  return ["all", "unassigned", "awaiting_review", "overdue", "assigned", "in_progress", "completed"].includes(normalized)
    ? normalized
    : "all";
}

function formatAgreementStatus(status) {
  const normalized = String(status || "").replaceAll("_", " ").trim();
  return normalized ? normalized.replace(/\b\w/g, (c) => c.toUpperCase()) : "Active";
}

function deriveAgreementProjectClass(agreement) {
  return normalizeProjectClass(agreement?.project_class || agreement?.project?.project_class);
}

function projectClassLabel(value) {
  return normalizeProjectClass(value) === "commercial" ? "Commercial" : "Residential";
}

function projectClassTone(value) {
  return normalizeProjectClass(value) === "commercial" ? "warn" : "neutral";
}

function getMilestoneAssigneeId(milestone) {
  return (
    milestone?.assigned_worker?.subaccount_id ||
    milestone?.assigned_subcontractor?.subaccount_id ||
    milestone?.subaccount_assignment?.subaccount_id ||
    milestone?.delegated_reviewer_subaccount?.id ||
    null
  );
}

function getMilestoneAssignedLabel(milestone) {
  return (
    milestone?.assigned_worker_display ||
    milestone?.assigned_subcontractor_display ||
    milestone?.assigned_worker?.display_name ||
    milestone?.assigned_subcontractor?.display_name ||
    "Unassigned"
  );
}

function getMilestoneProjectClass(milestone, agreement) {
  return normalizeProjectClass(
    milestone?.project_class ||
      milestone?.project_class_label ||
      agreement?.project_class ||
      agreement?.project?.project_class
  );
}

function getMilestoneStatus(milestone) {
  return String(milestone?.work_submission_status || milestone?.subcontractor_completion_status || "").toLowerCase();
}

function getAgreementStatusMeta(agreementId, milestones, assignees) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const milestoneList = Array.isArray(milestones) ? milestones : [];
  const assignedCount = Array.isArray(assignees) ? assignees.length : 0;
  const submittedCount = milestoneList.filter(
    (milestone) => getMilestoneStatus(milestone) === "submitted_for_review"
  ).length;
  const approvedCount = milestoneList.filter((milestone) => getMilestoneStatus(milestone) === "approved").length;
  const completedCount = milestoneList.filter(
    (milestone) => milestone?.completed === true || ["approved", "completed", "complete", "done"].includes(getMilestoneStatus(milestone))
  ).length;
  const overdueCount = milestoneList.filter((milestone) => {
    const due = milestone?.completion_date || milestone?.due_date || milestone?.end_date;
    if (!due) return false;
    const dueDate = new Date(due);
    if (Number.isNaN(dueDate.getTime())) return false;
    dueDate.setHours(0, 0, 0, 0);
    const isComplete =
      milestone?.completed === true ||
      ["approved", "completed", "complete", "done"].includes(getMilestoneStatus(milestone));
    return !isComplete && dueDate < today;
  }).length;
  const inProgressCount = milestoneList.filter((milestone) => {
    const status = getMilestoneStatus(milestone);
    return ["in_progress", "in progress", "started", "working", "pending"].includes(status);
  }).length;

  let status = "assigned";
  if (assignedCount <= 0) {
    status = "unassigned";
  } else if (overdueCount > 0) {
    status = "overdue";
  } else if (submittedCount > 0) {
    status = "awaiting_review";
  } else if (completedCount > 0 && completedCount >= milestoneList.length && milestoneList.length > 0) {
    status = "completed";
  } else if (inProgressCount > 0) {
    status = "in_progress";
  }

  return {
    agreementId,
    assignedCount,
    submittedCount,
    approvedCount,
    completedCount,
    overdueCount,
    status,
    hasAssignedWork: assignedCount > 0,
    hasStartedWork: submittedCount > 0 || approvedCount > 0 || completedCount > 0 || inProgressCount > 0,
  };
}

function isMilestoneComplete(milestone) {
  return (
    milestone?.completed === true ||
    ["approved", "completed", "complete", "done"].includes(getMilestoneStatus(milestone))
  );
}

function isMilestoneOverdue(milestone, today) {
  const due = milestone?.completion_date || milestone?.due_date || milestone?.end_date;
  if (!due) return false;
  const dueDate = new Date(due);
  if (Number.isNaN(dueDate.getTime())) return false;
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
}

function getAgreementWorkSummary(agreement, milestones, assignees) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const milestoneList = Array.isArray(milestones) ? milestones : [];
  const assigneeList = Array.isArray(assignees) ? assignees : [];
  const statusMeta = getAgreementStatusMeta(agreement?.id, milestoneList, assigneeList);

  const assignedMilestones = milestoneList.filter((milestone) => Boolean(getMilestoneAssigneeId(milestone)));
  const assignedMilestoneIds = new Set(assignedMilestones.map((milestone) => milestone.id));
  const awaitingReviewCount = milestoneList.filter(
    (milestone) =>
      Boolean(getMilestoneAssigneeId(milestone)) &&
      getMilestoneStatus(milestone) === "submitted_for_review" &&
      !isMilestoneComplete(milestone)
  ).length;
  const overdueCount = milestoneList.filter(
    (milestone) =>
      Boolean(getMilestoneAssigneeId(milestone)) &&
      !isMilestoneComplete(milestone) &&
      isMilestoneOverdue(milestone, today)
  ).length;
  const activeAssignedCount = milestoneList.filter((milestone) => {
    if (!assignedMilestoneIds.has(milestone.id)) return false;
    if (isMilestoneComplete(milestone)) return false;
    if (getMilestoneStatus(milestone) === "submitted_for_review") return false;
    if (isMilestoneOverdue(milestone, today)) return false;
    return true;
  }).length;

  const owner = assigneeList[0] || null;
  const ownerName = owner?.display_name || owner?.email || "";
  const ownerRole = owner?.role_label || owner?.role || "";
  const actionButtonLabel = assignedMilestones.length > 0 || awaitingReviewCount > 0 || overdueCount > 0 ? "View Work" : "Assign Work";

  return {
    ...statusMeta,
    totalMilestones: milestoneList.length,
    assignedMilestonesCount: assignedMilestones.length,
    unassignedMilestonesCount: Math.max(milestoneList.length - assignedMilestones.length, 0),
    awaitingReviewCount,
    overdueCount,
    activeAssignedCount,
    ownerName,
    ownerRole,
    actionButtonLabel,
    hasOwner: Boolean(ownerName),
  };
}

/* -----------------------------
   Main Page
----------------------------- */
export default function AssignmentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);

  // Agreements & milestones
  const [agreements, setAgreements] = useState([]);
  const [milestonesByAgreement, setMilestonesByAgreement] = useState({}); // agreementId -> milestones[]

  // Employees
  const [subs, setSubs] = useState([]);

  // Status maps
  const [agreementAssignees, setAgreementAssignees] = useState({}); // agreementId -> subaccounts[]
  const [milestoneOverrides, setMilestoneOverrides] = useState({}); // milestoneId -> overrideSubaccount|null

  // UI state
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [search, setSearch] = useState("");
  const [onlyWithDates, setOnlyWithDates] = useState(false);
  const projectClassFilter = useMemo(
    () => normalizeProjectClassFilter(searchParams.get("project_class")),
    [searchParams]
  );
  const assignmentStatusFilter = useMemo(
    () => normalizeAssignmentStatusFilter(searchParams.get("assignment_status")),
    [searchParams]
  );
  const subaccountFilter = useMemo(() => {
    const value = searchParams.get("subaccount");
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  // Selection state (per agreement)
  const [selectedEmployee, setSelectedEmployee] = useState({}); // agreementId -> subaccountId (string)
  const [ownerEditorOpen, setOwnerEditorOpen] = useState({}); // agreementId -> bool

  // Conflict state (per agreement) â€” safe fallback if endpoint missing
  const [conflicts, setConflicts] = useState({});
  const [busy, setBusy] = useState(false);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerAgreementId, setDrawerAgreementId] = useState(null);

  /* -----------------------------
     Load everything
  ----------------------------- */
  async function loadAll() {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        api.get("/api/projects/agreements/", { params: { page_size: 200, ordering: "-updated_at" } }),
        listSubaccounts(),
      ]);

      const aItems = Array.isArray(aRes.data) ? aRes.data : aRes.data?.results || [];
      setAgreements(aItems);
      setSubs(Array.isArray(sRes) ? sRes : []);

      const sel = {};
      for (const a of aItems) sel[String(a.id)] = "";
      setSelectedEmployee(sel);

      await hydrateAgreements(aItems);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load Assignments.");
    } finally {
      setLoading(false);
    }
  }

  async function hydrateAgreements(aItems) {
    const milestonesMap = {};
    const assigneesMap = {};
    const overridesMap = {};
    const selectionMap = {};

    for (const a of aItems) {
      const agreementId = a.id;

      try {
        const mRes = await api.get(`/api/projects/agreements/${agreementId}/milestones/`);
        const mItems = Array.isArray(mRes.data) ? mRes.data : mRes.data?.results || mRes.data?.milestones || [];
        milestonesMap[agreementId] = mItems;

        for (const m of mItems) {
          try {
            const st = await fetchMilestoneAssignmentStatus(m.id);
            overridesMap[m.id] = st?.override_subaccount || null;
          } catch {
            overridesMap[m.id] = overridesMap[m.id] ?? null;
          }
        }
      } catch {
        milestonesMap[agreementId] = [];
      }

      try {
        const stA = await fetchAgreementAssignmentStatus(agreementId);
        assigneesMap[agreementId] = stA?.assigned_subaccounts || [];
        const firstAssigneeId = assigneesMap[agreementId][0]?.id;
        if (firstAssigneeId && !selectionMap[String(agreementId)]) {
          selectionMap[String(agreementId)] = String(firstAssigneeId);
        }
      } catch {
        assigneesMap[agreementId] = [];
      }
    }

    setMilestonesByAgreement(milestonesMap);
    setAgreementAssignees(assigneesMap);
    setMilestoneOverrides(overridesMap);
    setSelectedEmployee((prev) => ({ ...prev, ...selectionMap }));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -----------------------------
     Filtering
  ----------------------------- */
  const filteredAgreements = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agreements
      .filter((a) => {
        const title = (a.title || a.project_title || a.project?.title || `Agreement #${a.id}`).toLowerCase();
        const homeowner = (a.homeowner_name || a.homeowner?.full_name || "").toLowerCase();
        const projectClass = deriveAgreementProjectClass(a);
        const milestones = milestonesByAgreement[a.id] || [];
        const assignees = agreementAssignees[a.id] || [];
        const meta = getAgreementStatusMeta(a.id, milestones, assignees);

        const matches = !q || title.includes(q) || homeowner.includes(q);
        if (!matches) return false;
        if (projectClassFilter !== "all" && projectClass !== projectClassFilter) return false;
        if (assignmentStatusFilter !== "all" && meta.status !== assignmentStatusFilter) return false;

        if (onlyWithDates) {
          const start = a.start || a.raw?.start;
          const end = a.end || a.raw?.end;
          if (!start || !end) return false;
        }

        if (subaccountFilter) {
          const assigneeIds = (agreementAssignees[a.id] || []).map((sub) => Number(sub.id));
          const milestoneMatches = (milestonesByAgreement[a.id] || []).some((milestone) => {
            const workerId = Number(getMilestoneAssigneeId(milestone));
            return workerId && workerId === Number(subaccountFilter);
          });
          if (!assigneeIds.includes(Number(subaccountFilter)) && !milestoneMatches) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => b.id - a.id);
  }, [
    agreements,
    agreementAssignees,
    assignmentStatusFilter,
    milestonesByAgreement,
    onlyWithDates,
    projectClassFilter,
    search,
    subaccountFilter,
  ]);

  const statusCounts = useMemo(() => {
    const counts = {
      all: agreements.length,
      unassigned: 0,
      awaiting_review: 0,
      overdue: 0,
      assigned: 0,
      in_progress: 0,
      completed: 0,
    };

    agreements.forEach((agreement) => {
      const summary = getAgreementWorkSummary(
        agreement,
        milestonesByAgreement[agreement.id] || [],
        agreementAssignees[agreement.id] || []
      );
      if (summary.status === "unassigned") counts.unassigned += 1;
      else if (summary.status === "awaiting_review") counts.awaiting_review += 1;
      else if (summary.status === "overdue") counts.overdue += 1;
      else if (summary.status === "assigned") counts.assigned += 1;
      else if (summary.status === "in_progress") counts.in_progress += 1;
      else if (summary.status === "completed") counts.completed += 1;
    });

    return counts;
  }, [agreementAssignees, agreements, milestonesByAgreement]);

  const updateQueryParam = (key, value) => {
    const params = new URLSearchParams(location.search);
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    navigate(`${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`, {
      replace: true,
    });
  };

  /* -----------------------------
     Conflict check (safe fallback)
  ----------------------------- */
  async function runConflictCheck(agreementId, subaccountId) {
    if (!subaccountId) return { ok: true, is_supervisor: false, conflicts: [], message: "" };

    try {
      const res = await api.post("/api/projects/assignments/check-conflicts/", {
        subaccount_id: Number(subaccountId),
        agreement_id: Number(agreementId),
      });

      setConflicts((prev) => ({ ...prev, [agreementId]: res.data }));
      return res.data;
    } catch {
      const fallback = { ok: true, is_supervisor: false, conflicts: [], message: "" };
      setConflicts((prev) => ({ ...prev, [agreementId]: fallback }));
      return fallback;
    }
  }

  /* -----------------------------
     Agreement-level owner assign/unassign
  ----------------------------- */
  async function assignAgreement(agreementId) {
    const subId = selectedEmployee[String(agreementId)];
    if (!subId) {
      toast.error("Select an employee first.");
      return false;
    }

    setBusy(true);
    try {
      const chk = await runConflictCheck(agreementId, subId);
      const isSupervisor = !!chk?.is_supervisor;

      if (chk && chk.ok === false && !isSupervisor) {
        toast.error(chk.message || "Conflict detected. Assignment blocked.");
        return false;
      }

      await assignAgreementToSubaccount(agreementId, Number(subId));
      toast.success("Owner assigned.");

      try {
        const stA = await fetchAgreementAssignmentStatus(agreementId);
        setAgreementAssignees((prev) => ({ ...prev, [agreementId]: stA?.assigned_subaccounts || [] }));
      } catch {}
      return true;
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Agreement assignment failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function unassignAgreement(agreementId) {
    const subId = selectedEmployee[String(agreementId)];
    if (!subId) {
      toast.error("Select an employee first.");
      return false;
    }

    setBusy(true);
    try {
      await unassignAgreementFromSubaccount(agreementId, Number(subId));
      toast.success("Owner removed.");

      try {
        const stA = await fetchAgreementAssignmentStatus(agreementId);
        setAgreementAssignees((prev) => ({ ...prev, [agreementId]: stA?.assigned_subaccounts || [] }));
      } catch {}
      return true;
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Agreement unassign failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveOwner(agreementId, agreementTitle, ownerName) {
    const message = `Remove project owner?\nThis will remove ${ownerName} as the project owner for ${agreementTitle}. It will not change milestone assignments.`;
    if (typeof window !== "undefined" && !window.confirm(message)) return;
    const ok = await unassignAgreement(agreementId);
    if (ok) closeOwnerEditor(agreementId);
  }

  function openOwnerEditor(agreementId, ownerId = "") {
    setSelectedEmployee((prev) => ({ ...prev, [String(agreementId)]: ownerId ? String(ownerId) : "" }));
    setOwnerEditorOpen((prev) => ({ ...prev, [String(agreementId)]: true }));
  }

  function closeOwnerEditor(agreementId) {
    setOwnerEditorOpen((prev) => ({ ...prev, [String(agreementId)]: false }));
  }

  /* -----------------------------
     Drawer open/close
  ----------------------------- */
  function openDrawer(agreementId) {
    setDrawerAgreementId(agreementId);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerAgreementId(null);
  }

  async function refreshOverridesForAgreement(agreementId) {
    const list = milestonesByAgreement[agreementId] || [];
    if (!list.length) return;

    const newOverrides = { ...milestoneOverrides };
    for (const m of list) {
      try {
        const st = await fetchMilestoneAssignmentStatus(m.id);
        newOverrides[m.id] = st?.override_subaccount || null;
      } catch {}
    }
    setMilestoneOverrides(newOverrides);
  }

  async function bulkAssignMilestoneOverrides({ agreementId, subaccountId, milestoneIds }) {
    if (!subaccountId) {
      toast.error("Select an employee first.");
      return { ok: false };
    }
    if (!milestoneIds || milestoneIds.length === 0) {
      toast.error("Select at least one milestone.");
      return { ok: false };
    }

    setBusy(true);
    try {
      const chk = await runConflictCheck(agreementId, subaccountId);
      const isSupervisor = !!chk?.is_supervisor;

      if (chk && chk.ok === false && !isSupervisor) {
        toast.error(chk.message || "Conflict detected. Assignment blocked.");
        return { ok: false };
      }

      for (const milestoneId of milestoneIds) {
        await assignMilestoneToSubaccount(milestoneId, Number(subaccountId));
      }

      toast.success("Milestones assigned.");
      await refreshOverridesForAgreement(agreementId);
      return { ok: true };
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Assignment failed.");
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }

  async function bulkClearOverrides({ agreementId, milestoneIds }) {
    if (!milestoneIds || milestoneIds.length === 0) {
      toast.error("Select at least one milestone.");
      return { ok: false };
    }

    setBusy(true);
    try {
      for (const milestoneId of milestoneIds) {
        await unassignMilestone(milestoneId);
      }
      toast.success("Overrides cleared.");
      await refreshOverridesForAgreement(agreementId);
      return { ok: true };
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Unassign failed.");
      return { ok: false };
    } finally {
      setBusy(false);
    }
  }

  const drawerAgreement = useMemo(() => {
    if (!drawerAgreementId) return null;
    return agreements.find((a) => String(a.id) === String(drawerAgreementId)) || null;
  }, [drawerAgreementId, agreements]);

  /* -----------------------------
     Render
  ----------------------------- */
  return (
    <div className="mx-auto max-w-[1120px] space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Assignments</h1>
          <div className="mhb-helper-text mt-4">
            All projects stay visible here. Use the owner controls for project supervision and the drawer for milestone work.
          </div>
        </div>

        <Btn tone="secondary" onClick={loadAll} disabled={busy || loading} title="Reload">
          Refresh
        </Btn>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agreements (title/homeowner)…"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={onlyWithDates}
                onChange={(e) => setOnlyWithDates(e.target.checked)}
              />
              Show only agreements with dates
            </label>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={projectClassFilter}
                onChange={(e) => updateQueryParam("project_class", e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                data-testid="assignments-project-class-filter"
              >
                <option value="all">All Projects</option>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
              </select>

              {[
                ["all", `All Projects (${statusCounts.all})`],
                ["assigned", `Assigned Work (${statusCounts.assigned})`],
                ["unassigned", `Unassigned Work (${statusCounts.unassigned})`],
                ["awaiting_review", `Awaiting Review (${statusCounts.awaiting_review})`],
                ["overdue", `Overdue Work (${statusCounts.overdue})`],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-testid={`assignments-status-filter-${key}`}
                  onClick={() => updateQueryParam("assignment_status", key)}
                  className={[
                    "rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                    assignmentStatusFilter === key
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="text-xs text-gray-500">
              {subaccountFilter ? `Filtered to one team member (ID ${subaccountFilter}).` : "Use the team links to jump into a filtered work view."}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : filteredAgreements.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-gray-500">
          No projects match your filters. Clear the project type or status chips to see more work.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAgreements.map((a) => {
            const agreementId = a.id;
            const title = a.title || a.project_title || a.project?.title || `Agreement #${agreementId}`;
            const homeowner = a.homeowner_name || a.homeowner?.full_name || "—";
            const start = a.start || a.raw?.start;
            const end = a.end || a.raw?.end;
            const ms = milestonesByAgreement[agreementId] || [];
            const assignees = agreementAssignees[agreementId] || [];
            const summary = getAgreementWorkSummary(a, ms, assignees);
            const projectClass = deriveAgreementProjectClass(a);
            const ownerId = assignees[0]?.id ? String(assignees[0].id) : "";
            const ownerLine = summary.hasOwner
              ? `${summary.ownerName}${summary.ownerRole ? ` • ${summary.ownerRole}` : ""}`
              : "No owner";

            const statusLabel =
              summary.status === "unassigned"
                ? "Unassigned"
                : summary.status === "awaiting_review"
                  ? "Awaiting Review"
                  : summary.status === "overdue"
                    ? "Overdue"
                    : summary.status === "completed"
                      ? "Completed"
                      : "Active";

            const statusTone =
              summary.status === "overdue"
                ? "danger"
                : summary.status === "awaiting_review"
                  ? "warn"
                  : summary.status === "completed"
                    ? "good"
                    : summary.status === "unassigned"
                      ? "neutral"
                      : "good";

            return (
              <div
                key={agreementId}
                data-testid={`assignment-row-${agreementId}`}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-bold text-slate-900" title={title}>
                        {title}
                      </div>
                      <div className="mt-1 truncate text-sm text-gray-500" title={homeowner}>
                        Customer: {homeowner}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Owner:</span>
                        {" "}
                        <span>{ownerLine}</span>
                        <span className="text-slate-300">|</span>
                        <span>{fmtDate(start)}</span>
                        {end ? (
                          <>
                            <span className="text-slate-300">•</span>
                            <span>{fmtDate(end)}</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700">
                        Total {summary.totalMilestones}
                      </span>
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
                        Assigned {summary.assignedMilestonesCount}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-700">
                        Unassigned {summary.unassignedMilestonesCount}
                      </span>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
                        Review {summary.awaitingReviewCount}
                      </span>
                      <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-800">
                        Overdue {summary.overdueCount}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge tone={projectClassTone(projectClass)}>{projectClassLabel(projectClass)}</Badge>
                      <Badge tone={statusTone}>{formatAgreementStatus(statusLabel)}</Badge>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    <Btn
                      tone="secondary"
                      onClick={() => openOwnerEditor(agreementId, ownerId)}
                      disabled={busy}
                      title={summary.hasOwner ? "Change project owner" : "Assign project owner"}
                      data-testid={`assignment-owner-button-${agreementId}`}
                    >
                      {summary.hasOwner ? "Change Owner" : "Assign Owner"}
                    </Btn>

                    {summary.hasOwner ? (
                      <Btn
                        tone="secondary"
                        onClick={() => confirmRemoveOwner(agreementId, title, summary.ownerName)}
                        disabled={busy}
                        title="Remove project owner"
                        data-testid={`assignment-remove-owner-button-${agreementId}`}
                      >
                        Remove Owner
                      </Btn>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => openDrawer(agreementId)}
                      disabled={busy}
                      className="shrink-0 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                      title={summary.actionButtonLabel}
                      data-testid={`assignment-work-button-${agreementId}`}
                    >
                      {summary.actionButtonLabel}
                    </button>
                  </div>
                </div>

                {ownerEditorOpen[String(agreementId)] ? (
                  <div
                    className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 sm:p-4"
                    data-testid={`assignment-owner-editor-${agreementId}`}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Project Owner / Supervisor
                      </div>
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div className="min-w-0">
                          <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Select owner / supervisor
                          </label>
                          <select
                            value={selectedEmployee[String(agreementId)] || ""}
                            onChange={async (e) => {
                              const val = e.target.value;
                              setSelectedEmployee((prev) => ({ ...prev, [String(agreementId)]: val }));
                              if (val) await runConflictCheck(agreementId, val);
                            }}
                            disabled={busy}
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                            title="Select owner or supervisor"
                            data-testid={`assignment-owner-select-${agreementId}`}
                          >
                            <option value="">— Select —</option>
                            {subs.map((s) => (
                              <option key={s.id} value={s.id}>
                                {(s.display_name || "Employee")} ({s.role})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Btn
                            onClick={async () => {
                              const ok = await assignAgreement(agreementId);
                              if (ok) closeOwnerEditor(agreementId);
                            }}
                            disabled={busy || !selectedEmployee[String(agreementId)]}
                            title={summary.hasOwner ? "Change project owner" : "Assign project owner"}
                          >
                            Save
                          </Btn>
                          <Btn tone="secondary" onClick={() => closeOwnerEditor(agreementId)} disabled={busy}>
                            Cancel
                          </Btn>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {/* Drawer */}
      <MilestoneAssignDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        busy={busy}
        agreement={drawerAgreement}
        subs={subs}
        selectedEmployeeId={drawerAgreementId ? selectedEmployee[String(drawerAgreementId)] || "" : ""}
        onChangeSelectedEmployee={(val) => {
          if (!drawerAgreementId) return;
          setSelectedEmployee((prev) => ({ ...prev, [String(drawerAgreementId)]: val }));
        }}
        onRunConflictCheck={runConflictCheck}
        conflicts={drawerAgreementId ? conflicts[drawerAgreementId] : null}
        milestones={drawerAgreementId ? milestonesByAgreement[drawerAgreementId] || [] : []}
        milestoneOverrides={milestoneOverrides}
        fmtDate={fmtDate}
        fmtMoney={fmtMoney}
        onAssignSelected={bulkAssignMilestoneOverrides}
        onClearOverrides={bulkClearOverrides}
      />
    </div>
  );
}


