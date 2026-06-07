import React, { useEffect, useState } from "react";

function formatDate(value) {
  if (!value) return "Date pending";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function money(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "";
}

function EmptyState({ title, children, testId }) {
  return (
    <div data-testid={testId} className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/45 p-4 text-sm text-slate-300">
      <div className="font-semibold text-white">{title}</div>
      <p className="mt-1 leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function Section({ title, eyebrow, children, testId }) {
  return (
    <section data-testid={testId} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5 shadow-xl shadow-slate-950/20">
      {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200/80">{eyebrow}</div> : null}
      <h3 className="mt-1 text-lg font-semibold text-white">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function categoryForDocument(item) {
  const text = `${item?.type_label || ""} ${item?.title || ""} ${item?.filename || ""}`.toLowerCase();
  if (text.includes("agreement") || text.includes("contract")) return "Agreements";
  if (text.includes("invoice") || text.includes("receipt") || text.includes("payment")) return "Invoices & Receipts";
  if (text.includes("warranty")) return "Warranties";
  if (text.includes("permit")) return "Permits";
  if (text.includes("insurance")) return "Insurance Documents";
  if (text.includes("photo") || text.includes("image")) return "Photos";
  return "Other Property Documents";
}

function documentGroups(profile, documents) {
  const rows = [
    ...(documents || []),
    ...(profile?.documents || []),
    ...(profile?.photos || []).map((photo) => ({ ...photo, type_label: photo.type_label || "Photo" })),
  ];
  const seen = new Set();
  const grouped = {
    Agreements: [],
    "Invoices & Receipts": [],
    Warranties: [],
    Photos: [],
    Permits: [],
    "Insurance Documents": [],
    "Other Property Documents": [],
  };
  for (const row of rows) {
    const key = `${row.id || ""}|${row.url || ""}|${row.title || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grouped[categoryForDocument(row)].push(row);
  }
  return grouped;
}

function warrantyRows(agreements, documents) {
  return (agreements || [])
    .filter((agreement) => String(agreement.warranty_text || "").trim())
    .map((agreement) => ({
      id: `warranty-${agreement.id}`,
      project: agreement.project_title || "Project",
      contractor: agreement.contractor_name || "Your contractor",
      warrantyType: agreement.warranty_type || "Warranty",
      text: agreement.warranty_text,
      date: agreement.completed_at || agreement.updated_at,
      documents: (documents || []).filter((document) => {
        const haystack = `${document.title || ""} ${document.type_label || ""} ${document.project_title || ""}`.toLowerCase();
        return haystack.includes("warranty") && (!document.project_title || document.project_title === agreement.project_title);
      }),
    }));
}

function completedProjectRows(projects, agreements, documents) {
  const agreementById = new Map((agreements || []).map((agreement) => [String(agreement.id), agreement]));
  return (projects || [])
    .filter((project) => {
      const status = String(project.status || project.status_label || "").toLowerCase();
      return status.includes("complete") || status.includes("closed") || status.includes("archived");
    })
    .map((project) => {
      const agreement = agreementById.get(String(project.agreement_id)) || {};
      return {
        id: project.id,
        title: project.title || agreement.project_title || "Completed project",
        contractor: project.contractor_name || agreement.contractor_name || "Your contractor",
        completedAt: project.completed_at || project.updated_at || agreement.completed_at || agreement.updated_at,
        amount: project.total_cost || agreement.total_cost,
        warranty: agreement.warranty_text || "",
        action: project.agreement_url || agreement.action_target || "",
        documents: (documents || []).filter((document) => {
          if (project.agreement_id && String(document.agreement_id || "") === String(project.agreement_id)) return true;
          return document.project_title === project.title;
        }),
      };
    });
}

function timelineRows({ profile, projects, agreements, documents, payments }) {
  const rows = [];
  for (const project of completedProjectRows(projects, agreements, documents)) {
    rows.push({
      id: `project-${project.id}`,
      date: project.completedAt,
      title: project.title,
      type: "Completed Project",
      detail: `${project.contractor}${project.amount ? ` - ${money(project.amount)}` : ""}`,
      url: project.action,
    });
  }
  for (const document of [...(documents || []), ...(profile?.documents || [])]) {
    rows.push({
      id: `document-${document.id}`,
      date: document.date,
      title: document.title || "Property document",
      type: categoryForDocument(document),
      detail: document.project_title || document.filename || "Home record",
      url: document.url,
    });
  }
  for (const photo of profile?.photos || []) {
    rows.push({
      id: `photo-${photo.id}`,
      date: photo.date,
      title: photo.title || "Property photo",
      type: "Photo",
      detail: photo.filename || "Home photo",
      url: photo.url,
    });
  }
  for (const agreement of warrantyRows(agreements, documents)) {
    rows.push({
      id: `warranty-timeline-${agreement.id}`,
      date: agreement.date,
      title: `${agreement.project} warranty`,
      type: "Warranty",
      detail: agreement.contractor,
      url: agreement.documents[0]?.url || "",
    });
  }
  for (const payment of payments || []) {
    const type = String(payment.record_type || payment.record_type_label || "").toLowerCase();
    if (!type.includes("invoice") && !type.includes("receipt")) continue;
    rows.push({
      id: `payment-${payment.id}`,
      date: payment.date,
      title: payment.invoice_number || payment.reference || payment.record_type_label || "Payment record",
      type: String(payment.status || payment.status_label || "").toLowerCase().includes("paid") ? "Receipt" : "Invoice",
      detail: `${payment.project_title || "Project"}${payment.amount_label ? ` - ${payment.amount_label}` : ""}`,
      url: payment.receipt_url || payment.action_target || "",
    });
  }
  return rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 12);
}

function HomeRecordsDashboard({ profile, projects, agreements, documents, payments }) {
  const grouped = documentGroups(profile, documents);
  const warranties = warrantyRows(agreements, documents);
  const completedProjects = completedProjectRows(projects, agreements, documents);
  const timeline = timelineRows({ profile, projects, agreements, documents, payments });
  const importantDocuments = [
    ...grouped.Warranties,
    ...grouped.Agreements,
    ...grouped["Invoices & Receipts"],
    ...grouped.Permits,
  ].slice(0, 5);
  const photoCount = (profile?.photos || []).length;
  const documentCount = Object.values(grouped).reduce((sum, rows) => sum + rows.length, 0);

  return (
    <div className="space-y-5">
      <section
        data-testid="home-records-dashboard"
        className="overflow-hidden rounded-3xl border border-amber-300/35 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(12,74,110,0.5))] p-5 shadow-2xl shadow-slate-950/30 sm:p-6"
      >
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">Home Records</div>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-white">Your home history, organized.</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
          Keep project documents, warranties, photos, and service records in one place. Completed MyHomeBro projects automatically become part of your home record.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Property</div>
            <div className="mt-1 text-sm font-semibold text-white">{profile?.display_name || "Primary Property"}</div>
            <div className="mt-1 text-xs text-slate-400">{profile?.address || "Address not set"}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Documents</div>
            <div className="mt-1 text-sm font-semibold text-white">{documentCount}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Photos</div>
            <div className="mt-1 text-sm font-semibold text-white">{photoCount}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
            <div className="text-xs uppercase tracking-wide text-slate-400">Completed Projects</div>
            <div className="mt-1 text-sm font-semibold text-white">{completedProjects.length}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Section title="Property Timeline" eyebrow="History" testId="home-records-timeline">
          {timeline.length ? (
            <div className="space-y-3">
              {timeline.map((item) => (
                <a
                  key={item.id}
                  href={item.url || "#"}
                  target={item.url ? "_blank" : undefined}
                  rel={item.url ? "noreferrer" : undefined}
                  className="grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/60 p-3 hover:border-amber-300/45 sm:grid-cols-[110px_minmax(0,1fr)]"
                >
                  <div className="text-xs font-semibold text-amber-100">{formatDate(item.date)}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-600 bg-slate-950 px-2 py-0.5 text-[11px] font-semibold text-slate-200">{item.type}</span>
                      <span className="text-sm font-semibold text-white">{item.title}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-400">{item.detail}</div>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState title="No home history yet" testId="home-records-timeline-empty">
              Uploaded records, warranties, receipts, photos, and completed projects will build a timeline here.
            </EmptyState>
          )}
        </Section>

        <Section title="Important Documents" eyebrow="Quick access" testId="home-records-important-documents">
          {importantDocuments.length ? (
            <div className="space-y-2">
              {importantDocuments.map((document) => (
                <a key={`${document.id}-${document.url}`} href={document.url || "#"} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-700 bg-slate-900/60 p-3 hover:border-sky-300/45">
                  <div className="text-sm font-semibold text-white">{document.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{categoryForDocument(document)} - {formatDate(document.date)}</div>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState title="No important documents yet" testId="home-records-important-documents-empty">
              Agreements, warranties, receipts, permits, and insurance files will be grouped here as they are added.
            </EmptyState>
          )}
        </Section>
      </div>

      <Section title="Warranty Center" eyebrow="Coverage" testId="home-records-warranty-center">
        {warranties.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {warranties.map((warranty) => (
              <article key={warranty.id} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="text-sm font-semibold text-white">{warranty.project}</div>
                <div className="mt-1 text-xs text-slate-500">{warranty.contractor} - {formatDate(warranty.date)}</div>
                <div className="mt-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-100 inline-flex">
                  {warranty.warrantyType}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{warranty.text}</p>
                {warranty.documents.length ? (
                  <div className="mt-3 space-y-2">
                    {warranty.documents.map((document) => (
                      <a key={document.id} href={document.url || "#"} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-sky-100 hover:text-sky-50">
                        {document.title}
                      </a>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No warranty details yet" testId="home-records-warranty-empty">
            Warranty details will appear here when contractors add warranty information to completed projects.
          </EmptyState>
        )}
      </Section>

      <Section title="Completed Project History" eyebrow="MyHomeBro records" testId="home-records-completed-projects">
        {completedProjects.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {completedProjects.map((project) => (
              <article key={project.id} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="text-sm font-semibold text-white">{project.title}</div>
                <div className="mt-1 text-xs text-slate-500">{project.contractor} - {formatDate(project.completedAt)}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {money(project.amount) ? <span className="rounded-full border border-slate-600 bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-200">{money(project.amount)}</span> : null}
                  {project.warranty ? <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-2.5 py-1 text-xs font-semibold text-amber-100">Warranty on file</span> : null}
                  {project.documents.length ? <span className="rounded-full border border-sky-300/35 bg-sky-400/10 px-2.5 py-1 text-xs font-semibold text-sky-100">{project.documents.length} documents</span> : null}
                </div>
                {project.warranty ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-300">{project.warranty}</p> : null}
                {project.action ? (
                  <a href={project.action} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-200/45 bg-amber-300/15 px-3 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-300/25">
                    View project record
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No completed projects yet" testId="home-records-completed-empty">
            Completed MyHomeBro projects will appear here with contractor, warranty, payment, and document history.
          </EmptyState>
        )}
      </Section>

      <Section title="Organized Records" eyebrow="Documents and photos" testId="home-records-document-groups">
        <div className="grid gap-3 lg:grid-cols-2">
          {Object.entries(grouped).map(([category, rows]) => (
            <div key={category} className="rounded-2xl border border-slate-700 bg-slate-900/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-white">{category}</h4>
                <span className="rounded-full border border-slate-600 bg-slate-950 px-2.5 py-1 text-xs font-semibold text-slate-200">{rows.length}</span>
              </div>
              <div className="mt-3 space-y-2">
                {rows.length ? rows.slice(0, 4).map((row) => (
                  <a key={`${category}-${row.id}-${row.url}`} href={row.url || "#"} target="_blank" rel="noreferrer" className="block rounded-xl border border-slate-700 bg-slate-950/55 p-3 hover:border-sky-300/40">
                    <div className="text-sm font-semibold text-slate-100">{row.title || "Home record"}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatDate(row.date)} - {row.filename || row.type_label || "File"}</div>
                  </a>
                )) : (
                  <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/45 p-3 text-sm text-slate-400">No records in this category yet.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Maintenance & Service History" eyebrow="Future ready" testId="home-records-maintenance-history">
        <EmptyState title="No service history yet" testId="home-records-maintenance-empty">
          Maintenance visits, service records, and recurring care history will appear here as those workflows are connected.
        </EmptyState>
      </Section>

      <section data-testid="home-records-request-guidance" className="rounded-2xl border border-amber-300/35 bg-amber-300/10 p-5">
        <h3 className="text-lg font-semibold text-white">Use these records when starting a new project</h3>
        <p className="mt-2 text-sm leading-6 text-amber-100">
          Your saved records can help contractors understand past work, warranties, photos, and documents. Full attachment-to-request routing is coming later; for now, keep the record organized here so it is ready when needed.
        </p>
      </section>
    </div>
  );
}

export default function CustomerPropertyProfile({
  profile = {},
  projects = [],
  agreements = [],
  documents = [],
  payments = [],
  onSave,
  onUpload,
  saving = false,
  uploading = false,
  uploadError = "",
}) {
  const [form, setForm] = useState(profile || {});
  const [uploadForm, setUploadForm] = useState({ kind: "document", title: "", documentType: "", file: null });

  useEffect(() => {
    setForm(profile || {});
  }, [profile]);

  const update = (field, value) => setForm((prev) => ({ ...(prev || {}), [field]: value }));

  return (
    <div data-testid="customer-property-profile" className="space-y-5">
      <HomeRecordsDashboard profile={profile} projects={projects} agreements={agreements} documents={documents} payments={payments} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave?.(form);
          }}
          className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5"
        >
          <h2 className="text-xl font-semibold text-white">Property Profile</h2>
          <p className="mt-1 text-sm text-slate-300">
            Keep property details available for future repairs, maintenance, inspections, and project planning.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-200">
            Property name
            <input
              value={form?.display_name || ""}
              onChange={(event) => update("display_name", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Type
            <select
              value={form?.property_type || "single_family"}
              onChange={(event) => update("property_type", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            >
              <option value="single_family">Single Family</option>
              <option value="townhome">Townhome</option>
              <option value="condo">Condo</option>
              <option value="multi_family">Multi-Family</option>
              <option value="commercial">Commercial</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Street
            <input
              value={form?.address_line1 || ""}
              onChange={(event) => update("address_line1", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Unit / suite
            <input
              value={form?.address_line2 || ""}
              onChange={(event) => update("address_line2", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            City
            <input
              value={form?.city || ""}
              onChange={(event) => update("city", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            State
            <input
              value={form?.state || ""}
              onChange={(event) => update("state", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            ZIP
            <input
              value={form?.postal_code || ""}
              onChange={(event) => update("postal_code", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Year built
            <input
              type="number"
              value={form?.year_built || ""}
              onChange={(event) => update("year_built", event.target.value ? Number(event.target.value) : null)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            Square feet
            <input
              type="number"
              value={form?.square_feet || ""}
              onChange={(event) => update("square_feet", event.target.value ? Number(event.target.value) : null)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          <label className="block text-sm font-medium text-slate-200 sm:col-span-2">
            Notes
            <textarea
              rows={4}
              value={form?.notes || ""}
              onChange={(event) => update("notes", event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
            />
          </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="mt-5 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save property profile"}
          </button>
        </form>

        <aside className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5">
        <h3 className="text-lg font-semibold text-white">Property files</h3>
        <form
          data-testid="customer-property-upload-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await onUpload?.(uploadForm);
            if (ok !== false) {
              setUploadForm((prev) => ({ ...prev, title: "", documentType: "", file: null }));
              event.currentTarget.reset();
            }
          }}
          className="mt-4 rounded-xl border border-slate-700 bg-slate-900/70 p-3"
        >
          <div className="grid gap-3">
            <label className="block text-sm font-medium text-slate-200">
              File type
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
                placeholder="Warranty, inspection, roof photo..."
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              />
            </label>
            {uploadForm.kind === "document" ? (
              <label className="block text-sm font-medium text-slate-200">
                Document type
                <input
                  value={uploadForm.documentType}
                  onChange={(event) => setUploadForm((prev) => ({ ...prev, documentType: event.target.value }))}
                  placeholder="Warranty, permit, receipt"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
                />
              </label>
            ) : null}
            <label className="block text-sm font-medium text-slate-200">
              Upload
              <input
                type="file"
                data-testid="customer-property-upload-file"
                onChange={(event) => setUploadForm((prev) => ({ ...prev, file: event.target.files?.[0] || null }))}
                accept={uploadForm.kind === "photo" ? "image/*" : undefined}
                className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-400 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950 hover:file:bg-sky-300"
              />
            </label>
            <button
              type="submit"
              disabled={uploading || !uploadForm.file}
              className="rounded-xl border border-sky-300/40 bg-sky-400/15 px-3 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-400/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload property file"}
            </button>
            {uploadError ? (
              <div data-testid="customer-property-upload-error" className="rounded-lg border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
                {uploadError}
              </div>
            ) : null}
          </div>
        </form>
        <div className="mt-4 space-y-3">
          {(profile?.photos || []).length || (profile?.documents || []).length ? (
            [...(profile?.photos || []), ...(profile?.documents || [])].map((item) => (
              <a
                key={item.id}
                href={item.url || "#"}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-3 text-sm text-slate-200 hover:border-sky-400/50"
              >
                <div className="font-semibold">{item.title}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {item.type_label || "Property file"} - {item.date ? new Date(item.date).toLocaleDateString() : "No date"}
                </div>
                <div className="mt-1 truncate text-xs text-slate-400">{item.filename || "Filename pending"}</div>
              </a>
            ))
          ) : (
            <div data-testid="customer-property-files-empty" className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-300">
              <div className="font-semibold text-white">No property files yet</div>
              <p className="mt-1 leading-6 text-slate-400">
                Add warranties, inspection notes, receipts, permits, and photos so future requests have better context.
              </p>
            </div>
          )}
        </div>
        </aside>
      </div>
    </div>
  );
}
