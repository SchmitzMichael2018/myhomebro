import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { buildAiContext, serializeAiContext } from "../lib/aiContext.js";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { useAssistantDock } from "../components/AssistantDock.jsx";
import {
  buildAssistantHandoffSignature,
  getAssistantHandoff,
  normalizeAssistantQuestion,
  validateHandoff,
} from "../lib/assistantHandoff.js";
import {
  canonicalizeTemplateMilestoneType,
} from "../lib/milestoneTypes.js";
import {
  buildTemplateInsightLines,
  deriveTemplateInsights,
} from "../lib/templateInsights.js";
import { computeSequentialOffsets, needsSequentialOffsets } from "../lib/templateScheduling.js";

function safeTrim(v) {
  return v == null ? "" : String(v).trim();
}

const TEMPLATE_AI_PERMISSION_MESSAGE = "AI tools are available to contractors and admins";

function formatTemplateAiError(error, fallbackMessage) {
  const detail = safeTrim(error?.response?.data?.detail || error?.response?.data?.error);
  if (
    error?.response?.status === 403 ||
    /Only contractors can use template AI tools/i.test(detail)
  ) {
    return TEMPLATE_AI_PERMISSION_MESSAGE;
  }
  return detail || fallbackMessage;
}

function normalizeTemplateScopeSections(data = {}) {
  return {
    descriptionScope: safeTrim(data?.description_scope || data?.description || data?.default_scope),
    assumptions: safeTrim(data?.assumptions || data?.assumptions_text),
    exclusions: safeTrim(data?.exclusions || data?.exclusions_text),
  };
}

function toMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `$${n.toFixed(2)}`;
}

function moneyOrDash(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${n.toFixed(2)}`;
}

function toPositiveInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function toDayNumber(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function dayLabel(v) {
  const n = toPositiveInt(v);
  if (!n) return "";
  return `${n} day${n === 1 ? "" : "s"}`;
}

function offsetLabel(v) {
  if (v === "" || v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${n} day${n === 1 ? "" : "s"} after start`;
}

function startDayLabel(v) {
  const n = toDayNumber(v);
  if (n == null) return "—";
  return `Day ${n}`;
}

function hasAnyPricing(m) {
  return (
    !!m?.pricing_advisory ||
    Number(m?.suggested_amount_fixed) > 0 ||
    Number(m?.suggested_amount_low) > 0 ||
    Number(m?.suggested_amount_high) > 0
  );
}

function normalizeClarificationText(item) {
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
}

function normalizeClarifications(items) {
  if (!Array.isArray(items)) return [];
  return items.map(normalizeClarificationText).filter(Boolean);
}

function normalizeTitleForMatch(value) {
  return safeTrim(value).toLowerCase().replace(/\s+/g, " ");
}

function standardizeTemplateMilestoneType(value = "", fallbackText = "") {
  return canonicalizeTemplateMilestoneType(value, fallbackText) || "";
}

const WORKFLOW_ASSISTANCE_OPTIONS = [
  { value: "hourly", label: "Hourly Help" },
  { value: "half_day", label: "Half-Day Assistance" },
  { value: "full_day", label: "Full-Day Assistance" },
  { value: "milestone_based", label: "Milestone-Based Assistance" },
  { value: "consultation_only", label: "Consultation Only" },
];

const WORKFLOW_SCHEDULING_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "session_based", label: "Session-Based" },
  { value: "daily", label: "Daily" },
  { value: "milestone_driven", label: "Milestone-Driven" },
];

const WORKFLOW_PARTICIPATION_OPTIONS = [
  { value: "homeowner_prep", label: "Homeowner prep" },
  { value: "shared_tasks", label: "Shared tasks" },
  { value: "contractor_led_technical_work", label: "Contractor-led technical work" },
  { value: "inspection_review_checkpoints", label: "Inspection / review checkpoints" },
];

function normalizeWorkflowValue(value, fallback) {
  const normalized = safeTrim(value).toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  return normalized || fallback;
}

function normalizeWorkflowProfile(profile) {
  const defaultProfile = {
    assistance_format: "milestone_based",
    scheduling_mode: "milestone_driven",
    billing_style: "milestone",
    participation_structure: [
      "homeowner_prep",
      "shared_tasks",
      "contractor_led_technical_work",
      "inspection_review_checkpoints",
    ],
    workflow_notes: "Flexible collaboration workflow with trade-specific milestones.",
  };

  if (!profile || typeof profile !== "object") {
    return defaultProfile;
  }

  const assistance_format = normalizeWorkflowValue(profile.assistance_format, defaultProfile.assistance_format);
  const scheduling_mode = normalizeWorkflowValue(profile.scheduling_mode, defaultProfile.scheduling_mode);
  const billing_style = safeTrim(profile.billing_style) || defaultProfile.billing_style;
  const participation_structure = Array.isArray(profile.participation_structure)
    ? profile.participation_structure.map((item) => normalizeWorkflowValue(item, "")).filter(Boolean)
    : [];

  return {
    assistance_format,
    scheduling_mode,
    billing_style,
    participation_structure: participation_structure.length
      ? Array.from(new Set(participation_structure))
      : defaultProfile.participation_structure,
    workflow_notes: safeTrim(profile.workflow_notes) || defaultProfile.workflow_notes,
  };
}

function workflowAssistanceLabel(value) {
  return (
    WORKFLOW_ASSISTANCE_OPTIONS.find((item) => item.value === normalizeWorkflowValue(value, ""))?.label ||
    "Milestone-Based Assistance"
  );
}

function workflowSchedulingLabel(value) {
  return (
    WORKFLOW_SCHEDULING_OPTIONS.find((item) => item.value === normalizeWorkflowValue(value, ""))?.label ||
    "Milestone-Driven"
  );
}

function OptionBadge({ ownerType }) {
  const text = ownerType === "system" ? "System / Built-in" : "Custom";
  return (
    <span
      className={`mhb-template-badge inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        ownerType === "system"
          ? "is-system bg-slate-100 text-slate-700"
          : "is-custom bg-emerald-100 text-emerald-800"
      }`}
    >
      {text}
    </span>
  );
}

function VisibilityBadge({ visibility }) {
  const normalized = safeTrim(visibility).toLowerCase() || "private";
  const styles = {
    system: "bg-slate-900 text-white",
    private: "bg-slate-200 text-slate-700",
    regional: "bg-amber-100 text-amber-800",
    public: "bg-sky-100 text-sky-800",
    team: "bg-violet-100 text-violet-800",
  };
  return (
    <span
      className={`mhb-template-badge is-visibility inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        styles[normalized] || styles.private
      }`}
    >
      {normalized === "system"
        ? "System"
        : normalized.charAt(0).toUpperCase() + normalized.slice(1)}
    </span>
  );
}

function formatRegionLabel(value) {
  const raw = safeTrim(value);
  if (!raw) return "National";
  return raw.replace(/^US-/, "").replaceAll("_", " ").replaceAll("-", " / ");
}

function ConfidenceBadge({ value }) {
  const normalized = safeTrim(value).toLowerCase();

  if (normalized === "high") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
        High confidence
      </span>
    );
  }

  if (normalized === "medium") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
        Moderate confidence
      </span>
    );
  }

  if (normalized === "low") {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
        Preliminary estimate
      </span>
    );
  }

  return null;
}

function TabButton({ active, onClick, children, ...rest }) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className={`mhb-template-tab rounded-lg px-3 py-2 text-sm font-semibold transition ${
        active
          ? "is-active bg-indigo-600 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="mhb-template-section-card mt-4 rounded-2xl border border-slate-200 bg-slate-50/90 p-5 shadow-sm">
      <div className="mhb-template-section-title text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function buildBlankHeader() {
  return {
    name: "",
    project_type: "",
    project_subtype: "",
    description: "",
    exclusions_text: "",
    assumptions_text: "",
    estimated_days: 1,
    default_scope: "",
    default_clarifications: [],
    workflow_profile: normalizeWorkflowProfile(null),
    project_materials_hint: "",
    is_active: true,
  };
}

function buildBlankMilestone(sortOrder = 1) {
  return {
    id: null,
    title: "",
    description: "",
    sort_order: sortOrder,
    start_offset: sortOrder === 1 ? 0 : "",
    duration_days: "",
    pricing_advisory: false,
    normalized_milestone_type: "",
    suggested_amount_fixed: "",
    suggested_amount_low: "",
    suggested_amount_high: "",
    pricing_confidence: "",
    pricing_source_note: "",
    recommended_days_from_start: sortOrder === 1 ? 1 : "",
    recommended_duration_days: "",
    materials_hint: "",
    is_optional: false,
  };
}

function toCanonicalStartOffset(value, fallbackIndex = 0) {
  if (value === "" || value == null) {
    return fallbackIndex === 0 ? 0 : "";
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallbackIndex === 0 ? 0 : "";
  return Math.round(n);
}

function legacyRecommendedFromOffset(offset) {
  if (offset === "" || offset == null) return null;
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n) + 1;
}

function normalizeMilestoneForEdit(m, idx) {
  const startOffset =
    m?.start_offset != null
      ? m.start_offset
      : m?.recommended_days_from_start != null
      ? Math.max(Number(m.recommended_days_from_start) - 1, 0)
      : idx === 0
      ? 0
      : "";
  const durationDays = m?.duration_days ?? m?.recommended_duration_days ?? "";
  const pricingAdvisory =
    m?.pricing_advisory != null ? !!m.pricing_advisory : hasAnyPricing(m);

  return {
    id: m?.id ?? null,
    title: m?.title ?? "",
    description: m?.description ?? "",
    sort_order: m?.sort_order ?? idx + 1,
    start_offset: startOffset,
    duration_days: durationDays,
    pricing_advisory: pricingAdvisory,
    normalized_milestone_type: standardizeTemplateMilestoneType(
      m?.normalized_milestone_type ?? "",
      `${m?.title ?? ""} ${m?.description ?? ""}`
    ),
    suggested_amount_fixed: m?.suggested_amount_fixed ?? "",
    suggested_amount_low: m?.suggested_amount_low ?? "",
    suggested_amount_high: m?.suggested_amount_high ?? "",
    pricing_confidence: m?.pricing_confidence ?? "",
    pricing_source_note: m?.pricing_source_note ?? "",
    recommended_days_from_start:
      m?.recommended_days_from_start ?? legacyRecommendedFromOffset(startOffset) ?? "",
    recommended_duration_days: m?.recommended_duration_days ?? durationDays ?? "",
    materials_hint: m?.materials_hint ?? "",
    is_optional: !!m?.is_optional,
  };
}

function normalizeHeaderForEdit(detail) {
  return {
    name: detail?.name ?? "",
    project_type: detail?.project_type ?? "",
    project_subtype: detail?.project_subtype ?? "",
    description: detail?.description ?? "",
    exclusions_text: detail?.exclusions_text ?? "",
    assumptions_text: detail?.assumptions_text ?? "",
    estimated_days: detail?.estimated_days ?? 1,
    default_scope: detail?.default_scope ?? "",
    default_clarifications: Array.isArray(detail?.default_clarifications)
      ? detail.default_clarifications
      : [],
    workflow_profile: normalizeWorkflowProfile(detail?.workflow_profile),
    project_materials_hint: detail?.project_materials_hint ?? "",
    is_active: detail?.is_active ?? true,
  };
}

function buildTemplatePayload(header, milestones, extras = {}) {
  const isPublished = extras?.is_published;
  return {
    name: header?.name ?? "",
    project_type: header?.project_type ?? "",
    project_subtype: header?.project_subtype ?? "",
    description: header?.description ?? "",
    exclusions_text: header?.exclusions_text ?? "",
    assumptions_text: header?.assumptions_text ?? "",
    estimated_days: Number(header?.estimated_days || 1) || 1,
    default_scope: header?.default_scope || header?.description || "",
    default_clarifications: Array.isArray(header?.default_clarifications)
      ? header.default_clarifications
      : [],
    workflow_profile: normalizeWorkflowProfile(header?.workflow_profile),
    project_materials_hint: header?.project_materials_hint ?? "",
    is_active: header?.is_active ?? true,
    source_template_id: extras?.source_template_id,
    is_system: !!extras?.is_system,
    ...(isPublished === undefined ? {} : { is_published: !!isPublished }),
    milestones: milestones.map((m, idx) => ({
      ...(m?.id ? { id: m.id } : {}),
      title: m?.title ?? "",
      description: m?.description ?? "",
      sort_order: Number(m?.sort_order || idx + 1) || idx + 1,
      start_offset:
        m?.start_offset === "" || m?.start_offset == null
          ? idx === 0
            ? 0
            : null
          : toCanonicalStartOffset(m?.start_offset, idx),
      duration_days:
        m?.duration_days === "" || m?.duration_days == null
          ? m?.recommended_duration_days === "" || m?.recommended_duration_days == null
            ? null
            : Number(m?.recommended_duration_days)
          : Number(m?.duration_days),
      pricing_advisory: !!m?.pricing_advisory,
      normalized_milestone_type: standardizeTemplateMilestoneType(
        m?.normalized_milestone_type ?? "",
        `${m?.title ?? ""} ${m?.description ?? ""}`
      ),
      suggested_amount_fixed:
        m?.pricing_advisory && m?.suggested_amount_fixed !== "" ? m?.suggested_amount_fixed : null,
      suggested_amount_low:
        m?.pricing_advisory && m?.suggested_amount_low !== "" ? m?.suggested_amount_low : null,
      suggested_amount_high:
        m?.pricing_advisory && m?.suggested_amount_high !== "" ? m?.suggested_amount_high : null,
      pricing_confidence: m?.pricing_advisory ? m?.pricing_confidence ?? "" : "",
      pricing_source_note: m?.pricing_advisory ? m?.pricing_source_note ?? "" : "",
      recommended_days_from_start:
        m?.start_offset === "" || m?.start_offset == null
          ? idx === 0
            ? 1
            : null
          : legacyRecommendedFromOffset(toCanonicalStartOffset(m?.start_offset, idx)),
      recommended_duration_days:
        m?.duration_days === "" || m?.duration_days == null
          ? m?.recommended_duration_days === ""
            ? null
            : m?.recommended_duration_days
          : Number(m?.duration_days),
      materials_hint: m?.materials_hint ?? "",
      is_optional: !!m?.is_optional,
    })),
  };
}

export default function TemplatesPage({ adminMode = false } = {}) {
  const location = useLocation();
  const { updateAssistantContext, updateAssistantOnAction } = useAssistantDock();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [templates, setTemplates] = useState([]);

  const [discoverySource, setDiscoverySource] = useState(adminMode ? "all" : "mine");
  const [search, setSearch] = useState("");
  const [projectTypeFilter, setProjectTypeFilter] = useState("");
  const [projectSubtypeFilter, setProjectSubtypeFilter] = useState("");
  const [regionStateFilter, setRegionStateFilter] = useState("");
  const [regionCityFilter, setRegionCityFilter] = useState("");
  const [sortBy, setSortBy] = useState("relevant");
  const [selectedId, setSelectedId] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [visibilitySaving, setVisibilitySaving] = useState("");

  const [activeTab, setActiveTab] = useState("setup");
  const [editMode, setEditMode] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [assistantPrefillBanner, setAssistantPrefillBanner] = useState("");
  const [templateAiPrompt, setTemplateAiPrompt] = useState("");
  const [assistantField, setAssistantField] = useState("description");
  const [generatedAiDraft, setGeneratedAiDraft] = useState(null);
  const [draftSourceTemplateId, setDraftSourceTemplateId] = useState(null);
  const [draftIsSystemTemplate, setDraftIsSystemTemplate] = useState(false);
  const [keepEditorOpenAfterSave, setKeepEditorOpenAfterSave] = useState(false);
  const [aiGenerationStageIndex, setAiGenerationStageIndex] = useState(-1);
  const [aiGenerationError, setAiGenerationError] = useState("");
  const [aiGenerationPartialSections, setAiGenerationPartialSections] = useState([]);
  const [aiGenerationRecoveryMode, setAiGenerationRecoveryMode] = useState(false);
  const [aiGenerationRecoveryNote, setAiGenerationRecoveryNote] = useState("");
  const saveButtonRef = React.useRef(null);
  const editorPanelRef = React.useRef(null);
  const draftNameInputRef = React.useRef(null);

  const [editHeader, setEditHeader] = useState(buildBlankHeader());
  const [editMilestones, setEditMilestones] = useState([buildBlankMilestone(1)]);

  const [aiBusy, setAiBusy] = useState(false);
  const [materialsRefreshing, setMaterialsRefreshing] = useState(false);
  const appliedPrefillRef = React.useRef("");
  const assistantAppliedRef = React.useRef("");
  const intakePrefillMeta = location.state?.templateDraftPrefill || null;
  const assistantHandoff = useMemo(() => {
    const raw = getAssistantHandoff(location.state);
    const { payload } = validateHandoff(raw);
    return payload;
  }, [location.state]);
  const assistantHandoffSignature = useMemo(
    () => buildAssistantHandoffSignature(assistantHandoff),
    [assistantHandoff]
  );
  const assistantHasMeaningfulContent = useMemo(() => {
    const hasValue = (value) => {
      if (value == null) return false;
      if (typeof value === "string") return safeTrim(value).length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.values(value).some(hasValue);
      return Boolean(value);
    };

    const draftPayload = assistantHandoff.draftPayload || {};
    const meaningfulDraftPayload = Object.entries(draftPayload).some(
      ([key, value]) => key !== "workflow_profile" && hasValue(value)
    );

    return (
      Object.values(assistantHandoff.prefillFields || {}).some(hasValue) ||
      meaningfulDraftPayload ||
      (assistantHandoff.clarificationQuestions || []).length > 0 ||
      (assistantHandoff.suggestedMilestones || []).length > 0 ||
      (assistantHandoff.templateRecommendations || []).length > 0
    );
  }, [assistantHandoff]);
  const isSystemDiscovery = !adminMode && discoverySource === "system";

  async function loadTemplates(options = {}) {
    try {
      setLoading(true);
      setErr("");
      const source = options?.source || discoverySource;

      const { data } = adminMode
        ? await api.get("/projects/templates/", {
            params: {
              source,
              q: search || undefined,
              project_type: projectTypeFilter || undefined,
              project_subtype: projectSubtypeFilter || undefined,
              include_inactive: true,
            },
          })
        : await api.get("/projects/templates/discover/", {
            params: {
              source,
              q: search || undefined,
              project_type: projectTypeFilter || undefined,
              project_subtype: projectSubtypeFilter || undefined,
              region_state: regionStateFilter || undefined,
              region_city: regionCityFilter || undefined,
              sort: sortBy || "relevant",
            },
          });
      const rows = Array.isArray(data) ? data : data?.results || [];
      setTemplates(rows);
    } catch (e) {
      setErr(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not load templates."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTemplates();
  }, [
    adminMode,
    discoverySource,
    search,
    projectTypeFilter,
    projectSubtypeFilter,
    regionStateFilter,
    regionCityFilter,
    sortBy,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!selectedId) {
        if (!creatingNew) {
          setSelectedDetail(null);
          setDetailErr("");
        }
        return;
      }

      try {
        setDetailLoading(true);
        setDetailErr("");

        const { data } = await api.get(`/projects/templates/${selectedId}/`);

        if (cancelled) return;
        setSelectedDetail(data);
        setGeneratedAiDraft(null);
        setEditHeader(normalizeHeaderForEdit(data));
        setEditMilestones(
          Array.isArray(data?.milestones) && data.milestones.length
            ? data.milestones.map((m, idx) => normalizeMilestoneForEdit(m, idx))
            : [buildBlankMilestone(1)]
        );
        setEditMode(keepEditorOpenAfterSave);
        setCreatingNew(false);
        if (keepEditorOpenAfterSave) {
          setKeepEditorOpenAfterSave(false);
        }
      } catch (e) {
        if (cancelled) return;
        setSelectedDetail(null);
        setDetailErr(
          e?.response?.data?.detail ||
            e?.response?.data?.error ||
            "Could not load template detail."
        );
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    }

    if (!creatingNew) run();

    return () => {
      cancelled = true;
    };
  }, [selectedId, creatingNew, keepEditorOpenAfterSave]);

  const filteredTemplates = useMemo(() => templates, [templates]);

  const selectedTemplate = useMemo(() => {
    return (
      filteredTemplates.find((tpl) => String(tpl.id) === String(selectedId)) ||
      templates.find((tpl) => String(tpl.id) === String(selectedId)) ||
      null
    );
  }, [filteredTemplates, templates, selectedId]);

  const customTemplates = useMemo(() => {
    return filteredTemplates.filter(
      (tpl) =>
        (tpl?.owner_type || (tpl?.is_system ? "system" : "contractor")) !==
        "system"
    );
  }, [filteredTemplates]);

  const builtInTemplates = useMemo(() => {
    return filteredTemplates.filter(
      (tpl) =>
        (tpl?.owner_type || (tpl?.is_system ? "system" : "contractor")) ===
        "system"
    );
  }, [filteredTemplates]);

  const isSelectedBuiltIn =
    !!selectedDetail &&
    (selectedDetail?.is_system || selectedDetail?.owner_type === "system");

  const currentHeader = editHeader;
  const currentMilestones = editMilestones;
  const previewClarifications = normalizeClarifications(
    currentHeader?.default_clarifications
  );
  const showIntakePrefillBanner =
    creatingNew &&
    intakePrefillMeta?.source === "intake";

  const pricingTotals = useMemo(() => {
    return currentMilestones.reduce(
      (acc, m) => {
        acc.fixed += Number(m?.suggested_amount_fixed) || 0;
        acc.low += Number(m?.suggested_amount_low) || 0;
        acc.high += Number(m?.suggested_amount_high) || 0;
        return acc;
      },
      { fixed: 0, low: 0, high: 0 }
    );
  }, [currentMilestones]);

  const generatedPricingGuidance = generatedAiDraft?.pricing || null;
  const generatedMaterials = Array.isArray(generatedAiDraft?.materials)
    ? generatedAiDraft.materials
    : [];
  const generatedClarificationQuestions = normalizeClarifications(
    generatedAiDraft?.clarification_questions
  );
  const generatedTimeline = safeTrim(generatedAiDraft?.timeline);
  const templateInsights = useMemo(
    () =>
      deriveTemplateInsights({
        ...currentHeader,
        milestones: currentMilestones,
        pricing: generatedPricingGuidance,
        materials: generatedMaterials,
        timeline: generatedTimeline,
        clarification_questions: generatedClarificationQuestions,
        insights: generatedAiDraft?.insights,
      }),
    [
      currentHeader,
      currentMilestones,
      generatedAiDraft?.insights,
      generatedMaterials,
      generatedPricingGuidance,
      generatedTimeline,
      generatedClarificationQuestions,
    ]
  );
  const templateInsightLines = useMemo(
    () => buildTemplateInsightLines(templateInsights, { context: "template" }),
    [templateInsights]
  );

  const missingTemplateSections = useMemo(() => {
    const missing = [];
    if (!safeTrim(currentHeader?.name)) missing.push("template name");
    if (!safeTrim(currentHeader?.description || currentHeader?.default_scope)) missing.push("scope description");
    if (!safeTrim(currentHeader?.exclusions_text)) missing.push("exclusions");
    if (!safeTrim(currentHeader?.assumptions_text)) missing.push("assumptions");
    if (!currentMilestones.length || currentMilestones.every((row) => !safeTrim(row?.title))) {
      missing.push("reusable milestones");
    }
    if (!safeTrim(currentHeader?.project_materials_hint) && !generatedMaterials.length) {
      missing.push("materials guidance");
    }
    return missing;
  }, [currentHeader, currentMilestones, generatedMaterials.length]);

  const pricingGuidanceState = useMemo(() => {
    if (currentMilestones.some((row) => row?.pricing_advisory)) return "configured";
    if (generatedPricingGuidance) return "ai_guidance_available";
    return "not_configured";
  }, [currentMilestones, generatedPricingGuidance]);

  const templateCopilotPrompt = useMemo(() => {
    if (activeTab === "milestones") {
      return 'Examples: "Help me build reusable milestones" or "What optional milestones should I add?"';
    }
    if (activeTab === "pricing") {
      return 'Examples: "What pricing guidance should I add?" or "How should this template explain pricing ranges?"';
    }
    if (activeTab === "schedule") {
      return 'Examples: "Suggest a scheduling strategy" or "How should assisted DIY timing work?"';
    }
    if (activeTab === "materials") {
      return 'Examples: "Where is material guidance sparse?" or "Suggest reusable material assumptions."';
    }
    return 'Examples: "Improve this workflow profile" or "Suggest exclusions for junk removal."';
  }, [activeTab]);

  const templateCopilotNextAction = useMemo(() => {
    if (missingTemplateSections.length) {
      return `Next: Review ${missingTemplateSections.slice(0, 3).join(", ")} before saving this reusable workflow.`;
    }
    if (pricingGuidanceState !== "configured") {
      return "Next: Consider adding advisory pricing ranges, confidence, or source notes.";
    }
    return "Next: Review this template as a reusable workflow pattern before saving or publishing.";
  }, [missingTemplateSections, pricingGuidanceState]);

  const templateAssistantContext = useMemo(() => {
    const templateName = safeTrim(currentHeader?.name) || safeTrim(selectedDetail?.name);
    const workflowProfile = normalizeWorkflowProfile(currentHeader?.workflow_profile);
    return {
      page: "templates",
      workspace_mode: "templates",
      current_route: `${location.pathname}${location.search || ""}`,
      active_tab: activeTab,
      template_id: selectedDetail?.id || null,
      template_name: templateName,
      project_type: safeTrim(currentHeader?.project_type),
      project_subtype: safeTrim(currentHeader?.project_subtype),
      description: safeTrim(currentHeader?.description || currentHeader?.default_scope),
      workflow_profile: workflowProfile,
      pricing_guidance_state: pricingGuidanceState,
      missing_sections: missingTemplateSections,
      unsaved_draft: Boolean(creatingNew || editMode),
      generated_ai_draft: Boolean(generatedAiDraft),
      template_summary: {
        id: selectedDetail?.id || null,
        name: templateName,
        project_type: safeTrim(currentHeader?.project_type),
        project_subtype: safeTrim(currentHeader?.project_subtype),
        description: safeTrim(currentHeader?.description),
        default_scope: safeTrim(currentHeader?.default_scope),
        exclusions_text: safeTrim(currentHeader?.exclusions_text),
        assumptions_text: safeTrim(currentHeader?.assumptions_text),
        workflow_profile: workflowProfile,
        active_tab: activeTab,
        milestone_count: currentMilestones.length,
        pricing_guidance_state: pricingGuidanceState,
      },
      milestone_summary: {
        count: currentMilestones.length,
        suggested_titles: currentMilestones.map((row) => safeTrim(row?.title)).filter(Boolean),
      },
      ai_panel: {
        headline: "Review this template workflow",
        helperText:
          "Get template-aware guidance for reusable scope, workflow profile, milestones, pricing, timing, and materials. Copilot will not edit fields automatically.",
        statusText: creatingNew
          ? "Unsaved template draft in progress"
          : selectedDetail
          ? "Template context loaded"
          : "Template workspace context loaded",
        promptPlaceholder: templateCopilotPrompt,
        nextActionText: templateCopilotNextAction,
        nextGuidanceTitle:
          missingTemplateSections.length ? "Workflow gaps to review" : "Workflow intelligence",
        nextGuidance:
          missingTemplateSections.length
            ? `Copilot sees missing template sections: ${missingTemplateSections.join(", ")}.`
            : "Copilot is checking reusable workflow structure, not agreement signature or funding readiness.",
      },
    };
  }, [
    activeTab,
    creatingNew,
    currentHeader,
    currentMilestones,
    editMode,
    generatedAiDraft,
    location.pathname,
    location.search,
    missingTemplateSections,
    pricingGuidanceState,
    selectedDetail,
    templateCopilotNextAction,
    templateCopilotPrompt,
  ]);

  useEffect(() => {
    updateAssistantContext(templateAssistantContext);
  }, [templateAssistantContext, updateAssistantContext]);

  function formatGuidancePercentages(items) {
    if (!Array.isArray(items) || !items.length) return "No milestone percentages provided yet.";
    return items
      .map((row) => {
        const milestone = safeTrim(row?.milestone) || "Milestone";
        const pct = safeTrim(row?.percentage) || "—";
        const notes = safeTrim(row?.notes);
        return `${milestone}: ${pct}${notes ? ` (${notes})` : ""}`;
      })
      .join(" • ");
  }
  function openBlankDraftEditor() {
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailErr("");
    setGeneratedAiDraft(null);
    setAiGenerationError("");
    setAiGenerationPartialSections([]);
    setAiGenerationRecoveryMode(false);
    setAiGenerationRecoveryNote("");
    setAiGenerationStageIndex(-1);
    setCreatingNew(true);
    setEditMode(true);
    setActiveTab("setup");
    setDraftSourceTemplateId(null);
    setDraftIsSystemTemplate(false);
  }

  function startNewTemplate() {
    openBlankDraftEditor();
    setEditHeader(buildBlankHeader());
    setEditMilestones([buildBlankMilestone(1)]);
    setTemplateAiPrompt("");
    setDraftSourceTemplateId(null);
    setDraftIsSystemTemplate(Boolean(adminMode));
  }

  function openDraftForGeneration(seed = {}) {
    openBlankDraftEditor();
    setEditHeader({
      ...buildBlankHeader(),
      name: safeTrim(seed?.name) || "",
      project_type: seed?.project_type ?? "",
      project_subtype: seed?.project_subtype ?? "",
      description: seed?.description ?? "",
      default_scope: seed?.description ?? "",
      default_clarifications: [],
      workflow_profile: normalizeWorkflowProfile(seed?.workflow_profile),
      project_materials_hint: seed?.project_materials_hint ?? "",
    });
    setEditMilestones([buildBlankMilestone(1)]);
    setDraftSourceTemplateId(null);
    setDraftIsSystemTemplate(false);
  }

  function openDraftFromExistingTemplate(template, bannerText = "", options = {}) {
    if (!template) return;
    const asSystem = Boolean(options?.asSystem);

    setSelectedId(null);
    setSelectedDetail(null);
    setDetailErr("");
    setGeneratedAiDraft(null);
    setAiGenerationError("");
    setAiGenerationPartialSections([]);
    setAiGenerationRecoveryMode(false);
    setAiGenerationRecoveryNote("");
    setAiGenerationStageIndex(-1);
    setCreatingNew(true);
    setEditMode(true);
    setActiveTab("setup");
    setTemplateAiPrompt("");
    setEditHeader(normalizeHeaderForEdit(template));
    setEditMilestones(
      Array.isArray(template?.milestones) && template.milestones.length
        ? template.milestones.map((m, idx) => normalizeMilestoneForEdit(m, idx))
        : [buildBlankMilestone(1)]
    );
    setAssistantPrefillBanner(
      bannerText ||
        "Copied from a system template. Review and save it to add it to your template library."
    );
    setDraftSourceTemplateId(template?.id || null);
    setDraftIsSystemTemplate(asSystem);
  }

  const handleDockAction = useCallback((action) => {
    if (action?.action_key !== "use_template_draft") return false;
    const draft = action.draft || {};
    const rawMilestones = Array.isArray(draft.milestones) ? draft.milestones : [];
    const exclusions = Array.isArray(draft.exclusions) ? draft.exclusions : [];
    const assumptions = Array.isArray(draft.assumptions) ? draft.assumptions : [];
    const clarifications = Array.isArray(draft.default_clarifications)
      ? draft.default_clarifications
      : Array.isArray(draft.guided_questions)
      ? draft.guided_questions
      : [];

    // Strip legacy "Workflow Template" suffix if the name was generated before the cleanup.
    const cleanedName = String(draft.template_name || "")
      .replace(/\s*workflow\s+template\s*/gi, "")
      .trim();

    setSelectedId(null);
    setSelectedDetail(null);
    setDetailErr("");
    setGeneratedAiDraft(null);
    setAiGenerationError("");
    setAiGenerationPartialSections([]);
    setAiGenerationRecoveryMode(false);
    setAiGenerationRecoveryNote("");
    setAiGenerationStageIndex(-1);
    setCreatingNew(true);
    setEditMode(true);
    setActiveTab("setup");
    setDraftSourceTemplateId(null);
    setDraftIsSystemTemplate(false);

    setEditHeader({
      ...buildBlankHeader(),
      name: cleanedName,
      project_type: draft.project_type || "",
      project_subtype: draft.project_subtype || "",
      description: draft.description || "",
      default_scope: draft.description || "",
      exclusions_text: exclusions.join("\n"),
      assumptions_text: assumptions.join("\n"),
      project_materials_hint: draft.project_materials_hint || "",
      default_clarifications: clarifications,
      workflow_profile: normalizeWorkflowProfile(draft.workflow_profile || null),
    });

    setEditMilestones(
      rawMilestones.length
        ? rawMilestones.map((m, idx) => {
            const milestoneObj =
              typeof m === "string"
                ? { title: m, sort_order: idx + 1 }
                : {
                    title: m.title ?? "",
                    description: m.description ?? "",
                    sort_order: m.sort_order ?? idx + 1,
                    start_offset: m.start_offset ?? (idx === 0 ? 0 : ""),
                    duration_days: m.duration_days ?? "",
                    pricing_advisory: m.pricing_advisory ?? false,
                    suggested_amount_fixed: m.suggested_amount_fixed ?? "",
                    suggested_amount_low: m.suggested_amount_low ?? "",
                    suggested_amount_high: m.suggested_amount_high ?? "",
                    pricing_confidence: m.pricing_confidence ?? "",
                    pricing_source_note: m.pricing_source_note ?? "",
                    recommended_days_from_start: m.start_offset != null ? Number(m.start_offset) + 1 : idx + 1,
                    recommended_duration_days: m.duration_days ?? "",
                    materials_hint: m.materials_hint ?? "",
                    is_optional: !!m.is_optional,
                  };
            return normalizeMilestoneForEdit(milestoneObj, idx);
          })
        : [buildBlankMilestone(1)]
    );

    setGeneratedAiDraft(draft);
    setAssistantPrefillBanner("AI draft applied — review and save your template.");
    return true;
  }, []);

  useEffect(() => {
    updateAssistantOnAction(handleDockAction);
    return () => updateAssistantOnAction(null);
  }, [handleDockAction, updateAssistantOnAction]);

  function clearTemplateSelection() {
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailErr("");
    setGeneratedAiDraft(null);
    setAiGenerationError("");
    setAiGenerationPartialSections([]);
    setAiGenerationRecoveryMode(false);
    setAiGenerationRecoveryNote("");
    setAiGenerationStageIndex(-1);
    setCreatingNew(false);
    setEditMode(false);
    setActiveTab("setup");
    setTemplateAiPrompt("");
    setAssistantPrefillBanner("");
    setDraftSourceTemplateId(null);
    setDraftIsSystemTemplate(false);
    setEditHeader(buildBlankHeader());
    setEditMilestones([buildBlankMilestone(1)]);
  }

  useEffect(() => {
    if (!creatingNew || !editorPanelRef.current) return;
    editorPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    if (draftNameInputRef.current) {
      draftNameInputRef.current.focus({ preventScroll: true });
    }
  }, [creatingNew]);

  useEffect(() => {
    if (!generatedAiDraft || !saveButtonRef.current) return;
    saveButtonRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    saveButtonRef.current.focus({ preventScroll: true });
  }, [generatedAiDraft]);

  useEffect(() => {
    if (!aiBusy) {
      setAiGenerationStageIndex(-1);
      return;
    }

    setAiGenerationStageIndex(0);
    const interval = window.setInterval(() => {
      setAiGenerationStageIndex((prev) => Math.min(prev + 1, AI_GENERATION_STEP_ITEMS.length - 1));
    }, 900);

    return () => window.clearInterval(interval);
  }, [aiBusy]);

  useEffect(() => {
    const prefill = location.state?.templateDraftPrefill;
    if (!prefill || typeof prefill !== "object") return;

    const signature = JSON.stringify(prefill);
    if (appliedPrefillRef.current === signature) return;
    appliedPrefillRef.current = signature;

    const header = prefill?.header || {};
    const milestoneRows = Array.isArray(prefill?.milestones) ? prefill.milestones : [];

    setSelectedId(null);
    setSelectedDetail(null);
    setDetailErr("");
    setGeneratedAiDraft(null);
    setCreatingNew(true);
    setEditMode(true);
    setActiveTab("setup");
    setTemplateAiPrompt("");
    setEditHeader({
      ...buildBlankHeader(),
      ...header,
      name: safeTrim(header?.name) || "New Intake Template",
      project_type: header?.project_type ?? "",
      project_subtype: header?.project_subtype ?? "",
      description: header?.description ?? "",
      exclusions_text: header?.exclusions_text ?? "",
      assumptions_text: header?.assumptions_text ?? "",
      default_scope: header?.default_scope ?? header?.description ?? "",
      default_clarifications: Array.isArray(header?.default_clarifications)
        ? header.default_clarifications
        : [],
      workflow_profile: normalizeWorkflowProfile(header?.workflow_profile),
      project_materials_hint: header?.project_materials_hint ?? "",
      is_active: header?.is_active !== false,
    });
    setEditMilestones(
      milestoneRows.length
        ? milestoneRows.map((m, idx) => normalizeMilestoneForEdit(m, idx))
        : [buildBlankMilestone(1)]
    );
  }, [location.state]);

  useEffect(() => {
    if (
      !assistantHasMeaningfulContent ||
      !assistantHandoffSignature ||
      assistantHandoffSignature === assistantAppliedRef.current
    ) {
      return;
    }

    const assistantQuestions = (assistantHandoff.clarificationQuestions || [])
      .map((item, idx) => normalizeAssistantQuestion(item, idx))
      .filter(Boolean)
      .map((item) => ({
        key: item.key,
        label: item.label,
        help: item.help,
        required: item.required,
        type: item.type,
        options: Array.isArray(item.options) ? item.options : [],
      }));

      const headerPatch = {
      name:
        safeTrim(assistantHandoff.prefillFields.template_name) ||
        safeTrim(assistantHandoff.prefillFields.template_query) ||
        safeTrim(assistantHandoff.prefillFields.project_type)
          ? `${safeTrim(
              assistantHandoff.prefillFields.template_name ||
                assistantHandoff.prefillFields.template_query ||
                assistantHandoff.prefillFields.project_type
            )} Template`
          : "",
      project_type:
        assistantHandoff.prefillFields.project_type || assistantHandoff.draftPayload.project_type || "",
      project_subtype:
        assistantHandoff.prefillFields.project_subtype ||
        assistantHandoff.draftPayload.project_subtype ||
        "",
      description:
        assistantHandoff.prefillFields.project_summary ||
        assistantHandoff.draftPayload.description ||
        "",
      exclusions_text: assistantHandoff.draftPayload.exclusions_text || "",
      assumptions_text: assistantHandoff.draftPayload.assumptions_text || "",
      default_scope:
        assistantHandoff.prefillFields.project_summary ||
        assistantHandoff.draftPayload.description ||
        "",
      default_clarifications: assistantQuestions,
      workflow_profile: normalizeWorkflowProfile(assistantHandoff.draftPayload.workflow_profile),
    };

    if (
      Object.values(headerPatch).some((value) =>
        Array.isArray(value) ? value.length > 0 : safeTrim(value)
      )
    ) {
      setSelectedId(null);
      setSelectedDetail(null);
      setDetailErr("");
      setGeneratedAiDraft(null);
      setCreatingNew(true);
      setEditMode(true);
      setActiveTab("setup");
      setTemplateAiPrompt("");
      setEditHeader((prev) => ({
        ...prev,
        name: safeTrim(prev.name) || headerPatch.name || prev.name,
        project_type: prev.project_type || headerPatch.project_type || "",
        project_subtype: prev.project_subtype || headerPatch.project_subtype || "",
        description: prev.description || headerPatch.description || "",
        exclusions_text: prev.exclusions_text || headerPatch.exclusions_text || "",
        assumptions_text: prev.assumptions_text || headerPatch.assumptions_text || "",
        default_scope: prev.default_scope || headerPatch.default_scope || "",
        default_clarifications:
          Array.isArray(prev.default_clarifications) && prev.default_clarifications.length
            ? prev.default_clarifications
            : assistantQuestions,
        workflow_profile:
          prev.workflow_profile && Object.keys(prev.workflow_profile || {}).length
            ? prev.workflow_profile
            : headerPatch.workflow_profile,
      }));
      setAssistantPrefillBanner(
        "AI prefilled this template draft from your request. Review the workflow, structure, and clarifications before saving."
      );
    } else {
      setAssistantPrefillBanner("");
    }

    assistantAppliedRef.current = assistantHandoffSignature;
  }, [assistantHandoff, assistantHandoffSignature, assistantHasMeaningfulContent]);

  function startEditMode() {
    if (!selectedDetail || (isSelectedBuiltIn && !adminMode)) return;
    setEditHeader(normalizeHeaderForEdit(selectedDetail));
    setEditMilestones(
      Array.isArray(selectedDetail?.milestones) && selectedDetail.milestones.length
        ? selectedDetail.milestones.map((m, idx) => normalizeMilestoneForEdit(m, idx))
        : [buildBlankMilestone(1)]
    );
    setEditMode(true);
    setCreatingNew(false);
    setActiveTab("setup");
  }

  function cancelEditMode() {
    if (creatingNew) {
      setEditHeader(buildBlankHeader());
      setEditMilestones([buildBlankMilestone(1)]);
      setEditMode(false);
      setCreatingNew(false);
      setDraftSourceTemplateId(null);
      setDraftIsSystemTemplate(Boolean(adminMode));
      return;
    }

    setEditHeader(normalizeHeaderForEdit(selectedDetail));
    setEditMilestones(
      Array.isArray(selectedDetail?.milestones) && selectedDetail.milestones.length
        ? selectedDetail.milestones.map((m, idx) => normalizeMilestoneForEdit(m, idx))
        : [buildBlankMilestone(1)]
    );
    setEditMode(false);
    setDraftIsSystemTemplate(false);
  }

  function updateHeader(field, value) {
    setEditHeader((prev) => ({ ...prev, [field]: value }));
  }

  function updateMilestone(index, patch) {
    setEditMilestones((prev) =>
      prev.map((row, idx) =>
        idx === index
          ? {
              ...row,
              ...patch,
              sort_order:
                Number((patch?.sort_order ?? row.sort_order) || idx + 1) || idx + 1,
            }
          : row
      )
    );
  }

  function autoSequenceTimeline() {
    setEditMilestones((prev) => computeSequentialOffsets(prev));
    toast.success("Timeline sequenced.");
  }

  function addMilestone() {
    setEditMilestones((prev) => [...prev, buildBlankMilestone(prev.length + 1)]);
  }

  function removeMilestone(index) {
    setEditMilestones((prev) =>
      prev
        .filter((_, idx) => idx !== index)
        .map((row, idx) => ({
          ...row,
          sort_order: idx + 1,
          recommended_days_from_start:
            row?.recommended_days_from_start === "" && idx === 0
              ? 0
              : row?.recommended_days_from_start,
        }))
    );
  }

  async function handleDeleteTemplate(template) {
    if (!template?.id) return;
    if (template?.is_system || template?.owner_type === "system") {
      toast.error("Built-in templates cannot be deleted.");
      return;
    }

    const confirmed = window.confirm(
      `Delete template "${template?.name || "Template"}"?`
    );
    if (!confirmed) return;

    try {
      setDeletingId(template.id);
      await api.delete(`/projects/templates/${template.id}/`);
      toast.success("Template deleted.");

      const next = templates.filter((t) => String(t.id) !== String(template.id));
      setTemplates(next);

      if (String(selectedId) === String(template.id)) {
        clearTemplateSelection();
      }
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not delete template."
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleVisibilityChange(nextVisibility) {
    if (!selectedDetail?.id || selectedDetail?.is_system) return;

    try {
      setVisibilitySaving(nextVisibility);
      const payload = {
        visibility: nextVisibility,
      };
      if (nextVisibility === "regional") {
        payload.region_state = regionStateFilter || "";
        payload.region_city = regionCityFilter || "";
        payload.normalized_region_key =
          safeTrim(selectedDetail?.normalized_region_key) || undefined;
      }
      const { data } = await api.post(
        `/projects/templates/${selectedDetail.id}/visibility/`,
        payload
      );
      setSelectedDetail(data);
      toast.success(`Template visibility set to ${nextVisibility}.`);
      await loadTemplates();
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not update template visibility."
      );
    } finally {
      setVisibilitySaving("");
    }
  }

  async function toggleSystemPublish() {
    if (!selectedDetail?.id || !selectedDetail?.is_system) return;

    try {
      setVisibilitySaving("publish");
      const nextIsPublished = !Boolean(selectedDetail?.is_published);
      const { data } = await api.patch(`/projects/templates/${selectedDetail.id}/`, {
        is_published: nextIsPublished,
      });
      setSelectedDetail(data);
      setEditHeader(normalizeHeaderForEdit(data));
      toast.success(nextIsPublished ? "System template published." : "System template unpublished.");
      await loadTemplates();
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not update publish status."
      );
    } finally {
      setVisibilitySaving("");
    }
  }

  async function saveTemplateEdits() {
    const hasBlankTitle = currentMilestones.some((m) => !safeTrim(m?.title));
    if (hasBlankTitle) {
      toast.error("Each milestone needs a title before saving.");
      return;
    }

    if (!safeTrim(currentHeader?.name)) {
      toast.error("Template name is required.");
      setActiveTab("setup");
      return;
    }

    try {
      setSavingTemplate(true);
      const milestonesForSave = needsSequentialOffsets(currentMilestones)
        ? computeSequentialOffsets(currentMilestones)
        : currentMilestones;
      const payload = buildTemplatePayload(currentHeader, milestonesForSave, {
        source_template_id: draftSourceTemplateId || undefined,
        is_system: draftIsSystemTemplate,
        is_published: draftIsSystemTemplate ? Boolean(selectedDetail?.is_published) : undefined,
      });

      if (creatingNew) {
        const { data } = await api.post("/projects/templates/", payload);
        const copiedFromSystem = !adminMode && !!draftSourceTemplateId;
        toast.success(copiedFromSystem ? "Template saved to your templates" : "Template created.");
        await loadTemplates({ source: copiedFromSystem ? "mine" : discoverySource });
        if (copiedFromSystem) {
          setDiscoverySource("mine");
          setKeepEditorOpenAfterSave(true);
        }
        setSelectedId(data?.id || null);
        setSelectedDetail(data);
        setEditHeader(normalizeHeaderForEdit(data));
        setGeneratedAiDraft(null);
        setAiGenerationError("");
        setAiGenerationPartialSections([]);
        setAiGenerationRecoveryMode(false);
        setAiGenerationRecoveryNote("");
        setAssistantPrefillBanner("");
        setDraftSourceTemplateId(null);
        setCreatingNew(false);
        setEditMode(copiedFromSystem);
      } else {
        const { data } = await api.patch(
          `/projects/templates/${selectedDetail.id}/`,
          payload
        );
        setSelectedDetail(data);
        setEditHeader(normalizeHeaderForEdit(data));
        setGeneratedAiDraft(null);
        setAiGenerationError("");
        setAiGenerationPartialSections([]);
        setAiGenerationRecoveryMode(false);
        setAiGenerationRecoveryNote("");
        toast.success("Template updated.");
        await loadTemplates();
        setEditMode(false);
        setDraftSourceTemplateId(null);
      }
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not save template."
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleAiImproveDescription() {
    try {
      setAiBusy(true);
      const { data } = await api.post("/projects/templates/ai/improve-description/", {
        name: currentHeader?.name,
        project_type: currentHeader?.project_type,
        project_subtype: currentHeader?.project_subtype,
        description: currentHeader?.description,
        context: serializeAiContext(buildAiContext({
          page: "templates",
          entityId: selectedDetail?.id || null,
          entityType: "template",
          projectType: currentHeader?.project_type || null,
          projectSubtype: currentHeader?.project_subtype || null,
          existingScope: currentHeader?.description || null,
        })),
      });

      const sections = normalizeTemplateScopeSections(data);
      updateHeader("description", sections.descriptionScope || "");
      updateHeader("default_scope", sections.descriptionScope || "");
      updateHeader("assumptions_text", sections.assumptions || "");
      updateHeader("exclusions_text", sections.exclusions || "");
      toast.success("Description improved.");
    } catch (e) {
      toast.error(formatTemplateAiError(e, "Could not improve description."));
    } finally {
      setAiBusy(false);
    }
  }

  async function handleAiSuggestTypeSubtype() {
    try {
      setAiBusy(true);
      const { data } = await api.post("/projects/templates/ai/suggest-type-subtype/", {
        name: currentHeader?.name,
        description: currentHeader?.description,
        context: serializeAiContext(buildAiContext({
          page: "templates",
          entityId: selectedDetail?.id || null,
          entityType: "template",
          existingScope: currentHeader?.description || null,
        })),
      });

      updateHeader("project_type", data?.project_type || "");
      updateHeader("project_subtype", data?.project_subtype || "");
      toast.success("Type / subtype suggested.");
    } catch (e) {
      toast.error(formatTemplateAiError(e, "Could not suggest type / subtype."));
    } finally {
      setAiBusy(false);
    }
  }

  async function handleAiCreateFromScope(seed = null) {
    const prompt = safeTrim(templateAiPrompt);
    const headerSource = seed || currentHeader || {};
    const descriptionSeed = safeTrim(headerSource?.description || prompt);
    const nameSeed = safeTrim(headerSource?.name);

    if (!descriptionSeed && !nameSeed) {
      toast.error("Add a template name or describe the job first.");
      return;
    }

    try {
      setAiBusy(true);
      setAiGenerationError("");
      setAiGenerationPartialSections([]);
      setAiGenerationRecoveryMode(false);
      setAiGenerationRecoveryNote("");
      const { data } = await api.post("/projects/templates/ai/create-from-scope/", {
        name: nameSeed,
        project_type: headerSource?.project_type,
        project_subtype: headerSource?.project_subtype,
        description: descriptionSeed,
        prompt,
        context: serializeAiContext(buildAiContext({
          page: "templates",
          entityId: selectedDetail?.id || null,
          entityType: "template",
          projectType: headerSource?.project_type || null,
          projectSubtype: headerSource?.project_subtype || null,
          existingScope: descriptionSeed || null,
        })),
      });
      const sections = normalizeTemplateScopeSections(data);
      const workflowProfile = normalizeWorkflowProfile(data?.workflow_profile);
      const nextMilestones = Array.isArray(data?.milestones) && data.milestones.length
        ? data.milestones.map((m, idx) =>
            normalizeMilestoneForEdit(
              {
                ...m,
                recommended_days_from_start:
                  m?.recommended_days_from_start ?? (idx === 0 ? 0 : ""),
              },
              idx
            )
          )
        : [buildBlankMilestone(1)];

      setEditHeader({
        ...headerSource,
        name: data?.name || headerSource?.name || "",
        project_type: data?.project_type || "",
        project_subtype: data?.project_subtype || "",
        description: sections.descriptionScope || "",
        estimated_days: data?.estimated_days || 1,
        default_scope: sections.descriptionScope || "",
        assumptions_text: sections.assumptions || "",
        exclusions_text: sections.exclusions || "",
        default_clarifications: Array.isArray(data?.default_clarifications)
          ? data.default_clarifications
          : [],
        workflow_profile: workflowProfile,
        project_materials_hint: data?.project_materials_hint || "",
      });
      setGeneratedAiDraft(data || null);
      const partialSections = Object.entries(data?.sections_status || {})
        .filter(([, value]) => value && value !== "generated")
        .map(([key]) => key);
      const hasPartialSections = !!data?._partial || partialSections.length > 0;
      setAiGenerationPartialSections(partialSections);
      setAiGenerationRecoveryMode(hasPartialSections);
      setAiGenerationRecoveryNote(
        hasPartialSections
          ? `AI filled the draft with fallback guidance for ${formatAiGenerationSectionLabels(partialSections)}. Review those sections or retry when ready.`
          : ""
      );
      setEditMilestones(
        needsSequentialOffsets(nextMilestones) ? computeSequentialOffsets(nextMilestones) : nextMilestones
      );

      toast.success("AI draft generated. Review and save to add it to your template library.");
      setActiveTab("setup");
    } catch (e) {
      setAiGenerationRecoveryNote("");
      setAiGenerationError(
        formatTemplateAiError(
          e,
          "AI couldn?t finish this template right now. Your draft is still open. You can retry or continue manually."
        )
      );
      setAiGenerationRecoveryMode(true);
      toast.error(
        formatTemplateAiError(
          e,
          "AI couldn?t finish this template right now. Your draft is still open. You can retry or continue manually."
        )
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function handleGenerateTemplateWithAi() {
    const prompt = safeTrim(templateAiPrompt);
    if (!prompt) {
      toast.error("Describe the job first.");
      return;
    }

    const generationSeed = {
      name: "",
      project_type: "",
      project_subtype: "",
      description: prompt,
      project_materials_hint: "",
    };

    openDraftForGeneration(generationSeed);
    await handleAiCreateFromScope(generationSeed);
  }

  async function handleRetryAiGeneration() {
    await handleAiCreateFromScope({
      name: safeTrim(currentHeader?.name),
      project_type: currentHeader?.project_type,
      project_subtype: currentHeader?.project_subtype,
      description: currentHeader?.description || templateAiPrompt,
      project_materials_hint: currentHeader?.project_materials_hint,
    });
  }

  async function handleGenerateDescriptionOnly() {
    if (!creatingNew) {
      openBlankDraftEditor();
      setEditHeader(buildBlankHeader());
      setEditMilestones([buildBlankMilestone(1)]);
    }
    await handleAiImproveDescription();
    setAiGenerationRecoveryMode(true);
    setAiGenerationError("");
    setAiGenerationRecoveryNote(
      "Description updated. You can continue manually or retry the full AI draft when ready."
    );
  }

  function handleContinueManually() {
    setAiGenerationError("");
    setAiGenerationPartialSections([]);
    setAiGenerationRecoveryMode(false);
    setAiGenerationRecoveryNote("");
    setAiGenerationStageIndex(-1);
  }

  function renderAiRecoveryActions() {
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRetryAiGeneration}
          disabled={aiBusy}
          className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          Retry AI Generation
        </button>
        <button
          type="button"
          onClick={handleGenerateDescriptionOnly}
          disabled={aiBusy}
          className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
        >
          Generate Description Only
        </button>
        <button
          type="button"
          onClick={handleContinueManually}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Continue Manually
        </button>
      </div>
    );
  }

  async function handleRefreshMaterialsFromAi() {
    if (!safeTrim(currentHeader?.description) && !safeTrim(currentHeader?.name)) {
      toast.error("Add a template name or description first.");
      return;
    }

    if (!currentMilestones.length) {
      toast.error("Add at least one milestone first.");
      return;
    }

    try {
      setMaterialsRefreshing(true);

      const { data } = await api.post("/projects/templates/ai/generate-materials/", {
        name: currentHeader?.name,
        project_type: currentHeader?.project_type,
        project_subtype: currentHeader?.project_subtype,
        description: currentHeader?.description,
        milestones: currentMilestones.map((m) => ({
          title: m?.title || "",
          description: m?.description || "",
          normalized_milestone_type: m?.normalized_milestone_type || "",
        })),
        context: serializeAiContext(buildAiContext({
          page: "templates",
          entityId: selectedDetail?.id || null,
          entityType: "template",
          projectType: currentHeader?.project_type || null,
          projectSubtype: currentHeader?.project_subtype || null,
          existingScope: currentHeader?.description || null,
          milestoneCount: currentMilestones.length,
        })),
      });

      const incomingMilestones = Array.isArray(data?.milestones) ? data.milestones : [];
      const incomingByTitle = new Map(
        incomingMilestones.map((m) => [normalizeTitleForMatch(m?.title), m])
      );

      setEditHeader((prev) => ({
        ...prev,
        project_materials_hint:
          data?.project_materials_hint || prev?.project_materials_hint || "",
      }));

      setEditMilestones((prev) =>
        prev.map((m, idx) => {
          const byTitle = incomingByTitle.get(normalizeTitleForMatch(m?.title));
          const byIndex = incomingMilestones[idx];
          const matched = byTitle || byIndex || null;

          return {
            ...m,
            materials_hint:
              safeTrim(matched?.materials_hint) || m?.materials_hint || "",
          };
        })
      );

      toast.success("Materials suggestions refreshed.");
      setActiveTab("materials");
    } catch (e) {
      toast.error(formatTemplateAiError(e, "Could not refresh materials."));
    } finally {
      setMaterialsRefreshing(false);
    }
  }

  return (
    <ContractorPageSurface
      eyebrow={adminMode ? "Admin" : "Core"}
      title={adminMode ? "Admin Templates" : "Templates"}
      subtitle={
        adminMode
          ? "Configure reusable workflow starters, milestone structures, and system guidance for the platform."
          : "Build reusable workflow structures that turn repeatable work into faster, smarter agreements."
      }
      actions={null}
      variant="operational"
      className="mhb-templates-studio"
    >

      <div className="mhb-template-discovery-toolbar mb-4 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm text-slate-600">
          {adminMode
            ? "Manage reusable platform templates. Publish system starters, duplicate contractor templates, and keep milestone structure consistent."
            : "Use templates to quickly create consistent agreements with predefined scope, milestones, and pricing."}
        </div>
        <div className="flex flex-wrap gap-2">
          {adminMode ? (
            <>
              <TabButton
                data-testid="templates-market-tab-all"
                active={discoverySource === "all"}
                onClick={() => setDiscoverySource("all")}
              >
                All Templates
              </TabButton>
              <TabButton
                data-testid="templates-market-tab-system"
                active={discoverySource === "system"}
                onClick={() => setDiscoverySource("system")}
              >
                System Templates
              </TabButton>
              <TabButton
                data-testid="templates-market-tab-regional"
                active={discoverySource === "regional"}
                onClick={() => setDiscoverySource("regional")}
              >
                Regional Templates
              </TabButton>
              <TabButton
                data-testid="templates-market-tab-public"
                active={discoverySource === "public"}
                onClick={() => setDiscoverySource("public")}
              >
                Public Templates
              </TabButton>
            </>
          ) : (
            <>
              <TabButton
                data-testid="templates-market-tab-mine"
                active={discoverySource === "mine"}
                onClick={() => setDiscoverySource("mine")}
              >
                My Templates
              </TabButton>
              <TabButton
                data-testid="templates-market-tab-system"
                active={discoverySource === "system"}
                onClick={() => setDiscoverySource("system")}
              >
                System Templates
              </TabButton>
              <TabButton
                data-testid="templates-market-tab-regional"
                active={discoverySource === "regional"}
                onClick={() => setDiscoverySource("regional")}
              >
                Regional Templates
              </TabButton>
              <TabButton
                data-testid="templates-market-tab-public"
                active={discoverySource === "public"}
                onClick={() => setDiscoverySource("public")}
              >
                Public Templates
              </TabButton>
            </>
          )}
        </div>

        <div className="mhb-template-filter-grid mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <div className="xl:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-800">
              Search Templates
            </label>
              <input
                type="text"
                data-testid="templates-search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder='Search by name, type, subtype, or keyword like "bathroom"...'
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">
              Project Type
            </label>
            <input
              value={projectTypeFilter}
              onChange={(e) => setProjectTypeFilter(e.target.value)}
              placeholder="Remodel"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">
              Project Subtype
            </label>
            <input
              value={projectSubtypeFilter}
              onChange={(e) => setProjectSubtypeFilter(e.target.value)}
              placeholder="Kitchen Remodel"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">
              State
            </label>
            <input
              value={regionStateFilter}
              onChange={(e) => setRegionStateFilter(e.target.value)}
              placeholder="TX"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">
              Sort
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="relevant">Most relevant</option>
              <option value="most_used">Most used</option>
              <option value="regional">Best regional match</option>
              <option value="newest">Newest</option>
              <option value="benchmark">Best benchmark support</option>
            </select>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-slate-500">
          Discovery respects template visibility rules. Private templates stay private, while system, regional, and public templates surface only when allowed by policy and region relevance.
        </div>
      </div>

      {err ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {showIntakePrefillBanner ? (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <div className="text-sm font-semibold text-indigo-900">Template Draft From Intake</div>
          <div className="mt-1 text-sm text-indigo-800">
            This draft was prefilled from intake analysis. Review the template details, milestones, and clarifications before saving it to your template library.
          </div>
        </div>
      ) : null}

      {!showIntakePrefillBanner && assistantPrefillBanner ? (
        <div
          data-testid="templates-assistant-prefill-banner"
          className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3"
        >
          <div className="text-sm font-semibold text-indigo-900">Template Draft From AI</div>
          <div className="mt-1 text-sm text-indigo-800">{assistantPrefillBanner}</div>
        </div>
      ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="mhb-template-library rounded-[22px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">
              Template Library
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {filteredTemplates.length} template{filteredTemplates.length === 1 ? "" : "s"} found
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Select a template to edit or create a new one.
            </div>
            {creatingNew ? (
              <div className="mt-2 text-xs font-semibold text-slate-500">
                Start a new template
              </div>
            ) : null}
          </div>

          <div className="max-h-[70vh] overflow-auto">
            {loading ? (
              <div className="px-4 py-4 text-sm text-slate-500">Loading templates…</div>
            ) : !filteredTemplates.length ? (
              <div className="px-4 py-4 text-sm text-slate-500">No templates found.</div>
            ) : (
              <>
                {customTemplates.length ? (
                  <div>
                    <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                      {discoverySource === "regional"
                        ? "Regional Templates"
                        : discoverySource === "public"
                        ? "Public Templates"
                        : "My Templates"}
                    </div>
                    {customTemplates.map((tpl) => {
                      const isSelected = !creatingNew && String(selectedId) === String(tpl.id);
                      const ownerType =
                        tpl?.owner_type || (tpl?.is_system ? "system" : "contractor");

                      return (
                        <button
                          key={`custom-${tpl.id}`}
                          data-testid={`template-discovery-card-${tpl.id}`}
                          type="button"
                          onClick={() => setSelectedId(tpl.id)}
                          className={`w-full border-b border-slate-200 px-4 py-3 text-left hover:bg-indigo-50 ${
                            isSelected ? "bg-indigo-50" : "bg-white"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-slate-900">
                              {tpl?.name || "Template"}
                            </div>
                            <OptionBadge ownerType={ownerType} />
                            {ownerType !== "system" ? (
                              <VisibilityBadge visibility={tpl?.visibility || tpl?.source_label} />
                            ) : null}
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {[safeTrim(tpl?.project_type), safeTrim(tpl?.project_subtype)]
                              .filter(Boolean)
                              .join(" • ")}
                            {tpl?.milestone_count ? ` • ${tpl.milestone_count} milestones` : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {builtInTemplates.length ? (
                  <div>
                    <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                      System Templates
                    </div>
                    {builtInTemplates.map((tpl) => {
                      const isSelected = !creatingNew && String(selectedId) === String(tpl.id);
                      const ownerType =
                        tpl?.owner_type || (tpl?.is_system ? "system" : "contractor");

                      return (
                        <button
                          key={`system-${tpl.id}`}
                          data-testid={`template-discovery-card-${tpl.id}`}
                          type="button"
                          onClick={() => setSelectedId(tpl.id)}
                          className={`w-full border-b border-slate-200 px-4 py-3 text-left hover:bg-indigo-50 ${
                            isSelected ? "bg-indigo-50" : "bg-white"
                          }`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-slate-900">
                              {tpl?.name || "Template"}
                            </div>
                            <OptionBadge ownerType={ownerType} />
                            {ownerType !== "system" ? (
                              <VisibilityBadge visibility={tpl?.visibility || tpl?.source_label} />
                            ) : null}
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            {[safeTrim(tpl?.project_type), safeTrim(tpl?.project_subtype)]
                              .filter(Boolean)
                              .join(" • ")}
                            {tpl?.milestone_count ? ` • ${tpl.milestone_count} milestones` : ""}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="mhb-template-editor-shell rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900">
                {creatingNew
                  ? "New Template Draft"
                  : editMode
                  ? "Template Editor"
                  : "Template Preview"}
              </div>

              <div className="flex flex-wrap gap-2">
                {!editMode && !creatingNew && selectedDetail && (adminMode || !isSelectedBuiltIn) ? (
                  <button
                    type="button"
                    onClick={startEditMode}
                    data-testid="templates-edit-button"
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                  >
                    Edit Template
                  </button>
                ) : null}

                {!editMode && !creatingNew && adminMode && selectedDetail && !selectedDetail?.is_system ? (
                  <button
                    type="button"
                    onClick={() =>
                      openDraftFromExistingTemplate(
                        selectedDetail,
                        "Duplicated from a contractor template. Review and publish it as a system starter.",
                        { asSystem: true }
                      )
                    }
                    data-testid="templates-duplicate-contractor-button"
                    className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                  >
                    Duplicate from Contractor Template
                  </button>
                ) : null}

                {(editMode || creatingNew) ? (
                  <>
                    <button
                      type="button"
                      onClick={cancelEditMode}
                      data-testid="templates-cancel-button"
                      disabled={savingTemplate}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      onClick={saveTemplateEdits}
                      data-testid="templates-save-button"
                      ref={saveButtonRef}
                      disabled={savingTemplate}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60 ${
                        creatingNew && generatedAiDraft
                          ? "bg-amber-600 hover:bg-amber-700"
                          : "bg-indigo-600 hover:bg-indigo-700"
                      }`}
                    >
                      {savingTemplate ? "Saving…" : creatingNew ? (adminMode && draftIsSystemTemplate ? "Create System Template" : "Create Template") : "Save Template"}
                    </button>
                  </>
                ) : null}

                {!editMode && !creatingNew && adminMode && selectedDetail?.is_system ? (
                  <button
                    type="button"
                    onClick={toggleSystemPublish}
                    disabled={visibilitySaving === "publish"}
                    data-testid="templates-publish-toggle"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {selectedDetail?.is_published ? "Unpublish" : "Publish"}
                  </button>
                ) : null}

                {!creatingNew && selectedDetail && !selectedDetail?.is_system ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(selectedDetail)}
                      disabled={deletingId === selectedDetail?.id}
                      className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                    >
                      {deletingId === selectedDetail?.id ? "Deleting…" : "Delete"}
                    </button>
                    <button
                      type="button"
                      data-testid="template-visibility-private"
                      onClick={() => handleVisibilityChange("private")}
                      disabled={visibilitySaving === "private"}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Private
                    </button>
                    <button
                      type="button"
                      data-testid="template-visibility-regional"
                      onClick={() => handleVisibilityChange("regional")}
                      disabled={visibilitySaving === "regional"}
                      className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                    >
                      Regional
                    </button>
                    <button
                      type="button"
                      data-testid="template-visibility-public"
                      onClick={() => handleVisibilityChange("public")}
                      disabled={visibilitySaving === "public"}
                      className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-60"
                    >
                      Public
                    </button>
                  </>
                ) : null}

                {!adminMode && selectedDetail && isSelectedBuiltIn ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        openDraftFromExistingTemplate(
                          selectedDetail,
                          "Using this built-in template as the starting point for a new draft in My Templates."
                        )
                      }
                      className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                    >
                      Use Template
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openDraftFromExistingTemplate(
                          selectedDetail,
                          "Copied from a built-in template. Review, edit, and save it to your template library."
                        )
                      }
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Save to My Templates
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {detailLoading && !creatingNew ? (
            <div className="px-4 py-6 text-sm text-slate-500">Loading template preview…</div>
          ) : detailErr && !creatingNew ? (
            <div className="px-4 py-6 text-sm text-red-600">{detailErr}</div>
          ) : !selectedTemplate && !creatingNew ? (
            <div className="px-4 py-6 text-sm text-slate-500">
              {isSystemDiscovery ? (
                <div data-testid="templates-system-empty-state">
                  <div className="text-base font-semibold text-slate-900">
                    Select a system template to preview it.
                  </div>
                  <div className="mt-1">
                    System templates are built by MyHomeBro and can be used as-is or duplicated into My Templates.
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-base font-semibold text-slate-900">
                    {adminMode ? "Create a system template" : "Start a new template"}
                  </div>
                  <div className="mt-1">
                    {adminMode
                      ? "Start blank or duplicate a contractor template, then publish it as a reusable system starter."
                      : "Start blank or describe the job and let AI create a draft."}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={startNewTemplate}
                      data-testid="templates-new-draft-button"
                      className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
                    >
                      {adminMode ? "Create System Template" : "New Template Draft"}
                    </button>
                  </div>
                  <div className="mt-4 flex flex-col gap-2 sm:max-w-lg">
                    <label className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Describe the job
                    </label>
                    <input
                      data-testid="templates-ai-prompt-input"
                      type="text"
                      value={templateAiPrompt}
                      onChange={(e) => setTemplateAiPrompt(e.target.value)}
                      placeholder="Describe the job…"
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
                    />
                    <div className="text-[11px] text-slate-500">
                      AI will draft the description, milestones, pricing guidance, materials, timeline, and clarifying questions.
                    </div>
                    <button
                      type="button"
                      onClick={handleGenerateTemplateWithAi}
                      data-testid="templates-generate-ai-button"
                      disabled={aiBusy}
                      className="inline-flex w-fit rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {aiBusy ? `Working… ${getAiGenerationStepLabel(aiGenerationStageIndex)}` : "✨ Generate Draft with AI"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mhb-template-editor p-4" data-testid="templates-draft-editor" ref={editorPanelRef}>
              {creatingNew && generatedAiDraft ? (
                <div
                  data-testid="templates-ai-unsaved-banner"
                  className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  <div className="font-semibold">AI draft generated</div>
                  <div className="mt-1">
                    Review and edit below, then click Save Template to add it to your template library.
                  </div>
                </div>
              ) : null}

              {aiBusy ? (
                <div
                  data-testid="templates-ai-progress"
                  className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{getAiGenerationStepLabel(aiGenerationStageIndex)}</div>
                      <div className="mt-1 text-sm text-indigo-800">
                        AI is drafting this template step by step. The editor stays open while it works.
                      </div>
                    </div>
                    <div className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                      Step {Math.max(aiGenerationStageIndex, 0) + 1} of {AI_GENERATION_STEP_ITEMS.length}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {AI_GENERATION_STEP_ITEMS.map((step, idx) => {
                      const active = idx === Math.max(aiGenerationStageIndex, 0);
                      const done = idx < Math.max(aiGenerationStageIndex, 0);
                      return (
                        <span
                          key={step.key}
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            active
                              ? "border-indigo-300 bg-indigo-600 text-white"
                              : done
                              ? "border-indigo-200 bg-indigo-100 text-indigo-800"
                              : "border-slate-200 bg-white text-slate-500"
                          }`}
                        >
                          {done ? "✓ " : ""}
                          {step.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!aiBusy && aiGenerationRecoveryNote && !aiGenerationError ? (
                <div
                  data-testid="templates-ai-recovery-banner"
                  className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                >
                  <div className="font-semibold">AI draft generated with fallback sections</div>
                  <div className="mt-1">{aiGenerationRecoveryNote}</div>
                  {aiGenerationRecoveryMode && aiGenerationPartialSections.length ? (
                    <div className="mt-2 text-xs text-amber-700">
                      Fallback sections: {formatAiGenerationSectionLabels(aiGenerationPartialSections)}
                    </div>
                  ) : null}
                  {renderAiRecoveryActions()}
                </div>
              ) : null}

              {aiGenerationError ? (
                <div
                  data-testid="templates-ai-error-banner"
                  className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                >
                  <div className="font-semibold">
                    AI couldn’t finish this template right now. Your draft is still open. You can retry or continue manually.
                  </div>
                  <div className="mt-1 text-sm text-rose-800">{aiGenerationError}</div>
                  {aiGenerationRecoveryMode && aiGenerationPartialSections.length ? (
                    <div className="mt-2 text-xs text-rose-700">
                      Partial sections: {formatAiGenerationSectionLabels(aiGenerationPartialSections)}
                    </div>
                  ) : null}
                  {renderAiRecoveryActions()}
                </div>
              ) : null}

              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 data-testid="templates-detail-name" className="text-lg font-bold text-slate-900">
                      {safeTrim(currentHeader?.name) || "Untitled Template"}
                    </h2>
                    {creatingNew ? (
                      <span
                        data-testid="templates-unsaved-draft-badge"
                        className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800"
                      >
                        Unsaved Draft
                      </span>
                    ) : null}
                    {!creatingNew ? (
                      <OptionBadge
                        ownerType={
                          selectedDetail?.owner_type ||
                          (selectedDetail?.is_system ? "system" : "contractor")
                        }
                      />
                    ) : (
                      <OptionBadge ownerType="contractor" />
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    {safeTrim(currentHeader?.project_type) ? (
                      <span data-testid="templates-detail-type" className="rounded bg-slate-100 px-2 py-1">
                        {currentHeader.project_type}
                      </span>
                    ) : null}
                    {safeTrim(currentHeader?.project_subtype) ? (
                      <span data-testid="templates-detail-subtype" className="rounded bg-slate-100 px-2 py-1">
                        {currentHeader.project_subtype}
                      </span>
                    ) : null}
                    <span className="rounded bg-slate-100 px-2 py-1">
                      {currentMilestones.length} milestones
                    </span>
                    <span className="rounded bg-slate-100 px-2 py-1">
                      {Number(currentHeader?.estimated_days || 0) > 0
                        ? currentHeader.estimated_days
                        : 1}{" "}
                      day{Number(currentHeader?.estimated_days || 0) === 1 ? "" : "s"}
                    </span>
                    {!creatingNew && !isSelectedBuiltIn ? (
                      <span className="rounded bg-slate-100 px-2 py-1">
                        Visibility: {safeTrim(selectedDetail?.visibility || selectedDetail?.source_label) || "private"}
                      </span>
                    ) : null}
                    {!creatingNew && !isSelectedBuiltIn && safeTrim(selectedDetail?.normalized_region_key) ? (
                      <span className="rounded bg-slate-100 px-2 py-1">
                        Region: {formatRegionLabel(selectedDetail.normalized_region_key)}
                      </span>
                    ) : null}
                    {!creatingNew && Number(selectedDetail?.usage_count || 0) > 0 ? (
                      <span className="rounded bg-slate-100 px-2 py-1">
                        Used {selectedDetail.usage_count}x
                      </span>
                    ) : null}
                  </div>
                </div>
                {!creatingNew && selectedTemplate ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={clearTemplateSelection}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Back to Start
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                <TabButton
                  data-testid="templates-tab-setup"
                  active={activeTab === "setup"}
                  onClick={() => setActiveTab("setup")}
                >
                  Project Setup
                </TabButton>
                <TabButton
                  data-testid="templates-tab-milestones"
                  active={activeTab === "milestones"}
                  onClick={() => {
                    setActiveTab("milestones");
                    setAssistantField("milestones");
                  }}
                >
                  Milestones
                </TabButton>
                <TabButton
                  data-testid="templates-tab-pricing"
                  active={activeTab === "pricing"}
                  onClick={() => setActiveTab("pricing")}
                >
                  Pricing
                </TabButton>
                <TabButton
                  data-testid="templates-tab-schedule"
                  active={activeTab === "schedule"}
                  onClick={() => setActiveTab("schedule")}
                >
                  Workflow Timing
                </TabButton>
                <TabButton
                  data-testid="templates-tab-materials"
                  active={activeTab === "materials"}
                  onClick={() => setActiveTab("materials")}
                >
                  Materials
                </TabButton>
              </div>

              <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                Templates are applied when creating a new agreement.
              </div>

              {activeTab === "setup" ? (
                <SectionCard title="Project Setup">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Template Name</label>
                      <input
                        data-testid="templates-name-input"
                        ref={draftNameInputRef}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={currentHeader?.name || ""}
                        onChange={(e) => updateHeader("name", e.target.value)}
                        disabled={!editMode && !creatingNew}
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium">Estimated Project Days</label>
                      <input
                        type="number"
                        min="1"
                        data-testid="templates-estimated-days-input"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={currentHeader?.estimated_days || 1}
                        onChange={(e) => updateHeader("estimated_days", e.target.value)}
                        disabled={!editMode && !creatingNew}
                      />
                      <div className="mt-1 text-[11px] text-slate-500">
                        Estimated total project duration. Milestone count is driven by the milestones below.
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium">Project Type</label>
                      <div className="flex items-start gap-2">
                        <input
                          data-testid="templates-project-type-input"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={currentHeader?.project_type || ""}
                          onChange={(e) => updateHeader("project_type", e.target.value)}
                          disabled={!editMode && !creatingNew}
                          placeholder="e.g., Remodel, Outdoor, Addition"
                        />
                        {(editMode || creatingNew) ? (
                          <button
                            type="button"
                            onClick={handleAiSuggestTypeSubtype}
                            disabled={aiBusy}
                            data-testid="templates-ai-suggest-button"
                            className="shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                          >
                            {aiBusy ? "Working…" : "✨ Suggest Type / Subtype"}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium">Project Subtype</label>
                      <div className="flex items-start gap-2">
                        <input
                          data-testid="templates-project-subtype-input"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          value={currentHeader?.project_subtype || ""}
                          onChange={(e) => updateHeader("project_subtype", e.target.value)}
                          disabled={!editMode && !creatingNew}
                          placeholder="e.g., Bathroom Remodel, Deck Build"
                        />
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="block text-sm font-medium">Description / Scope</label>
                        {(editMode || creatingNew) ? (
                          <button
                            type="button"
                            onClick={handleAiImproveDescription}
                            disabled={aiBusy}
                            data-testid="templates-ai-improve-description-button"
                            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                          >
                            {aiBusy ? "Working…" : "✨ Improve Description"}
                          </button>
                        ) : null}
                      </div>
                      <textarea
                        data-testid="templates-description-input"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        rows={6}
                        value={currentHeader?.description || ""}
                        onChange={(e) => {
                          setAssistantField("description");
                          updateHeader("description", e.target.value);
                          updateHeader("default_scope", e.target.value);
                        }}
                        onFocus={() => setAssistantField("description")}
                        disabled={!editMode && !creatingNew}
                        placeholder="Describe the reusable project template in generic terms..."
                      />
                      <div className="mt-2 text-xs text-slate-500">
                        This description should be generic and reusable across projects.
                        Avoid exact measurements or quantities — flexible workflow details can be tuned later.
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium">Exclusions</label>
                      <textarea
                        data-testid="templates-exclusions-input"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        rows={5}
                        value={currentHeader?.exclusions_text || ""}
                        onChange={(e) => updateHeader("exclusions_text", e.target.value)}
                        onFocus={() => setAssistantField("exclusions")}
                        disabled={!editMode && !creatingNew}
                        placeholder="List what is commonly excluded from this template scope..."
                      />
                      <div className="mt-2 text-xs text-slate-500">
                        Use reusable exclusions to define what stays outside the standard template scope.
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium">Assumptions</label>
                      <textarea
                        data-testid="templates-assumptions-input"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        rows={4}
                        value={currentHeader?.assumptions_text || ""}
                        onChange={(e) => updateHeader("assumptions_text", e.target.value)}
                        onFocus={() => setAssistantField("exclusions")}
                        disabled={!editMode && !creatingNew}
                        placeholder="List reusable assumptions that define standard conditions..."
                      />
                      <div className="mt-2 text-xs text-slate-500">
                        Assumptions clarify expected access, site conditions, selections, and responsibilities for similar jobs.
                      </div>
                    </div>

                    <div
                      data-testid="templates-workflow-profile"
                      className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Workflow Profile</div>
                          <div className="text-xs text-slate-500">
                            Shape the template as hourly help, session-based support, or milestone-driven collaboration.
                          </div>
                        </div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Assisted DIY Workflow
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">Assistance Format</label>
                          <select
                            data-testid="templates-workflow-assistance-format"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={currentHeader?.workflow_profile?.assistance_format || "milestone_based"}
                            onChange={(e) =>
                              updateHeader("workflow_profile", {
                                ...normalizeWorkflowProfile(currentHeader?.workflow_profile),
                                assistance_format: e.target.value,
                              })
                            }
                            disabled={!editMode && !creatingNew}
                          >
                            {WORKFLOW_ASSISTANCE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">Scheduling Mode</label>
                          <select
                            data-testid="templates-workflow-scheduling-mode"
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            value={currentHeader?.workflow_profile?.scheduling_mode || "milestone_driven"}
                            onChange={(e) =>
                              updateHeader("workflow_profile", {
                                ...normalizeWorkflowProfile(currentHeader?.workflow_profile),
                                scheduling_mode: e.target.value,
                              })
                            }
                            disabled={!editMode && !creatingNew}
                          >
                            {WORKFLOW_SCHEDULING_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">Billing Style</label>
                          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {safeTrim(currentHeader?.workflow_profile?.billing_style) || "milestone"}
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500">
                            Used as guidance for hourly, session, milestone, or consultation-based workflows.
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-700">
                          Participation Structure
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {WORKFLOW_PARTICIPATION_OPTIONS.map((option) => {
                            const selected =
                              Array.isArray(currentHeader?.workflow_profile?.participation_structure) &&
                              currentHeader.workflow_profile.participation_structure.includes(option.value);
                            return (
                              <label
                                key={option.value}
                                className={`inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                  selected
                                    ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="sr-only"
                                  checked={selected}
                                  onChange={(e) => {
                                    const current = Array.isArray(currentHeader?.workflow_profile?.participation_structure)
                                      ? currentHeader.workflow_profile.participation_structure
                                      : [];
                                    const next = e.target.checked
                                      ? Array.from(new Set([...current, option.value]))
                                      : current.filter((item) => item !== option.value);
                                    updateHeader("workflow_profile", {
                                      ...normalizeWorkflowProfile(currentHeader?.workflow_profile),
                                      participation_structure: next,
                                    });
                                  }}
                                  disabled={!editMode && !creatingNew}
                                />
                                {option.label}
                              </label>
                            );
                          })}
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          Keep homeowner-safe prep, shared tasks, and contractor-led technical work flexible per trade.
                        </div>
                      </div>
                    </div>
                  </div>

                  {previewClarifications.length ? (
                    <div className="mt-4">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                        Clarification Questions
                      </div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {previewClarifications.map((item, idx) => (
                          <li key={`${item}-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {generatedAiDraft ? (
                    <div
                      data-testid="templates-generated-ai-summary"
                      className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3"
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
                        Generated AI Plan
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-indigo-900 md:grid-cols-2">
                        <div className="rounded-md bg-white/80 px-3 py-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                            Timeline
                          </div>
                          <div className="mt-1">{generatedTimeline || "Estimated timeline not provided yet."}</div>
                        </div>
                        <div className="rounded-md bg-white/80 px-3 py-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                            Pricing range
                          </div>
                          <div className="mt-1">{safeTrim(generatedPricingGuidance?.total_range) || "Consult contractor for pricing"}</div>
                        </div>
                        <div className="rounded-md bg-white/80 px-3 py-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                            Materials
                          </div>
                          <div className="mt-1">
                            {generatedMaterials.length
                              ? `${generatedMaterials.length} material ${generatedMaterials.length === 1 ? "category" : "categories"} suggested.`
                              : "Materials suggestions are available in the Materials tab."}
                          </div>
                        </div>
                        <div className="rounded-md bg-white/80 px-3 py-2">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                            Workflow
                          </div>
                          <div className="mt-1">
                            {safeTrim(generatedAiDraft?.workflow_profile?.assistance_format) || safeTrim(currentHeader?.workflow_profile?.assistance_format)
                              ? `${workflowAssistanceLabel(
                                  generatedAiDraft?.workflow_profile?.assistance_format ||
                                    currentHeader?.workflow_profile?.assistance_format
                                )} / ${workflowSchedulingLabel(
                                  generatedAiDraft?.workflow_profile?.scheduling_mode ||
                                    currentHeader?.workflow_profile?.scheduling_mode
                                )}`
                              : "Flexible workflow settings are ready to edit."}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div
                    data-testid="templates-template-insights"
                    className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                      Template Insights
                    </div>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {templateInsightLines.map((line, idx) => (
                        <li key={`template-insight-${idx}`} className="flex gap-2">
                          <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </SectionCard>
              ) : null}

              {activeTab === "milestones" ? (
                <SectionCard title="Milestones">
                  <div className="mb-2 text-xs text-slate-500">
                    Define reusable project phases. Keep descriptions general — project-specific details will be captured later.
                  </div>

                  {(editMode || creatingNew) ? (
                    <>
                      <div className="mb-3">
                        <button
                          type="button"
                          onClick={addMilestone}
                          data-testid="templates-add-milestone-button"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Add Milestone
                        </button>
                      </div>

                      <div className="space-y-3">
                        {currentMilestones.map((m, idx) => (
                          <div key={m?.id || `m-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <div className="text-sm font-semibold text-slate-900">
                                Milestone {idx + 1}
                              </div>
                              {currentMilestones.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={() => removeMilestone(idx)}
                                  className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                              <div className="md:col-span-2">
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Title</label>
                                <input
                                  data-testid={`templates-milestone-title-${idx + 1}`}
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  value={m?.title || ""}
                                  onChange={(e) => updateMilestone(idx, { title: e.target.value })}
                                  onFocus={() => setAssistantField("milestones")}
                                />
                              </div>

                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Sort Order</label>
                                <input
                                  type="number"
                                  min="1"
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  value={m?.sort_order || idx + 1}
                                  onChange={(e) => updateMilestone(idx, { sort_order: e.target.value })}
                                />
                              </div>

                              <div className="md:col-span-4">
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Description</label>
                                <textarea
                                  data-testid={`templates-milestone-description-${idx + 1}`}
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  rows={3}
                                  value={m?.description || ""}
                                  onChange={(e) => updateMilestone(idx, { description: e.target.value })}
                                  onFocus={() => setAssistantField("milestones")}
                                />
                              </div>

                              <div className="md:col-span-2">
                                <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={!!m?.is_optional}
                                    onChange={(e) => updateMilestone(idx, { is_optional: e.target.checked })}
                                  />
                                  Optional milestone
                                </label>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      {currentMilestones.map((m, idx) => (
                        <div
                          key={m?.id || `pm-${idx}`}
                          data-testid={`templates-preview-milestone-${idx + 1}`}
                          className="rounded-lg border border-slate-200 bg-white p-3"
                        >
                          <div className="text-sm font-semibold text-slate-900">
                            {idx + 1}. {m?.title || "Untitled milestone"}
                          </div>
                          {safeTrim(m?.description) ? (
                            <div className="mt-1 text-xs text-slate-600">{m.description}</div>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                            {m?.is_optional ? (
                              <span className="rounded bg-slate-100 px-2 py-1">Optional</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              ) : null}

              {activeTab === "pricing" ? (
                <SectionCard title="Pricing">
                  <div className="mb-2 text-xs text-slate-500">
                    Template pricing is advisory only. Reusable templates should not store enforced milestone prices.
                  </div>
                  <div className="mb-3 text-[11px] text-slate-500">
                    If you add advisory pricing, contractors can review it later without the template enforcing a fixed amount.
                  </div>

                  {generatedPricingGuidance ? (
                    <div
                      data-testid="templates-generated-pricing-guidance"
                      className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
                        AI Pricing Guidance
                      </div>
                      <div className="mt-2 text-sm">
                        Range: <span className="font-semibold">{safeTrim(generatedPricingGuidance?.total_range) || "Consult contractor for pricing"}</span>
                      </div>
                      <div className="mt-2 text-sm text-indigo-800">
                        {formatGuidancePercentages(generatedPricingGuidance?.milestone_percentages)}
                      </div>
                    </div>
                  ) : null}

                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left [&>*]:px-3 [&>*]:py-2">
                          <th>Milestone</th>
                          <th>Advisory Amount</th>
                          <th>Min</th>
                          <th>Max</th>
                          <th>Confidence</th>
                          <th>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentMilestones.map((m, idx) => (
                          <tr key={m?.id || `p-${idx}`} className="border-t">
                            <td className="px-3 py-2 font-medium text-slate-900">
                              {m?.title || `Milestone ${idx + 1}`}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <div className="space-y-2">
                                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={!!m?.pricing_advisory}
                                      onChange={(e) =>
                                        updateMilestone(idx, { pricing_advisory: e.target.checked })
                                      }
                                    />
                                    Advisory pricing
                                  </label>
                                  {m?.pricing_advisory ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                                      value={m?.suggested_amount_fixed || ""}
                                      onChange={(e) =>
                                        updateMilestone(idx, {
                                          pricing_advisory: true,
                                          suggested_amount_fixed: e.target.value,
                                        })
                                      }
                                    />
                                  ) : (
                                    <span className="text-xs text-slate-500">No fixed pricing stored.</span>
                                  )}
                                </div>
                              ) : hasAnyPricing(m) && m?.pricing_advisory ? (
                                toMoney(m?.suggested_amount_fixed) || "—"
                              ) : (
                                <span className="text-xs text-slate-500">No fixed pricing stored.</span>
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                m?.pricing_advisory ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                    value={m?.suggested_amount_low || ""}
                                    onChange={(e) =>
                                      updateMilestone(idx, {
                                        pricing_advisory: true,
                                        suggested_amount_low: e.target.value,
                                      })
                                    }
                                  />
                                ) : (
                                  <span className="text-xs text-slate-500">—</span>
                                )
                              ) : hasAnyPricing(m) && m?.pricing_advisory ? (
                                toMoney(m?.suggested_amount_low) || "—"
                              ) : (
                                <span className="text-xs text-slate-500">—</span>
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                m?.pricing_advisory ? (
                                  <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                    value={m?.suggested_amount_high || ""}
                                    onChange={(e) =>
                                      updateMilestone(idx, {
                                        pricing_advisory: true,
                                        suggested_amount_high: e.target.value,
                                      })
                                    }
                                  />
                                ) : (
                                  <span className="text-xs text-slate-500">—</span>
                                )
                              ) : hasAnyPricing(m) && m?.pricing_advisory ? (
                                toMoney(m?.suggested_amount_high) || "—"
                              ) : (
                                <span className="text-xs text-slate-500">—</span>
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                m?.pricing_advisory ? (
                                  <select
                                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                                    value={m?.pricing_confidence || ""}
                                    onChange={(e) =>
                                      updateMilestone(idx, {
                                        pricing_advisory: true,
                                        pricing_confidence: e.target.value,
                                      })
                                    }
                                  >
                                    <option value="">Not set</option>
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                  </select>
                                ) : (
                                  <span className="text-xs text-slate-500">—</span>
                                )
                              ) : (
                                <ConfidenceBadge value={m?.pricing_confidence || ""} />
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                m?.pricing_advisory ? (
                                  <input
                                    className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-sm"
                                    value={m?.pricing_source_note || ""}
                                    onChange={(e) =>
                                      updateMilestone(idx, {
                                        pricing_advisory: true,
                                        pricing_source_note: e.target.value,
                                      })
                                    }
                                  />
                                ) : (
                                  <span className="text-xs text-slate-500">Advisory only</span>
                                )
                              ) : (
                                m?.pricing_advisory ? safeTrim(m?.pricing_source_note) || "—" : "Advisory only"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                      Advisory Pricing Summary
                    </div>

                    {currentMilestones.some((row) => row?.pricing_advisory) ? (
                      <>
                        <div className="mt-2 flex flex-wrap gap-3 text-sm">
                          <div className="rounded border border-slate-200 bg-white px-3 py-2 text-slate-700">
                            Min:{" "}
                            <span className="font-semibold text-slate-900">
                              {moneyOrDash(pricingTotals.low)}
                            </span>
                          </div>
                          <div className="rounded border border-slate-200 bg-white px-3 py-2 text-slate-700">
                            Max:{" "}
                            <span className="font-semibold text-slate-900">
                              {moneyOrDash(pricingTotals.high)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 text-[11px] text-slate-500">
                          Advisory pricing is visible for review only. Templates should not enforce fixed dollar amounts.
                        </div>
                      </>
                    ) : (
                      <div className="mt-2 text-sm text-slate-600">
                        No fixed pricing is stored on this template.
                      </div>
                    )}
                  </div>
                </SectionCard>
              ) : null}

              {activeTab === "schedule" ? (
                <SectionCard title="Workflow Timing">
                  <div className="mb-2 text-xs text-slate-500">
                    These are optional timing hints. Flexible workflows can stay light here and let the agreement calculate the live schedule later.
                  </div>
                  {(editMode || creatingNew) ? (
                    <div className="mb-3">
                      <button
                        type="button"
                        onClick={autoSequenceTimeline}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                        data-testid="templates-auto-sequence-timeline"
                      >
                        Auto Sequence Timeline
                      </button>
                    </div>
                  ) : null}

                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left [&>*]:px-3 [&>*]:py-2">
                          <th>Milestone</th>
                          <th>Start Offset</th>
                          <th>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentMilestones.map((m, idx) => (
                          <tr key={m?.id || `s-${idx}`} className="border-t">
                            <td className="px-3 py-2 font-medium text-slate-900">
                              {m?.title || `Milestone ${idx + 1}`}
                            </td>
                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <input
                                  type="number"
                                  min="0"
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.start_offset ?? ""}
                                  data-testid={`templates-milestone-start-offset-${idx + 1}`}
                                  onChange={(e) =>
                                    updateMilestone(idx, {
                                      start_offset: e.target.value,
                                      recommended_days_from_start:
                                        e.target.value === "" ? "" : Number(e.target.value) + 1,
                                    })
                                  }
                                />
                              ) : (
                                offsetLabel(m?.start_offset ?? (m?.recommended_days_from_start != null ? Number(m.recommended_days_from_start) - 1 : ""))
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <input
                                  type="number"
                                  min="1"
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.duration_days || m?.recommended_duration_days || ""}
                                  data-testid={`templates-milestone-duration-${idx + 1}`}
                                  onChange={(e) =>
                                    updateMilestone(idx, {
                                      duration_days: e.target.value,
                                      recommended_duration_days: e.target.value,
                                    })
                                  }
                                />
                              ) : (
                                dayLabel(m?.duration_days || m?.recommended_duration_days) || "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              ) : null}

              {activeTab === "materials" ? (
                <SectionCard title="Materials">
                  <div className="mb-2 text-xs text-slate-500">
                    Suggested materials should be organized at two levels: overall project-level materials and milestone-specific materials.
                  </div>

                  {(editMode || creatingNew) ? (
                    <div className="mb-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleRefreshMaterialsFromAi}
                        disabled={materialsRefreshing}
                        className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                      >
                        {materialsRefreshing ? "Refreshing…" : "✨ Refresh Materials from AI"}
                      </button>
                    </div>
                  ) : null}

                  <div className="mb-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                    Project-Level Materials should describe the overall categories commonly needed for the template.
                    <br />
                    Milestone Materials should describe what is typically needed for that phase of work.
                  </div>

                  {generatedMaterials.length ? (
                    <div
                      data-testid="templates-generated-materials-guidance"
                      className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
                    >
                      <div className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
                        AI Materials Guidance
                      </div>
                      <div className="mt-2 space-y-3">
                        {generatedMaterials.map((row, idx) => (
                          <div key={`${row?.category || "materials"}-${idx}`} className="rounded-md bg-white/80 px-3 py-2">
                            <div className="font-semibold text-indigo-900">
                              {safeTrim(row?.category) || `Category ${idx + 1}`}
                            </div>
                            {Array.isArray(row?.options) && row.options.length ? (
                              <div className="mt-1 text-sm text-indigo-800">
                                Options: {row.options.slice(0, 4).map((item) => safeTrim(item)).filter(Boolean).join(", ")}
                              </div>
                            ) : null}
                            {safeTrim(row?.notes) ? (
                              <div className="mt-1 text-xs text-indigo-700">{row.notes}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <label className="mb-1 block text-sm font-medium text-slate-800">
                      Project-Level Suggested Materials
                    </label>
                    <textarea
                      data-testid="templates-project-materials-hint"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      rows={4}
                      value={currentHeader?.project_materials_hint || ""}
                      onChange={(e) => updateHeader("project_materials_hint", e.target.value)}
                      disabled={!editMode && !creatingNew}
                      placeholder={
                        "Example:\nRoofing shingles or tiles\nUnderlayment and flashing\nFasteners and sealants\nSafety equipment and cleanup materials"
                      }
                    />
                    <div className="mt-1 text-[11px] text-slate-500">
                      Broad project-level materials or material categories expected for the entire template.
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {currentMilestones.map((m, idx) => (
                      <div key={m?.id || `mat-${idx}`} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 text-sm font-semibold text-slate-900">
                          {m?.title || `Milestone ${idx + 1}`}
                        </div>

                        {(editMode || creatingNew) ? (
                          <textarea
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                            rows={3}
                            value={m?.materials_hint || ""}
                            onChange={(e) => updateMilestone(idx, { materials_hint: e.target.value })}
                            placeholder="Suggested materials commonly needed for this milestone..."
                          />
                        ) : (
                          <div className="whitespace-pre-wrap text-sm text-slate-700">
                            {safeTrim(m?.materials_hint) || "No milestone materials saved yet."}
                          </div>
                        )}

                        <div className="mt-1 text-[11px] text-slate-500">
                          Suggested materials by milestone.
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </ContractorPageSurface>
  );
}

const AI_GENERATION_STEP_ITEMS = [
  { key: "description", label: "Generating description" },
  { key: "milestones", label: "Building milestones" },
  { key: "pricing", label: "Adding pricing guidance" },
  { key: "materials", label: "Suggesting materials" },
  { key: "workflow", label: "Designing workflow profile" },
];

const AI_GENERATION_SECTION_LABELS = {
  description: "description",
  milestones: "milestones",
  pricing: "pricing guidance",
  materials: "materials",
  clarifications: "clarifying questions",
  workflow: "workflow profile",
};

function getAiGenerationStepLabel(index) {
  return AI_GENERATION_STEP_ITEMS[Math.max(index, 0)]?.label || "Generating description";
}

function formatAiGenerationSectionLabels(keys) {
  const unique = Array.from(new Set((keys || []).map((key) => String(key).trim()).filter(Boolean)));
  if (!unique.length) return "some sections";
  return unique.map((key) => AI_GENERATION_SECTION_LABELS[key] || key).join(", ");
}
