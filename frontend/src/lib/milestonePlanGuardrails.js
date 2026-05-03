function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "without",
  "within",
  "final",
  "main",
  "major",
  "phase",
  "project",
  "site",
  "stage",
  "step",
  "work",
  "primary",
]);

const SIMPLE_STRUCTURE_TERMS = [
  "shed",
  "storage shed",
  "tool shed",
  "garden shed",
  "backyard shed",
  "outbuilding",
];

function normalizeMilestoneTitleFingerprint(value) {
  const raw = safeStr(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return "";

  const tokens = raw
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !TITLE_STOP_WORDS.has(token));

  if (!tokens.length) return "";

  return [...new Set(tokens)].sort().join(" ");
}

function milestoneTitleText(value) {
  return safeStr(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasCloseoutPhase(row) {
  const text = milestoneTitleText(`${row?.title || ""} ${row?.description || ""}`);
  return /(cleanup|walkthrough|inspection|closeout|handoff)/.test(text);
}

function isSimpleStructureContext(context = {}) {
  const key = safeStr(context?.projectFamilyKey || context?.project_family_key || context?.project_family?.key).toLowerCase();
  const label = safeStr(context?.projectFamilyLabel || context?.project_family_label || context?.project_family?.label).toLowerCase();
  const scope = safeStr(context?.scopeText || context?.description || context?.projectTitle || context?.project_title).toLowerCase();
  const hay = [key, label, scope].join(" ");

  return SIMPLE_STRUCTURE_TERMS.some((term) => hay.includes(term));
}

export function dedupeMilestoneRows(rows = [], { existingRows = [] } = {}) {
  const existingFingerprints = new Set(
    (Array.isArray(existingRows) ? existingRows : [])
      .map((row) => normalizeMilestoneTitleFingerprint(row?.title))
      .filter(Boolean)
  );
  const seenFingerprints = new Map();
  const out = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;

    const fingerprint = normalizeMilestoneTitleFingerprint(row.title);
    if (!fingerprint) continue;

    const current = {
      ...row,
      title: safeStr(row.title),
      description: safeStr(row.description),
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : null,
    };

    if (existingFingerprints.has(fingerprint)) {
      continue;
    }

    const previous = seenFingerprints.get(fingerprint);
    if (!previous) {
      seenFingerprints.set(fingerprint, current);
      out.push(current);
      continue;
    }

    const merged = {
      ...previous,
      ...current,
      description:
        safeStr(current.description).length > safeStr(previous.description).length
          ? current.description
          : previous.description,
      amount: parseAmount(current.amount) || parseAmount(previous.amount),
      order:
        Number.isFinite(Number(previous.order)) && Number(previous.order) > 0
          ? Number(previous.order)
          : Number.isFinite(Number(current.order)) && Number(current.order) > 0
          ? Number(current.order)
          : null,
    };

    const index = out.findIndex((item) => normalizeMilestoneTitleFingerprint(item.title) === fingerprint);
    if (index >= 0) {
      out[index] = merged;
    }
    seenFingerprints.set(fingerprint, merged);
  }

  return out.map((row, idx) => ({
    ...row,
    order: idx + 1,
  }));
}

export function assessMilestonePlanGuardrails(
  rows = [],
  {
    existingRows = [],
    currentTargetTotal = 0,
    projectFamilyKey = "",
    projectFamilyLabel = "",
    projectTitle = "",
    projectScope = "",
  } = {}
) {
  const sourceRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const existing = Array.isArray(existingRows) ? existingRows.filter(Boolean) : [];
  const dedupedRows = dedupeMilestoneRows(sourceRows, { existingRows: existing });
  const rawCount = sourceRows.length;
  const dedupedCount = dedupedRows.length;
  const simpleContext = isSimpleStructureContext({
    projectFamilyKey,
    projectFamilyLabel,
    projectTitle,
    description: projectScope,
    scopeText: projectScope,
  });
  const recommendedMin = 4;
  const recommendedMax = simpleContext ? 6 : 7;
  const duplicatedFps = new Map();
  const duplicateTitles = [];

  sourceRows.forEach((row) => {
    const fingerprint = normalizeMilestoneTitleFingerprint(row?.title);
    if (!fingerprint) return;
    if (duplicatedFps.has(fingerprint)) {
      duplicateTitles.push(safeStr(row?.title));
      return;
    }
    duplicatedFps.set(fingerprint, row?.title || "");
  });

  const hasCloseout = dedupedRows.some((row) => hasCloseoutPhase(row));
  const planTotal = dedupedRows.reduce((sum, row) => sum + parseAmount(row?.amount || row?.suggested_amount), 0);
  const currentTotal = parseAmount(currentTargetTotal);
  const inflatedByTarget =
    currentTotal > 0 && planTotal > currentTotal * 1.3 && planTotal - currentTotal >= Math.max(1500, currentTotal * 0.2);

  const issues = [];

  if (duplicateTitles.length) {
    issues.push({
      code: "duplicate_titles",
      severity: "warn",
      message: "Duplicate or near-duplicate milestone phases were found and will be skipped.",
      details: duplicateTitles.slice(0, 4),
    });
  }

  if (dedupedCount > 8) {
    issues.push({
      code: "too_many_milestones",
      severity: "block",
      message: "AI suggested more than 8 milestones. Trim the plan before applying, or add extra phases manually.",
    });
  } else if (dedupedCount > recommendedMax) {
    issues.push({
      code: "above_recommended_count",
      severity: "warn",
      message: simpleContext
        ? "Simple structures usually work best with 4-6 milestones."
        : "Residential projects usually work best with 4-7 milestones.",
    });
  }

  if (!hasCloseout && dedupedCount > 0) {
    issues.push({
      code: "missing_closeout",
      severity: "warn",
      message: "Add a final inspection or cleanup phase before applying the plan.",
    });
  }

  if (inflatedByTarget) {
    issues.push({
      code: "inflated_total",
      severity: "warn",
      message: `Similar projects may range higher, but your current total remains ${currentTotal.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
      })} unless you apply changes.`,
    });
  }

  return {
    rawCount,
    dedupedCount,
    dedupedRows,
    duplicateTitles,
    issues,
    recommendedMin,
    recommendedMax,
    simpleContext,
    planTotal,
    currentTotal,
    hasCloseout,
    needsConfirmation: issues.some((issue) => issue.severity === "warn"),
    blocked: issues.some((issue) => issue.severity === "block"),
  };
}

export function formatMilestoneGuardrailSummary(analysis = {}) {
  const messages = [];
  if (analysis?.duplicateTitles?.length) {
    messages.push("MyHomeBro will avoid adding duplicate phases.");
  }
  if (analysis?.blocked) {
    messages.push("This draft has more than 8 milestones and needs manual trimming before it can be applied.");
  } else if (analysis?.dedupedCount > analysis?.recommendedMax) {
    messages.push(
      analysis?.simpleContext
        ? "Simple structures usually work best with 4-6 milestones."
        : "Residential projects usually work best with 4-7 milestones."
    );
  }
  if (analysis?.currentTotal > 0 && analysis?.planTotal > analysis?.currentTotal * 1.3) {
    messages.push("Similar projects may range higher, but your current total stays unchanged unless you apply changes.");
  }
  if (!analysis?.hasCloseout) {
    messages.push("Add a final inspection or cleanup phase before applying.");
  }
  return messages;
}
