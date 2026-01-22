// src/pages/MilestonesAssign.jsx
import React, { useEffect, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";

import AssignEmployeeInline from "../components/AssignEmployeeInline";
import {
  assignMilestoneToSubaccount,
  unassignMilestone,
  fetchMilestoneAssignmentStatus,
} from "../api/assignments";

export default function MilestonesAssign() {
  const [loading, setLoading] = useState(true);
  const [milestones, setMilestones] = useState([]);
  const [overrideMap, setOverrideMap] = useState({}); // milestoneId -> [override]

  async function load() {
    setLoading(true);
    try {
      const res = await api.get("/projects/milestones/", { params: { page_size: 250 } });
      const items = Array.isArray(res.data) ? res.data : res.data?.results || [];
      setMilestones(items);

      const map = {};
      for (const m of items) {
        try {
          const s = await fetchMilestoneAssignmentStatus(m.id);
          map[m.id] = s?.override_subaccount ? [s.override_subaccount] : [];
        } catch {
          map[m.id] = [];
        }
      }
      setOverrideMap(map);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load milestones.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function assign(milestoneId, subId) {
    await assignMilestoneToSubaccount(milestoneId, subId);
    toast.success("Assigned.");
    const s = await fetchMilestoneAssignmentStatus(milestoneId);
    setOverrideMap((prev) => ({
      ...prev,
      [milestoneId]: s?.override_subaccount ? [s.override_subaccount] : [],
    }));
  }

  async function unassign(milestoneId) {
    await unassignMilestone(milestoneId);
    toast.success("Unassigned.");
    const s = await fetchMilestoneAssignmentStatus(milestoneId);
    setOverrideMap((prev) => ({
      ...prev,
      [milestoneId]: s?.override_subaccount ? [s.override_subaccount] : [],
    }));
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Milestones</h1>
          <div className="text-sm text-gray-500">
            Assign milestones directly to employees (override).
          </div>
        </div>
        <button
          onClick={load}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 font-semibold hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : milestones.length === 0 ? (
        <div className="text-gray-500">No milestones found.</div>
      ) : (
        <div className="space-y-3">
          {milestones.map((m) => (
            <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-bold">{m.title}</div>
                  <div className="text-sm text-gray-500 mt-1">
                    Agreement #{m.agreement} · Amount: ${Number(m.amount || 0).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <AssignEmployeeInline
                  label="Assign This Milestone (Override)"
                  help="Only the selected employee will see this milestone (even if the agreement is assigned broadly)."
                  currentAssignees={overrideMap[m.id] || []}
                  onAssign={(subId) => assign(m.id, subId)}
                  onUnassign={() => unassign(m.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
