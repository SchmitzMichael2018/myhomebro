// src/components/DateField.jsx
import React, { useRef } from "react";

/**
 * Reliable date input with visible calendar button.
 * Props: id, name, value, onChange, min, max, required, disabled, className, debug
 */
export default function DateField({
  id,
  name,
  value = "",
  onChange,
  min,
  max,
  required = false,
  disabled = false,
  className = "",
  pickerLabel = "Open calendar",
  clearLabel = "",
  onClear = null,
  testId = "",
  describedBy = "",
  invalid = false,
  buttonClassName = "",
  debug = false,   // set true to show a fuchsia outline for debugging
}) {
  const inputRef = useRef(null);

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") el.showPicker();
    else el.focus();
  };

  return (
    <div className="relative" data-datefield>
      <style>
        {`
          [data-datefield] input[type="date"]::-webkit-calendar-picker-indicator {
            opacity: 0 !important;
            pointer-events: none !important;
            width: 1.8rem; height: 1.8rem;
          }
          [data-datefield] input[type="date"] {
            padding-right: ${onClear && value ? "5.2rem" : "2.9rem"};
          }
        `}
      </style>

      <input
        ref={inputRef}
        id={id}
        name={name}
        type="date"
        value={value || ""}
        onChange={onChange}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        aria-describedby={describedBy || undefined}
        aria-invalid={invalid || undefined}
        data-testid={testId || undefined}
        className={`w-full border rounded px-3 py-2 h-10 ${className}`}
      />

      {onClear && value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel || `Clear ${name || "date"}`}
          disabled={disabled}
          className={`absolute right-11 top-1/2 z-10 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-current opacity-75 hover:bg-white/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:cursor-not-allowed disabled:opacity-35 ${buttonClassName}`}
          title={clearLabel || "Clear date"}
        >
          <span aria-hidden="true" className="text-lg leading-none">×</span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={openPicker}
        aria-label={pickerLabel}
        disabled={disabled}
        className={`absolute right-1 top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-gray-600 hover:bg-black/5 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:cursor-not-allowed disabled:opacity-35 ${buttonClassName} ${debug ? "ring-2 ring-fuchsia-500" : ""}`}
        title={pickerLabel}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 2v3M17 2v3M3 9h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
