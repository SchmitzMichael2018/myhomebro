import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { StartWithAIEntry } from "../components/StartWithAIAssistant.jsx";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import {
  buildAssistantHandoffSignature,
  getAssistantHandoff,
  normalizeAssistantQuestion,
} from "../lib/assistantHandoff.js";

function safeTrim(v) {
  return v == null ? "" : String(v).trim();
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

function startDayLabel(v) {
  const n = toDayNumber(v);
  if (n == null) return "—";
  return `Day ${n}`;
}

function hasAnyPricing(m) {
  return (
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

function OptionBadge({ ownerType }) {
  const text = ownerType === "system" ? "Built-in" : "Custom";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        ownerType === "system"
          ? "bg-slate-100 text-slate-700"
          : "bg-emerald-100 text-emerald-800"
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
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
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
        active
          ? "bg-indigo-600 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function SectionCard({ title, children }) {
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/90 p-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
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
    estimated_days: 1,
    default_scope: "",
    default_clarifications: [],
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
    normalized_milestone_type: "",
    suggested_amount_fixed: "",
    suggested_amount_low: "",
    suggested_amount_high: "",
    pricing_confidence: "",
    pricing_source_note: "",
    recommended_days_from_start: sortOrder === 1 ? 0 : "",
    recommended_duration_days: "",
    materials_hint: "",
    is_optional: false,
  };
}

function normalizeMilestoneForEdit(m, idx) {
  return {
    id: m?.id ?? null,
    title: m?.title ?? "",
    description: m?.description ?? "",
    sort_order: m?.sort_order ?? idx + 1,
    normalized_milestone_type: m?.normalized_milestone_type ?? "",
    suggested_amount_fixed: m?.suggested_amount_fixed ?? "",
    suggested_amount_low: m?.suggested_amount_low ?? "",
    suggested_amount_high: m?.suggested_amount_high ?? "",
    pricing_confidence: m?.pricing_confidence ?? "",
    pricing_source_note: m?.pricing_source_note ?? "",
    recommended_days_from_start:
      m?.recommended_days_from_start ?? (idx === 0 ? 0 : ""),
    recommended_duration_days: m?.recommended_duration_days ?? "",
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
    estimated_days: detail?.estimated_days ?? 1,
    default_scope: detail?.default_scope ?? "",
    default_clarifications: Array.isArray(detail?.default_clarifications)
      ? detail.default_clarifications
      : [],
    project_materials_hint: detail?.project_materials_hint ?? "",
    is_active: detail?.is_active ?? true,
  };
}

function buildTemplatePayload(header, milestones) {
  return {
    name: header?.name ?? "",
    project_type: header?.project_type ?? "",
    project_subtype: header?.project_subtype ?? "",
    description: header?.description ?? "",
    estimated_days: Number(header?.estimated_days || 1) || 1,
    default_scope: header?.default_scope || header?.description || "",
    default_clarifications: Array.isArray(header?.default_clarifications)
      ? header.default_clarifications
      : [],
    project_materials_hint: header?.project_materials_hint ?? "",
    is_active: header?.is_active ?? true,
    milestones: milestones.map((m, idx) => ({
      ...(m?.id ? { id: m.id } : {}),
      title: m?.title ?? "",
      description: m?.description ?? "",
      sort_order: Number(m?.sort_order || idx + 1) || idx + 1,
      normalized_milestone_type: m?.normalized_milestone_type ?? "",
      suggested_amount_fixed:
        m?.suggested_amount_fixed === "" ? null : m?.suggested_amount_fixed,
      suggested_amount_low:
        m?.suggested_amount_low === "" ? null : m?.suggested_amount_low,
      suggested_amount_high:
        m?.suggested_amount_high === "" ? null : m?.suggested_amount_high,
      pricing_confidence: m?.pricing_confidence ?? "",
      pricing_source_note: m?.pricing_source_note ?? "",
      recommended_days_from_start:
        m?.recommended_days_from_start === ""
          ? idx === 0
            ? 0
            : null
          : m?.recommended_days_from_start,
      recommended_duration_days:
        m?.recommended_duration_days === "" ? null : m?.recommended_duration_days,
      materials_hint: m?.materials_hint ?? "",
      is_optional: !!m?.is_optional,
    })),
  };
}

export default function TemplatesPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [templates, setTemplates] = useState([]);

  const [discoverySource, setDiscoverySource] = useState("mine");
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
  const [assistantField, setAssistantField] = useState("description");

  const [editHeader, setEditHeader] = useState(buildBlankHeader());
  const [editMilestones, setEditMilestones] = useState([buildBlankMilestone(1)]);

  const [aiBusy, setAiBusy] = useState(false);
  const [materialsRefreshing, setMaterialsRefreshing] = useState(false);
  const appliedPrefillRef = React.useRef("");
  const assistantAppliedRef = React.useRef("");
  const intakePrefillMeta = location.state?.templateDraftPrefill || null;
  const assistantHandoff = useMemo(() => getAssistantHandoff(location.state), [location.state]);
  const assistantHandoffSignature = useMemo(
    () => buildAssistantHandoffSignature(assistantHandoff),
    [assistantHandoff]
  );

  async function loadTemplates() {
    try {
      setLoading(true);
      setErr("");

      const { data } = await api.get("/projects/templates/discover/", {
        params: {
          source: discoverySource,
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

      if ((!selectedId || !rows.some((row) => String(row.id) === String(selectedId))) && rows.length) {
        setSelectedId(rows[0].id);
      }
      if (!rows.length && !creatingNew) {
        setSelectedId(null);
      }
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
        setEditHeader(normalizeHeaderForEdit(data));
        setEditMilestones(
          Array.isArray(data?.milestones) && data.milestones.length
            ? data.milestones.map((m, idx) => normalizeMilestoneForEdit(m, idx))
            : [buildBlankMilestone(1)]
        );
        setEditMode(false);
        setCreatingNew(false);
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
  }, [selectedId, creatingNew]);

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
  const assistantContext = useMemo(
    () => ({
      current_route: "/app/templates",
      page: "templates",
      field: assistantField,
      template_name:
        currentHeader?.name || selectedDetail?.name || selectedTemplate?.name || "",
      project_type:
        currentHeader?.project_type ||
        selectedDetail?.project_type ||
        selectedTemplate?.project_type ||
        "",
      project_subtype:
        currentHeader?.project_subtype ||
        selectedDetail?.project_subtype ||
        selectedTemplate?.project_subtype ||
        "",
      description:
        currentHeader?.description ||
        currentHeader?.default_scope ||
        selectedDetail?.description ||
        selectedDetail?.default_scope ||
        selectedTemplate?.description ||
        selectedTemplate?.default_scope ||
        "",
      default_scope:
        currentHeader?.default_scope ||
        currentHeader?.description ||
        selectedDetail?.default_scope ||
        selectedDetail?.description ||
        selectedTemplate?.default_scope ||
        selectedTemplate?.description ||
        "",
      template_id: selectedDetail?.id || selectedTemplate?.id || null,
      template_summary: {
        name: currentHeader?.name || selectedDetail?.name || selectedTemplate?.name || "",
        project_type:
          currentHeader?.project_type ||
          selectedDetail?.project_type ||
          selectedTemplate?.project_type ||
          "",
        project_subtype:
          currentHeader?.project_subtype ||
          selectedDetail?.project_subtype ||
          selectedTemplate?.project_subtype ||
          "",
        description:
          currentHeader?.description || selectedDetail?.description || selectedTemplate?.description || "",
        default_scope:
          currentHeader?.default_scope ||
          currentHeader?.description ||
          selectedDetail?.default_scope ||
          selectedDetail?.description ||
          selectedTemplate?.default_scope ||
          selectedTemplate?.description ||
          "",
      },
      milestone_summary: {
        count: currentMilestones.length,
        suggested_titles: currentMilestones.map((row) => row?.title).filter(Boolean),
      },
    }),
    [assistantField, currentHeader, currentMilestones, selectedDetail, selectedTemplate]
  );

  function startNewTemplate() {
    setSelectedId(null);
    setSelectedDetail(null);
    setDetailErr("");
    setEditHeader(buildBlankHeader());
    setEditMilestones([buildBlankMilestone(1)]);
    setCreatingNew(true);
    setEditMode(true);
    setActiveTab("setup");
  }

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
    setCreatingNew(true);
    setEditMode(true);
    setActiveTab("setup");
    setEditHeader({
      ...buildBlankHeader(),
      ...header,
      name: safeTrim(header?.name) || "New Intake Template",
      project_type: header?.project_type ?? "",
      project_subtype: header?.project_subtype ?? "",
      description: header?.description ?? "",
      default_scope: header?.default_scope ?? header?.description ?? "",
      default_clarifications: Array.isArray(header?.default_clarifications)
        ? header.default_clarifications
        : [],
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
      default_scope:
        assistantHandoff.prefillFields.project_summary ||
        assistantHandoff.draftPayload.description ||
        "",
      default_clarifications: assistantQuestions,
    };

    if (
      Object.values(headerPatch).some((value) =>
        Array.isArray(value) ? value.length > 0 : safeTrim(value)
      )
    ) {
      setSelectedId(null);
      setSelectedDetail(null);
      setDetailErr("");
      setCreatingNew(true);
      setEditMode(true);
      setActiveTab("setup");
      setEditHeader((prev) => ({
        ...prev,
        name: safeTrim(prev.name) || headerPatch.name || prev.name,
        project_type: prev.project_type || headerPatch.project_type || "",
        project_subtype: prev.project_subtype || headerPatch.project_subtype || "",
        description: prev.description || headerPatch.description || "",
        default_scope: prev.default_scope || headerPatch.default_scope || "",
        default_clarifications:
          Array.isArray(prev.default_clarifications) && prev.default_clarifications.length
            ? prev.default_clarifications
            : assistantQuestions,
      }));
      setAssistantPrefillBanner(
        "AI prefilled this template draft from your request. Review the structure and clarifications before saving."
      );
    } else {
      setAssistantPrefillBanner("");
    }

    assistantAppliedRef.current = assistantHandoffSignature;
  }, [assistantHandoff, assistantHandoffSignature]);

  function startEditMode() {
    if (!selectedDetail || isSelectedBuiltIn) return;
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
      return;
    }

    setEditHeader(normalizeHeaderForEdit(selectedDetail));
    setEditMilestones(
      Array.isArray(selectedDetail?.milestones) && selectedDetail.milestones.length
        ? selectedDetail.milestones.map((m, idx) => normalizeMilestoneForEdit(m, idx))
        : [buildBlankMilestone(1)]
    );
    setEditMode(false);
  }

  function updateHeader(field, value) {
    setEditHeader((prev) => ({ ...prev, [field]: value }));
  }

  function handleTemplatesAssistantAction(payload) {
    const actionKey = safeTrim(
      payload?.assistant_action_key || payload?.action_key || payload?.next_action?.action_key
    );

    if (actionKey === "apply_template_description") {
      const nextDescription = safeTrim(payload?.value);
      if (!nextDescription) return false;

      updateHeader("description", nextDescription);
      updateHeader("default_scope", nextDescription);
      setAssistantField("description");
      toast.success("Description applied.");
      return true;
    }

    if (actionKey === "apply_template_milestones") {
      const incomingRows = Array.isArray(payload?.value) ? payload.value : [];
      if (!incomingRows.length) return false;

      setEditMilestones(
        incomingRows.map((row, idx) =>
          normalizeMilestoneForEdit(
            {
              title: safeTrim(row?.title),
              description: "",
              sort_order: idx + 1,
            },
            idx
          )
        )
      );
      setActiveTab("milestones");
      setAssistantField("milestones");
      toast.success("Milestones applied.");
      return true;
    }

    return false;
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
        setSelectedId(next[0]?.id || null);
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
      const payload = buildTemplatePayload(currentHeader, currentMilestones);

      if (creatingNew) {
        const { data } = await api.post("/projects/templates/", payload);
        toast.success("Template created.");
        await loadTemplates();
        setSelectedId(data?.id || null);
        setSelectedDetail(data);
        setEditMode(false);
        setCreatingNew(false);
      } else {
        const { data } = await api.patch(
          `/projects/templates/${selectedDetail.id}/`,
          payload
        );
        setSelectedDetail(data);
        toast.success("Template updated.");
        await loadTemplates();
        setEditMode(false);
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
      });

      updateHeader("description", data?.description || "");
      updateHeader("default_scope", data?.description || "");
      toast.success("Description improved.");
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not improve description."
      );
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
      });

      updateHeader("project_type", data?.project_type || "");
      updateHeader("project_subtype", data?.project_subtype || "");
      toast.success("Type / subtype suggested.");
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not suggest type / subtype."
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function handleAiCreateFromScope() {
    if (!safeTrim(currentHeader?.description) && !safeTrim(currentHeader?.name)) {
      toast.error("Add a template name or a rough project description first.");
      return;
    }

    try {
      setAiBusy(true);
      const { data } = await api.post("/projects/templates/ai/create-from-scope/", {
        name: currentHeader?.name,
        project_type: currentHeader?.project_type,
        project_subtype: currentHeader?.project_subtype,
        description: currentHeader?.description,
      });

      setEditHeader({
        ...currentHeader,
        name: data?.name || currentHeader?.name || "",
        project_type: data?.project_type || "",
        project_subtype: data?.project_subtype || "",
        description: data?.description || "",
        estimated_days: data?.estimated_days || 1,
        default_scope: data?.default_scope || data?.description || "",
        default_clarifications: Array.isArray(data?.default_clarifications)
          ? data.default_clarifications
          : [],
        project_materials_hint: data?.project_materials_hint || "",
      });

      setEditMilestones(
        Array.isArray(data?.milestones) && data.milestones.length
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
          : [buildBlankMilestone(1)]
      );

      toast.success("AI template draft created.");
      setActiveTab("milestones");
    } catch (e) {
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not generate full template with AI."
      );
    } finally {
      setAiBusy(false);
    }
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
      toast.error(
        e?.response?.data?.detail ||
          e?.response?.data?.error ||
          "Could not refresh materials."
      );
    } finally {
      setMaterialsRefreshing(false);
    }
  }

  return (
    <ContractorPageSurface
      eyebrow="Core"
      title="Templates"
      subtitle="Build reusable project templates with AI-assisted structure, pricing, schedule, and materials."
      actions={
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startNewTemplate}
            data-testid="templates-new-draft-button"
            className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-50"
          >
            New Template Draft
          </button>

          <Link
            to="/app/agreements/new/wizard?step=1"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            New Agreement
          </Link>

          <button
            type="button"
            onClick={() => navigate("/app/agreements/new/wizard?step=1")}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            Use in Step 1
          </button>
        </div>
      }
    >

      <StartWithAIEntry
        className="mb-4"
        testId="templates-ai-entry"
        title="Ask AI in templates"
        description="Use the current template and field context to draft or refine reusable template content."
        context={assistantContext}
        onAction={handleTemplatesAssistantAction}
      />

      <div className="mb-4 rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
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
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
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
        <div className="rounded-[22px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="text-sm font-semibold text-slate-900">
              Template Library
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {filteredTemplates.length} template{filteredTemplates.length === 1 ? "" : "s"} found
            </div>
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
                            <VisibilityBadge visibility={tpl?.visibility || tpl?.source_label} />
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
                            <VisibilityBadge visibility={tpl?.visibility || tpl?.source_label} />
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

        <div className="rounded-xl border border-slate-200 bg-white">
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
                {!editMode && !creatingNew && selectedDetail && !isSelectedBuiltIn ? (
                  <button
                    type="button"
                    onClick={startEditMode}
                    data-testid="templates-edit-button"
                    className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                  >
                    Edit Template
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
                      disabled={savingTemplate}
                      className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {savingTemplate ? "Saving…" : creatingNew ? "Create Template" : "Save Template"}
                    </button>
                  </>
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
              </div>
            </div>
          </div>

          {detailLoading && !creatingNew ? (
            <div className="px-4 py-6 text-sm text-slate-500">Loading template preview…</div>
          ) : detailErr && !creatingNew ? (
            <div className="px-4 py-6 text-sm text-red-600">{detailErr}</div>
          ) : !selectedTemplate && !creatingNew ? (
            <div className="px-4 py-6 text-sm text-slate-500">
              Select a template or start a new draft.
            </div>
          ) : (
            <div className="p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 data-testid="templates-detail-name" className="text-lg font-bold text-slate-900">
                      {safeTrim(currentHeader?.name) || "Untitled Template"}
                    </h2>
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
                    {!creatingNew ? (
                      <span className="rounded bg-slate-100 px-2 py-1">
                        Visibility: {safeTrim(selectedDetail?.visibility || selectedDetail?.source_label) || "private"}
                      </span>
                    ) : null}
                    {!creatingNew && safeTrim(selectedDetail?.normalized_region_key) ? (
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
                  Schedule
                </TabButton>
                <TabButton
                  data-testid="templates-tab-materials"
                  active={activeTab === "materials"}
                  onClick={() => setActiveTab("materials")}
                >
                  Materials
                </TabButton>
              </div>

              {!creatingNew && selectedDetail ? (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <div className="font-semibold text-slate-900">Marketplace Signals</div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
                    <span>Benchmark support: {safeTrim(selectedDetail?.benchmark_support_label) || "none"}</span>
                    <span>Region match: {safeTrim(selectedTemplate?.region_match_scope) || "global"}</span>
                    <span>Completed projects: {Number(selectedDetail?.completed_project_count || 0)}</span>
                  </div>
                  {Array.isArray(selectedTemplate?.rank_reasons) && selectedTemplate.rank_reasons.length ? (
                    <div className="mt-2 text-xs text-slate-500">
                      Ranked for: {selectedTemplate.rank_reasons.join(", ").replaceAll("_", " ")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "setup" ? (
                <SectionCard title="Project Setup">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium">Template Name</label>
                      <input
                        data-testid="templates-name-input"
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
                      <input
                        data-testid="templates-project-type-input"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={currentHeader?.project_type || ""}
                        onChange={(e) => updateHeader("project_type", e.target.value)}
                        disabled={!editMode && !creatingNew}
                        placeholder="e.g., Remodel, Outdoor, Addition"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium">Project Subtype</label>
                      <input
                        data-testid="templates-project-subtype-input"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        value={currentHeader?.project_subtype || ""}
                        onChange={(e) => updateHeader("project_subtype", e.target.value)}
                        disabled={!editMode && !creatingNew}
                        placeholder="e.g., Bathroom Remodel, Deck Build"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="mb-1 block text-sm font-medium">Description / Scope</label>
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
                        Avoid exact measurements or quantities — those will be collected later via clarifications.
                      </div>
                    </div>
                  </div>

                  {(editMode || creatingNew) ? (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleAiImproveDescription}
                          disabled={aiBusy}
                          className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                        >
                          {aiBusy ? "Working…" : "✨ Improve Description"}
                        </button>

                        <button
                          type="button"
                          onClick={handleAiSuggestTypeSubtype}
                          disabled={aiBusy}
                          className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                        >
                          {aiBusy ? "Working…" : "✨ Suggest Type / Subtype"}
                        </button>

                        <button
                          type="button"
                          onClick={handleAiCreateFromScope}
                          disabled={aiBusy}
                          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          {aiBusy ? "Working…" : "✨ Generate Full Template with AI"}
                        </button>
                      </div>

                      <div className="mt-2 text-[11px] text-slate-500">
                        • Improve Description: rewrites your scope into a clean, professional template
                        <br />
                        • Suggest Type/Subtype: classifies this project for better pricing + analytics
                        <br />
                        • Generate Full Template with AI: generates milestones, pricing, schedule, materials, and clarifications automatically
                      </div>

                      <div className="mt-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
                        AI will:
                        <br />• Break your scope into milestones
                        <br />• Suggest pricing ranges
                        <br />• Estimate timeline
                        <br />• Suggest project-level materials
                        <br />• Suggest materials by milestone
                        <br />• Generate clarification questions
                        <br />
                        <br />You can review and edit everything before saving.
                      </div>
                    </>
                  ) : null}

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

                              <div>
                                <label className="mb-1 block text-xs font-semibold text-slate-700">Type</label>
                                <input
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  value={m?.normalized_milestone_type || ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, { normalized_milestone_type: e.target.value })
                                  }
                                  onFocus={() => setAssistantField("milestones")}
                                  placeholder="e.g., framing"
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
                            {safeTrim(m?.normalized_milestone_type) ? (
                              <span className="rounded bg-slate-100 px-2 py-1">
                                Type: {m.normalized_milestone_type}
                              </span>
                            ) : null}
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
                    Pricing here is a guideline. Actual pricing can vary per project and can be adjusted before sending to the customer.
                  </div>
                  <div className="mb-3 text-[11px] text-slate-500">
                    Pricing is generated as part of the full AI template build and can be refined here before saving.
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left [&>*]:px-3 [&>*]:py-2">
                          <th>Milestone</th>
                          <th>Target</th>
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
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.suggested_amount_fixed || ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, { suggested_amount_fixed: e.target.value })
                                  }
                                />
                              ) : hasAnyPricing(m) ? (
                                toMoney(m?.suggested_amount_fixed) || "—"
                              ) : (
                                <span className="text-xs font-medium text-amber-600">Needs pricing</span>
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.suggested_amount_low || ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, { suggested_amount_low: e.target.value })
                                  }
                                />
                              ) : hasAnyPricing(m) ? (
                                toMoney(m?.suggested_amount_low) || "—"
                              ) : (
                                <span className="text-xs text-amber-600">Needs pricing</span>
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.suggested_amount_high || ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, { suggested_amount_high: e.target.value })
                                  }
                                />
                              ) : hasAnyPricing(m) ? (
                                toMoney(m?.suggested_amount_high) || "—"
                              ) : (
                                <span className="text-xs text-amber-600">Needs pricing</span>
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <select
                                  className="rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.pricing_confidence || ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, { pricing_confidence: e.target.value })
                                  }
                                >
                                  <option value="">Not set</option>
                                  <option value="low">Low</option>
                                  <option value="medium">Medium</option>
                                  <option value="high">High</option>
                                </select>
                              ) : (
                                <ConfidenceBadge value={m?.pricing_confidence || ""} />
                              )}
                            </td>

                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <input
                                  className="w-full min-w-[180px] rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.pricing_source_note || ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, { pricing_source_note: e.target.value })
                                  }
                                />
                              ) : (
                                safeTrim(m?.pricing_source_note) || "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                      Estimated Project Total
                    </div>

                    <div className="mt-2 flex flex-wrap gap-3 text-sm">
                      <div className="rounded border border-slate-200 bg-white px-3 py-2 text-slate-700">
                        Target:{" "}
                        <span className="font-semibold text-slate-900">
                          {moneyOrDash(pricingTotals.fixed)}
                        </span>
                      </div>
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
                      Template pricing is a reusable planning baseline. Final project pricing can still be adjusted per customer and scope.
                    </div>
                  </div>
                </SectionCard>
              ) : null}

              {activeTab === "schedule" ? (
                <SectionCard title="Schedule">
                  <div className="mb-2 text-xs text-slate-500">
                    These are estimated timelines. Actual scheduling will be calculated when the agreement is created.
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr className="text-left [&>*]:px-3 [&>*]:py-2">
                          <th>Milestone</th>
                          <th>Starts Day</th>
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
                                  value={m?.recommended_days_from_start ?? ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, {
                                      recommended_days_from_start: e.target.value,
                                    })
                                  }
                                />
                              ) : (
                                startDayLabel(m?.recommended_days_from_start)
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {(editMode || creatingNew) ? (
                                <input
                                  type="number"
                                  min="1"
                                  className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
                                  value={m?.recommended_duration_days || ""}
                                  onChange={(e) =>
                                    updateMilestone(idx, { recommended_duration_days: e.target.value })
                                  }
                                />
                              ) : (
                                dayLabel(m?.recommended_duration_days) || "—"
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

                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <label className="mb-1 block text-sm font-medium text-slate-800">
                      Project-Level Suggested Materials
                    </label>
                    <textarea
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
