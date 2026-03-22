// frontend/src/components/step1/CustomerSection.jsx

import React from "react";
import {
  customerDisplayName,
  niceCustomerFieldLabel,
} from "./step1Utils";

export default function CustomerSection({
  locked,
  dLocal,
  homeownerOptions,
  empty,
  peopleLoadedOnce,
  reloadPeople,
  onLocalChange,
  customerAddrLoading,
  customerAddrMissing,
  selectedCustomer,
  showQuickAdd,
  setShowQuickAdd,
  qaName,
  setQaName,
  qaEmail,
  setQaEmail,
  qaBusy,
  onQuickAdd,
}) {
  const customerLabel = customerDisplayName(selectedCustomer);

  return (
    <>
      <div className="md:col-span-2">
        <label className="block text-sm font-medium mb-1">Customer</label>
        <select
          data-testid="agreement-customer-select"
          className="w-full rounded border px-3 py-2 text-sm"
          name="homeowner"
          value={String(dLocal.homeowner || "")}
          onFocus={() => {
            if (!peopleLoadedOnce) reloadPeople?.();
          }}
          onChange={locked ? undefined : onLocalChange}
          disabled={locked}
        >
          <option value="">
            {empty ? "— No customers yet —" : "— Select Customer —"}
          </option>
          {(homeownerOptions || []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {customerAddrLoading ? (
          <div className="mt-2 text-xs text-gray-500">Checking customer address…</div>
        ) : customerAddrMissing?.length ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">{customerLabel} — Address Required</div>
            <div className="mt-1 text-xs text-amber-900/90">
              Customers can be created with minimal info (invite flow), but a complete agreement requires the
              customer home/business address to be filled in before signing/finalizing.
            </div>
            <ul className="mt-2 list-disc ml-5 text-xs text-amber-900/90">
              {customerAddrMissing.map((f) => (
                <li key={f}>{niceCustomerFieldLabel(f)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {empty && (
          <div className="mt-2 text-xs text-gray-600">
            No customers found.{" "}
            <button
              type="button"
              onClick={() => !locked && setShowQuickAdd((v) => !v)}
              className="text-indigo-600 underline disabled:opacity-60"
              disabled={locked}
            >
              Quick add one
            </button>
            .
          </div>
        )}
      </div>

      {showQuickAdd && (
        <div className="md:col-span-2 rounded-md border p-3 bg-indigo-50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium mb-1">Full Name</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={qaName}
                onChange={(e) => setQaName(e.target.value)}
                placeholder="e.g., Jane Smith"
                disabled={locked}
              />
            </div>
            <div className="md:col-span-1">
              <label className="block text-xs font-medium mb-1">Email</label>
              <input
                className="w-full rounded border px-3 py-2 text-sm"
                value={qaEmail}
                onChange={(e) => setQaEmail(e.target.value)}
                placeholder="jane@example.com"
                disabled={locked}
              />
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onQuickAdd}
              disabled={qaBusy || locked}
              className="rounded bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {qaBusy ? "Adding…" : "Add Customer"}
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
    </>
  );
}
