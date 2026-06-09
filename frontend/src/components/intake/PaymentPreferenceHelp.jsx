import React, { useId, useState } from "react";

export const PAYMENT_PREFERENCE_OPTIONS = [
  {
    value: "escrow",
    label: "Escrow milestone payments",
    help:
      "Funds are held until approved milestones are completed. Both parties can track approvals, payments, and project records through MyHomeBro.",
  },
  {
    value: "direct",
    label: "Direct payment to contractor",
    help:
      "Payments are handled directly between the homeowner and contractor. MyHomeBro can still help manage agreements, milestones, and project records.",
  },
  {
    value: "discuss",
    label: "Discuss payment options with contractor",
    help:
      "Choose this option if you want to compare payment approaches before finalizing your agreement. Payment terms can be decided later.",
  },
];

export const PAYMENT_PREFERENCE_SECTION_COPY =
  "Milestone-based escrow holds keep project funding organized and tied to completed work approvals.";

export default function PaymentPreferenceHelp({ label, children }) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={`${label} help`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-bold leading-none text-slate-600 shadow-sm transition hover:border-blue-400 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ⓘ
      </button>
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-40 mt-2 w-72 max-w-[80vw] -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-2xl"
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
