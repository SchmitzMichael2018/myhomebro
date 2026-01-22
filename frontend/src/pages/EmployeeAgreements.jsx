// frontend/src/pages/EmployeeAgreements.jsx
// v2026-01-09 — Employee "My Agreements" (supervisors oversee multiple agreements)
// Uses:
//   GET /api/projects/employee/agreements/
//   GET /api/projects/employee/agreements/<id>/

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import toast from "react-hot-toast";

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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        // click outside closes
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden">
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

  const roleLabel = String(identity?.role || "").replaceAll("_", " ");

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-2xl font-extrabold">My Agreements</div>
        <div className="text-sm text-gray-600 mt-1">
          Agreements assigned to you (supervisors see all milestones for assigned agreements).
        </div>
        <div className="text-xs text-gray-400 mt-1">
          Signed in as <span className="font-semibold">{identity?.email}</span>{" "}
          {identity?.role ? (
            <>
              • role: <span className="font-semibold">{roleLabel}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agreements…"
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
          {loading ? "Loading…" : `${filtered.length} agreement(s)`}
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Agreement</th>
              <th className="px-4 py-2 text-left">Status</th>
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
                <td colSpan={10} className="px-4 py-6 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-gray-500">
                  No agreements assigned yet.
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const status = String(r.status || "");
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
                    <td className="px-4 py-2 font-semibold">#{r.id}</td>
                    <td className="px-4 py-2">
                      {status ? <Badge tone={tone}>{status}</Badge> : "—"}
                    </td>
                    <td className="px-4 py-2 max-w-[260px] truncate" title={r.project_title}>
                      {r.project_title || "—"}
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
                    <th className="px-4 py-2 text-right">Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(detail.milestones) && detail.milestones.length ? (
                    detail.milestones.map((m) => (
                      <tr key={m.id} className="border-t">
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
                          {m.invoice_id ? `#${m.invoice_id}` : "—"}
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
              Tip: Use the employee Milestones page to open a milestone and add evidence/complete it.
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
