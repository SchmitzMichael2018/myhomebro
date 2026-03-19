// frontend/src/pages/AssignmentsPage.jsx
// v2026-01-09 — Assignments Option A (ROW DENSITY UPDATE)
// Goal: compact row layout so it scales cleanly to 10+ agreements (no big blocks)
// v2026-02-09 — remove "UI v2026-01-09 (Row Density)" label

import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
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
  if (!d) return "—";
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
    tone === "warn"
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

function Btn({ children, onClick, disabled, tone = "primary", title }) {
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

function AssignedMiniLine({ assignees }) {
  if (!assignees || assignees.length === 0) return <span className="text-gray-500">—</span>;
  // show first + count
  const first = assignees[0];
  const more = assignees.length - 1;
  return (
    <span className="text-gray-700">
      <span className="font-semibold">{first.display_name || "Employee"}</span>
      {first.email ? <span className="text-gray-500"> ({first.email})</span> : null}
      {more > 0 ? <span className="text-gray-500"> +{more}</span> : null}
    </span>
  );
}

/* -----------------------------
   Main Page
----------------------------- */
export default function AssignmentsPage() {
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
  const [search, setSearch] = useState("");
  const [onlyWithDates, setOnlyWithDates] = useState(false);

  // Selection state (per agreement)
  const [selectedEmployee, setSelectedEmployee] = useState({}); // agreementId -> subaccountId (string)

  // Conflict state (per agreement) — safe fallback if endpoint missing
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

      // init selection map
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

    for (const a of aItems) {
      const agreementId = a.id;

      // milestones
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

      // agreement assignment status
      try {
        const stA = await fetchAgreementAssignmentStatus(agreementId);
        assigneesMap[agreementId] = stA?.assigned_subaccounts || [];
      } catch {
        assigneesMap[agreementId] = [];
      }
    }

    setMilestonesByAgreement(milestonesMap);
    setAgreementAssignees(assigneesMap);
    setMilestoneOverrides(overridesMap);
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

        const matches = !q || title.includes(q) || homeowner.includes(q);
        if (!matches) return false;

        if (onlyWithDates) {
          const start = a.start || a.raw?.start;
          const end = a.end || a.raw?.end;
          if (!start || !end) return false;
        }
        return true;
      })
      .sort((a, b) => b.id - a.id);
  }, [agreements, search, onlyWithDates]);

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
     Agreement-level assign/unassign
  ----------------------------- */
  async function assignAgreement(agreementId) {
    const subId = selectedEmployee[String(agreementId)];
    if (!subId) return toast.error("Select an employee first.");

    setBusy(true);
    try {
      const chk = await runConflictCheck(agreementId, subId);
      const isSupervisor = !!chk?.is_supervisor;

      if (chk && chk.ok === false && !isSupervisor) {
        toast.error(chk.message || "Conflict detected. Assignment blocked.");
        return;
      }

      await assignAgreementToSubaccount(agreementId, Number(subId));
      toast.success("Agreement assigned.");

      try {
        const stA = await fetchAgreementAssignmentStatus(agreementId);
        setAgreementAssignees((prev) => ({ ...prev, [agreementId]: stA?.assigned_subaccounts || [] }));
      } catch {}
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Agreement assignment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function unassignAgreement(agreementId) {
    const subId = selectedEmployee[String(agreementId)];
    if (!subId) return toast.error("Select an employee first.");

    setBusy(true);
    try {
      await unassignAgreementFromSubaccount(agreementId, Number(subId));
      toast.success("Agreement unassigned.");

      try {
        const stA = await fetchAgreementAssignmentStatus(agreementId);
        setAgreementAssignees((prev) => ({ ...prev, [agreementId]: stA?.assigned_subaccounts || [] }));
      } catch {}
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Agreement unassign failed.");
    } finally {
      setBusy(false);
    }
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
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Assignments</h1>
          <div className="mhb-helper-text mt-4">
            Compact rows + milestone drawer. Overlaps can be enforced later; this UI is designed to scale.
          </div>
          {/* ✅ Removed: UI v2026-01-09 (Row Density) */}
        </div>

        <Btn tone="secondary" onClick={loadAll} disabled={busy || loading} title="Reload">
          Refresh
        </Btn>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agreements (title/homeowner)…"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2"
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={onlyWithDates} onChange={(e) => setOnlyWithDates(e.target.checked)} />
            Show only agreements with dates
          </label>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : filteredAgreements.length === 0 ? (
        <div className="text-gray-500">No agreements match your filters.</div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {/* header row */}
          <div className="grid grid-cols-12 gap-3 px-4 py-3 text-xs font-semibold text-gray-500 border-b bg-gray-50">
            <div className="col-span-4">Agreement</div>
            <div className="col-span-2">Dates</div>
            <div className="col-span-2">Milestones</div>
            <div className="col-span-2">Assigned</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          {/* rows */}
          <div className="divide-y">
            {filteredAgreements.map((a) => {
              const agreementId = a.id;
              const title = a.title || a.project_title || a.project?.title || `Agreement #${agreementId}`;
              const homeowner = a.homeowner_name || a.homeowner?.full_name || "—";
              const start = a.start || a.raw?.start;
              const end = a.end || a.raw?.end;

              const ms = milestonesByAgreement[agreementId] || [];
              const assignees = agreementAssignees[agreementId] || [];

              return (
                <div key={agreementId} className="grid grid-cols-12 gap-3 px-4 py-3 items-center">
                  {/* Agreement */}
                  <div className="col-span-4 min-w-0">
                    <div className="font-bold truncate" title={title}>
                      {title}
                    </div>
                    <div className="text-xs text-gray-500 truncate" title={homeowner}>
                      Homeowner: {homeowner}
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="col-span-2 text-sm text-gray-700">
                    <div className="whitespace-nowrap">{fmtDate(start)}</div>
                    <div className="whitespace-nowrap text-gray-500">{fmtDate(end)}</div>
                  </div>

                  {/* Milestones */}
                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <Badge>{ms.length}</Badge>
                      <span className="text-xs text-gray-500">total</span>
                    </div>
                  </div>

                  {/* Assigned */}
                  <div className="col-span-2">
                    <AssignedMiniLine assignees={assignees} />
                  </div>

                  {/* Actions */}
                  <div className="col-span-2 flex flex-col gap-2 items-end">
                    <select
                      value={selectedEmployee[String(agreementId)] || ""}
                      onChange={async (e) => {
                        const val = e.target.value;
                        setSelectedEmployee((prev) => ({ ...prev, [String(agreementId)]: val }));
                        if (val) await runConflictCheck(agreementId, val);
                      }}
                      disabled={busy}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                      title="Select employee"
                    >
                      <option value="">— Select —</option>
                      {subs.map((s) => (
                        <option key={s.id} value={s.id}>
                          {(s.display_name || "Employee")} ({s.role})
                        </option>
                      ))}
                    </select>

                    <div className="flex gap-2 justify-end">
                      <Btn
                        onClick={() => assignAgreement(agreementId)}
                        disabled={busy || !selectedEmployee[String(agreementId)]}
                        title="Assign agreement to selected employee"
                      >
                        Assign
                      </Btn>

                      <Btn
                        tone="secondary"
                        onClick={() => unassignAgreement(agreementId)}
                        disabled={busy || !selectedEmployee[String(agreementId)]}
                        title="Unassign agreement"
                      >
                        Unassign
                      </Btn>

                      <Btn
                        tone="secondary"
                        onClick={() => openDrawer(agreementId)}
                        disabled={busy}
                        title="Open milestone drawer"
                      >
                        Milestones
                      </Btn>
                    </div>

                    <div className="mhb-helper-text">Use drawer for milestone overrides.</div>
                  </div>
                </div>
              );
            })}
          </div>
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
