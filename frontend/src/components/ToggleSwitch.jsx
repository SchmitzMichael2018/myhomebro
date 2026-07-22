import React from 'react';

export default function ToggleSwitch({ checked, onChange, label, description = '', disabled = false, className = '' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={`flex min-h-11 w-full items-center justify-between gap-4 rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-black text-slate-900">{label}</span>
        {description ? <span className="mt-1 block text-xs leading-4 text-slate-500">{description}</span> : null}
      </span>
      <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}
