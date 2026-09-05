// frontend/src/pages/EmployeeAgreements.jsx
// v2026-01-09 — Employee "My Agreements" (supervisors oversee multiple agreements)
// Uses:
//   GET /api/projects/employee/agreements/
//   GET /api/projects/employee/agreements/<id>/

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import toast from "react-hot-toast";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import EmployeeMilestoneModal from "./EmployeeMilestoneModal.jsx";

function fmtDate(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(v);
  }
}

function pct(n) {
  const x = Number(n);
  return Number.isFinite(x) ? `${x}%` : "—";
}

function Badge({ tone = "gray", children }) {
  const base =
    "inline-flex items-center rounded-full px-2 py-[2px] text-[11px] font-semibold border";
  const tones = {
    gray: "bg-gray-100 text-gray-700 border-gray-300",
    green: "bg-green-100 text-green-800 border-green-300",
    amber: "bg-amber-100 text-amber-900 border-amber-300",
    blue: "bg-blue-100 text-blue-800 border-blue-300",
    red: "bg-red-100 text-red-800 border-red-300",
  };
  return <span className={`${base} ${tones[tone] || tones.gray}`}>{children}</span>;
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4"
    >
      <button type="button" aria-label="Close agreement dialog" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="text-lg font-extrabold">{title}</div>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-sm font-semibold"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export default function EmployeeAgreements() {
  const { data: identity, loading: whoLoading } = useWhoAmI();

  const isEmployee = useMemo(
    () => String(identity?.type || "").toLowerCase() === "subaccount",
    [identity?.type]
  );

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [activeMilestoneId, setActiveMilestoneId] = useState(null);

  const openAssignedWork = (milestoneId) => {
    setDetailOpen(false);
    setActiveMilestoneId(milestoneId);
  };

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/projects/employee/agreements/", {
        params: { _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      const list = Array.isArray(data?.agreements) ? data.agreements : [];
      setRows(list);
    } catch (e) {
      console.error(e?.response || e);
      toast.error("Failed to load your agreements.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const openAgreement = async (agreementId) => {
    try {
      setDetailOpen(true);
      setDetailLoading(true);
      setDetail(null);

      const { data } = await api.get(`/projects/employee/agreements/${agreementId}/`, {
        params: { _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      setDetail(data || null);
    } catch (e) {
      console.error(e?.response || e);
      toast.error("Failed to load agreement details.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    if (whoLoading) return;
    if (!isEmployee) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whoLoading, isEmployee]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;

    return rows.filter((r) => {
      const hay = [
        r.id,
        r.status,
        r.project_title,
        r.customer_name,
        r.project_address,
        r.start,
        r.end,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(s);
    });
  }, [rows, q]);

  if (whoLoading) {
    return (
      <div className="p-6">
        <div className="text-gray-500">Loading…</div>
      </div>
    );
  }

  if (!isEmployee) {
    return (
      <div className="p-6">
        <div className="text-red-600 font-semibold">
          This page is for employee accounts only.
        </div>
      </div>
    );
  }


  return (
    <ContractorPageSurface
      eyebrow="Team workspace"
      title="Projects"
      subtitle="Review project context and the work plan connected to your assignments."
      variant="operational"
      className="mx-auto max-w-[1180px]"
    >
    <div className="space-y-4" data-testid="employee-projects-page">
      <div>
        <div className="text-sm text-sky-100/70">Project access provides context. Your Milestones page contains only work assigned to you.</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects…"
          className="border rounded-lg px-3 py-2 text-sm w-80"
        />
        <button
          type="button"
          onClick={load}
          className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm font-semibold"
        >
          Refresh
        </button>
        <div className="flex-1" />
        <div className="text-xs text-gray-500">
          {loading ? "Loading…" : `${filtered.length} project(s)`}
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Project</th>
              <th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Address</th>
              <th className="px-4 py-2 text-left">Start</th>
              <th className="px-4 py-2 text-left">End</th>
              <th className="px-4 py-2 text-right">Milestones</th>
              <th className="px-4 py-2 text-right">% Complete</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-gray-500">
                  No projects assigned yet.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const status = String(r.status || "");
                const displayStatus =
                  status === "funded" || status === "signed"
                    ? "Active"
                    : status === "draft"
                    ? "Planning"
                    : status;
                const tone =
                  status === "funded"
                    ? "green"
                    : status === "signed"
                    ? "blue"
                    : status === "draft"
                    ? "gray"
                    : status === "cancelled"
                    ? "red"
                    : "amber";

                return (
                  <tr
                    key={r.id}
                    className="border-t hover:bg-blue-50 cursor-pointer"
                    onClick={() => openAgreement(r.id)}
                    title="Click to view agreement milestones"
                  >
                    <td className="px-4 py-2 max-w-[260px] truncate" title={r.project_title}>
                      <div className="font-semibold">{r.project_title || "—"}</div>
                      <div className="mt-1">
                        {displayStatus ? <Badge tone={tone}>{displayStatus}</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 max-w-[220px] truncate" title={r.customer_name}>
                      {r.customer_name || "—"}
                    </td>
                    <td className="px-4 py-2 max-w-[320px] truncate" title={r.project_address}>
                      {r.project_address || "—"}
                    </td>
                    <td className="px-4 py-2">{fmtDate(r.start)}</td>
                    <td className="px-4 py-2">{fmtDate(r.end)}</td>
                    <td className="px-4 py-2 text-right">
                      {r.milestones_complete ?? 0}/{r.milestones_total ?? 0}
                    </td>
                    <td className="px-4 py-2 text-right">{pct(r.milestones_percent)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs font-semibold"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          openAgreement(r.id);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetail(null);
        }}
        title={
          detail?.agreement?.project_title
            ? `Agreement #${detail.agreement.id} — ${detail.agreement.project_title}`
            : detail?.agreement?.id
            ? `Agreement #${detail.agreement.id}`
            : "Agreement"
        }
      >
        {detailLoading ? (
          <div className="text-gray-600">Loading agreement…</div>
        ) : !detail ? (
          <div className="text-gray-600">No detail loaded.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl border p-3 bg-white">
                <div className="text-xs text-gray-500">Customer</div>
                <div className="font-semibold">{detail.agreement.customer_name || "—"}</div>
              </div>
              <div className="rounded-xl border p-3 bg-white">
                <div className="text-xs text-gray-500">Address</div>
                <div className="font-semibold">{detail.agreement.project_address || "—"}</div>
              </div>
              <div className="rounded-xl border p-3 bg-white">
                <div className="text-xs text-gray-500">Schedule</div>
                <div className="font-semibold">
                  {fmtDate(detail.agreement.start)} → {fmtDate(detail.agreement.end)}
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-white overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">#</th>
                    <th className="px-4 py-2 text-left">Milestone</th>
                    <th className="px-4 py-2 text-left">Due</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-right">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(detail.milestones) && detail.milestones.length ? (
                    detail.milestones.map((m) => (
                      <tr
                        key={m.id}
                        className={`border-t ${m.is_assigned_to_me ? "cursor-pointer hover:bg-blue-50" : "opacity-70"}`}
                        onClick={m.is_assigned_to_me ? () => openAssignedWork(m.id) : undefined}
                        title={m.is_assigned_to_me ? "Open your assigned milestone" : "Project context only — not assigned to you"}
                      >
                        <td className="px-4 py-2">{m.order ?? "—"}</td>
                        <td className="px-4 py-2">
                          <div className="font-semibold">{m.title}</div>
                          {m.description ? (
                            <div className="text-xs text-gray-500 mt-0.5">
                              {m.description}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">{fmtDate(m.completion_date)}</td>
                        <td className="px-4 py-2">
                          {m.completed ? (
                            <Badge tone="green">Completed</Badge>
                          ) : m.is_late ? (
                            <Badge tone="red">Late</Badge>
                          ) : (
                            <Badge tone="amber">Open</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {m.is_assigned_to_me ? (
                            <button
                              type="button"
                              className="mhb-btn primary min-h-10 whitespace-nowrap px-3 py-1.5 text-xs"
                              onClick={(event) => {
                                event.stopPropagation();
                                openAssignedWork(m.id);
                              }}
                            >
                              Open work
                            </button>
                          ) : (
                            <span className="text-xs text-gray-500">Context only</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-gray-500">
                        No milestones found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="text-[11px] text-gray-500 mt-3">
              Open assigned work from Milestones to add evidence and submit it for lead-contractor review.
            </div>
          </>
        )}
      </Modal>
      {activeMilestoneId ? (
        <EmployeeMilestoneModal
          milestoneId={activeMilestoneId}
          onClose={() => setActiveMilestoneId(null)}
          onUpdated={() => {
            setActiveMilestoneId(null);
            load();
          }}
        />
      ) : null}
    </div>
    </ContractorPageSurface>
  );
}
