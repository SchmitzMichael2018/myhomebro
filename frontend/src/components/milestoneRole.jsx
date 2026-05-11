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
