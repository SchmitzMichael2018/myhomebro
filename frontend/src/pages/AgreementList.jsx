// frontend/src/pages/AgreementList.jsx
// v2025-10-04-milestones+percent-complete

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Plus,
  Layers,
  Pencil,
  Trash2,
  Star,
} from "lucide-react";

console.log("AgreementList.jsx v2025-10-04-milestones+percent-complete");

const fmtMoney = (n) => {
  if (n === null || n === undefined || n === "") return "—";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString(undefined, { style: "currency", currency: "USD" });
};

const fmtDate = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toISOString().slice(0, 10);
  } catch {
    return "—";
  }
};

export default function AgreementList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState(() => new Set());
  const [primaryId, setPrimaryId] = useState(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [pageSize, setPageSize] = useState(10);
  const [busyRow, setBusyRow] = useState(null);

  // --- NEW: milestone stats cache { [agreementId]: { total, complete, percent } }
  const [msStats, setMsStats] = useState({});

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/projects/agreements/", {
        params: { page_size: 250, _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];
      setRows(list);

      // Fetch milestone stats in the background for the first N visible rows
      // (We’ll refetch lazily as filters/paging change.)
      fetchStatsFor(list.slice(0, pageSize));
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreements.");
    } finally {
      setLoading(false);
    }
  };

  // --- NEW: Robust “is milestone complete?” detector
  const isMsComplete = (m) => {
    const sv = (x) =>
      String(x || "").trim().toLowerCase();
    const yes = (v) => v === true || v === "true" || v === 1 || v === "1";
    const status = sv(m.status);
    return (
      yes(m.completed) ||
      yes(m.is_complete) ||
      yes(m.approved) ||
      status === "complete" ||
      status === "completed" ||
      status === "approved" ||
      status === "done"
    );
  };

  // --- NEW: fetch stats for a subset (with tiny concurrency)
  const fetchStatsFor = async (subset) => {
    const ids = subset.map((r) => r.id).filter((id) => !msStats[id]);
    if (ids.length === 0) return;

    const limit = 5; // small concurrency to be gentle on the API
    let idx = 0;

    const runOne = async () => {
      const i = idx++;
      if (i >= ids.length) return;
      const agreementId = ids[i];
      try {
        const { data } = await api.get(`/projects/agreements/${agreementId}/milestones/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });
        const list = Array.isArray(data) ? data : [];
        const total = list.length;
        const complete = list.filter(isMsComplete).length;
        const percent = total > 0 ? Math.round((complete / total) * 100) : 0;
        setMsStats((prev) => ({ ...prev, [agreementId]: { total, complete, percent } }));
      } catch (e) {
        // Don’t spam errors; just leave stats blank
        console.warn("Milestone stats fetch failed for agreement", agreementId, e?.response?.status || e);
      } finally {
        await runOne();
      }
    };

    const starters = Math.min(limit, ids.length);
    await Promise.all(Array.from({ length: starters }, runOne));
  };

  useEffect(() => {
    load();
    const onStorage = (e) => {
      if (e.key === "agreements:refresh" && e.newValue === "1") {
        localStorage.removeItem("agreements:refresh");
        load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When filters change, make sure we fetch stats for newly-visible rows
  useEffect(() => {
    fetchStatsFor(rows.slice(0, pageSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pageSize]);

  const filtered = useMemo(() => {
    const search = q.trim().toLowerCase();
    return rows
      .filter((r) =>
        statusFilter === "all"
          ? true
          : String(r.status || "").toLowerCase() === statusFilter
      )
      .filter((r) => {
        if (!search) return true;
        const hay = [
          r.id,
          r.status,
          r.project_title,
          r.title,
          r.homeowner_name,
          r.homeowner_email,
          r.project_type,
          r.project_subtype,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(search);
      });
  }, [rows, q, statusFilter]);

  const page = filtered.slice(0, pageSize);

  const toggle = (id) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) {
        next.delete(id);
        if (primaryId === id) setPrimaryId(null);
      } else {
        next.add(id);
        if (!primaryId) setPrimaryId(id);
      }
      return next;
    });

  const toggleAll = () =>
    setSelected((old) => {
      const pageIds = page.map((r) => r.id);
      const allOn = pageIds.every((id) => old.has(id));
      const next = new Set(old);
      if (allOn) {
        pageIds.forEach((id) => next.delete(id));
        if (pageIds.includes(primaryId)) setPrimaryId(null);
      } else {
        pageIds.forEach((id) => next.add(id));
        if (!primaryId && pageIds.length > 0) setPrimaryId(pageIds[0]);
      }
      return next;
    });

  const choosePrimary = (id) => {
    if (!selected.has(id)) {
      setSelected((s) => new Set([...s, id]));
    }
    setPrimaryId(id);
  };

  const mergeSelected = async () => {
    const ids = Array.from(selected);
    if (ids.length < 2) return toast.error("Select at least two agreements.");
    const effectivePrimary =
      primaryId && ids.includes(primaryId) ? primaryId : ids[0];
    const merge_ids = ids.filter((i) => i !== effectivePrimary);

    try {
      await api.post("/projects/agreements/merge/", {
        primary_id: effectivePrimary,
        merge_ids,
      });
      toast.success("Agreements merged.");
      setSelected(new Set());
      setPrimaryId(null);
      await load();
      return;
    } catch (e1) {
      const d1 = e1?.response?.data;
      if (d1?.detail) toast.error(String(d1.detail));
      try {
        await api.post("/projects/agreements/merge/", { agreement_ids: ids });
        toast.success("Agreements merged.");
        setSelected(new Set());
        setPrimaryId(null);
        await load();
        return;
      } catch (e2) {
        const d2 = e2?.response?.data;
        if (d2?.detail) toast.error(String(d2.detail));
        try {
          const fd = new FormData();
          ids.forEach((id) => fd.append("ids[]", id));
          await api.post("/projects/agreements/merge/", fd);
          toast.success("Agreements merged.");
          setSelected(new Set());
          setPrimaryId(null);
          await load();
          return;
        } catch (e3) {
          const d3 = e3?.response?.data;
          if (d3?.detail) toast.error(String(d3.detail));
          try {
            await api.get("/projects/agreements/merge/", {
              params: { ids: ids.join(","), _ts: Date.now() },
              headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
            });
            toast.success("Agreements merged.");
            setSelected(new Set());
            setPrimaryId(null);
            await load();
            return;
          } catch (e4) {
            const d4 = e4?.response?.data;
            const msg =
              d4?.detail || d3?.detail || d2?.detail || d1?.detail || "Merge failed.";
            console.error("Merge errors:", e1, e2, e3, e4);
            toast.error(String(msg));
          }
        }
      }
    }
  };

  const goEdit = (id) => (window.location.href = `/agreements/${id}/edit`);

  const deleteDraft = async (row) => {
    if (String(row.status).toLowerCase() !== "draft") {
      return toast.error("Only draft agreements can be deleted.");
    }
    if (!confirm(`Delete draft Agreement #${row.id}? This cannot be undone.`))
      return;
    try {
      setBusyRow(row.id);
      await api.delete(`/projects/agreements/${row.id}/`);
      toast.success(`Agreement #${row.id} deleted.`);
      await load();
    } catch (e) {
      console.error(e);
      const detail =
        e?.response?.data?.detail ||
        "Delete failed. This agreement may have children, escrow funds, or paid invoices.";
      toast.error(String(detail));
    } finally {
      setBusyRow(null);
    }
  };

  const contractorSigned = (r) =>
    (typeof r.signed_by_contractor !== "undefined"
      ? r.signed_by_contractor
      : r.contractor_signed) || false;

  const homeownerSigned = (r) =>
    (typeof r.signed_by_homeowner !== "undefined"
      ? r.signed_by_homeowner
      : r.homeowner_signed) || false;

  const SignatureBadge = ({ ok, who }) =>
    ok ? (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <CheckCircle2 size={14} /> {who}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
        <XCircle size={14} /> {who}
      </span>
    );

  const renderProject = (r) => {
    const raw = (r.project_title || r.title || "").trim();
    if (/^agreement\s*#\d+$/i.test(raw)) return "—";
    return raw || "—";
  };

  const renderHomeowner = (r) => {
    const nm = (r.homeowner_name || "").trim();
    const em = (r.homeowner_email || "").trim();
    return nm || em || "—";
  };

  const renderType = (r) => (r.project_type || "—");
  const renderSubtype = (r) => (r.project_subtype || "—");

  // --- NEW: tiny progress bar
  const Progress = ({ percent }) => (
    <div className="w-24">
      <div className="h-2 bg-gray-200 rounded">
        <div
          className="h-2 bg-blue-600 rounded"
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by project, homeowner, type, subtype, email, ID…"
          className="border rounded-lg px-3 py-2 w-80"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border rounded-lg px-3 py-2"
        >
          <option value="all">All Status</option>
          <option value="draft">draft</option>
          <option value="signed">signed</option>
          <option value="funded">funded</option>
          <option value="in_progress">in_progress</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="border rounded-lg px-3 py-2"
        >
          {[10, 20, 50, 100, 250].map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </select>

        <button
          onClick={load}
          className="inline-flex items-center gap-2 px-3 py-2 border rounded-lg hover:bg-gray-50"
          title="Refresh"
        >
          <RefreshCw size={16} /> Refresh
        </button>

        <div className="flex-1" />

        <button
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          title="New Agreement"
          onClick={() => (window.location.href = "/agreements/new")}
        >
          <Plus size={16} /> New Agreement
        </button>

        <button
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg ${
            selected.size >= 2
              ? "bg-indigo-600 text-white hover:bg-indigo-700"
              : "bg-gray-300 text-gray-600 cursor-not-allowed"
          }`}
          disabled={selected.size < 2}
          onClick={mergeSelected}
          title="Merge Selected"
        >
          <Layers size={16} /> Merge Selected
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 border">
                <input
                  type="checkbox"
                  onChange={toggleAll}
                  checked={page.length > 0 && page.every((r) => selected.has(r.id))}
                />
              </th>
              <th className="p-2 text-left border">Primary</th>
              <th className="p-2 text-left border">Agreement ID</th>
              <th className="p-2 text-left border">Status</th>
              <th className="p-2 text-left border">Project</th>
              <th className="p-2 text-left border">Type</th>
              <th className="p-2 text-left border">Subtype</th>
              <th className="p-2 text-left border">Homeowner</th>
              <th className="p-2 text-left border">Start</th>
              <th className="p-2 text-left border">End</th>
              {/* NEW COLUMNS */}
              <th className="p-2 text-right border">Milestones</th>
              <th className="p-2 text-left border">% Complete</th>

              <th className="p-2 text-left border">Signatures</th>
              <th className="p-2 text-right border">Total</th>
              <th className="p-2 text-right border">Invoices</th>
              <th className="p-2 text-left border">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-3 border text-gray-600" colSpan={16}>
                  Loading…
                </td>
              </tr>
            ) : page.length === 0 ? (
              <tr>
                <td className="p-3 border text-gray-500" colSpan={16}>
                  No agreements found.
                </td>
              </tr>
            ) : (
              page.map((r) => {
                const isChecked = selected.has(r.id);
                const isPrimary = primaryId === r.id;
                const stat = msStats[r.id] || { total: 0, complete: 0, percent: 0 };

                return (
                  <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(r.id)}
                      />
                    </td>
                    <td className="p-2 border">
                      <button
                        onClick={() => choosePrimary(r.id)}
                        disabled={!isChecked}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border ${
                          isChecked
                            ? isPrimary
                              ? "bg-yellow-100 border-yellow-300"
                              : "hover:bg-gray-50"
                            : "text-gray-400 cursor-not-allowed"
                        }`}
                        title={
                          isChecked
                            ? isPrimary
                              ? "Primary"
                              : "Set as Primary"
                            : "Select row first"
                        }
                      >
                        <Star size={14} />
                        <span className="text-xs font-semibold">
                          {isPrimary ? "Primary" : "Set"}
                        </span>
                      </button>
                    </td>
                    <td className="p-2 border">#{r.id}</td>
                    <td className="p-2 border">
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-800">
                        {String(r.status || "—")}
                      </span>
                    </td>

                    <td className="p-2 border max-w-[320px] truncate" title={renderProject(r)}>
                      {renderProject(r)}
                    </td>

                    <td className="p-2 border whitespace-nowrap" title={renderType(r)}>
                      {renderType(r)}
                    </td>

                    <td className="p-2 border whitespace-nowrap" title={renderSubtype(r)}>
                      {renderSubtype(r)}
                    </td>

                    <td className="p-2 border max-w-[320px] truncate" title={renderHomeowner(r)}>
                      {renderHomeowner(r)}
                    </td>

                    <td className="p-2 border">{fmtDate(r.start)}</td>
                    <td className="p-2 border">{fmtDate(r.end)}</td>

                    {/* NEW: milestone stats */}
                    <td className="p-2 border text-right">
                      {stat.total ? `${stat.complete} / ${stat.total}` : "—"}
                    </td>
                    <td className="p-2 border">
                      <div className="flex items-center gap-2">
                        <Progress percent={stat.percent} />
                        <span className="w-10 text-xs">{stat.percent}%</span>
                      </div>
                    </td>

                    <td className="p-2 border">
                      <div className="flex items-center gap-2">
                        <span>
                          <SignatureBadge ok={contractorSigned(r)} who="Contractor" />
                        </span>
                        <span>
                          <SignatureBadge ok={homeownerSigned(r)} who="Homeowner" />
                        </span>
                      </div>
                    </td>

                    <td className="p-2 border text-right">
                      {fmtMoney(r.display_total ?? r.total_cost)}
                    </td>
                    <td className="p-2 border text-right">
                      {Number(r.invoices_count || 0)}
                    </td>
                    <td className="p-2 border">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => goEdit(r.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-gray-50"
                          title="Continue Editing"
                        >
                          <Pencil size={14} /> Edit
                        </button>
                        <button
                          onClick={() => deleteDraft(r)}
                          disabled={busyRow === r.id}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md ${
                            String(r.status).toLowerCase() === "draft"
                              ? "border border-red-300 text-red-700 hover:bg-red-50"
                              : "border border-gray-300 text-gray-400 cursor-not-allowed"
                          }`}
                          title="Delete Draft"
                        >
                          <Trash2 size={14} />{" "}
                          {busyRow === r.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Showing {Math.min(page.length, filtered.length)} of {filtered.length}. Select 2+ rows, choose a{" "}
        <b>Primary</b> (star), then click <b>Merge Selected</b>.
      </div>
    </div>
  );
}
