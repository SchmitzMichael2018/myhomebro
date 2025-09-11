// frontend/src/pages/AgreementList.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../api";

// --- helpers ---
const money = (n) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatusBadge({ text }) {
  const t = String(text || "").toLowerCase();
  const color =
    t === "signed" || t === "active"
      ? "bg-green-100 text-green-700"
      : t === "draft"
      ? "bg-gray-100 text-gray-700"
      : t === "pending"
      ? "bg-yellow-100 text-yellow-700"
      : "bg-blue-100 text-blue-700";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${color}`}>
      {text || "—"}
    </span>
  );
}

function EscrowBadge({ funded }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
        funded ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-800"
      }`}
      title={funded ? "Escrow funded" : "Escrow pending"}
    >
      {funded ? "funded" : "pending"}
    </span>
  );
}

function SignatureCell({ contractorOk, homeownerOk }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
          contractorOk ? "border-green-200 text-green-700" : "border-red-200 text-red-700"
        }`}
        title="Contractor signature"
      >
        <span className={contractorOk ? "text-green-600" : "text-red-600"}>
          {contractorOk ? "✅" : "❌"}
        </span>
        Contractor
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
          homeownerOk ? "border-green-200 text-green-700" : "border-red-200 text-red-700"
        }`}
        title="Homeowner signature"
      >
        <span className={homeownerOk ? "text-green-600" : "text-red-600"}>
          {homeownerOk ? "✅" : "❌"}
        </span>
        Homeowner
      </span>
    </div>
  );
}

function Select({ value, onChange, options, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-48 appearance-none rounded border border-gray-300 bg-white px-3 pr-10 text-sm leading-tight focus:border-blue-500 focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* chevron to prevent text/arrow overlap */}
      <svg
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path d="M7 10l5 5 5-5" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// --- page ---
export default function AgreementList() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [agreements, setAgreements] = useState([]);

  // filters/search
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | draft | pending | active | signed | archived
  const [escrowFilter, setEscrowFilter] = useState("all"); // all | funded | pending

  // selection for merge
  const [selectedIds, setSelectedIds] = useState([]);

  // pagination (client-side)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function fetchAgreements() {
    setLoading(true);
    try {
      const res = await api.get("/projects/agreements/");
      const data = Array.isArray(res.data) ? res.data : res.data?.results || [];
      setAgreements(data);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load agreements.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAgreements();
  }, []);

  // filter
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return agreements.filter((a) => {
      const matchesSearch =
        !needle ||
        [a.id, a.status, a.project_title, a.homeowner_name, a.start, a.end]
          .join(" ")
          .toLowerCase()
          .includes(needle);

      const matchesStatus = statusFilter === "all" || String(a.status || "").toLowerCase() === statusFilter;

      const matchesEscrow =
        escrowFilter === "all" ||
        (escrowFilter === "funded" ? !!a.escrow_funded : !a.escrow_funded);

      return matchesSearch && matchesStatus && matchesEscrow;
    });
  }, [agreements, q, statusFilter, escrowFilter]);

  // pagination
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const rows = filtered.slice(startIdx, startIdx + pageSize);

  // selection
  const allChecked = rows.length > 0 && rows.every((a) => selectedIds.includes(a.id));
  const someChecked = !allChecked && rows.some((a) => selectedIds.includes(a.id));

  function toggleAll() {
    if (allChecked) setSelectedIds((cur) => cur.filter((id) => !rows.find((r) => r.id === id)));
    else setSelectedIds((cur) => [...new Set([...cur, ...rows.map((r) => r.id)])]);
  }
  function toggleOne(id) {
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  // merge
  function choosePrimary(ids) {
    const signed = rows.find((a) => ids.includes(a.id) && a.signed_by_contractor && a.signed_by_homeowner);
    return signed ? signed.id : [...ids].sort((a, b) => a - b)[0];
  }
  async function mergeSelected() {
    const ids = selectedIds.filter((id) => filtered.find((a) => a.id === id));
    if (ids.length < 2) return toast.error("Select at least two agreements to merge.");
    const primary_id = choosePrimary(ids);
    const merge_ids = ids.filter((x) => x !== primary_id);
    try {
      await api.post("/projects/agreements/merge/", { primary_id, merge_ids });
      toast.success("Merged.");
      setSelectedIds([]);
      fetchAgreements();
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Merge failed.");
    }
  }

  // --- UI ---
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6">
      <h1 className="text-3xl font-bold text-gray-800">Agreements</h1>

      {/* Toolbar */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="h-10 w-80 rounded border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="Search by project, homeowner…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />

        <Select
          className="ml-1"
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All Status" },
            { value: "draft", label: "Draft" },
            { value: "pending", label: "Pending" },
            { value: "active", label: "Active" },
            { value: "signed", label: "Signed" },
            { value: "archived", label: "Archived" },
          ]}
        />

        <Select
          value={escrowFilter}
          onChange={(v) => {
            setEscrowFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All Escrow" },
            { value: "funded", label: "Escrow Funded" },
            { value: "pending", label: "Escrow Pending" },
          ]}
        />

        <button
          onClick={fetchAgreements}
          className="h-10 rounded border border-gray-300 px-3 text-sm hover:bg-gray-50"
          title="Refresh"
        >
          Refresh
        </button>

        <div className="ml-auto flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onChange={(v) => {
              const n = Number(v) || 10;
              setPageSize(n);
              setPage(1);
            }}
            options={[
              { value: "10", label: "10 / page" },
              { value: "25", label: "25 / page" },
              { value: "50", label: "50 / page" },
              { value: "100", label: "100 / page" },
            ]}
          />
          <button
            onClick={() => navigate("/agreements/new")}
            className="h-10 rounded bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + New Agreement
          </button>
          <button
            onClick={mergeSelected}
            disabled={selectedIds.length < 2}
            className={`h-10 rounded px-3 text-sm font-semibold ${
              selectedIds.length < 2
                ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            }`}
          >
            Merge Selected
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-auto rounded-xl bg-white shadow ring-1 ring-black/5">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr className="text-left text-gray-600">
              <th className="px-3 py-2 w-10">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((a) => selectedIds.includes(a.id))}
                  ref={(el) => {
                    if (!el) return;
                    const all = rows.length > 0 && rows.every((a) => selectedIds.includes(a.id));
                    const some = !all && rows.some((a) => selectedIds.includes(a.id));
                    el.indeterminate = some;
                  }}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2">Agreement ID</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Homeowner</th>
              <th className="px-3 py-2">Start</th>
              <th className="px-3 py-2">End</th>
              <th className="px-3 py-2">Signatures</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Escrow</th>
              <th className="px-3 py-2 text-right">Invoices</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-gray-500">
                  No agreements found.
                </td>
              </tr>
            )}

            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(a.id)}
                    onChange={() => toggleOne(a.id)}
                  />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="text-gray-700 font-semibold">#{a.id}</span>
                  {a.amendment_number > 0 && (
                    <span className="ml-2 rounded bg-purple-100 text-purple-700 px-2 py-0.5 text-[11px] font-semibold">
                      Amendment #{a.amendment_number}
                      {a.parent_agreement_id ? ` (to #${a.parent_agreement_id})` : ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge text={a.status || "draft"} />
                </td>
                <td className="px-3 py-2">{a.project_title || "—"}</td>
                <td className="px-3 py-2">{a.homeowner_name || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{a.start || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{a.end || "—"}</td>
                <td className="px-3 py-2">
                  <SignatureCell
                    contractorOk={!!a.signed_by_contractor}
                    homeownerOk={!!a.signed_by_homeowner}
                  />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">${money(a.total_cost)}</td>
                <td className="px-3 py-2">
                  <EscrowBadge funded={!!a.escrow_funded} />
                </td>
                <td className="px-3 py-2 text-right">
                  {typeof a.invoices_count === "number" ? a.invoices_count : 0}{" "}
                  <span className="text-gray-500">Invoices</span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded bg-indigo-600 text-white px-3 py-1.5 text-xs hover:bg-indigo-700"
                      onClick={() => navigate(`/agreements/${a.id}/edit`)}
                    >
                      Continue Editing
                    </button>
                    {a.status === "draft" && (
                      <button
                        className="rounded bg-red-600 text-white px-3 py-1.5 text-xs hover:bg-red-700"
                        onClick={async () => {
                          if (!confirm("Delete this draft agreement?")) return;
                          try {
                            await api.delete(`/projects/agreements/${a.id}/`);
                            toast.success("Draft deleted.");
                            fetchAgreements();
                          } catch (e) {
                            console.error(e);
                            toast.error("Could not delete draft.");
                          }
                        }}
                      >
                        Delete Draft
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {loading && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          Showing{" "}
          <span className="font-semibold">
            {total === 0 ? 0 : startIdx + 1}–{Math.min(startIdx + pageSize, total)}
          </span>{" "}
          of <span className="font-semibold">{total}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-700">
            Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>
          </span>
          <button
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            Next →
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Tip: Select two or more rows and click <strong>Merge Selected</strong>. If any selected
        agreement is fully signed, that one becomes primary and others become amendments. If none are
        signed, the first selected becomes primary and the others roll up (milestones move and totals sum).
      </p>
    </div>
  );
}
