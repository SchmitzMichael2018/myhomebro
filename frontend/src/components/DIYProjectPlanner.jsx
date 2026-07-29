import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Hammer, Image, ListChecks, Plus, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";

export const participation = [
  ["DO_IT_MYSELF", "Doing Myself"],
  ["NEED_GUIDANCE", "Need Expert Guidance"],
  ["NEED_HELP", "Need Hands-On Help"],
  ["NEED_PROFESSIONAL", "Need a Professional"],
  ["UNDECIDED", "Undecided"],
];
const projectStatuses = [
  ["planning", "Planning"], ["ready", "Ready to Start"], ["in_progress", "In Progress"],
  ["paused", "Paused"], ["completed", "Completed"],
];
const taskStatuses = [
  ["not_started", "Not Started"], ["in_progress", "In Progress"], ["blocked", "Blocked"],
  ["completed", "Completed"], ["skipped", "Skipped"],
];
export const safetyCopy = "Project Assistant provides planning guidance, not a code, permit, engineering, or safety determination. Rules vary by jurisdiction; verify locally and seek qualified professional advice where appropriate.";

function Field({ label, children }) {
  return <label className="block text-sm font-semibold text-slate-200"><span className="mb-1 block">{label}</span>{children}</label>;
}
const inputClass = "min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300";

export default function DIYProjectPlanner({ token, propertyProfiles = [] }) {
  const base = `/projects/customer-portal/${encodeURIComponent(token)}/diy-projects`;
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState("overview");
  const [proposal, setProposal] = useState(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState([]);
  const [newProject, setNewProject] = useState({ title: "", desired_outcome: "", category: "", area: "", property_id: "", existing_conditions: "", work_completed: "", target_budget_min: "", target_budget_max: "", target_completion_date: "", confidence_notes: "", additional_context: "" });
  const [phaseDraft, setPhaseDraft] = useState({ title: "", description: "" });
  const [taskDrafts, setTaskDrafts] = useState({});
  const [measurement, setMeasurement] = useState({ label: "", value: "", unit: "in", notes: "" });
  const [helpMode, setHelpMode] = useState("diy_assist");

  const loadList = useCallback(async () => {
    const { data } = await api.get(`${base}/`);
    setProjects(data.projects || []);
  }, [base]);
  const loadProject = useCallback(async (id) => {
    const { data } = await api.get(`${base}/${id}/`);
    setSelected(data);
    return data;
  }, [base]);
  useEffect(() => { loadList().catch(() => toast.error("Could not load DIY projects.")); }, [loadList]);

  const createProject = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = Object.fromEntries(Object.entries(newProject).filter(([, value]) => value !== ""));
      if (payload.property_id) payload.property_id = Number(payload.property_id);
      const { data } = await api.post(`${base}/`, payload);
      setSelected(data); setCreating(false); setSection("overview");
      await loadList();
      toast.success("DIY project created. No contractor was assigned.");
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Could not create this DIY project.");
    } finally { setBusy(false); }
  };
  const updateProject = async (patch) => {
    const { data } = await api.patch(`${base}/${selected.id}/`, patch);
    setSelected(data); await loadList();
  };
  const addPhase = async (event) => {
    event.preventDefault();
    await api.post(`${base}/${selected.id}/phases/`, { ...phaseDraft, sort_order: selected.phases.length });
    setPhaseDraft({ title: "", description: "" }); await loadProject(selected.id);
  };
  const addTask = async (phaseId) => {
    const draft = taskDrafts[phaseId] || {};
    if (!draft.title) return;
    await api.post(`${base}/${selected.id}/phases/${phaseId}/tasks/`, {
      title: draft.title, description: draft.description || "", participation_type: draft.participation_type || "UNDECIDED",
      sort_order: selected.phases.find((p) => p.id === phaseId)?.tasks?.length || 0,
    });
    setTaskDrafts((prev) => ({ ...prev, [phaseId]: {} })); await loadProject(selected.id);
  };
  const updateTask = async (taskId, patch) => {
    await api.patch(`${base}/${selected.id}/tasks/${taskId}/`, patch); await loadProject(selected.id);
  };
  const addMeasurement = async (event) => {
    event.preventDefault();
    await api.post(`${base}/${selected.id}/measurements/`, measurement);
    setMeasurement({ label: "", value: "", unit: "in", notes: "" }); await loadProject(selected.id);
  };
  const uploadAsset = async (event, assetType = "project_photo") => {
    const file = event.target.files?.[0]; if (!file) return;
    const body = new FormData(); body.append("file", file); body.append("asset_type", assetType);
    await api.post(`${base}/${selected.id}/assets/`, body);
    event.target.value = ""; await loadProject(selected.id);
  };
  const generateProposal = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`${base}/${selected.id}/assistant/proposals/`);
      setProposal(data); setSelectedSuggestions([]);
    } catch (error) { toast.error(error?.response?.data?.detail || "Project Assistant could not prepare a plan."); }
    finally { setBusy(false); }
  };
  const allSuggestionKeys = useMemo(() => proposal?.phases?.flatMap((p) => p.tasks.map((t) => t.client_id)) || [], [proposal]);
  const applyProposal = async () => {
    if (!selectedSuggestions.length) return;
    const { data } = await api.post(`${base}/${selected.id}/assistant/proposals/${proposal.proposal_id}/apply/`, { selected_keys: selectedSuggestions });
    setSelected(data.project); setProposal(null); setSelectedSuggestions([]); toast.success("Selected suggestions added to your plan.");
  };
  const createHelpDraft = async () => {
    const { data } = await api.post(`${base}/${selected.id}/get-help/`, {
      selection_type: "remaining", project_mode: helpMode,
      idempotency_key: `remaining-${selected.id}-${helpMode}`,
    });
    await loadProject(selected.id);
    toast.success(data.detail || "Private request draft created.");
  };

  if (!selected) {
    return <div data-testid="diy-project-planner" className="space-y-5">
      <section className="rounded-3xl border border-amber-300/30 bg-gradient-to-br from-slate-950 to-sky-950 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><div className="text-xs font-bold uppercase tracking-[.2em] text-amber-200">DIY Project Planner</div>
            <h2 className="mt-2 text-2xl font-black text-white">Plan it yourself, then decide where help fits.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Create a private homeowner-owned plan before choosing a contractor. AI guidance stays separate until you apply it.</p></div>
          <button data-testid="diy-project-new" type="button" onClick={() => setCreating(true)} className="min-h-11 rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950">Plan a DIY Project</button>
        </div>
        <p className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300">{safetyCopy}</p>
      </section>
      {creating ? <form data-testid="diy-project-create-form" onSubmit={createProject} className="grid gap-4 rounded-3xl border border-slate-700 bg-slate-900 p-5 md:grid-cols-2">
        <Field label="Project title"><input data-testid="diy-project-title" required className={inputClass} value={newProject.title} onChange={(e) => setNewProject({ ...newProject, title: e.target.value })} /></Field>
        <Field label="Project category/type"><input className={inputClass} value={newProject.category} onChange={(e) => setNewProject({ ...newProject, category: e.target.value })} /></Field>
        <Field label="Desired outcome"><textarea data-testid="diy-project-goal" required className={inputClass} value={newProject.desired_outcome} onChange={(e) => setNewProject({ ...newProject, desired_outcome: e.target.value })} /></Field>
        <Field label="Area of the home"><input className={inputClass} value={newProject.area} onChange={(e) => setNewProject({ ...newProject, area: e.target.value })} /></Field>
        <Field label="Property"><select className={inputClass} value={newProject.property_id} onChange={(e) => setNewProject({ ...newProject, property_id: e.target.value })}><option value="">No property selected</option>{propertyProfiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.address}</option>)}</select></Field>
        <Field label="Existing conditions"><textarea className={inputClass} value={newProject.existing_conditions} onChange={(e) => setNewProject({ ...newProject, existing_conditions: e.target.value })} /></Field>
        <Field label="Work already completed"><textarea className={inputClass} value={newProject.work_completed} onChange={(e) => setNewProject({ ...newProject, work_completed: e.target.value })} /></Field>
        <Field label="Experience or confidence notes"><textarea className={inputClass} value={newProject.confidence_notes} onChange={(e) => setNewProject({ ...newProject, confidence_notes: e.target.value })} /></Field>
        <Field label="Target budget minimum"><input type="number" min="0" className={inputClass} value={newProject.target_budget_min} onChange={(e) => setNewProject({ ...newProject, target_budget_min: e.target.value })} /></Field>
        <Field label="Target budget maximum"><input type="number" min="0" className={inputClass} value={newProject.target_budget_max} onChange={(e) => setNewProject({ ...newProject, target_budget_max: e.target.value })} /></Field>
        <Field label="Target completion"><input type="date" className={inputClass} value={newProject.target_completion_date} onChange={(e) => setNewProject({ ...newProject, target_completion_date: e.target.value })} /></Field>
        <Field label="Additional context"><textarea className={inputClass} value={newProject.additional_context} onChange={(e) => setNewProject({ ...newProject, additional_context: e.target.value })} /></Field>
        <div className="flex gap-2 md:col-span-2"><button disabled={busy} data-testid="diy-project-create" className="rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950">{busy ? "Creating..." : "Create Private Project"}</button><button type="button" onClick={() => setCreating(false)} className="rounded-xl border border-slate-600 px-4 py-2 text-white">Cancel</button></div>
      </form> : null}
      <div className="grid gap-3 md:grid-cols-2">{projects.filter((p) => p.status !== "archived").map((p) => <button data-testid={`diy-project-card-${p.id}`} key={p.id} onClick={() => loadProject(p.id)} className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-left text-white"><div className="font-bold">{p.title}</div><div className="mt-1 text-sm text-slate-400">{p.status_label} · {p.progress_percent}% complete</div></button>)}</div>
    </div>;
  }

  return <div data-testid="diy-project-workspace" className="space-y-4">
    <button onClick={() => { setSelected(null); setProposal(null); }} className="inline-flex items-center gap-2 text-sm font-bold text-amber-200"><ArrowLeft size={16} />All DIY projects</button>
    <section className="rounded-3xl border border-slate-700 bg-slate-950 p-5 text-white">
      <div className="flex flex-wrap justify-between gap-4"><div><div className="text-xs uppercase tracking-[.2em] text-amber-200">Homeowner-owned DIY plan</div><h2 className="mt-1 text-2xl font-black">{selected.title}</h2><p className="mt-2 text-slate-300">{selected.desired_outcome}</p></div><div className="min-w-44"><div className="text-3xl font-black">{selected.progress_percent}%</div><div className="text-xs text-slate-400">{selected.completed_task_count} of {selected.task_count} tasks complete</div></div></div>
      <div className="mt-4 flex flex-wrap gap-2">{["overview", "design", "plan", "progress", "get-help", "files"].map((key) => <button data-testid={`diy-section-${key}`} key={key} onClick={() => setSection(key)} className={`rounded-xl px-3 py-2 text-sm font-bold ${section === key ? "bg-amber-300 text-slate-950" : "bg-slate-800 text-white"}`}>{key === "get-help" ? "Get Help" : key === "design" ? "Design & Inspiration" : key[0].toUpperCase() + key.slice(1)}</button>)}</div>
    </section>
    {section === "overview" ? <section className="grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white"><h3 className="font-bold">Project overview</h3><p className="mt-3 text-sm text-slate-300">Current phase: {selected.phases.find((p) => p.tasks.some((t) => t.status !== "completed"))?.title || "Add your first phase"}</p><select value={selected.status} onChange={(e) => updateProject({ status: e.target.value })} className={`${inputClass} mt-4`}>{projectStatuses.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div><div className="rounded-2xl border border-indigo-300/30 bg-indigo-950/50 p-5 text-white"><div className="flex items-center gap-2 font-bold"><Sparkles size={18} />Project Assistant</div><p className="mt-2 text-sm text-slate-300">Prepare a suggested plan from your goal and existing conditions. Nothing is saved until you select and apply it.</p><button data-testid="diy-ai-generate" disabled={busy} onClick={generateProposal} className="mt-4 rounded-xl bg-indigo-300 px-4 py-2 font-bold text-indigo-950">{busy ? "Preparing..." : "Prepare Suggested Plan"}</button></div></section> : null}
    {proposal ? <section data-testid="diy-ai-proposal" className="rounded-3xl border border-indigo-300/40 bg-slate-900 p-5 text-white"><h3 className="text-xl font-black">Suggested plan</h3><p className="mt-2 text-sm text-slate-300">{proposal.summary}</p><p className="mt-3 rounded-xl bg-slate-950 p-3 text-xs text-amber-100">{proposal.limitations}</p>{proposal.phases.map((p) => <div key={p.client_id} className="mt-4"><div className="font-bold">{p.title}</div>{p.tasks.map((t) => <label key={t.client_id} className="mt-2 flex gap-3 rounded-xl border border-slate-700 p-3"><input type="checkbox" checked={selectedSuggestions.includes(t.client_id)} onChange={(e) => setSelectedSuggestions((prev) => e.target.checked ? [...prev, t.client_id] : prev.filter((v) => v !== t.client_id))} /><span><strong>{t.title}</strong><span className="block text-xs text-slate-400">{t.reason}</span></span></label>)}</div>)}<div className="mt-5 flex flex-wrap gap-2"><button onClick={() => setSelectedSuggestions(allSuggestionKeys)} className="rounded-xl border border-slate-500 px-3 py-2">Select all</button><button data-testid="diy-ai-apply" disabled={!selectedSuggestions.length} onClick={applyProposal} className="rounded-xl bg-indigo-300 px-3 py-2 font-bold text-indigo-950">Add selected suggestions</button><button data-testid="diy-ai-reject" onClick={() => { setProposal(null); setSelectedSuggestions([]); }} className="rounded-xl border border-rose-400/50 px-3 py-2">Reject suggestions</button></div></section> : null}
    {section === "design" ? <section className="grid gap-4 lg:grid-cols-2"><form onSubmit={addMeasurement} className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white"><h3 className="font-bold">Measurements</h3><p className="my-2 text-xs text-slate-400">New entries are labeled Homeowner Provided. Professional verification requires a separate explicit professional action.</p><div className="grid gap-2 sm:grid-cols-3"><input required placeholder="Item name" className={inputClass} value={measurement.label} onChange={(e) => setMeasurement({ ...measurement, label: e.target.value })} /><input required type="number" step="0.0001" placeholder="Value" className={inputClass} value={measurement.value} onChange={(e) => setMeasurement({ ...measurement, value: e.target.value })} /><input required placeholder="Unit" className={inputClass} value={measurement.unit} onChange={(e) => setMeasurement({ ...measurement, unit: e.target.value })} /></div><button className="mt-3 rounded-xl bg-amber-300 px-3 py-2 font-bold text-slate-950">Add measurement</button>{selected.measurements.map((m) => <div key={m.id} className="mt-3 rounded-xl bg-slate-950 p-3 text-sm">{m.label}: {m.value} {m.unit}<span className="ml-2 text-xs text-amber-200">{m.verification_label}</span></div>)}</form><div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white"><h3 className="font-bold">Design notes & inspiration</h3><textarea className={`${inputClass} mt-3 min-h-28`} value={selected.design_notes || ""} onChange={(e) => setSelected({ ...selected, design_notes: e.target.value })} /><button onClick={() => updateProject({ design_notes: selected.design_notes })} className="mt-3 rounded-xl bg-amber-300 px-3 py-2 font-bold text-slate-950">Save notes</button><label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-slate-500 p-4 text-center text-sm"><Image className="mx-auto mb-2" />Upload inspiration image<input className="sr-only" type="file" accept="image/*" onChange={(e) => uploadAsset(e, "inspiration")} /></label></div></section> : null}
    {section === "plan" || section === "progress" ? <section className="space-y-4">{section === "plan" ? <form onSubmit={addPhase} className="flex flex-col gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:flex-row"><input data-testid="diy-phase-title" required placeholder="New phase title" className={inputClass} value={phaseDraft.title} onChange={(e) => setPhaseDraft({ ...phaseDraft, title: e.target.value })} /><input placeholder="Description" className={inputClass} value={phaseDraft.description} onChange={(e) => setPhaseDraft({ ...phaseDraft, description: e.target.value })} /><button data-testid="diy-phase-add" className="rounded-xl bg-amber-300 px-4 font-bold text-slate-950"><Plus /></button></form> : null}{selected.phases.map((p) => <article key={p.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white"><h3 className="font-black">{p.title}</h3>{p.tasks.map((t) => <div key={t.id} data-testid={`diy-task-${t.id}`} className="mt-3 rounded-xl bg-slate-950 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{t.title}</strong><div className="text-xs text-slate-400">{t.participation_label} · {t.source === "ai" ? "AI-suggested, applied by homeowner" : "Homeowner-created"}</div></div><select data-testid={`diy-task-status-${t.id}`} className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm" value={t.status} onChange={(e) => updateTask(t.id, { status: e.target.value, progress_note: `Status changed to ${e.target.value}` })}>{taskStatuses.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>{t.professional_review_recommended ? <p className="mt-2 text-xs text-amber-200">Consider professional review. Verify requirements locally.</p> : null}</div>)}{section === "plan" ? <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input placeholder="Task title" className={inputClass} value={taskDrafts[p.id]?.title || ""} onChange={(e) => setTaskDrafts({ ...taskDrafts, [p.id]: { ...taskDrafts[p.id], title: e.target.value } })} /><select className={inputClass} value={taskDrafts[p.id]?.participation_type || "UNDECIDED"} onChange={(e) => setTaskDrafts({ ...taskDrafts, [p.id]: { ...taskDrafts[p.id], participation_type: e.target.value } })}>{participation.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><button onClick={() => addTask(p.id)} className="rounded-xl bg-amber-300 px-3 font-bold text-slate-950">Add</button></div> : null}</article>)}</section> : null}
    {section === "get-help" ? <section className="rounded-3xl border border-sky-300/30 bg-slate-900 p-5 text-white"><Hammer /><h3 className="mt-2 text-xl font-black">Prepare a professional-help request</h3><p className="mt-2 text-sm text-slate-300">This creates a private, editable request draft from remaining tasks. It will not route contractors automatically.</p><select data-testid="diy-help-mode" className={`${inputClass} mt-4`} value={helpMode} onChange={(e) => setHelpMode(e.target.value)}><option value="diy_assist">DIY Assistance</option><option value="consultation">Consultation / Guidance</option><option value="inspection_only">Inspection Only</option><option value="full_service">Full Service</option><option value="not_sure">Not Sure Yet</option></select><button data-testid="diy-help-create-draft" onClick={createHelpDraft} className="mt-4 rounded-xl bg-sky-300 px-4 py-2 font-bold text-sky-950">Create Reviewable Request Draft</button>{selected.request_links?.length ? <p className="mt-3 text-sm text-emerald-200">Linked request draft #{selected.request_links[0].customer_request_id} is ready in Requests.</p> : null}</section> : null}
    {section === "files" ? <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white"><h3 className="font-bold">Project photos and files</h3><label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-slate-500 p-5 text-center"><Image className="mx-auto mb-2" />Upload project photo or file<input className="sr-only" type="file" onChange={uploadAsset} /></label><div className="mt-4 grid gap-2 sm:grid-cols-2">{selected.assets.map((a) => <div key={a.id} className="rounded-xl bg-slate-950 p-3 text-sm">{a.caption || a.asset_type_label}</div>)}</div></section> : null}
  </div>;
}
