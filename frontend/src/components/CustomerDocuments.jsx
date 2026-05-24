import React from "react";
import { ExternalLink, FileText } from "lucide-react";

export default function CustomerDocuments({ documents = [], propertyProfile = {} }) {
  const propertyDocuments = [
    ...(propertyProfile?.documents || []),
    ...(propertyProfile?.photos || []).map((photo) => ({ ...photo, type_label: "Property Photo" })),
  ];
  const allDocuments = [...documents, ...propertyDocuments.filter((item) => !documents.some((doc) => doc.id === item.id))];

  return (
    <div data-testid="customer-portal-documents" className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Documents</h2>
          <p className="mt-1 text-sm text-slate-300">Agreement PDFs, receipts, shared attachments, and property records.</p>
        </div>
        <span className="rounded-full border border-slate-600 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-200">
          {allDocuments.length} files
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {allDocuments.length ? (
          allDocuments.map((document) => (
            <div key={document.id} className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-xl border border-slate-600 bg-slate-950 p-2 text-sky-200">
                  <FileText size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-white">{document.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{document.type_label || "Document"} - {document.project_title || "Property"}</div>
                  <div className="mt-1 text-xs text-slate-500">{document.date ? new Date(document.date).toLocaleDateString() : "No date"}</div>
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
          ))
        ) : (
          <div className="md:col-span-2 xl:col-span-3 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-6 text-sm text-slate-400">
            Documents shared with you will appear here.
          </div>
        )}
      </div>
    </div>
  );
}
