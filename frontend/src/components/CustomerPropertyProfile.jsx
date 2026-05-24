import React, { useEffect, useState } from "react";

export default function CustomerPropertyProfile({ profile = {}, onSave, saving = false }) {
  const [form, setForm] = useState(profile || {});

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
                <div className="mt-1 text-xs text-slate-500">{item.date ? new Date(item.date).toLocaleDateString() : "Property record"}</div>
              </a>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
              Property documents and photos can be connected here as the workspace expands.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
