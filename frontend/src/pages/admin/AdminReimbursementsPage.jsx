import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ExternalLink } from "lucide-react";

import api from "../../api";

const filterOptions = [
  ["", "All"],
  ["pending_review", "Pending Review"],
  ["pending_release", "Pending Release"],
  ["held", "Held"],
  ["released", "Released"],
  ["denied", "Denied"],
  ["failed_release", "Failed Release"],
];

const inputClass = "rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-amber-200 focus:outline-none";
const buttonClass = "rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-sky-50 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass = "rounded-xl border border-amber-200/40 bg-amber-300/20 px-3 py-2 text-sm font-extrabold text-amber-50 hover:bg-amber-300/30 disabled:cursor-not-allowed disabled:opacity-50";

function Badge({ children, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/40 bg-amber-400/10 text-amber-100",
    rose: "border-rose-300/40 bg-rose-400/10 text-rose-100",
    slate: "border-slate-500/40 bg-slate-800/80 text-slate-200",
  };
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${tones[tone] || tones.slate}`}>{children}</span>;
}

function statusTone(status = "") {
  const value = String(status).toLowerCase();
  if (value.includes("release")) return "emerald";
  if (value.includes("held") || value.includes("denied") || value.includes("failed")) return "rose";
  if (value.includes("pending") || value.includes("submitted")) return "amber";
  return "slate";
}

function Metric({ label, value, tone = "slate" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-100/60">{label}</div>
      <div className={`mt-2 text-2xl font-black ${tone === "rose" ? "text-rose-100" : tone === "emerald" ? "text-emerald-100" : "text-white"}`}>{value || 0}</div>
    </div>
  );
}

export default function AdminReimbursementsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({ status: "pending_release", contractor: "", project: "" });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const params = useMemo(() => {
    const result = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value || "").trim()) result[key] = String(value).trim();
    });
    return result;
  }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/projects/admin/reimbursements/", { params });
      setRows(data?.results || []);
      setSummary(data?.summary || {});
    } catch (error) {
      setStatusMessage(error?.response?.data?.detail || "Could not load reimbursements.");
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (row) => {
    setBusy(`detail-${row.id}`);
    try {
      const { data } = await api.get(`/projects/admin/reimbursements/${row.id}/`);
      setSelected(data);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not open reimbursement detail.");
    } finally {
      setBusy("");
    }
  };

  const refreshDetail = (updated) => {
    if (!updated) return;
    setSelected(updated);
    setRows((prev) => prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)));
  };

  const recordRelease = async () => {
    if (!selected) return;
    const transferId = window.prompt("Transfer/reference ID (optional):") || "";
    if (!window.confirm("Record this escrow reimbursement as released? This records an audit reference only and does not create a Stripe transfer.")) return;
    setBusy("release");
    try {
      const { data } = await api.post(`/projects/admin/reimbursements/${selected.id}/record-release/`, { stripe_transfer_id: transferId });
      refreshDetail(data?.reimbursement);
      toast.success("Release recorded.");
      load();
    } catch (error) {
      refreshDetail(error?.response?.data?.reimbursement);
      toast.error(error?.response?.data?.detail || "Could not record release.");
    } finally {
      setBusy("");
    }
  };

  const placeHold = async () => {
    if (!selected) return;
    const reason = window.prompt("Hold reason:");
    if (!reason) return;
    setBusy("hold");
    try {
      const { data } = await api.post(`/projects/admin/reimbursements/${selected.id}/hold/`, { reason });
      refreshDetail(data?.reimbursement);
      toast.success("Hold placed.");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not place hold.");
    } finally {
      setBusy("");
    }
  };

  const clearHold = async () => {
    if (!selected) return;
    setBusy("clear-hold");
    try {
      const { data } = await api.post(`/projects/admin/reimbursements/${selected.id}/clear-hold/`, {});
      refreshDetail(data?.reimbursement);
      toast.success("Hold cleared.");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not clear hold.");
    } finally {
      setBusy("");
    }
  };

  const retryRelease = async () => {
    if (!selected) return;
    setBusy("retry");
    try {
      const { data } = await api.post(`/projects/admin/reimbursements/${selected.id}/retry-release/`, {});
      refreshDetail(data?.reimbursement);
      toast.success("Release error cleared.");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not clear release error.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status, params.contractor, params.project]);

  return (
    <div data-testid="admin-reimbursements-page" className="min-h-screen bg-[#071b35] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b2a58] to-[#06152b] p-6 shadow-2xl shadow-slate-950/30">
          <div className="text-xs font-black uppercase tracking-[0.22em] text-amber-200/80">Admin Payments</div>
          <h1 className="mt-2 text-3xl font-black">Escrow Reimbursements</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-sky-100/80">
            Review customer-approved material and expense reimbursements before manual release. Recording a release here is audit-only and does not create a Stripe transfer.
          </p>
        </header>

        {statusMessage ? <div data-testid="admin-reimbursements-status" className="rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">{statusMessage}</div> : null}

        <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6" data-testid="admin-reimbursements-summary">
          <Metric label="Pending Review" value={summary.pending_review} />
          <Metric label="Pending Release" value={summary.pending_release} tone="emerald" />
          <Metric label="Held" value={summary.held} tone="rose" />
          <Metric label="Released" value={summary.released} tone="emerald" />
          <Metric label="Denied" value={summary.denied} />
          <Metric label="Failed Release" value={summary.failed_release} tone="rose" />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/10 p-4" data-testid="admin-reimbursements-filters">
          <div className="grid gap-3 md:grid-cols-4">
            <select className={inputClass} value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} data-testid="admin-reimbursements-status-filter">
              {filterOptions.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
            </select>
            <input className={inputClass} placeholder="Contractor" value={filters.contractor} onChange={(event) => setFilters((prev) => ({ ...prev, contractor: event.target.value }))} data-testid="admin-reimbursements-contractor-filter" />
            <input className={inputClass} placeholder="Project or agreement ID" value={filters.project} onChange={(event) => setFilters((prev) => ({ ...prev, project: event.target.value }))} data-testid="admin-reimbursements-project-filter" />
            <button type="button" className={buttonClass} onClick={load}>Refresh</button>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/10" data-testid="admin-reimbursements-list">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-slate-950/50 text-xs uppercase tracking-wide text-sky-100/60">
              <tr>
                <th className="px-4 py-3">Request</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Contractor</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Escrow</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-6 text-sky-100/70">Loading reimbursements...</td></tr>
              ) : rows.length ? rows.map((row) => (
                <tr key={row.id} data-testid={`admin-reimbursement-row-${row.id}`} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div className="font-bold">#{row.id}</div>
                    <div className="text-xs text-slate-400">{row.category_label}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{row.project_title}</div>
                    <div className="text-xs text-slate-400">Agreement #{row.agreement_id || "n/a"}</div>
                  </td>
                  <td className="px-4 py-3">{row.contractor?.name}</td>
                  <td className="px-4 py-3">
                    <div>{row.customer?.name}</div>
                    <div className="text-xs text-slate-400">{row.customer?.email}</div>
                  </td>
                  <td className="px-4 py-3 font-bold">${row.amount}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge tone={statusTone(row.status)}>{row.status_label}</Badge>
                      {row.release_error ? <span className="text-xs text-rose-100">Release error</span> : null}
                      {row.has_dispute_hold ? <span className="text-xs text-rose-100">Dispute hold</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">
                    <div>At approval: ${row.available_escrow_at_approval}</div>
                    <div>Current: ${row.current_ledger?.available || "0.00"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" className={buttonClass} onClick={() => openDetail(row)} disabled={busy === `detail-${row.id}`} data-testid={`admin-reimbursement-open-${row.id}`}>
                      Review
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="px-4 py-6 text-sky-100/70">No reimbursements match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {selected ? (
          <aside data-testid="admin-reimbursement-detail" className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#06152b] p-6 shadow-2xl shadow-slate-950/60">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-amber-200/80">Reimbursement #{selected.id}</div>
                <h2 className="mt-2 text-2xl font-black">{selected.project_title}</h2>
                <p className="mt-1 text-sm text-sky-100/70">{selected.description}</p>
              </div>
              <button type="button" className={buttonClass} onClick={() => setSelected(null)}>Close</button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Badge tone={statusTone(selected.status)}>{selected.status_label}</Badge>
              <Badge>{selected.category_label}</Badge>
              {selected.has_dispute_hold ? <Badge tone="rose">Dispute Hold</Badge> : null}
            </div>

            <div className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-white/10 p-4 text-sm" data-testid="admin-reimbursement-ledger">
              <div className="font-bold text-white">Ledger Breakdown</div>
              {Object.entries(selected.ledger_breakdown || {}).map(([key, value]) => (
                <div key={key} className="flex justify-between gap-4 border-b border-white/10 pb-1 text-slate-300 last:border-0">
                  <span>{key.replace(/_/g, " ")}</span>
                  <span className="font-bold text-white">${value}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2 rounded-2xl border border-white/10 bg-white/10 p-4 text-sm text-slate-300">
              <div><b className="text-white">Contractor:</b> {selected.contractor?.name}</div>
              <div><b className="text-white">Customer:</b> {selected.customer?.name} ({selected.customer?.email})</div>
              <div><b className="text-white">Amount:</b> ${selected.amount}</div>
              <div><b className="text-white">Submitted:</b> {selected.submitted_at ? new Date(selected.submitted_at).toLocaleString() : "Not submitted"}</div>
              <div><b className="text-white">Approved:</b> {selected.approved_at ? new Date(selected.approved_at).toLocaleString() : "Not approved"}</div>
              <div><b className="text-white">Released:</b> {selected.released_at ? new Date(selected.released_at).toLocaleString() : "Not released"}</div>
              {selected.stripe_transfer_id ? <div><b className="text-white">Transfer/reference:</b> {selected.stripe_transfer_id}</div> : null}
              {selected.release_error ? <div className="text-rose-100"><b>Release error:</b> {selected.release_error}</div> : null}
              {selected.hold_reason ? <div className="text-amber-100"><b>Hold reason:</b> {selected.hold_reason}</div> : null}
            </div>

            <div className="mt-5 space-y-2">
              {selected.receipt_url ? (
                <a data-testid="admin-reimbursement-receipt-link" className={buttonClass} href={selected.receipt_url} target="_blank" rel="noreferrer">
                  Open Receipt <ExternalLink size={14} className="inline" />
                </a>
              ) : null}
              {selected.attachments?.map((attachment) => (
                <a key={attachment.id} className={`${buttonClass} ml-2`} href={attachment.url} target="_blank" rel="noreferrer">{attachment.name}</a>
              ))}
            </div>

            {selected.release_blockers?.length ? (
              <div data-testid="admin-reimbursement-blockers" className="mt-5 rounded-2xl border border-rose-300/40 bg-rose-400/10 p-4 text-sm text-rose-100">
                <div className="font-bold">Release blockers</div>
                <ul className="mt-2 list-disc pl-5">
                  {selected.release_blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className={primaryButtonClass} disabled={!selected.can_release || Boolean(busy)} onClick={recordRelease} data-testid="admin-reimbursement-record-release">
                Record Release
              </button>
              {selected.status === "held" ? (
                <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={clearHold} data-testid="admin-reimbursement-clear-hold">Clear Hold</button>
              ) : (
                <button type="button" className={buttonClass} disabled={Boolean(busy) || selected.status === "released"} onClick={placeHold} data-testid="admin-reimbursement-place-hold">Place Hold</button>
              )}
              {selected.release_error ? <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={retryRelease} data-testid="admin-reimbursement-retry-release">Clear Error for Retry</button> : null}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
