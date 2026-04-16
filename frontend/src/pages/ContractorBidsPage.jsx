import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardList, Copy, ExternalLink, X } from "lucide-react";
import toast from "react-hot-toast";

import api from "../api";

function fmtDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function SummaryCard({ label, value, tone = "slate", testId }) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
    slate: "border-slate-200 bg-white text-slate-900",
  };

  return (
    <div data-testid={testId} className={`rounded-xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function statusTone(status) {
  const normalized = normalize(status);
  if (normalized === "awarded") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized === "under_review") return "border-amber-200 bg-amber-50 text-amber-800";
  if (normalized === "declined" || normalized === "expired") return "border-rose-200 bg-rose-50 text-rose-800";
  if (normalized === "draft" || normalized === "submitted") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function DetailField({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value || "-"}</div>
    </div>
  );
}

export default function ContractorBidsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectClassFilter, setProjectClassFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [actionBusyId, setActionBusyId] = useState("");
  const [copiedRefId, setCopiedRefId] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/contractor/bids/");
        if (!active) return;
        setRows(Array.isArray(data?.results) ? data.results : []);
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error(err?.response?.data?.detail || "Failed to load bids.");
        setRows([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const filteredRows = useMemo(() => {
    const q = normalize(search);
    return rows.filter((row) => {
      if (statusFilter !== "all" && normalize(row.status) !== statusFilter) return false;
      if (projectClassFilter !== "all" && normalize(row.project_class) !== projectClassFilter) return false;
      if (!q) return true;
      return [
        row.project_title,
        row.customer_name,
        row.customer_email,
        row.notes,
        row.timeline,
        row.source_reference,
        row.linked_agreement_reference,
      ]
        .map((value) => normalize(value))
        .join(" ")
        .includes(q);
    });
  }, [rows, search, statusFilter, projectClassFilter]);

  const summary = useMemo(() => {
    const counts = {
      open: 0,
      under_review: 0,
      awarded: 0,
      declined_expired: 0,
    };

    for (const row of filteredRows) {
      const status = normalize(row.status);
      if (status === "draft" || status === "submitted") counts.open += 1;
      else if (status === "under_review") counts.under_review += 1;
      else if (status === "awarded") counts.awarded += 1;
      else counts.declined_expired += 1;
    }

    return counts;
  }, [filteredRows]);

  const closeDrawer = () => {
    setSelectedRow(null);
    setCopiedRefId("");
  };

  const copyReference = async (value, rowId) => {
    const text = String(value || "").trim();
    if (!text || !navigator?.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedRefId(rowId);
      window.setTimeout(() => {
        setCopiedRefId((current) => (current === rowId ? "" : current));
      }, 1200);
    } catch {
      setCopiedRefId("");
    }
  };

  const runAction = async (row) => {
    if (!row) return;
    if (normalize(row.next_action?.key) === "open_agreement" && row.linked_agreement_url) {
      navigate(row.linked_agreement_url);
      return;
    }

    const sourceKind = normalize(row.source_kind);
    const sourceId = row.source_id || row.bid_id;
    if (!sourceKind || !sourceId) return;

    setActionBusyId(String(row.bid_id));
    try {
      const endpoint =
        sourceKind === "lead"
          ? `/projects/contractor/public-leads/${sourceId}/create-agreement/`
          : `/projects/intakes/${sourceId}/convert-to-agreement/`;
      const { data } = await api.post(endpoint, {});
      const target =
        data?.wizard_url || data?.detail_url || (data?.agreement_id ? `/app/agreements/${data.agreement_id}` : "");
      if (target) {
        navigate(target);
        return;
      }
      toast.success("Agreement created.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not convert bid to agreement.");
    } finally {
      setActionBusyId("");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <ClipboardList size={14} />
            Bids
          </div>
          <h1 data-testid="contractor-bids-title" className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
            Bids Workspace
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Track residential and commercial bid activity in one place, from new requests through award and agreement conversion.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/app/public-presence")}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Lead Inbox
        </button>
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        <SummaryCard label="Open Bids" value={String(summary.open)} tone="slate" testId="bids-summary-open" />
        <SummaryCard
          label="Under Review"
          value={String(summary.under_review)}
          tone="amber"
          testId="bids-summary-under-review"
        />
        <SummaryCard label="Awarded" value={String(summary.awarded)} tone="emerald" testId="bids-summary-awarded" />
        <SummaryCard
          label="Declined / Expired"
          value={String(summary.declined_expired)}
          tone="indigo"
          testId="bids-summary-declined"
        />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Bid Activity</h2>
            <div className="mt-1 text-sm text-slate-500">
              {loading ? "Loading bid workspace..." : `${filteredRows.length} bid${filteredRows.length === 1 ? "" : "s"}`}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">
              All / Residential / Commercial
              <select
                data-testid="bids-filter-project-class"
                value={projectClassFilter}
                onChange={(event) => setProjectClassFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 sm:w-48"
              >
                <option value="all">All</option>
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Status
              <select
                data-testid="bids-filter-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 sm:w-48"
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under Review</option>
                <option value="awarded">Awarded</option>
                <option value="declined">Declined</option>
                <option value="expired">Expired</option>
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Search
              <input
                data-testid="bids-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Project or customer"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 sm:w-64"
              />
            </label>
          </div>
        </div>

        {loading ? (
          <div className="mt-5 text-sm text-slate-500">Loading bid workspace...</div>
        ) : filteredRows.length === 0 ? (
          <div
            data-testid="bids-empty"
            className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600"
          >
            No bids match your current filters.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Project Class</th>
                  <th className="px-3 py-2">Bid Amount</th>
                  <th className="px-3 py-2">Submitted Date</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr
                    key={`${row.source_kind}-${row.bid_id}`}
                    data-testid={`bids-row-${row.bid_id}`}
                    className="cursor-pointer border-b border-slate-100 align-top hover:bg-slate-50"
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedRow(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedRow(row);
                      }
                    }}
                  >
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{row.project_title}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.source_reference}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-900">{row.customer_name}</div>
                      <div className="mt-1 text-xs text-slate-500">{row.customer_email || row.customer_phone || "-"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                        {row.project_class_label || "Residential"}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{row.bid_amount_label || "-"}</td>
                    <td className="px-3 py-3 text-slate-700">{fmtDate(row.submitted_at)}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(row.status)}`}>
                        {row.status_label}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        data-testid={`bids-row-action-${row.bid_id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          runAction(row);
                        }}
                        disabled={actionBusyId === String(row.bid_id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        {actionBusyId === String(row.bid_id) ? "Working..." : row.next_action?.label || "View"}
                        <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedRow ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close bid details"
            className="absolute inset-0 bg-black/40"
            onClick={closeDrawer}
          />
          <aside
            data-testid="bids-detail-drawer"
            className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-200 p-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Bid Detail</div>
                <h3 className="mt-2 text-2xl font-extrabold text-slate-900">{selectedRow.project_title}</h3>
                <div className="mt-2 text-sm text-slate-600">{selectedRow.customer_name}</div>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label="Project Class" value={selectedRow.project_class_label || "Residential"} />
                <DetailField label="Status" value={selectedRow.status_label} />
                <DetailField label="Bid Amount" value={selectedRow.bid_amount_label || "-"} />
                <DetailField label="Submitted" value={fmtDate(selectedRow.submitted_at)} />
                <DetailField label="Source" value={selectedRow.source_kind_label || "Lead"} />
                <DetailField label="Related ID" value={selectedRow.source_reference || `Bid #${selectedRow.bid_id}`} />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <DetailField label="Customer Email" value={selectedRow.customer_email || "-"} />
                <DetailField label="Customer Phone" value={selectedRow.customer_phone || "-"} />
                <DetailField label="Agreement" value={selectedRow.linked_agreement_reference || "-"} />
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Notes</div>
                <div className="mt-2 text-sm text-slate-800">
                  {selectedRow.notes || "No bid notes were provided."}
                </div>
              </div>

              {selectedRow.timeline ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Timeline</div>
                  <div className="mt-2 text-sm text-slate-800">{selectedRow.timeline}</div>
                </div>
              ) : null}

              {selectedRow.milestone_preview?.length ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Commercial / Structured Preview
                  </div>
                  <ul className="mt-2 space-y-2 text-sm text-slate-800">
                    {selectedRow.milestone_preview.map((item) => (
                      <li key={item} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Next Step</div>
                <div className="mt-2 text-sm text-slate-800">{selectedRow.next_action?.label || "View Details"}</div>
                <div className="mt-4 flex flex-wrap gap-3">
                  {selectedRow.next_action?.key === "open_agreement" && selectedRow.linked_agreement_url ? (
                    <button
                      type="button"
                      onClick={() => navigate(selectedRow.linked_agreement_url)}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      Open Agreement
                      <ExternalLink size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => runAction(selectedRow)}
                      disabled={actionBusyId === String(selectedRow.bid_id)}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {actionBusyId === String(selectedRow.bid_id) ? "Working..." : selectedRow.next_action?.label || "View Details"}
                      <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Reference</div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="text-sm font-semibold text-slate-900">{selectedRow.source_reference}</div>
                  <button
                    type="button"
                    onClick={() => copyReference(selectedRow.source_reference, selectedRow.bid_id)}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Copy size={14} />
                    {copiedRefId === String(selectedRow.bid_id) ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
