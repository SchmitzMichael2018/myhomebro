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
            padding-right: 2.9rem;
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
        className={`w-full border rounded px-3 py-2 h-10 ${className}`}
      />

      <button
        type="button"
        onClick={openPicker}
        aria-label="Open calendar"
        className={`absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-8 h-8 rounded text-gray-600 hover:text-gray-800 z-50 ${debug ? "ring-2 ring-fuchsia-500" : ""}`}
        title="Open calendar"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M7 2v3M17 2v3M3 9h18M5 6h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
