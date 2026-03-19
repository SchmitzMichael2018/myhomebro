// src/components/templates/TemplateMilestoneEditor.jsx
// v2026-03-18-template-milestone-editor-option-b
//
// Purpose:
// - Option B milestone editor for template milestones
// - Supports Milestone / Pricing / Schedule / Materials sections
// - Controlled by parent via value + onChange
// - Safe for contractor-owned templates
// - Can be used inside TemplatesPage or a dedicated template edit screen

import React, { useMemo, useState } from "react";

function safeTrim(v) {
  return v == null ? "" : String(v).trim();
}

function toNumberOrEmpty(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : "";
}

function moneyPreview(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-indigo-600 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function SmallField({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-700">
        {label}
      </label>
      {children}
      {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

function SectionCard({ title, description, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        {description ? (
          <div className="mt-1 text-xs text-slate-500">{description}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

const CONFIDENCE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "low", label: "Preliminary estimate" },
  { value: "medium", label: "Moderate confidence" },
  { value: "high", label: "High confidence" },
];

// You can replace/expand these later from taxonomy or backend if desired.
const DEFAULT_MILESTONE_TYPE_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "demolition", label: "Demolition" },
  { value: "site_prep", label: "Site Prep" },
  { value: "framing", label: "Framing" },
  { value: "foundation", label: "Foundation" },
  { value: "roofing", label: "Roofing" },
  { value: "siding", label: "Siding" },
  { value: "windows_doors", label: "Windows / Doors" },
  { value: "electrical_rough", label: "Electrical Rough" },
  { value: "plumbing_rough", label: "Plumbing Rough" },
  { value: "hvac_rough", label: "HVAC Rough" },
  { value: "insulation", label: "Insulation" },
  { value: "drywall", label: "Drywall" },
  { value: "paint_finish", label: "Paint / Finish" },
  { value: "flooring", label: "Flooring" },
  { value: "tile_install", label: "Tile Install" },
  { value: "cabinetry", label: "Cabinetry" },
  { value: "fixtures", label: "Fixtures" },
  { value: "trim_finish", label: "Trim / Finish" },
  { value: "cleanup", label: "Cleanup" },
  { value: "inspection", label: "Inspection" },
];

export default function TemplateMilestoneEditor({
  value,
  onChange,
  onRemove,
  canRemove = true,
  index = 0,
  disabled = false,
  milestoneTypeOptions = DEFAULT_MILESTONE_TYPE_OPTIONS,
}) {
  const [activeTab, setActiveTab] = useState("milestone");

  const row = useMemo(
    () => ({
      id: value?.id ?? null,
      title: value?.title ?? "",
      description: value?.description ?? "",
      sort_order: value?.sort_order ?? index + 1,

      recommended_days_from_start: toNumberOrEmpty(value?.recommended_days_from_start),
      recommended_duration_days: toNumberOrEmpty(value?.recommended_duration_days),

      suggested_amount_percent: toNumberOrEmpty(value?.suggested_amount_percent),
      suggested_amount_fixed: toNumberOrEmpty(value?.suggested_amount_fixed),

      normalized_milestone_type: value?.normalized_milestone_type ?? "",
      suggested_amount_low: toNumberOrEmpty(value?.suggested_amount_low),
      suggested_amount_high: toNumberOrEmpty(value?.suggested_amount_high),
      pricing_confidence: value?.pricing_confidence ?? "",
      pricing_source_note: value?.pricing_source_note ?? "",

      materials_hint: value?.materials_hint ?? "",
      is_optional: !!value?.is_optional,
    }),
    [value, index]
  );

  function patch(next) {
    onChange?.({
      ...row,
      ...next,
    });
  }

  const pricingSummary = [
    row.suggested_amount_fixed !== "" ? `Suggested ${moneyPreview(row.suggested_amount_fixed)}` : "",
    row.suggested_amount_low !== "" || row.suggested_amount_high !== ""
      ? `Range ${moneyPreview(row.suggested_amount_low) || "—"} – ${moneyPreview(row.suggested_amount_high) || "—"}`
      : "",
    safeTrim(row.pricing_confidence) ? `Confidence: ${row.pricing_confidence}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

  const scheduleSummary = [
    row.recommended_days_from_start !== ""
      ? `Starts around day ${row.recommended_days_from_start}`
      : "",
    row.recommended_duration_days !== ""
      ? `Duration ${row.recommended_duration_days} day${Number(row.recommended_duration_days) === 1 ? "" : "s"}`
      : "",
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">
            Milestone {index + 1}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {safeTrim(row.title) || "Untitled milestone"}
          </div>

          {pricingSummary || scheduleSummary ? (
            <div className="mt-2 space-y-1">
              {pricingSummary ? (
                <div className="text-[11px] text-slate-600">{pricingSummary}</div>
              ) : null}
              {scheduleSummary ? (
                <div className="text-[11px] text-slate-600">{scheduleSummary}</div>
              ) : null}
            </div>
          ) : null}
        </div>

        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <TabButton
          active={activeTab === "milestone"}
          onClick={() => setActiveTab("milestone")}
        >
          Milestone
        </TabButton>
        <TabButton
          active={activeTab === "pricing"}
          onClick={() => setActiveTab("pricing")}
        >
          Pricing
        </TabButton>
        <TabButton
          active={activeTab === "schedule"}
          onClick={() => setActiveTab("schedule")}
        >
          Schedule
        </TabButton>
        <TabButton
          active={activeTab === "materials"}
          onClick={() => setActiveTab("materials")}
        >
          Materials
        </TabButton>
      </div>

      {activeTab === "milestone" ? (
        <SectionCard
          title="Milestone Details"
          description="Define the milestone name, description, ordering, and category."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SmallField label="Title">
              <input
                type="text"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.title}
                onChange={(e) => patch({ title: e.target.value })}
                disabled={disabled}
                placeholder="e.g., Framing and Structural Installation"
              />
            </SmallField>

            <SmallField
              label="Sort Order"
              hint="Controls the sequence when the template is applied."
            >
              <input
                type="number"
                min="1"
                step="1"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.sort_order}
                onChange={(e) => patch({ sort_order: toNumberOrEmpty(e.target.value) })}
                disabled={disabled}
              />
            </SmallField>

            <div className="md:col-span-2">
              <SmallField label="Description">
                <textarea
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  rows={4}
                  value={row.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  disabled={disabled}
                  placeholder="Describe what is included in this milestone..."
                />
              </SmallField>
            </div>

            <SmallField
              label="Milestone Type"
              hint="Used for pricing analytics and estimate intelligence."
            >
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.normalized_milestone_type}
                onChange={(e) => patch({ normalized_milestone_type: e.target.value })}
                disabled={disabled}
              >
                {milestoneTypeOptions.map((opt) => (
                  <option key={opt.value || "blank"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </SmallField>

            <SmallField
              label="Optional Milestone"
              hint="Optional milestones can be included in templates without always being required."
            >
              <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!row.is_optional}
                  onChange={(e) => patch({ is_optional: e.target.checked })}
                  disabled={disabled}
                />
                Mark this milestone as optional
              </label>
            </SmallField>
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "pricing" ? (
        <SectionCard
          title="Pricing"
          description="Set a suggested amount, price range, confidence, and pricing source."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SmallField
              label="Suggested Fixed Amount"
              hint="Primary amount shown when this template milestone is used."
            >
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.suggested_amount_fixed}
                onChange={(e) => patch({ suggested_amount_fixed: toNumberOrEmpty(e.target.value) })}
                disabled={disabled}
                placeholder="e.g., 7000"
              />
            </SmallField>

            <SmallField
              label="Suggested Amount Percent"
              hint="Optional alternative to fixed amount, as % of agreement total."
            >
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.suggested_amount_percent}
                onChange={(e) => patch({ suggested_amount_percent: toNumberOrEmpty(e.target.value) })}
                disabled={disabled}
                placeholder="e.g., 20"
              />
            </SmallField>

            <SmallField
              label="Low Range"
              hint="Low-end estimate range."
            >
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.suggested_amount_low}
                onChange={(e) => patch({ suggested_amount_low: toNumberOrEmpty(e.target.value) })}
                disabled={disabled}
                placeholder="e.g., 5950"
              />
            </SmallField>

            <SmallField
              label="High Range"
              hint="High-end estimate range."
            >
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.suggested_amount_high}
                onChange={(e) => patch({ suggested_amount_high: toNumberOrEmpty(e.target.value) })}
                disabled={disabled}
                placeholder="e.g., 8050"
              />
            </SmallField>

            <SmallField label="Pricing Confidence">
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.pricing_confidence}
                onChange={(e) => patch({ pricing_confidence: e.target.value })}
                disabled={disabled}
              >
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <option key={opt.value || "blank"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </SmallField>

            <div className="md:col-span-2">
              <SmallField
                label="Pricing Source Note"
                hint="Example: Contractor experience, platform history, market baseline."
              >
                <input
                  type="text"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={row.pricing_source_note}
                  onChange={(e) => patch({ pricing_source_note: e.target.value })}
                  disabled={disabled}
                  placeholder="e.g., Platform pricing baseline + contractor adjustments"
                />
              </SmallField>
            </div>

            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">Pricing Preview</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
                {row.suggested_amount_fixed !== "" ? (
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    Suggested: {moneyPreview(row.suggested_amount_fixed)}
                  </span>
                ) : null}
                {row.suggested_amount_low !== "" || row.suggested_amount_high !== "" ? (
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    Range: {moneyPreview(row.suggested_amount_low) || "—"} – {moneyPreview(row.suggested_amount_high) || "—"}
                  </span>
                ) : null}
                {safeTrim(row.pricing_confidence) ? (
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    Confidence: {row.pricing_confidence}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "schedule" ? (
        <SectionCard
          title="Schedule"
          description="Define when the milestone typically starts and how long it usually takes."
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SmallField
              label="Recommended Days From Start"
              hint="Relative day offset from agreement start."
            >
              <input
                type="number"
                min="1"
                step="1"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.recommended_days_from_start}
                onChange={(e) =>
                  patch({ recommended_days_from_start: toNumberOrEmpty(e.target.value) })
                }
                disabled={disabled}
                placeholder="e.g., 1"
              />
            </SmallField>

            <SmallField
              label="Recommended Duration Days"
              hint="How long this milestone typically takes."
            >
              <input
                type="number"
                min="1"
                step="1"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={row.recommended_duration_days}
                onChange={(e) =>
                  patch({ recommended_duration_days: toNumberOrEmpty(e.target.value) })
                }
                disabled={disabled}
                placeholder="e.g., 2"
              />
            </SmallField>

            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-700">Schedule Preview</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
                {row.recommended_days_from_start !== "" ? (
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    Starts around day {row.recommended_days_from_start}
                  </span>
                ) : null}
                {row.recommended_duration_days !== "" ? (
                  <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
                    Duration: {row.recommended_duration_days} day
                    {Number(row.recommended_duration_days) === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {activeTab === "materials" ? (
        <SectionCard
          title="Materials"
          description="Add a materials hint or rough takeoff guidance for this milestone."
        >
          <SmallField
            label="Materials Hint"
            hint="This is shown later in agreement milestone estimate assist."
          >
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              rows={6}
              value={row.materials_hint}
              onChange={(e) => patch({ materials_hint: e.target.value })}
              disabled={disabled}
              placeholder={"Example:\n2x4 framing lumber\njoist hangers\nstructural screws\nmetal framing brackets"}
            />
          </SmallField>
        </SectionCard>
      ) : null}
    </div>
  );
}