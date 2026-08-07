import React, { useEffect, useState } from "react";
import { UNIT_CATALOG, recognizeUnit } from "../lib/units.js";

export default function UnitSelect({ label = "Unit", value = "", onChange, error = "", testId = "unit-select", className = "", tone = "dark" }) {
  const recognized = recognizeUnit(value);
  const customValue = value === "__other__" ? "" : value;
  const [customMode, setCustomMode] = useState(Boolean(value && !recognized));
  useEffect(() => {
    if (value && !recognized) setCustomMode(true);
  }, [recognized, value]);
  const selection = customMode ? "other" : recognized || "";
  return (
    <div className={className}>
      <label className={`block text-xs font-black uppercase tracking-wide ${tone === "light" ? "text-slate-700" : "text-sky-100/60"}`} htmlFor={`${testId}-select`}>{label}</label>
      <select id={`${testId}-select`} data-testid={testId} value={selection} onChange={(event) => { const next = event.target.value; setCustomMode(next === "other"); onChange(next === "other" ? "__other__" : next); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${testId}-error` : undefined} className={`mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 ${tone === "light" ? "border border-slate-300 bg-white text-slate-950 focus:border-blue-500 focus:ring-blue-200" : "border border-white/12 bg-slate-950/55 text-white focus:border-sky-300 focus:ring-sky-300/25"}`}>
        <option value="">Select a unit</option>
        {UNIT_CATALOG.map(([code, name, abbreviation]) => <option key={code} value={code}>{name} — {abbreviation}</option>)}
        <option value="other">Other</option>
      </select>
      {selection === "other" ? <label className={`mt-2 block text-xs font-black ${tone === "light" ? "text-slate-700" : "text-sky-100/75"}`}>Custom unit<input data-testid={`${testId}-custom`} maxLength={30} value={customValue} onChange={(event) => onChange(event.target.value)} className={`mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 ${tone === "light" ? "border border-slate-300 bg-white text-slate-950 focus:border-blue-500 focus:ring-blue-200" : "border border-white/12 bg-slate-950/55 text-white focus:border-sky-300 focus:ring-sky-300/25"}`} /><span className={`mt-1 block font-semibold normal-case ${tone === "light" ? "text-slate-500" : "text-sky-100/55"}`}>Enter the unit you use for this quantity.</span></label> : null}
      {error ? <span id={`${testId}-error`} role="alert" className="mt-1 block text-xs font-bold text-rose-200">{error}</span> : null}
    </div>
  );
}
