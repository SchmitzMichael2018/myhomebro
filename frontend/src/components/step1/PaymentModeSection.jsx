// frontend/src/components/step1/PaymentModeSection.jsx

import React from "react";

function PaymentChoice({ mode, title, desc, selected, locked, onChange }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !locked && onChange(mode)}
      onKeyDown={(e) => {
        if (locked) return;
        if (e.key === "Enter" || e.key === " ") onChange(mode);
      }}
      className={`rounded-lg border p-3 text-sm select-none ${
        locked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
      } ${
        selected ? "border-slate-900 bg-slate-50" : "border-gray-200 bg-white hover:bg-gray-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          name="payment_mode"
          value={mode}
          checked={selected}
          onChange={() => !locked && onChange(mode)}
          className="sr-only"
          disabled={locked}
        />

        <div
          className={`mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center ${
            selected ? "border-slate-900" : "border-gray-300"
          }`}
          aria-hidden="true"
        >
          {selected ? <div className="h-2 w-2 rounded-full bg-slate-900" /> : null}
        </div>

        <div>
          <div className="font-semibold text-gray-900">{title}</div>
          <div className="mt-1 text-xs text-gray-600">{desc}</div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentModeSection({
  locked,
  paymentMode,
  onChangeMode,
}) {
  return (
    <div className="md:col-span-2">
      <label className="block text-sm font-medium mb-1">Payment Mode</label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <PaymentChoice
          mode="escrow"
          title="Escrow (Protected)"
          desc="Customer funds escrow first. You complete milestones → customer approves → funds release."
          selected={paymentMode === "escrow"}
          locked={locked}
          onChange={onChangeMode}
        />
        <PaymentChoice
          mode="direct"
          title="Direct Pay (Fast)"
          desc="No escrow hold. You generate a pay link per invoice and the customer pays you directly via Stripe."
          selected={paymentMode === "direct"}
          locked={locked}
          onChange={onChangeMode}
        />
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Tip: Use <b>Escrow</b> for higher-trust protection. Use <b>Direct Pay</b> for subcontractor-style billing.
      </div>
    </div>
  );
}