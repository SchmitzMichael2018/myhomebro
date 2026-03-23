import React, { useEffect, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";

function statusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "invoiced") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

export default function SubcontractorAssignedWorkPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/subcontractor/milestones/my-assigned/");
        if (!active) return;
        setGroups(Array.isArray(data?.groups) ? data.groups : []);
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error("Failed to load assigned work.");
        setGroups([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 data-testid="subcontractor-assigned-work-title" className="text-2xl font-bold text-slate-900">
          My Assigned Work
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Review milestones assigned to you across your active MyHomeBro agreements.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading assigned work…</div>
      ) : groups.length === 0 ? (
        <div
          data-testid="subcontractor-assigned-work-empty"
          className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm"
        >
          No milestones are assigned to you yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section
              key={group.agreement_id}
              data-testid={`assigned-work-group-${group.agreement_id}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {group.project_title || group.agreement_title || `Agreement #${group.agreement_id}`}
                </h2>
                <div className="mt-1 text-xs text-slate-500">
                  Agreement #{group.agreement_id}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(group.milestones || []).map((milestone) => (
                  <div
                    key={milestone.id}
                    data-testid={`assigned-milestone-${milestone.id}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">
                          {milestone.title}
                        </div>
                        <div className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">
                          {milestone.description || "No description provided."}
                        </div>
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                          milestone.status
                        )}`}
                      >
                        {String(milestone.status || "pending").replaceAll("_", " ")}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                      <div>
                        <div className="font-semibold text-slate-900">Start</div>
                        <div>{formatDate(milestone.start_date)}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">Due</div>
                        <div>{formatDate(milestone.completion_date)}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">Assigned</div>
                        <div>
                          {milestone.assigned_subcontractor?.display_name ||
                            milestone.assigned_subcontractor?.email ||
                            "Assigned"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
