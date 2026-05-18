import React, { useEffect, useMemo, useState } from "react";
import api from "../../api";

const RADIUS_OPTIONS = [
  { value: "5", label: "5 miles" },
  { value: "10", label: "10 miles" },
  { value: "15", label: "15 miles" },
  { value: "25", label: "25 miles" },
  { value: "50", label: "50 miles" },
  { value: "100", label: "50+ miles" },
];

const EXPORT_HEADERS = [
  "id",
  "business_name",
  "website",
  "phone",
  "city",
  "state",
  "public_email",
  "services",
  "email_source_url",
  "services_source_url",
  "enrichment_notes",
  "profile_status",
  "enrichment_status",
  "last_seen_at",
];

const pageBackground = {
  background: "linear-gradient(135deg, #041735 0%, #063f96 38%, #667f88 70%, #f0c94b 100%)",
};

const sectionClass = "rounded-2xl border border-white/10 bg-[#061d42]/95 p-5 text-white shadow-[0_22px_50px_rgba(2,8,23,0.32)]";
const inputClass = "w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-sky-100/45 outline-none focus:border-sky-200";
const labelClass = "mb-1 block text-xs font-bold uppercase tracking-wide text-sky-100/65";
const subtlePanelClass = "rounded-xl border border-white/10 bg-white/8";
const tableHeadClass = "border-b border-white/10 px-3 py-2 font-bold";
const tableCellClass = "px-3 py-3 text-sky-100/80";

function safeText(value) {
  return String(value ?? "").trim();
}

function formatDate(value) {
  if (!value) return "Not seen yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return safeText(value);
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function websiteHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function servicesToText(value) {
  if (Array.isArray(value)) return value.join(", ");
  return safeText(value);
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("; ") : safeText(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows) {
  const body = rows.map((row) =>
    EXPORT_HEADERS.map((key) => {
      if (key === "public_email") return csvEscape(row.public_email || "");
      return csvEscape(row[key] ?? "");
    }).join(",")
  );
  const blob = new Blob([[EXPORT_HEADERS.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "contractor-directory-missing-emails.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function editFormFromRow(row) {
  return {
    business_name: row?.business_name || "",
    website: row?.website || "",
    phone: row?.phone || "",
    public_email: row?.public_email || "",
    services: servicesToText(row?.services || []),
    email_source_url: row?.email_source_url || "",
    services_source_url: row?.services_source_url || "",
    enrichment_notes: row?.enrichment_notes || "",
    enrichment_status: row?.enrichment_status || "not_started",
    profile_status: row?.profile_status || "basic",
  };
}

export default function AdminContractorDirectory() {
  const [searchForm, setSearchForm] = useState({
    query: "",
    city: "",
    state: "",
    zip: "",
    radius_miles: "25",
  });
  const [filters, setFilters] = useState({
    missing_email: false,
    has_website: false,
    city: "",
    state: "",
    claimed: "",
    source: "",
    profile_status: "",
    enrichment_status: "",
  });
  const [searchResults, setSearchResults] = useState([]);
  const [searchSummary, setSearchSummary] = useState(null);
  const [directoryRows, setDirectoryRows] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [directoryError, setDirectoryError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingRow, setEditingRow] = useState(null);
  const [editForm, setEditForm] = useState(editFormFromRow(null));
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importRows, setImportRows] = useState([]);
  const [approvedRows, setApprovedRows] = useState({});
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");

  const exportRows = useMemo(
    () => directoryRows.filter((row) => !row.public_email && row.website),
    [directoryRows]
  );

  async function loadDirectory(nextFilters = filters) {
    setDirectoryLoading(true);
    setDirectoryError("");
    try {
      const params = {
        ...(nextFilters.missing_email ? { missing_email: "true" } : {}),
        ...(nextFilters.has_website ? { has_website: "true" } : {}),
        ...(safeText(nextFilters.city) ? { city: nextFilters.city } : {}),
        ...(safeText(nextFilters.state) ? { state: nextFilters.state } : {}),
        ...(safeText(nextFilters.claimed) ? { claimed: nextFilters.claimed } : {}),
        ...(safeText(nextFilters.source) ? { source: nextFilters.source } : {}),
        ...(safeText(nextFilters.profile_status) ? { profile_status: nextFilters.profile_status } : {}),
        ...(safeText(nextFilters.enrichment_status) ? { enrichment_status: nextFilters.enrichment_status } : {}),
      };
      const { data } = await api.get("/projects/admin/contractor-directory/", { params });
      setDirectoryRows(Array.isArray(data?.results) ? data.results : []);
    } catch (error) {
      setDirectoryError(error?.response?.data?.detail || "Could not load contractor directory.");
      setDirectoryRows([]);
    } finally {
      setDirectoryLoading(false);
    }
  }

  useEffect(() => {
    loadDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setSearchField(name, value) {
    setSearchForm((prev) => ({ ...prev, [name]: value }));
  }

  function setFilterField(name, value) {
    const next = { ...filters, [name]: value };
    setFilters(next);
    loadDirectory(next);
  }

  async function runSearch(event) {
    event.preventDefault();
    setSearchLoading(true);
    setSearchError("");
    setSuccessMessage("");
    try {
      const { data } = await api.get("/projects/admin/contractor-search/", {
        params: {
          query: searchForm.query,
          city: searchForm.city,
          state: searchForm.state,
          zip: searchForm.zip,
          radius_miles: searchForm.radius_miles,
        },
      });
      setSearchResults(Array.isArray(data?.results) ? data.results : []);
      setSearchSummary(data?.summary || null);
      setSuccessMessage("Search results are automatically saved to the contractor directory.");
      await loadDirectory();
    } catch (error) {
      setSearchError(error?.response?.data?.detail || "Contractor search failed.");
      setSearchResults([]);
      setSearchSummary(null);
    } finally {
      setSearchLoading(false);
    }
  }

  function openEdit(row) {
    setEditingRow(row);
    setEditForm(editFormFromRow(row));
    setEditError("");
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editingRow) return;
    setEditSaving(true);
    setEditError("");
    try {
      await api.patch(`/projects/admin/contractor-directory/${editingRow.id}/`, editForm);
      setEditingRow(null);
      setSuccessMessage("Contractor directory entry updated.");
      await loadDirectory();
    } catch (error) {
      const apiErrors = error?.response?.data?.errors;
      setEditError(apiErrors?.public_email || error?.response?.data?.detail || "Could not save this contractor.");
    } finally {
      setEditSaving(false);
    }
  }

  async function previewImport() {
    setImportLoading(true);
    setImportError("");
    setImportMessage("");
    try {
      const { data } = await api.post("/projects/admin/contractor-directory/import-preview/", { csv_text: csvText });
      const rows = Array.isArray(data?.results) ? data.results : [];
      setImportRows(rows);
      setApprovedRows({});
      setImportMessage(`${rows.length} import rows ready for review.`);
    } catch (error) {
      setImportError(error?.response?.data?.detail || "Could not preview this CSV.");
      setImportRows([]);
    } finally {
      setImportLoading(false);
    }
  }

  async function applyImport() {
    setImportLoading(true);
    setImportError("");
    setImportMessage("");
    try {
      const rows = importRows.map((row, index) => ({
        ...row,
        admin_approved: Boolean(approvedRows[index]),
      }));
      const { data } = await api.post("/projects/admin/contractor-directory/import-apply/", { rows });
      setImportMessage(`Updated ${data?.updated_count || 0} entries. Skipped ${data?.skipped_count || 0}.`);
      await loadDirectory();
    } catch (error) {
      setImportError(error?.response?.data?.detail || "Could not apply import updates.");
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <div className="min-h-screen space-y-6 px-4 py-6 md:px-6" style={pageBackground} data-testid="admin-contractor-directory-page">
      <div>
        <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-sky-100/70">Admin</div>
        <h1 className="mt-2 text-3xl font-extrabold text-white drop-shadow-sm">Contractor Directory</h1>
        <p className="mt-2 max-w-3xl text-sm text-sky-100/80">
          Search contractors manually, capture public business data, and prepare website lists for manual enrichment.
        </p>
      </div>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-white">Manual Contractor Search</h2>
            <p className="mt-1 text-sm text-sky-100/75">
              Search results are automatically saved to the contractor directory.
            </p>
          </div>
          {searchSummary ? (
            <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-bold text-white">
              {Number(searchSummary.directory_entries_count || searchResults.length || 0)} captured
            </div>
          ) : null}
        </div>

        <form onSubmit={runSearch} className="mt-4 grid gap-3 md:grid-cols-6">
          <label className="md:col-span-2">
            <span className={labelClass}>Search term</span>
            <input data-testid="admin-contractor-search-term" value={searchForm.query} onChange={(event) => setSearchField("query", event.target.value)} placeholder="concrete contractor" className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>City</span>
            <input data-testid="admin-contractor-search-city" value={searchForm.city} onChange={(event) => setSearchField("city", event.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>State</span>
            <input data-testid="admin-contractor-search-state" value={searchForm.state} onChange={(event) => setSearchField("state", event.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>ZIP</span>
            <input data-testid="admin-contractor-search-zip" value={searchForm.zip} onChange={(event) => setSearchField("zip", event.target.value)} className={inputClass} />
          </label>
          <label>
            <span className={labelClass}>Radius</span>
            <select data-testid="admin-contractor-search-radius" value={searchForm.radius_miles} onChange={(event) => setSearchField("radius_miles", event.target.value)} className={inputClass}>
              {RADIUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="md:col-span-6">
            <button type="submit" data-testid="admin-contractor-search-submit" disabled={searchLoading} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#0a2550] shadow-sm hover:bg-sky-50 disabled:opacity-60">
              {searchLoading ? "Searching..." : "Search Contractors"}
            </button>
          </div>
        </form>

        {searchError ? <div className="mt-3 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{searchError}</div> : null}
        {successMessage ? <div className="mt-3 rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">{successMessage}</div> : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2" data-testid="admin-contractor-search-results">
          {searchResults.map((row) => (
            <article key={row.id || row.google_place_id || row.business_name} className={`${subtlePanelClass} p-4`}>
              <div className="font-bold text-white">{row.business_name || "Unnamed contractor"}</div>
              <div className="mt-1 text-sm text-sky-100/70">{[row.city, row.state].filter(Boolean).join(", ") || row.formatted_address}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-sky-100/65">
                <span>{row.source || "google_places"}</span>
                {row.directory_entry_id ? <span>Entry #{row.directory_entry_id}</span> : <span>Captured</span>}
                {row.rating ? <span>{Number(row.rating).toFixed(1)} rating</span> : null}
                {row.review_count ? <span>{row.review_count} reviews</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {row.website_url || row.website ? <a className="font-semibold text-sky-100 hover:underline" href={row.website_url || row.website} target="_blank" rel="noreferrer">{websiteHost(row.website_url || row.website)}</a> : null}
                {row.phone || row.phone_number ? <span>{row.phone || row.phone_number}</span> : null}
              </div>
            </article>
          ))}
          {!searchLoading && !searchResults.length ? (
            <div className="rounded-xl border border-dashed border-white/20 bg-white/8 px-4 py-6 text-sm text-sky-100/70 md:col-span-2">
              Search results will appear here.
            </div>
          ) : null}
        </div>
      </section>

      <section className={sectionClass} data-testid="admin-contractor-import-section">
        <h2 className="text-lg font-extrabold text-white">Import Enriched CSV</h2>
        <p className="mt-1 text-sm text-sky-100/75">
          Paste reviewed website/email enrichment rows, preview matches, then apply approved updates.
        </p>
        <textarea data-testid="admin-contractor-import-csv" value={csvText} onChange={(event) => setCsvText(event.target.value)} placeholder="id,business_name,website,public_email,phone,services,email_source_url,services_source_url,enrichment_notes" className={`${inputClass} mt-4 min-h-28 font-mono`} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" data-testid="admin-contractor-import-preview" onClick={previewImport} disabled={importLoading || !safeText(csvText)} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#0a2550] disabled:opacity-60">Preview Import</button>
          <button type="button" data-testid="admin-contractor-import-apply" onClick={applyImport} disabled={importLoading || !importRows.length} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Apply Approved Updates</button>
        </div>
        {importError ? <div className="mt-3 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{importError}</div> : null}
        {importMessage ? <div className="mt-3 rounded-xl border border-sky-300/30 bg-sky-400/10 px-3 py-2 text-sm text-sky-100">{importMessage}</div> : null}
        {importRows.length ? (
          <div className="mt-4 overflow-x-auto" data-testid="admin-contractor-import-preview-table">
            <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-sky-100/65">
                  {["Approve", "Match Status", "Business Name", "Existing Email", "Proposed Email", "Existing Services", "Proposed Services", "Warnings"].map((heading) => (
                    <th key={heading} className={tableHeadClass}>{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importRows.map((row, index) => (
                  <tr key={`${row.matched_entry_id || "row"}-${index}`}>
                    <td className={tableCellClass}>
                      <input type="checkbox" aria-label={`Approve import row ${index + 1}`} checked={Boolean(approvedRows[index])} onChange={(event) => setApprovedRows((prev) => ({ ...prev, [index]: event.target.checked }))} />
                    </td>
                    <td className={`${tableCellClass} font-semibold text-white`}>{row.status}</td>
                    <td className={tableCellClass}>{row.business_name}</td>
                    <td className={tableCellClass}>{row.existing_public_email || "Email not listed"}</td>
                    <td className={tableCellClass}>{row.proposed_public_email || ""}</td>
                    <td className={tableCellClass}>{servicesToText(row.existing_services)}</td>
                    <td className={tableCellClass}>{servicesToText(row.proposed_services)}</td>
                    <td className={tableCellClass}>{(row.warnings || []).join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-white">Saved Contractor Directory</h2>
            <p className="mt-1 text-sm text-sky-100/75">
              Use this view to export contractor websites for manual email/service enrichment.
            </p>
          </div>
          <button type="button" data-testid="admin-contractor-directory-export" onClick={() => downloadCsv(exportRows)} disabled={!exportRows.length} className="rounded-xl border border-white/20 bg-white px-4 py-2 text-sm font-bold text-[#0a2550] hover:bg-sky-50 disabled:opacity-60">
            Export Missing Emails CSV
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4 lg:grid-cols-8">
          <label className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-sm font-semibold text-sky-100">
            <input type="checkbox" data-testid="admin-contractor-filter-missing-email" checked={filters.missing_email} onChange={(event) => setFilterField("missing_email", event.target.checked)} />
            Missing Email
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-sm font-semibold text-sky-100">
            <input type="checkbox" data-testid="admin-contractor-filter-has-website" checked={filters.has_website} onChange={(event) => setFilterField("has_website", event.target.checked)} />
            Has Website
          </label>
          <input data-testid="admin-contractor-filter-city" placeholder="City" value={filters.city} onChange={(event) => setFilterField("city", event.target.value)} className={inputClass} />
          <input data-testid="admin-contractor-filter-state" placeholder="State" value={filters.state} onChange={(event) => setFilterField("state", event.target.value)} className={inputClass} />
          <select value={filters.claimed} onChange={(event) => setFilterField("claimed", event.target.value)} className={inputClass}>
            <option value="">Claimed</option>
            <option value="true">Claimed</option>
            <option value="false">Unclaimed</option>
          </select>
          <input placeholder="Source" value={filters.source} onChange={(event) => setFilterField("source", event.target.value)} className={inputClass} />
          <input placeholder="Profile status" value={filters.profile_status} onChange={(event) => setFilterField("profile_status", event.target.value)} className={inputClass} />
          <input placeholder="Enrichment status" value={filters.enrichment_status} onChange={(event) => setFilterField("enrichment_status", event.target.value)} className={inputClass} />
        </div>

        {directoryError ? <div className="mt-3 rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{directoryError}</div> : null}

        <div className="mt-4 overflow-x-auto" data-testid="admin-contractor-directory-table">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-sky-100/65">
                {["Actions", "Business Name", "Website", "Phone", "Email", "City", "State", "Rating", "Reviews", "Claimed", "Profile Status", "Enrichment Status", "Last Seen"].map((heading) => (
                  <th key={heading} className={tableHeadClass}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {directoryRows.map((row) => (
                <tr key={row.id} className="border-b border-white/10">
                  <td className={tableCellClass}>
                    <button type="button" data-testid={`admin-contractor-edit-${row.id}`} onClick={() => openEdit(row)} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-white">Edit</button>
                  </td>
                  <td className={`${tableCellClass} font-semibold text-white`}>{row.business_name}</td>
                  <td className={tableCellClass}>{row.website ? <a href={row.website} target="_blank" rel="noreferrer" className="font-semibold text-sky-100 hover:underline">{websiteHost(row.website)}</a> : <span className="text-sky-100/45">Not listed</span>}</td>
                  <td className={tableCellClass}>{row.phone || "Not listed"}</td>
                  <td className={tableCellClass}>{row.public_email || "Email not listed"}</td>
                  <td className={tableCellClass}>{row.city || ""}</td>
                  <td className={tableCellClass}>{row.state || ""}</td>
                  <td className={tableCellClass}>{row.rating ?? ""}</td>
                  <td className={tableCellClass}>{row.review_count ?? ""}</td>
                  <td className={tableCellClass}>{row.claimed ? "Yes" : "No"}</td>
                  <td className={tableCellClass}>{row.profile_status}</td>
                  <td className={tableCellClass}>{row.enrichment_status}</td>
                  <td className={tableCellClass}>{formatDate(row.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!directoryLoading && !directoryRows.length ? <div className="rounded-xl border border-dashed border-white/20 bg-white/8 px-4 py-6 text-sm text-sky-100/70">No contractors captured yet. Use admin search to start building the directory.</div> : null}
          {directoryLoading ? <div className="px-4 py-6 text-sm text-sky-100/70">Loading contractor directory...</div> : null}
        </div>
      </section>

      {editingRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" data-testid="admin-contractor-edit-modal">
          <form onSubmit={saveEdit} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">Edit Contractor Entry</h2>
                <p className="mt-1 text-sm text-slate-600">Update public contact details and enrichment notes from manual review.</p>
              </div>
              <button type="button" onClick={() => setEditingRow(null)} className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-bold">Close</button>
            </div>
            {editError ? <div className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</div> : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                ["business_name", "Business Name"],
                ["website", "Website"],
                ["phone", "Phone"],
                ["public_email", "Public Email"],
                ["email_source_url", "Email Source URL"],
                ["services_source_url", "Services Source URL"],
              ].map(([name, label]) => (
                <label key={name}>
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>
                  <input data-testid={`admin-contractor-edit-${name}`} value={editForm[name]} onChange={(event) => setEditForm((prev) => ({ ...prev, [name]: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
                </label>
              ))}
              <label>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Enrichment Status</span>
                <select value={editForm.enrichment_status} onChange={(event) => setEditForm((prev) => ({ ...prev, enrichment_status: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <option value="not_started">Not Started</option>
                  <option value="reviewed">Reviewed</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Profile Status</span>
                <select value={editForm.profile_status} onChange={(event) => setEditForm((prev) => ({ ...prev, profile_status: event.target.value }))} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <option value="basic">Basic</option>
                  <option value="reviewed">Reviewed</option>
                </select>
              </label>
              <label className="md:col-span-2">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Services</span>
                <textarea data-testid="admin-contractor-edit-services" value={editForm.services} onChange={(event) => setEditForm((prev) => ({ ...prev, services: event.target.value }))} className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="md:col-span-2">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Enrichment Notes</span>
                <textarea value={editForm.enrichment_notes} onChange={(event) => setEditForm((prev) => ({ ...prev, enrichment_notes: event.target.value }))} className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditingRow(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">Cancel</button>
              <button type="submit" data-testid="admin-contractor-edit-save" disabled={editSaving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{editSaving ? "Saving..." : "Save Entry"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
