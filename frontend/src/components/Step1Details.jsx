// frontend/src/components/Step1Details.jsx
// v2026-03-17-step1-template-apply-sync
// Updates:
// - consumes returned agreement payload after template apply
// - syncs Step 1 local state from applied template response
// - wires TemplateSearchSection onTemplateApplied callback
// - keeps existing Step 1 flow intact
// - preserves deselect / template duration / AI milestone behavior

import React, { useEffect, useMemo, useRef, useState } from "react";
import api from "../api";
import { useNavigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";

import SaveTemplateModal from "./step1/SaveTemplateModal.jsx";
import TemplateSearchSection from "./step1/TemplateSearchSection.jsx";
import CustomerSection from "./step1/CustomerSection.jsx";
import AddressSection from "./step1/AddressSection.jsx";
import useStep1Templates from "./step1/useStep1Templates.jsx";
import useAgreementMilestoneAI from "./ai/useAgreementMilestoneAI.jsx";
import {
  buildClarificationNotes,
  getProjectClarificationQuestions,
  pickClarificationAnswers,
} from "../lib/subtypeClarifications.js";
import { buildLeadProposalDraft, leadSummaryFromRow } from "../lib/leadProposalDraft";
import {
  buildProjectSetupRecommendation,
  normalizeProjectSetupRecommendation,
} from "../lib/projectIntelligence";
import { normalizeProjectFamilyContext } from "../lib/projectFamilyContext";
import { buildStripeOnboardingGuidance } from "../lib/stripeOnboardingStatus.js";

import {
  safeTrim,
  computeCustomerAddressMissing,
  normalizePaymentMode,
  normalizePaymentStructure,
  extractAiCredits,
  isAgreementLocked,
} from "./step1/step1Utils";
import { normalizeProjectClass } from "../utils/projectClass.js";

function PrettyJson({ data }) {
  if (!data) return null;
  let text = "";
  try {
    text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  } catch {
    text = String(data);
  }
  return (
    <pre className="whitespace-pre-wrap break-words rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
      {text}
    </pre>
  );
}

function formatRecurrenceSummary(pattern, interval) {
  const safePattern = safeTrim(pattern) || "monthly";
  const safeInterval = Math.max(1, Number(interval || 1) || 1);
  const labelMap = {
    weekly: safeInterval === 1 ? "week" : "weeks",
    monthly: safeInterval === 1 ? "month" : "months",
    quarterly: safeInterval === 1 ? "quarter" : "quarters",
    yearly: safeInterval === 1 ? "year" : "years",
  };
  return `Recurring every ${safeInterval} ${labelMap[safePattern] || safePattern}`;
}

function buildDescriptionRequestContext(baseDescription = "", clarificationLines = []) {
  const trimmedBase = safeTrim(baseDescription);
  const lines = (Array.isArray(clarificationLines) ? clarificationLines : []).filter(Boolean);
  if (!lines.length) return trimmedBase;
  const clarificationBlock = `Clarifications:\n- ${lines.join("\n- ")}`;
  return trimmedBase ? `${trimmedBase}\n\n${clarificationBlock}` : clarificationBlock;
}

const MATCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "the",
  "with",
  "from",
  "into",
  "this",
  "that",
  "job",
  "project",
  "work",
  "service",
  "repair",
  "replace",
  "replacement",
  "install",
  "installation",
]);

function normalizeAiText(value) {
  return safeTrim(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeAiText(value) {
  return normalizeAiText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !MATCH_STOP_WORDS.has(token));
}

function titleCaseWords(value) {
  return safeTrim(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function buildGeneratedProjectTitle(text = "") {
  const raw = safeTrim(text);
  if (!raw) return "";
  const firstClause = raw.split(/[,.]/)[0] || raw;
  const trimmedClause = firstClause
    .replace(/\b(with|including|plus|for)\b.*$/i, "")
    .trim();
  const candidate = safeTrim(trimmedClause || firstClause);
  if (!candidate) return "";
  const words = candidate.split(/\s+/).slice(0, 5).join(" ");
  return titleCaseWords(words);
}

const TITLE_BOILERPLATE_PATTERNS = [
  /^\s*scope of work includes\b[:\s-]*/i,
  /^\s*this project includes\b[:\s-]*/i,
  /^\s*removal of\b[:\s-]*/i,
  /^\s*installation of\b[:\s-]*/i,
];

const TITLE_QUALIFIER_RULES = [
  { pattern: /\bvanity\b/i, label: "Vanity" },
  { pattern: /\btub\b/i, label: "Tub" },
  { pattern: /\bshower\b/i, label: "Shower" },
  { pattern: /\btile\b/i, label: "Tile" },
  { pattern: /\bcabinet(s)?\b/i, label: "Cabinet" },
  { pattern: /\bcountertop(s)?\b/i, label: "Countertop" },
  { pattern: /\bfloor(ing)?\b/i, label: "Flooring" },
];

function stripTitleBoilerplate(value = "") {
  let text = safeTrim(value);
  for (const pattern of TITLE_BOILERPLATE_PATTERNS) {
    text = text.replace(pattern, "");
  }
  return safeTrim(text);
}

function truncateProjectTitle(value = "", maxLength = 60) {
  const text = safeTrim(value);
  if (!text || text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength - 1);
  return `${shortened.replace(/\s+\S*$/, "").trim()}…`;
}

function extractTitleQualifier(text = "", subtype = "") {
  const haystack = `${safeTrim(text)} ${safeTrim(subtype)}`.trim();
  if (!haystack) return "";

  const matches = TITLE_QUALIFIER_RULES.filter((rule) => rule.pattern.test(haystack)).map(
    (rule) => rule.label
  );
  const uniqueMatches = Array.from(new Set(matches)).filter(
    (label) => !normalizeTaxonomyText(subtype).includes(normalizeTaxonomyText(label))
  );
  if (!uniqueMatches.length) return "";
  return uniqueMatches.slice(0, 3).join(", ").replace(/, ([^,]+)$/, " & $1");
}

function buildProjectFriendlyTitle({
  subtype = "",
  category = "",
  rawTitle = "",
  sourceText = "",
}) {
  const cleanSubtype = stripTitleBoilerplate(subtype);
  const cleanCategory = stripTitleBoilerplate(category);
  const qualifier = extractTitleQualifier(sourceText, cleanSubtype);

  if (cleanSubtype) {
    const isStrongSubtype =
      /\b(remodel|addition|replacement|install|installation)\b/i.test(cleanSubtype) ||
      cleanSubtype.split(/\s+/).length >= 2;
    if (isStrongSubtype) {
      return truncateProjectTitle(cleanSubtype);
    }
    if (qualifier) {
      return truncateProjectTitle(`${cleanSubtype} - ${qualifier}`);
    }
    return truncateProjectTitle(cleanSubtype);
  }

  if (cleanCategory) {
    return truncateProjectTitle(cleanCategory);
  }

  const cleanRawTitle = stripTitleBoilerplate(rawTitle);
  if (cleanRawTitle && cleanRawTitle.split(/\s+/).length <= 6) {
    return truncateProjectTitle(titleCaseWords(cleanRawTitle));
  }

  return "Custom Project";
}

function scoreOptionAgainstText(option, sourceText) {
  const optionLabel = safeTrim(option?.label || option?.value);
  if (!optionLabel) return 0;

  const haystack = normalizeAiText(sourceText);
  if (!haystack) return 0;

  const labelNorm = normalizeAiText(optionLabel);
  const tokens = tokenizeAiText(optionLabel);

  let score = 0;
  if (labelNorm && haystack.includes(labelNorm)) score += 80;
  score += tokens.filter((token) => haystack.includes(token)).length * 14;
  return score;
}

function findBestMatchingOption(sourceText, options = [], minimumScore = 24) {
  const ranked = (Array.isArray(options) ? options : [])
    .map((option) => ({ option, score: scoreOptionAgainstText(option, sourceText) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < minimumScore) return null;
  return ranked[0].option;
}

function optionDisplayLabel(option) {
  return safeTrim(option?.label || option?.value || option?.name || "");
}

function optionCanonicalValue(option) {
  return safeTrim(option?.value || option?.label || option?.name || "");
}

function normalizeTaxonomyText(value) {
  return safeTrim(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s/&-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePricingStrategy(value) {
  const normalized = safeTrim(value).toLowerCase();
  if (normalized === "estimate" || normalized === "requires_sub_quote" || normalized === "fixed") {
    return normalized;
  }
  return "fixed";
}

function extractNumericIdCandidate(value) {
  const raw = safeTrim(value);
  if (!raw) return "";
  const directNumeric = raw.match(/^\d+$/);
  if (directNumeric) return directNumeric[0];
  const placeholderNumeric = raw.match(/\b(?:type|subtype)\s+(\d+)\b/i);
  if (placeholderNumeric) return placeholderNumeric[1];
  return "";
}

function resolveOptionFromRawValue(rawValue, options = []) {
  const raw = safeTrim(rawValue);
  if (!raw) return null;

  const normalizedRaw = normalizeTaxonomyText(raw);
  const rawId = extractNumericIdCandidate(raw);

  return (
    (Array.isArray(options) ? options : []).find((option) => {
      const optionId = safeTrim(option?.id);
      const optionValue = optionCanonicalValue(option);
      const optionLabel = optionDisplayLabel(option);
      return (
        (rawId && optionId && rawId === optionId) ||
        normalizeTaxonomyText(optionValue) === normalizedRaw ||
        normalizeTaxonomyText(optionLabel) === normalizedRaw
      );
    }) || null
  );
}

function LeadContextField({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-slate-900">{value || "â€”"}</div>
    </div>
  );
}

function resolveBestTypeOption({
  rawType,
  rawSubtype,
  sourceText,
  projectTypeOptions = [],
}) {
  const directMatch =
    resolveOptionFromRawValue(rawType, projectTypeOptions) ||
    findBestMatchingOption([rawType, rawSubtype, sourceText].filter(Boolean).join(" "), projectTypeOptions, 18);
  return directMatch;
}

function resolveBestSubtypeOption({
  rawSubtype,
  rawType,
  sourceText,
  matchedType,
  projectSubtypeOptions = [],
}) {
  const filteredSubtypeOptions = (Array.isArray(projectSubtypeOptions) ? projectSubtypeOptions : []).filter(
    (option) =>
      !matchedType ||
      normalizeTaxonomyText(option?.project_type) ===
        normalizeTaxonomyText(optionCanonicalValue(matchedType))
  );

  return (
    resolveOptionFromRawValue(rawSubtype, filteredSubtypeOptions) ||
    findBestMatchingOption(
      [rawSubtype, rawType, sourceText].filter(Boolean).join(" "),
      filteredSubtypeOptions,
      22
    )
  );
}

const PRIMARY_CATEGORY_RULES = [
  {
    category: "Outdoor",
    subtype: "Shed Build",
    reasons: ["shed build intent"],
    patterns: [
      /\bshed\b/i,
      /\boutbuilding\b/i,
      /\bstorage shed\b/i,
      /\btool shed\b/i,
      /\bgarden shed\b/i,
      /\bbackyard shed\b/i,
    ],
  },
  {
    category: "Remodel",
    subtype: "Bathroom Remodel",
    reasons: ["bathroom remodel intent"],
    patterns: [
      /\bbath(room)?\s+(remodel|renovation|refresh|upgrade)\b/i,
      /\b(remodel|renovation)\s+(the\s+)?bath(room)?\b/i,
      /\btub(?:\/| and )?shower\s+(replacement|remodel|upgrade)\b/i,
      /\bvanity\b.*\btile\b/i,
      /\bbath(room)?\b.*\b(tile|vanity|fixtures?)\b/i,
    ],
  },
  {
    category: "Remodel",
    subtype: "Kitchen Remodel",
    reasons: ["kitchen remodel intent"],
    patterns: [
      /\bkitchen\s+(remodel|renovation|refresh|upgrade)\b/i,
      /\b(remodel|renovation)\s+(the\s+)?kitchen\b/i,
      /\bkitchen\b.*\b(layout|demo|demolition|tile|plumbing|electrical|backsplash|island)\b/i,
    ],
  },
  {
    category: "Addition",
    subtype: "",
    reasons: ["addition intent"],
    patterns: [
      /\b(room|home|bedroom|garage|second story|story)\s+addition\b/i,
      /\b(addition|expand|extension)\b/i,
    ],
  },
  {
    category: "Flooring",
    subtype: "",
    reasons: ["flooring intent"],
    patterns: [
      /\bfloor(ing)?\s+(install|installation|replacement|refinish|repair)\b/i,
      /\b(hardwood|laminate|vinyl|tile)\s+floor(ing)?\b/i,
    ],
  },
  {
    category: "Roofing",
    subtype: "Roof Replacement",
    reasons: ["roofing intent"],
    patterns: [
      /\broof\s+(replacement|replace|tear[- ]off|reroof|re-roof)\b/i,
      /\bshingles?\b.*\b(replace|replacement|install)\b/i,
    ],
  },
];

const LIMITED_SCOPE_SUBTYPE_RULES = [
  {
    subtype: "Shed Build",
    patterns: [
      /\bshed\b/i,
      /\boutbuilding\b/i,
      /\bstorage shed\b/i,
      /\btool shed\b/i,
      /\bgarden shed\b/i,
      /\bbackyard shed\b/i,
    ],
  },
  {
    subtype: "Cabinet Installation",
    patterns: [
      /\bcabinet(s)?\s+(install|installation|replace|replacement)\b/i,
      /\binstall\s+(new\s+)?(?:[a-z]+\s+)?cabinet(s)?\b/i,
    ],
  },
  {
    subtype: "Countertop Installation",
    patterns: [
      /\bcountertop(s)?\s+(install|installation|replace|replacement)\b/i,
      /\binstall\s+(new\s+)?(?:[a-z]+\s+)?countertop(s)?\b/i,
    ],
  },
  {
    subtype: "Appliance Installation",
    patterns: [
      /\bappliance(s)?\s+(install|installation|replace|replacement)\b/i,
      /\binstall\s+(new\s+)?(?:[a-z]+\s+)?(dishwasher|range|oven|cooktop|refrigerator|hood)\b/i,
    ],
  },
  {
    subtype: "Fixture Replacement",
    patterns: [
      /\bfixture(s)?\s+(install|installation|replace|replacement)\b/i,
      /\breplace\s+(old\s+)?fixture(s)?\b/i,
    ],
  },
];

function inferSpecificLimitedScopeSubtype(text = "", projectSubtypeOptions = []) {
  const cleaned = stripNegativeScopeClaims(text);
  const matchedRule = LIMITED_SCOPE_SUBTYPE_RULES.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(cleaned))
  );
  if (!matchedRule) return null;
  return resolveOptionFromRawValue(matchedRule.subtype, projectSubtypeOptions);
}

const SUPPORTING_TRADE_PATTERNS = [
  /\belectrical\b/i,
  /\bplumb(ing|er)?\b/i,
  /\blighting\b/i,
  /\bfixtures?\b/i,
  /\boutlets?\b/i,
  /\bwaterproof(ing)?\b/i,
  /\bwiring\b/i,
  /\bsconces?\b/i,
];

const FULL_REMODEL_SIGNAL_PATTERNS = [
  /\bdemo(lition)?\b/i,
  /\btear[- ]?out\b/i,
  /\blayout\s+change(s)?\b/i,
  /\brelocat(e|ing|ion)\b/i,
  /\bplumb(ing|er)?\b/i,
  /\belectrical\b/i,
  /\btile\b/i,
  /\bfixtures?\b/i,
  /\bvanity\b/i,
  /\bcountertop(s)?\b/i,
  /\bcabinet(s)?\b/i,
  /\bbacksplash\b/i,
];

function countMajorRemodelSignals(text) {
  return FULL_REMODEL_SIGNAL_PATTERNS.filter((pattern) => pattern.test(text)).length;
}

function stripNegativeScopeClaims(text = "") {
  return safeTrim(text).replace(/\bno\b[^.,;]*/gi, " ");
}

function inferDominantProjectCategory(sourceText) {
  const text = safeTrim(sourceText);
  if (!text) {
    return {
      category: "",
      subtype: "",
      reasoning: [],
    };
  }
  const positiveText = stripNegativeScopeClaims(text);

  const reasoning = [];
  let bestRule = null;
  let bestScore = 0;
  const majorRemodelSignals = countMajorRemodelSignals(positiveText);
  const explicitRemodelIntent = /\b(remodel|renovation|gut|full update|full refresh)\b/i.test(
    positiveText
  );
  const limitedScopeRule = LIMITED_SCOPE_SUBTYPE_RULES.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(positiveText))
  );

  if (limitedScopeRule && !explicitRemodelIntent && majorRemodelSignals < 3) {
    reasoning.push(
      `limited-scope override: ${limitedScopeRule.subtype} (major signals: ${majorRemodelSignals})`
    );
    return {
      category: "",
      subtype: limitedScopeRule.subtype,
      reasoning,
    };
  }

  for (const rule of PRIMARY_CATEGORY_RULES) {
    const matchCount = rule.patterns.filter((pattern) => pattern.test(positiveText)).length;
    if (!matchCount) continue;
    const tradePenalty =
      rule.category === "Remodel"
        ? 0
        : SUPPORTING_TRADE_PATTERNS.filter((pattern) => pattern.test(text)).length;
    const remodelBoost =
      rule.subtype === "Kitchen Remodel" || rule.subtype === "Bathroom Remodel"
        ? explicitRemodelIntent
          ? 8
          : majorRemodelSignals >= 3
          ? 6
          : -6
        : 0;
    const score = matchCount * 10 - tradePenalty + remodelBoost;
    reasoning.push(
      `${rule.category}${rule.subtype ? ` / ${rule.subtype}` : ""}: ${score}`
    );
    if (score > bestScore) {
      bestScore = score;
      bestRule = rule;
    }
  }

  const supportTradeHits = SUPPORTING_TRADE_PATTERNS.filter((pattern) =>
    pattern.test(positiveText)
  ).length;
  if (!bestRule && supportTradeHits) {
    reasoning.push(`supporting-trade mentions detected: ${supportTradeHits}`);
  }

  return {
    category: bestRule?.category || "",
    subtype: bestRule?.subtype || "",
    reasoning,
  };
}

function StepSection({
  title,
  description = "",
  children,
  className = "",
  highlighted = false,
  highlightLabel = "AI updated",
  emphasis = false,
  sectionRef = null,
  testId = "",
}) {
  return (
    <section
      ref={sectionRef}
      data-testid={testId || undefined}
      data-highlighted={highlighted ? "true" : "false"}
      data-emphasis={emphasis ? "true" : "false"}
      className={`rounded-2xl border bg-white p-5 shadow-sm transition-all duration-500 ${
        emphasis ? "border-sky-300 bg-sky-50/70 ring-2 ring-sky-100" : ""
      } ${
        highlighted
          ? "border-amber-200 bg-amber-50/40 ring-2 ring-amber-100"
          : "border-slate-200"
      } ${className}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        </div>
        {highlighted ? (
          <span className="inline-flex shrink-0 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800">
            {highlightLabel}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function inferStartMode({
  agreement,
  assistantGuidedFlow,
  assistantTemplateRecommendations,
  assistantTopTemplatePreview,
  isNewAgreement,
  hasMeaningfulSavedProjectDetails,
}) {
  if (agreement?.selected_template?.id || agreement?.selected_template_id) {
    return "template";
  }
  if (isNewAgreement && !hasMeaningfulSavedProjectDetails) {
    return "manual";
  }
  if (
    assistantGuidedFlow?.guided_question ||
    assistantTopTemplatePreview?.id ||
    assistantTopTemplatePreview?.milestone_count ||
    (Array.isArray(assistantTemplateRecommendations) && assistantTemplateRecommendations.length)
  ) {
    return "ai";
  }
  return "manual";
}

function hasMeaningfulStep1DraftState({ agreement, dLocal }) {
  return Boolean(
    safeTrim(dLocal?.project_title || agreement?.project_title || agreement?.title) ||
      safeTrim(dLocal?.project_type || agreement?.project_type) ||
      safeTrim(dLocal?.project_subtype || agreement?.project_subtype) ||
      safeTrim(
        dLocal?.description ||
          dLocal?.scope_of_work ||
          agreement?.description ||
          agreement?.scope_of_work
      )
  );
}

function normalizeTemplateConfidenceLevel(value) {
  const normalized = safeTrim(value).toLowerCase();
  if (normalized === "high" || normalized === "recommended") return "high";
  if (normalized === "medium" || normalized === "possible") return "medium";
  return "low";
}

export default function Step1Details({
  agreement,
  isEdit,
  agreementId,
  dLocal,
  stripeOnboardingState,
  setDLocal,
  people,
  peopleLoadedOnce,
  reloadPeople,
  showQuickAdd,
  setShowQuickAdd,
  qaName,
  setQaName,
  qaEmail,
  setQaEmail,
  qaBusy,
  setQaBusy,
  onQuickAdd,
  saveStep1,
  last400,
  onLocalChange,
  homeownerOptions,
  projectTypeOptions,
  projectSubtypeOptions,
  onTemplateApplied,
  refreshAgreement,
  assistantGuidedFlow = {},
  assistantTemplateRecommendations = [],
  assistantTopTemplatePreview = {},
  assistantProactiveRecommendations = [],
  assistantPredictiveInsights = [],
  assistantProposedActions = [],
  assistantConfirmationRequiredActions = [],
  assistantLeadContext = {},
    assistantDraftPayload = {},
    projectFamilyContext = {},
    aiHighlightKeys = {},
    isAiAssistantActive = false,
    aiSetupRequest = null,
    onStep1AiSetupRequest = null,
    onStep1Continue = null,
    onAiModeActiveChange = null,
    onAiSetupReviewReady = null,
  }) {
  void setQaBusy;

  const empty = (people?.length || 0) === 0;

  const navigate = useNavigate();
  const location = useLocation();

  const BASE = useMemo(() => {
    const p = location.pathname || "";
    return p.startsWith("/app/employee") ? "/app/employee" : "/app";
  }, [location.pathname]);

  const locked = useMemo(() => isAgreementLocked(agreement), [agreement]);

  const selectedProjectType = useMemo(() => {
    const current = safeTrim(dLocal?.project_type);
    if (!current) return null;
    return (
      (projectTypeOptions || []).find((opt) => safeTrim(opt?.value) === current) ||
      null
    );
  }, [projectTypeOptions, dLocal?.project_type]);
  const selectedProjectSubtype = useMemo(() => {
    const current = safeTrim(dLocal?.project_subtype);
    if (!current) return null;
    return (
      (projectSubtypeOptions || []).find((opt) => safeTrim(opt?.value) === current) ||
      null
    );
  }, [projectSubtypeOptions, dLocal?.project_subtype]);
  const [clarificationAnswers, setClarificationAnswers] = useState({});
  const [clarificationsSkipped, setClarificationsSkipped] = useState(false);
  const [step1JobDescriptionPrompt, setStep1JobDescriptionPrompt] = useState(() =>
    safeTrim(dLocal?.description) || ""
  );
  const [step1ManualBrowseSignal, setStep1ManualBrowseSignal] = useState(0);
  const augmentedProjectTypeOptions = useMemo(() => {
    const current = safeTrim(dLocal?.project_type);
    if (!current || (projectTypeOptions || []).some((opt) => safeTrim(opt?.value) === current)) {
      return projectTypeOptions || [];
    }
    return [
      ...(projectTypeOptions || []),
      {
        id: `ai-new-type-${current}`,
        value: current,
        label: `${current} (New)`,
        owner_type: "ai",
      },
    ];
  }, [dLocal?.project_type, projectTypeOptions]);
  const augmentedProjectSubtypeOptions = useMemo(() => {
    const current = safeTrim(dLocal?.project_subtype);
    if (
      !current ||
      (projectSubtypeOptions || []).some((opt) => safeTrim(opt?.value) === current)
    ) {
      return projectSubtypeOptions || [];
    }
    return [
      ...(projectSubtypeOptions || []),
      {
        id: `ai-new-subtype-${current}`,
        value: current,
        label: `${current} (New)`,
        owner_type: "ai",
        project_type: safeTrim(dLocal?.project_type),
      },
    ];
  }, [dLocal?.project_subtype, dLocal?.project_type, projectSubtypeOptions]);

  const hasAiSectionHighlight = (...keys) =>
    keys.some((key) => Boolean(aiHighlightKeys?.[key]));
  const [leadDetailFallback, setLeadDetailFallback] = useState(null);
  const [leadDetailFallbackLoading, setLeadDetailFallbackLoading] = useState(false);
  const [proposalLearningNote, setProposalLearningNote] = useState("");
  const [proposalLearningContextOpen, setProposalLearningContextOpen] = useState(false);
  const [proposalBrandNote, setProposalBrandNote] = useState("");
  const [contractorBrandVoice, setContractorBrandVoice] = useState({});
  const leadProposalContext = useMemo(() => {
    if (assistantLeadContext?.lead_summary) return assistantLeadContext.lead_summary;
    if (leadDetailFallback) return leadSummaryFromRow(leadDetailFallback);
    if (!assistantDraftPayload || typeof assistantDraftPayload !== "object") return {};
    const scopeSummary =
      assistantDraftPayload.project_scope_summary ||
      assistantDraftPayload.description ||
      assistantDraftPayload.project_summary ||
      "";
    return {
      project_title: assistantDraftPayload.project_title || assistantDraftPayload.project_summary || "",
      project_type: assistantDraftPayload.project_type || "",
      project_subtype: assistantDraftPayload.project_subtype || "",
      project_description: scopeSummary,
      project_scope_summary: scopeSummary,
      project_family_key: assistantDraftPayload.project_family_key || "",
      project_family_label: assistantDraftPayload.project_family_label || "",
      project_address: assistantDraftPayload.project_address || "",
      city: assistantDraftPayload.city || "",
      state: assistantDraftPayload.state || "",
      zip_code: assistantDraftPayload.postal_code || "",
      budget_text: assistantDraftPayload.budget || "",
      preferred_timeline: assistantDraftPayload.timeline || "",
      measurement_handling: assistantDraftPayload.measurement_handling || "",
      request_snapshot: assistantDraftPayload.request_snapshot || {},
    };
  }, [assistantDraftPayload, assistantLeadContext, leadDetailFallback]);
  const leadProposalSnapshot = useMemo(
    () =>
      assistantLeadContext?.request_snapshot ||
      assistantDraftPayload?.request_snapshot ||
      leadDetailFallback?.ai_analysis?.request_snapshot ||
      leadProposalContext?.request_snapshot ||
      {},
    [assistantDraftPayload, assistantLeadContext, leadProposalContext, leadDetailFallback]
  );
  const leadProposalDraft = useMemo(
    () =>
      buildLeadProposalDraft({
        leadSummary: leadProposalContext,
        requestSnapshot: leadProposalSnapshot,
        brandVoice: contractorBrandVoice,
      }),
    [contractorBrandVoice, leadProposalContext, leadProposalSnapshot]
  );
  const resolvedProjectFamily = useMemo(
    () => normalizeProjectFamilyContext(projectFamilyContext),
    [projectFamilyContext]
  );
  const recommendedProjectSetup = useMemo(() => {
    const draftRecommendation = normalizeProjectSetupRecommendation(
      leadProposalDraft?.summary?.recommendedSetup || {}
    );
    const payloadRecommendation = normalizeProjectSetupRecommendation(
      assistantDraftPayload?.recommended_setup || {}
    );
    const explicitRecommendation = {
      ...draftRecommendation,
      ...payloadRecommendation,
    };

    if (
      explicitRecommendation?.recommendedProjectType ||
      explicitRecommendation?.recommendedTemplateId ||
      explicitRecommendation?.suggestedWorkflow ||
      explicitRecommendation?.recommendationNote
    ) {
      return explicitRecommendation;
    }

    return buildProjectSetupRecommendation({
      projectTitle: leadProposalContext?.project_title || assistantDraftPayload?.project_title || "",
      projectType: leadProposalContext?.project_type || assistantDraftPayload?.project_type || "",
      projectSubtype:
        leadProposalContext?.project_subtype || assistantDraftPayload?.project_subtype || "",
      projectFamilyKey:
        assistantDraftPayload?.project_family_key ||
        leadProposalContext?.project_family_key ||
        resolvedProjectFamily.project_family_key ||
        "",
      projectFamilyLabel:
        assistantDraftPayload?.project_family_label ||
        leadProposalContext?.project_family_label ||
        resolvedProjectFamily.project_family_label ||
        "",
      description:
        leadProposalContext?.project_scope_summary ||
        leadProposalContext?.project_description ||
        assistantDraftPayload?.project_scope_summary ||
        assistantDraftPayload?.description ||
        "",
      templateId:
        assistantDraftPayload?.selected_template_id ||
        assistantDraftPayload?.template_id ||
        draftRecommendation?.recommendedTemplateId ||
        null,
      templateName:
        assistantDraftPayload?.selected_template_name_snapshot ||
        draftRecommendation?.recommendedTemplateName ||
        "",
    });
  }, [
    assistantDraftPayload,
    leadProposalContext,
    leadProposalDraft?.summary?.recommendedSetup,
    resolvedProjectFamily.project_family_key,
    resolvedProjectFamily.project_family_label,
  ]);
  const hasLeadProposalContext = Boolean(
    assistantLeadContext?.lead_id ||
      assistantDraftPayload?.lead_id ||
      leadDetailFallback?.id ||
      safeTrim(assistantDraftPayload?.description)
  );
  const projectDetailsSectionRef = useRef(null);
  const startModeChooserRef = useRef(null);
  const projectDetailsPulseTimerRef = useRef(null);
  const projectDetailsScrollFrameRef = useRef(null);
  const projectDetailsFocusFrameRef = useRef(null);
  const projectDetailsAutoScrolledRef = useRef(false);
  const projectDetailsUserScrolledRef = useRef(false);
  const projectDetailsProgrammaticScrollRef = useRef(false);
  const projectTypeFieldRef = useRef(null);
  const projectTitleFieldRef = useRef(null);
  const projectScopeFieldRef = useRef(null);
  const projectDetailsRevealMountedRef = useRef(false);
  const projectDetailsRevealSeenRef = useRef(false);

  const [addrSearch, setAddrSearch] = useState("");
  const patchTimerRef = useRef(null);
  const lastPatchedRef = useRef({});

  function formatApiError(error, fallback = "Could not save changes.") {
    const data = error?.response?.data;
    if (!data) return fallback;
    if (typeof data === "string") return data;
    if (typeof data?.detail === "string") return data.detail;
    if (typeof data?.error === "string") return data.error;
    const firstEntry = Object.entries(data).find(([, value]) => value != null);
    if (!firstEntry) return fallback;
    const [field, value] = firstEntry;
    const message = Array.isArray(value) ? value[0] : value;
    if (typeof message === "string") return `${field.replaceAll("_", " ")}: ${message}`;
    return fallback;
  }

  function normalizeRecurringText(value) {
    return value == null ? "" : String(value).trim();
  }

  async function patchAgreement(fields, { silent = true } = {}) {
    if (locked) return;

    const id = agreementId ? String(agreementId) : "";
    if (!id) return;
    if (!fields || Object.keys(fields).length === 0) return;

    const outgoingFields = { ...fields };
    for (const key of ["recurrence_pattern", "service_window_notes", "recurring_summary_label"]) {
      if (Object.prototype.hasOwnProperty.call(outgoingFields, key)) {
        outgoingFields[key] = normalizeRecurringText(outgoingFields[key]);
      }
    }

    const key = JSON.stringify(outgoingFields);
    if (lastPatchedRef.current[key]) return;
    lastPatchedRef.current[key] = true;

    try {
      await api.patch(`/projects/agreements/${id}/`, outgoingFields);
      if (!silent) toast.success("Saved");
    } catch (e) {
      const msg = formatApiError(e, "Could not save changes.");
      if (!silent) toast.error(msg);
    } finally {
      delete lastPatchedRef.current[key];
    }
  }

  function schedulePatch(fields, delayMs = 450) {
    if (locked) return;
    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      patchAgreement(fields, { silent: true });
    }, delayMs);
  }

  useEffect(() => {
    return () => {
      if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const sourceLeadId = agreement?.source_lead || agreement?.source_lead_id || "";
    const hasLeadAssistantContext =
      Boolean(assistantLeadContext?.lead_id) || Boolean(assistantDraftPayload?.lead_id);
    if (!sourceLeadId || hasLeadAssistantContext) return;
    let cancelled = false;

    async function loadSourceLead() {
      setLeadDetailFallbackLoading(true);
      try {
        const { data } = await api.get(`/projects/contractor/public-leads/${sourceLeadId}/`);
        if (!cancelled) {
          setLeadDetailFallback(data || null);
        }
      } catch {
        if (!cancelled) {
          setLeadDetailFallback(null);
        }
      } finally {
        if (!cancelled) {
          setLeadDetailFallbackLoading(false);
        }
      }
    }

    loadSourceLead();
    return () => {
      cancelled = true;
    };
  }, [agreement?.source_lead, agreement?.source_lead_id, assistantDraftPayload?.lead_id, assistantLeadContext?.lead_id]);

  const isNewAgreement = !agreementId;
  const hasMeaningfulSavedProjectDetails = hasMeaningfulStep1DraftState({ agreement, dLocal });
  const canRestoreStartMode =
    !isNewAgreement ||
    hasMeaningfulSavedProjectDetails ||
    Boolean(
      agreement?.selected_template?.id ||
        agreement?.selected_template_id ||
        dLocal?.selected_template?.id ||
        dLocal?.selected_template_id ||
        dLocal?.project_template_id ||
        dLocal?.template_id
    );

  const cacheKey = useMemo(() => {
    const id = agreementId ? String(agreementId) : "new";
    return `mhb_step1_cache_${id}`;
  }, [agreementId]);
  const startModeStorageKey = `${cacheKey}_start_mode`;
  const startModeCommittedStorageKey = `${cacheKey}_start_mode_committed`;
  const startModeSourceStorageKey = `${cacheKey}_start_mode_source`;
  const [startMode, setStartMode] = useState(() => {
    try {
      const saved = sessionStorage.getItem(startModeStorageKey);
      if (saved === "ai" || saved === "template" || saved === "manual") {
        if (canRestoreStartMode || saved === "manual") return saved;
      }
    } catch {
      // ignore
    }
    return inferStartMode({
      agreement,
      assistantGuidedFlow,
      assistantTemplateRecommendations,
      assistantTopTemplatePreview,
      isNewAgreement,
      hasMeaningfulSavedProjectDetails,
    });
  });
  const [startModeCommitted, setStartModeCommitted] = useState(() => {
    try {
      const saved = sessionStorage.getItem(startModeCommittedStorageKey);
      if (canRestoreStartMode) {
        if (saved === "1") return true;
        if (saved === "0") return false;
      }
    } catch {
      // ignore
    }
    return false;
  });
  const [startModeSource, setStartModeSource] = useState(() => {
    try {
      const saved = sessionStorage.getItem(startModeSourceStorageKey);
      if (
        saved === "derived" ||
        saved === "session" ||
        saved === "user" ||
        saved === "assistant" ||
        saved === "template_apply"
      ) {
        if (canRestoreStartMode) return saved;
      }
      const savedMode = sessionStorage.getItem(startModeStorageKey);
      if (savedMode === "ai" || savedMode === "template" || savedMode === "manual") {
        if (canRestoreStartMode) return "session";
      }
    } catch {
      // ignore
    }
    return "derived";
  });
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showResetStep1Confirm, setShowResetStep1Confirm] = useState(false);
  const [dismissedAiTemplateRecommendation, setDismissedAiTemplateRecommendation] =
    useState(false);
  const [aiSetupBusy, setAiSetupBusy] = useState(false);
  const [aiSetupError, setAiSetupError] = useState("");
  const [aiSetupResult, setAiSetupResult] = useState(null);
  const [lastAiSetupPrompt, setLastAiSetupPrompt] = useState("");
  const [aiSuggestedFieldMeta, setAiSuggestedFieldMeta] = useState({});
  const [projectDetailsReviewPulse, setProjectDetailsReviewPulse] = useState(false);
  const [pendingProjectDetailsReview, setPendingProjectDetailsReview] = useState(null);

  function writeCache(nextPatch = {}) {
    try {
      const raw = sessionStorage.getItem(cacheKey);
      const cur = raw ? JSON.parse(raw) : {};
      const merged = { ...cur, ...nextPatch };
      sessionStorage.setItem(cacheKey, JSON.stringify(merged));
    } catch {
      // ignore
    }
  }

  function activateStartMode(mode, { committed = true, source = "user" } = {}) {
    setStartMode(mode);
    setStartModeCommitted(committed);
    setStartModeSource(source);
  }

  function reopenStartModeChooser() {
    setStartModeCommitted(false);
    setStartModeSource((prev) => (prev === "derived" ? "session" : prev));
  }

  function clearStep1SessionState() {
    try {
      sessionStorage.removeItem(cacheKey);
      sessionStorage.removeItem(startModeStorageKey);
      sessionStorage.removeItem(startModeCommittedStorageKey);
      sessionStorage.removeItem(startModeSourceStorageKey);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!isNewAgreement || hasMeaningfulSavedProjectDetails) return;
    clearStep1SessionState();
  }, [hasMeaningfulSavedProjectDetails, isNewAgreement]);

  useEffect(() => {
    const normalized = normalizeProjectClass(dLocal?.project_class);
    if (!safeTrim(dLocal?.project_class)) {
      setDLocal((s) => ({ ...s, project_class: normalized }));
      if (!isNewAgreement) {
        writeCache({ project_class: normalized });
      }
    }
  }, [agreementId, isNewAgreement, dLocal?.project_class, setDLocal]);

  useEffect(() => {
    const normalized = normalizePaymentMode(dLocal?.payment_mode);
    if (!safeTrim(dLocal?.payment_mode)) {
      setDLocal((s) => ({ ...s, payment_mode: normalized }));
      if (!isNewAgreement) {
        writeCache({ payment_mode: normalized });
      }
    }
  }, [agreementId, isNewAgreement, dLocal?.payment_mode, setDLocal]);

  useEffect(() => {
    const normalized = normalizePaymentStructure(dLocal?.payment_structure);
    if (!safeTrim(dLocal?.payment_structure)) {
      setDLocal((s) => ({ ...s, payment_structure: normalized }));
      if (!isNewAgreement) {
        writeCache({ payment_structure: normalized });
      }
    }
  }, [agreementId, isNewAgreement, dLocal?.payment_structure, setDLocal]);

  useEffect(() => {
    if (isNewAgreement) return;

    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const saved = JSON.parse(raw);

      setDLocal((prev) => {
        const next = { ...prev };

        if (!safeTrim(next.project_class) && safeTrim(saved.project_class)) {
          next.project_class = saved.project_class;
        }
        if (!safeTrim(next.payment_mode) && safeTrim(saved.payment_mode)) {
          next.payment_mode = saved.payment_mode;
        }
        if (!safeTrim(next.payment_structure) && safeTrim(saved.payment_structure)) {
          next.payment_structure = saved.payment_structure;
        }
        if (!safeTrim(next.retainage_percent) && safeTrim(saved.retainage_percent)) {
          next.retainage_percent = saved.retainage_percent;
        }
        if (!safeTrim(next.address_line1) && safeTrim(saved.address_line1)) {
          next.address_line1 = saved.address_line1;
        }
        if (!safeTrim(next.address_line2) && safeTrim(saved.address_line2)) {
          next.address_line2 = saved.address_line2;
        }
        if (!safeTrim(next.address_city) && safeTrim(saved.address_city)) {
          next.address_city = saved.address_city;
        }
        if (!safeTrim(next.address_state) && safeTrim(saved.address_state)) {
          next.address_state = saved.address_state;
        }
        if (
          !safeTrim(next.address_postal_code) &&
          safeTrim(saved.address_postal_code)
        ) {
          next.address_postal_code = saved.address_postal_code;
        }
        if (!safeTrim(next.description) && safeTrim(saved.description)) {
          next.description = saved.description;
        }

        return next;
      });

      if (safeTrim(saved.address_search)) {
        setAddrSearch(saved.address_search);
      } else if (safeTrim(saved.address_line1)) {
        setAddrSearch(saved.address_line1);
      }
    } catch {
      // ignore
    }
  }, [cacheKey, isNewAgreement, setDLocal]);

  useEffect(() => {
    if (!safeTrim(addrSearch) && safeTrim(dLocal?.address_line1)) {
      setAddrSearch(dLocal.address_line1);
    }
  }, [agreementId, dLocal?.address_line1, addrSearch]);

  useEffect(() => {
    try {
      sessionStorage.setItem(startModeStorageKey, startMode);
    } catch {
      // ignore
    }
  }, [startMode, startModeStorageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(startModeCommittedStorageKey, startModeCommitted ? "1" : "0");
    } catch {
      // ignore
    }
  }, [startModeCommitted, startModeCommittedStorageKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(startModeSourceStorageKey, startModeSource);
    } catch {
      // ignore
    }
  }, [startModeSource, startModeSourceStorageKey]);

  useEffect(() => {
    if (isNewAgreement) return;

    try {
      const payload = {
        payment_mode: dLocal?.payment_mode || "",
        payment_structure: dLocal?.payment_structure || "",
        retainage_percent: dLocal?.retainage_percent || "",
        address_search: addrSearch || "",
        address_line1: dLocal?.address_line1 || "",
        address_line2: dLocal?.address_line2 || "",
        address_city: dLocal?.address_city || "",
        address_state: dLocal?.address_state || "",
        address_postal_code: dLocal?.address_postal_code || "",
        description: dLocal?.description || "",
        geo: null,
      };
      sessionStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    isNewAgreement,
    cacheKey,
    addrSearch,
    dLocal?.payment_mode,
    dLocal?.payment_structure,
    dLocal?.retainage_percent,
    dLocal?.address_line1,
    dLocal?.address_line2,
    dLocal?.address_city,
    dLocal?.address_state,
    dLocal?.address_postal_code,
    dLocal?.description,
  ]);

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerAddrMissing, setCustomerAddrMissing] = useState(null);
  const [customerAddrLoading, setCustomerAddrLoading] = useState(false);

  useEffect(() => {
    const raw = dLocal?.homeowner;
    const idVal = typeof raw === "number" ? raw : parseInt(String(raw || ""), 10);

    if (!idVal || Number.isNaN(idVal)) {
      setSelectedCustomer(null);
      setCustomerAddrMissing(null);
      return;
    }

    let cancelled = false;

    async function run() {
      setCustomerAddrLoading(true);
      try {
        const { data } = await api.get(`/projects/homeowners/${idVal}/`, {
          params: { _ts: Date.now() },
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        });

        if (cancelled) return;

        setSelectedCustomer(data);

        const missing = computeCustomerAddressMissing(data);
        setCustomerAddrMissing(missing.length ? missing : null);
      } catch {
        if (cancelled) return;
        setSelectedCustomer(null);
        setCustomerAddrMissing(null);
      } finally {
        if (!cancelled) setCustomerAddrLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [dLocal?.homeowner]);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [aiPreview, setAiPreview] = useState("");

  const [aiCredits, setAiCredits] = useState({
    loading: true,
    access: "included",
    enabled: true,
    unlimited: true,
  });

  const refreshAiCredits = async () => {
    try {
      setAiCredits((s) => ({ ...s, loading: true }));
      const { data } = await api.get("/projects/contractors/me/");
      const c = extractAiCredits(data || {});
      setAiCredits({ loading: false, ...c });
      setContractorBrandVoice(data?.public_profile || {});
    } catch {
      setAiCredits((s) => ({ ...s, loading: false }));
      setContractorBrandVoice({});
    }
  };

  useEffect(() => {
    refreshAiCredits();
  }, [agreementId]);

  const hasSomeContext = useMemo(() => {
    return (
      !!safeTrim(dLocal.project_title) ||
      !!safeTrim(dLocal.project_type) ||
      !!safeTrim(dLocal.project_subtype)
    );
  }, [dLocal.project_title, dLocal.project_type, dLocal.project_subtype]);
  const startModeCards = useMemo(
    () => [
      {
        key: "ai",
        title: "Describe the job",
        description: "AI will recommend a matching template or help build the agreement.",
      },
      {
        key: "template",
        title: "Recommended starting point",
        description: "Use a matching starting point and adjust the agreement for this project.",
      },
      {
        key: "manual",
        title: "Build agreement directly",
        description: "Start from the project details and keep the agreement fully editable.",
      },
    ],
    []
  );
  const hasTemplateApplied =
    Boolean(agreement?.selected_template?.id || agreement?.selected_template_id) ||
    Boolean(assistantTopTemplatePreview?.id);
  const derivedStartMode = inferStartMode({
    agreement,
    assistantGuidedFlow,
    assistantTemplateRecommendations,
    assistantTopTemplatePreview,
    isNewAgreement,
    hasMeaningfulSavedProjectDetails,
  });
  useEffect(() => {
    if (isNewAgreement && startModeSource === "derived" && !startModeCommitted) {
      if (startMode !== "manual") {
        setStartMode("manual");
      }
      return;
    }
    if (startModeSource === "derived" && startMode !== derivedStartMode) {
      setStartMode(derivedStartMode);
    }
    if (
      ((derivedStartMode === "template" ||
        (derivedStartMode === "ai" &&
          (assistantGuidedFlow?.guided_question ||
            assistantTopTemplatePreview?.id ||
            assistantTopTemplatePreview?.milestone_count ||
            assistantTemplateRecommendations.length))) ||
        hasMeaningfulSavedProjectDetails) &&
      !startModeCommitted
    ) {
      setStartModeCommitted(true);
    }
  }, [
    assistantGuidedFlow,
    assistantTemplateRecommendations.length,
    assistantTopTemplatePreview,
    agreement?.description,
    agreement?.project_title,
    agreement?.project_type,
    agreement?.scope_of_work,
    derivedStartMode,
    hasMeaningfulSavedProjectDetails,
    isNewAgreement,
    startMode,
    startModeCommitted,
    startModeSource,
  ]);

  useEffect(() => {
    if (!hasMeaningfulSavedProjectDetails) return;
    const hasAppliedTemplateReference = Boolean(
      agreement?.selected_template?.id ||
        agreement?.selected_template_id ||
        agreement?.project_template_id ||
        agreement?.template_id ||
        dLocal?.selected_template?.id ||
        dLocal?.selected_template_id ||
        dLocal?.project_template_id ||
        dLocal?.template_id
    );
    if (hasAppliedTemplateReference || aiSetupResult) return;
    if (startMode !== "manual") {
      setStartMode("manual");
    }
    if (!startModeCommitted) {
      setStartModeCommitted(true);
    }
  }, [
    aiSetupResult,
    agreement?.project_template_id,
    agreement?.selected_template?.id,
    agreement?.selected_template_id,
    agreement?.template_id,
    hasMeaningfulSavedProjectDetails,
    dLocal?.project_template_id,
    dLocal?.selected_template?.id,
    dLocal?.selected_template_id,
    dLocal?.template_id,
    startMode,
    startModeCommitted,
  ]);

  useEffect(() => {
    onAiModeActiveChange?.(false);
  }, [onAiModeActiveChange, startMode, startModeCommitted, aiSetupResult?.kind]);

  useEffect(() => {
    return () => {
      if (projectDetailsPulseTimerRef.current) {
        clearTimeout(projectDetailsPulseTimerRef.current);
      }
      if (projectDetailsScrollFrameRef.current && typeof window !== "undefined") {
        window.cancelAnimationFrame(projectDetailsScrollFrameRef.current);
      }
      if (projectDetailsFocusFrameRef.current && typeof window !== "undefined") {
        window.cancelAnimationFrame(projectDetailsFocusFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleWindowScroll = () => {
      if (projectDetailsProgrammaticScrollRef.current) return;
      projectDetailsUserScrolledRef.current = true;
    };

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
    };
  }, []);

  function queueProjectDetailsReview(changedKeys = []) {
    if (typeof window === "undefined") return;
    setPendingProjectDetailsReview({
      nonce: Date.now(),
      changedKeys: Array.isArray(changedKeys) ? changedKeys.filter(Boolean) : [],
    });
  }

  function focusProjectDetailsField() {
    const focusTarget =
      !safeTrim(dLocal?.project_type)
        ? projectTypeFieldRef.current
        : !safeTrim(dLocal?.project_title)
        ? projectTitleFieldRef.current
        : projectScopeFieldRef.current;

    if (!focusTarget || typeof focusTarget.focus !== "function") return;

    try {
      focusTarget.focus({ preventScroll: true });
    } catch {
      focusTarget.focus();
    }
  }

  function pulseProjectDetails() {
    setProjectDetailsReviewPulse(true);
    if (projectDetailsPulseTimerRef.current) {
      clearTimeout(projectDetailsPulseTimerRef.current);
    }
    projectDetailsPulseTimerRef.current = window.setTimeout(() => {
      setProjectDetailsReviewPulse(false);
    }, 2000);
  }

  function scrollToProjectDetails({ allowAutoScroll = false } = {}) {
    if (typeof window === "undefined") return;
    const target = projectDetailsSectionRef.current;
    if (!target) return;

    if (projectDetailsScrollFrameRef.current) {
      window.cancelAnimationFrame(projectDetailsScrollFrameRef.current);
    }
    if (projectDetailsFocusFrameRef.current) {
      window.cancelAnimationFrame(projectDetailsFocusFrameRef.current);
    }

    if (allowAutoScroll) {
      if (projectDetailsAutoScrolledRef.current || projectDetailsUserScrolledRef.current) {
        return;
      }
      projectDetailsAutoScrolledRef.current = true;
    } else {
      projectDetailsUserScrolledRef.current = true;
    }

    pulseProjectDetails();
    projectDetailsProgrammaticScrollRef.current = true;
    projectDetailsScrollFrameRef.current = window.requestAnimationFrame(() => {
      projectDetailsScrollFrameRef.current = null;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => {
        projectDetailsProgrammaticScrollRef.current = false;
      }, 800);
    });

    projectDetailsFocusFrameRef.current = window.requestAnimationFrame(() => {
      projectDetailsFocusFrameRef.current = null;
      focusProjectDetailsField();
    });
  }

  function getAiSuggestedIndicator(fieldKey) {
    const fieldHighlight = aiHighlightKeys?.[fieldKey];
    if (!fieldHighlight) return null;
    const meta = aiSuggestedFieldMeta?.[fieldKey] || {};
    return meta.isNew ? "AI suggested (New)" : "AI suggested";
  }

  useEffect(() => {
    if (!pendingProjectDetailsReview?.nonce) return;
    if (typeof window === "undefined") {
      setPendingProjectDetailsReview(null);
      return;
    }

    onAiSetupReviewReady?.({
      message: "Setup is ready to review in Project Details.",
      changedKeys: pendingProjectDetailsReview.changedKeys,
    });

    const target = projectDetailsSectionRef.current;
    if (!target) {
      setPendingProjectDetailsReview(null);
      return;
    }

    pulseProjectDetails();
    setPendingProjectDetailsReview(null);
  }, [
    onAiSetupReviewReady,
    pendingProjectDetailsReview,
  ]);

  async function runAiDescription(mode) {
    if (locked) return;

    setAiErr("");
    setAiPreview("");
    setAiBusy(true);

    try {
      const clarificationContext = buildDescriptionRequestContext(
        dLocal.description || "",
        clarificationSummaryLines
      );
      const payload = {
        mode,
        agreement_id: agreementId || null,
        project_title: dLocal.project_title || "",
        project_type: dLocal.project_type || "",
        project_subtype: dLocal.project_subtype || "",
        current_description: clarificationContext,
      };

      const res = await api.post(`/projects/agreements/ai/description/`, payload);
      const text = res?.data?.description || "";

      if (!safeTrim(text)) {
        throw new Error("AI returned an empty description.");
      }

      setAiPreview(text);

      setAiCredits((prev) => ({
        ...prev,
        loading: false,
        access: res?.data?.ai_access || "included",
        enabled: res?.data?.ai_enabled !== false,
        unlimited: res?.data?.ai_unlimited !== false,
      }));
    } catch (e) {
      setAiErr(
        e?.response?.data?.detail ||
          e?.message ||
          "AI description request failed."
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function applyAiDescription(action) {
    if (locked) return;

    const suggestion = safeTrim(aiPreview);
    if (!suggestion) return;

    const cur = safeTrim(dLocal.description);
    const nextDescription =
      action === "append" && cur ? `${cur}\n\n${suggestion}` : suggestion;

    setDLocal((s) => ({ ...s, description: nextDescription }));
    if (!isNewAgreement) {
      writeCache({ description: nextDescription });
    }

    await patchAgreement({ description: nextDescription }, { silent: true });
    setAiPreview("");
  }

  async function handleGenerateLeadProposalDraft() {
    if (locked || !hasLeadProposalContext) return;

    setProposalLearningNote("");
    setProposalBrandNote("");
    setProposalLearningContextOpen(false);

    const currentDraft = safeTrim(dLocal.description);
    try {
      const { data } = await api.post("/projects/agreements/ai/draft/", {
        agreement_id: agreementId || null,
        project_title: dLocal.project_title || "",
        description: dLocal.description || "",
        project_type: dLocal.project_type || "",
        project_subtype: dLocal.project_subtype || "",
      });

      const draftPayload = data?.proposal_draft || {};
      const nextDraft = safeTrim(draftPayload.text || data?.normalized_description || "");
      if (!nextDraft) {
        throw new Error("Could not build a proposal draft.");
      }

      if (currentDraft && currentDraft !== nextDraft) {
        const confirmed = window.confirm(
          "Replace the current proposal draft with a draft based on this lead?"
        );
        if (!confirmed) return;
      }

      const nextTitle = safeTrim(draftPayload.title || data?.project_title || dLocal.project_title);
      setDLocal((s) => ({
        ...s,
        project_title: nextTitle || s.project_title || "",
        description: nextDraft,
      }));

      if (!isNewAgreement) {
        writeCache({
          ...(nextTitle ? { project_title: nextTitle } : {}),
          description: nextDraft,
        });
      }

      if (agreementId) {
        await patchAgreement(
          {
            ...(nextTitle ? { project_title: nextTitle, title: nextTitle } : {}),
            description: nextDraft,
          },
          { silent: true }
        );
      }

      if (data?.used_successful_learning) {
        setProposalLearningNote("Based on similar successful projects");
        setProposalLearningContextOpen(false);
      }
      if (data?.used_brand_voice) {
        setProposalBrandNote("Personalized using your profile preferences");
      }
    } catch (error) {
      const fallbackDraft = safeTrim(leadProposalDraft?.text);
      if (!fallbackDraft) {
        throw error;
      }

      if (currentDraft && currentDraft !== fallbackDraft) {
        const confirmed = window.confirm(
          "Replace the current proposal draft with a draft based on this lead?"
        );
        if (!confirmed) return;
      }

      const nextTitle = safeTrim(leadProposalDraft?.title) || safeTrim(dLocal.project_title);
      setDLocal((s) => ({
        ...s,
        project_title: nextTitle || s.project_title || "",
        description: fallbackDraft,
      }));

      if (!isNewAgreement) {
        writeCache({
          ...(nextTitle ? { project_title: nextTitle } : {}),
          description: fallbackDraft,
        });
      }

      if (agreementId) {
        await patchAgreement(
          {
            ...(nextTitle ? { project_title: nextTitle, title: nextTitle } : {}),
            description: fallbackDraft,
          },
          { silent: true }
        );
      }
      if (leadProposalDraft?.summary?.brandVoiceApplied) {
        setProposalBrandNote("Personalized using your profile preferences");
      }
    }
  }

  const paymentStructure = normalizePaymentStructure(dLocal?.payment_structure);
  const projectClass = normalizeProjectClass(dLocal?.project_class);
  const isCommercialProject = projectClass === "commercial";
  const retainagePercent = safeTrim(dLocal?.retainage_percent) || "0.00";
  const agreementMode = safeTrim(dLocal?.agreement_mode) || "standard";
  const stripeGuidance = buildStripeOnboardingGuidance(stripeOnboardingState);
  const isMaintenanceMode = agreementMode === "maintenance";
  const recurrencePattern = safeTrim(dLocal?.recurrence_pattern) || "monthly";
  const recurrenceInterval = safeTrim(dLocal?.recurrence_interval) || "1";
  const recurrenceStartDate = safeTrim(dLocal?.recurrence_start_date);
  const recurrenceEndDate = safeTrim(dLocal?.recurrence_end_date);
  const maintenanceStatus = safeTrim(dLocal?.maintenance_status) || "active";
  const autoGenerateNextOccurrence = dLocal?.auto_generate_next_occurrence !== false;
  const recurringSummaryLabel = safeTrim(dLocal?.recurring_summary_label);
  const nextOccurrenceDate = safeTrim(
    dLocal?.next_occurrence_date || agreement?.next_occurrence_date
  );
  const recurringSummaryText =
    recurringSummaryLabel || formatRecurrenceSummary(recurrencePattern, recurrenceInterval);

  async function handlePaymentStructureChange(nextMode) {
    if (locked) return;
    if (!isCommercialProject && nextMode === "progress") return;

    const normalized = normalizePaymentStructure(nextMode);
    if (normalized === paymentStructure) return;

    const confirmed = window.confirm(
      normalized === "progress"
        ? "Switch to Progress Payments? Milestones will stay intact, but the workflow will use draw requests after signing."
        : "Switch back to Simple Payments? Draw request tools will be hidden and retainage will reset to 0%."
    );
    if (!confirmed) return;

    const nextRetainage = normalized === "progress" ? retainagePercent || "0.00" : "0.00";
    const previousPaymentStructure = paymentStructure;
    const previousRetainage = retainagePercent || "0.00";
    setDLocal((s) => ({
      ...s,
      payment_structure: normalized,
      retainage_percent: nextRetainage,
    }));
    if (!isNewAgreement) {
      writeCache({ payment_structure: normalized, retainage_percent: nextRetainage });
    }

    if (!agreementId) return;

    try {
      await api.patch(`/projects/agreements/${agreementId}/`, {
        payment_structure: normalized,
        retainage_percent: nextRetainage,
      });
    } catch (e) {
      setDLocal((s) => ({
        ...s,
        payment_structure: previousPaymentStructure,
        retainage_percent: previousRetainage,
      }));
      if (!isNewAgreement) {
        writeCache({
          payment_structure: previousPaymentStructure,
          retainage_percent: previousRetainage,
        });
      }
      toast.error(formatApiError(e, "Could not update payment structure."));
    }
  }

  async function handleProjectClassChange(nextClass) {
    if (locked) return;

    const normalized = normalizeProjectClass(nextClass);
    if (normalized === projectClass) return;

    const nextPaymentStructure = normalized === "commercial" ? paymentStructure : "simple";
    const nextRetainage = normalized === "commercial" && nextPaymentStructure === "progress"
      ? retainagePercent || "0.00"
      : "0.00";

    const previousProjectClass = projectClass;
    const previousPaymentStructure = paymentStructure;
    const previousRetainage = retainagePercent || "0.00";

    setDLocal((s) => ({
      ...s,
      project_class: normalized,
      payment_structure: nextPaymentStructure,
      retainage_percent: nextRetainage,
    }));
    if (!isNewAgreement) {
      writeCache({
        project_class: normalized,
        payment_structure: nextPaymentStructure,
        retainage_percent: nextRetainage,
      });
    }

    if (!agreementId) return;

    try {
      await api.patch(`/projects/agreements/${agreementId}/`, {
        project_class: normalized,
        payment_structure: nextPaymentStructure,
        retainage_percent: nextRetainage,
      });
    } catch (e) {
      setDLocal((s) => ({
        ...s,
        project_class: previousProjectClass,
        payment_structure: previousPaymentStructure,
        retainage_percent: previousRetainage,
      }));
      if (!isNewAgreement) {
        writeCache({
          project_class: previousProjectClass,
          payment_structure: previousPaymentStructure,
          retainage_percent: previousRetainage,
        });
      }
      toast.error(formatApiError(e, "Could not update the project workflow."));
    }
  }

  async function handleRetainageChange(value) {
    if (locked) return;
    const previousRetainage = retainagePercent || "0.00";
    setDLocal((s) => ({ ...s, retainage_percent: value }));
    if (!isNewAgreement) {
      writeCache({ retainage_percent: value });
    }
    if (!agreementId) return;
    try {
      await api.patch(`/projects/agreements/${agreementId}/`, {
        retainage_percent: value || "0.00",
      });
    } catch (e) {
      setDLocal((s) => ({ ...s, retainage_percent: previousRetainage }));
      if (!isNewAgreement) {
        writeCache({ retainage_percent: previousRetainage });
      }
      toast.error(formatApiError(e, "Could not update retainage."));
    }
  }

  async function handleMaintenanceModeChange(nextMode) {
    if (locked) return;
    const normalized = safeTrim(nextMode) === "maintenance" ? "maintenance" : "standard";
    const nextPatch =
      normalized === "maintenance"
        ? {
            agreement_mode: "maintenance",
            recurring_service_enabled: true,
            recurrence_pattern: recurrencePattern || "monthly",
            recurrence_interval: Math.max(1, Number(recurrenceInterval || 1) || 1),
            recurrence_start_date: recurrenceStartDate || "",
            recurrence_end_date: recurrenceEndDate || "",
            maintenance_status: maintenanceStatus || "active",
            auto_generate_next_occurrence: autoGenerateNextOccurrence,
            service_window_notes: normalizeRecurringText(dLocal?.service_window_notes),
            recurring_summary_label: normalizeRecurringText(dLocal?.recurring_summary_label),
          }
        : {
            agreement_mode: "standard",
            recurring_service_enabled: false,
            recurrence_pattern: "",
            recurrence_interval: 1,
            recurrence_start_date: null,
            recurrence_end_date: null,
            maintenance_status: "active",
            auto_generate_next_occurrence: false,
            service_window_notes: "",
            recurring_summary_label: "",
          };

    setDLocal((s) => ({
      ...s,
      ...nextPatch,
      agreement_mode: normalized,
    }));

    if (!agreementId) return;
    await patchAgreement(nextPatch, { silent: true });
  }

  async function handleMaintenanceFieldPatch(name, value) {
    if (locked) return;
    setDLocal((s) => ({ ...s, [name]: value }));
    if (!agreementId) return;
    await patchAgreement({ [name]: value }, { silent: true });
  }

  function persistAddressNow({ silent = true } = {}) {
    if (locked) return;

    patchAgreement(
      {
        address_line1: safeTrim(dLocal?.address_line1),
        address_line2: safeTrim(dLocal?.address_line2),
        address_city: safeTrim(dLocal?.address_city),
        address_state: safeTrim(dLocal?.address_state),
        address_postal_code: safeTrim(dLocal?.address_postal_code),
      },
      { silent }
    );
  }

  const {
    templatesLoading,
    templatesErr,
    selectedTemplateId,
    setSelectedTemplateId,
    applyingTemplateId,
    recommendedTemplateId,
    templateRecommendationReason,
    templateRecommendationScore,
    recommendationLoading,
    recommendationConfidence,
    templateSearch,
    setTemplateSearch,
    selectedTemplate,
    filteredTemplates,
    noTemplateMatch,
    noTemplateReason,
    templateDetail,
    templateDetailLoading,
    templateDetailErr,
    handleApplyTemplate,
    handleDeleteTemplate,
    handleSaveAsTemplate,
    handleTemplatePick,
  } = useStep1Templates({
    locked,
    agreementId,
    dLocal,
    setDLocal,
    isNewAgreement,
    writeCache,
    onTemplateApplied,
    refreshAgreement,
    projectFamilyContext: resolvedProjectFamily,
  });

  useEffect(() => {
    const nextRecommendedTemplateId = safeTrim(
      recommendedProjectSetup?.recommendedTemplateId || assistantDraftPayload?.selected_template_id || ""
    );
    if (!nextRecommendedTemplateId || selectedTemplateId) return;
    const matchedTemplate = (filteredTemplates || []).find(
      (template) => String(template?.id || "") === String(nextRecommendedTemplateId)
    );
    if (!matchedTemplate) return;
    if (
      !recommendedProjectSetup?.strongTemplateMatch &&
      !assistantDraftPayload?.selected_template_id
    ) {
      return;
    }
  }, [
    assistantDraftPayload?.selected_template_id,
    filteredTemplates,
    recommendedProjectSetup?.recommendedTemplateId,
    recommendedProjectSetup?.strongTemplateMatch,
    selectedTemplateId,
    setSelectedTemplateId,
    setTemplateSearch,
  ]);

  useEffect(() => {
    setDismissedAiTemplateRecommendation(false);
  }, [startMode, recommendedTemplateId, assistantTemplateRecommendations.length]);

  useEffect(() => {
    if (!aiSetupRequest?.nonce) return;
    (async () => {
      try {
        await runAiRefineAndSetup(aiSetupRequest.prompt);
      } finally {
        onStep1AiSetupRequest?.(null);
      }
    })();
  }, [aiSetupRequest?.nonce, onStep1AiSetupRequest]);

  async function onSubmitSaveAsTemplate(payload) {
    setSavingTemplate(true);
    try {
      const result = await handleSaveAsTemplate(payload);
      if (result?.ok) {
        setShowSaveTemplateModal(false);
      }
    } finally {
      setSavingTemplate(false);
    }
  }

  const [spreadEnabled, setSpreadEnabled] = useState(true);
  const [spreadTotal, setSpreadTotal] = useState("");
  const [autoSchedule, setAutoSchedule] = useState(true);

  const {
    aiLoading: aiMilestoneBusy,
    aiApplying: aiMilestoneApplying,
    aiError: aiMilestoneErr,
    aiPreview: aiMilestonePreview,
    setAiPreview: setAiMilestonePreview,
    runAiSuggest,
    applyAiMilestones,
  } = useAgreementMilestoneAI({
    agreementId,
    locked,
    refreshAgreement,
    refreshMilestones: null,
    projectFamilyContext: resolvedProjectFamily,
  });

  async function runAiMilestonesFromScope() {
    if (locked) return;
    if (!agreementId) {
      toast.error("Save Draft first.");
      return;
    }
    const notes = [
      safeTrim(resolvedProjectFamily.project_family_label)
        ? `Project Family: ${safeTrim(resolvedProjectFamily.project_family_label)}`
        : "",
      safeTrim(dLocal?.project_title)
        ? `Project Title: ${safeTrim(dLocal.project_title)}`
        : "",
      safeTrim(dLocal?.project_type)
        ? `Project Type: ${safeTrim(dLocal.project_type)}`
        : "",
      safeTrim(dLocal?.project_subtype)
        ? `Project Subtype: ${safeTrim(dLocal.project_subtype)}`
        : "",
      safeTrim(dLocal?.description) ? `Scope: ${safeTrim(dLocal.description)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await runAiSuggest({ notes: notes.filter(Boolean).join("\n") });
  }

  async function applyAiMilestonesFromScope(mode = "replace") {
    if (locked) return;

    const st = String(spreadTotal || "").trim();
    if (spreadEnabled && st !== "") {
      const n = Number(st);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error("Auto-spread total must be greater than $0.");
        return;
      }
    }

    const result = await applyAiMilestones({
      mode,
      spreadEnabled,
      spreadTotal,
      autoSchedule,
    });

    if (result?.count > 0) {
      toast.success(`Created ${result.count} milestones via AI.`);
      if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }
    }
  }

  function syncLocalFromAgreementPayload(nextAgreement) {
    if (!nextAgreement || typeof nextAgreement !== "object") return;

    const nextSelectedTemplate =
      nextAgreement.selected_template || nextAgreement.selectedTemplate || null;

    const nextSelectedTemplateId =
      nextAgreement.selected_template_id ??
      nextAgreement.selectedTemplateId ??
      nextAgreement.project_template_id ??
      nextAgreement.template_id ??
      nextSelectedTemplate?.id ??
      null;

    const nextProjectTitle =
      safeTrim(nextAgreement.project_title) ||
      safeTrim(nextAgreement.title) ||
      safeTrim(nextAgreement.project?.title) ||
      safeTrim(dLocal?.project_title);

    const nextAddressLine1 =
      nextAgreement.address_line1 ??
      nextAgreement.project_address_line1 ??
      dLocal?.address_line1 ??
      "";

    const nextAddressLine2 =
      nextAgreement.address_line2 ??
      nextAgreement.project_address_line2 ??
      dLocal?.address_line2 ??
      "";

    const nextAddressCity =
      nextAgreement.address_city ??
      nextAgreement.city ??
      nextAgreement.project_address_city ??
      dLocal?.address_city ??
      "";

    const nextAddressState =
      nextAgreement.address_state ??
      nextAgreement.state ??
      nextAgreement.project_address_state ??
      dLocal?.address_state ??
      "";

    const nextAddressPostalCode =
      nextAgreement.address_postal_code ??
      nextAgreement.postal_code ??
      nextAgreement.project_postal_code ??
      dLocal?.address_postal_code ??
      "";

    setDLocal((prev) => ({
      ...prev,
      project_title: nextProjectTitle,
      project_class: normalizeProjectClass(nextAgreement.project_class ?? prev.project_class),
      project_type:
        nextAgreement.project_type ?? nextAgreement.projectType ?? prev.project_type ?? "",
      project_subtype:
        nextAgreement.project_subtype ??
        nextAgreement.projectSubtype ??
        prev.project_subtype ??
        "",
      description: nextAgreement.description ?? prev.description ?? "",
      step_status: nextAgreement.step_status ?? prev.step_status ?? "",
      payment_mode:
        normalizePaymentMode(
          nextAgreement.payment_mode ?? nextAgreement.paymentMode ?? prev.payment_mode
        ) || prev.payment_mode,
      payment_structure:
        normalizePaymentStructure(
          nextAgreement.payment_structure ?? nextAgreement.paymentStructure ?? prev.payment_structure
        ) || prev.payment_structure || "simple",
      retainage_percent:
        nextAgreement.retainage_percent != null
          ? String(nextAgreement.retainage_percent)
          : prev.retainage_percent || "0.00",
      selected_template: nextSelectedTemplate,
      selected_template_id: nextSelectedTemplateId,
      selected_template_name_snapshot:
        nextAgreement.selected_template_name_snapshot ??
        nextAgreement.selectedTemplateNameSnapshot ??
        nextSelectedTemplate?.name ??
        "",
      project_template_id: nextSelectedTemplateId,
      template_id: nextSelectedTemplateId,
      homeowner:
        nextAgreement.homeowner ??
        nextAgreement.homeowner_id ??
        prev.homeowner ??
        "",
      address_line1: nextAddressLine1,
      address_line2: nextAddressLine2,
      address_city: nextAddressCity,
      address_state: nextAddressState,
      address_postal_code: nextAddressPostalCode,
    }));

    if (!isNewAgreement) {
      writeCache({
        project_class: normalizeProjectClass(nextAgreement.project_class ?? dLocal?.project_class),
        description: nextAgreement.description ?? dLocal?.description ?? "",
        payment_mode:
          normalizePaymentMode(
            nextAgreement.payment_mode ?? nextAgreement.paymentMode ?? dLocal?.payment_mode
          ) || dLocal?.payment_mode,
        payment_structure:
          normalizePaymentStructure(
            nextAgreement.payment_structure ?? nextAgreement.paymentStructure ?? dLocal?.payment_structure
          ) || dLocal?.payment_structure || "simple",
        retainage_percent:
          nextAgreement.retainage_percent != null
            ? String(nextAgreement.retainage_percent)
            : dLocal?.retainage_percent || "0.00",
        selected_template: nextSelectedTemplate,
        selected_template_id: nextSelectedTemplateId,
        selected_template_name_snapshot:
          nextAgreement.selected_template_name_snapshot ??
          nextSelectedTemplate?.name ??
          "",
        project_template_id: nextSelectedTemplateId,
        template_id: nextSelectedTemplateId,
        step_status: nextAgreement.step_status ?? dLocal?.step_status ?? "",
        address_line1: nextAddressLine1,
        address_line2: nextAddressLine2,
        address_city: nextAddressCity,
        address_state: nextAddressState,
        address_postal_code: nextAddressPostalCode,
        address_search: nextAddressLine1 || "",
      });
    }

    if (safeTrim(nextAddressLine1)) {
      setAddrSearch(nextAddressLine1);
    }
  }

  async function handleTemplateApplied(nextAgreement, payload = null) {
    activateStartMode(startMode === "ai" ? "ai" : "template", {
      source: startMode === "ai" ? "assistant" : "template_apply",
    });
    setDismissedAiTemplateRecommendation(false);
    syncLocalFromAgreementPayload(nextAgreement);
    queueProjectDetailsReview(["project_title", "project_type", "project_subtype", "description"]);
    toast.success("Template applied. Review the agreement details below.");

    if (typeof onTemplateApplied === "function") {
      try {
        await onTemplateApplied(nextAgreement, payload);
      } catch {
        // ignore parent callback errors so local UI still updates
      }
    }

    if (typeof refreshAgreement === "function") {
      await refreshAgreement();
    }
  }

  function scrollToStartModeChooser() {
    if (typeof window === "undefined") return;
    const target = startModeChooserRef.current;
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      target.scrollIntoView();
    }
  }

  function handleBuildAgreementWithoutTemplate() {
    setAiSetupBusy(false);
    setAiSetupError("");
    setAiSetupResult(null);
    setSelectedTemplateId(null);
    setTemplateSearch("");
    setAiPreview("");
    setAiMilestonePreview(null);
    setAiErr("");
    activateStartMode("manual", { committed: true, source: "user" });
    queueProjectDetailsReview(["project_title", "project_type", "project_subtype", "description"]);
    if (agreementId) {
      patchAgreement(
        {
          step_status: "step1",
          scope_of_work: safeTrim(dLocal?.description || agreement?.description || ""),
        },
        { silent: true }
      );
    }
  }

  async function handleTemplateApplyWithOptions(template, options = {}) {
    if (typeof handleApplyTemplate !== "function") return null;
    return handleApplyTemplate(template, options);
  }

  function requestStep1AiSetup(prompt) {
    const roughDescription = safeTrim(prompt);
    if (!roughDescription) return;

    const hasSavedStep1State =
      Boolean(agreementId) &&
      Boolean(safeTrim(agreement?.project_type)) &&
      Boolean(safeTrim(agreement?.description || agreement?.scope_of_work));
    if (hasSavedStep1State) {
      setAiSetupBusy(false);
      setAiSetupError("");
      setAiSetupResult(null);
      setDismissedAiTemplateRecommendation(false);
      return;
    }

    setLastAiSetupPrompt(roughDescription);
    if (agreementId) {
      patchAgreement(
        {
          project_title: safeTrim(dLocal?.project_title || agreement?.project_title || ""),
          project_type: safeTrim(dLocal?.project_type || agreement?.project_type || ""),
          project_subtype: safeTrim(dLocal?.project_subtype || agreement?.project_subtype || ""),
          scope_of_work: safeTrim(dLocal?.description || agreement?.description || agreement?.scope_of_work || ""),
          step_status: "step1",
        },
        { silent: true }
      );
    }
    setAiSetupBusy(true);
    setAiSetupError("");
    setAiSetupResult(null);
    setDismissedAiTemplateRecommendation(false);

    if (typeof onStep1AiSetupRequest === "function") {
      onStep1AiSetupRequest({ prompt: roughDescription, nonce: Date.now() });
    }
  }

  const appliedTemplateId = useMemo(() => {
    return (
      agreement?.selected_template?.id ||
      agreement?.selected_template_id ||
      agreement?.project_template_id ||
      agreement?.template_id ||
      dLocal?.selected_template?.id ||
      dLocal?.selected_template_id ||
      dLocal?.project_template_id ||
      dLocal?.template_id ||
      null
    );
  }, [
    agreement?.selected_template?.id,
    agreement?.selected_template_id,
    agreement?.project_template_id,
    agreement?.template_id,
    dLocal?.selected_template?.id,
    dLocal?.selected_template_id,
    dLocal?.project_template_id,
    dLocal?.template_id,
  ]);

  const complianceWarning = agreement?.compliance_warning || null;
  const appliedTemplateName = safeTrim(
    agreement?.selected_template?.name ||
      agreement?.selected_template_name_snapshot ||
      dLocal?.selected_template_name_snapshot ||
      selectedTemplate?.name
  );
  const clarificationContext = useMemo(
    () => ({
      projectTitle: safeTrim(dLocal?.project_title || agreement?.project_title),
      jobDescription: safeTrim(step1JobDescriptionPrompt || dLocal?.description || agreement?.description),
      scopeOfWork: safeTrim(dLocal?.description || agreement?.description),
      projectType: safeTrim(dLocal?.project_type || agreement?.project_type),
      projectSubtype: safeTrim(
        dLocal?.project_subtype ||
          agreement?.project_subtype ||
          dLocal?.project_family_label ||
          agreement?.project_family_label ||
          assistantDraftPayload?.project_family_label ||
          agreement?.selected_template?.project_subtype ||
          dLocal?.selected_template?.project_subtype ||
          selectedTemplate?.project_subtype ||
          assistantTopTemplatePreview?.project_subtype ||
          ""
      ),
      projectFamilyLabel: safeTrim(
        dLocal?.project_family_label ||
          agreement?.project_family_label ||
          assistantDraftPayload?.project_family_label ||
          ""
      ),
      pendingClarifications: Array.isArray(agreement?.pending_clarifications)
        ? agreement.pending_clarifications
        : [],
    }),
    [
      agreement?.description,
      agreement?.pending_clarifications,
      agreement?.project_family_label,
      agreement?.project_subtype,
      agreement?.project_title,
      agreement?.project_type,
      agreement?.selected_template?.project_subtype,
      assistantDraftPayload?.project_family_label,
      assistantTopTemplatePreview?.project_subtype,
      dLocal?.description,
      dLocal?.project_family_label,
      dLocal?.project_subtype,
      dLocal?.project_title,
      dLocal?.project_type,
      dLocal?.selected_template?.project_subtype,
      selectedTemplate?.project_subtype,
      step1JobDescriptionPrompt,
    ]
  );
  const clarificationQuestions = useMemo(
    () => getProjectClarificationQuestions(clarificationContext),
    [clarificationContext]
  );
  const agreementClarificationAnswers = useMemo(
    () => pickClarificationAnswers(clarificationQuestions, agreement?.ai_scope?.answers || {}),
    [clarificationQuestions, agreement?.ai_scope?.answers]
  );
  useEffect(() => {
    setClarificationAnswers(agreementClarificationAnswers);
    setClarificationsSkipped(false);
  }, [agreementClarificationAnswers, clarificationContext.projectSubtype]);
  const clarificationSummaryLines = useMemo(
    () => buildClarificationNotes(clarificationQuestions, clarificationAnswers),
    [clarificationQuestions, clarificationAnswers]
  );
  const aiRecommendedTemplate = useMemo(() => {
    const assistantTop = Array.isArray(assistantTemplateRecommendations)
      ? assistantTemplateRecommendations[0]
      : null;
    if (assistantTop?.id) return assistantTop;
    if (
      recommendedTemplateId &&
      selectedTemplate &&
      String(selectedTemplate.id) === String(recommendedTemplateId)
    ) {
      return selectedTemplate;
    }
    return (
      (filteredTemplates || []).find(
        (tpl) => String(tpl?.id || "") === String(recommendedTemplateId || "")
      ) || null
    );
  }, [
    assistantTemplateRecommendations,
    filteredTemplates,
    recommendedTemplateId,
    selectedTemplate,
  ]);
  const aiCompactRecommendationConfidence = normalizeTemplateConfidenceLevel(
    recommendationConfidence || "low"
  );
  const isNoTemplateFlow =
    aiSetupResult?.kind === "no_template" || aiSetupResult?.kind === "fallback_recommendation";
  const shouldShowCompactTemplateRecommendation =
    startMode === "ai" &&
    !appliedTemplateId &&
    !dismissedAiTemplateRecommendation &&
    !aiSetupResult &&
    Boolean(aiRecommendedTemplate?.id) &&
    aiCompactRecommendationConfidence !== "low";
  const shouldShowAppliedTemplateSummary =
    startMode !== "template" && Boolean(appliedTemplateId);

  async function handleUseAiRecommendedTemplate() {
    if (!aiRecommendedTemplate) return;
    await handleTemplateApplyWithOptions(aiRecommendedTemplate);
  }

  function applyRefinedDescription(refinedDescription) {
    const nextDescription = safeTrim(refinedDescription);
    if (!nextDescription) return;

    setDLocal((prev) => ({ ...prev, description: nextDescription }));
    if (!isNewAgreement) {
      writeCache({ description: nextDescription });
    }
    if (agreementId) {
      patchAgreement(
        {
          description: nextDescription,
          scope_of_work: nextDescription,
          step_status: "step1",
        },
        { silent: true }
      );
    }
  }

  function applyAiSetupFields(aiData = {}) {
    const refinedDescription = safeTrim(aiData?.description || aiData?.normalized_description || "");
    const rawProjectTitle = safeTrim(
      aiData?.project_title ?? aiData?.title ?? aiData?.projectTitle ?? ""
    );
    const rawProjectType = safeTrim(aiData?.project_type ?? aiData?.projectType ?? "");
    const rawProjectSubtype = safeTrim(
      aiData?.project_subtype ?? aiData?.projectSubtype ?? ""
    );
    const sourceText = [
      rawProjectTitle,
      rawProjectType,
      rawProjectSubtype,
      refinedDescription,
    ]
      .filter(Boolean)
      .join(" ");
    const classificationText = [rawProjectTitle, refinedDescription].filter(Boolean).join(" ");
    const dominantCategory = inferDominantProjectCategory(classificationText);
    const specificLimitedScopeSubtype = inferSpecificLimitedScopeSubtype(
      classificationText,
      projectSubtypeOptions
    );
    const preferredTypeHint = dominantCategory.category || rawProjectType;
    const preferredSubtypeHint = dominantCategory.subtype || rawProjectSubtype;
    const dominantTypeOption = dominantCategory.category
      ? resolveOptionFromRawValue(dominantCategory.category, projectTypeOptions)
      : null;
    const dominantSubtypeOption = dominantCategory.subtype
      ? resolveOptionFromRawValue(dominantCategory.subtype, projectSubtypeOptions)
      : null;
    const dominantSubtypeParentType = dominantSubtypeOption?.project_type
      ? resolveOptionFromRawValue(dominantSubtypeOption.project_type, projectTypeOptions)
      : null;

    const matchedType =
      dominantSubtypeParentType ||
      resolveBestTypeOption({
        rawType: preferredTypeHint,
        rawSubtype: preferredSubtypeHint,
        sourceText,
        projectTypeOptions,
      }) ||
      dominantTypeOption;
    const subtypeTypeConstraint =
      dominantCategory.subtype && !dominantCategory.category ? null : matchedType;
    const matchedSubtype =
      specificLimitedScopeSubtype ||
      dominantSubtypeOption ||
      resolveBestSubtypeOption({
        rawSubtype: preferredSubtypeHint,
        rawType: preferredTypeHint,
        sourceText,
        matchedType: subtypeTypeConstraint,
        projectSubtypeOptions,
      });
    const matchedSubtypeParentType = matchedSubtype?.project_type
      ? resolveOptionFromRawValue(matchedSubtype.project_type, projectTypeOptions)
      : null;
    const resolvedType = matchedSubtypeParentType || matchedType || null;

    const generatedType =
      optionCanonicalValue(resolvedType) ||
      dominantCategory.category ||
      buildGeneratedProjectTitle(sourceText).split(/\s+/).slice(0, 2).join(" ") ||
      "Custom Project";

    const generatedSubtype =
      optionCanonicalValue(matchedSubtype) ||
      dominantCategory.subtype ||
      (rawProjectSubtype && !extractNumericIdCandidate(rawProjectSubtype) ? rawProjectSubtype : "") ||
      buildGeneratedProjectTitle(sourceText);

    const generatedTitle =
      buildProjectFriendlyTitle({
        subtype: generatedSubtype,
        category: generatedType,
        rawTitle: rawProjectTitle,
        sourceText,
      }) || "Custom Project";

    const nextValues = {
      project_title: generatedTitle,
      project_type: generatedType,
      project_subtype: generatedSubtype,
    };

    const changedKeys = Object.entries(nextValues)
      .filter(([key, value]) => safeTrim(value) && safeTrim(dLocal?.[key]) !== safeTrim(value))
      .map(([key]) => key);

    if (!changedKeys.length) {
      return { changedKeys, nextValues };
    }

    const projectTypeRef = resolvedType?.id || null;
    const projectSubtypeRef = matchedSubtype?.id || null;
    const usedFallbackCreation = Boolean(
      (generatedType && !resolvedType) || (generatedSubtype && !matchedSubtype)
    );

    console.info("[Step1 AI setup taxonomy]", {
      classificationReasoning: dominantCategory.reasoning,
      dominantCategory: dominantCategory.category,
      dominantSubtype: dominantCategory.subtype,
      rawProjectType,
      matchedProjectType: optionCanonicalValue(resolvedType),
      rawProjectSubtype,
      matchedProjectSubtype: optionCanonicalValue(matchedSubtype),
      usedFallbackCreation,
    });

    setAiSuggestedFieldMeta({
      project_title: { isNew: false },
      project_type: { isNew: Boolean(generatedType && !resolvedType) },
      project_subtype: { isNew: Boolean(generatedSubtype && !matchedSubtype) },
    });

    setDLocal((prev) => ({
      ...prev,
      ...nextValues,
    }));

    if (!isNewAgreement) {
      writeCache(nextValues);
    }

    if (agreementId) {
      patchAgreement(
        {
          project_title: generatedTitle,
          title: generatedTitle,
          project_type: generatedType,
          project_type_ref: projectTypeRef,
          project_subtype: generatedSubtype,
          project_subtype_ref: projectSubtypeRef,
          scope_of_work: refinedDescription || dLocal?.description || "",
          step_status: "step1",
        },
        { silent: true }
      );
    }

    return { changedKeys, nextValues };
  }

  function buildFallbackAiSetupResult({
    refinedDescription,
    suggestedSetupValues,
    setupFieldKeys,
    recommendationReason,
    message,
  }) {
    const nextTitle = safeTrim(
      suggestedSetupValues?.project_title ||
        dLocal?.project_title ||
        buildProjectFriendlyTitle({
          subtype: suggestedSetupValues?.project_subtype || dLocal?.project_subtype || "",
          category: suggestedSetupValues?.project_type || dLocal?.project_type || "",
          rawTitle: dLocal?.project_title || "",
          sourceText: refinedDescription || dLocal?.description || step1JobDescriptionPrompt || "",
        }) ||
        ""
    );

    return {
      kind: "no_template",
      confidenceLevel: "medium",
      refinedDescription,
      message:
        message ||
        "No template found — let’s build this together. We’ll generate a custom agreement based on your description.",
      recommendationReason:
        recommendationReason || "No template found — let’s build this together.",
      recommendedTemplate: null,
      suggestedTitle: nextTitle || "Recommended starting point",
      suggestedProjectType: safeTrim(suggestedSetupValues?.project_type || dLocal?.project_type || ""),
      suggestedProjectSubtype: safeTrim(
        suggestedSetupValues?.project_subtype || dLocal?.project_subtype || ""
      ),
      setupFieldKeys: Array.isArray(setupFieldKeys) ? setupFieldKeys : [],
      recommendationSource: "fallback",
      fallbackLabel: "No template found — let’s build this together",
    };
  }

  async function runAiRefineAndSetup(promptText) {
    const roughDescription = safeTrim(promptText);
    if (!roughDescription) return;

    setAiSetupBusy(true);
    setAiSetupError("");
    setAiSetupResult(null);
    setDismissedAiTemplateRecommendation(false);

    let refinedDescription = "";
    let setupFieldKeys = [];
    let suggestedSetupValues = null;
    let recommendationData = null;

    try {
      const clarificationContext = buildDescriptionRequestContext(
        roughDescription,
        clarificationSummaryLines
      );
      const refinePayload = {
        mode: "generate",
        agreement_id: agreementId || null,
        project_title: dLocal.project_title || "",
        project_type: dLocal.project_type || "",
        project_subtype: dLocal.project_subtype || "",
        project_family_key: resolvedProjectFamily.project_family_key || "",
        project_family_label: resolvedProjectFamily.project_family_label || "",
        current_description: clarificationContext,
      };

      const refineRes = await api.post(`/projects/agreements/ai/description/`, refinePayload);
      refinedDescription = safeTrim(refineRes?.data?.description || "");

      if (!refinedDescription) {
        throw new Error("AI returned an empty description.");
      }

      applyRefinedDescription(refinedDescription);
      const aiSetupFields = applyAiSetupFields(refineRes?.data || {});
      setupFieldKeys = aiSetupFields.changedKeys;
      suggestedSetupValues = aiSetupFields.nextValues;

      const recommendRes = await api.post("/projects/templates/recommend/", {
        project_title: suggestedSetupValues?.project_title || dLocal.project_title || "",
        project_type: suggestedSetupValues?.project_type || dLocal.project_type || "",
        project_subtype:
          suggestedSetupValues?.project_subtype || dLocal.project_subtype || "",
        project_family_key: resolvedProjectFamily.project_family_key || "",
        project_family_label: resolvedProjectFamily.project_family_label || "",
        description: refinedDescription,
      });

      recommendationData = recommendRes?.data || {};
      const resolvedProjectType = safeTrim(
        suggestedSetupValues?.project_type || dLocal.project_type || ""
      );
      const resolvedProjectSubtype = safeTrim(
        suggestedSetupValues?.project_subtype || dLocal.project_subtype || ""
      );
      const recommendationCandidates = Array.isArray(recommendationData?.candidates)
        ? recommendationData.candidates
        : Array.isArray(recommendationData?.results)
        ? recommendationData.results
        : [];
      const recommendedTemplate =
        recommendationData?.recommended_template ||
        recommendationData?.possible_match ||
        recommendationCandidates[0] ||
        null;
      const confidenceLevel = normalizeTemplateConfidenceLevel(
        recommendationData?.confidence_level || recommendationData?.confidence || "low"
      );
      const score = Number(
        recommendationData?.score ??
          recommendedTemplate?.score ??
          recommendedTemplate?.rank_score ??
          0
      );
      const exactTypeMatch =
        safeTrim(recommendedTemplate?.project_type).toLowerCase() ===
          resolvedProjectType.toLowerCase() && resolvedProjectType;
      const exactSubtypeMatch =
        safeTrim(recommendedTemplate?.project_subtype).toLowerCase() ===
          resolvedProjectSubtype.toLowerCase() && resolvedProjectSubtype;
      const strongMatch =
        Boolean(recommendedTemplate?.id) &&
        (confidenceLevel === "high" || score >= 70 || (exactTypeMatch && exactSubtypeMatch));
      const optionalMatch =
        Boolean(recommendedTemplate?.id) &&
        !strongMatch &&
        (confidenceLevel === "medium" || score >= 50 || exactTypeMatch);
      const recommendationReason =
        safeTrim(recommendationData?.reason) ||
        (exactTypeMatch && exactSubtypeMatch
          ? "Matches the project type and subtype you selected."
          : exactTypeMatch
          ? resolvedProjectFamily.project_family_label
            ? `Matches the project type you selected and stays aligned with ${resolvedProjectFamily.project_family_label}.`
            : "Matches the project type you selected."
          : "This template closely matches the job details you provided.");

      if (strongMatch) {
        setAiSetupResult({
          kind: "template_match",
          confidenceLevel: "high",
          refinedDescription,
          recommendedTemplate,
          reason: recommendationReason,
          setupFieldKeys,
        });
        if (recommendedTemplate?.id) {
          setSelectedTemplateId(String(recommendedTemplate.id));
          setTemplateSearch(recommendedTemplate.name || "");
        }
        queueProjectDetailsReview(["description", ...setupFieldKeys]);
      } else if (optionalMatch) {
        setAiSetupResult({
          kind: "template_match",
          confidenceLevel: "medium",
          refinedDescription,
          recommendedTemplate,
          reason: recommendationReason,
          setupFieldKeys,
        });
        if (recommendedTemplate?.id) {
          setSelectedTemplateId(String(recommendedTemplate.id));
          setTemplateSearch(recommendedTemplate.name || "");
        }
        queueProjectDetailsReview(["description", ...setupFieldKeys]);
      } else {
        setAiSetupResult(
          buildFallbackAiSetupResult({
            refinedDescription,
            suggestedSetupValues,
            setupFieldKeys,
            recommendationReason,
            message: recommendationData?.detail
              ? `Recommended from your description. ${recommendationData.detail}`
              : "Recommended from your description. Review the suggested starting point before you continue.",
          })
        );
        setSelectedTemplateId(null);
        queueProjectDetailsReview(["description", ...setupFieldKeys]);
      }
    } catch (e) {
      if (refinedDescription || safeTrim(roughDescription)) {
        setAiSetupResult(
          buildFallbackAiSetupResult({
            refinedDescription: refinedDescription || roughDescription,
            suggestedSetupValues,
            setupFieldKeys,
            recommendationReason: "Recommended from your description.",
            message:
              "Recommended from your description. AI fallback was used because the matching service was unavailable.",
          })
        );
        setSelectedTemplateId(null);
        queueProjectDetailsReview(["description", ...setupFieldKeys]);
        return;
      }

      setAiSetupError(
        e?.response?.data?.detail || e?.message || "Could not refine and set up this agreement."
      );
    } finally {
      setAiSetupBusy(false);
    }
  }

  async function handleUseAiDescriptionOnly() {
    if (!aiSetupResult?.refinedDescription) return;
    applyRefinedDescription(aiSetupResult.refinedDescription);
    setAiSetupResult({
      kind: "description_only",
      refinedDescription: aiSetupResult.refinedDescription,
      message:
        "Agreement draft created. Review the highlighted sections below.",
      setupFieldKeys: Array.isArray(aiSetupResult?.setupFieldKeys)
        ? aiSetupResult.setupFieldKeys
        : [],
    });
    setDismissedAiTemplateRecommendation(true);
  }

  async function handleResetStep1Setup() {
    if (locked || !agreementId) return;

    try {
      const { data } = await api.post(`/projects/agreements/${agreementId}/reset-step1/`);
      const nextAgreement = data?.agreement || null;

      setDLocal((prev) => ({
        ...prev,
        project_title: safeTrim(nextAgreement?.project_title ?? nextAgreement?.title ?? ""),
        project_type: nextAgreement?.project_type ?? "",
        project_subtype: nextAgreement?.project_subtype ?? "",
        description: nextAgreement?.description ?? "",
        step_status: nextAgreement?.step_status ?? "",
        homeowner:
          nextAgreement?.homeowner != null && nextAgreement?.homeowner !== ""
            ? String(nextAgreement.homeowner)
            : "",
        selected_template: null,
        selected_template_id: null,
        selected_template_name_snapshot: "",
        project_template_id: null,
        template_id: null,
        agreement_mode: nextAgreement?.agreement_mode ?? "standard",
        recurring_service_enabled: false,
        recurrence_pattern: "",
        recurrence_interval: "1",
        recurrence_start_date: "",
        recurrence_end_date: "",
        next_occurrence_date: "",
        maintenance_status: "active",
        auto_generate_next_occurrence: false,
        service_window_notes: "",
        recurring_summary_label: "",
        payment_structure:
          normalizePaymentStructure(nextAgreement?.payment_structure) || "simple",
        retainage_percent:
          nextAgreement?.retainage_percent != null
            ? String(nextAgreement.retainage_percent)
            : "0.00",
        address_line1: "",
        address_line2: "",
        address_city: "",
        address_state: "",
        address_postal_code: "",
      }));

      setSelectedTemplateId(null);
      setTemplateSearch("");
      setAiPreview("");
      setAiErr("");
      setAiMilestonePreview("");
      setAddrSearch("");
      setSelectedCustomer(null);
      setCustomerAddrMissing(null);
      setShowQuickAdd(false);
      setShowResetStep1Confirm(false);
      clearStep1SessionState();
      setStartMode("manual");
      setStartModeCommitted(false);
      setStartModeSource("session");

      toast.success("Form reset. Choose how you want to start again.");

      if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }
    } catch (e) {
      toast.error(formatApiError(e, "Could not reset this draft."));
    }
  }

  async function handleUpdateTemplateDays(templateId, payload = {}) {
    if (locked) return;
    if (!templateId) return;

    const parsedDays = Number(payload?.estimated_days || 0);
    if (!parsedDays || parsedDays < 1) {
      toast.error("Estimated days must be at least 1.");
      return;
    }

    try {
      await api.patch(`/projects/templates/${templateId}/`, {
        estimated_days: parsedDays,
      });

      toast.success("Template duration updated.");

      if (typeof refreshAgreement === "function") {
        await refreshAgreement();
      }

      if (typeof handleTemplatePick === "function" && selectedTemplate) {
        const nextSelected =
          String(selectedTemplate?.id || "") === String(templateId)
            ? { ...selectedTemplate, estimated_days: parsedDays }
            : selectedTemplate;

        handleTemplatePick(nextSelected);
      }
    } catch (e) {
      const msg =
        e?.response?.data?.detail ||
        e?.response?.data?.error ||
        "Could not update template duration.";
      toast.error(msg);
    }
  }

  const goNextNoSave = () => {
    if (!agreementId) return;
    navigate(`${BASE}/agreements/${agreementId}/wizard?step=2`);
  };

  const defaultTemplateName = useMemo(() => {
    const parts = [
      safeTrim(dLocal?.project_type),
      safeTrim(dLocal?.project_subtype),
      safeTrim(dLocal?.project_title),
    ].filter(Boolean);

    return parts.length ? parts.join(" – ") : "My New Template";
  }, [dLocal?.project_type, dLocal?.project_subtype, dLocal?.project_title]);

  const handleCreateNewType = () => {
    if (locked) return;
    toast("New Type modal/form is the next step to wire.");
  };

  const handleCreateNewSubtype = () => {
    if (locked) return;
    if (!safeTrim(dLocal?.project_type)) {
      toast("Select a Type first.");
      return;
    }
    toast(
      `New Subtype flow for "${safeTrim(dLocal?.project_type)}" is the next step to wire.`
    );
  };

  const handleClarificationAnswerChange = (questionKey, nextValue) => {
    if (locked || !agreementId || !questionKey) return;

    const normalizedValue = safeTrim(nextValue);
    const nextAnswers = normalizedValue
      ? { ...clarificationAnswers, [questionKey]: normalizedValue }
      : Object.fromEntries(
          Object.entries(clarificationAnswers).filter(([key]) => key !== questionKey)
        );

    setClarificationAnswers(nextAnswers);
    setClarificationsSkipped(false);
    schedulePatch({ scope_clarifications: nextAnswers }, 300);
  };

  const handleSkipClarifications = () => {
    setClarificationsSkipped(true);
  };

  const handleStep1LocalChange = async (e) => {
    if (locked) return;

    const name = e?.target?.name;
    const value = e?.target?.value;

    if (name === "project_title" || name === "project_type" || name === "project_subtype") {
      setAiSuggestedFieldMeta((prev) => {
        if (!prev?.[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }

    onLocalChange?.(e);

    if (!agreementId || !name) return;

    if (name === "project_title") {
      schedulePatch(
        {
          project_title: value || "",
          title: value || "",
        },
        450
      );
      return;
    }

    if (name === "project_type") {
      const pickedType =
        (projectTypeOptions || []).find(
          (opt) => safeTrim(opt?.value) === safeTrim(value)
        ) || null;

      schedulePatch(
        {
          project_type: value || "",
          project_type_ref: pickedType?.id || null,
          project_subtype: "",
          project_subtype_ref: null,
        },
        250
      );
      return;
    }

    if (name === "project_subtype") {
      const pickedSubtype =
        (projectSubtypeOptions || []).find(
          (opt) => safeTrim(opt?.value) === safeTrim(value)
        ) || null;

      schedulePatch(
        {
          project_subtype: value || "",
          project_subtype_ref: pickedSubtype?.id || null,
          ...(pickedSubtype?.project_type && !safeTrim(dLocal?.project_type)
            ? { project_type: pickedSubtype.project_type }
            : {}),
          ...(pickedSubtype?.project_type && !selectedProjectType?.id
            ? {
                project_type_ref:
                  (projectTypeOptions || []).find(
                    (opt) =>
                      safeTrim(opt?.value) === safeTrim(pickedSubtype.project_type)
                  )?.id || null,
              }
            : {}),
        },
        250
      );
      return;
    }

    if (name === "description") {
      schedulePatch({ description: value || "", scope_of_work: value || "", step_status: "step1" }, 450);
      return;
    }

    if (name === "pricing_strategy") {
      const normalized = normalizePricingStrategy(value);
      schedulePatch({ pricing_strategy: normalized, step_status: "step1" }, 250);
      return;
    }
  };

  const activeStartModeLabel =
    startMode === "ai" && aiSetupResult?.kind === "description_only"
      ? "AI-built starting point"
      : startMode === "ai"
      ? "AI-assisted start"
      : startMode === "template"
      ? "Recommended starting point"
      : "Agreement draft in progress";
  const activeStartModeSummary =
    startMode === "ai" && aiSetupResult?.kind === "description_only"
      ? "AI built a starting point from your description. Review the agreement details below."
      : startMode === "ai"
      ? "Describe the job first, then review the agreement details AI prepares below."
      : startMode === "template"
      ? "Use a matching starting point, then review and edit the agreement details below."
      : "Review the agreement details below and keep editing.";
  const canResetStep1 =
    Boolean(agreementId) &&
    !locked &&
    String(agreement?.status || "").toLowerCase() === "draft";
  const hasResettableStep1State =
    Boolean(appliedTemplateId) ||
    Boolean(safeTrim(dLocal?.project_title)) ||
    Boolean(safeTrim(dLocal?.project_type)) ||
    Boolean(safeTrim(dLocal?.project_subtype)) ||
    Boolean(safeTrim(dLocal?.description)) ||
    Boolean(dLocal?.homeowner) ||
    Boolean(safeTrim(dLocal?.address_line1)) ||
    Boolean(safeTrim(dLocal?.address_city)) ||
    paymentStructure !== "simple" ||
    safeTrim(dLocal?.agreement_mode) === "maintenance";
  const shouldDeemphasizeManualReview = startModeCommitted && startMode !== "manual";
  const supportSectionClass = shouldDeemphasizeManualReview
    ? "border-slate-200 bg-slate-50/40 shadow-none"
    : "";
  const projectDetailsDescription =
    startMode === "ai" && aiSetupResult?.kind === "description_only"
      ? "AI built a starting point from your description. Review and edit the agreement details here."
      : startMode === "ai"
      ? "Describe the job first, then review and edit the agreement details here."
      : startMode === "template"
      ? "Confirm the recommended starting point here so the agreement matches this specific project."
      : "Review the agreement details below and keep editing.";
  const shouldShowProjectDetails = true;
  const showStep1Clarifications = false;
  useEffect(() => {
    if (shouldShowProjectDetails) return;
    projectDetailsAutoScrolledRef.current = false;
    projectDetailsUserScrolledRef.current = false;
  }, [shouldShowProjectDetails]);
  const isStartingPointLoading = Boolean(aiSetupBusy);
  const isStartingPointError = Boolean(aiSetupError);
  const startingPointStatusTitle =
    startMode === "ai"
      ? "Building agreement draft..."
      : startMode === "template"
      ? "Finding best starting point..."
      : "Preparing agreement draft...";
  const startingPointStatusMessage =
    startMode === "ai"
      ? "AI is reviewing the job description and preparing project details."
      : "AI is checking templates and preparing the next steps for this job.";
  const startingPointChecklist = [
    "Understanding the job",
    "Checking matching templates",
    "Preparing project details",
  ];

  useEffect(() => {
    if (!projectDetailsRevealMountedRef.current) {
      projectDetailsRevealMountedRef.current = true;
      projectDetailsRevealSeenRef.current = shouldShowProjectDetails;
      return;
    }

    if (shouldShowProjectDetails) {
      if (!projectDetailsRevealSeenRef.current) {
        projectDetailsRevealSeenRef.current = true;
        queueProjectDetailsReview(["project_title", "project_type", "project_subtype", "description"]);
      }
      return;
    }

    projectDetailsRevealSeenRef.current = false;
  }, [shouldShowProjectDetails, selectedTemplateId, appliedTemplateId, aiSetupResult?.kind]);

  return (
    <>
      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm text-gray-600">
          {isEdit ? <>Agreement #{agreementId}</> : <>New Agreement</>}
        </div>

        {locked ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-semibold">Locked</div>
            <div className="mt-1 text-xs text-amber-900/90">
              This agreement is signed/executed. Step 1–3 are read-only. Create an
              amendment to change details.
            </div>
          </div>
        ) : null}

        {complianceWarning?.warning_level && complianceWarning.warning_level !== "none" ? (
          <div
            data-testid="agreement-compliance-warning"
            className={`mb-3 rounded-md border px-4 py-3 text-sm ${
              complianceWarning.warning_level === "critical"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : complianceWarning.warning_level === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-sky-200 bg-sky-50 text-sky-900"
            }`}
          >
            <div className="font-semibold">Compliance note</div>
            <div className="mt-1">
              {complianceWarning.message || "This work may require a license in the project state."}
            </div>
            {complianceWarning.official_lookup_url ? (
              <a
                href={complianceWarning.official_lookup_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-semibold underline"
              >
                View official source
              </a>
            ) : null}
          </div>
        ) : null}

        {assistantGuidedFlow?.guided_question ? (
          <div
            data-testid="assistant-guided-step1"
            className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
          >
            <div className="font-semibold">Guided next step</div>
            <div className="mt-1">{assistantGuidedFlow.guided_question}</div>
            {assistantGuidedFlow.why_this_matters ? (
              <div className="mt-1 text-xs text-indigo-800/90">
                {assistantGuidedFlow.why_this_matters}
              </div>
            ) : null}
          </div>
        ) : null}

        {startMode === "ai" &&
        assistantTemplateRecommendations.length &&
        !isNoTemplateFlow &&
        !shouldShowCompactTemplateRecommendation ? (
          <div
            data-testid="assistant-template-preview-step1"
            className={`mb-3 rounded-md border px-4 py-3 text-sm ${
              aiCompactRecommendationConfidence === "medium"
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-sky-200 bg-sky-50 text-sky-900"
            }`}
          >
            <div className="font-semibold">
              {aiCompactRecommendationConfidence === "medium"
                ? "Optional template match"
                : "Recommended template"}
            </div>
            <div className="mt-1">{assistantTemplateRecommendations[0]?.name}</div>
            {assistantTemplateRecommendations[0]?.rank_reasons?.length ? (
              <div className={`mt-1 text-xs ${aiCompactRecommendationConfidence === "medium" ? "text-amber-800/90" : "text-sky-800/90"}`}>
                {assistantTemplateRecommendations[0].rank_reasons.slice(0, 2).join(" • ")}
              </div>
            ) : null}
            {assistantTopTemplatePreview?.milestone_count ? (
              <div className={`mt-1 text-xs ${aiCompactRecommendationConfidence === "medium" ? "text-amber-800/90" : "text-sky-800/90"}`}>
                Includes {assistantTopTemplatePreview.milestone_count} default milestone
                {assistantTopTemplatePreview.milestone_count === 1 ? "" : "s"}.
              </div>
            ) : null}
          </div>
        ) : null}

        {assistantProactiveRecommendations.length ? (
          <div
            data-testid="assistant-proactive-step1"
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          >
            <div className="font-semibold">Proactive recommendations</div>
            <div className="mt-2 space-y-2">
              {assistantProactiveRecommendations.slice(0, 2).map((item) => (
                <div key={`${item.recommendation_type}-${item.title}`}>
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-amber-800/90">{item.message}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {assistantPredictiveInsights.length ? (
          <div
            data-testid="assistant-predictive-step1"
            className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
          >
            <div className="font-semibold">Predictive insight</div>
            <div className="mt-1">{assistantPredictiveInsights[0]?.title}</div>
            <div className="mt-1 text-xs text-slate-700">
              {assistantPredictiveInsights[0]?.summary}
            </div>
          </div>
        ) : null}

        {assistantConfirmationRequiredActions.length ? (
          <div
            data-testid="assistant-confirmation-step1"
            className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
          >
            <div className="font-semibold">Actions requiring confirmation</div>
            <div className="mt-1 text-xs text-rose-800/90">
              {assistantConfirmationRequiredActions[0]?.action_label ||
                assistantProposedActions[0]?.action_label ||
                "Review AI-prepared changes before saving them."}
            </div>
          </div>
        ) : null}

        {last400 ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
            <div className="text-sm font-semibold text-red-700">
              Server response (400)
            </div>
            <PrettyJson data={last400} />
          </div>
        ) : null}

        <section className="min-h-[180px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {startModeCommitted ? (
            <div
              data-testid="step1-start-mode-summary"
              className={`rounded-2xl border px-4 py-4 ${
                startMode === "ai"
                  ? "border-indigo-200 bg-indigo-50/70"
                  : startMode === "template"
                  ? "border-sky-200 bg-sky-50/70"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              {isStartingPointLoading ? (
                <div
                  data-testid="step1-starting-point-loading-card"
                  aria-live="polite"
                  className="rounded-2xl border border-indigo-200 bg-white px-4 py-4 shadow-sm"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">
                    Just a moment...
                  </div>
                  <div className="mt-2 text-base font-semibold text-slate-900">
                    {startingPointStatusTitle}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{startingPointStatusMessage}</div>
                  <ul className="mt-3 space-y-1 text-sm text-slate-700">
                    {startingPointChecklist.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <span className="mt-1 inline-block h-2 w-2 rounded-full bg-indigo-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : isStartingPointError ? (
                <div
                  data-testid="step1-starting-point-error-card"
                  aria-live="polite"
                  className="rounded-2xl border border-rose-200 bg-white px-4 py-4 shadow-sm"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-700">
                    Couldn’t finish this step
                  </div>
                  <div className="mt-2 text-base font-semibold text-slate-900">
                    AI couldn’t finish this step. Your description is still saved.
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    You can try again or continue manually without losing the work you already
                    entered.
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="step1-starting-point-retry-button"
                      onClick={() => requestStep1AiSetup(lastAiSetupPrompt || step1JobDescriptionPrompt)}
                      disabled={locked || !safeTrim(lastAiSetupPrompt || step1JobDescriptionPrompt)}
                      className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      Try Again
                    </button>
                    <button
                      type="button"
                      data-testid="step1-starting-point-build-without-template-button"
                      onClick={handleBuildAgreementWithoutTemplate}
                      disabled={locked}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Build Without Template
                    </button>
                  </div>
                </div>
              ) : aiSetupResult?.kind === "template_match" ? (
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="max-w-3xl">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                      Template match found
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      We found a saved template that may fit this job.
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      You can use it as a starting point or continue building manually.
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="step1-use-template-button"
                        onClick={() => handleTemplateApplyWithOptions(aiSetupResult.recommendedTemplate)}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        Use Template
                      </button>
                      <button
                        type="button"
                        data-testid="step1-build-with-ai-instead-button"
                        onClick={handleUseAiDescriptionOnly}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Build with AI instead
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canResetStep1 && hasResettableStep1State ? (
                      <button
                        type="button"
                        data-testid="step1-reset-form-button"
                        onClick={() => setShowResetStep1Confirm(true)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Reset form
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : aiSetupResult?.kind === "no_template" || aiSetupResult?.kind === "fallback_recommendation" ? (
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="max-w-3xl">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                      No template found — let&apos;s build this agreement with AI
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      We couldn&apos;t find a saved template that matches this job.
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      We&apos;ll generate a custom agreement based on your description.
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="step1-review-project-details-jump"
                        onClick={() => scrollToProjectDetails({ allowAutoScroll: false })}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                      >
                        Review Project Details
                      </button>
                      <button
                        type="button"
                        data-testid="step1-change-description-button"
                        onClick={() => {
                          reopenStartModeChooser();
                          scrollToStartModeChooser();
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Change description
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canResetStep1 && hasResettableStep1State ? (
                      <button
                        type="button"
                        data-testid="step1-reset-form-button"
                        onClick={() => setShowResetStep1Confirm(true)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Reset form
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : aiSetupResult?.kind === "description_only" ? null : (
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Mode
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {activeStartModeLabel}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{activeStartModeSummary}</div>
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
                        <div className="text-sm font-semibold text-slate-900">
                          Review Project Details
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          We’ve created a starting point. Jump to the editable details when you’re
                          ready.
                        </div>
                        <button
                          type="button"
                          data-testid="step1-review-project-details-jump"
                          onClick={() => scrollToProjectDetails({ allowAutoScroll: false })}
                          className="mt-3 inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Review Project Details
                        </button>
                      </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canResetStep1 && hasResettableStep1State ? (
                      <button
                        type="button"
                        data-testid="step1-reset-form-button"
                        onClick={() => setShowResetStep1Confirm(true)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Reset form
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid="step1-change-start-mode"
                      onClick={reopenStartModeChooser}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Change start mode
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div data-testid="step1-start-mode-chooser" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Describe the job</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    AI will recommend a matching template or help build the agreement.
                  </p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Step 1 setup
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-900">
                    Job description
                  </label>
                  <input
                    value={step1JobDescriptionPrompt}
                    onChange={(e) => setStep1JobDescriptionPrompt(e.target.value)}
                    placeholder="Example: Replace exterior siding on a single-story home..."
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    data-testid="step1-job-description-input"
                    disabled={locked}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const prompt = safeTrim(step1JobDescriptionPrompt);
                    if (!prompt) return;
                    activateStartMode("template", { committed: true, source: "assistant" });
                    requestStep1AiSetup(prompt);
                  }}
                  disabled={locked || aiSetupBusy || !safeTrim(step1JobDescriptionPrompt)}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                  data-testid="step1-find-best-starting-point-button"
                >
                  {aiSetupBusy && startMode === "template"
                    ? "Finding best starting point..."
                    : "Find Best Starting Point"}
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep1ManualBrowseSignal((prev) => prev + 1);
                    activateStartMode("template", { committed: true, source: "user" });
                  }}
                  className="text-xs font-semibold text-slate-700 hover:underline"
                >
                  Browse templates manually
                </button>
              </div>
            </div>
          )}
        </section>

        {showResetStep1Confirm && canResetStep1 ? (
          <div
            data-testid="step1-reset-form-confirm"
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900"
          >
            <div className="font-semibold">Start over?</div>
            <div className="mt-1 text-sm text-rose-900/90">
              This will clear your current setup so you can begin again.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="step1-reset-form-confirm-button"
                onClick={handleResetStep1Setup}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Reset
              </button>
              <button
                type="button"
                data-testid="step1-reset-form-cancel-button"
                onClick={() => setShowResetStep1Confirm(false)}
                className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-100"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {startMode === "ai" && aiSetupResult?.kind === "template_match" ? (
          <section
            data-testid="step1-ai-setup-result"
            className={`rounded-2xl border p-5 shadow-sm ${
              aiSetupResult?.confidenceLevel === "medium"
                ? "border-amber-200 bg-amber-50/80"
                : "border-indigo-200 bg-indigo-50/70"
            }`}
          >
            <div
              className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${
                aiSetupResult?.confidenceLevel === "medium"
                  ? "text-amber-700"
                  : "text-indigo-700"
              }`}
            >
              {aiSetupResult?.confidenceLevel === "medium"
                ? "Optional template match"
                : "Template recommendation"}
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900">
              {aiSetupResult.recommendedTemplate?.name ||
                (aiSetupResult?.confidenceLevel === "medium"
                  ? "Optional template match"
                  : "Recommended template")}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              {aiSetupResult?.confidenceLevel === "medium"
                ? "We refined the description and found a template that could fit this project. Review it before you decide."
                : "We refined the description first and found a strong template match for this setup."}
            </div>
            <div className="mt-2 rounded-xl border border-white/80 bg-white/80 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Refined description
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {aiSetupResult.refinedDescription}
              </div>
            </div>
            <div className="mt-3 text-sm text-slate-700">
              {aiSetupResult.reason}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              {aiSetupResult?.confidenceLevel === "medium"
                ? "You can use this template if it fits, or continue with the refined description only. The Project Details section below stays editable either way."
                : "The Project Details section below stays editable after you choose how to continue."}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="step1-ai-setup-apply-template"
                onClick={() => handleTemplateApplyWithOptions(aiSetupResult.recommendedTemplate)}
                disabled={
                  locked ||
                  !agreementId ||
                  applyingTemplateId === aiSetupResult.recommendedTemplate?.id
                }
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {applyingTemplateId === aiSetupResult.recommendedTemplate?.id
                  ? "Applying..."
                  : "Apply Template"}
              </button>
              <button
                type="button"
                data-testid="step1-ai-setup-description-only"
                onClick={handleUseAiDescriptionOnly}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Use Description Only
              </button>
            </div>
          </section>
        ) : null}

        {startMode === "ai" &&
        (aiSetupResult?.kind === "fallback_recommendation" || aiSetupResult?.kind === "no_template") ? (
          <section
            data-testid="step1-ai-setup-result"
            className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 shadow-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
              No template found — let&apos;s build this together
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900">
              {aiSetupResult.suggestedTitle || "Recommended starting point"}
            </div>
            <div className="mt-1 text-sm text-slate-700">
              {aiSetupResult.message ||
                "We used your description to build a usable starting point."}
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-sky-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Suggested title
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {aiSetupResult.suggestedTitle || "Recommended starting point"}
                </div>
              </div>
              <div className="rounded-xl border border-sky-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Suggested project type
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {aiSetupResult.suggestedProjectType || "Not available"}
                </div>
              </div>
              <div className="rounded-xl border border-sky-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Suggested subtype
                </div>
                <div className="mt-1 text-sm font-semibold text-slate-900">
                  {aiSetupResult.suggestedProjectSubtype || "Not available"}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-white/80 bg-white/80 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Refined description
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {aiSetupResult.refinedDescription}
              </div>
            </div>
            <div className="mt-3 text-sm text-slate-700">{aiSetupResult.recommendationReason}</div>
            <div className="mt-3 text-xs text-slate-600">
              We&apos;ll generate a custom agreement based on your description.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="step1-ai-setup-build-with-ai"
                onClick={handleUseAiDescriptionOnly}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Build with AI
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep1ManualBrowseSignal((prev) => prev + 1);
                  activateStartMode("template", { committed: true, source: "user" });
                }}
                className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50"
              >
                Browse templates manually
              </button>
            </div>
          </section>
        ) : null}

        {startMode === "ai" && aiSetupResult?.kind === "description_only" ? (
          <section
            data-testid="step1-ai-setup-result"
            className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              AI draft ready
            </div>
            <div className="mt-2 text-base font-semibold text-slate-900">
              Your editable project details are ready below.
            </div>
            <div className="mt-2 rounded-xl border border-white/80 bg-white/80 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Refined description
              </div>
              <div className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {aiSetupResult.refinedDescription}
              </div>
            </div>
            <div className="mt-3 text-sm text-slate-700">
              {aiSetupResult.message}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              Review the Project Details section below, make any changes, then click Save and Next.
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="step1-review-project-details-jump"
                onClick={() => scrollToProjectDetails({ allowAutoScroll: false })}
                className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Review Project Details
              </button>
              <button
                type="button"
                data-testid="step1-change-description-button"
                onClick={() => {
                  reopenStartModeChooser();
                  scrollToStartModeChooser();
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Change description
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep1ManualBrowseSignal((prev) => prev + 1);
                  activateStartMode("template", { committed: true, source: "user" });
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Browse templates manually
              </button>
            </div>
          </section>
        ) : null}

        {startMode === "template" ? (
          <section
            data-testid="step1-template-browser"
            className="rounded-2xl border border-indigo-200 bg-indigo-50/40 shadow-sm"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-slate-900">Templates</div>
                <div className="mt-1 text-sm text-slate-600">
                  Reuse a saved agreement structure if this project follows a familiar pattern.
                </div>
              </div>
              <span className="rounded-full border border-indigo-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                Template mode
              </span>
            </div>
            <div className="border-t border-slate-200 px-5 py-5">
              <TemplateSearchSection
                locked={locked}
                agreementId={agreementId}
                dLocal={dLocal}
                onLocalChange={handleStep1LocalChange}
                entryMode={startMode}
                projectTypeOptions={projectTypeOptions}
                projectSubtypeOptions={projectSubtypeOptions}
                templatesLoading={templatesLoading}
                templatesErr={templatesErr}
                filteredTemplates={filteredTemplates}
                templateSearch={templateSearch}
                setTemplateSearch={setTemplateSearch}
                selectedTemplateId={selectedTemplateId}
                recommendedTemplateId={recommendedTemplateId}
                recommendationConfidence={recommendationConfidence}
                recommendationLoading={recommendationLoading}
                templateRecommendationReason={templateRecommendationReason}
                templateRecommendationScore={templateRecommendationScore}
                selectedTemplate={selectedTemplate}
                applyingTemplateId={applyingTemplateId}
                handleTemplatePick={handleTemplatePick}
                handleApplyTemplate={handleTemplateApplyWithOptions}
                handleDeleteTemplate={handleDeleteTemplate}
                handleUpdateTemplateDays={handleUpdateTemplateDays}
                setSelectedTemplateId={setSelectedTemplateId}
                setShowSaveTemplateModal={setShowSaveTemplateModal}
                noTemplateMatch={noTemplateMatch}
                noTemplateReason={noTemplateReason}
                templateDetail={templateDetail}
                templateDetailLoading={templateDetailLoading}
                templateDetailErr={templateDetailErr}
                suppressNoMatchPanel={hasMeaningfulSavedProjectDetails}
                aiCredits={aiCredits}
                aiBusy={aiBusy}
                aiErr={aiErr}
                aiPreview={aiPreview}
                setAiPreview={setAiPreview}
                refreshAiCredits={refreshAiCredits}
                runAiDescription={runAiDescription}
                applyAiDescription={applyAiDescription}
                hasSomeContext={hasSomeContext}
                onAddProjectType={handleCreateNewType}
                onAddProjectSubtype={handleCreateNewSubtype}
                aiMilestoneBusy={aiMilestoneBusy}
                aiMilestoneApplying={aiMilestoneApplying}
                aiMilestoneErr={aiMilestoneErr}
                aiMilestonePreview={aiMilestonePreview}
                setAiMilestonePreview={setAiMilestonePreview}
                runAiMilestonesFromScope={runAiMilestonesFromScope}
                applyAiMilestonesFromScope={applyAiMilestonesFromScope}
                startMode={startMode}
                onStartModeChange={activateStartMode}
                manualBrowseOpenSignal={step1ManualBrowseSignal}
                jobPrompt={step1JobDescriptionPrompt}
                startingPointBusy={aiSetupBusy}
                onStartFromScratch={handleBuildAgreementWithoutTemplate}
                onGenerateAiDraft={requestStep1AiSetup}
                onContinueToStep2={onStep1Continue}
                spreadEnabled={spreadEnabled}
                setSpreadEnabled={setSpreadEnabled}
                spreadTotal={spreadTotal}
                setSpreadTotal={setSpreadTotal}
                autoSchedule={autoSchedule}
                setAutoSchedule={setAutoSchedule}
                showProjectFields={false}
                appliedTemplateId={appliedTemplateId}
                onTemplateApplied={handleTemplateApplied}
              />
            </div>
          </section>
        ) : null}

        {shouldShowCompactTemplateRecommendation ? (
          <section
            data-testid="step1-ai-template-recommendation"
            className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 shadow-sm"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  AI Recommendation
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {aiRecommendedTemplate?.name || "I found a strong template fit"}
                </div>
                <div className="mt-1 text-sm text-slate-700">
                  {templateRecommendationReason ||
                    "This looks like a strong starting structure for the job you described."}
                </div>
                {assistantTopTemplatePreview?.milestone_count ? (
                  <div className="mt-2 text-xs text-sky-800/90">
                    Includes {assistantTopTemplatePreview.milestone_count} default milestone
                    {assistantTopTemplatePreview.milestone_count === 1 ? "" : "s"}.
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="step1-ai-template-apply"
                  onClick={handleUseAiRecommendedTemplate}
                  disabled={locked || !agreementId || applyingTemplateId === aiRecommendedTemplate?.id}
                  className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {applyingTemplateId === aiRecommendedTemplate?.id
                    ? "Applying..."
                    : "Use this template"}
                </button>
                <button
                  type="button"
                  data-testid="step1-ai-template-browse"
                  onClick={() => activateStartMode("template")}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  View template options
                </button>
                <button
                  type="button"
                  data-testid="step1-ai-template-dismiss"
                  onClick={() => setDismissedAiTemplateRecommendation(true)}
                  className="rounded-xl border border-transparent px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white/70"
                >
                  Keep building with AI
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {shouldShowAppliedTemplateSummary ? (
          <section
            data-testid="step1-template-applied-summary"
            className={`rounded-2xl border p-5 shadow-sm ${
              startMode === "ai"
                ? "border-indigo-200 bg-indigo-50/60"
                : "border-slate-200 bg-slate-50/70"
            }`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Template in use
                </div>
                <div className="mt-1 text-base font-semibold text-slate-900">
                  {appliedTemplateName || "Template applied"}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {startMode === "ai"
                    ? "AI is still guiding this setup. Review the template-shaped details below and keep refining the agreement."
                    : "This draft already has a template applied. Review the setup details below or switch modes if you want a different starting path."}
                </div>
              </div>
              <button
                type="button"
                data-testid="step1-template-applied-browse"
                onClick={() => activateStartMode("template")}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                View template options
              </button>
            </div>
          </section>
        ) : null}

        {hasLeadProposalContext && recommendedProjectSetup ? (
          <section
            data-testid="recommended-setup-card"
            className="rounded-2xl border border-sky-200 bg-sky-50/70 p-5 shadow-sm"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="max-w-3xl">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Recommended Setup
                </div>
                <div data-testid="recommended-setup-title" className="mt-1 text-base font-semibold text-slate-900">
                  {recommendedProjectSetup.recommendedProjectType || "Recommended project setup"}
                </div>
                <div className="mt-1 text-sm text-slate-700">
                  Based on the project details provided. You can use this as a starting point and edit anything below.
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <LeadContextField
                    label="Suggested Workflow"
                    value={recommendedProjectSetup.suggestedWorkflow || "-"}
                  />
                  <LeadContextField
                    label="Suggested Template"
                    value={
                      recommendedProjectSetup.suggestedTemplateLabel ||
                      recommendedProjectSetup.recommendedTemplateName ||
                      "General project template"
                    }
                  />
                  <LeadContextField
                    label="Project Type"
                    value={
                      recommendedProjectSetup.recommendedProjectType ||
                      recommendedProjectSetup.projectFamilyLabel ||
                      "-"
                    }
                  />
                </div>
                <div
                  data-testid="recommended-setup-note"
                  className="mt-3 rounded-xl border border-white/80 bg-white/80 px-4 py-3 text-sm text-slate-700"
                >
                  {recommendedProjectSetup.recommendationNote ||
                    "Review the setup and keep editing before you continue."}
                </div>
              </div>
              {recommendedProjectSetup.strongTemplateMatch && recommendedProjectSetup.recommendedTemplateId ? (
                <button
                  type="button"
                  data-testid="recommended-setup-use-button"
                  onClick={() => {
                    setSelectedTemplateId(String(recommendedProjectSetup.recommendedTemplateId));
                    if (recommendedProjectSetup.recommendedTemplateName) {
                      setTemplateSearch(recommendedProjectSetup.recommendedTemplateName);
                    }
                    activateStartMode("template", { committed: true, source: "user" });
                  }}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Use this
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {showStep1Clarifications && clarificationQuestions.length ? (
          <div
            data-testid="agreement-clarification-section"
            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Clarify project details</div>
                <div className="mt-1 text-sm text-slate-600">
                  Answer a few quick questions so the scope and milestone plan fit this{" "}
                  {clarificationContext.projectSubtype || clarificationContext.projectType || "project"} more closely.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={clarificationsSkipped ? () => setClarificationsSkipped(false) : handleSkipClarifications}
                  disabled={locked}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  data-testid="agreement-clarification-skip"
                >
                  {clarificationsSkipped ? "Show questions" : "Skip for now"}
                </button>
              </div>
            </div>

            {clarificationsSkipped ? (
              <div
                data-testid="agreement-clarification-skipped"
                className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600"
              >
                You can skip these for now and still keep moving. Come back anytime before generating milestones.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {clarificationQuestions.map((question) => {
                  const currentValue = safeTrim(clarificationAnswers?.[question.key]);
                  return (
                    <div
                      key={question.key}
                      className="rounded-xl border border-slate-200 bg-white p-3"
                      data-testid={`agreement-clarification-question-${question.key}`}
                    >
                      <div className="text-sm font-medium text-slate-900">{question.label}</div>
                      {question.help ? (
                        <div className="mt-1 text-xs leading-5 text-slate-500">{question.help}</div>
                      ) : null}
                      {question.kind === "yes_no" ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {["yes", "no"].map((option) => {
                            const active = currentValue === option;
                            return (
                              <button
                                key={option}
                                type="button"
                                onClick={() => handleClarificationAnswerChange(question.key, option)}
                                disabled={locked}
                                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                                  active
                                    ? "border-indigo-600 bg-indigo-600 text-white"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                                }`}
                                data-testid={`agreement-clarification-${question.key}-${option}`}
                              >
                                {option === "yes" ? "Yes" : "No"}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={currentValue}
                          onChange={(e) => handleClarificationAnswerChange(question.key, e.target.value)}
                          placeholder={question.placeholder || "Add a quick note"}
                          disabled={locked}
                          className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                          data-testid={`agreement-clarification-input-${question.key}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {clarificationSummaryLines.length ? (
              <div
                data-testid="agreement-clarification-summary"
                className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                  Saved to project context
                </div>
                <div className="mt-1 text-sm text-emerald-900">
                  These details will help refine the scope and milestone suggestions.
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-900">
                  {clarificationSummaryLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-6">
          <StepSection
            title="Project Details"
            description={projectDetailsDescription}
            sectionRef={projectDetailsSectionRef}
            testId="step1-project-details-card"
            highlighted={hasAiSectionHighlight(
              "project_title",
              "project_type",
              "project_subtype",
              "description",
              "agreement_mode",
              "recurrence_pattern",
              "recurrence_interval"
            )}
            emphasis={projectDetailsReviewPulse}
          >
            <div className="space-y-5">
              <div
                data-testid="maintenance-settings-card"
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="text-sm font-semibold text-slate-900">How this agreement works</div>
                <div className="mt-1 text-sm text-slate-600">
                  Choose whether this is a standard one-time agreement or a recurring service agreement.
                </div>

                <div className="mt-4 grid gap-3">
                  <button
                    type="button"
                    onClick={() => handleMaintenanceModeChange("standard")}
                    disabled={locked}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      !isMaintenanceMode
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    <div className="font-semibold text-slate-900">Standard Agreement</div>
                    <div className="mt-1 text-sm text-slate-600">
                      One-time project with normal milestone planning.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMaintenanceModeChange("maintenance")}
                    disabled={locked}
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      isMaintenanceMode
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    <div className="font-semibold text-slate-900">Maintenance / Recurring Service</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Generate repeat service occurrences while keeping the same approval, invoice, and payment flow.
                    </div>
                  </button>
                </div>

                {isMaintenanceMode ? (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                    <div
                      data-testid="maintenance-summary"
                      className="rounded-md border border-emerald-200 bg-white px-3 py-3 text-sm text-slate-700"
                    >
                      <div className="font-semibold text-slate-900">{recurringSummaryText}</div>
                      <div className="mt-1 text-xs text-slate-600">
                        {recurrenceStartDate
                          ? `Starts ${recurrenceStartDate}`
                          : "Pick a start date to generate the first service occurrence."}
                        {nextOccurrenceDate ? ` • Next service: ${nextOccurrenceDate}` : ""}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Frequency
                        </label>
                        <select
                          data-testid="maintenance-frequency-select"
                          value={recurrencePattern}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("recurrence_pattern", e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="quarterly">Quarterly</option>
                          <option value="yearly">Yearly</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Interval
                        </label>
                        <input
                          data-testid="maintenance-interval-input"
                          type="number"
                          min="1"
                          step="1"
                          value={recurrenceInterval}
                          disabled={locked}
                          onChange={(e) =>
                            setDLocal((s) => ({ ...s, recurrence_interval: e.target.value }))
                          }
                          onBlur={(e) =>
                            handleMaintenanceFieldPatch(
                              "recurrence_interval",
                              Math.max(1, Number(e.target.value || 1) || 1)
                            )
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Start Date
                        </label>
                        <input
                          data-testid="maintenance-start-date-input"
                          type="date"
                          value={recurrenceStartDate}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("recurrence_start_date", e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          End Date
                        </label>
                        <input
                          type="date"
                          value={recurrenceEndDate}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("recurrence_end_date", e.target.value || null)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Maintenance Status
                        </label>
                        <select
                          value={maintenanceStatus}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch("maintenance_status", e.target.value)
                          }
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                          Summary Label
                        </label>
                        <input
                          type="text"
                          value={recurringSummaryLabel}
                          disabled={locked}
                          onChange={(e) =>
                            setDLocal((s) => ({ ...s, recurring_summary_label: e.target.value }))
                          }
                          onBlur={(e) =>
                            handleMaintenanceFieldPatch("recurring_summary_label", e.target.value)
                          }
                          placeholder="Monthly HVAC Maintenance"
                          className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                        />
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={autoGenerateNextOccurrence}
                          disabled={locked}
                          onChange={(e) =>
                            handleMaintenanceFieldPatch(
                              "auto_generate_next_occurrence",
                              e.target.checked
                            )
                          }
                        />
                        Auto-generate the next service occurrence
                      </label>
                    </div>

                    <div className="mt-3">
                      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Service Window Notes
                      </label>
                      <textarea
                        value={dLocal?.service_window_notes || ""}
                        disabled={locked}
                        onChange={(e) =>
                          setDLocal((s) => ({ ...s, service_window_notes: e.target.value }))
                        }
                        onBlur={(e) =>
                          handleMaintenanceFieldPatch("service_window_notes", e.target.value)
                        }
                        rows={3}
                        placeholder="Example: Second Tuesday of each month, 8am-12pm."
                        className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="block text-sm font-medium text-slate-900">Project Type</label>
                      {getAiSuggestedIndicator("project_type") ? (
                        <span
                          data-testid="agreement-project-type-ai-indicator"
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                        >
                          {getAiSuggestedIndicator("project_type")}
                        </span>
                      ) : null}
                    </div>
                    {!locked && handleCreateNewType ? (
                      <button
                        type="button"
                        onClick={handleCreateNewType}
                        className="text-[11px] font-medium text-indigo-700 hover:underline"
                      >
                        Add Type
                      </button>
                    ) : null}
                  </div>
                    <select
                      data-testid="agreement-project-type-select"
                      ref={projectTypeFieldRef}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                      name="project_type"
                      value={dLocal.project_type || ""}
                      onChange={locked ? undefined : handleStep1LocalChange}
                      disabled={locked}
                  >
                    <option value="">— Select Type —</option>
                    {augmentedProjectTypeOptions.map((t) => (
                      <option key={String(t.id ?? t.value)} value={String(t.value)}>
                        {String(t.label)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {selectedProjectType?.owner_type
                      ? `Source: ${
                          selectedProjectType.owner_type === "system"
                            ? "Built-in taxonomy"
                            : "Custom taxonomy"
                        }`
                      : "Choose the main category for this job."}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label className="block text-sm font-medium text-slate-900">Subtype</label>
                      {getAiSuggestedIndicator("project_subtype") ? (
                        <span
                          data-testid="agreement-project-subtype-ai-indicator"
                          className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                        >
                          {getAiSuggestedIndicator("project_subtype")}
                        </span>
                      ) : null}
                    </div>
                    {!locked && handleCreateNewSubtype ? (
                      <button
                        type="button"
                        onClick={handleCreateNewSubtype}
                        className="text-[11px] font-medium text-indigo-700 hover:underline"
                      >
                        Add Subtype
                      </button>
                    ) : null}
                  </div>
                    <select
                      data-testid="agreement-project-subtype-select"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                      name="project_subtype"
                      value={dLocal.project_subtype || ""}
                      onChange={locked ? undefined : handleStep1LocalChange}
                      disabled={locked || !safeTrim(dLocal.project_type)}
                  >
                    <option value="">
                      {safeTrim(dLocal.project_type) ? "— Select Subtype —" : "Select Type first"}
                    </option>
                    {augmentedProjectSubtypeOptions.map((st) => (
                      <option key={String(st.id ?? st.value)} value={String(st.value)}>
                        {String(st.label)}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {selectedProjectSubtype?.owner_type
                      ? `Source: ${
                          selectedProjectSubtype.owner_type === "system"
                            ? "Built-in taxonomy"
                            : "Custom taxonomy"
                        }`
                      : safeTrim(dLocal.project_type)
                      ? "Subtype helps tailor templates, scope guidance, and milestones."
                      : "Choose a type first to unlock subtype options."}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center gap-2">
                  <label className="block text-sm font-medium text-slate-900">Project Title</label>
                  {getAiSuggestedIndicator("project_title") ? (
                    <span
                      data-testid="agreement-project-title-ai-indicator"
                      className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800"
                    >
                      {getAiSuggestedIndicator("project_title")}
                    </span>
                  ) : null}
                </div>
                  <input
                    data-testid="agreement-project-title-input"
                    ref={projectTitleFieldRef}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    name="project_title"
                    value={dLocal.project_title}
                    onChange={locked ? undefined : handleStep1LocalChange}
                  placeholder="e.g., Master Bedroom Addition"
                  disabled={locked}
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Keep it short and recognizable so the customer can identify the job quickly.
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900">Scope of Work</label>
                <div className="mb-2 text-xs leading-5 text-slate-600">
                  Describe what is included so the customer understands the job clearly and milestone planning stays accurate.
                </div>

                <textarea
                  data-testid="proposal-draft-textarea"
                  data-field="scope-of-work"
                  ref={projectScopeFieldRef}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  rows={8}
                  name="description"
                  value={dLocal.description || ""}
                  onChange={locked ? undefined : handleStep1LocalChange}
                  placeholder="Example: Remove existing materials, prepare surfaces, install new materials, complete finish work, and clean the job site..."
                  disabled={locked}
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">
                    {startMode === "ai"
                      ? "Use AI to draft the first version, then refine the scope here."
                      : "AI can turn a rough idea into a clearer, stronger scope when you want help."}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        aiCredits?.loading
                          ? "bg-slate-100 text-slate-700"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                      title="AI tools are included with your account"
                    >
                      AI Included
                    </span>

                    <button
                      type="button"
                      onClick={refreshAiCredits}
                      className="rounded border border-slate-200 px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-60"
                      disabled={locked}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex w-full flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => runAiDescription("improve")}
                    disabled={locked || aiBusy || !safeTrim(dLocal.description) || Boolean(appliedTemplateId)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                    data-testid="agreement-ai-improve-scope-button"
                  >
                    {aiBusy ? "Working…" : "Improve Existing Scope"}
                  </button>

                  <button
                    type="button"
                    onClick={() => runAiDescription("generate")}
                    disabled={locked || aiBusy || !hasSomeContext || Boolean(appliedTemplateId)}
                    className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                    data-testid="agreement-ai-generate-scope-button"
                  >
                    {aiBusy ? "Working…" : "Generate Scope Draft"}
                  </button>
                </div>

                <div className="mt-2 text-[11px] text-slate-500">
                  {appliedTemplateId
                    ? "A template is applied. Use the template-driven scope, milestones, and clarification flow instead of generating a new AI structure here."
                    : "Review and edit the final scope so it accurately reflects the work you are agreeing to perform."}
                </div>

                {aiErr ? <div className="mt-2 text-xs text-red-600">{aiErr}</div> : null}

                {aiPreview ? (
                  <div className="mt-3 rounded-md border bg-indigo-50 p-3">
                    <div className="mb-2 text-xs font-semibold text-indigo-900">
                      AI Suggested Scope Draft
                    </div>

                    <div className="whitespace-pre-wrap text-sm text-indigo-900">{aiPreview}</div>

                    <div className="mt-2 text-[11px] text-indigo-900/80">
                      Review this draft before using it.
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => applyAiDescription("replace")}
                        disabled={locked}
                        className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        Replace Description
                      </button>

                      <button
                        type="button"
                        onClick={() => applyAiDescription("append")}
                        disabled={locked}
                        className="rounded border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-60"
                      >
                        Append to Description
                      </button>

                      <button
                        type="button"
                        onClick={() => setAiPreview("")}
                        className="rounded border border-slate-200 px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </StepSection>
            <StepSection
              title="Project Path"
              description="Choose the workflow that matches the job. Residential stays simpler for homeowner-facing work, while Commercial unlocks structured billing tools."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight("project_class")}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleProjectClassChange("residential")}
                  disabled={locked}
                  data-testid="agreement-project-class-residential"
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    projectClass === "residential"
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  } disabled:opacity-60`}
                >
                  <div className="text-sm font-semibold text-slate-900">Residential</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Homeowner-friendly setup with simple pricing, milestone payments, and fewer advanced controls.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleProjectClassChange("commercial")}
                  disabled={locked}
                  data-testid="agreement-project-class-commercial"
                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                    projectClass === "commercial"
                      ? "border-indigo-300 bg-indigo-50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  } disabled:opacity-60`}
                >
                  <div className="text-sm font-semibold text-slate-900">Commercial</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Structured workflow for draws, retainage, and future bid or proposal handoff.
                  </div>
                </button>
              </div>
              <div
                className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                data-testid="agreement-project-class-summary"
              >
                {isCommercialProject
                  ? "Commercial agreements can use simple milestones or progress payments with retainage."
                  : "Residential agreements stay on the simpler milestone-payment path and hide commercial billing tools."}
              </div>
            </StepSection>

            <StepSection
              title="Customer"
              description="Select the customer for this agreement, or add one quickly if you need to keep moving."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight("homeowner", "customer_contact")}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CustomerSection
                  locked={locked}
                  dLocal={dLocal}
                  homeownerOptions={homeownerOptions}
                  empty={empty}
                  peopleLoadedOnce={peopleLoadedOnce}
                  reloadPeople={reloadPeople}
                  onLocalChange={handleStep1LocalChange}
                  customerAddrLoading={customerAddrLoading}
                  customerAddrMissing={customerAddrMissing}
                  selectedCustomer={selectedCustomer}
                  showQuickAdd={showQuickAdd}
                  setShowQuickAdd={setShowQuickAdd}
                  qaName={qaName}
                  setQaName={setQaName}
                  qaEmail={qaEmail}
                  setQaEmail={setQaEmail}
                  qaBusy={qaBusy}
                  onQuickAdd={onQuickAdd}
                />
              </div>
            </StepSection>

            <StepSection
              title="Location"
              description="Confirm where the work is happening so documents, compliance, and scheduling stay aligned."
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight(
                "address_line1",
                "address_line2",
                "address_city",
                "address_state",
                "address_postal_code"
              )}
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <AddressSection
                  locked={locked}
                  addrSearch={addrSearch}
                  setAddrSearch={setAddrSearch}
                  dLocal={dLocal}
                  setDLocal={setDLocal}
                  isNewAgreement={isNewAgreement}
                  cacheKey={cacheKey}
                  writeCache={writeCache}
                  patchAgreement={patchAgreement}
                  persistAddressNow={persistAddressNow}
                  schedulePatch={schedulePatch}
                  onLocalChange={handleStep1LocalChange}
                />
              </div>
            </StepSection>

            <StepSection
              title="Payment Timing"
              description={
                isCommercialProject
                  ? "Choose the billing structure for this commercial agreement. You can confirm escrow versus direct pay during final review."
                  : "Residential agreements keep payment timing simple. Escrow versus direct pay is still confirmed during final review."
              }
              className={supportSectionClass}
              highlighted={hasAiSectionHighlight("payment_structure", "retainage_percent")}
            >
              {!stripeGuidance?.complete ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="agreement-stripe-guidance">
                  <div className="font-semibold">{stripeGuidance.label}</div>
                  <div className="mt-1">{stripeGuidance.message}</div>
                  {stripeGuidance.actionLabel ? (
                    <a
                      href={stripeGuidance.actionHref || "/app/onboarding/stripe"}
                      className="mt-2 inline-flex rounded-lg bg-amber-900 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-950"
                    >
                      {stripeGuidance.actionLabel}
                    </a>
                  ) : null}
                </div>
              ) : (
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" data-testid="agreement-stripe-guidance">
                  <div className="font-semibold">{stripeGuidance.label}</div>
                  <div className="mt-1">{stripeGuidance.message}</div>
                </div>
              )}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-900">Payment Structure</div>
                <div className="mt-1 text-sm text-slate-600">
                  {isCommercialProject
                    ? "Pick the timing model that fits how this commercial project will be billed."
                    : "Residential projects use simple milestone payments to keep the agreement clearer for homeowners."}
                </div>

                <div className="mt-4 grid gap-3">
                  <button
                    type="button"
                    onClick={() => handlePaymentStructureChange("simple")}
                    disabled={locked}
                    data-testid="agreement-payment-structure-simple"
                    className={`rounded-xl border px-4 py-3 text-left transition ${
                      paymentStructure === "simple"
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    } disabled:opacity-60`}
                  >
                    <div className="font-semibold text-slate-900">
                      {isCommercialProject ? "Simple Milestone Payments" : "Simple Payments"}
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      {isCommercialProject
                        ? "Use straightforward milestone billing without draw schedules."
                        : "Get paid when milestones are completed."}
                    </div>
                  </button>

                  {isCommercialProject ? (
                    <button
                      type="button"
                      onClick={() => handlePaymentStructureChange("progress")}
                      disabled={locked}
                      data-testid="agreement-payment-structure-progress"
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        paymentStructure === "progress"
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      } disabled:opacity-60`}
                    >
                      <div className="font-semibold text-slate-900">Progress Payments</div>
                      <div className="mt-1 text-sm text-slate-600">
                        Use draw requests and retainage once the agreement is signed.
                      </div>
                    </button>
                  ) : null}
                </div>

                {!isCommercialProject ? (
                  <div
                    className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600"
                    data-testid="agreement-project-class-residential-note"
                  >
                    Commercial-only options like draw schedules and retainage stay hidden on Residential agreements.
                  </div>
                ) : null}

                {isCommercialProject && paymentStructure === "progress" ? (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Retainage %
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      data-testid="agreement-retainage-percent-input"
                      value={retainagePercent}
                      disabled={locked}
                      onChange={(e) =>
                        setDLocal((s) => ({ ...s, retainage_percent: e.target.value }))
                      }
                      onBlur={(e) => handleRetainageChange(e.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <div className="mt-2 text-xs text-slate-500">
                      Retainage is applied later when draw requests are created after signing.
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-slate-900">How are you setting pricing?</div>
                <div className="mt-1 text-sm text-slate-600">
                  Pick the pricing approach that matches how you want to build the milestone plan.
                </div>

                <div className="mt-4 grid gap-3">
                  {[
                    {
                      value: "fixed",
                      label: "I know my pricing",
                      body: "Use fixed milestone pricing now and keep the agreement ready to send.",
                    },
                    {
                      value: "estimate",
                      label: "I will estimate and adjust later",
                      body: "Start with advisory pricing and keep room to refine milestone values.",
                    },
                    {
                      value: "requires_sub_quote",
                      label: "I need subcontractor pricing first",
                      body: "Hold sending until subcontractor quote pricing is settled.",
                    },
                  ].map((option) => {
                    const active = normalizePricingStrategy(dLocal?.pricing_strategy) === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        data-testid={`agreement-pricing-strategy-${option.value}`}
                        onClick={() => {
                          if (locked) return;
                          setDLocal((prev) => ({ ...prev, pricing_strategy: option.value }));
                          writeCache({ pricing_strategy: option.value });
                          patchAgreement({ pricing_strategy: option.value, step_status: "step1" }, { silent: true });
                        }}
                        disabled={locked}
                        className={`rounded-xl border px-4 py-3 text-left transition ${
                          active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"
                        } disabled:opacity-60`}
                      >
                        <div className="font-semibold text-slate-900">{option.label}</div>
                        <div className="mt-1 text-sm text-slate-600">{option.body}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </StepSection>

          </div>


        <div className="flex justify-end gap-2 border-t border-slate-200 pt-5">
          <button
            data-testid="agreement-save-draft-button"
            type="button"
            onClick={() => saveStep1(false)}
            disabled={locked}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Save Draft
          </button>

          {locked ? (
            <button
              type="button"
              onClick={goNextNoSave}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={() => saveStep1(true)}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Save &amp; Next
            </button>
          )}
        </div>
      </div>

      <SaveTemplateModal
        open={showSaveTemplateModal}
        onClose={() => setShowSaveTemplateModal(false)}
        onSubmit={onSubmitSaveAsTemplate}
        busy={savingTemplate}
        defaultName={defaultTemplateName}
        defaultDescription=""
        projectType={safeTrim(dLocal?.project_type)}
        projectSubtype={safeTrim(dLocal?.project_subtype)}
        milestoneCount={agreement?.milestone_count ?? agreement?.milestones?.length ?? null}
        scopeDescription={safeTrim(agreement?.ai_scope?.scope_text) || safeTrim(dLocal?.description)}
      />
    </>
  );
}

