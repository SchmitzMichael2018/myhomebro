import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../../api";
import AddressAutocomplete from "../AddressAutocomplete.jsx";
import { PROJECT_MODE_OPTIONS, normalizeProjectMode, projectModeLabel } from "../projectMode.jsx";
import { buildAssistedDiySafetyWarning } from "./projectSafety.js";
import ContractorDiscoveryStep from "./ContractorDiscoveryStep.jsx";
import PaymentPreferenceHelp, {
  PAYMENT_PREFERENCE_OPTIONS,
  PAYMENT_PREFERENCE_SECTION_COPY,
} from "./PaymentPreferenceHelp.jsx";

function copyCustomerAddressToProject(form) {
  return {
    ...form,
    project_address_line1: form.customer_address_line1 || "",
    project_address_line2: form.customer_address_line2 || "",
    project_city: form.customer_city || "",
    project_state: form.customer_state || "",
    project_postal_code: form.customer_postal_code || "",
  };
}

function getEffectiveProjectForm(form) {
  return form.same_as_customer_address ? copyCustomerAddressToProject(form) : form;
}

function emptyMilestone(index) {
  return { title: `Milestone ${index + 1}`, description: "" };
}

function normalizeMilestones(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    return [emptyMilestone(0), emptyMilestone(1), emptyMilestone(2)];
  }
  return rows.map((row, index) => ({
    title: row?.title || `Milestone ${index + 1}`,
    description: row?.description || "",
  }));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function contractorSelectionKey(card) {
  return cleanText(card?.id || card?.directory_entry_id || card?.google_place_id || card?.business_name);
}

function serializeSelectedContractor(card) {
  return {
    id: card?.id,
    directory_entry_id: card?.directory_entry_id,
    google_place_id: card?.google_place_id,
    business_name: card?.business_name,
    website_url: card?.website_url,
    phone: card?.phone,
    public_email: card?.public_email || card?.email,
    address: card?.address || card?.formatted_address,
    city: card?.city,
    state: card?.state,
    zip_code: card?.zip_code,
    latitude: card?.latitude,
    longitude: card?.longitude,
    rating: card?.rating,
    review_count: card?.review_count,
    services: card?.services || card?.trade_categories || card?.recommendation_reasons,
    source: card?.source,
  };
}

function hasManualContractorContact(row) {
  return Boolean(cleanText(row?.email || row?.contractor_email) || cleanText(row?.phone || row?.contractor_phone));
}

function moneyValue(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function toTestIdSegment(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "row";
}

function emptyClarificationAnswers() {
  return {};
}

function summarizeTextValue(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function getFriendlyMeasurementLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const map = {
    provided: "Provided",
    site_visit_required: "Site visit required",
    not_sure: "Not sure",
  };
  return map[normalized] || summarizeTextValue(normalized, 60);
}

function getFriendlyTimelineLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const cleaned = normalized.replace(/[^\d.]/g, "");
  if (!cleaned) return summarizeTextValue(normalized, 60);
  const days = Number(cleaned);
  if (!Number.isFinite(days)) return summarizeTextValue(normalized, 60);
  const rounded = Math.max(0, Math.round(days));
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

function getFriendlyBudgetLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const cleaned = normalized.replace(/[^0-9.]/g, "");
  if (!cleaned) return summarizeTextValue(normalized, 60);
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return summarizeTextValue(normalized, 60);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

const intakeLightCardClass =
  "rounded-3xl border border-slate-200/80 bg-white p-6 text-slate-950 shadow-2xl shadow-slate-950/20 ring-1 ring-white/80 sm:p-7";
const intakePanelClass =
  "rounded-3xl border border-white/15 bg-slate-950/45 p-4 shadow-2xl shadow-slate-950/30 backdrop-blur";
const intakePrimaryButtonClass =
  "rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200/70 hover:from-blue-500 hover:to-purple-600 hover:shadow-blue-500/20 focus:outline-none focus:ring-2 focus:ring-amber-300/60 disabled:cursor-not-allowed disabled:border-slate-400/30 disabled:from-slate-600 disabled:via-slate-600 disabled:to-slate-600 disabled:text-slate-200 disabled:shadow-none disabled:opacity-70";
const intakeSecondaryButtonClass =
  "rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60";

function getFriendlyClarificationLabel(question) {
  const text = [question?.label, question?.question, question?.key].filter(Boolean).join(" ").toLowerCase();
  if (/(material|materials|suppl|who provides)/.test(text)) return "Materials";
  if (/(measure|measurement|dimension|size)/.test(text)) return "Measurements";
  if (/(timeline|timeframe|schedule|when|start)/.test(text)) return "Timing";
  if (/(layout|wall|floor plan|space|room|area)/.test(text)) return "Layout";
  if (/(scope|detail|depth|extent)/.test(text)) return "Scope";
  return summarizeTextValue(question?.label || question?.question || question?.key || "", 60);
}

function getMainGoalSummary(title, description) {
  const normalizedTitle = summarizeTextValue(title, 120);
  if (normalizedTitle) return normalizedTitle;
  const normalizedDescription = summarizeTextValue(description, 120);
  if (!normalizedDescription) return "";
  const firstSentence = normalizedDescription.split(/[.!?]\s+/)[0] || normalizedDescription;
  return summarizeTextValue(firstSentence, 120);
}

function buildProjectContextText(form) {
  const analysis = form?.ai_analysis_payload && typeof form.ai_analysis_payload === "object" ? form.ai_analysis_payload : {};
  return [
    form?.accomplishment_text,
    form?.refined_description,
    form?.ai_description,
    form?.project_scope_summary,
    analysis.project_scope_summary,
    analysis.scope_summary,
    form?.ai_project_title,
    form?.ai_project_type,
    form?.ai_project_subtype,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildDescriptionSourceText(form) {
  return [
    form?.accomplishment_text,
    form?.refined_description,
    form?.ai_description,
    form?.project_scope_summary,
    form?.ai_analysis_payload?.project_scope_summary,
    form?.ai_analysis_payload?.scope_summary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isHomeAdditionText(text) {
  return /bedroom\s+extension|room\s+addition|home\s+addition|house\s+extension|add(?:ing)?\s+(?:a\s+)?room|add(?:ing)?\s+(?:a\s+)?bedroom|build(?:ing)?\s+(?:an?\s+)?addition/.test(
    String(text || "").toLowerCase()
  );
}

function inferProjectTypeFromDescription(form) {
  const text = buildDescriptionSourceText(form);
  if (!text.trim()) return null;
  if (isHomeAdditionText(text)) {
    return { type: "General Contracting", subtype: /bedroom/.test(text) ? "Bedroom Addition" : "Home Addition" };
  }
  if (/(patio|concrete|slab|driveway|walkway|sidewalk|masonry|hardscape|paver)/.test(text)) {
    return { type: "Concrete", subtype: "Patio / Hardscape" };
  }
  if (/(kitchen|cabinet|countertop|carpentry|quartz|granite)/.test(text)) {
    if (/(cabinet|carpentry)/.test(text)) {
      return { type: "Cabinets / Carpentry", subtype: "Kitchen Remodeling" };
    }
    return { type: "Kitchen Remodeling", subtype: "Countertops" };
  }
  if (/(floor|flooring|tile|vinyl|laminate|hardwood)/.test(text)) {
    return { type: "Flooring", subtype: "" };
  }
  if (/(bathroom|shower|tub|vanity)/.test(text)) {
    return { type: "Bathroom Remodeling", subtype: "" };
  }
  if (/(roof|shingle|leak)/.test(text)) {
    return { type: "Roofing", subtype: "" };
  }
  if (/(paint|drywall|sheetrock)/.test(text)) {
    return { type: "Painting / Drywall", subtype: "" };
  }
  return null;
}

function inferProjectType(form) {
  const descriptionInferred = inferProjectTypeFromDescription(form);
  if (descriptionInferred) return descriptionInferred;

  const text = buildProjectContextText(form);
  if (!text.trim()) return { type: "", subtype: "" };

  if (/(patio|concrete|slab|driveway|walkway|sidewalk|masonry|hardscape|paver)/.test(text)) {
    return { type: "Concrete", subtype: "Patio / Hardscape" };
  }
  if (/(kitchen|cabinet|countertop|carpentry|quartz|granite)/.test(text)) {
    if (/(cabinet|carpentry)/.test(text)) {
      return { type: "Cabinets / Carpentry", subtype: "Kitchen Remodeling" };
    }
    return { type: "Kitchen Remodeling", subtype: "Countertops" };
  }
  if (/(floor|flooring|tile|vinyl|laminate|hardwood)/.test(text)) {
    return { type: "Flooring", subtype: "" };
  }
  if (/(bathroom|shower|tub|vanity)/.test(text)) {
    return { type: "Bathroom Remodeling", subtype: "" };
  }
  if (/(roof|shingle|leak)/.test(text)) {
    return { type: "Roofing", subtype: "" };
  }
  if (/(paint|drywall|sheetrock)/.test(text)) {
    return { type: "Painting / Drywall", subtype: "" };
  }
  return { type: "General Contracting", subtype: "" };
}

function cleanProjectTitle(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (["untitled project", "custom project", "select type", "select subtype", "project"].includes(text.toLowerCase())) {
    return "";
  }
  return text;
}

function generateProjectTitle(form) {
  const descriptionContext = buildDescriptionSourceText(form);
  if (isHomeAdditionText(descriptionContext)) {
    return /bedroom\s+extension/.test(descriptionContext) ? "Bedroom Extension Project" : "Bedroom Addition Project";
  }
  const existing = cleanProjectTitle(form?.ai_project_title);
  if (existing) return existing;

  const context = [
    form?.ai_project_type,
    form?.ai_project_subtype,
    form?.project_scope_summary,
    form?.refined_description,
    form?.ai_description,
    form?.accomplishment_text,
    form?.measurement_handling,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/(kitchen|cabinet|carpentry)/.test(context)) return "Kitchen Cabinet Installation";
  if (/(countertop|quartz|granite)/.test(context)) return "Countertop Installation Project";
  if (/(floor|flooring|tile|vinyl|laminate|hardwood)/.test(context)) {
    return /(replace|replacement|remove old)/.test(context) ? "Flooring Replacement Project" : "Flooring Installation Project";
  }
  if (/(patio|concrete|slab|driveway|walkway|masonry|hardscape|paver)/.test(context)) {
    return /patio/.test(context) ? "Patio Concrete Project" : "Concrete Project";
  }
  if (/(bathroom|shower|tub|vanity)/.test(context)) return "Bathroom Remodel Project";
  if (/(roof|roofing|shingle|leak)/.test(context)) return /(repair|leak)/.test(context) ? "Roof Repair Request" : "Roofing Project";
  if (/(paint|painting|painter)/.test(context)) return "Painting Project";
  if (/(drywall|sheetrock)/.test(context)) return "Drywall Project";
  if (/(electrical|electrician|panel|wire|wiring)/.test(context)) return "Electrical Project";
  if (/(plumbing|plumber|pipe|drain|sewer)/.test(context)) return "Plumbing Project";
  if (/(hvac|air conditioning|cooling|heating|furnace)/.test(context)) return "HVAC Project";

  const subtype = cleanProjectTitle(form?.ai_project_subtype);
  if (subtype) return `${subtype} Project`;
  const type = cleanProjectTitle(form?.ai_project_type);
  if (type) return `${type} Project`;
  return "Home Improvement Project";
}

function inferMeasurements(form) {
  const text = [
    form?.accomplishment_text,
    form?.refined_description,
    form?.ai_description,
    form?.project_scope_summary,
    form?.ai_analysis_payload?.project_scope_summary,
    form?.ai_analysis_payload?.scope_summary,
  ]
    .filter(Boolean)
    .join(" ");
  const results = [];
  const add = (value) => {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (normalized && !results.includes(normalized)) results.push(normalized);
  };

  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')?/gi)) {
    add(`${match[1]} ft x ${match[2]} ft`);
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:extension|extend|addition)/gi)) {
    add(`${match[1]} ft extension`);
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")\s*(?:slab|concrete|thick|thickness)/gi)) {
    add(`${match[1]} in slab`);
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|square\s*feet)/gi)) {
    add(`${match[1]} sq ft`);
  }

  return results;
}

function formatProjectAddress(form) {
  return [
    form.project_address_line1,
    form.project_address_line2,
    [form.project_city, form.project_state, form.project_postal_code].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join("\n");
}

function projectClassLabel(value) {
  return value === "commercial" ? "Commercial" : "Residential";
}

function paymentPreferenceLabel(value) {
  const map = {
    escrow: "Escrow milestone payments",
    direct: "Direct payment to contractor",
    discuss: "Discuss payment options with contractor",
  };
  return map[value] || "Not provided";
}

const blankForm = {
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  project_class: "residential",
  project_mode: "full_service",
  payment_preference: "escrow",
  homeowner_participation_notes: "",
  homeowner_started_work: false,
  homeowner_task_summary: "",
  homeowner_assistance_summary: "",
  customer_address_line1: "",
  customer_address_line2: "",
  customer_city: "",
  customer_state: "",
  customer_postal_code: "",
  same_as_customer_address: true,
  project_address_line1: "",
  project_address_line2: "",
  project_city: "",
  project_state: "",
  project_postal_code: "",
  accomplishment_text: "",
  refined_description: "",
  ai_project_title: "",
  ai_project_type: "",
  ai_project_subtype: "",
  project_scope_summary: "",
  ai_description: "",
  ai_project_timeline_days: "",
  ai_project_budget: "",
  budget_range_text: "",
  desired_timing_text: "",
  tentative_start_date: "",
  measurement_handling: "",
  ai_milestones: [emptyMilestone(0), emptyMilestone(1), emptyMilestone(2)],
  ai_clarification_questions: [],
  ai_clarification_answers: emptyClarificationAnswers(),
  ai_analysis_payload: {},
  clarification_photos: [],
};

function StepPill({ active, complete, label, index }) {
  return (
    <div
      className={`flex min-h-10 items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold shadow-sm transition ${
        active
          ? "border-blue-300/40 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 text-white shadow-blue-950/25"
          : complete
            ? "border-blue-300/35 bg-blue-500/20 text-blue-50"
            : "border-white/15 bg-slate-950/35 text-sky-50/85 hover:border-sky-300/35 hover:bg-sky-400/10"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          active ? "bg-white text-blue-700" : complete ? "bg-blue-500 text-white" : "bg-white/10 text-sky-100"
        }`}
      >
        {complete ? "✓" : index + 1}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </div>
  );
}

export default function PublicIntakeWizard() {
  const { token = "" } = useParams();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [contractorName, setContractorName] = useState("Your contractor");
  const [statusText, setStatusText] = useState("");
  const [branchMode, setBranchMode] = useState("single_contractor");
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [branchResult, setBranchResult] = useState(null);
  const [discoveryTargets, setDiscoveryTargets] = useState([]);
  const [clarificationUploading, setClarificationUploading] = useState(false);
  const [projectTypeTouched, setProjectTypeTouched] = useState(false);
  const [measurementsTouched, setMeasurementsTouched] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [branchContacts, setBranchContacts] = useState([
    { name: "", email: "", phone: "" },
    { name: "", email: "", phone: "" },
  ]);
  const [singleContractor, setSingleContractor] = useState({ name: "", email: "", phone: "" });
  const [branchMessage, setBranchMessage] = useState("");
  const [descriptionRefinement, setDescriptionRefinement] = useState({
    status: "idle",
    original: "",
    suggestion: "",
    source: "",
  });
  const [form, setForm] = useState(blankForm);
  const [submissionConfirmation, setSubmissionConfirmation] = useState(null);
  const [assistedDiyAcknowledged, setAssistedDiyAcknowledged] = useState(false);
  const safetyWarning = useMemo(() => {
    if (normalizeProjectMode(form.project_mode) !== "assisted_diy") {
      return null;
    }
    return buildAssistedDiySafetyWarning(
      form.accomplishment_text,
      form.homeowner_participation_notes,
      form.homeowner_task_summary,
      form.homeowner_assistance_summary
    );
  }, [
    form.accomplishment_text,
    form.homeowner_participation_notes,
    form.homeowner_task_summary,
    form.homeowner_assistance_summary,
    form.project_mode,
  ]);
  const inferredProjectType = useMemo(() => inferProjectType(form), [
    form.accomplishment_text,
    form.refined_description,
    form.ai_description,
    form.project_scope_summary,
    form.ai_analysis_payload,
    form.ai_project_title,
    form.ai_project_type,
    form.ai_project_subtype,
  ]);
  const inferredMeasurements = useMemo(() => inferMeasurements(form), [
    form.accomplishment_text,
    form.refined_description,
    form.ai_description,
    form.project_scope_summary,
    form.ai_analysis_payload,
  ]);
  const generatedProjectTitle = useMemo(() => generateProjectTitle(form), [
    form.accomplishment_text,
    form.ai_description,
    form.ai_project_subtype,
    form.ai_project_title,
    form.ai_project_type,
    form.measurement_handling,
    form.project_scope_summary,
    form.refined_description,
  ]);

  useEffect(() => {
    if (!loaded || projectTypeTouched || !inferredProjectType.type) return;
    setForm((prev) => {
      if (prev.ai_project_type === inferredProjectType.type && prev.ai_project_subtype === inferredProjectType.subtype) return prev;
      return {
        ...prev,
        ai_project_type: inferredProjectType.type,
        ai_project_subtype: inferredProjectType.subtype,
      };
    });
  }, [inferredProjectType, loaded, projectTypeTouched]);

  useEffect(() => {
    if (!loaded || measurementsTouched || !inferredMeasurements.length) return;
    setForm((prev) => {
      if (String(prev.measurement_handling || "").trim()) return prev;
      return { ...prev, measurement_handling: inferredMeasurements.join("\n") };
    });
  }, [inferredMeasurements, loaded, measurementsTouched]);

  const stepLabels = [
    "Project Idea",
    "Refine Your Project",
    "Project Snapshot",
    "Project Summary",
    "Project Details",
    "Contact Info",
    "Choose Local Contractors",
    "Choose Path",
    "Review + Confirm",
  ];
  useEffect(() => {
    let mounted = true;

    async function loadIntake() {
      if (!token) {
        toast.error("Missing intake token.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        const { data } = await api.get("/projects/public-intake/", { params: { token } });
        if (!mounted) return;

        setContractorName(data?.contractor_name || "Your contractor");
        setStatusText(data?.status || "");
        setBranchMode(data?.post_submit_flow || "single_contractor");
        setBranchResult(
          data?.post_submit_flow
            ? {
                post_submit_flow: data.post_submit_flow,
                post_submit_flow_selected_at: data.post_submit_flow_selected_at || null,
              }
            : null
        );
        let freshStartFromStorage = false;
        try {
          freshStartFromStorage = window.sessionStorage.getItem("mhb-public-intake-fresh-token") === token;
          if (freshStartFromStorage) window.sessionStorage.removeItem("mhb-public-intake-fresh-token");
        } catch {
          freshStartFromStorage = false;
        }
        const isSubmitted = Boolean(data?.submitted_at || data?.completed_at || data?.post_submit_flow_selected_at);
        const freshStart = (Boolean(location.state?.publicIntakeFreshStart) || freshStartFromStorage) && !isSubmitted;

        setForm({
          customer_name: data?.customer_name || "",
          customer_email: data?.customer_email || "",
          customer_phone: data?.customer_phone || "",
          project_class: data?.project_class || "residential",
          project_mode: data?.project_mode || "full_service",
          payment_preference: data?.payment_preference || "escrow",
          homeowner_participation_notes: data?.homeowner_participation_notes || "",
          homeowner_started_work:
            data?.homeowner_started_work !== undefined ? !!data.homeowner_started_work : false,
          homeowner_task_summary: data?.homeowner_task_summary || "",
          homeowner_assistance_summary: data?.homeowner_assistance_summary || "",
          customer_address_line1: data?.customer_address_line1 || "",
          customer_address_line2: data?.customer_address_line2 || "",
          customer_city: data?.customer_city || "",
          customer_state: data?.customer_state || "",
          customer_postal_code: data?.customer_postal_code || "",
          same_as_customer_address:
            data?.same_as_customer_address !== undefined ? !!data.same_as_customer_address : true,
          project_address_line1: data?.project_address_line1 || "",
          project_address_line2: data?.project_address_line2 || "",
          project_city: data?.project_city || "",
          project_state: data?.project_state || "",
          project_postal_code: data?.project_postal_code || "",
          accomplishment_text: freshStart ? "" : data?.accomplishment_text || "",
          refined_description: freshStart ? "" : data?.refined_description || data?.ai_description || "",
          ai_project_title: freshStart ? "" : data?.ai_project_title || "",
          ai_project_type: freshStart ? "" : data?.ai_project_type || "",
          ai_project_subtype: freshStart ? "" : data?.ai_project_subtype || "",
          project_scope_summary: freshStart ? "" : data?.project_scope_summary || data?.ai_analysis_payload?.project_scope_summary || "",
          ai_description: freshStart ? "" : data?.ai_description || "",
          ai_project_timeline_days: freshStart ? "" : data?.ai_project_timeline_days ?? "",
          ai_project_budget: freshStart ? "" : moneyValue(data?.ai_project_budget),
          budget_range_text: freshStart ? "" : data?.budget_range_text || "",
          desired_timing_text: freshStart ? "" : data?.desired_timing_text || "",
          tentative_start_date: freshStart ? "" : data?.tentative_start_date || "",
          measurement_handling: freshStart ? "" : data?.measurement_handling || "",
          ai_milestones: freshStart ? normalizeMilestones([]) : normalizeMilestones(data?.ai_milestones),
          ai_clarification_questions: !freshStart && Array.isArray(data?.ai_clarification_questions)
            ? data.ai_clarification_questions
            : [],
          ai_clarification_answers: freshStart ? {} : data?.ai_clarification_answers || {},
          ai_analysis_payload: freshStart ? {} : data?.ai_analysis_payload || {},
          clarification_photos: !freshStart && Array.isArray(data?.clarification_photos) ? data.clarification_photos : [],
        });

        const clarificationQuestions = Array.isArray(data?.ai_clarification_questions)
          ? data.ai_clarification_questions
          : [];
        const clarificationAnswers =
          data?.ai_clarification_answers && typeof data.ai_clarification_answers === "object"
            ? data.ai_clarification_answers
            : {};
        const firstUnansweredIndex = clarificationQuestions.findIndex((question) => {
          const key = question?.key || "";
          if (!key) return true;
          return !String(clarificationAnswers?.[key] ?? "").trim();
        });

        const hasStructuredOutput = !!(
          data?.ai_project_title ||
          data?.ai_project_type ||
          data?.ai_description ||
          (Array.isArray(data?.ai_milestones) && data.ai_milestones.length)
        );
        const hasClarifications =
          Array.isArray(data?.ai_clarification_questions) && data.ai_clarification_questions.length > 0;
        const hasClarificationAnswers =
          data?.ai_clarification_answers && Object.keys(data.ai_clarification_answers || {}).length > 0;
        setCurrentStep(
          freshStart
            ? 0
            : data?.post_submit_flow_selected_at
            ? 7
            : data?.post_submit_flow
              ? 6
                : hasClarificationAnswers
                ? 2
                : hasStructuredOutput || hasClarifications
                  ? 1
                  : 0
        );
        setCurrentQuestionIndex(
          clarificationQuestions.length ? (firstUnansweredIndex >= 0 ? firstUnansweredIndex : 0) : 0
        );
        setLoaded(true);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not load intake form.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadIntake();
    return () => {
      mounted = false;
    };
  }, [token, location.search, location.state]);

  useEffect(() => {
    if (!form.same_as_customer_address) return;
    setForm((prev) => ({
      ...prev,
      project_address_line1: prev.customer_address_line1 || "",
      project_address_line2: prev.customer_address_line2 || "",
      project_city: prev.customer_city || "",
      project_state: prev.customer_state || "",
      project_postal_code: prev.customer_postal_code || "",
    }));
  }, [
    form.same_as_customer_address,
    form.customer_address_line1,
    form.customer_address_line2,
    form.customer_city,
    form.customer_state,
    form.customer_postal_code,
  ]);

  const canGenerateStructure = useMemo(
    () => !!String(form.accomplishment_text || "").trim(),
    [form.accomplishment_text]
  );

  const canFinish = useMemo(() => {
    const effectiveForm = getEffectiveProjectForm(form);
    return (
      !!String(effectiveForm.customer_name || "").trim() &&
      !!String(effectiveForm.customer_email || "").trim() &&
      !!String(effectiveForm.project_address_line1 || "").trim() &&
      !!String(effectiveForm.project_city || "").trim() &&
      !!String(effectiveForm.project_state || "").trim() &&
      !!String(effectiveForm.project_postal_code || "").trim() &&
      !!String(effectiveForm.accomplishment_text || "").trim()
    );
  }, [form]);

  const clarificationQuestions = useMemo(
    () => (Array.isArray(form.ai_clarification_questions) ? form.ai_clarification_questions.slice(0, 6) : []),
    [form.ai_clarification_questions]
  );

  const activeClarificationQuestion = clarificationQuestions[currentQuestionIndex] || null;
  const activeClarificationAnswer = activeClarificationQuestion?.key
    ? form.ai_clarification_answers?.[activeClarificationQuestion.key] ?? ""
    : "";

  useEffect(() => {
    if (currentStep !== 1) return;
    if (!clarificationQuestions.length) {
      if (currentQuestionIndex !== 0) setCurrentQuestionIndex(0);
      return;
    }
    if (currentQuestionIndex > clarificationQuestions.length - 1) {
      setCurrentQuestionIndex(clarificationQuestions.length - 1);
    }
  }, [currentStep, clarificationQuestions.length, currentQuestionIndex]);

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleAccomplishmentChange(value) {
    setProjectTypeTouched(false);
    setMeasurementsTouched(false);
    setForm((prev) => ({
      ...prev,
      accomplishment_text: value,
      refined_description: "",
      ai_description: "",
      ai_project_title: "",
      ai_project_type: "",
      ai_project_subtype: "",
      project_scope_summary: "",
      ai_milestones: normalizeMilestones([]),
      ai_clarification_questions: [],
      ai_clarification_answers: {},
      ai_analysis_payload: {},
      measurement_handling: "",
    }));
    setDiscoveryTargets([]);
    setBranchResult(null);
    setBranchMode("single_contractor");
    setBranchContacts([
      { name: "", email: "", phone: "" },
      { name: "", email: "", phone: "" },
    ]);
    setSingleContractor({ name: "", email: "", phone: "" });
    setBranchMessage("");
    if (descriptionRefinement.status === "ready") {
      setDescriptionRefinement({
        status: "idle",
        original: "",
        suggestion: "",
        source: "",
      });
    }
  }

  function hydrateFromResponse(data) {
    if (!data) return;
    setStatusText(data?.status || statusText);
    if (data?.post_submit_flow) {
      setBranchMode(data.post_submit_flow);
      setBranchResult({
        post_submit_flow: data.post_submit_flow,
        post_submit_flow_selected_at: data.post_submit_flow_selected_at || null,
      });
    }

    setForm((prev) => ({
      ...prev,
      ai_project_title: data?.ai_project_title ?? prev.ai_project_title,
      ai_project_type: data?.ai_project_type ?? prev.ai_project_type,
      ai_project_subtype: data?.ai_project_subtype ?? prev.ai_project_subtype,
      project_scope_summary:
        data?.project_scope_summary ?? data?.ai_analysis_payload?.project_scope_summary ?? prev.project_scope_summary,
      ai_description: data?.ai_description ?? prev.ai_description,
      refined_description: data?.refined_description ?? data?.ai_description ?? prev.refined_description,
      ai_project_timeline_days: data?.ai_project_timeline_days ?? prev.ai_project_timeline_days,
      ai_project_budget:
        data?.ai_project_budget !== undefined && data?.ai_project_budget !== null
          ? String(data.ai_project_budget)
          : prev.ai_project_budget,
      measurement_handling: data?.measurement_handling ?? prev.measurement_handling,
      budget_range_text: data?.budget_range_text ?? prev.budget_range_text,
      desired_timing_text: data?.desired_timing_text ?? prev.desired_timing_text,
      tentative_start_date: data?.tentative_start_date ?? prev.tentative_start_date,
      ai_milestones: normalizeMilestones(data?.ai_milestones ?? prev.ai_milestones),
      ai_clarification_questions: Array.isArray(data?.ai_clarification_questions)
        ? data.ai_clarification_questions
        : prev.ai_clarification_questions,
      ai_clarification_answers:
        data?.ai_clarification_answers && typeof data.ai_clarification_answers === "object"
          ? data.ai_clarification_answers
          : prev.ai_clarification_answers,
      ai_analysis_payload: data?.ai_analysis_payload || prev.ai_analysis_payload,
      clarification_photos: Array.isArray(data?.clarification_photos) ? data.clarification_photos : prev.clarification_photos,
    }));
  }

  async function saveIntake({
    showToast = true,
    branchFlow = null,
    contractors = null,
    selectedContractors = null,
    branchMessageOverride = null,
    allowBranch = true,
    formOverrides = null,
    finalSubmit = false,
  } = {}) {
    if (!token) {
      toast.error("Missing intake token.");
      return null;
    }

    try {
      setSaving(true);
      const mergedForm = formOverrides ? { ...form, ...formOverrides } : form;
      const effectiveForm = getEffectiveProjectForm(mergedForm);
      const payload = { token, ...effectiveForm };
      payload.ai_project_title = generateProjectTitle(effectiveForm);
      payload.measurement_handling = form.measurement_handling || "";
      payload.ai_clarification_answers = form.ai_clarification_answers || {};
      if (finalSubmit) payload.final_submit = true;

      if (formOverrides?.ai_clarification_answers) {
        payload.ai_clarification_answers = formOverrides.ai_clarification_answers;
      }

      if (allowBranch && branchFlow) {
        payload.branch_flow = branchFlow;
        payload.branch_message = branchMessageOverride ?? branchMessage;
        if (Array.isArray(selectedContractors)) {
          payload.selected_contractors = selectedContractors;
        }
        if (branchFlow === "single_contractor") {
          payload.contractor_name = singleContractor.name || "";
          payload.contractor_email = singleContractor.email || "";
          payload.contractor_phone = singleContractor.phone || "";
        } else {
          payload.contractors = contractors || branchContacts;
        }
      }

      const { data } = await api.patch("/projects/public-intake/", payload);
      setStatusText(data?.status || "submitted");
      hydrateFromResponse(data);
      if (showToast) toast.success("Your intake has been saved.");
      return data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save intake.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateStructure() {
    if (!canGenerateStructure) {
      toast.error("Please describe the project first.");
      return;
    }

    const data = await saveIntake({ showToast: false, allowBranch: false });
    if (!data) return;
    setCurrentQuestionIndex(0);
    setCurrentStep(1);
    toast.success("Project structure generated.");
  }

  async function handleImproveDescription() {
    const currentDescription = String(form.accomplishment_text || "").trim();
    if (!currentDescription) {
      toast.error("Please add a project description first.");
      return;
    }

    try {
      setDescriptionRefinement((prev) => ({
        ...prev,
        status: "loading",
        original: currentDescription,
        source: "",
      }));
      const { data } = await api.post("/projects/public-intake/improve-description/", {
        token,
        current_description: currentDescription,
      });
      const refined = String(data?.description || "").trim();
      if (!refined) {
        throw new Error("No refined description returned.");
      }
      setDescriptionRefinement({
        status: "ready",
        original: currentDescription,
        suggestion: refined,
        source: String(data?.source || "").trim(),
      });
      toast.success("Description improved.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "Could not improve the description.");
      setDescriptionRefinement({
        status: "idle",
        original: "",
        suggestion: "",
        source: "",
      });
    }
  }

  function acceptDescriptionSuggestion() {
    if (descriptionRefinement.status !== "ready") return;
    setForm((prev) => ({
      ...prev,
      refined_description: descriptionRefinement.suggestion,
      ai_description: descriptionRefinement.suggestion,
    }));
    setDescriptionRefinement({
      status: "idle",
      original: "",
      suggestion: "",
      source: "",
    });
  }

  function keepOriginalDescription() {
    if (descriptionRefinement.status !== "ready") return;
    setDescriptionRefinement({
      status: "idle",
      original: "",
      suggestion: "",
      source: "",
    });
  }

  async function handleClarificationAdvance({ skip = false } = {}) {
    if (currentStep !== 1) return;

    const currentQuestion = clarificationQuestions[currentQuestionIndex] || null;
    const questionKey = currentQuestion?.key || "";
    const formOverrides =
      skip && questionKey
        ? {
            ai_clarification_answers: {
              ...(form.ai_clarification_answers || {}),
              [questionKey]: "",
            },
          }
        : null;

    const saved = await saveIntake({
      showToast: false,
      allowBranch: false,
      formOverrides,
    });
    if (!saved) return;

    if (!clarificationQuestions.length || currentQuestionIndex >= clarificationQuestions.length - 1) {
      setCurrentStep(2);
      return;
    }

    setCurrentQuestionIndex((prev) => Math.min(prev + 1, clarificationQuestions.length - 1));
  }

  async function handleNext() {
    if (currentStep === 0) {
      await handleGenerateStructure();
      return;
    }
    if (currentStep === 1) {
      await handleClarificationAdvance();
      return;
    }
    if (currentStep === 7) {
      await handleBranchSubmit();
      return;
    }
    if (currentStep === 8) {
      await handleConfirm();
      return;
    }
    if (currentStep === 6) {
      setCurrentStep(7);
      return;
    }
    if (currentStep < stepLabels.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  }

  function handleBack() {
    if (currentStep === 1) {
      if (currentQuestionIndex > 0) {
        setCurrentQuestionIndex((prev) => Math.max(prev - 1, 0));
      } else {
        setCurrentStep(0);
      }
      return;
    }
    if (currentStep > 0) setCurrentStep((prev) => prev - 1);
  }

  function setMilestone(index, field, value) {
    setForm((prev) => {
      const next = [...(prev.ai_milestones || [])];
      while (next.length <= index) next.push(emptyMilestone(next.length));
      next[index] = { ...next[index], [field]: value };
      return { ...prev, ai_milestones: next };
    });
  }

  function setClarificationAnswer(key, value) {
    setForm((prev) => ({
      ...prev,
      ai_clarification_answers: {
        ...(prev.ai_clarification_answers || {}),
        [key]: value,
      },
    }));
  }

  async function uploadClarificationPhotos(files) {
    const items = Array.from(files || []).filter(Boolean);
    if (!items.length) return;
    try {
      setClarificationUploading(true);
      for (const file of items) {
        const fd = new FormData();
        fd.append("token", token);
        fd.append("photo", file);
        const { data } = await api.post("/projects/public-intake/photos/", fd);
        const created = Array.isArray(data?.photos) ? data.photos : [];
        setForm((prev) => ({
          ...prev,
          clarification_photos: [...created, ...(prev.clarification_photos || [])],
        }));
      }
      toast.success("Photo uploaded.");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not upload photo.");
    } finally {
      setClarificationUploading(false);
    }
  }

  async function handleBranchSubmit() {
    if (!token) {
      toast.error("Missing intake token.");
      return null;
    }

    const selectedContractors = (Array.isArray(discoveryTargets) ? discoveryTargets : [])
      .map(serializeSelectedContractor)
      .filter((row) => contractorSelectionKey(row));
    const manualSingle = { name: singleContractor.name, email: singleContractor.email, phone: singleContractor.phone };
    const manualContractors =
      branchMode === "single_contractor"
        ? (hasManualContractorContact(manualSingle) ? [manualSingle] : [])
        : (branchContacts || []).filter(hasManualContractorContact);
    const effectiveBranchMode =
      selectedContractors.length > 1 ? "multi_contractor" : selectedContractors.length === 1 ? "single_contractor" : branchMode;

    try {
      setBranchSubmitting(true);
      const data = await saveIntake({
        showToast: false,
        branchFlow: effectiveBranchMode,
        contractors: manualContractors,
        selectedContractors,
        branchMessageOverride: branchMessage,
      });

      if (data) {
        setBranchMode(effectiveBranchMode);
        setBranchResult({
          ...(data?.post_submit_flow ? data : branchResult || {}),
          post_submit_flow: data?.post_submit_flow || effectiveBranchMode,
          selected_contractors: selectedContractors,
          selected_contractor_count: selectedContractors.length,
        });
        toast.success(
          selectedContractors.length
            ? `Saved ${selectedContractors.length} selected contractor${selectedContractors.length === 1 ? "" : "s"} for review.`
            : Array.isArray(data?.branch_invites) && data.branch_invites.length
              ? `Created ${data.branch_invites.length} contractor invite${data.branch_invites.length === 1 ? "" : "s"}.`
              : "Saved your next-step choice."
        );
        setCurrentStep(8);
      }
      return data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save your next-step choice.");
      return null;
    } finally {
      setBranchSubmitting(false);
    }
  }

  function handleSkipContractorBranch() {
    setBranchResult((prev) => prev || null);
    setCurrentStep(8);
    toast.success("You can skip contractor entry for now and continue.");
  }

  async function createSelectedContractorOpportunities() {
    const selectedContractors = (Array.isArray(discoveryTargets) ? discoveryTargets : [])
      .map(serializeSelectedContractor)
      .filter((row) => contractorSelectionKey(row));
    if (!selectedContractors.length) return null;

    const effectiveForm = getEffectiveProjectForm(form);
    const { data } = await api.post("/projects/public-intake/select-contractor/", {
      token,
      selected_contractors: selectedContractors,
      project_context: {
        homeowner_name: cleanText(effectiveForm.customer_name),
        homeowner_email: cleanText(effectiveForm.customer_email),
        homeowner_phone: cleanText(effectiveForm.customer_phone),
        project_title: cleanText(generatedProjectTitle || effectiveForm.ai_project_title),
        project_type: cleanText(effectiveForm.ai_project_type),
        project_subtype: cleanText(effectiveForm.ai_project_subtype),
        project_description: cleanText(effectiveForm.accomplishment_text),
        refined_description: cleanText(
          effectiveForm.refined_description || effectiveForm.ai_description || effectiveForm.project_scope_summary
        ),
        project_address_line1: cleanText(effectiveForm.project_address_line1),
        project_city: cleanText(effectiveForm.project_city),
        project_state: cleanText(effectiveForm.project_state),
        project_postal_code: cleanText(effectiveForm.project_postal_code),
        timeline: cleanText(effectiveForm.desired_timing_text || effectiveForm.timeline),
        measurements: effectiveForm.measurements || effectiveForm.measurement_answers || [],
      },
    });
    return data;
  }

  async function handleConfirm() {
    if (!canFinish) {
      toast.error("Please complete the project and contact details first.");
      return;
    }

    const saved = await saveIntake({
      showToast: false,
      formOverrides: { ai_project_title: generatedProjectTitle },
      finalSubmit: true,
    });
    if (!saved) return;

    let selectionResult = null;
    try {
      selectionResult = await createSelectedContractorOpportunities();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save selected contractors.");
      return;
    }

    const selectedCount =
      Number(selectionResult?.opportunity_count || 0) ||
      (Array.isArray(selectionResult?.created) ? selectionResult.created.length : 0) ||
      Number(saved?.opportunity_count || 0) ||
      (Array.isArray(saved?.created) ? saved.created.length : 0) ||
      (Array.isArray(discoveryTargets) ? discoveryTargets.length : 0);
    setSubmissionConfirmation({
      projectTitle: saved?.ai_project_title || generatedProjectTitle || "Home Improvement Project",
      selectedCount,
      customerAccount: saved?.customer_account || null,
    });
    toast.success("Project request submitted.");
  }

  const effectiveForm = getEffectiveProjectForm(form);
  const summaryAddress = formatProjectAddress(effectiveForm);
  const projectSummaryRows = useMemo(() => {
    const rows = [];
    const seenKeys = new Set();
    const seenLabels = new Set();
    const addRow = (key, label, value) => {
      const normalized = summarizeTextValue(value, 140);
      if (!normalized) return;
      const rowKey = toTestIdSegment(key || label);
      const rowLabel = summarizeTextValue(label, 60);
      if (seenKeys.has(rowKey) || seenLabels.has(rowLabel)) return;
      seenKeys.add(rowKey);
      seenLabels.add(rowLabel);
      rows.push({ key: rowKey, label: rowLabel, value: normalized });
    };

    addRow("project-type", "Project Type", form.ai_project_type);
    addRow("project-focus", "Project Focus", form.ai_project_subtype);
    addRow("main-goal", "Main Goal", getMainGoalSummary(generatedProjectTitle, form.refined_description || form.ai_description));
    addRow("original-description", "Original Description", form.accomplishment_text);
    addRow("refined-description", "Refined Description", form.refined_description || form.ai_description);
    addRow("timing", "Timeline", form.desired_timing_text);
    if (form.desired_timing_text === "Specific date") {
      addRow("tentative-start-date", "Tentative Start Date", form.tentative_start_date);
    }
    addRow("budget", "Budget Range", form.budget_range_text);
    addRow("measurements", "Measurements", form.measurement_handling);

    (clarificationQuestions || []).forEach((question) => {
      const key = question?.key || "";
      if (!key) return;
      const rawAnswer = form.ai_clarification_answers?.[key];
      const answer = summarizeTextValue(Array.isArray(rawAnswer) ? rawAnswer.join(", ") : rawAnswer, 140);
      if (!answer) return;
      const label = getFriendlyClarificationLabel(question);
      addRow(`clarification-${key}`, label, answer);
    });

    return rows;
  }, [
    clarificationQuestions,
    form.ai_clarification_answers,
    form.accomplishment_text,
    form.ai_description,
    form.refined_description,
    form.ai_project_budget,
    form.ai_project_subtype,
    form.ai_project_title,
    form.ai_project_timeline_days,
    form.ai_project_type,
    form.budget_range_text,
    form.desired_timing_text,
    generatedProjectTitle,
    form.measurement_handling,
    form.tentative_start_date,
  ]);
  const confidenceMessage = useMemo(() => {
    if (currentStep >= 8) return "Almost ready to send to contractors.";
    if (currentStep === 7) return "You are choosing the path that feels right.";
    if (currentStep === 6) return "Review a few good contractor matches before you decide the next step.";
    if (currentStep === 5) return "A few contact details now will help the next step feel easy.";
    if (currentStep === 4) return "Add the location and project details that help contractors review your request.";
    if (currentStep === 3) return "Your contractor will review this summary before creating the final scope.";
    if (currentStep === 2) return "Review the project snapshot before the full summary.";
    if (currentStep === 1) return "Refine the details so your contractor can review the request more clearly.";
    return "Tell us about the project and we will help organize it for contractor review.";
  }, [currentStep]);
  const renderStep = () => {
    if (currentStep === 0) {
      return (
        <div className={intakeLightCardClass} data-testid="public-intake-main-card">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Tell us about the project</h2>
          <p className="mt-2 text-base text-gray-600">
            Tell us what you&apos;d like to get done. We&apos;ll help organize it for contractor review.
          </p>
          <textarea
            data-testid="public-intake-accomplishment-text"
            className="mt-5 w-full rounded-2xl border border-blue-200/80 bg-white px-4 py-4 text-base text-slate-950 shadow-sm outline-none transition placeholder:text-slate-500 focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            rows={10}
            value={form.accomplishment_text}
            onChange={(e) => handleAccomplishmentChange(e.target.value)}
            placeholder="Describe what you want to get done. For example: replace kitchen cabinets, fix a roof leak, or remodel a bathroom."
          />
          <div className="mt-3 text-sm text-slate-500">
            You don&apos;t need to be perfect - just describe it in your own words.
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="public-intake-description-help">
            <div className="text-sm font-semibold text-slate-900">Want help describing your project?</div>
            <p className="mt-1 text-sm text-slate-600">
              We can help make your description a little clearer before you generate the project plan.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="public-intake-improve-description-button"
                onClick={handleImproveDescription}
                disabled={saving || !String(form.accomplishment_text || "").trim() || descriptionRefinement.status === "loading"}
                className="rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:cursor-not-allowed disabled:text-slate-500 disabled:opacity-70"
              >
                {descriptionRefinement.status === "loading" ? "Improving..." : "Improve my description"}
              </button>
              <span className="text-sm text-slate-500">This is optional. You can keep your original wording if you prefer.</span>
            </div>
          </div>
          {descriptionRefinement.status === "ready" ? (
            <div
              className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-sm"
              data-testid="public-intake-description-refinement-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-indigo-900">Suggested version</div>
                  <p className="mt-1 text-sm text-indigo-800">
                    {descriptionRefinement.source === "ai"
                      ? "Here’s a clearer version based on your description."
                      : "Here’s a cleaner version based on what you wrote."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="public-intake-description-use-version"
                    onClick={acceptDescriptionSuggestion}
                    className={intakePrimaryButtonClass}
                  >
                    Use this version
                  </button>
                  <button
                    type="button"
                    data-testid="public-intake-description-keep-original"
                    onClick={keepOriginalDescription}
                    className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
                  >
                    Keep my original
                  </button>
                </div>
              </div>
              <textarea
                data-testid="public-intake-description-refined-textarea"
                className="mt-4 w-full rounded-2xl border border-indigo-200 bg-white px-4 py-4 text-base shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                rows={8}
                value={descriptionRefinement.suggestion}
                onChange={(e) =>
                  setDescriptionRefinement((prev) => ({
                    ...prev,
                    suggestion: e.target.value,
                  }))
                }
              />
              <div className="mt-2 text-xs text-indigo-700">
                Review and edit this suggestion before using it.
              </div>
            </div>
          ) : null}
          {descriptionRefinement.status !== "ready" && String(form.refined_description || form.ai_description || "").trim() ? (
            <div
              className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm"
              data-testid="public-intake-description-accepted-card"
            >
              <div className="text-sm font-semibold text-emerald-900">Accepted refined version</div>
              <p className="mt-1 text-sm text-emerald-800">
                We&apos;ll use this clearer version for contractor review while keeping your original wording separately.
              </p>
              <div
                className="mt-3 whitespace-pre-line rounded-xl bg-white px-4 py-3 text-sm leading-6 text-slate-800"
                data-testid="public-intake-description-accepted-text"
              >
                {form.refined_description || form.ai_description}
              </div>
              <div className="mt-2 text-xs text-emerald-800">
                Editing the project description above will clear this accepted version and use your manual wording instead.
              </div>
            </div>
          ) : null}
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              data-testid="public-intake-generate-structure"
              onClick={handleGenerateStructure}
              disabled={saving || !canGenerateStructure}
              className={intakePrimaryButtonClass}
            >
              {saving ? "Generating..." : "Build Project Summary"}
            </button>
          </div>
        </div>
      );
    }

    if (currentStep === 1) {
      const questionCount = clarificationQuestions.length;
      const questionNumber = questionCount ? Math.min(currentQuestionIndex + 1, questionCount) : 0;
      const isLastQuestion = questionCount === 0 || currentQuestionIndex >= questionCount - 1;
      const options = Array.isArray(activeClarificationQuestion?.options) ? activeClarificationQuestion.options : [];
      const isChoiceQuestion = options.length > 0;
      const isTextareaQuestion = (activeClarificationQuestion?.inputType || activeClarificationQuestion?.type) === "textarea";

      return (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.28fr)_minmax(300px,0.72fr)]">
          <div className="space-y-5">
            <div className={intakeLightCardClass} data-testid="public-intake-clarification-step">
              <div className="max-w-2xl">
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Refine Your Project</h2>
                <p className="mt-2 text-base text-gray-600">
                  A few quick details make your request clearer, faster to review, and easier to price accurately.
                </p>
                <p className="mt-1 text-sm text-slate-500">Your contractor will verify measurements before work begins.</p>
              </div>

              <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 shadow-sm" data-testid="public-intake-clarification-photo-section">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-gray-900">Add Photos (Optional)</div>
                    <div className="text-xs text-slate-500">
                      Photos help contractors understand the project faster and estimate with more confidence.
                    </div>
                    <div className="text-xs text-slate-500">
                      Helpful examples: wide shot, close-up, inspiration photo, or measurements/sketches if available.
                    </div>
                    <div className="text-xs text-slate-500">Even one clear photo can be useful.</div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-amber-300/45 bg-gradient-to-r from-blue-700 via-indigo-700 to-violet-700 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200 hover:from-blue-600 hover:to-violet-600">
                    {clarificationUploading ? "Uploading..." : "Upload photo(s)"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => uploadClarificationPhotos(e.target.files)}
                      disabled={clarificationUploading}
                      data-testid="public-intake-clarification-photo-upload"
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <div className="rounded-xl bg-white/80 px-3 py-2">Wide shot of the room or area</div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">Close-up of the issue</div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">Inspiration photos</div>
                  <div className="rounded-xl bg-white/80 px-3 py-2">Measurements or sketches if available</div>
                </div>
                <div className="mt-5" data-testid="public-intake-clarification-uploaded-files">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Uploaded photos</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(form.clarification_photos || []).length ? (
                      form.clarification_photos.map((photo) => (
                        <div key={photo.id || photo.image_url} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                          <div className="bg-slate-100">
                            {photo.image_url ? (
                              <img
                                src={photo.image_url}
                                alt={photo.caption || photo.original_name || "Project photo"}
                                className="h-32 w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-32 items-center justify-center text-xs text-slate-500">
                                Preview unavailable
                              </div>
                            )}
                          </div>
                          <div className="px-3 py-2">
                            <div className="text-sm font-semibold text-slate-900">
                              {photo.caption || photo.original_name || "Photo"}
                            </div>
                            <div className="mt-1 text-xs text-slate-500">Uploaded and saved</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-500">
                        No photos uploaded yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {questionCount ? (
                <div className="mt-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">Quick questions</div>
                      <div className="text-xs text-gray-500">
                        Short answers are enough. We use them to tighten the project plan.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs font-semibold text-indigo-700 hover:underline"
                      onClick={() => setForm((prev) => ({ ...prev, ai_clarification_answers: emptyClarificationAnswers() }))}
                    >
                      Clear answers
                    </button>
                  </div>

                  <div className="mt-4">
                    <div
                      className="mb-3 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                      data-testid="public-intake-clarification-progress"
                    >
                      <span>
                        Question {questionNumber} of {questionCount}
                      </span>
                      <span>{activeClarificationAnswer ? "Answer saved" : "Optional"}</span>
                    </div>

                    <div
                      className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-5 shadow-sm"
                      data-testid={`public-intake-clarification-${activeClarificationQuestion?.key || "question"}`}
                    >
                      <div className="inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                        AI prompt
                      </div>
                      <div className="mt-3 text-base font-semibold text-gray-900" data-testid="public-intake-clarification-prompt">
                        {activeClarificationQuestion?.label || activeClarificationQuestion?.question || "Clarification question"}
                      </div>
                      {activeClarificationQuestion?.help ? (
                        <div className="mt-2 text-sm text-slate-600">{activeClarificationQuestion.help}</div>
                      ) : null}
                      <div className="mt-3 text-xs text-slate-500">You can skip anything you&apos;re unsure about.</div>

                      <div className="mt-4" data-testid="public-intake-clarification-answer-controls">
                        {isChoiceQuestion ? (
                          <div className="flex flex-wrap gap-2">
                            {options.map((opt) => (
                              <button
                                key={String(opt)}
                                type="button"
                                onClick={() => {
                                  if (!activeClarificationQuestion?.key) return;
                                  setClarificationAnswer(activeClarificationQuestion.key, opt);
                                }}
                                data-testid={`public-intake-clarification-option-${activeClarificationQuestion?.key || "question"}-${String(opt)
                                  .toLowerCase()
                                  .replace(/[^a-z0-9]+/g, "-")
                                  .replace(/^-+|-+$/g, "")}`}
                                className={`rounded-full border px-3 py-2 text-sm font-semibold ${
                                  String(activeClarificationAnswer) === String(opt)
                                    ? "border-blue-700 bg-blue-700 text-white"
                                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                }`}
                              >
                                {String(opt)}
                              </button>
                            ))}
                          </div>
                        ) : isTextareaQuestion ? (
                          <textarea
                            rows={4}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            value={activeClarificationAnswer}
                            onChange={(e) => {
                              if (!activeClarificationQuestion?.key) return;
                              setClarificationAnswer(activeClarificationQuestion.key, e.target.value);
                            }}
                            placeholder="Type a short answer or skip this question"
                            data-testid="public-intake-clarification-answer-input"
                          />
                        ) : (
                          <input
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            value={activeClarificationAnswer}
                            onChange={(e) => {
                              if (!activeClarificationQuestion?.key) return;
                              setClarificationAnswer(activeClarificationQuestion.key, e.target.value);
                            }}
                            placeholder="Type a short answer or skip this question"
                            data-testid="public-intake-clarification-answer-input"
                          />
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleBack}
                            data-testid="public-intake-clarification-back"
                            className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            onClick={() => handleClarificationAdvance({ skip: true })}
                            data-testid="public-intake-clarification-skip"
                            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Skip
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleClarificationAdvance()}
                          data-testid="public-intake-clarification-next"
                          className={intakePrimaryButtonClass}
                        >
                          {isLastQuestion ? "Continue to Project Details" : "Next"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <aside className="self-start lg:sticky lg:top-6">
            <div
              className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-xl shadow-slate-950/15 ring-1 ring-white/80"
              data-testid="public-intake-project-summary"
            >
              <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                Helpful guidance
              </div>
              <div className="text-lg font-semibold tracking-tight text-gray-900" data-testid="public-intake-project-summary-title">
                Your Project So Far
              </div>
              <p className="mt-2 text-sm text-slate-600">Your contractor will review and confirm details before final pricing.</p>
              <div className="mt-5">
                {projectSummaryRows.length ? (
                  <dl className="space-y-3">
                    {projectSummaryRows.map((row) => (
                      <div key={row.key} data-testid={`public-intake-project-summary-row-${row.key}`} className="rounded-xl bg-slate-50 px-4 py-3">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{row.label}</dt>
                        <dd className="mt-1 text-sm font-medium leading-6 text-slate-900">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    Keep answering questions to see your project come into focus.
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-900">What happens next</div>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  <li>• Your contractor reviews what you&apos;ve shared.</li>
                  <li>• They may confirm a few details before pricing.</li>
                  <li>• You stay in control of the next step.</li>
                </ul>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-semibold text-slate-900">Measurements</div>
                <p className="mt-2 text-sm text-slate-600">Your contractor will verify measurements before work begins.</p>
              </div>

              {!questionCount ? (
                <button
                  type="button"
                  onClick={() => handleClarificationAdvance()}
                  data-testid="public-intake-clarification-next"
                  className={`mt-5 w-full ${intakePrimaryButtonClass}`}
                >
                  Continue to Project Details
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      );
    }

    if (currentStep === 2) {
      const snapshotRows = [
        {
          key: "snapshot-title",
          label: "Working Title",
          value: generatedProjectTitle || "Project Request",
        },
        {
          key: "snapshot-type",
          label: "Project Type",
          value: [form.ai_project_type, form.ai_project_subtype].filter(Boolean).join(" / ") || "Not provided",
        },
        {
          key: "snapshot-summary",
          label: "Scope Summary",
          value: form.project_scope_summary || form.refined_description || form.ai_description || form.accomplishment_text || "Not provided",
        },
        {
          key: "snapshot-timeline",
          label: "Timeline",
          value: form.desired_timing_text || "Not provided",
        },
      ];
      return (
        <div className={intakeLightCardClass} data-testid="public-intake-project-snapshot">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Project Snapshot
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900" data-testid="public-intake-project-snapshot-title">
              Project Snapshot
            </h2>
            <p className="mt-2 text-base text-slate-600">
              Here is a quick checkpoint before the full project summary.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {snapshotRows.map((row) => (
              <section key={row.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <div className="text-sm font-semibold text-gray-900">{row.label}</div>
                <div className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{row.value}</div>
              </section>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setCurrentStep(3)}
            data-testid="public-intake-project-snapshot-continue"
            className={`mt-6 ${intakePrimaryButtonClass}`}
          >
            Continue to Project Summary
          </button>
        </div>
      );
    }

    if (currentStep === 3) {
      const summaryCards = [
        {
          key: "summary-original-description",
          label: "Original Description",
          value: form.accomplishment_text || "No description entered yet.",
        },
        {
          key: "summary-refined-description",
          label: "Refined Description",
          value: form.refined_description || form.ai_description || "Not provided",
        },
        {
          key: "summary-project-type",
          label: "Project Type",
          value: [form.ai_project_type, form.ai_project_subtype].filter(Boolean).join(" / ") || "Not provided",
        },
        {
          key: "summary-timeline",
          label: "Timeline",
          value:
            form.desired_timing_text === "Specific date"
              ? `${form.desired_timing_text}: ${form.tentative_start_date || "Not provided"}`
              : form.desired_timing_text || "Not provided",
        },
        {
          key: "summary-budget",
          label: "Budget Range",
          value: form.budget_range_text || "Not provided",
        },
        {
          key: "summary-measurements",
          label: "Measurements",
          value: form.measurement_handling || "Not provided",
        },
        {
          key: "summary-project-class",
          label: "Project Class",
          value: projectClassLabel(form.project_class),
        },
        {
          key: "summary-project-mode",
          label: "Project Mode",
          value: projectModeLabel(form.project_mode) || "Not provided",
        },
        {
          key: "summary-payment-preference",
          label: "Payment Preference",
          value: paymentPreferenceLabel(form.payment_preference),
        },
        {
          key: "summary-address",
          label: "Address / Location",
          value: summaryAddress || "Not provided",
        },
      ];
      return (
        <div className={intakeLightCardClass} data-testid="public-intake-structured-output-step">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Project Summary
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900" data-testid="public-intake-structured-output-title">
              Project Summary
            </h2>
            <p className="mt-2 text-base text-slate-600">
              Here&apos;s the project summary we created from your description and answers.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              We&apos;ll help organize this for contractor review. Your contractor will create the final agreement and milestones later.
            </p>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {summaryCards.map((card) => (
              <section key={card.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <div className="text-sm font-semibold text-gray-900">{card.label}</div>
                <div className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{card.value}</div>
              </section>
            ))}
          </div>

          <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5 shadow-sm">
            <div className="text-sm font-semibold text-indigo-900">What happens next</div>
            <ul className="mt-3 space-y-2 text-sm text-indigo-900/80">
              <li>• Your contractor reviews this summary and your original wording.</li>
              <li>• They may refine the scope, pricing, and milestones later.</li>
              <li>• You can still adjust the details before you send it forward.</li>
            </ul>
          </section>
        </div>
      );
    }
    if (currentStep === 4) {
      return (
        <div className={intakeLightCardClass} data-testid="public-intake-project-details-step">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Refine the plan
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">Project Details</h2>
            <p className="mt-2 text-base text-slate-600">
              Add the project location and a few details that help contractors review your request.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Keep going at the pace that feels right. You can adjust these details later if needed.
            </p>
          </div>

          <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Project type</div>
            <p className="mt-1 text-sm text-slate-600">
              We inferred this from your description. You can adjust it before contractors review the request.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Project Type</label>
                <select
                  data-testid="public-intake-project-type"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  value={form.ai_project_type}
                  onChange={(e) => {
                    setProjectTypeTouched(true);
                    setField("ai_project_type", e.target.value);
                  }}
                >
                  <option value="">Not provided</option>
                  <option value="Concrete">Concrete</option>
                  <option value="Patio / Hardscape">Patio / Hardscape</option>
                  <option value="Cabinets / Carpentry">Cabinets / Carpentry</option>
                  <option value="Kitchen Remodeling">Kitchen Remodeling</option>
                  <option value="Bathroom Remodeling">Bathroom Remodeling</option>
                  <option value="Flooring">Flooring</option>
                  <option value="Painting / Drywall">Painting / Drywall</option>
                  <option value="Roofing">Roofing</option>
                  <option value="General Contracting">General Contracting</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Subtype or focus</label>
                <input
                  data-testid="public-intake-project-subtype"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  value={form.ai_project_subtype}
                  onChange={(e) => {
                    setProjectTypeTouched(true);
                    setField("ai_project_subtype", e.target.value);
                  }}
                  placeholder="Example: Patio / Hardscape"
                />
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Budget and timing</div>
            <p className="mt-1 text-sm text-slate-600">Optional details help contractors understand urgency and ballpark fit.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Budget range</label>
                <select
                  data-testid="public-intake-budget-range"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  value={form.budget_range_text}
                  onChange={(e) => setField("budget_range_text", e.target.value)}
                >
                  <option value="">Not provided</option>
                  <option value="Not sure yet">Not sure yet</option>
                  <option value="Under $1,000">Under $1,000</option>
                  <option value="$1,000-$2,500">$1,000-$2,500</option>
                  <option value="$2,500-$5,000">$2,500-$5,000</option>
                  <option value="$5,000-$10,000">$5,000-$10,000</option>
                  <option value="$10,000+">$10,000+</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Timeline</label>
                <select
                  data-testid="public-intake-timeline"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  value={form.desired_timing_text}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      desired_timing_text: value,
                      tentative_start_date: value === "Specific date" ? prev.tentative_start_date : "",
                    }));
                  }}
                >
                  <option value="">Not provided</option>
                  <option value="As soon as possible">As soon as possible</option>
                  <option value="Within the next month">Within the next month</option>
                  <option value="1-3 months">1-3 months</option>
                  <option value="Just planning right now">Just planning right now</option>
                  <option value="Specific date">Specific date</option>
                </select>
              </div>
              {form.desired_timing_text === "Specific date" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Tentative start date</label>
                  <input
                    type="date"
                    data-testid="public-intake-tentative-start-date"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.tentative_start_date}
                    onChange={(e) => setField("tentative_start_date", e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Measurements</div>
            <p className="mt-1 text-sm text-slate-600">
              Share any dimensions you know. Your contractor will confirm measurements before final pricing.
            </p>
            {inferredMeasurements.length ? (
              <div className="mt-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Inferred from your description</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {inferredMeasurements.map((measurement) => (
                    <span
                      key={measurement}
                      className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800"
                    >
                      {measurement}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <input
                  data-testid="public-intake-measurement-length"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Approx. length"
                  onChange={(e) => {
                    setMeasurementsTouched(true);
                    setForm((prev) => ({
                      ...prev,
                      measurement_handling: [
                        e.target.value ? `Length: ${e.target.value}` : "",
                        prev.ai_clarification_answers?.measurement_width ? `Width: ${prev.ai_clarification_answers.measurement_width}` : "",
                        prev.ai_clarification_answers?.measurement_quantity ? `Area/quantity: ${prev.ai_clarification_answers.measurement_quantity}` : "",
                      ]
                        .filter(Boolean)
                        .join("\n"),
                      ai_clarification_answers: {
                        ...(prev.ai_clarification_answers || {}),
                        measurement_length: e.target.value,
                      },
                    }));
                  }}
                />
                <input
                  data-testid="public-intake-measurement-width"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Approx. width"
                  onChange={(e) => {
                    setMeasurementsTouched(true);
                    setForm((prev) => ({
                      ...prev,
                      measurement_handling: [
                        prev.ai_clarification_answers?.measurement_length ? `Length: ${prev.ai_clarification_answers.measurement_length}` : "",
                        e.target.value ? `Width: ${e.target.value}` : "",
                        prev.ai_clarification_answers?.measurement_quantity ? `Area/quantity: ${prev.ai_clarification_answers.measurement_quantity}` : "",
                      ]
                        .filter(Boolean)
                        .join("\n"),
                      ai_clarification_answers: {
                        ...(prev.ai_clarification_answers || {}),
                        measurement_width: e.target.value,
                      },
                    }));
                  }}
                />
                <input
                  data-testid="public-intake-measurement-quantity"
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Area or quantity"
                  onChange={(e) => {
                    setMeasurementsTouched(true);
                    setForm((prev) => ({
                      ...prev,
                      measurement_handling: [
                        prev.ai_clarification_answers?.measurement_length ? `Length: ${prev.ai_clarification_answers.measurement_length}` : "",
                        prev.ai_clarification_answers?.measurement_width ? `Width: ${prev.ai_clarification_answers.measurement_width}` : "",
                        e.target.value ? `Area/quantity: ${e.target.value}` : "",
                      ]
                        .filter(Boolean)
                        .join("\n"),
                      ai_clarification_answers: {
                        ...(prev.ai_clarification_answers || {}),
                        measurement_quantity: e.target.value,
                      },
                    }));
                  }}
                />
              </div>
            )}
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-gray-900">Measurement notes</label>
              <textarea
                data-testid="public-intake-measurements-input"
                rows={4}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                value={form.measurement_handling}
                onChange={(e) => {
                  setMeasurementsTouched(true);
                  setField("measurement_handling", e.target.value);
                }}
                placeholder="Example: 12 ft x 10 ft existing patio, 6 ft extension, 4 in slab"
              />
            </div>
            <button
              type="button"
              data-testid="public-intake-measurements-not-sure"
              onClick={() => {
                setMeasurementsTouched(true);
                setField("measurement_handling", "Not sure yet");
              }}
              className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Not sure yet
            </button>
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <div className="text-sm font-semibold text-gray-900">Customer Address</div>
              <p className="mt-1 text-sm text-slate-600">Where should this request be tied to in your records?</p>
              <div className="mt-4">
                <div data-testid="public-intake-customer-address-autocomplete" className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Address search</div>
                  <AddressAutocomplete
                    value={form.customer_address_line1}
                    onChangeText={(text) => setField("customer_address_line1", text)}
                    onSelect={(addr) => {
                      const nextLine1 = addr.line1 || form.customer_address_line1 || "";
                      const nextCity = addr.city || form.customer_city || "";
                      const nextState = addr.state || form.customer_state || "";
                      const nextPostal = addr.postal_code || form.customer_postal_code || "";
                      setForm((prev) => {
                        const next = {
                          ...prev,
                          customer_address_line1: nextLine1,
                          customer_city: nextCity,
                          customer_state: nextState,
                          customer_postal_code: nextPostal,
                        };
                        return next.same_as_customer_address ? copyCustomerAddressToProject(next) : next;
                      });
                    }}
                    placeholder="Start typing the street address (pick from suggestions)…"
                  />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-900">Address line 1</label>
                  <input
                    data-testid="public-intake-customer-address-line1"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_address_line1}
                    onChange={(e) => setField("customer_address_line1", e.target.value)}
                    placeholder="123 Main St"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-900">Address line 2</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_address_line2}
                    onChange={(e) => setField("customer_address_line2", e.target.value)}
                    placeholder="Apt, Suite, etc."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">City</label>
                  <input
                    data-testid="public-intake-customer-city"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_city}
                    onChange={(e) => setField("customer_city", e.target.value)}
                    placeholder="City"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">State</label>
                  <input
                    data-testid="public-intake-customer-state"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_state}
                    onChange={(e) => setField("customer_state", e.target.value)}
                    placeholder="State"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">ZIP / Postal Code</label>
                  <input
                    data-testid="public-intake-customer-postal-code"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_postal_code}
                    onChange={(e) => setField("customer_postal_code", e.target.value)}
                    placeholder="ZIP / Postal code"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                <div className="text-sm font-semibold text-gray-900">Project Class</div>
              <p className="mt-1 text-sm text-slate-600">This helps organize the request and any follow-up steps.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {[{ value: "residential", label: "Residential" }, { value: "commercial", label: "Commercial" }].map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium shadow-sm transition ${
                      form.project_class === opt.value
                        ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="project_class"
                      checked={form.project_class === opt.value}
                      onChange={() => setField("project_class", opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <div className="mt-5">
                <div className="text-sm font-semibold text-gray-900">Project Mode</div>
                <p className="mt-1 text-sm text-slate-600">
                  Choose the relationship between the contractor and homeowner for this request.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {PROJECT_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setField("project_mode", opt.value)}
                      data-testid={`project-mode-option-${opt.value}`}
                      className={`rounded-2xl border px-4 py-3 text-left text-sm shadow-sm transition ${
                        form.project_mode === opt.value
                          ? "border-indigo-500 bg-indigo-50 text-indigo-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-semibold">{opt.label}</div>
                      <div className="mt-1 text-xs text-slate-600">{opt.help}</div>
                    </button>
                  ))}
                </div>
              </div>
              {form.project_mode !== "full_service" ? (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold text-gray-900">{projectModeLabel(form.project_mode)} details</div>
                  <p className="mt-1 text-sm text-slate-600">
                    Many homeowners choose Assisted DIY to save money while still working with a professional.
                  </p>
                  {normalizeProjectMode(form.project_mode) === "assisted_diy" && safetyWarning ? (
                    <div
                      className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      data-testid="public-assisted-diy-safety-banner"
                    >
                      <div className="font-semibold">{safetyWarning.banner}</div>
                      {Array.isArray(safetyWarning.categories) && safetyWarning.categories.length ? (
                        <div className="mt-1 text-xs text-amber-800">
                          Restricted phases detected: {safetyWarning.categories.join(", ")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {normalizeProjectMode(form.project_mode) === "assisted_diy" ? (
                    <label className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={assistedDiyAcknowledged}
                        onChange={(e) => setAssistedDiyAcknowledged(e.target.checked)}
                        className="mt-0.5"
                        data-testid="public-assisted-diy-acknowledgment"
                      />
                      <span>
                        I understand that restricted trade phases stay contractor-led unless local law and the scope allow otherwise.
                      </span>
                    </label>
                  ) : null}
                  <label className="mb-1 block text-sm font-medium text-gray-900">
                    Homeowner participation notes
                  </label>
                  <textarea
                    className="w-full rounded border px-3 py-2 text-sm"
                    rows={3}
                    value={form.homeowner_participation_notes}
                    onChange={(e) => setField("homeowner_participation_notes", e.target.value)}
                    placeholder="Describe what the homeowner will do, what the contractor will do, and any exclusions."
                  />
                  {normalizeProjectMode(form.project_mode) === "assisted_diy" ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-900">
                          Which parts will the homeowner handle?
                        </span>
                        <textarea
                          className="w-full rounded border px-3 py-2 text-sm"
                          rows={3}
                          value={form.homeowner_task_summary}
                          onChange={(e) => setField("homeowner_task_summary", e.target.value)}
                          placeholder="Example: demolition, cleanup, basic prep, materials pickup"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-gray-900">
                          Need help finishing?
                        </span>
                        <textarea
                          className="w-full rounded border px-3 py-2 text-sm"
                          rows={3}
                          value={form.homeowner_assistance_summary}
                          onChange={(e) => setField("homeowner_assistance_summary", e.target.value)}
                          placeholder="Example: supervision, labor support, inspection, or finishing assistance"
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4" data-testid="payment-preferences-section">
                <div className="text-sm font-semibold text-slate-900">Payment Preferences</div>
                <p className="mt-1 text-sm text-slate-600">{PAYMENT_PREFERENCE_SECTION_COPY}</p>
                <div className="mt-3 grid gap-2">
                  {PAYMENT_PREFERENCE_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm ${
                        form.payment_preference === opt.value
                          ? "border-blue-500 bg-white text-blue-900"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                    >
                      <input
                        type="radio"
                        name="payment_preference"
                        checked={form.payment_preference === opt.value}
                        onChange={() => setField("payment_preference", opt.value)}
                        className="mt-1"
                        data-testid={`public-intake-payment-preference-${opt.value}`}
                      />
                      <span>
                        <span className="inline-flex items-center gap-2 font-semibold">
                          {opt.label}
                          <PaymentPreferenceHelp label={opt.label}>{opt.help}</PaymentPreferenceHelp>
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
                <input
                  type="checkbox"
                  checked={form.same_as_customer_address}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setForm((prev) =>
                      checked
                        ? copyCustomerAddressToProject({ ...prev, same_as_customer_address: true })
                        : { ...prev, same_as_customer_address: false }
                    );
                  }}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-gray-900">Project address is the same as my customer/home address</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    Use this when the job site and contact address are the same.
                  </span>
                </span>
              </label>
            </section>

            {!form.same_as_customer_address ? (
              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm lg:col-span-2">
                <div className="text-sm font-semibold text-gray-900">Project Address</div>
                <p className="mt-1 text-sm text-slate-600">Where is the work actually happening?</p>
                <div className="mt-4">
                  <div data-testid="public-intake-project-address-autocomplete" className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Address search</div>
                    <AddressAutocomplete
                      value={form.project_address_line1}
                      onChangeText={(text) => setField("project_address_line1", text)}
                      onSelect={(addr) => {
                        setForm((prev) => ({
                          ...prev,
                          project_address_line1: addr.line1 || prev.project_address_line1 || "",
                          project_address_line2: addr.line2 || prev.project_address_line2 || "",
                          project_city: addr.city || prev.project_city || "",
                          project_state: addr.state || prev.project_state || "",
                          project_postal_code: addr.postal_code || prev.project_postal_code || "",
                        }));
                      }}
                      placeholder="Start typing the street address (pick from suggestions)…"
                    />
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-gray-900">Address line 1</label>
                    <input
                      data-testid="public-intake-project-address-line1"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.project_address_line1}
                      onChange={(e) => setField("project_address_line1", e.target.value)}
                      placeholder="Project street address"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-sm font-medium text-gray-900">Address line 2</label>
                    <input
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.project_address_line2}
                      onChange={(e) => setField("project_address_line2", e.target.value)}
                      placeholder="Apartment, suite, unit, etc."
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900">City</label>
                    <input
                      data-testid="public-intake-project-city"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.project_city}
                      onChange={(e) => setField("project_city", e.target.value)}
                      placeholder="City"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900">State</label>
                    <input
                      data-testid="public-intake-project-state"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.project_state}
                      onChange={(e) => setField("project_state", e.target.value)}
                      placeholder="State"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900">ZIP / Postal Code</label>
                    <input
                      data-testid="public-intake-project-postal-code"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.project_postal_code}
                      onChange={(e) => setField("project_postal_code", e.target.value)}
                      placeholder="ZIP / Postal code"
                    />
                  </div>
                </div>
              </section>
            ) : (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
                <div className="text-sm font-semibold text-gray-900">Project Address</div>
                <p className="mt-1 text-sm text-slate-600">This job will use your customer/home address for the project record.</p>
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                  <div className="font-medium text-gray-900">Address preview</div>
                  <div className="mt-2 whitespace-pre-line">
                    {[form.project_address_line1, form.project_address_line2, [form.project_city, form.project_state, form.project_postal_code].filter(Boolean).join(", ")]
                      .filter(Boolean)
                      .join("\n") || "No address entered yet."}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      );
    }

    if (currentStep === 5) {
      return (
        <div className={intakeLightCardClass} data-testid="public-intake-contact-step">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Stay in touch
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">Contact Info</h2>
            <p className="mt-2 text-base text-slate-600">Where should we send updates about your project?</p>
            <p className="mt-1 text-sm text-slate-500">
              We use this information to keep the project moving and send any important updates.
            </p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm lg:col-span-2">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-900">Full name</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_name}
                    onChange={(e) => setField("customer_name", e.target.value)}
                    placeholder="Your full name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Email</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_email}
                    onChange={(e) => setField("customer_email", e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Phone</label>
                  <input
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.customer_phone}
                    onChange={(e) => setField("customer_phone", e.target.value)}
                    placeholder="(555) 555-5555"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm lg:col-span-2">
              <div className="text-sm font-semibold text-gray-900">Project Location</div>
              <p className="mt-1 text-sm text-slate-600">This helps us keep your project tied to the right address.</p>
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
                <div className="font-medium text-gray-900">Address review</div>
                <div className="mt-2 whitespace-pre-line">{summaryAddress || "No project address entered yet."}</div>
              </div>
            </section>
          </div>
        </div>
      );
    }

    if (currentStep === 6) {
      return (
        <ContractorDiscoveryStep
          token={token}
          form={{ ...form, ai_project_title: generatedProjectTitle }}
          active
          selectedTargets={discoveryTargets}
          setSelectedTargets={setDiscoveryTargets}
          onSkipToManual={() => {
            setDiscoveryTargets([]);
            setBranchMode("single_contractor");
            setCurrentStep(7);
          }}
        />
      );
    }

    if (currentStep === 7) {
      return (
        <div className={intakeLightCardClass} data-testid="public-intake-branching-section">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Choose your path
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">How would you like to proceed?</h2>
            <p className="mt-2 text-base text-slate-600">
              Choose the option that feels right for this project. Choose local contractors to review your request, or skip for now.
            </p>
          </div>

          {discoveryTargets.length ? (
            <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5 shadow-sm" data-testid="public-intake-selected-contractors">
              <div className="text-sm font-semibold text-indigo-950">Selected Contractors</div>
              <p className="mt-1 text-sm text-indigo-900/80">
                These contractors were selected in local contractor search and will be included with your project request.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {discoveryTargets.map((contractor) => {
                  const key = contractorSelectionKey(contractor);
                  const address = [contractor.address || contractor.formatted_address, contractor.city, contractor.state, contractor.zip_code]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <article key={key} className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm" data-testid={`public-intake-selected-contractor-${key}`}>
                      <div className="text-sm font-semibold text-slate-950">{contractor.business_name || "Selected contractor"}</div>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <div>{contractor.phone || (contractor.phone_available ? "Phone available" : "Phone not listed")}</div>
                        <div>{contractor.public_email || contractor.email || (contractor.email_available ? "Email available" : "Email not listed")}</div>
                        {address ? <div>{address}</div> : null}
                        {contractor.recommendation_tier ? (
                          <div className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-800">
                            {contractor.recommendation_tier}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {branchResult?.post_submit_flow ? (
            <div className="mt-5 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              Selected: {branchResult.post_submit_flow === "multi_contractor" ? "Get Multiple Quotes" : "Work with One Contractor"}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => setBranchMode("single_contractor")}
              data-testid="public-intake-branch-single"
              className={`rounded-2xl border p-5 text-left shadow-sm transition ${
                branchMode === "single_contractor"
                  ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100"
                  : "border-slate-200 bg-slate-50 hover:bg-white"
              }`}
            >
              <div className="text-base font-semibold text-gray-900">Work with one contractor</div>
              <p className="mt-2 text-sm text-slate-600">
                Best when you already know who you want to work with and want to keep the process simple.
              </p>
            </button>
            <button
              type="button"
              onClick={() => setBranchMode("multi_contractor")}
              data-testid="public-intake-branch-multi"
              className={`rounded-2xl border p-5 text-left shadow-sm transition ${
                branchMode === "multi_contractor"
                  ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100"
                  : "border-slate-200 bg-slate-50 hover:bg-white"
              }`}
            >
              <div className="text-base font-semibold text-gray-900">Get multiple quotes</div>
              <p className="mt-2 text-sm text-slate-600">
                Best when you want to compare a few contractors before deciding who to move forward with.
              </p>
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            {branchMode === "single_contractor" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <div className="text-sm font-semibold text-gray-900">Add a Known Contractor</div>
                  <p className="mt-1 text-sm text-slate-600">
                    Optional. Add someone you already know in addition to any selected local contractor.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Contractor name</label>
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={singleContractor.name} onChange={(e) => setSingleContractor((prev) => ({ ...prev, name: e.target.value }))} placeholder="Contractor name" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Contractor email</label>
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={singleContractor.email} onChange={(e) => setSingleContractor((prev) => ({ ...prev, email: e.target.value }))} placeholder="contractor@example.com" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Contractor phone</label>
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={singleContractor.phone} onChange={(e) => setSingleContractor((prev) => ({ ...prev, phone: e.target.value }))} placeholder="(555) 555-5555" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Optional note</label>
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={branchMessage} onChange={(e) => setBranchMessage(e.target.value)} placeholder="Optional note for the contractor" />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="md:col-span-2">
                  <div className="text-sm font-semibold text-gray-900">Add Known Contractors</div>
                  <p className="mt-1 text-sm text-slate-600">
                    Optional. Add contractors you already know in addition to the selected local contractors above.
                  </p>
                </div>
                <div className="space-y-4">
                  {branchContacts.map((contact, index) => (
                    <div key={`contractor-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-gray-900">Contractor {index + 1}</div>
                        {branchContacts.length > 1 ? (
                          <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" onClick={() => setBranchContacts((prev) => prev.filter((_, i) => i !== index))}>Remove</button>
                        ) : null}
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={contact.name} onChange={(e) => setBranchContacts((prev) => prev.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))} placeholder="Name" />
                        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={contact.email} onChange={(e) => setBranchContacts((prev) => prev.map((item, i) => (i === index ? { ...item, email: e.target.value } : item)))} placeholder="Email" />
                        <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" value={contact.phone} onChange={(e) => setBranchContacts((prev) => prev.map((item, i) => (i === index ? { ...item, phone: e.target.value } : item)))} placeholder="Phone" />
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setBranchContacts((prev) => [...prev, { name: "", email: "", phone: "" }])}>Add another contractor</button>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Message for invited contractors</label>
                  <textarea className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100" rows={3} value={branchMessage} onChange={(e) => setBranchMessage(e.target.value)} placeholder="Optional note shared with each invited contractor" />
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 text-sm text-slate-600">
            {branchResult?.branch_invites?.length ? `${branchResult.branch_invites.length} invite${branchResult.branch_invites.length === 1 ? "" : "s"} ready for the next step.` : "You can switch paths before sending invites."}
          </div>
        </div>
      );
    }

    if (currentStep === 8) {
      return (
        <div className={intakeLightCardClass} data-testid="public-intake-review-step">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Final review
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">Review + Confirm</h2>
            <p className="mt-2 text-base text-slate-600">Take one last look before we send your project forward.</p>
            <p className="mt-1 text-sm text-slate-500">
              This is your chance to confirm the details we&apos;ve gathered so far.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              You&apos;re not committing to work yet. Your contractor will create the final agreement and milestones later.
            </p>
          </div>

          {discoveryTargets.length ? (
            <section className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5 shadow-sm" data-testid="public-intake-review-selected-contractors">
              <div className="text-sm font-semibold text-indigo-950">Selected Contractors</div>
              <p className="mt-1 text-sm text-indigo-900/80">
                These selected marketplace contractors will receive the project context after you submit.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {discoveryTargets.map((contractor) => {
                  const key = contractorSelectionKey(contractor);
                  const address = [contractor.address || contractor.formatted_address, contractor.city, contractor.state, contractor.zip_code]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <article key={key} className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm">
                      <div className="text-sm font-semibold text-slate-950">{contractor.business_name || "Selected contractor"}</div>
                      <div className="mt-2 space-y-1 text-xs text-slate-600">
                        <div>{contractor.phone || (contractor.phone_available ? "Phone available" : "Phone not listed")}</div>
                        <div>{contractor.public_email || contractor.email || (contractor.email_available ? "Email available" : "Email not listed")}</div>
                        {address ? <div>{address}</div> : null}
                        {contractor.recommendation_tier ? (
                          <div className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-800">
                            {contractor.recommendation_tier}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-900">What happens next?</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>Contractor reviews your request</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>They may ask follow-up questions if needed</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                <span>You decide how you want to proceed</span>
              </li>
            </ul>
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Project Summary</div>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Original description</div>
                <div className="mt-2 whitespace-pre-line text-sm text-slate-700">{form.accomplishment_text || "No original description yet."}</div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Refined description</div>
                <div className="mt-2 whitespace-pre-line text-sm text-slate-700">{form.refined_description || form.ai_description || "Not provided"}</div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Project summary</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{generatedProjectTitle}</div>
                <div className="mt-1 text-sm text-slate-700">{[form.ai_project_type, form.ai_project_subtype].filter(Boolean).join(" / ") || "Not provided"}</div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Timeline and budget</div>
                <div className="mt-1 text-sm text-slate-700">
                  Timeline: {form.desired_timing_text || "Not provided"}
                  {form.desired_timing_text === "Specific date" ? ` (${form.tentative_start_date || "Not provided"})` : ""}
                </div>
                <div className="mt-1 text-sm text-slate-700">Budget: {form.budget_range_text || "Not provided"}</div>
                <div className="mt-1 text-sm text-slate-700">
                  Measurements: {form.measurement_handling || "Not provided"}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
            <div className="text-sm font-semibold text-gray-900">Customer and Location</div>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Customer</div>
                <div className="mt-1 text-sm text-slate-700">{form.customer_name || "No name yet"}</div>
                <div className="mt-1 text-sm text-slate-700">{form.customer_email || "No email yet"}</div>
                <div className="mt-1 text-sm text-slate-700">{form.customer_phone || "No phone yet"}</div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Location</div>
                <div className="mt-1 whitespace-pre-line text-sm text-slate-700">{summaryAddress || "No project address entered yet."}</div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm lg:col-span-2">
            <div className="text-sm font-semibold text-gray-900">Helpful notes for contractor review</div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">What the contractor will do next</div>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  <li>• Review your description and any project notes.</li>
                  <li>• Confirm the final scope, pricing, and milestones with you.</li>
                  <li>• Adjust the agreement before work begins.</li>
                </ul>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Project context</div>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  {Object.entries(form.ai_clarification_answers || {}).length ? (
                    Object.entries(form.ai_clarification_answers || {})
                      .filter(([, value]) => String(value || "").trim())
                      .slice(0, 6)
                      .map(([key, value]) => (
                        <div key={key} className="rounded-xl bg-slate-50 px-3 py-2">
                          <span className="font-semibold text-slate-900">
                            {getFriendlyClarificationLabel(clarificationQuestions.find((question) => question?.key === key) || { key })}:
                          </span>{" "}
                          {String(value)}
                        </div>
                      ))
                  ) : (
                    <div className="text-slate-600">No clarification answers provided.</div>
                  )}
                </div>
                {Array.isArray(form.clarification_photos) && form.clarification_photos.length ? (
                  <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {form.clarification_photos.length} photo{form.clarification_photos.length === 1 ? "" : "s"} attached.
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm lg:col-span-2">
            <div className="text-sm font-semibold text-gray-900">Next Step</div>
            <div className="mt-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-sm text-slate-700">
                {branchMode === "multi_contractor" ? "Get multiple quotes" : "Work with one contractor"}
              </div>
              <div className="mt-1 text-sm text-slate-700">
                {discoveryTargets.length
                  ? `${discoveryTargets.length} selected contractor${discoveryTargets.length === 1 ? "" : "s"}`
                  : branchResult?.branch_invites?.length
                  ? `${branchResult.branch_invites.length} invite${branchResult.branch_invites.length === 1 ? "" : "s"} prepared`
                  : "No contractor invites saved yet"}
              </div>
              {branchResult?.branch_invites?.length ? (
                <div className="mt-1 text-sm text-slate-700">
                  {branchResult.branch_invites.length} known contractor invite{branchResult.branch_invites.length === 1 ? "" : "s"} prepared
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </div>
      );
    }

    return null;
  };

  if (submissionConfirmation) {
    return (
      <div className="w-full">
        <div
          className={intakeLightCardClass}
          data-testid="public-intake-submit-confirmation"
        >
          <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
            Submitted
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900">Thanks, we received your project request.</h1>
          <p className="mt-3 max-w-2xl text-base text-slate-700">
            We&apos;ll review your request and match it with the right next step.
          </p>
          <p className="mt-2 max-w-2xl text-base text-slate-700">
            We sent you a secure link to access your customer portal.
          </p>
          {submissionConfirmation.customerAccount?.created === false ? (
            <p className="mt-2 max-w-2xl text-base font-semibold text-emerald-800">
              We linked this request to your existing customer portal.
            </p>
          ) : null}

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Project title</div>
              <div className="mt-2 text-lg font-semibold text-slate-900" data-testid="public-intake-confirmation-title">
                {submissionConfirmation.projectTitle}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selected contractors</div>
              <div className="mt-2 text-lg font-semibold text-slate-900" data-testid="public-intake-confirmation-contractor-count">
                {submissionConfirmation.selectedCount || 0}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm text-indigo-950">
            <div className="font-semibold">What happens next</div>
            <ul className="mt-3 space-y-2">
              <li>We&apos;ll review your request and match it with the right next step.</li>
              <li>We sent you a secure link to access your customer portal.</li>
              <li>You can use your portal to view updates, add photos, and respond to contractor questions.</li>
            </ul>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/" className={intakePrimaryButtonClass}>
              Return Home
            </a>
            <button
              type="button"
              onClick={() => {
                setSubmissionConfirmation(null);
                setCurrentStep(3);
              }}
              className="rounded border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              View Project Summary
            </button>
            <a href="/start-project" className="rounded border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Start Another Project
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="space-y-6">
        <div data-testid="public-intake-step-rail" className={`${intakePanelClass} relative overflow-hidden`}>
          <div className="absolute inset-x-6 top-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-amber-300 to-blue-500 shadow-[0_0_18px_rgba(251,191,36,0.75)]" />
          <div className="mb-4 flex flex-wrap items-center gap-3 pt-3">
            <div className="inline-flex rounded-full border border-amber-300/40 bg-amber-300/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100">
              Project Intake
            </div>
            {statusText ? (
              <div className="inline-flex rounded-full border border-white/15 bg-slate-950/45 px-3 py-1 text-xs font-semibold text-sky-50">
                Status: {statusText}
              </div>
            ) : null}
            <div className="text-xs font-medium text-sky-50/70">
              {contractorName} can review your request once you finish. {confidenceMessage}
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
            {stepLabels.map((label, index) => (
              <button key={label} type="button" onClick={() => setCurrentStep(index)} className="shrink-0">
                <StepPill active={currentStep === index} complete={currentStep > index} label={label} index={index} />
              </button>
            ))}
          </div>
        </div>

        {renderStep()}

        <div className="flex flex-col gap-3 rounded-3xl border border-white/12 bg-slate-950/45 p-4 shadow-xl shadow-slate-950/25 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 0 || saving || branchSubmitting}
            data-testid={currentStep === 3 ? "public-intake-structured-back" : undefined}
            className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-sky-50 transition hover:border-sky-200/35 hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Back
          </button>

          <div className="flex flex-wrap items-center gap-3">
            {currentStep === 6 ? (
              <button
                type="button"
                onClick={() => {
                  if (discoveryTargets.length > 1) setBranchMode("multi_contractor");
                  else if (discoveryTargets.length === 1) setBranchMode("single_contractor");
                  setCurrentStep(7);
                }}
                disabled={saving || branchSubmitting}
                data-testid="public-intake-discovery-continue"
                className={intakePrimaryButtonClass}
              >
                Continue to Choose Path
              </button>
            ) : currentStep === 7 ? (
              <>
                <button type="button" onClick={handleBranchSubmit} disabled={branchSubmitting || saving} data-testid="public-intake-branch-submit" className={intakePrimaryButtonClass}>{branchSubmitting ? "Saving..." : "Save and Review"}</button>
                <button
                  type="button"
                  onClick={handleSkipContractorBranch}
                  disabled={branchSubmitting || saving}
                  data-testid="public-intake-branch-skip"
                  className={intakeSecondaryButtonClass}
                >
                  Skip for now
                </button>
              </>
            ) : currentStep === 8 ? (
              <button data-testid="public-intake-submit-button" type="button" onClick={handleConfirm} disabled={saving || branchSubmitting || !canFinish} className={intakePrimaryButtonClass}>{saving ? "Submitting..." : "Submit Project Request"}</button>
            ) : currentStep === 3 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving || branchSubmitting}
                data-testid="public-intake-structured-continue"
                className={intakePrimaryButtonClass}
              >
                Continue to Project Details
              </button>
            ) : currentStep === 2 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving || branchSubmitting}
                data-testid="public-intake-project-snapshot-footer-continue"
                className={intakePrimaryButtonClass}
              >
                Continue to Project Summary
              </button>
            ) : currentStep === 4 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving || branchSubmitting}
                data-testid="public-intake-project-details-continue"
                className={intakePrimaryButtonClass}
              >
                Continue to Contact Info
              </button>
            ) : currentStep === 5 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving || branchSubmitting}
                data-testid="public-intake-contact-continue"
                className={intakePrimaryButtonClass}
              >
                Continue to Local Contractors
              </button>
            ) : currentStep === 1 ? (
              <div className="text-xs text-sky-100/70">Use the question card above to continue your clarification.</div>
            ) : currentStep === 0 ? (
              <div className="text-xs text-sky-100/70">Use the button above to begin shaping your plan.</div>
            ) : (
              <button type="button" onClick={handleNext} disabled={saving || branchSubmitting || (currentStep === 0 && !canGenerateStructure)} className={intakePrimaryButtonClass}>Continue</button>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-white/12 bg-slate-950/35 p-5 shadow-xl shadow-slate-950/20 backdrop-blur">
          <div className="text-sm text-sky-100/75">
            Once you submit this project request, your contractor can review it and prepare the agreement.
          </div>
        </div>
      </div>
    </div>
  );
}
