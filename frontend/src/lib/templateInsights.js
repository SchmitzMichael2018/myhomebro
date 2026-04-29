function safeTrim(value) {
  return value == null ? "" : String(value).trim();
}

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(n);
}

function normalizeRangeTuple(range) {
  if (!Array.isArray(range) || range.length < 2) return null;
  const low = Number(range[0]);
  const high = Number(range[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return [Math.max(1, Math.round(Math.min(low, high))), Math.max(1, Math.round(Math.max(low, high)))];
}

function formatCountRange(range) {
  const tuple = normalizeRangeTuple(range);
  if (!tuple) return "";
  const [low, high] = tuple;
  return low === high ? `${low}` : `${low}-${high}`;
}

function formatCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatCurrencyRange(low, high) {
  const lo = Number(low);
  const hi = Number(high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) {
    return "";
  }
  return `${formatCurrency(lo)}-${formatCurrency(hi)}`;
}

function sumMilestonePricingRange(milestones) {
  if (!Array.isArray(milestones) || !milestones.length) return "";
  let lowTotal = 0;
  let highTotal = 0;

  for (const row of milestones) {
    const fixed = Number(row?.suggested_amount_fixed);
    const low = Number(row?.suggested_amount_low);
    const high = Number(row?.suggested_amount_high);

    if (Number.isFinite(fixed) && fixed > 0) {
      lowTotal += fixed;
      highTotal += fixed;
      continue;
    }

    if (Number.isFinite(low) && low > 0 && Number.isFinite(high) && high > 0) {
      lowTotal += Math.min(low, high);
      highTotal += Math.max(low, high);
    }
  }

  return lowTotal > 0 && highTotal > 0 ? formatCurrencyRange(lowTotal, highTotal) : "";
}

function formatDurationRange(low, high) {
  const lo = Number(low);
  const hi = Number(high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi <= 0) {
    return "";
  }
  const safeLow = Math.max(1, Math.round(Math.min(lo, hi)));
  const safeHigh = Math.max(safeLow, Math.round(Math.max(lo, hi)));
  return safeLow === safeHigh ? `${safeLow} day${safeLow === 1 ? "" : "s"}` : `${safeLow}-${safeHigh} days`;
}

function normalizeClarifications(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item) return "";
      if (typeof item === "string") return safeTrim(item);
      if (typeof item === "object") {
        return (
          safeTrim(item.question) ||
          safeTrim(item.label) ||
          safeTrim(item.text) ||
          safeTrim(item.prompt) ||
          safeTrim(item.help) ||
          safeTrim(item.key) ||
          ""
        );
      }
      return "";
    })
    .filter(Boolean);
}

function fallbackTypicalRange(value, spread = 1) {
  const base = toPositiveInt(value, 0);
  if (base <= 0) return [1, Math.max(2, spread + 1)];
  const low = Math.max(1, base - Math.max(1, spread));
  const high = Math.max(low, base + Math.max(1, spread));
  return [low, high];
}

export function deriveTemplateInsights(source = {}) {
  const rawInsights = source?.insights && typeof source.insights === "object" ? source.insights : {};
  const milestones = Array.isArray(source?.milestones) ? source.milestones : [];
  const milestoneValue = toPositiveInt(
    rawInsights?.milestone_count?.value ?? source?.milestone_count ?? milestones.length,
    0
  );
  const milestoneRange =
    normalizeRangeTuple(rawInsights?.milestone_count?.typical_range) ||
    fallbackTypicalRange(milestoneValue || milestones.length, 1);

  const estimatedDays = toPositiveInt(source?.estimated_days, 0);
  const timelineValue =
    safeTrim(rawInsights?.timeline?.value) ||
    safeTrim(source?.timeline) ||
    (estimatedDays > 0 ? `About ${estimatedDays} working days` : "");
  const timelineRange =
    safeTrim(rawInsights?.timeline?.typical_range) ||
    (estimatedDays > 0 ? `${Math.max(1, estimatedDays - 2)}-${estimatedDays + 2} working days` : "");

  const pricingRange =
    safeTrim(rawInsights?.pricing?.range) ||
    safeTrim(source?.pricing?.total_range) ||
    sumMilestonePricingRange(milestones) ||
    "";

  const hasPricing =
    typeof rawInsights?.completeness?.has_pricing === "boolean"
      ? rawInsights.completeness.has_pricing
      : Boolean(pricingRange && pricingRange.toLowerCase() !== "consult contractor for pricing");
  const hasMaterials =
    typeof rawInsights?.completeness?.has_materials === "boolean"
      ? rawInsights.completeness.has_materials
      : Boolean((Array.isArray(source?.materials) && source.materials.length) || safeTrim(source?.project_materials_hint));
  const hasClarifications =
    typeof rawInsights?.completeness?.has_clarifications === "boolean"
      ? rawInsights.completeness.has_clarifications
      : Boolean(
          (Array.isArray(source?.clarification_questions) && source.clarification_questions.length) ||
            (Array.isArray(source?.default_clarifications) && source.default_clarifications.length)
        );

  return {
    milestone_count: {
      value: milestoneValue,
      typical_range: milestoneRange,
    },
    timeline: {
      value: timelineValue,
      typical_range: timelineRange,
    },
    pricing: {
      range: pricingRange,
    },
    completeness: {
      has_pricing: hasPricing,
      has_materials: hasMaterials,
      has_clarifications: hasClarifications,
    },
    materials_count: Array.isArray(source?.materials) ? source.materials.length : 0,
    clarifications_count: normalizeClarifications(
      Array.isArray(source?.clarification_questions) && source.clarification_questions.length
        ? source.clarification_questions
        : source?.default_clarifications
    ).length,
  };
}

export function buildTemplateInsightLines(insights, { context = "project" } = {}) {
  const data = insights && typeof insights === "object" ? insights : deriveTemplateInsights({});
  const count = toPositiveInt(data?.milestone_count?.value, 0);
  const timelineRange = safeTrim(data?.timeline?.typical_range);
  const timelineValue = safeTrim(data?.timeline?.value);
  const pricingRange = safeTrim(data?.pricing?.range);
  const lines = [];

  if (count > 0) {
    const suffix = context === "template" ? "for this template." : "for this project type.";
    lines.push(`${count} milestone${count === 1 ? "" : "s"} is within the expected range ${suffix}`);
  } else {
    lines.push("Milestone guidance is ready to review.");
  }

  if (timelineRange || timelineValue) {
    lines.push(
      `Estimated duration is ${timelineRange ? "within the expected range" : "ready to review"}${timelineValue ? ` (${timelineValue})` : ""}.`
    );
  } else {
    lines.push("Estimated duration is ready to review.");
  }

  if (pricingRange) {
    lines.push("Pricing guidance is included.");
  } else {
    lines.push("Pricing guidance could benefit from review.");
  }

  if (data?.completeness?.has_materials && data?.completeness?.has_clarifications) {
    lines.push("Materials and clarifications are present.");
  } else if (data?.completeness?.has_materials || data?.completeness?.has_clarifications) {
    lines.push("Materials or clarifications are present.");
  } else {
    lines.push("Materials or clarifications could benefit from more detail.");
  }

  return lines.slice(0, 4);
}

export function buildActionableTemplateInsightCards({
  currentMilestoneCount = 0,
  contractorInsights = null,
  estimatePreview = null,
  templateInsights = null,
} = {}) {
  const count = toPositiveInt(currentMilestoneCount, 0);
  const milestoneDelta = Number(contractorInsights?.milestone_count_delta?.value);
  let milestoneRange = "4-6";

  if (Number.isFinite(milestoneDelta) && count > 0) {
    const benchmarkCount = count - milestoneDelta;
    if (benchmarkCount >= 4) {
      const low = Math.max(1, Math.round(benchmarkCount - 1));
      const high = Math.max(low, Math.round(benchmarkCount + 1));
      milestoneRange = `${low}-${high}`;
    }
  } else if (count > 0) {
    milestoneRange = count <= 3 ? "4-6" : `${Math.max(1, count - 1)}-${count + 1}`;
  }

  const pricingRange =
    formatCurrencyRange(
      estimatePreview?.suggested_price_low,
      estimatePreview?.suggested_price_high
    ) ||
    safeTrim(templateInsights?.pricing?.range) ||
    safeTrim(estimatePreview?.suggested_total_price) ||
    "";

  const durationRange =
    formatDurationRange(
      estimatePreview?.suggested_duration_low,
      estimatePreview?.suggested_duration_high
    ) ||
    safeTrim(templateInsights?.timeline?.typical_range) ||
    "";

  return {
    milestones: {
      title: "💡 Insight",
      body: `Most contractors use ${milestoneRange} milestones${count ? ` (you have ${count})` : ""}.`,
      actionLabel: "Generate Suggested Milestones",
      testId: "step2-template-insight-milestones",
    },
    pricing: {
      title: "💡 Insight",
      body: pricingRange
        ? `Pricing is based on similar projects and milestone structure. Typical total range: ${pricingRange}.`
        : "Pricing guidance is ready to review.",
      actionLabel: "Apply Pricing Guidance",
      testId: "step2-template-insight-pricing",
    },
    timeline: {
      title: "💡 Insight",
      body: durationRange ? `Typical duration: ${durationRange}.` : "Typical duration is ready to review.",
      actionLabel: "",
      testId: "step2-template-insight-timeline",
    },
  };
}
