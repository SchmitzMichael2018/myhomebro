import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Hammer, Image, Plus, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api';
import { useGuidedVideo } from '../guided-video/GuidedVideoProvider';

export const participation = [
  ['DO_IT_MYSELF', 'Doing Myself'],
  ['NEED_GUIDANCE', 'Need Expert Guidance'],
  ['NEED_HELP', 'Need Hands-On Help'],
  ['NEED_PROFESSIONAL', 'Need a Professional'],
  ['UNDECIDED', 'Undecided'],
];
const projectStatuses = [
  ['planning', 'Planning'],
  ['ready', 'Ready to Start'],
  ['in_progress', 'In Progress'],
  ['paused', 'Paused'],
  ['completed', 'Completed'],
];
const taskStatuses = [
  ['not_started', 'Not Started'],
  ['in_progress', 'In Progress'],
  ['blocked', 'Blocked'],
  ['completed', 'Completed'],
  ['skipped', 'Skipped'],
];
export const safetyCopy =
  'Project Assistant provides planning guidance, not a code, permit, engineering, or safety determination. Rules vary by jurisdiction; verify locally and seek qualified professional advice where appropriate.';

function Field({ label, children }) {
  return (
    <label className="block text-sm font-semibold text-slate-200">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
export function projectNextAction(project) {
  if (!project.task_count) return 'Add your first phase and task';
  if (!project.completed_task_count) return 'Start the next planned task';
  if (project.progress_percent >= 100) return 'Review and complete the project';
  return 'Continue the next incomplete task';
}
const inputClass =
  'min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300';

export default function DIYProjectPlanner({
  token,
  propertyProfiles = [],
  onOpenRequest,
}) {
  const base = `/projects/customer-portal/${encodeURIComponent(token)}/diy-projects`;
  const { openVideo } = useGuidedVideo();
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [section, setSection] = useState('overview');
  const [proposal, setProposal] = useState(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState([]);
  const [newProject, setNewProject] = useState({
    title: '',
    desired_outcome: '',
    category: '',
    area: '',
    property_id: '',
    existing_conditions: '',
    work_completed: '',
    target_budget_min: '',
    target_budget_max: '',
    target_completion_date: '',
    confidence_notes: '',
    additional_context: '',
  });
  const [phaseDraft, setPhaseDraft] = useState({ title: '', description: '' });
  const [taskDrafts, setTaskDrafts] = useState({});
  const [measurement, setMeasurement] = useState({
    label: '',
    value: '',
    unit: 'in',
    notes: '',
  });
  const [helpMode, setHelpMode] = useState('diy_assist');
  const [helpSelection, setHelpSelection] = useState('remaining');
  const [helpTaskIds, setHelpTaskIds] = useState([]);
  const [helpPhaseId, setHelpPhaseId] = useState('');
  const [helpAssetIds, setHelpAssetIds] = useState([]);
  const [helpMeasurementIds, setHelpMeasurementIds] = useState([]);
  const [helpDraft, setHelpDraft] = useState({ title: '', scope: '' });
  const [progressNote, setProgressNote] = useState('');
  const [editingPhaseId, setEditingPhaseId] = useState(null);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingMeasurementId, setEditingMeasurementId] = useState(null);
  const [editingProject, setEditingProject] = useState(false);
  const [editDraft, setEditDraft] = useState({});

  const loadList = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await api.get(`${base}/`);
      setProjects(data.projects || []);
    } catch (error) {
      setLoadError(
        error?.response?.data?.detail || 'Could not load DIY projects.'
      );
      throw error;
    } finally {
      setLoading(false);
    }
  }, [base]);
  const loadProject = useCallback(
    async (id) => {
      const { data } = await api.get(`${base}/${id}/`);
      setSelected(data);
      return data;
    },
    [base]
  );
  useEffect(() => {
    loadList().catch(() => {});
  }, [loadList]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'create') setCreating(true);
    const requestedSection = params.get('section');
    if (
      ['overview', 'design', 'plan', 'progress', 'get-help', 'files'].includes(
        requestedSection
      )
    )
      setSection(requestedSection);
  }, []);

  const createProject = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(newProject).filter(([, value]) => value !== '')
      );
      if (payload.property_id)
        payload.property_id = Number(payload.property_id);
      const { data } = await api.post(`${base}/`, payload);
      setSelected(data);
      setCreating(false);
      setSection('overview');
      await loadList();
      toast.success('DIY project created. No contractor was assigned.');
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || 'Could not create this DIY project.'
      );
    } finally {
      setBusy(false);
    }
  };
  const updateProject = async (patch) => {
    const { data } = await api.patch(`${base}/${selected.id}/`, patch);
    setSelected(data);
    await loadList();
  };
  const addPhase = async (event) => {
    event.preventDefault();
    await api.post(`${base}/${selected.id}/phases/`, {
      ...phaseDraft,
      sort_order: selected.phases.length,
    });
    setPhaseDraft({ title: '', description: '' });
    await loadProject(selected.id);
  };
  const addTask = async (phaseId) => {
    const draft = taskDrafts[phaseId] || {};
    if (!draft.title) return;
    await api.post(`${base}/${selected.id}/phases/${phaseId}/tasks/`, {
      title: draft.title,
      description: draft.description || '',
      participation_type: draft.participation_type || 'UNDECIDED',
      sort_order:
        selected.phases.find((p) => p.id === phaseId)?.tasks?.length || 0,
    });
    setTaskDrafts((prev) => ({ ...prev, [phaseId]: {} }));
    await loadProject(selected.id);
  };
  const updateTask = async (taskId, patch) => {
    await api.patch(`${base}/${selected.id}/tasks/${taskId}/`, patch);
    await loadProject(selected.id);
  };
  const deletePhase = async (phase) => {
    if (
      !window.confirm(
        `Delete "${phase.title}" and its ${phase.tasks.length} task(s)?`
      )
    )
      return;
    await api.delete(`${base}/${selected.id}/phases/${phase.id}/`);
    await loadProject(selected.id);
    toast.success('Phase deleted.');
  };
  const deleteTask = async (task) => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    await api.delete(`${base}/${selected.id}/tasks/${task.id}/`);
    await loadProject(selected.id);
    toast.success('Task deleted.');
  };
  const movePhase = async (index, direction) => {
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= selected.phases.length) return;
    const current = selected.phases[index];
    const other = selected.phases[otherIndex];
    await Promise.all([
      api.patch(`${base}/${selected.id}/phases/${current.id}/`, {
        sort_order: other.sort_order,
      }),
      api.patch(`${base}/${selected.id}/phases/${other.id}/`, {
        sort_order: current.sort_order,
      }),
    ]);
    await loadProject(selected.id);
  };
  const moveTask = async (phase, index, direction) => {
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= phase.tasks.length) return;
    const current = phase.tasks[index];
    const other = phase.tasks[otherIndex];
    await Promise.all([
      api.patch(`${base}/${selected.id}/tasks/${current.id}/`, {
        sort_order: other.sort_order,
      }),
      api.patch(`${base}/${selected.id}/tasks/${other.id}/`, {
        sort_order: current.sort_order,
      }),
    ]);
    await loadProject(selected.id);
  };
  const addMeasurement = async (event) => {
    event.preventDefault();
    await api.post(`${base}/${selected.id}/measurements/`, measurement);
    setMeasurement({ label: '', value: '', unit: 'in', notes: '' });
    await loadProject(selected.id);
  };
  const saveMeasurement = async (measurementId) => {
    await api.patch(
      `${base}/${selected.id}/measurements/${measurementId}/`,
      editDraft
    );
    setEditingMeasurementId(null);
    setEditDraft({});
    await loadProject(selected.id);
    toast.success('Measurement updated.');
  };
  const deleteMeasurement = async (row) => {
    if (!window.confirm(`Delete measurement "${row.label}"?`)) return;
    await api.delete(`${base}/${selected.id}/measurements/${row.id}/`);
    await loadProject(selected.id);
  };
  const uploadAsset = async (
    event,
    assetType = 'project_photo',
    taskId = null
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    body.append('asset_type', assetType);
    if (taskId) body.append('task_id', taskId);
    await api.post(`${base}/${selected.id}/assets/`, body);
    event.target.value = '';
    await loadProject(selected.id);
    toast.success('File uploaded.');
  };
  const deleteAsset = async (asset) => {
    if (!window.confirm('Delete this project file?')) return;
    await api.delete(`${base}/${selected.id}/assets/${asset.id}/`);
    await loadProject(selected.id);
    toast.success('File deleted.');
  };
  const generateProposal = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(
        `${base}/${selected.id}/assistant/proposals/`
      );
      setProposal(data);
      setSelectedSuggestions([]);
    } catch (error) {
      toast.error(
        error?.response?.data?.detail ||
          'Project Assistant could not prepare a plan.'
      );
    } finally {
      setBusy(false);
    }
  };
  const allSuggestionKeys = useMemo(
    () =>
      proposal?.phases?.flatMap((p) => p.tasks.map((t) => t.client_id)) || [],
    [proposal]
  );
  const applyProposal = async () => {
    if (!selectedSuggestions.length) return;
    setBusy(true);
    try {
      const { data } = await api.post(
        `${base}/${selected.id}/assistant/proposals/${proposal.proposal_id}/apply/`,
        { selected_keys: selectedSuggestions }
      );
      setSelected(data.project);
      setProposal(null);
      setSelectedSuggestions([]);
      toast.success('Selected suggestions added to your plan.');
    } catch (error) {
      toast.error(
        error?.response?.data?.detail || 'Could not apply these suggestions.'
      );
    } finally {
      setBusy(false);
    }
  };
  const createHelpDraft = async () => {
    const payload = {
      selection_type: helpSelection,
      project_mode: helpMode,
      idempotency_key: `${helpSelection}-${selected.id}-${helpMode}-${[...helpTaskIds].sort().join('-')}-${helpPhaseId}-${[...helpAssetIds].sort().join('-')}-${[...helpMeasurementIds].sort().join('-')}`,
      title: helpDraft.title,
      scope: helpDraft.scope,
      asset_ids: helpAssetIds,
      measurement_ids: helpMeasurementIds,
    };
    if (helpSelection === 'task' || helpSelection === 'tasks')
      payload.task_ids = helpTaskIds;
    if (helpSelection === 'phase') payload.phase_id = Number(helpPhaseId);
    const { data } = await api.post(`${base}/${selected.id}/get-help/`, {
      ...payload,
    });
    await loadProject(selected.id);
    toast.success(data.detail || 'Private request draft created.');
  };
  const addProgressNote = async (event) => {
    event.preventDefault();
    if (!progressNote.trim()) return;
    await api.post(`${base}/${selected.id}/progress/`, {
      note: progressNote.trim(),
    });
    setProgressNote('');
    await loadProject(selected.id);
    toast.success('Progress note added.');
  };

  if (!selected) {
    return (
      <div data-testid="diy-project-planner" className="space-y-5">
        <section className="rounded-3xl border border-amber-300/30 bg-gradient-to-br from-slate-950 to-sky-950 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-[.2em] text-amber-200">
                DIY Project Planner
              </div>
              <h2 className="mt-2 text-2xl font-black text-white">
                Plan it yourself, then decide where help fits.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Create a private homeowner-owned plan before choosing a
                contractor. AI guidance stays separate until you apply it.
              </p>
            </div>
            <button
              data-testid="diy-project-new"
              type="button"
              onClick={() => setCreating(true)}
              className="min-h-11 rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950"
            >
              Plan a DIY Project
            </button>
          </div>
          <p className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs leading-5 text-slate-300">
            {safetyCopy}
          </p>
        </section>
        <section className="rounded-2xl border border-sky-300/30 bg-slate-900 p-5 text-white">
          <div className="text-xs font-bold uppercase tracking-[.18em] text-sky-200">
            Guided video · development placeholder
          </div>
          <h3 className="mt-2 text-lg font-black">
            DIY Doesn’t Mean Doing It Alone
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Learn how to create a private plan, review Project Assistant
            suggestions, track work, and prepare selected tasks for professional
            help. Watch & Do keeps the tutorial available while you work.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              data-testid="diy-video-watch"
              type="button"
              onClick={() => openVideo('diy-doesnt-mean-alone', 'watch')}
              className="rounded-xl border border-sky-300/50 px-4 py-2 font-bold"
            >
              Watch · about 2 min
            </button>
            <button
              data-testid="diy-video-watch-do"
              type="button"
              onClick={() => openVideo('diy-doesnt-mean-alone', 'watch-and-do')}
              className="rounded-xl bg-sky-300 px-4 py-2 font-bold text-sky-950"
            >
              Watch & Do
            </button>
          </div>
        </section>
        {creating ? (
          <form
            data-testid="diy-project-create-form"
            onSubmit={createProject}
            className="grid gap-4 rounded-3xl border border-slate-700 bg-slate-900 p-5 md:grid-cols-2"
          >
            <Field label="Project title">
              <input
                data-testid="diy-project-title"
                required
                className={inputClass}
                value={newProject.title}
                onChange={(e) =>
                  setNewProject({ ...newProject, title: e.target.value })
                }
              />
            </Field>
            <Field label="Project category/type">
              <input
                className={inputClass}
                value={newProject.category}
                onChange={(e) =>
                  setNewProject({ ...newProject, category: e.target.value })
                }
              />
            </Field>
            <Field label="Desired outcome">
              <textarea
                data-testid="diy-project-goal"
                required
                className={inputClass}
                value={newProject.desired_outcome}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    desired_outcome: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Area of the home">
              <input
                className={inputClass}
                value={newProject.area}
                onChange={(e) =>
                  setNewProject({ ...newProject, area: e.target.value })
                }
              />
            </Field>
            <Field label="Property">
              <select
                className={inputClass}
                value={newProject.property_id}
                onChange={(e) =>
                  setNewProject({ ...newProject, property_id: e.target.value })
                }
              >
                <option value="">No property selected</option>
                {propertyProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name || p.address}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Existing conditions">
              <textarea
                className={inputClass}
                value={newProject.existing_conditions}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    existing_conditions: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Work already completed">
              <textarea
                className={inputClass}
                value={newProject.work_completed}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    work_completed: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Experience or confidence notes">
              <textarea
                className={inputClass}
                value={newProject.confidence_notes}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    confidence_notes: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Target budget minimum">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={newProject.target_budget_min}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    target_budget_min: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Target budget maximum">
              <input
                type="number"
                min="0"
                className={inputClass}
                value={newProject.target_budget_max}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    target_budget_max: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Target completion">
              <input
                type="date"
                className={inputClass}
                value={newProject.target_completion_date}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    target_completion_date: e.target.value,
                  })
                }
              />
            </Field>
            <Field label="Additional context">
              <textarea
                className={inputClass}
                value={newProject.additional_context}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    additional_context: e.target.value,
                  })
                }
              />
            </Field>
            <div className="flex gap-2 md:col-span-2">
              <button
                disabled={busy}
                data-testid="diy-project-create"
                className="rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950"
              >
                {busy ? 'Creating...' : 'Create Private Project'}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl border border-slate-600 px-4 py-2 text-white"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        {loading ? (
          <div
            data-testid="diy-project-loading"
            role="status"
            className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-sm text-slate-300"
          >
            Loading your DIY projects…
          </div>
        ) : null}
        {loadError ? (
          <div
            data-testid="diy-project-error"
            role="alert"
            className="rounded-2xl border border-rose-400/40 bg-rose-950/40 p-5 text-sm text-rose-100"
          >
            {loadError}
            <button
              type="button"
              onClick={() => loadList().catch(() => {})}
              className="ml-3 rounded-lg border border-rose-300/50 px-3 py-1 font-bold"
            >
              Retry
            </button>
          </div>
        ) : null}
        {!loading &&
        !loadError &&
        !projects.some((p) => p.status !== 'archived') ? (
          <div
            data-testid="diy-project-empty"
            className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/60 p-6 text-sm text-slate-300"
          >
            No DIY projects yet. Start with a title and desired outcome; details
            can be added as you plan.
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {projects
            .filter((p) => p.status !== 'archived')
            .map((p) => (
              <button
                data-testid={`diy-project-card-${p.id}`}
                key={p.id}
                onClick={() => loadProject(p.id)}
                className="rounded-2xl border border-slate-700 bg-slate-900 p-4 text-left text-white"
              >
                <div className="font-bold">{p.title}</div>
                <div className="mt-1 text-sm text-slate-400">
                  {p.status_label} · {p.progress_percent}% complete
                </div>
                <div className="mt-3 text-xs text-slate-400">
                  Last activity: {new Date(p.updated_at).toLocaleDateString()}
                </div>
                <div className="mt-1 text-sm font-semibold text-amber-200">
                  Next: {projectNextAction(p)}
                </div>
              </button>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="diy-project-workspace" className="space-y-4">
      <button
        onClick={() => {
          setSelected(null);
          setProposal(null);
        }}
        className="inline-flex items-center gap-2 text-sm font-bold text-amber-200"
      >
        <ArrowLeft size={16} />
        All DIY projects
      </button>
      <section className="rounded-3xl border border-slate-700 bg-slate-950 p-5 text-white">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[.2em] text-amber-200">
              Homeowner-owned DIY plan
            </div>
            <h2 className="mt-1 text-2xl font-black">{selected.title}</h2>
            <p className="mt-2 text-slate-300">{selected.desired_outcome}</p>
          </div>
          <div className="min-w-44">
            <div className="text-3xl font-black">
              {selected.progress_percent}%
            </div>
            <div className="text-xs text-slate-400">
              {selected.completed_task_count} of {selected.task_count} tasks
              complete
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['overview', 'design', 'plan', 'progress', 'get-help', 'files'].map(
            (key) => (
              <button
                data-testid={`diy-section-${key}`}
                key={key}
                onClick={() => setSection(key)}
                className={`rounded-xl px-3 py-2 text-sm font-bold ${section === key ? 'bg-amber-300 text-slate-950' : 'bg-slate-800 text-white'}`}
              >
                {key === 'get-help'
                  ? 'Get Help'
                  : key === 'design'
                    ? 'Design & Inspiration'
                    : key[0].toUpperCase() + key.slice(1)}
              </button>
            )
          )}
        </div>
      </section>
      {section === 'overview' ? (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold">Project overview</h3>
              <button
                type="button"
                data-testid="diy-project-edit"
                onClick={() => setEditingProject((value) => !value)}
                className="rounded-lg border border-slate-600 px-3 py-1 text-sm font-semibold"
              >
                {editingProject ? 'Cancel editing' : 'Edit details'}
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              Current phase:{' '}
              {selected.phases.find((p) =>
                p.tasks.some((t) => t.status !== 'completed')
              )?.title || 'Add your first phase'}
            </p>
            <select
              value={selected.status}
              onChange={(e) => updateProject({ status: e.target.value })}
              className={`${inputClass} mt-4`}
            >
              {projectStatuses.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            {editingProject ? (
              <form
                className="mt-4 space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await updateProject({
                    title: selected.title,
                    desired_outcome: selected.desired_outcome,
                    existing_conditions: selected.existing_conditions,
                    work_completed: selected.work_completed,
                    confidence_notes: selected.confidence_notes,
                    additional_context: selected.additional_context,
                    target_budget_min: selected.target_budget_min || null,
                    target_budget_max: selected.target_budget_max || null,
                    target_completion_date:
                      selected.target_completion_date || null,
                  });
                  setEditingProject(false);
                  toast.success('Project details saved.');
                }}
              >
                {[
                  ['title', 'Project title'],
                  ['desired_outcome', 'Desired outcome'],
                  ['existing_conditions', 'Existing conditions'],
                  ['work_completed', 'Work already completed'],
                  ['confidence_notes', 'Experience or confidence notes'],
                  ['additional_context', 'Additional context'],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <textarea
                      className={inputClass}
                      value={selected[key] || ''}
                      onChange={(event) =>
                        setSelected({ ...selected, [key]: event.target.value })
                      }
                    />
                  </Field>
                ))}
                <button
                  data-testid="diy-project-save"
                  className="rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950"
                >
                  Save details
                </button>
              </form>
            ) : null}
          </div>
          <div className="rounded-2xl border border-indigo-300/30 bg-indigo-950/50 p-5 text-white">
            <div className="flex items-center gap-2 font-bold">
              <Sparkles size={18} />
              Project Assistant
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Prepare a suggested plan from your goal and existing conditions.
              Nothing is saved until you select and apply it.
            </p>
            <button
              data-testid="diy-ai-generate"
              disabled={busy}
              onClick={generateProposal}
              className="mt-4 rounded-xl bg-indigo-300 px-4 py-2 font-bold text-indigo-950"
            >
              {busy ? 'Preparing...' : 'Prepare Suggested Plan'}
            </button>
          </div>
        </section>
      ) : null}
      {proposal ? (
        <section
          data-testid="diy-ai-proposal"
          className="rounded-3xl border border-indigo-300/40 bg-slate-900 p-5 text-white"
        >
          <h3 className="text-xl font-black">Suggested plan</h3>
          <p className="mt-2 text-sm text-slate-300">{proposal.summary}</p>
          <p className="mt-3 rounded-xl bg-slate-950 p-3 text-xs text-amber-100">
            {proposal.limitations}
          </p>
          {proposal.questions?.length ? (
            <div className="mt-4 rounded-xl border border-slate-700 p-3">
              <h4 className="font-bold">Questions to consider</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                {proposal.questions.map((row) => (
                  <li key={row.id}>{row.question}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {proposal.warnings?.length ? (
            <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-300/10 p-3">
              <h4 className="font-bold text-amber-100">Professional review</h4>
              {proposal.warnings.map((row, index) => (
                <p key={index} className="mt-1 text-sm text-amber-50">
                  {row.message}
                </p>
              ))}
            </div>
          ) : null}
          {proposal.assumptions?.length ? (
            <div className="mt-4 rounded-xl border border-slate-700 p-3">
              <h4 className="font-bold">Assumptions to verify</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
                {proposal.assumptions.map((value, index) => (
                  <li key={index}>{value}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {proposal.phases.map((p) => (
            <div key={p.client_id} className="mt-4">
              <label className="flex items-center gap-3 font-bold">
                <input
                  type="checkbox"
                  aria-label={`Select all suggestions in ${p.title}`}
                  checked={p.tasks.every((task) =>
                    selectedSuggestions.includes(task.client_id)
                  )}
                  onChange={(event) => {
                    const keys = p.tasks.map((task) => task.client_id);
                    setSelectedSuggestions((current) =>
                      event.target.checked
                        ? Array.from(new Set([...current, ...keys]))
                        : current.filter((key) => !keys.includes(key))
                    );
                  }}
                />
                {p.title}
              </label>
              {p.tasks.map((t) => (
                <label
                  key={t.client_id}
                  className="mt-2 flex gap-3 rounded-xl border border-slate-700 p-3"
                >
                  <input
                    type="checkbox"
                    checked={selectedSuggestions.includes(t.client_id)}
                    onChange={(e) =>
                      setSelectedSuggestions((prev) =>
                        e.target.checked
                          ? [...prev, t.client_id]
                          : prev.filter((v) => v !== t.client_id)
                      )
                    }
                  />
                  <span>
                    <strong>{t.title}</strong>
                    <span className="block text-xs text-slate-400">
                      {t.reason}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ))}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedSuggestions(allSuggestionKeys)}
              className="rounded-xl border border-slate-500 px-3 py-2"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedSuggestions([])}
              className="rounded-xl border border-slate-500 px-3 py-2"
            >
              Clear selection
            </button>
            <button
              data-testid="diy-ai-apply"
              disabled={!selectedSuggestions.length || busy}
              onClick={applyProposal}
              className="rounded-xl bg-indigo-300 px-3 py-2 font-bold text-indigo-950"
            >
              Add selected suggestions
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={generateProposal}
              className="rounded-xl border border-indigo-300/50 px-3 py-2"
            >
              Regenerate
            </button>
            <button
              data-testid="diy-ai-reject"
              onClick={() => {
                setProposal(null);
                setSelectedSuggestions([]);
              }}
              className="rounded-xl border border-rose-400/50 px-3 py-2"
            >
              Reject suggestions
            </button>
          </div>
        </section>
      ) : null}
      {section === 'design' ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <form
            onSubmit={addMeasurement}
            className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white"
          >
            <h3 className="font-bold">Measurements</h3>
            <p className="my-2 text-xs text-slate-400">
              New entries are labeled Homeowner Provided. Professional
              verification requires a separate explicit professional action.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                required
                placeholder="Item name"
                className={inputClass}
                value={measurement.label}
                onChange={(e) =>
                  setMeasurement({ ...measurement, label: e.target.value })
                }
              />
              <input
                required
                type="number"
                step="0.0001"
                placeholder="Value"
                className={inputClass}
                value={measurement.value}
                onChange={(e) =>
                  setMeasurement({ ...measurement, value: e.target.value })
                }
              />
              <input
                required
                placeholder="Unit"
                className={inputClass}
                value={measurement.unit}
                onChange={(e) =>
                  setMeasurement({ ...measurement, unit: e.target.value })
                }
              />
            </div>
            <button className="mt-3 rounded-xl bg-amber-300 px-3 py-2 font-bold text-slate-950">
              Add measurement
            </button>
            {selected.measurements.map((m) => (
              <div
                key={m.id}
                className="mt-3 rounded-xl bg-slate-950 p-3 text-sm"
              >
                {editingMeasurementId === m.id ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      aria-label="Measurement name"
                      className={inputClass}
                      value={editDraft.label || ''}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, label: e.target.value })
                      }
                    />
                    <input
                      aria-label="Measurement value"
                      type="number"
                      step="0.0001"
                      className={inputClass}
                      value={editDraft.value || ''}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, value: e.target.value })
                      }
                    />
                    <input
                      aria-label="Measurement unit"
                      className={inputClass}
                      value={editDraft.unit || ''}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, unit: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => saveMeasurement(m.id)}
                      className="rounded-lg bg-amber-300 px-3 py-2 font-bold text-slate-950"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMeasurementId(null)}
                      className="rounded-lg border border-slate-600 px-3 py-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {m.label}: {m.value} {m.unit}
                      <span className="ml-2 text-xs text-amber-200">
                        {m.verification_label}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMeasurementId(m.id);
                          setEditDraft({
                            label: m.label,
                            value: m.value,
                            unit: m.unit,
                            notes: m.notes || '',
                          });
                        }}
                        className="rounded-lg border border-slate-600 px-2 py-1"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMeasurement(m)}
                        className="rounded-lg border border-rose-400/50 px-2 py-1 text-rose-100"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                )}
              </div>
            ))}
          </form>
          <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
            <h3 className="font-bold">Design notes & inspiration</h3>
            <textarea
              className={`${inputClass} mt-3 min-h-28`}
              value={selected.design_notes || ''}
              onChange={(e) =>
                setSelected({ ...selected, design_notes: e.target.value })
              }
            />
            <button
              onClick={() =>
                updateProject({ design_notes: selected.design_notes })
              }
              className="mt-3 rounded-xl bg-amber-300 px-3 py-2 font-bold text-slate-950"
            >
              Save notes
            </button>
            <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-slate-500 p-4 text-center text-sm">
              <Image className="mx-auto mb-2" />
              Upload inspiration image
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={(e) => uploadAsset(e, 'inspiration')}
              />
            </label>
          </div>
        </section>
      ) : null}
      {section === 'plan' || section === 'progress' ? (
        <section className="space-y-4">
          {section === 'plan' ? (
            <form
              onSubmit={addPhase}
              className="flex flex-col gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:flex-row"
            >
              <input
                data-testid="diy-phase-title"
                required
                placeholder="New phase title"
                className={inputClass}
                value={phaseDraft.title}
                onChange={(e) =>
                  setPhaseDraft({ ...phaseDraft, title: e.target.value })
                }
              />
              <input
                placeholder="Description"
                className={inputClass}
                value={phaseDraft.description}
                onChange={(e) =>
                  setPhaseDraft({ ...phaseDraft, description: e.target.value })
                }
              />
              <button
                data-testid="diy-phase-add"
                className="rounded-xl bg-amber-300 px-4 font-bold text-slate-950"
              >
                <Plus />
              </button>
            </form>
          ) : null}
          {section === 'progress' ? (
            <form
              onSubmit={addProgressNote}
              className="flex flex-col gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:flex-row"
            >
              <label className="sr-only" htmlFor="diy-progress-note">
                Progress note
              </label>
              <input
                id="diy-progress-note"
                data-testid="diy-progress-note"
                className={inputClass}
                value={progressNote}
                onChange={(event) => setProgressNote(event.target.value)}
                placeholder="Record what changed, what you found, or what comes next"
              />
              <button
                data-testid="diy-progress-add"
                className="rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950"
              >
                Add progress note
              </button>
            </form>
          ) : null}
          {selected.phases.map((p, phaseIndex) => (
            <article
              key={p.id}
              className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                {editingPhaseId === p.id ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <input
                      aria-label="Phase title"
                      className={inputClass}
                      value={editDraft.title || ''}
                      onChange={(event) =>
                        setEditDraft({
                          ...editDraft,
                          title: event.target.value,
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        await api.patch(
                          `${base}/${selected.id}/phases/${p.id}/`,
                          editDraft
                        );
                        setEditingPhaseId(null);
                        setEditDraft({});
                        await loadProject(selected.id);
                      }}
                      className="rounded-lg bg-amber-300 px-3 py-2 font-bold text-slate-950"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <h3 className="font-black">{p.title}</h3>
                )}
                <div
                  className="flex flex-wrap gap-1"
                  aria-label={`Actions for phase ${p.title}`}
                >
                  <button
                    type="button"
                    aria-label={`Move ${p.title} up`}
                    disabled={phaseIndex === 0}
                    onClick={() => movePhase(phaseIndex, -1)}
                    className="rounded-lg border border-slate-600 px-2 py-1 disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${p.title} down`}
                    disabled={phaseIndex === selected.phases.length - 1}
                    onClick={() => movePhase(phaseIndex, 1)}
                    className="rounded-lg border border-slate-600 px-2 py-1 disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPhaseId(p.id);
                      setEditDraft({
                        title: p.title,
                        description: p.description,
                      });
                    }}
                    className="rounded-lg border border-slate-600 px-2 py-1"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deletePhase(p)}
                    className="rounded-lg border border-rose-400/50 px-2 py-1 text-rose-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {p.tasks.map((t, taskIndex) => (
                <div
                  key={t.id}
                  data-testid={`diy-task-${t.id}`}
                  className="mt-3 rounded-xl bg-slate-950 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      {editingTaskId === t.id ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            aria-label="Task title"
                            className={inputClass}
                            value={editDraft.title || ''}
                            onChange={(event) =>
                              setEditDraft({
                                ...editDraft,
                                title: event.target.value,
                              })
                            }
                          />
                          <input
                            aria-label="Task description"
                            className={inputClass}
                            value={editDraft.description || ''}
                            onChange={(event) =>
                              setEditDraft({
                                ...editDraft,
                                description: event.target.value,
                              })
                            }
                          />
                          <button
                            type="button"
                            onClick={async () => {
                              await updateTask(t.id, editDraft);
                              setEditingTaskId(null);
                              setEditDraft({});
                            }}
                            className="rounded-lg bg-amber-300 px-3 py-2 font-bold text-slate-950"
                          >
                            Save task
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTaskId(null)}
                            className="rounded-lg border border-slate-600 px-3 py-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <strong>{t.title}</strong>
                      )}
                      <div className="text-xs text-slate-400">
                        {t.participation_label} ·{' '}
                        {t.source === 'ai'
                          ? 'AI-suggested, applied by homeowner'
                          : 'Homeowner-created'}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <select
                        aria-label={`Participation for ${t.title}`}
                        className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm"
                        value={t.participation_type}
                        onChange={(event) =>
                          updateTask(t.id, {
                            participation_type: event.target.value,
                          })
                        }
                      >
                        {participation.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        data-testid={`diy-task-status-${t.id}`}
                        className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-sm"
                        value={t.status}
                        onChange={(e) =>
                          updateTask(t.id, {
                            status: e.target.value,
                            progress_note: `Status changed to ${e.target.value}`,
                          })
                        }
                      >
                        {taskStatuses.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                      {section === 'plan' ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Move ${t.title} up`}
                            disabled={taskIndex === 0}
                            onClick={() => moveTask(p, taskIndex, -1)}
                            className="rounded-lg border border-slate-600 px-2 py-1 disabled:opacity-40"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${t.title} down`}
                            disabled={taskIndex === p.tasks.length - 1}
                            onClick={() => moveTask(p, taskIndex, 1)}
                            className="rounded-lg border border-slate-600 px-2 py-1 disabled:opacity-40"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTaskId(t.id);
                              setEditDraft({
                                title: t.title,
                                description: t.description || '',
                              });
                            }}
                            className="rounded-lg border border-slate-600 px-2 py-1"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTask(t)}
                            className="rounded-lg border border-rose-400/50 px-2 py-1 text-rose-100"
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {t.description ? (
                    <p className="mt-2 text-sm text-slate-300">
                      {t.description}
                    </p>
                  ) : null}
                  {section === 'progress' ? (
                    <label className="mt-3 inline-block cursor-pointer rounded-lg border border-slate-600 px-3 py-2 text-xs">
                      Add progress photo
                      <input
                        className="sr-only"
                        type="file"
                        accept="image/*"
                        onChange={(event) =>
                          uploadAsset(event, 'progress_photo', t.id)
                        }
                      />
                    </label>
                  ) : null}
                  {t.professional_review_recommended ? (
                    <p className="mt-2 text-xs text-amber-200">
                      Consider professional review. Verify requirements locally.
                    </p>
                  ) : null}
                </div>
              ))}
              {section === 'plan' ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    placeholder="Task title"
                    className={inputClass}
                    value={taskDrafts[p.id]?.title || ''}
                    onChange={(e) =>
                      setTaskDrafts({
                        ...taskDrafts,
                        [p.id]: { ...taskDrafts[p.id], title: e.target.value },
                      })
                    }
                  />
                  <select
                    className={inputClass}
                    value={taskDrafts[p.id]?.participation_type || 'UNDECIDED'}
                    onChange={(e) =>
                      setTaskDrafts({
                        ...taskDrafts,
                        [p.id]: {
                          ...taskDrafts[p.id],
                          participation_type: e.target.value,
                        },
                      })
                    }
                  >
                    {participation.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => addTask(p.id)}
                    className="rounded-xl bg-amber-300 px-3 font-bold text-slate-950"
                  >
                    Add
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {section === 'get-help' ? (
        <section className="rounded-3xl border border-sky-300/30 bg-slate-900 p-5 text-white">
          <Hammer />
          <h3 className="mt-2 text-xl font-black">
            Prepare a professional-help request
          </h3>
          <p className="mt-2 text-sm text-slate-300">
            This creates a private, editable request draft from remaining tasks.
            It will not route contractors automatically.
          </p>
          <select
            data-testid="diy-help-mode"
            className={`${inputClass} mt-4`}
            value={helpMode}
            onChange={(e) => setHelpMode(e.target.value)}
          >
            <option value="diy_assist">DIY Assistance</option>
            <option value="consultation">Consultation / Guidance</option>
            <option value="inspection_only">Inspection Only</option>
            <option value="full_service">Full Service</option>
            <option value="not_sure">Not Sure Yet</option>
          </select>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Work to include">
              <select
                data-testid="diy-help-selection"
                className={inputClass}
                value={helpSelection}
                onChange={(event) => setHelpSelection(event.target.value)}
              >
                <option value="remaining">All remaining work</option>
                <option value="task">One task</option>
                <option value="tasks">Selected tasks</option>
                <option value="phase">One phase</option>
              </select>
            </Field>
            {helpSelection === 'phase' ? (
              <Field label="Phase">
                <select
                  className={inputClass}
                  value={helpPhaseId}
                  onChange={(event) => setHelpPhaseId(event.target.value)}
                >
                  <option value="">Choose a phase</option>
                  {selected.phases.map((phase) => (
                    <option key={phase.id} value={phase.id}>
                      {phase.title}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
          {helpSelection === 'task' || helpSelection === 'tasks' ? (
            <fieldset className="mt-4 rounded-xl border border-slate-700 p-3">
              <legend className="px-1 text-sm font-bold">Tasks to share</legend>
              {selected.phases
                .flatMap((phase) => phase.tasks)
                .map((task) => (
                  <label key={task.id} className="mt-2 flex gap-2 text-sm">
                    <input
                      type={helpSelection === 'task' ? 'radio' : 'checkbox'}
                      name="help-task"
                      checked={helpTaskIds.includes(task.id)}
                      onChange={() =>
                        setHelpTaskIds((current) =>
                          helpSelection === 'task'
                            ? [task.id]
                            : current.includes(task.id)
                              ? current.filter((id) => id !== task.id)
                              : [...current, task.id]
                        )
                      }
                    />
                    {task.title}
                  </label>
                ))}
            </fieldset>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Request title">
              <input
                className={inputClass}
                value={helpDraft.title}
                placeholder={`Help with ${selected.title}`}
                onChange={(event) =>
                  setHelpDraft({ ...helpDraft, title: event.target.value })
                }
              />
            </Field>
            <Field label="Scope notes (editable)">
              <textarea
                className={inputClass}
                value={helpDraft.scope}
                placeholder="Add context for the professional. Only selected plan content is copied."
                onChange={(event) =>
                  setHelpDraft({ ...helpDraft, scope: event.target.value })
                }
              />
            </Field>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl bg-slate-950 p-3 text-sm">
              <h4 className="font-bold">Project context included</h4>
              <p className="mt-2">Outcome: {selected.desired_outcome}</p>
              <p>
                Existing conditions:{' '}
                {selected.existing_conditions || 'Not provided'}
              </p>
              <p>Work completed: {selected.work_completed || 'Not provided'}</p>
              <p>
                Budget: {selected.target_budget_min || 'Not set'}–
                {selected.target_budget_max || 'Not set'}
              </p>
              <p>Timing: {selected.target_completion_date || 'Not set'}</p>
            </div>
            <div className="rounded-xl bg-slate-950 p-3 text-sm">
              <h4 className="font-bold">Supporting details to share</h4>
              {selected.assets.map((asset) => (
                <label key={asset.id} className="mt-2 flex gap-2">
                  <input
                    type="checkbox"
                    checked={helpAssetIds.includes(asset.id)}
                    onChange={() =>
                      setHelpAssetIds((current) =>
                        current.includes(asset.id)
                          ? current.filter((id) => id !== asset.id)
                          : [...current, asset.id]
                      )
                    }
                  />
                  {asset.caption || asset.asset_type_label} #{asset.id}
                </label>
              ))}
              {selected.measurements.map((row) => (
                <label key={row.id} className="mt-2 flex gap-2">
                  <input
                    type="checkbox"
                    checked={helpMeasurementIds.includes(row.id)}
                    onChange={() =>
                      setHelpMeasurementIds((current) =>
                        current.includes(row.id)
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id]
                      )
                    }
                  />
                  {row.label}: {row.value} {row.unit} ({row.verification_label})
                </label>
              ))}
              {!selected.assets.length && !selected.measurements.length ? (
                <p className="mt-2 text-slate-400">
                  No photos or measurements have been added.
                </p>
              ) : null}
            </div>
          </div>
          <button
            data-testid="diy-help-create-draft"
            onClick={createHelpDraft}
            className="mt-4 rounded-xl bg-sky-300 px-4 py-2 font-bold text-sky-950"
          >
            Create Reviewable Request Draft
          </button>
          {selected.request_links?.length ? (
            <div className="mt-3 text-sm text-emerald-200">
              Linked request draft #
              {selected.request_links[0].customer_request_id} is ready in
              Requests.
              {onOpenRequest ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenRequest(selected.request_links[0].customer_request_id)
                  }
                  className="ml-2 rounded-lg border border-emerald-300 px-2 py-1 font-bold"
                >
                  Open request draft
                </button>
              ) : null}
              <p className="mt-2">
                No contractor has been contacted. Review and submit separately
                when ready.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
      {section === 'files' ? (
        <section className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white">
          <h3 className="font-bold">Project photos and files</h3>
          <label className="mt-3 block cursor-pointer rounded-xl border border-dashed border-slate-500 p-5 text-center">
            <Image className="mx-auto mb-2" />
            Upload project photo or file
            <input className="sr-only" type="file" onChange={uploadAsset} />
          </label>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {selected.assets.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-xl bg-slate-950 p-3 text-sm"
              >
                {a.caption || a.asset_type_label}
                <span className="flex gap-2">
                  <a
                    href={`${base}/${selected.id}/assets/${a.id}/download/`}
                    className="rounded-lg border border-slate-600 px-2 py-1"
                  >
                    View
                  </a>
                  <button
                    type="button"
                    onClick={() => deleteAsset(a)}
                    className="rounded-lg border border-rose-400/50 px-2 py-1 text-rose-100"
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
