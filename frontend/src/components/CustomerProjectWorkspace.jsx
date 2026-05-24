import React, { useState } from "react";
import { ExternalLink } from "lucide-react";

function statusTone(status = "") {
  const value = String(status).toLowerCase();
  if (value.includes("complete") || value.includes("paid") || value.includes("signed")) return "emerald";
  if (value.includes("draft") || value.includes("pending")) return "amber";
  return "slate";
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/40 bg-amber-400/10 text-amber-100",
    slate: "border-slate-500/40 bg-slate-800/80 text-slate-200",
  };
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

export default function CustomerProjectWorkspace({ projects = [], agreements = [] }) {
  const [selectedId, setSelectedId] = useState(projects[0]?.id || null);
  const selected = projects.find((project) => String(project.id) === String(selectedId)) || projects[0] || null;

  if (!projects.length && !agreements.length) {
    return (
      <div data-testid="customer-project-workspace-empty" className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/60 p-6 text-sm text-slate-300">
        <div className="font-semibold text-white">No projects connected yet</div>
        <p className="mt-1 leading-6 text-slate-400">
          Active projects will appear here after an agreement, accepted bid, or contractor project record is connected to your secure customer email.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="customer-project-workspace" className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-2">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => setSelectedId(project.id)}
            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
              String(selected?.id) === String(project.id)
                ? "border-sky-300/50 bg-sky-400/10"
                : "border-slate-700 bg-slate-950/50 hover:border-slate-500 hover:bg-slate-900"
            }`}
          >
            <div className="text-sm font-semibold text-white">{project.title || "Project"}</div>
            <div className="mt-1 text-xs text-slate-400">{project.project_number || project.address || "Project workspace"}</div>
            <div className="mt-2">
              <Badge tone={statusTone(project.status_label)}>{project.status_label || "Project"}</Badge>
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        {selected ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">{selected.title}</h2>
                <p className="mt-1 text-sm text-slate-300">{selected.description || selected.address || "Project details and milestones."}</p>
              </div>
              {selected.agreement_url ? (
                <a
                  href={selected.agreement_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-300/40 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                >
                  Open agreement
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Contractor</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{selected.contractor_name || "Your contractor"}</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Total</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{selected.total_cost ? `$${Number(selected.total_cost || 0).toLocaleString()}` : "Pending"}</div>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Address</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{selected.address || "Not set"}</div>
              </div>
            </div>

            <div className="mt-5">
              <div className="text-sm font-semibold text-white">Milestones</div>
              <div className="mt-3 space-y-2">
                {(selected.milestones || []).length ? (
                  selected.milestones.map((milestone) => (
                    <div key={milestone.id} className="flex flex-col gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{milestone.title}</div>
                        <div className="text-xs text-slate-500">{milestone.due_date ? `Due ${new Date(milestone.due_date).toLocaleDateString()}` : "Date pending"}</div>
                      </div>
                      <Badge tone={statusTone(milestone.status)}>{milestone.status || "active"}</Badge>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                    Milestones will appear once project planning is ready.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
