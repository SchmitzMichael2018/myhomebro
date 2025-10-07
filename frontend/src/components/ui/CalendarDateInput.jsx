// src/components/ui/CalendarDateInput.jsx
// v2025-10-06-hard — icon always visible/clickable; opens native date picker.

import React, { useEffect, useRef } from "react";

export default function CalendarDateInput({
  label,
  name,
  value,
  onChange,          // (synthetic) same signature as input onChange
  readOnly = false,
  required = false,
  className = "",
  inputProps = {},
}) {
  const ref = useRef(null);

  const openPicker = () => {
    if (!ref.current) return;
    try {
      if (typeof ref.current.showPicker === "function") {
        ref.current.showPicker();
      } else {
        ref.current.focus();
      }
    } catch {
      ref.current.focus();
    }
  };

  return (
    <div className={className} style={{ position: "relative", overflow: "visible" }}>
      {label && (
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}

      {/* input first, button second to avoid focus quirks */}
      <input
        ref={ref}
        type="date"
        name={name}
        value={value || ""}
        onChange={onChange}
        readOnly={readOnly}
        required={required}
        className={`w-full rounded border px-3 py-2 pr-12 text-sm ${
          readOnly ? "bg-gray-50 text-gray-600" : ""
        }`}
        {...inputProps}
      />

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // don't blur field
        onClick={openPicker}
        aria-label="Open calendar"
        title="Pick a date"
        disabled={readOnly}
        // absolutely position with extreme z-index so it beats any z stacking
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 9999,
          lineHeight: 0,
          background: "transparent",
        }}
        className="text-gray-600 hover:text-gray-800"
      >
        <CalendarIcon />
      </button>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6"/>
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      <path d="M3 9h18" stroke="currentColor" strokeWidth="1.6"/>
      <circle cx="8" cy="13" r="1" fill="currentColor"/>
      <circle cx="12" cy="13" r="1" fill="currentColor"/>
      <circle cx="16" cy="13" r="1" fill="currentColor"/>
      <circle cx="8" cy="17" r="1" fill="currentColor"/>
      <circle cx="12" cy="17" r="1" fill="currentColor"/>
      <circle cx="16" cy="17" r="1" fill="currentColor"/>
    </svg>
  );
}
