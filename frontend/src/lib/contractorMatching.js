function safeText(value) {
  return String(value ?? "").trim();
}

function normalizeTier(value) {
  const normalized = safeText(value).toLowerCase();
  if (normalized === "strong" || normalized === "strong match") return "strong";
  if (normalized === "good" || normalized === "good match") return "good";
  if (normalized === "limited" || normalized === "limited match") return "limited";
  return "limited";
}

const TIER_META = {
  strong: {
    label: "Strong Match",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  good: {
    label: "Good Match",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  limited: {
    label: "Limited Match",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  },
};

export function contractorMatchTierLabel(value) {
  return TIER_META[normalizeTier(value)]?.label || TIER_META.limited.label;
}

export function contractorMatchTierClass(value) {
  return TIER_META[normalizeTier(value)]?.className || TIER_META.limited.className;
}

export function normalizeContractorMatchTier(value) {
  return normalizeTier(value);
}

