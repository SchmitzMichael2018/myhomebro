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

function emptyClarificationAnswers() {
  return {};
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
  const [submittedAtLeastOnce, setSubmittedAtLeastOnce] = useState(false);
  const [branchMode, setBranchMode] = useState("single_contractor");
  const [branchSubmitting, setBranchSubmitting] = useState(false);
  const [branchResult, setBranchResult] = useState(null);
  const [clarificationUploading, setClarificationUploading] = useState(false);
  const [branchContacts, setBranchContacts] = useState([
    { name: "", email: "", phone: "" },
    { name: "", email: "", phone: "" },
  ]);
  const [singleContractor, setSingleContractor] = useState({ name: "", email: "", phone: "" });
  const [branchMessage, setBranchMessage] = useState("");
  const [form, setForm] = useState(blankForm);

  const stepLabels = [
    "Project Idea",
    "AI Clarifications",
    "AI Structured Output",
    "Contact Info",
    "Project Details",
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

  function setField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
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
  } = {}) {
    if (!token) {
      toast.error("Missing intake token.");
      return null;
    }

    try {
      setSaving(true);
      const effectiveForm = getEffectiveProjectForm(form);
      const payload = { token, ...effectiveForm };
      payload.measurement_handling = form.measurement_handling || "";
      payload.ai_clarification_answers = form.ai_clarification_answers || {};

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
      setSubmittedAtLeastOnce(true);
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
    setCurrentStep(1);
    toast.success("Project structure generated.");
  }

  async function handleNext() {
    if (currentStep === 0) {
      await handleGenerateStructure();
      return;
    }
    if (currentStep === 1) {
      const saved = await saveIntake({ showToast: false, allowBranch: false });
      if (!saved) return;
      setCurrentStep(2);
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
  const renderStep = () => {
    if (currentStep === 0) {
      return (
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Project Idea</h2>
          <p className="mt-1 text-sm text-gray-600">
            Describe the project in plain language. We&apos;ll shape it into a structured plan next.
          </p>
          <textarea
            data-testid="public-intake-accomplishment-text"
            className="mt-4 w-full rounded border px-3 py-2 text-sm"
            rows={7}
            value={form.accomplishment_text}
            onChange={(e) => setField("accomplishment_text", e.target.value)}
            placeholder="Example: We have a roof leak over the garage and want the damaged area repaired and flashing inspected."
          />
          <div className="mt-5 flex items-center justify-between gap-3">
            <div className="text-sm text-gray-600">
              Keep it simple. AI will help organize the scope after this step.
            </div>
            <button
              type="button"
              data-testid="public-intake-generate-structure"
              onClick={handleGenerateStructure}
              disabled={saving || !canGenerateStructure}
              className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Generating..." : "Generate project structure"}
            </button>
          </div>
        </div>
      );
    }

    if (currentStep === 1) {
      const questions = Array.isArray(form.ai_clarification_questions) ? form.ai_clarification_questions.slice(0, 6) : [];
      return (
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">AI Clarifications</h2>
          <p className="mt-1 text-sm text-gray-600">
            Answer a few quick questions to make the agreement-ready scope more accurate. You can skip any question.
          </p>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <label className="mb-2 block text-sm font-medium text-gray-900">Measurement handling</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "provided", label: "Provided" },
                { value: "site_visit_required", label: "Site visit required" },
                { value: "not_sure", label: "Not sure" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setField("measurement_handling", opt.value)}
                  className={`rounded-full border px-3 py-2 text-sm font-semibold ${
                    form.measurement_handling === opt.value
                      ? "border-indigo-500 bg-indigo-600 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  data-testid={`public-intake-measurement-${opt.value}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">Clarification questions</div>
                <div className="text-xs text-gray-500">Short answers are fine. These update the structured output automatically.</div>
              </div>
              <button
                type="button"
                className="text-xs font-semibold text-indigo-700 hover:underline"
                onClick={() => setForm((prev) => ({ ...prev, ai_clarification_answers: emptyClarificationAnswers() }))}
              >
                Clear answers
              </button>
            </div>
            <div className="space-y-3">
              {questions.length ? questions.map((question, index) => {
                const key = question?.key || `q-${index}`;
                const answer = form.ai_clarification_answers?.[key] ?? "";
                const isRadio = (question?.inputType || question?.type) === "radio";
                const options = Array.isArray(question?.options) ? question.options : [];
                return (
                  <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid={`public-intake-clarification-${key}`}>
                    <div className="text-sm font-semibold text-gray-900">{question?.label || question?.question || key}</div>
                    {question?.help ? <div className="mt-1 text-xs text-gray-500">{question.help}</div> : null}
                    <div className="mt-3">
                      {isRadio ? (
                        <div className="flex flex-wrap gap-2">
                          {options.map((opt) => (
                            <button
                              key={String(opt)}
                              type="button"
                              onClick={() => setClarificationAnswer(key, opt)}
                              className={`rounded-full border px-3 py-2 text-sm font-semibold ${
                                String(answer) === String(opt)
                                  ? "border-indigo-500 bg-indigo-600 text-white"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {String(opt)}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setClarificationAnswer(key, "")}
                            className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Skip
                          </button>
                        </div>
                      ) : (
                        <textarea
                          rows={3}
                          className="w-full rounded border px-3 py-2 text-sm"
                          value={answer}
                          onChange={(e) => setClarificationAnswer(key, e.target.value)}
                          placeholder="Type a short answer or skip this question"
                        />
                      )}
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                  No clarification questions are needed for this project. You can continue.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">Optional photos</div>
                <div className="text-xs text-gray-500">Add a reference photo or two to help shape scope and agreement details.</div>
              </div>
              <label className="cursor-pointer rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
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
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(form.clarification_photos || []).length ? (
                form.clarification_photos.map((photo) => (
                  <div key={photo.id || photo.image_url} className="overflow-hidden rounded-lg border bg-slate-50">
                    {photo.image_url ? (
                      <img src={photo.image_url} alt={photo.caption || photo.original_name || "Project photo"} className="h-32 w-full object-cover" />
                    ) : null}
                    <div className="px-3 py-2 text-xs text-slate-600">
                      <div className="font-semibold text-slate-900">{photo.caption || photo.original_name || "Photo"}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500">No photos uploaded yet.</div>
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" onClick={() => setCurrentStep(0)} className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">Back</button>
            <button type="button" onClick={handleNext} className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Continue</button>
          </div>
        </div>
      );
    }

    if (currentStep === 2) {
      return (
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">AI Structured Output</h2>
          <p className="mt-1 text-sm text-gray-600">
            Review the draft structure. You can accept it as-is or refine it before moving on.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">Project Title</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.ai_project_title} onChange={(e) => setField("ai_project_title", e.target.value)} placeholder="Suggested project title" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">Project Type</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.ai_project_type} onChange={(e) => setField("ai_project_type", e.target.value)} placeholder="Repair, Remodel, Installation..." />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">Project Subtype</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.ai_project_subtype} onChange={(e) => setField("ai_project_subtype", e.target.value)} placeholder="Bathroom Remodel, Roof Repair..." />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">Timeline</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.ai_project_timeline_days} onChange={(e) => setField("ai_project_timeline_days", e.target.value)} placeholder="10" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-900">Budget</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.ai_project_budget} onChange={(e) => setField("ai_project_budget", e.target.value)} placeholder="5000" />
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-gray-900">Structured Scope</label>
            <textarea className="w-full rounded border px-3 py-2 text-sm" rows={6} value={form.ai_description} onChange={(e) => setField("ai_description", e.target.value)} placeholder="Short, agreement-ready scope summary" />
          </div>
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-gray-900">Milestones</label>
              <button type="button" className="text-xs font-semibold text-indigo-700 hover:underline" onClick={() => setForm((prev) => ({ ...prev, ai_milestones: [...(prev.ai_milestones || []), emptyMilestone((prev.ai_milestones || []).length)], }))}>Add milestone</button>
            </div>
            <div className="mt-3 space-y-3">
              {(form.ai_milestones || []).map((milestone, index) => (
                <div key={`milestone-${index}`} className="rounded-lg border bg-slate-50 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Title</label>
                      <input className="w-full rounded border px-3 py-2 text-sm" value={milestone.title || ""} onChange={(e) => setMilestone(index, "title", e.target.value)} placeholder={`Milestone ${index + 1}`} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Description</label>
                      <textarea className="w-full rounded border px-3 py-2 text-sm" rows={3} value={milestone.description || ""} onChange={(e) => setMilestone(index, "description", e.target.value)} placeholder="Short milestone description" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
    if (currentStep === 3) {
      return (
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Project Details</h2>
          <p className="mt-1 text-sm text-gray-600">Add the project location and job-site details.</p>
          <div className="mt-4 rounded-lg border bg-slate-50 p-4">
            <div className="mb-2 text-sm font-medium text-gray-900">Customer Address</div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Customer Address Line 1</label>
                <input
                  data-testid="public-intake-customer-address-line1"
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_address_line1}
                  onChange={(e) => setField("customer_address_line1", e.target.value)}
                  placeholder="123 Main St"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Customer Address Line 2</label>
                <input
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_address_line2}
                  onChange={(e) => setField("customer_address_line2", e.target.value)}
                  placeholder="Apt, Suite, etc."
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">City</label>
                <input
                  data-testid="public-intake-customer-city"
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_city}
                  onChange={(e) => setField("customer_city", e.target.value)}
                  placeholder="City"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">State</label>
                <input
                  data-testid="public-intake-customer-state"
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_state}
                  onChange={(e) => setField("customer_state", e.target.value)}
                  placeholder="State"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">ZIP / Postal Code</label>
                <input
                  data-testid="public-intake-customer-postal-code"
                  className="w-full rounded border px-3 py-2 text-sm"
                  value={form.customer_postal_code}
                  onChange={(e) => setField("customer_postal_code", e.target.value)}
                  placeholder="ZIP / Postal code"
                />
              </div>
            </div>
          </div>
          <div className="mt-4">
            <div className="mb-2 text-sm font-medium text-gray-900">Project Class</div>
            <div className="flex flex-wrap gap-3">
              {[{ value: "residential", label: "Residential" }, { value: "commercial", label: "Commercial" }].map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input type="radio" name="project_class" checked={form.project_class === opt.value} onChange={() => setField("project_class", opt.value)} />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm text-gray-700">
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
            />
            Project address is the same as my home/customer address
          </label>
          {!form.same_as_customer_address ? (
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Project Address Line 1</label>
                <input data-testid="public-intake-project-address-line1" className="w-full rounded border px-3 py-2 text-sm" value={form.project_address_line1} onChange={(e) => setField("project_address_line1", e.target.value)} placeholder="Project street address" />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Project Address Line 2</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={form.project_address_line2} onChange={(e) => setField("project_address_line2", e.target.value)} placeholder="Apartment, suite, unit, etc." />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">City</label>
                <input data-testid="public-intake-project-city" className="w-full rounded border px-3 py-2 text-sm" value={form.project_city} onChange={(e) => setField("project_city", e.target.value)} placeholder="City" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">State</label>
                <input data-testid="public-intake-project-state" className="w-full rounded border px-3 py-2 text-sm" value={form.project_state} onChange={(e) => setField("project_state", e.target.value)} placeholder="State" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">ZIP / Postal Code</label>
                <input data-testid="public-intake-project-postal-code" className="w-full rounded border px-3 py-2 text-sm" value={form.project_postal_code} onChange={(e) => setField("project_postal_code", e.target.value)} placeholder="ZIP / Postal code" />
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-sm text-gray-700">
              <div className="font-medium text-gray-900">Project address will use your customer/home address</div>
              <div className="mt-2 whitespace-pre-line">{[form.project_address_line1, form.project_address_line2, [form.project_city, form.project_state, form.project_postal_code].filter(Boolean).join(", ")].filter(Boolean).join("\n") || "No address entered yet."}</div>
            </div>
          )}
        </div>
      );
    }

    if (currentStep === 4) {
      return (
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900">Contact Info</h2>
          <p className="mt-1 text-sm text-gray-600">Confirm the customer contact details so the project can move forward.</p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium">Full Name</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.customer_name} onChange={(e) => setField("customer_name", e.target.value)} placeholder="Your full name" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.customer_email} onChange={(e) => setField("customer_email", e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Phone</label>
              <input className="w-full rounded border px-3 py-2 text-sm" value={form.customer_phone} onChange={(e) => setField("customer_phone", e.target.value)} placeholder="(555) 555-5555" />
            </div>
          </div>
          <div className="mt-4 rounded-lg border bg-slate-50 p-3 text-sm text-gray-700">
            <div className="font-medium text-gray-900">Address review</div>
            <div className="mt-2 whitespace-pre-line">{summaryAddress || "No project address entered yet."}</div>
          </div>
        </div>
      );
    }

    if (currentStep === 5) {
      return (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-6 shadow-sm" data-testid="public-intake-branching-section">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">How would you like to proceed?</h2>
              <p className="mt-1 text-sm text-gray-600">Choose whether you want to work with one contractor or get multiple quotes from contractors.</p>
            </div>
            {branchResult?.post_submit_flow ? (
              <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-700">Selected: {branchResult.post_submit_flow === "multi_contractor" ? "Get Multiple Quotes" : "Work with One Contractor"}</div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => setBranchMode("single_contractor")} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${branchMode === "single_contractor" ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`} data-testid="public-intake-branch-single">Work with one contractor</button>
            <button type="button" onClick={() => setBranchMode("multi_contractor")} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${branchMode === "multi_contractor" ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`} data-testid="public-intake-branch-multi">Get multiple quotes</button>
          </div>
          {branchMode === "single_contractor" ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Contractor Name</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={singleContractor.name} onChange={(e) => setSingleContractor((prev) => ({ ...prev, name: e.target.value }))} placeholder="Contractor name" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Contractor Email</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={singleContractor.email} onChange={(e) => setSingleContractor((prev) => ({ ...prev, email: e.target.value }))} placeholder="contractor@example.com" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Contractor Phone</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={singleContractor.phone} onChange={(e) => setSingleContractor((prev) => ({ ...prev, phone: e.target.value }))} placeholder="(555) 555-5555" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Message</label>
                <input className="w-full rounded border px-3 py-2 text-sm" value={branchMessage} onChange={(e) => setBranchMessage(e.target.value)} placeholder="Optional note for the contractor" />
              </div>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {branchContacts.map((contact, index) => (
                <div key={`contractor-${index}`} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900">Contractor {index + 1}</div>
                    {branchContacts.length > 1 ? (
                      <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" onClick={() => setBranchContacts((prev) => prev.filter((_, i) => i !== index))}>Remove</button>
                    ) : null}
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <input className="rounded border px-3 py-2 text-sm" value={contact.name} onChange={(e) => setBranchContacts((prev) => prev.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)))} placeholder="Name" />
                    <input className="rounded border px-3 py-2 text-sm" value={contact.email} onChange={(e) => setBranchContacts((prev) => prev.map((item, i) => (i === index ? { ...item, email: e.target.value } : item)))} placeholder="Email" />
                    <input className="rounded border px-3 py-2 text-sm" value={contact.phone} onChange={(e) => setBranchContacts((prev) => prev.map((item, i) => (i === index ? { ...item, phone: e.target.value } : item)))} placeholder="Phone" />
                  </div>
                </div>
              ))}
              <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setBranchContacts((prev) => [...prev, { name: "", email: "", phone: "" }])}>Add another contractor</button>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-900">Message for invited contractors</label>
                <textarea className="w-full rounded border px-3 py-2 text-sm" rows={3} value={branchMessage} onChange={(e) => setBranchMessage(e.target.value)} placeholder="Optional note shared with each invited contractor" />
              </div>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600">{branchResult?.branch_invites?.length ? `${branchResult.branch_invites.length} invite${branchResult.branch_invites.length === 1 ? "" : "s"} ready for the next step.` : "You can switch paths before sending invites."}</div>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Review + Confirm</h2>
        <p className="mt-1 text-sm text-gray-600">Review the full project summary before sending it forward.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Project</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">{form.ai_project_title || "Untitled project"}</div>
            <div className="mt-1 text-sm text-slate-700">{form.ai_project_type || "Project type not set"}</div>
            <div className="mt-2 whitespace-pre-line text-sm text-slate-600">{form.ai_description || form.accomplishment_text}</div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeline / Budget</div>
            <div className="mt-2 text-sm text-slate-700">Timeline: {form.ai_project_timeline_days || "Not set"} days</div>
            <div className="mt-1 text-sm text-slate-700">Budget: {form.ai_project_budget ? `$${Number(form.ai_project_budget).toLocaleString()}` : "Not set"}</div>
            <div className="mt-2 text-sm text-slate-700">
              Measurements: {form.measurement_handling || "Not set"}
            </div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-4 md:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Milestones</div>
            <div className="mt-2 space-y-2">
              {(form.ai_milestones || []).map((milestone, index) => (
                <div key={`review-milestone-${index}`} className="rounded border bg-white px-3 py-2 text-sm">
                  <div className="font-semibold text-slate-900">{milestone.title || `Milestone ${index + 1}`}</div>
                  <div className="mt-1 text-slate-600">{milestone.description || "No description provided."}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-4 md:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Clarification Summary</div>
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              {Object.entries(form.ai_clarification_answers || {}).length ? (
                Object.entries(form.ai_clarification_answers || {}).map(([key, value]) => (
                  <div key={key}>
                    <span className="font-semibold text-slate-900">{key.replace(/_/g, " ")}:</span> {String(value)}
                  </div>
                ))
              ) : (
                <div>No clarification answers provided.</div>
              )}
            </div>
            {Array.isArray(form.clarification_photos) && form.clarification_photos.length ? (
              <div className="mt-3 text-sm text-slate-600">{form.clarification_photos.length} photo{form.clarification_photos.length === 1 ? "" : "s"} attached.</div>
            ) : null}
          </div>
          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</div>
            <div className="mt-2 text-sm text-slate-700">{form.customer_name || "No name yet"}</div>
            <div className="mt-1 text-sm text-slate-700">{form.customer_email || "No email yet"}</div>
            <div className="mt-1 text-sm text-slate-700">{form.customer_phone || "No phone yet"}</div>
          </div>
          <div className="rounded-lg border bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Step</div>
            <div className="mt-2 text-sm text-slate-700">{branchMode === "multi_contractor" ? "Get multiple quotes" : "Work with one contractor"}</div>
            <div className="mt-1 text-sm text-slate-700">{branchResult?.branch_invites?.length ? `${branchResult.branch_invites.length} invite${branchResult.branch_invites.length === 1 ? "" : "s"} prepared` : "No contractor invites saved yet"}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="text-2xl font-bold text-gray-900">Project Intake</div>
          <div className="mt-2 text-sm text-gray-600">{contractorName} has asked you to complete a project intake so they can prepare your agreement.</div>
          {statusText ? <div className="mt-3 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Status: {statusText}</div> : null}
        </div>

        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {stepLabels.map((label, index) => (
              <button key={label} type="button" onClick={() => setCurrentStep(index)}>
                <StepPill active={currentStep === index} complete={currentStep > index} label={label} index={index} />
              </button>
            ))}
          </div>
        </div>

        {renderStep()}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={handleBack} disabled={currentStep === 0 || saving || branchSubmitting} className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">Back</button>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs text-gray-500">{submittedAtLeastOnce ? "Progress saved." : "Nothing has been submitted yet."}</div>
            {currentStep === 5 ? (
              <button type="button" onClick={handleBranchSubmit} disabled={branchSubmitting || saving} data-testid="public-intake-branch-submit" className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{branchSubmitting ? "Saving..." : "Save next step"}</button>
            ) : currentStep === 6 ? (
              <button data-testid="public-intake-submit-button" type="button" onClick={handleConfirm} disabled={saving || branchSubmitting || !canFinish} className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{saving ? "Submitting..." : "Submit Intake"}</button>
            ) : (
              <button type="button" onClick={handleNext} disabled={saving || branchSubmitting || (currentStep === 0 && !canGenerateStructure)} className="rounded bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">{currentStep === 0 ? (saving ? "Generating..." : "Generate project structure") : "Continue"}</button>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="text-sm text-gray-600">Once you submit this intake, your contractor can review it and prepare the agreement.</div>
        </div>
      </div>
    </div>
  );
}
