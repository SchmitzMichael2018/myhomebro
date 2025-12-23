// frontend/src/components/Step1Details.jsx
// Extracted from AgreementWizard.jsx (Option A: logic unchanged)

import React from "react";

// PrettyJson helper copied 1:1
function PrettyJson({ data }) {
  if (!data) return null;
  let text = "";
  try {
    text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }
  return (
    <pre className="whitespace-pre-wrap break-words text-xs bg-red-50 border border-red-200 rounded p-2 text-red-800">
      {text}
    </pre>
  );
}

/* ───────── Step 1 ───────── */
export default function Step1Details({
  isEdit,
  agreementId,
  dLocal,
  setDLocal,
  people,
  peopleLoadedOnce,
  reloadPeople,
  showQuickAdd,
  setShowQuickAdd,
  qaName,
  setQaName,
  qaEmail,
  setQaEmail,
  qaBusy,
  setQaBusy,
  onQuickAdd,
  saveStep1,
  last400,
  onLocalChange,
  homeownerOptions,
  projectTypeOptions,
  projectSubtypeOptions,
}) {
  const empty = (people?.length || 0) === 0;

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-sm text-gray-600 mb-2">
        {isEdit ? <>Agreement #{agreementId}</> : <>New Agreement</>}
      </div>

      {/* Error panel */}
      {last400 && (
        <div className="mb-3">
          <div className="text-sm font-semibold text-red-700">
            Server response (400)
          </div>
          <PrettyJson data={last400} />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Homeowner selector */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            Homeowner
          </label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            name="homeowner"
            value={String(dLocal.homeowner || "")}
            onFocus={() => {
              if (!peopleLoadedOnce) reloadPeople?.();
            }}
            onChange={onLocalChange}
          >
            <option value="">
              {empty ? "— No homeowners yet —" : "— Select Homeowner —"}
            </option>
            {(homeownerOptions || []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {empty && (
            <div className="mt-2 text-xs text-gray-600">
              No homeowners found.{" "}
              <button
                type="button"
                onClick={() => setShowQuickAdd((v) => !v)}
                className="text-indigo-600 underline"
              >
                Quick add one
              </button>
              .
            </div>
          )}
        </div>

        {/* Quick Add Homeowner */}
        {showQuickAdd && (
          <div className="md:col-span-2 rounded-md border p-3 bg-indigo-50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium mb-1">
                  Full Name
                </label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={qaName}
                  onChange={(e) => setQaName(e.target.value)}
                  placeholder="e.g., Jane Smith"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-xs font-medium mb-1">
                  Email
                </label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={qaEmail}
                  onChange={(e) => setQaEmail(e.target.value)}
                  placeholder="jane@example.com"
                />
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onQuickAdd}
                disabled={qaBusy}
                className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {qaBusy ? "Adding…" : "Add Homeowner"}
              </button>
              <button
                type="button"
                onClick={() => setShowQuickAdd(false)}
                className="rounded border px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Project title */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            Project Title
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            name="project_title"
            value={dLocal.project_title}
            onChange={onLocalChange}
            placeholder="e.g., Kitchen Floor and Wall"
          />
        </div>

        {/* Type & subtype */}
        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            name="project_type"
            value={dLocal.project_type || ""}
            onChange={(e) => {
              onLocalChange(e);
              setDLocal((s) => ({ ...s, project_subtype: "" }));
            }}
          >
            <option value="">— Select Type —</option>
            {(projectTypeOptions || []).map((t) => (
              <option key={String(t.value)} value={String(t.value)}>
                {String(t.label)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Subtype</label>
          <select
            className="w-full rounded border px-3 py-2 text-sm"
            name="project_subtype"
            value={dLocal.project_subtype || ""}
            onChange={onLocalChange}
          >
            <option value="">— Select Subtype —</option>
            {(projectSubtypeOptions || []).map((st) => (
              <option key={String(st.value)} value={String(st.value)}>
                {String(st.label)}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            Description
          </label>
          <textarea
            className="w-full rounded border px-3 py-2 text-sm"
            rows={3}
            name="description"
            value={dLocal.description}
            onChange={onLocalChange}
            placeholder="Brief project scope…"
          />
        </div>

        {/* Project Address — ALWAYS VISIBLE & MANDATORY */}
        <div className="md:col-span-2 mt-4 border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Project Address (Required)</h3>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            Address Line 1 <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            name="address_line1"
            value={dLocal.address_line1}
            onChange={onLocalChange}
            placeholder="Street address (e.g., 5202 Texana Drive)"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            Address Line 2 (optional)
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            name="address_line2"
            value={dLocal.address_line2}
            onChange={onLocalChange}
            placeholder="Apt, suite, etc. (e.g., Apt 838)"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            City <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            name="address_city"
            value={dLocal.address_city}
            onChange={onLocalChange}
            placeholder="City (e.g., San Antonio)"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            State <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            name="address_state"
            value={dLocal.address_state}
            onChange={onLocalChange}
            placeholder="State (e.g., TX)"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            ZIP / Postal Code <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full rounded border px-3 py-2 text-sm"
            name="address_postal_code"
            value={dLocal.address_postal_code}
            onChange={onLocalChange}
            placeholder="ZIP / Postal code (e.g., 78249)"
          />
        </div>
      </div>

      <div className="mt-6 flex gap-2 justify-end">
        <button
          onClick={() => saveStep1(false)}
          className="rounded bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Save Draft
        </button>
        <button
          onClick={() => saveStep1(true)}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Save &amp; Next
        </button>
      </div>
    </div>
  );
}
