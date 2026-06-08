import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CheckCircle2, EyeOff, Star, XCircle } from "lucide-react";

import api from "../../api";

const statusOptions = [
  ["pending", "Pending"],
  ["approved", "Approved / Published"],
  ["hidden", "Hidden"],
  ["rejected", "Rejected"],
  ["", "All"],
];

const inputClass =
  "rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-sky-100/50 focus:border-amber-200 focus:outline-none";
const buttonClass =
  "rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm font-bold text-sky-50 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "rounded-xl border border-amber-200/40 bg-amber-300/20 px-3 py-2 text-sm font-extrabold text-amber-50 hover:bg-amber-300/30 disabled:cursor-not-allowed disabled:opacity-50";

function fmtDate(value) {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusTone(status = "") {
  const value = String(status).toLowerCase();
  if (value === "approved") return "border-emerald-300/40 bg-emerald-400/10 text-emerald-100";
  if (value === "hidden") return "border-slate-400/40 bg-slate-400/10 text-slate-100";
  if (value === "rejected") return "border-rose-300/40 bg-rose-400/10 text-rose-100";
  return "border-amber-300/40 bg-amber-400/10 text-amber-100";
}

function Badge({ children, status }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-extrabold ${statusTone(status)}`}>
      {children}
    </span>
  );
}

function Metric({ label, value, tone = "slate" }) {
  const color = tone === "amber" ? "text-amber-100" : tone === "rose" ? "text-rose-100" : "text-white";
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
      <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-100/60">{label}</div>
      <div className={`mt-2 text-2xl font-black ${color}`}>{value || 0}</div>
    </div>
  );
}

function ratingStars(rating) {
  const value = Number(rating || 0);
  return (
    <span className="inline-flex items-center gap-1 text-amber-100">
      <Star className="h-4 w-4 fill-amber-200 text-amber-200" />
      <span className="font-black">{value}/5</span>
    </span>
  );
}

export default function AdminReviewsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [filters, setFilters] = useState({
    status: "pending",
    contractor: "",
    rating: "",
    date_from: "",
    date_to: "",
  });
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const params = useMemo(() => {
    const result = {};
    Object.entries(filters).forEach(([key, value]) => {
      const text = String(value || "").trim();
      if (text) result[key] = text;
    });
    return result;
  }, [filters]);

  const load = async () => {
    setLoading(true);
    setStatusMessage("");
    try {
      const { data } = await api.get("/projects/admin/contractor-reviews/", { params });
      setRows(data?.results || []);
      setSummary(data?.summary || {});
    } catch (error) {
      setStatusMessage(error?.response?.data?.detail || "Could not load contractor reviews.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status, params.contractor, params.rating, params.date_from, params.date_to]);

  const openDetail = (row) => {
    setSelected(row);
    setNote(row?.moderation_notes || "");
  };

  const refreshReview = (review) => {
    if (!review) return;
    setSelected(review);
    setNote(review.moderation_notes || "");
    setRows((prev) => prev.map((row) => (row.id === review.id ? review : row)));
  };

  const moderate = async (action) => {
    if (!selected) return;
    setBusy(action);
    try {
      const { data } = await api.post(`/projects/admin/contractor-reviews/${selected.id}/moderate/`, {
        action,
        moderation_notes: note,
      });
      refreshReview(data?.review);
      toast.success(action === "approve" ? "Review approved." : action === "hide" ? "Review hidden." : "Review rejected.");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not update review.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div data-testid="admin-reviews-page" className="min-h-screen bg-[#071b35] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b2a58] to-[#06152b] p-6 shadow-2xl shadow-slate-950/30">
          <div className="text-xs font-black uppercase tracking-[0.22em] text-amber-200/80">Admin Trust</div>
          <h1 className="mt-2 text-3xl font-black">Review Moderation</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-sky-100/80">
            Approve, hide, or reject customer-submitted contractor reviews before they affect public ratings or marketplace comparison surfaces.
          </p>
        </header>

        {statusMessage ? (
          <div data-testid="admin-reviews-status" className="rounded-xl border border-rose-300/40 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {statusMessage}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-4" data-testid="admin-reviews-summary">
          <Metric label="Pending Reviews" value={summary.pending} tone="amber" />
          <Metric label="Published" value={summary.approved} />
          <Metric label="Recently Approved" value={summary.recently_approved} />
          <Metric label="Hidden / Rejected" value={(Number(summary.hidden || 0) + Number(summary.rejected || 0)) || summary.hidden_or_rejected} tone="rose" />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/10 p-4" data-testid="admin-reviews-filters">
          <div className="grid gap-3 md:grid-cols-6">
            <select
              className={inputClass}
              value={filters.status}
              onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              data-testid="admin-reviews-status-filter"
            >
              {statusOptions.map(([value, label]) => (
                <option key={value || "all"} value={value}>{label}</option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Contractor or customer"
              value={filters.contractor}
              onChange={(event) => setFilters((prev) => ({ ...prev, contractor: event.target.value }))}
              data-testid="admin-reviews-contractor-filter"
            />
            <select
              className={inputClass}
              value={filters.rating}
              onChange={(event) => setFilters((prev) => ({ ...prev, rating: event.target.value }))}
              data-testid="admin-reviews-rating-filter"
            >
              <option value="">Any rating</option>
              {[5, 4, 3, 2, 1].map((rating) => (
                <option key={rating} value={rating}>{rating} stars</option>
              ))}
            </select>
            <input className={inputClass} type="date" value={filters.date_from} onChange={(event) => setFilters((prev) => ({ ...prev, date_from: event.target.value }))} data-testid="admin-reviews-date-from-filter" />
            <input className={inputClass} type="date" value={filters.date_to} onChange={(event) => setFilters((prev) => ({ ...prev, date_to: event.target.value }))} data-testid="admin-reviews-date-to-filter" />
            <button type="button" className={buttonClass} onClick={load}>Refresh</button>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/10" data-testid="admin-reviews-list">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-950/50 text-xs uppercase tracking-wide text-sky-100/60">
              <tr>
                <th className="px-4 py-3">Review</th>
                <th className="px-4 py-3">Contractor</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Published</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-6 text-sky-100/70">Loading reviews...</td></tr>
              ) : rows.length ? rows.map((row) => (
                <tr key={row.id} data-testid={`admin-review-row-${row.id}`} className="hover:bg-white/5">
                  <td className="px-4 py-3">
                    <div>{ratingStars(row.rating)}</div>
                    <div className="mt-1 max-w-[220px] truncate font-bold text-white">{row.title || "Untitled review"}</div>
                    <div className="mt-1 max-w-[260px] truncate text-xs text-sky-100/65">{row.review_text || "No written review."}</div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-sky-50">{row.contractor_name}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-sky-50">{row.customer_name || "Customer"}</div>
                    <div className="text-xs text-sky-100/60">{row.customer_email || "No email"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-sky-50">{row.project_title || "Project"}</div>
                    <div className="text-xs text-sky-100/60">Agreement #{row.agreement_id || "n/a"}</div>
                  </td>
                  <td className="px-4 py-3 text-sky-100/75">{[row.project_type, row.project_subtype].filter(Boolean).join(" / ") || "Not set"}</td>
                  <td className="px-4 py-3"><Badge status={row.moderation_status}>{row.moderation_status_label || row.moderation_status}</Badge></td>
                  <td className="px-4 py-3 text-sky-100/70">{fmtDate(row.submitted_at)}</td>
                  <td className="px-4 py-3 text-sky-100/70">{fmtDate(row.published_at)}</td>
                  <td className="px-4 py-3">
                    <button type="button" className={buttonClass} onClick={() => openDetail(row)} data-testid={`admin-review-open-${row.id}`}>
                      Open
                    </button>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={9} className="px-4 py-6 text-sky-100/70">No reviews match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {selected ? (
          <aside data-testid="admin-review-detail" className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#06152b] p-6 shadow-2xl shadow-slate-950/60">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-200/80">Review Detail</div>
                <h2 className="mt-2 text-2xl font-black text-white">{selected.title || "Customer review"}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {ratingStars(selected.rating)}
                  <Badge status={selected.moderation_status}>{selected.moderation_status_label || selected.moderation_status}</Badge>
                  <span className="rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-bold text-sky-100">
                    {selected.is_public ? "Public" : "Not public"}
                  </span>
                </div>
              </div>
              <button type="button" className={buttonClass} onClick={() => setSelected(null)}>Close</button>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/10 p-4 text-sm leading-6 text-sky-50">
              {selected.review_text || "No written review was submitted."}
            </div>

            <div className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-white/10 p-4 text-sm text-sky-100/80" data-testid="admin-review-context">
              <div><span className="font-black text-white">Contractor:</span> {selected.contractor_name}</div>
              <div><span className="font-black text-white">Customer:</span> {selected.customer_name || "Customer"} ({selected.customer_email || "no email"})</div>
              <div><span className="font-black text-white">Project:</span> {selected.project_title || "Project"} / Agreement #{selected.agreement_id || "n/a"}</div>
              <div><span className="font-black text-white">Type:</span> {[selected.project_type, selected.project_subtype].filter(Boolean).join(" / ") || "Not set"}</div>
              <div><span className="font-black text-white">Submitted:</span> {fmtDate(selected.submitted_at)}</div>
              <div><span className="font-black text-white">Published:</span> {fmtDate(selected.published_at)}</div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-white/10 p-4" data-testid="admin-review-performance">
              <div className="text-sm font-black text-white">Contractor Performance Summary</div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <Metric label="Avg Rating" value={selected.performance_summary?.average_rating ?? 0} />
                <Metric label="Reviews" value={selected.performance_summary?.review_count ?? 0} />
                <Metric label="Completed Projects" value={selected.performance_summary?.completed_projects ?? 0} />
                <Metric label="Dispute Rate" value={`${selected.performance_summary?.dispute_rate ?? 0}%`} />
              </div>
            </div>

            <label className="mt-5 block text-sm font-black text-sky-50" htmlFor="admin-review-note">Moderation note</label>
            <textarea
              id="admin-review-note"
              className={`${inputClass} mt-2 min-h-28 w-full`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add context for future admins."
              data-testid="admin-review-note"
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <button type="button" className={primaryButtonClass} disabled={Boolean(busy)} onClick={() => moderate("approve")} data-testid="admin-review-approve">
                <CheckCircle2 className="mr-1 inline h-4 w-4" /> Approve / Publish
              </button>
              <button type="button" className={buttonClass} disabled={Boolean(busy)} onClick={() => moderate("hide")} data-testid="admin-review-hide">
                <EyeOff className="mr-1 inline h-4 w-4" /> Hide / Unpublish
              </button>
              <button type="button" className="rounded-xl border border-rose-300/40 bg-rose-400/10 px-3 py-2 text-sm font-extrabold text-rose-100 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-50" disabled={Boolean(busy)} onClick={() => moderate("reject")} data-testid="admin-review-reject">
                <XCircle className="mr-1 inline h-4 w-4" /> Reject
              </button>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
