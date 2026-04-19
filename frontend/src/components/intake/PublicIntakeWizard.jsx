import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../../api";

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

const blankForm = {
  customer_name: "",
  customer_email: "",
  customer_phone: "",
  project_class: "residential",
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
  ai_project_title: "",
  ai_project_type: "",
  ai_project_subtype: "",
  ai_description: "",
  ai_project_timeline_days: "",
  ai_project_budget: "",
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
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
        active
          ? "border-indigo-500 bg-indigo-600 text-white"
          : complete
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-slate-200 bg-white text-slate-500"
      }`}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-[11px] font-bold">
        {index + 1}
      </span>
      {label}
    </div>
  );
}

export default function PublicIntakeWizard() {
  const { token = "" } = useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [contractorName, setContractorName] = useState("Your contractor");
  const [statusText, setStatusText] = useState("");
  const [branchMode, setBranchMode] = useState("single_contractor");
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [branchResult, setBranchResult] = useState(null);
  const [clarificationUploading, setClarificationUploading] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [clarificationSnapshotMode, setClarificationSnapshotMode] = useState(false);
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

  const stepLabels = [
    "Project Idea",
    "Refine Your Project",
    "AI Structured Output",
    "Project Details",
    "Contact Info",
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

        setForm({
          customer_name: data?.customer_name || "",
          customer_email: data?.customer_email || "",
          customer_phone: data?.customer_phone || "",
          project_class: data?.project_class || "residential",
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
          accomplishment_text: data?.accomplishment_text || "",
          ai_project_title: data?.ai_project_title || "",
          ai_project_type: data?.ai_project_type || "",
          ai_project_subtype: data?.ai_project_subtype || "",
          ai_description: data?.ai_description || "",
          ai_project_timeline_days: data?.ai_project_timeline_days ?? "",
          ai_project_budget: moneyValue(data?.ai_project_budget),
          measurement_handling: data?.measurement_handling || "",
          ai_milestones: normalizeMilestones(data?.ai_milestones),
          ai_clarification_questions: Array.isArray(data?.ai_clarification_questions)
            ? data.ai_clarification_questions
            : [],
          ai_clarification_answers: data?.ai_clarification_answers || {},
          ai_analysis_payload: data?.ai_analysis_payload || {},
          clarification_photos: Array.isArray(data?.clarification_photos) ? data.clarification_photos : [],
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
          data?.post_submit_flow_selected_at
            ? 6
            : data?.post_submit_flow
              ? 5
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
  }, [token]);

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
    setForm((prev) => ({ ...prev, accomplishment_text: value }));
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
      ai_description: data?.ai_description ?? prev.ai_description,
      ai_project_timeline_days: data?.ai_project_timeline_days ?? prev.ai_project_timeline_days,
      ai_project_budget:
        data?.ai_project_budget !== undefined && data?.ai_project_budget !== null
          ? String(data.ai_project_budget)
          : prev.ai_project_budget,
      measurement_handling: data?.measurement_handling ?? prev.measurement_handling,
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
    branchMessageOverride = null,
    allowBranch = true,
    formOverrides = null,
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
      payload.measurement_handling = form.measurement_handling || "";
      payload.ai_clarification_answers = form.ai_clarification_answers || {};

      if (formOverrides?.ai_clarification_answers) {
        payload.ai_clarification_answers = formOverrides.ai_clarification_answers;
      }

      if (allowBranch && branchFlow) {
        payload.branch_flow = branchFlow;
        payload.branch_message = branchMessageOverride ?? branchMessage;
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
    setClarificationSnapshotMode(false);
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
    setField("accomplishment_text", descriptionRefinement.suggestion);
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
      setClarificationSnapshotMode(true);
      return;
    }

    setClarificationSnapshotMode(false);
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
    if (currentStep === 6) {
      await handleConfirm();
      return;
    }
    if (currentStep < stepLabels.length - 1) {
      setCurrentStep((prev) => prev + 1);
    }
  }

  function handleBack() {
    if (currentStep === 1) {
      if (clarificationSnapshotMode) {
        setClarificationSnapshotMode(false);
        if (clarificationQuestions.length) {
          setCurrentQuestionIndex((prev) => Math.min(prev, clarificationQuestions.length - 1));
        }
        return;
      }
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

    const contractors =
      branchMode === "single_contractor"
        ? [{ name: singleContractor.name, email: singleContractor.email, phone: singleContractor.phone }]
        : branchContacts;

    try {
      setBranchSubmitting(true);
      const data = await saveIntake({
        showToast: false,
        branchFlow: branchMode,
        contractors,
        branchMessageOverride: branchMessage,
      });

      if (data) {
        setBranchResult(data?.post_submit_flow ? data : branchResult);
        toast.success(
          Array.isArray(data?.branch_invites) && data.branch_invites.length
            ? `Created ${data.branch_invites.length} contractor invite${data.branch_invites.length === 1 ? "" : "s"}.`
            : "Saved your next-step choice."
        );
        setCurrentStep(6);
      }
      return data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not save your next-step choice.");
      return null;
    } finally {
      setBranchSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!canFinish) {
      toast.error("Please complete the project and contact details first.");
      return;
    }

    const saved = await saveIntake({ showToast: false });
    if (!saved) return;

    toast.success("Your project intake is ready.");
  }

  const effectiveForm = getEffectiveProjectForm(form);
  const summaryAddress = [
    effectiveForm.project_address_line1,
    effectiveForm.project_address_line2,
    [effectiveForm.project_city, effectiveForm.project_state, effectiveForm.project_postal_code]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .join("\n");
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
    addRow("area", "Area", form.ai_project_subtype);
    addRow("main-goal", "Main Goal", getMainGoalSummary(form.ai_project_title, form.ai_description));
    addRow("timing", "Timing", getFriendlyTimelineLabel(form.ai_project_timeline_days));
    addRow("budget", "Budget", getFriendlyBudgetLabel(form.ai_project_budget));

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
    form.ai_description,
    form.ai_project_budget,
    form.ai_project_subtype,
    form.ai_project_title,
    form.ai_project_timeline_days,
    form.ai_project_type,
  ]);
  const projectSnapshotRows = useMemo(() => {
    const rows = [];
    const seenLabels = new Set();
    const addRow = (label, value) => {
      const normalized = summarizeTextValue(value, 140);
      const rowLabel = summarizeTextValue(label, 60);
      if (!normalized || seenLabels.has(rowLabel)) return;
      seenLabels.add(rowLabel);
      rows.push({ label: rowLabel, value: normalized });
    };

    projectSummaryRows
      .filter((row) => !String(row.key || "").startsWith("clarification-"))
      .slice(0, 6)
      .forEach((row) => addRow(row.label, row.value));

    projectSummaryRows
      .filter((row) => String(row.key || "").startsWith("clarification-"))
      .slice(0, 3)
      .forEach((row) => addRow(row.label, row.value));

    const photoCount = Array.isArray(form.clarification_photos) ? form.clarification_photos.length : 0;
    if (photoCount > 0) {
      addRow("Photos", `${photoCount} photo${photoCount === 1 ? "" : "s"} attached`);
    }

    return rows;
  }, [form.clarification_photos, projectSummaryRows]);
  const confidenceMessage = useMemo(() => {
    if (currentStep >= 6) return "Almost ready to send to contractors.";
    if (currentStep === 5) return "You are choosing the path that feels right.";
    if (currentStep === 4) return "A few details now will help the next step feel easy.";
    if (currentStep === 3) return "You are refining the details that shape the plan.";
    if (currentStep === 2) return "Your project is taking shape.";
    if (currentStep === 1) return "Refine the details so your contractor can review the request more clearly.";
    return "Start with your idea and we will help shape the rest.";
  }, [currentStep]);
  const renderStep = () => {
    if (currentStep === 0) {
      return (
        <div className="rounded-3xl border border-white/70 bg-white/95 p-8 shadow-2xl shadow-black/10 backdrop-blur">
          <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Project Idea</h2>
          <p className="mt-2 text-base text-gray-600">
            Tell us what you&apos;d like to get done. We&apos;ll help organize it into a clear project plan.
          </p>
          <textarea
            data-testid="public-intake-accomplishment-text"
            className="mt-5 w-full rounded-2xl border border-slate-200 px-4 py-4 text-base shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
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
                className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
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
                      ? "Here&apos;s a clearer version based on your description."
                      : "Here&apos;s a cleaner version based on what you wrote."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="public-intake-description-use-version"
                    onClick={acceptDescriptionSuggestion}
                    className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
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
          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              data-testid="public-intake-generate-structure"
              onClick={handleGenerateStructure}
              disabled={saving || !canGenerateStructure}
              className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Generating..." : "Generate My Project Plan"}
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

      if (clarificationSnapshotMode) {
        return (
          <div
            className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10"
            data-testid="public-intake-project-snapshot"
          >
            <div className="max-w-3xl">
              <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                Project Snapshot
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight text-gray-900" data-testid="public-intake-project-snapshot-title">
                Project Snapshot
              </div>
              <p className="mt-2 text-base text-slate-600">
                Here&apos;s the clearer starting point we&apos;ve built from your answers.
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Your contractor will still review and confirm the final scope.
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {projectSnapshotRows.length ? (
                  projectSnapshotRows.map((row) => (
                    <div
                      key={row.label}
                      data-testid={`public-intake-project-snapshot-row-${toTestIdSegment(row.label)}`}
                      className="rounded-xl bg-slate-50 px-4 py-3"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {row.label}
                      </div>
                      <div className="mt-1 text-sm font-medium leading-6 text-slate-900">{row.value}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    We&apos;ve captured the project details you shared so far.
                  </div>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setClarificationSnapshotMode(false);
                    if (questionCount) {
                      setCurrentQuestionIndex(Math.min(Math.max(currentQuestionIndex, 0), questionCount - 1));
                    }
                  }}
                  data-testid="public-intake-project-snapshot-back"
                  className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Back to Clarifications
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setClarificationSnapshotMode(false);
                    setCurrentStep(2);
                  }}
                  data-testid="public-intake-project-snapshot-continue"
                  className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700"
                >
                  Continue to Project Summary
                </button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-5">
            <div className="rounded-3xl border border-white/70 bg-white p-8 shadow-2xl shadow-black/10" data-testid="public-intake-clarification-step">
              <div className="max-w-2xl">
                <h2 className="text-2xl font-semibold tracking-tight text-gray-900">Refine Your Project</h2>
                <p className="mt-2 text-base text-gray-600">
                  A few quick details make your request more accurate and easier for your contractor to review.
                </p>
                <p className="mt-1 text-sm text-slate-500">Your contractor will verify measurements before work begins.</p>
              </div>

              <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 shadow-sm" data-testid="public-intake-clarification-photo-section">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-gray-900">Add Photos (Optional)</div>
                    <div className="text-xs text-slate-500">
                      Photos can help your contractor understand the project faster and spot details that matter.
                    </div>
                    <div className="text-xs text-slate-500">
                      Helpful examples: wide shot, close-up, inspiration photo, or measurements/sketches if available.
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700">
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
                      <div className="text-sm font-semibold text-gray-900">A few quick questions</div>
                      <div className="text-xs text-gray-500">
                        Short answers are fine. These update the structured output automatically.
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
                                    ? "border-indigo-500 bg-indigo-600 text-white"
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
                          className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700"
                        >
                          {isLastQuestion ? "Review Project Snapshot" : "Next"}
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
              className="rounded-3xl border border-white/70 bg-white p-6 shadow-xl shadow-black/10"
              data-testid="public-intake-project-summary"
            >
              <div className="text-lg font-semibold tracking-tight text-gray-900" data-testid="public-intake-project-summary-title">
                Your Project So Far
              </div>
              <p className="mt-2 text-sm text-slate-600">Your contractor will review and confirm details.</p>
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
                  <li>• Your contractor reviews the details you share here.</li>
                  <li>• They may ask follow-up questions before final pricing.</li>
                  <li>• You decide how you want to move forward.</li>
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
                  className="mt-5 w-full rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700"
                >
                  Continue to Project Snapshot
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      );
    }

    if (currentStep === 2) {
      const milestones = Array.isArray(form.ai_milestones) ? form.ai_milestones : [];
      const measurementOptions = [
        { value: "provided", label: "Provided" },
        { value: "site_visit_required", label: "Site visit required" },
        { value: "not_sure", label: "Not sure" },
      ];
      return (
        <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10" data-testid="public-intake-structured-output-step">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              AI Project Plan
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900" data-testid="public-intake-structured-output-title">
              Your Project Plan
            </h2>
            <p className="mt-2 text-base text-slate-600">
              Here&apos;s the structured project outline we created from your description and answers. You can review and adjust anything before continuing.
            </p>
            <p className="mt-1 text-sm text-slate-500">You can edit anything before continuing.</p>
            <p className="mt-1 text-sm text-slate-500">
              Your contractor will still review and confirm the final details.
            </p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm" data-testid="public-intake-structured-section-project-details">
              <div className="text-sm font-semibold text-gray-900">Project Details</div>
              <div className="mt-4 grid grid-cols-1 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-900">Project Title</label>
                  <input
                    data-testid="public-intake-structured-project-title"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                    value={form.ai_project_title}
                    onChange={(e) => setField("ai_project_title", e.target.value)}
                    placeholder="Suggested project title"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900">Project Type</label>
                    <input
                      data-testid="public-intake-structured-project-type"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.ai_project_type}
                      onChange={(e) => setField("ai_project_type", e.target.value)}
                      placeholder="Repair, Remodel, Installation..."
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900">Area / Subtype</label>
                    <input
                      data-testid="public-intake-structured-project-subtype"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.ai_project_subtype}
                      onChange={(e) => setField("ai_project_subtype", e.target.value)}
                      placeholder="Bathroom remodel, roof repair..."
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900">Timeline</label>
                    <input
                      data-testid="public-intake-structured-project-timeline"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.ai_project_timeline_days}
                      onChange={(e) => setField("ai_project_timeline_days", e.target.value)}
                      placeholder="10"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-900">Budget</label>
                    <input
                      data-testid="public-intake-structured-project-budget"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                      value={form.ai_project_budget}
                      onChange={(e) => setField("ai_project_budget", e.target.value)}
                      placeholder="5000"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-900">Measurements handling</label>
                  <div className="flex flex-wrap gap-2">
                    {measurementOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setField("measurement_handling", opt.value)}
                        className={`rounded-full border px-3 py-2 text-sm font-semibold ${
                          form.measurement_handling === opt.value
                            ? "border-indigo-500 bg-indigo-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                        data-testid={`public-intake-structured-measurement-${opt.value}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm" data-testid="public-intake-structured-section-scope">
              <div className="text-sm font-semibold text-gray-900">Refined Description</div>
              <p className="mt-1 text-sm text-slate-600">
                Keep this short and clear. It will help guide the agreement and scope review.
              </p>
              <textarea
                data-testid="public-intake-structured-description"
                className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                rows={10}
                value={form.ai_description}
                onChange={(e) => setField("ai_description", e.target.value)}
                placeholder="Short, agreement-ready scope summary"
              />
              <div className="mt-3 text-xs text-slate-500">
                You can refine this anytime before submitting.
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm lg:col-span-2" data-testid="public-intake-structured-section-milestones">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">Milestones / Project Phases</div>
                  <p className="mt-1 text-sm text-slate-600">These help turn the project into a clear plan of work.</p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      ai_milestones: [...(prev.ai_milestones || []), emptyMilestone((prev.ai_milestones || []).length)],
                    }))
                  }
                >
                  Add milestone
                </button>
              </div>

              <div className="mt-4 space-y-4">
                {milestones.length ? (
                  milestones.map((milestone, index) => (
                    <div
                      key={`milestone-${index}`}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                      data-testid={`public-intake-structured-milestone-${index}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Milestone {index + 1}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Title</label>
                          <input
                            data-testid={`public-intake-structured-milestone-${index}-title`}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            value={milestone.title || ""}
                            onChange={(e) => setMilestone(index, "title", e.target.value)}
                            placeholder={`Milestone ${index + 1}`}
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Description</label>
                          <textarea
                            data-testid={`public-intake-structured-milestone-${index}-description`}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            rows={3}
                            value={milestone.description || ""}
                            onChange={(e) => setMilestone(index, "description", e.target.value)}
                            placeholder="Short milestone description"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-600">
                    No milestones yet. Add a few to help organize the plan.
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      );
    }
    if (currentStep === 3) {
      return (
        <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10" data-testid="public-intake-project-details-step">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Refine the plan
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">Project Details</h2>
            <p className="mt-2 text-base text-slate-600">
              Add the project location and any details that help turn the plan into a clear agreement.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Keep going at the pace that feels right. You can adjust these details later if needed.
            </p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <div className="text-sm font-semibold text-gray-900">Customer Address</div>
              <p className="mt-1 text-sm text-slate-600">Where should the project be tied to in your records?</p>
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
              <p className="mt-1 text-sm text-slate-600">This helps organize the plan and any follow-up steps.</p>
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

    if (currentStep === 4) {
      return (
        <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10" data-testid="public-intake-contact-step">
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

    if (currentStep === 5) {
      return (
        <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10" data-testid="public-intake-branching-section">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Choose your path
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">How would you like to proceed?</h2>
            <p className="mt-2 text-base text-slate-600">
              Choose the option that feels right for this project. You can still adjust it before sending anything forward.
            </p>
          </div>

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
                  <div className="text-sm font-semibold text-gray-900">Invite one contractor</div>
                  <p className="mt-1 text-sm text-slate-600">We&apos;ll prepare the next step for a single contractor review.</p>
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
                  <div className="text-sm font-semibold text-gray-900">Invite multiple contractors</div>
                  <p className="mt-1 text-sm text-slate-600">Add the contractors you want to compare before choosing who to work with.</p>
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
    return (
        <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10" data-testid="public-intake-review-step">
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
              You&apos;re not committing to work yet - this just helps contractors understand your project.
            </p>
          </div>

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
            <div className="text-sm font-semibold text-gray-900">Project Plan</div>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Project</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{form.ai_project_title || "Untitled project"}</div>
                <div className="mt-1 text-sm text-slate-700">{form.ai_project_type || "Project type not set"}</div>
                <div className="mt-2 whitespace-pre-line text-sm text-slate-600">{form.ai_description || form.accomplishment_text}</div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Timeline and budget</div>
                <div className="mt-1 text-sm text-slate-700">Timeline: {form.ai_project_timeline_days || "Not set"} days</div>
                <div className="mt-1 text-sm text-slate-700">Budget: {form.ai_project_budget ? `$${Number(form.ai_project_budget).toLocaleString()}` : "Not set"}</div>
                <div className="mt-1 text-sm text-slate-700">
                  Measurements: {form.measurement_handling || "Not set"}
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
            <div className="text-sm font-semibold text-gray-900">Milestones and Notes</div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Milestones</div>
                <div className="mt-3 space-y-3">
                  {(form.ai_milestones || []).length ? (
                    (form.ai_milestones || []).map((milestone, index) => (
                      <div key={`review-milestone-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                        <div className="text-sm font-semibold text-slate-900">{milestone.title || `Milestone ${index + 1}`}</div>
                        <div className="mt-1 text-sm text-slate-600">{milestone.description || "No description provided."}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-600">No milestones yet.</div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Clarification Summary</div>
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
                {branchResult?.branch_invites?.length
                  ? `${branchResult.branch_invites.length} invite${branchResult.branch_invites.length === 1 ? "" : "s"} prepared`
                  : "No contractor invites saved yet"}
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full">
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-2xl shadow-black/10">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
              Project intake
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight text-gray-900">Project Intake</div>
            <div className="mt-2 text-sm font-medium text-indigo-700">{confidenceMessage}</div>
            <div className="mt-2 text-sm text-slate-600">
              {contractorName} has asked you to complete a project intake so they can prepare your agreement.
            </div>
            {statusText ? (
              <div className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                Status: {statusText}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-white/70 bg-white p-4 shadow-2xl shadow-black/10">
          <div className="flex flex-wrap gap-2">
            {stepLabels.map((label, index) => (
              <button key={label} type="button" onClick={() => setCurrentStep(index)}>
                <StepPill active={currentStep === index} complete={currentStep > index} label={label} index={index} />
              </button>
            ))}
          </div>
        </div>

        {renderStep()}

        <div className="flex flex-col gap-3 rounded-2xl border border-white/70 bg-white p-4 shadow-xl shadow-black/10 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentStep === 0 || saving || branchSubmitting}
            data-testid={currentStep === 2 ? "public-intake-structured-back" : undefined}
            className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Back
          </button>

        <div className="flex flex-wrap items-center gap-3">
            {currentStep === 5 ? (
              <button type="button" onClick={handleBranchSubmit} disabled={branchSubmitting || saving} data-testid="public-intake-branch-submit" className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{branchSubmitting ? "Saving..." : "Save and Review"}</button>
            ) : currentStep === 6 ? (
              <button data-testid="public-intake-submit-button" type="button" onClick={handleConfirm} disabled={saving || branchSubmitting || !canFinish} className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Submitting..." : "Submit Project Plan"}</button>
            ) : currentStep === 2 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving || branchSubmitting}
                data-testid="public-intake-structured-continue"
                className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Continue to Project Details
              </button>
            ) : currentStep === 4 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={saving || branchSubmitting}
                data-testid="public-intake-contact-continue"
                className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                Continue to Choose Path
              </button>
            ) : currentStep === 1 ? (
              <div className="text-xs text-gray-500">Use the question card above to continue your clarification.</div>
            ) : currentStep === 0 ? (
              <div className="text-xs text-gray-500">Use the button above to begin shaping your plan.</div>
            ) : (
              <button type="button" onClick={handleNext} disabled={saving || branchSubmitting || (currentStep === 0 && !canGenerateStructure)} className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">Continue</button>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/70 bg-white p-6 shadow-xl shadow-black/10">
          <div className="text-sm text-slate-600">
            Once you submit this project plan, your contractor can review it and prepare the agreement.
          </div>
        </div>
      </div>
    </div>
  );
}
