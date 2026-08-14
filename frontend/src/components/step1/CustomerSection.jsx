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
  authoritativeCustomer,
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
  const carriedCustomerLabel = customerDisplayName(authoritativeCustomer);

  if (authoritativeCustomer) {
    return (
      <div className="md:col-span-2" data-testid="agreement-carried-customer">
        <div className="text-sm font-medium">Customer</div>
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="font-semibold text-slate-900">{carriedCustomerLabel || "Current customer"}</div>
          {authoritativeCustomer.email ? (
            <div className="mt-1 text-sm text-slate-600">{authoritativeCustomer.email}</div>
          ) : null}
          {authoritativeCustomer.phone_number || authoritativeCustomer.phone ? (
            <div className="mt-1 text-sm text-slate-600">
              {authoritativeCustomer.phone_number || authoritativeCustomer.phone}
            </div>
          ) : null}
          <div className="mt-2 text-xs text-slate-500">
            Carried from the accepted Estimate. Customer identity is preserved for this Agreement.
          </div>
        </div>

        {customerAddrLoading ? (
          <div className="mt-2 text-xs text-gray-500">Checking customer address...</div>
        ) : customerAddrMissing?.length ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">{carriedCustomerLabel} - Address Required</div>
            <div className="mt-1 text-xs text-amber-900/90">
              Complete the customer address before signing or finalizing this Agreement.
            </div>
            <ul className="mt-2 ml-5 list-disc text-xs text-amber-900/90">
              {customerAddrMissing.map((field) => (
                <li key={field}>{niceCustomerFieldLabel(field)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="md:col-span-2">
        <label htmlFor="mhb-customersection-34" className="block text-sm font-medium mb-1">Customer</label>
        <select id="mhb-customersection-34"
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
          <option value="">{empty ? "No customers yet" : "Select Customer"}</option>
          {(homeownerOptions || []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {customerAddrLoading ? (
          <div className="mt-2 text-xs text-gray-500">Checking customer address...</div>
        ) : customerAddrMissing?.length ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">{customerLabel} - Address Required</div>
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
              <label htmlFor="mhb-customersection-91" className="block text-xs font-medium mb-1">Full Name</label>
              <input id="mhb-customersection-91"
                className="w-full rounded border px-3 py-2 text-sm"
                value={qaName}
                onChange={(e) => setQaName(e.target.value)}
                placeholder="e.g., Jane Smith"
                disabled={locked}
              />
            </div>
            <div className="md:col-span-1">
              <label htmlFor="mhb-customersection-101" className="block text-xs font-medium mb-1">Email</label>
              <input id="mhb-customersection-101"
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
              {qaBusy ? "Adding..." : "Add Customer"}
            </button>
            <button
              type="button"
              onClick={() => setShowQuickAdd(false)}
              disabled={locked}
              className="rounded border px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
