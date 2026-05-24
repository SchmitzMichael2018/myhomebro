import React, { useEffect, useState } from "react";

export default function CustomerPropertyProfile({ profile = {}, onSave, onUpload, saving = false, uploading = false, uploadError = "" }) {
  const [form, setForm] = useState(profile || {});
  const [uploadForm, setUploadForm] = useState({ kind: "document", title: "", documentType: "", file: null });

  useEffect(() => {
    setForm(profile || {});
  }, [profile]);

  const update = (field, value) => setForm((prev) => ({ ...(prev || {}), [field]: value }));

  return (
    <div data-testid="customer-property-profile" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
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
  );
}
