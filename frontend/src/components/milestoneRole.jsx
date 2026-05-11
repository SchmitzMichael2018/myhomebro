import React from "react";

const ROLE_META = {
  homeowner_task: {
    label: "Homeowner Task",
    tone: "amber",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  contractor_task: {
    label: "Contractor Task",
    tone: "blue",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  shared_task: {
    label: "Shared Task",
    tone: "violet",
    className: "border-violet-200 bg-violet-50 text-violet-700",
  },
  inspection_checkpoint: {
    label: "Inspection Checkpoint",
    tone: "slate",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
};

const SAFETY_META = {
  licensed_trade: {
    label: "Licensed Trade Work",
    className: "border-amber-300 bg-amber-50 text-amber-900",
  },
  contractor_required: {
    label: "Contractor Required",
    className: "border-rose-200 bg-rose-50 text-rose-800",
  },
  inspection_recommended: {
    label: "Inspection Recommended",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
};

const INSPECTION_STATUS_META = {
  inspection_requested: {
    label: "Inspection Requested",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  inspection_passed: {
    label: "Inspection Passed",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  inspection_revision_required: {
    label: "Inspection Revision Required",
    className: "border-rose-200 bg-rose-50 text-rose-800",
  },
  not_requested: {
    label: "Inspection Not Requested",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
};

const ROLE_SYNONYMS = {
  homeowner_task: "homeowner_task",
  "homeowner task": "homeowner_task",
  contractor_task: "contractor_task",
  "contractor task": "contractor_task",
  shared_task: "shared_task",
  "shared task": "shared_task",
  inspection_checkpoint: "inspection_checkpoint",
  "inspection checkpoint": "inspection_checkpoint",
  inspection: "inspection_checkpoint",
  review: "inspection_checkpoint",
};

const SAFETY_PATTERNS = [
  {
    key: "licensed_trade",
    terms: [
      "electrical panel",
      "service panel",
      "breaker panel",
      "main panel",
      "service upgrade",
      "gas line",
      "gas pipe",
      "refrigerant",
      "freon",
      "sewer main",
      "sewer lateral",
      "structural",
      "load-bearing",
      "foundation",
      "steep roof",
      "roof pitch",
      "sprinkler",
      "fire suppression",
      "code-critical",
    ],
  },
  {
    key: "inspection_recommended",
    terms: ["inspection", "inspect", "review", "walkthrough", "final check", "final inspection"],
  },
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function includesAny(text, needles) {
  if (!text) return false;
  return needles.some((needle) => text.includes(needle));
}

function deriveSafetyKeys({ projectMode, milestone }) {
  const explicitLabels = Array.isArray(milestone?.milestone_safety_labels)
    ? milestone.milestone_safety_labels.map((label) => String(label || "").trim()).filter(Boolean)
    : [];
  if (explicitLabels.length) {
    return Array.from(
      new Set(
        explicitLabels
          .map((label) => {
            if (label === SAFETY_META.licensed_trade.label) return "licensed_trade";
            if (label === SAFETY_META.contractor_required.label) return "contractor_required";
            if (label === SAFETY_META.inspection_recommended.label) return "inspection_recommended";
            return "";
          })
          .filter(Boolean)
      )
    );
  }
  const mode = normalizeMode(projectMode);
  const text = normalizeText(
    [milestone?.title, milestone?.description, milestone?.normalized_milestone_type, milestone?.type]
      .filter(Boolean)
      .join(" ")
  );
  const keys = [];
  const hasRestricted = SAFETY_PATTERNS[0].terms.some((needle) => text.includes(needle));
  const hasInspection = SAFETY_PATTERNS[1].terms.some((needle) => text.includes(needle));
  const role = normalizeMilestoneRole(milestone?.milestone_role || milestone?.milestoneRole);

  if (mode === "inspection_only" || hasInspection || role === "inspection_checkpoint") {
    keys.push("inspection_recommended");
  }
  if (hasRestricted) {
    keys.push("licensed_trade");
    keys.push("contractor_required");
  } else if (mode === "assisted_diy" && role === "contractor_task") {
    keys.push("contractor_required");
  }
  return Array.from(new Set(keys));
}

export function normalizeMilestoneRole(value) {
  const normalized = normalizeText(value);
  return ROLE_SYNONYMS[normalized] || ROLE_SYNONYMS[normalized.replaceAll(" ", "_")] || "";
}

export function milestoneRoleLabel(value) {
  const normalized = normalizeMilestoneRole(value);
  return ROLE_META[normalized]?.label || "";
}

export function milestoneRoleTone(value) {
  const normalized = normalizeMilestoneRole(value);
  return ROLE_META[normalized]?.tone || "blue";
}

export function milestoneRoleBadgeClass(value) {
  const normalized = normalizeMilestoneRole(value);
  return ROLE_META[normalized]?.className || ROLE_META.contractor_task.className;
}

export function deriveMilestoneRoleLabel({ projectMode, milestone }) {
  const explicit = normalizeMilestoneRole(milestone?.milestone_role || milestone?.milestoneRole);
  if (explicit) return ROLE_META[explicit]?.label || "";

  const mode = normalizeMode(projectMode);
  const text = normalizeText(
    [milestone?.title, milestone?.description, milestone?.normalized_milestone_type, milestone?.type]
      .filter(Boolean)
      .join(" ")
  );

  if (mode === "inspection_only") return ROLE_META.inspection_checkpoint.label;
  if (mode === "consultation") return ROLE_META.shared_task.label;

  if (mode === "assisted_diy") {
    if (includesAny(text, ["inspect", "inspection", "review", "walkthrough", "final check"])) {
      return ROLE_META.inspection_checkpoint.label;
    }
    if (includesAny(text, ["homeowner", "prep", "materials", "shopping", "cleanup", "demo", "demolition"])) {
      return ROLE_META.homeowner_task.label;
    }
    if (includesAny(text, ["shared", "coordination", "planning", "approval", "consult", "review"])) {
      return ROLE_META.shared_task.label;
    }
    if (includesAny(text, ["install", "replace", "rough", "finish", "repair", "service"])) {
      return ROLE_META.contractor_task.label;
    }
    return ROLE_META.shared_task.label;
  }

  if (includesAny(text, ["inspection", "review", "walkthrough"])) {
    return ROLE_META.inspection_checkpoint.label;
  }
  return ROLE_META.contractor_task.label;
}

export function deriveMilestoneSafetyLabels({ projectMode, milestone }) {
  return deriveSafetyKeys({ projectMode, milestone }).map((key) => SAFETY_META[key]?.label).filter(Boolean);
}

export function normalizeInspectionStatus(value) {
  const normalized = normalizeText(value).replace(/\s+/g, "_");
  if (normalized in INSPECTION_STATUS_META) return normalized;
  if (normalized === "inspection_requested" || normalized === "requested") return "inspection_requested";
  if (normalized === "inspection_passed" || normalized === "passed") return "inspection_passed";
  if (normalized === "inspection_revision_required" || normalized === "revision_required" || normalized === "needs_revision") {
    return "inspection_revision_required";
  }
  return "not_requested";
}

export function inspectionStatusLabel(value) {
  return INSPECTION_STATUS_META[normalizeInspectionStatus(value)]?.label || "Inspection Not Requested";
}

export function MilestoneRoleBadge({ role, projectMode = "", milestone, className = "", dataTestId, title }) {
  const roleLabel = milestoneRoleLabel(role) || deriveMilestoneRoleLabel({ projectMode, milestone }) || ROLE_META.contractor_task.label;
  const roleKey = normalizeMilestoneRole(role) || normalizeMilestoneRole(
    roleLabel
      .toLowerCase()
      .replace(/\s+/g, " ")
  ) || "contractor_task";
  const cls = ROLE_META[roleKey]?.className || ROLE_META.contractor_task.className;
  return (
    <span
      data-testid={dataTestId}
      title={title || roleLabel}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls} ${className}`.trim()}
    >
      {roleLabel}
    </span>
  );
}

export function MilestoneSafetyBadges({ projectMode = "", milestone, className = "", dataTestId }) {
  const labels = deriveMilestoneSafetyLabels({ projectMode, milestone });
  if (!labels.length) return null;
  return (
    <div data-testid={dataTestId} className={`flex flex-wrap gap-1.5 ${className}`.trim()}>
      {labels.map((label) => {
        const key = Object.keys(SAFETY_META).find((metaKey) => SAFETY_META[metaKey].label === label) || "inspection_recommended";
        return (
          <span
            key={label}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${SAFETY_META[key]?.className || SAFETY_META.inspection_recommended.className}`}
            title={label}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function InspectionStatusBadge({ status, className = "", dataTestId, title }) {
  const key = normalizeInspectionStatus(status);
  const meta = INSPECTION_STATUS_META[key] || INSPECTION_STATUS_META.not_requested;
  return (
    <span
      data-testid={dataTestId}
      title={title || meta.label}
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.className} ${className}`.trim()}
    >
      {meta.label}
    </span>
  );
}
