import React, { useMemo, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";

const DOCUMENT_GROUPS = [
  "Agreements",
  "Invoices & Receipts",
  "Warranties",
  "Permits",
  "Inspection Reports",
  "Maintenance Records",
  "Photos",
  "Manuals",
  "Insurance / HOA",
  "Other",
];

function documentGroupLabel(document) {
  const type = String(`${document?.type_label || ""} ${document?.document_type || ""} ${document?.kind || ""} ${document?.title || ""} ${document?.filename || ""}`).toLowerCase();
  if (type.includes("agreement") || type.includes("contract")) return "Agreements";
  if (type.includes("invoice") || type.includes("receipt") || type.includes("payment")) return "Invoices & Receipts";
  if (type.includes("warranty")) return "Warranties";
  if (type.includes("permit")) return "Permits";
  if (type.includes("inspection") || type.includes("report")) return "Inspection Reports";
  if (type.includes("maintenance") || type.includes("service record") || type.includes("work order")) return "Maintenance Records";
  if (type.includes("photo") || type.includes("image")) return "Photos";
  if (type.includes("manual") || type.includes("spec sheet") || type.includes("owner guide")) return "Manuals";
  if (type.includes("insurance") || type.includes("hoa")) return "Insurance / HOA";
  return "Other";
}

export default function CustomerDocuments({ documents = [], propertyProfile = {}, onUpload, uploading = false, uploadError = "" }) {
  const [uploadForm, setUploadForm] = useState({ kind: "document", title: "", documentType: "", file: null });
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const propertyDocuments = [
    ...(propertyProfile?.documents || []),
    ...(propertyProfile?.photos || []).map((photo) => ({ ...photo, type_label: "Property Photo" })),
  ];
  const allDocuments = useMemo(
    () => [...documents, ...propertyDocuments.filter((item) => !documents.some((doc) => doc.id === item.id))],
    [documents, propertyDocuments]
  );
  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allDocuments.filter((document) => {
      const group = documentGroupLabel(document);
      if (category !== "All" && group !== category) return false;
      if (!needle) return true;
      const haystack = [
        document.title,
        document.filename,
        document.type_label,
        document.document_type,
        document.project_title,
        document.property_name,
        document.system_name,
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [allDocuments, category, query]);
  const defaultCount = 9;
  const visibleDocuments = expanded ? filteredDocuments : filteredDocuments.slice(0, defaultCount);
  const groupedDocuments = visibleDocuments.reduce((groups, document) => {
    const label = documentGroupLabel(document);
    groups[label] = groups[label] || [];
    groups[label].push(document);
    return groups;
  }, {});

  return (
    <div data-testid="customer-portal-documents" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-200">Home Document Vault</div>
          <h2 className="mt-1 text-xl font-semibold text-white">Documents</h2>
          <p className="mt-1 text-sm text-slate-300">Find agreements, receipts, warranties, permits, photos, manuals, insurance records, and maintenance files by property or project context.</p>
        </div>
        <span className="rounded-full border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200">
          {allDocuments.length} files
        </span>
      </div>

      <form
        data-testid="customer-documents-upload-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await onUpload?.(uploadForm);
          if (ok !== false) {
            setUploadForm((prev) => ({ ...prev, title: "", documentType: "", file: null }));
            event.currentTarget.reset();
          }
        }}
        className="mt-5 grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 md:grid-cols-2 xl:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
      >
        <label className="block text-sm font-medium text-slate-200">
          Type
          <select
            value={uploadForm.kind}
            onChange={(event) => setUploadForm((prev) => ({ ...prev, kind: event.target.value }))}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          >
            <option value="document">Document</option>
            <option value="photo">Photo</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Title
          <input
            value={uploadForm.title}
            onChange={(event) => setUploadForm((prev) => ({ ...prev, title: event.target.value }))}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Document type
          <input
            value={uploadForm.documentType}
            onChange={(event) => setUploadForm((prev) => ({ ...prev, documentType: event.target.value }))}
            disabled={uploadForm.kind === "photo"}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400 disabled:opacity-50"
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          File
          <input
            type="file"
            data-testid="customer-documents-upload-file"
            onChange={(event) => setUploadForm((prev) => ({ ...prev, file: event.target.files?.[0] || null }))}
            accept={uploadForm.kind === "photo" ? "image/*" : undefined}
            className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-400 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:file:bg-sky-300"
          />
        </label>
        <button
          type="submit"
          disabled={uploading || !uploadForm.file}
          className="self-end rounded-xl border border-sky-300/40 bg-sky-400/15 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? "Uploading..." : "Upload"}
        </button>
        {uploadError ? (
          <div data-testid="customer-documents-upload-error" className="rounded-lg border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100 md:col-span-2 xl:col-span-5">
            {uploadError}
          </div>
        ) : null}
      </form>

      <div data-testid="customer-documents-vault-controls" className="mt-5 grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/55 p-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <label className="block text-sm font-medium text-slate-200">
          Search documents
          <input
            data-testid="customer-documents-search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setExpanded(false);
            }}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            placeholder="Search title, file name, project, property, system..."
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Category
          <select
            data-testid="customer-documents-category-filter"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setExpanded(false);
            }}
            className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
          >
            <option value="All">All records</option>
            {DOCUMENT_GROUPS.map((label) => (
              <option key={label} value={label}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 space-y-4">
        {filteredDocuments.length ? (
          DOCUMENT_GROUPS.filter((group) => groupedDocuments[group]?.length).map((group) => {
            const rows = groupedDocuments[group];
            return (
            <section key={group} className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">{group}</h3>
                <span className="rounded-full border border-slate-600 bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-200">
                  {rows.length}
                </span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((document) => (
                  <div key={document.id} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl border border-slate-600 bg-slate-950 p-2 text-sky-200">
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{document.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{document.type_label || "Document"} - {document.project_title || document.property_name || document.system_name || "Property"}</div>
                        <div className="mt-1 text-xs text-slate-500">{document.date ? new Date(document.date).toLocaleDateString() : "No date"}</div>
                        <div className="mt-1 truncate text-xs text-slate-400">{document.filename || "Filename pending"}</div>
                      </div>
                    </div>
                    {document.url ? (
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-sky-300/40 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/20"
                      >
                        Open file
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          );
          })
        ) : (
          <div data-testid="customer-documents-empty" className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-300">
            <div className="font-semibold text-white">{allDocuments.length ? "No matching documents" : "No documents yet"}</div>
            <p className="mt-1 leading-6 text-slate-400">
              {allDocuments.length
                ? "Try another search term or category."
                : "Upload property files here, or return later to find agreement PDFs, receipts, shared attachments, manuals, and photos."}
            </p>
          </div>
        )}
      </div>
      {filteredDocuments.length > defaultCount ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs font-semibold text-slate-400">
            Showing {expanded ? filteredDocuments.length : defaultCount} of {filteredDocuments.length} documents
          </div>
          <button
            type="button"
            data-testid="customer-documents-show-more"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-amber-300/50 hover:text-white"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
