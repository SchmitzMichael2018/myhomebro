import React from "react";
import { deriveMilestoneRoleLabel } from "./milestoneRole.jsx";

const MODE_META = {
  full_service: {
    label: "Full Service",
    tone: "blue",
    className: "border-blue-200 bg-blue-50 text-blue-700",
    chipClassName: "border-blue-200 bg-blue-50 text-blue-700",
    description: "Contractor-led project delivery from start to finish.",
  },
  assisted_diy: {
    label: "Assisted DIY",
    tone: "amber",
    className: "border-amber-200 bg-amber-50 text-amber-800",
    chipClassName: "border-amber-200 bg-amber-50 text-amber-800",
    description: "Homeowner participates with contractor guidance and support.",
  },
  consultation: {
    label: "Consultation",
    tone: "violet",
    className: "border-violet-200 bg-violet-50 text-violet-700",
    chipClassName: "border-violet-200 bg-violet-50 text-violet-700",
    description: "Advice, planning, and guidance without full project execution.",
  },
  inspection_only: {
    label: "Inspection Only",
    tone: "slate",
    className: "border-slate-200 bg-slate-100 text-slate-700",
    chipClassName: "border-slate-200 bg-slate-100 text-slate-700",
    description: "Inspection and reporting without full-service execution.",
  },
};

const MODE_SYNONYMS = {
  "full service": "full_service",
  full_service: "full_service",
  fullservice: "full_service",
  assisted_diy: "assisted_diy",
  "assisted diy": "assisted_diy",
  diy_assistance: "assisted_diy",
  "diy assistance": "assisted_diy",
  "guided diy": "assisted_diy",
  consultation: "consultation",
  consult: "consultation",
  "inspection only": "inspection_only",
  inspection_only: "inspection_only",
  inspection: "inspection_only",
};

export const PROJECT_MODE_OPTIONS = [
  {
    value: "full_service",
    label: MODE_META.full_service.label,
    help: MODE_META.full_service.description,
  },
  {
    value: "assisted_diy",
    label: MODE_META.assisted_diy.label,
    help: MODE_META.assisted_diy.description,
  },
  {
    value: "consultation",
    label: MODE_META.consultation.label,
    help: MODE_META.consultation.description,
  },
  {
    value: "inspection_only",
    label: MODE_META.inspection_only.label,
    help: MODE_META.inspection_only.description,
  },
];

export function normalizeProjectMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return MODE_SYNONYMS[normalized] || MODE_SYNONYMS[normalized.replaceAll(" ", "_")] || "full_service";
}

export function normalizeProjectModeFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "all") return "all";
  return normalizeProjectMode(normalized);
}

export function projectModeLabel(value) {
  return MODE_META[normalizeProjectMode(value)]?.label || MODE_META.full_service.label;
}

export function projectModeDescription(value) {
  return MODE_META[normalizeProjectMode(value)]?.description || "";
}

export function projectModeTone(value) {
  return MODE_META[normalizeProjectMode(value)]?.tone || "blue";
}

export function projectModeBadgeClass(value) {
  return MODE_META[normalizeProjectMode(value)]?.className || MODE_META.full_service.className;
}

export function ProjectModeBadge({
  mode,
  className = "",
  dataTestId,
  title,
}) {
  const label = projectModeLabel(mode);
  const cls = projectModeBadgeClass(mode);
  return (
    <span
      data-testid={dataTestId}
      title={title || projectModeDescription(mode)}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls} ${className}`.trim()}
    >
      {label}
    </span>
  );
}

export function deriveMilestoneModeLabel({ projectMode, milestone }) {
  return deriveMilestoneRoleLabel({ projectMode, milestone });
}
