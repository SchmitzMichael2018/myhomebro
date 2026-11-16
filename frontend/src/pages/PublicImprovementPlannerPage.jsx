import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api';
import { LibraryShell } from './PublicImprovementLibraryPage.jsx';
import { applySeoMetadata, SITE_ORIGIN } from '../lib/seoMetadata.js';
import {
  PUBLIC_PLANNING_CONTINUATION,
  PUBLIC_PLANNING_DRAFT_VERSION,
  PUBLIC_PLANNING_INPUT_LIMITS,
  clearPublicPlanningDraft,
  readPublicPlanningDraft,
  validatePublicPlanningDraft,
  writePublicPlanningDraft,
} from '../lib/publicPlanningDraft.js';

const inputClass =
  'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-slate-950 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100';
const buttonClass =
  'inline-flex min-h-12 items-center justify-center rounded-xl px-5 py-3 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const emptyInputs = {
  title: '',
  desired_outcome: '',
  existing_conditions: '',
  additional_context: '',
  confidence_notes: '',
};
const fields = [
  [
    'desired_outcome',
    'What do you want to change?',
    'Describe the result, approximate size, and what is included.',
  ],
  [
    'existing_conditions',
    'What is there now?',
    'Describe current materials, damage, access, and anything already completed.',
  ],
  [
    'confidence_notes',
    'What would you like help with?',
    'Tell us about your experience and any work you would prefer a professional to handle.',
  ],
  [
    'additional_context',
    'Anything else the plan should account for?',
    'Optional: budget range, timing, measurements, or answers you already know. Do not include private contact or payment details.',
  ],
];
const participationLabels = {
  DO_IT_MYSELF: 'Possible DIY task',
  NEED_GUIDANCE: 'Expert guidance suggested',
  NEED_HELP: 'Hands-on help suggested',
  NEED_PROFESSIONAL: 'Professional help suggested',
  UNDECIDED: 'Decide how to approach this task',
};

function planText(draft) {
  const plan = draft.proposal;
  return [
    draft.inputs.title,
    'Suggested plan · Not saved',
    plan.summary,
    plan.limitations,
    ...plan.warnings.map((row) => `Professional review: ${row.message}`),
    ...plan.assumptions.map((row) => `Assumption to verify: ${row}`),
    ...plan.questions.map((row) => `Question: ${row.question}`),
    ...plan.phases.flatMap((phase, index) => [
      `${index + 1}. ${phase.title}`,
      phase.description,
      ...phase.tasks.flatMap((task) => [
        `  • ${task.title} (${participationLabels[task.participation_type]})`,
        task.description,
        task.reason && `Why: ${task.reason}`,
        task.professional_review_recommended &&
          'Professional review recommended.',
        task.prerequisite_notes &&
          `Before starting: ${task.prerequisite_notes}`,
        task.estimated_duration &&
          `Estimated duration: ${task.estimated_duration}`,
        task.estimated_cost !== null &&
          `Planning cost estimate: $${task.estimated_cost}, not a quote.`,
      ]),
    ]),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export default function PublicImprovementPlannerPage() {
  const { categorySlug, improvementSlug } = useParams();
  const navigate = useNavigate();
  const guidePath = `/improvements/${categorySlug}/${improvementSlug}/`;
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [inputs, setInputs] = useState(emptyInputs);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const requestRef = useRef(null);
  const continueRef = useRef(false);
  const formRef = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    setGuide(null);
    setDraft(null);
    setInputs(emptyInputs);
    setAnswers({});
    setError('');
    setStorageError(false);
    setCancelled(false);
    setBusy(false);
    setContinuing(false);
    continueRef.current = false;
    applySeoMetadata(`${guidePath}plan`, {
      title: 'Plan your home project | MyHomeBro',
      description:
        'Review a suggested project plan before saving or choosing how to get the work done.',
      canonicalUrl: `${SITE_ORIGIN}${guidePath}plan`,
      robots: 'noindex, follow',
    });
    fetch(`/api/projects/public${guidePath}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(response.status === 404 ? 'unavailable' : 'load');
        return response.json();
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (!value?.id || !value.title) throw new Error('load');
        setGuide(value);
        const saved = readPublicPlanningDraft();
        if (
          saved?.guide_path === guidePath &&
          saved.source_template_id === value.id &&
          !value.problem
        ) {
          setInputs(saved.inputs);
          setDraft(saved);
        } else {
          setInputs({
            ...emptyInputs,
            title: value.title.slice(0, PUBLIC_PLANNING_INPUT_LIMITS.title),
          });
        }
      })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setLoadError(
          failure.message === 'unavailable'
            ? 'This published project guide is not available. Choose another guide to begin.'
            : 'We could not load this project guide. Please try again.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [guidePath, reload]);

  const stale = Boolean(
    draft &&
      (Object.keys(emptyInputs).some(
        (key) => inputs[key] !== draft.inputs[key]
      ) ||
        Object.values(answers).some((value) => value.trim()))
  );

  const changeInput = (key, value) => {
    setInputs((current) => ({ ...current, [key]: value }));
    setError('');
    setStorageError(false);
  };

  const preparePlan = async (event) => {
    event.preventDefault();
    if (requestRef.current || continuing) return;
    const answered = (draft?.proposal.questions || []).flatMap(
      (question, index) =>
        answers[index]?.trim()
          ? [`${question.question}\n${answers[index].trim()}`]
          : []
    );
    const requestInputs = Object.fromEntries(
      Object.entries(inputs).map(([key, value]) => [key, value.trim()])
    );
    if (answered.length) {
      requestInputs.additional_context = [
        requestInputs.additional_context,
        'Answers to planning questions:',
        ...answered,
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    if (
      requestInputs.additional_context.length >
      PUBLIC_PLANNING_INPUT_LIMITS.additional_context
    ) {
      setError(
        'Your extra context and follow-up answers exceed 2,000 characters. Shorten them before preparing the plan.'
      );
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError('');
    setStorageError(false);
    setCancelled(false);
    try {
      const { data } = await api.post(
        `/projects/public${guidePath}plan/`,
        requestInputs,
        { signal: controller.signal, timeout: 90000 }
      );
      if (requestRef.current !== controller || controller.signal.aborted)
        return;
      const nextDraft = {
        version: PUBLIC_PLANNING_DRAFT_VERSION,
        preview_token: data.preview_token,
        expires_at: data.expires_at,
        source_template_id: data.source_template_id,
        inputs: data.inputs,
        proposal: data.proposal,
        guide_path: guidePath,
      };
      if (
        !validatePublicPlanningDraft(nextDraft) ||
        nextDraft.source_template_id !== guide.id
      ) {
        throw new Error('invalid-preview');
      }
      setDraft(nextDraft);
      setInputs(nextDraft.inputs);
      setAnswers({});
      window.requestAnimationFrame(() => previewRef.current?.focus());
    } catch (failure) {
      if (requestRef.current !== controller || controller.signal.aborted)
        return;
      const status = failure?.response?.status;
      setError(
        status === 429
          ? 'Too many plan requests. Please wait a few minutes and try again. Your answers are still here.'
          : status === 404
            ? 'This guide is no longer available for planning. Your answers are still here; return to the library for another guide.'
            : 'We could not prepare a usable plan. Your answers are still here. Please try again or use the guide to plan without suggestions.'
      );
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  };

  const cancelPreparation = () => {
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setCancelled(true);
  };

  const continueToSave = () => {
    if (continueRef.current || busy || !draft || stale) return;
    if (!validatePublicPlanningDraft(draft)) {
      setError(
        'This suggested plan has expired. Prepare it again before continuing. Your answers are still here.'
      );
      return;
    }
    if (!writePublicPlanningDraft(draft)) {
      setStorageError(true);
      return;
    }
    continueRef.current = true;
    setContinuing(true);
    const params = new URLSearchParams({
      role: 'customer',
      intent: 'diy',
      next: PUBLIC_PLANNING_CONTINUATION,
    });
    const attribution = new URLSearchParams(window.location.search);
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'ref',
    ]) {
      if (attribution.has(key)) params.set(key, attribution.get(key));
    }
    navigate(`/create-account?${params}`);
  };

  const discardPlan = () => {
    if (readPublicPlanningDraft()?.preview_token === draft?.preview_token)
      clearPublicPlanningDraft();
    setDraft(null);
    setAnswers({});
    setError('');
    setStorageError(false);
    formRef.current?.querySelector('input')?.focus();
  };

  return (
    <LibraryShell showBrandText>
      <div
        className="mx-auto max-w-4xl px-4 py-8 pb-24 sm:px-6"
        data-testid="public-project-planner"
      >
        <Link
          to={`${guidePath}${window.location.search}`}
          className="inline-flex min-h-12 items-center font-bold text-blue-800 underline underline-offset-4"
        >
          ← Back to project guide
        </Link>
        {loading ? (
          <p className="py-16 text-slate-600" role="status">
            Loading published project guide…
          </p>
        ) : loadError ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
            <h1 className="text-2xl font-bold">Project guide unavailable</h1>
            <p role="alert" className="mt-3 text-slate-700">
              {loadError}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setReload((value) => value + 1)}
                className={`${buttonClass} bg-blue-700 text-white`}
              >
                Try again
              </button>
              <Link
                to="/improvements/"
                className={`${buttonClass} border border-slate-300 text-slate-900`}
              >
                Browse project guides
              </Link>
            </div>
          </section>
        ) : guide?.problem ? (
          <section className="mt-6 rounded-2xl border border-slate-200 p-6">
            <h1 className="text-2xl font-bold">This is an editorial guide</h1>
            <p className="mt-3 text-slate-700">
              Read the guide for its recommended next steps, or choose a home
              improvement guide to prepare a project plan.
            </p>
            <Link
              to="/improvements/"
              className={`${buttonClass} mt-5 bg-blue-700 text-white`}
            >
              Browse project guides
            </Link>
          </section>
        ) : guide ? (
          <>
            <header className="mt-6">
              <p className="text-sm font-bold uppercase tracking-widest text-blue-700">
                Project Assistant · Plan before you decide
              </p>
              <h1 className="mt-3 text-3xl font-black text-slate-950 sm:text-5xl">
                Plan this project
              </h1>
              <p className="mt-4 text-lg text-slate-700">{guide.title}</p>
              <p className="mt-3 max-w-2xl leading-7 text-slate-600">
                Answer a few questions, review a suggested plan, then save it to
                your account. Choose DIY, expert guidance, or professional help
                after saving.
              </p>
            </header>
            <form
              ref={formRef}
              onSubmit={preparePlan}
              className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 sm:p-8"
              data-testid="public-planning-questions"
            >
              <h2 className="text-2xl font-bold text-slate-950">
                Tell us about your project
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Unknown details are fine. Suggestions cannot confirm permits,
                code compliance, hidden conditions, or safety.
              </p>
              <fieldset
                disabled={busy || continuing}
                className="mt-6 space-y-5"
              >
                <label className="block font-semibold text-slate-900">
                  <span className="mb-2 block">Project name</span>
                  <input
                    name="title"
                    required
                    maxLength={PUBLIC_PLANNING_INPUT_LIMITS.title}
                    value={inputs.title}
                    onChange={(event) =>
                      changeInput('title', event.target.value)
                    }
                    className={inputClass}
                  />
                </label>
                {fields.map(([key, label, hint]) => (
                  <label
                    key={key}
                    className="block font-semibold text-slate-900"
                  >
                    <span className="mb-1 block">
                      {label}
                      {key === 'desired_outcome' ? ' (required)' : ''}
                    </span>
                    <span
                      id={`${key}-hint`}
                      className="mb-2 block text-sm font-normal leading-6 text-slate-600"
                    >
                      {hint}
                    </span>
                    <textarea
                      name={key}
                      aria-describedby={`${key}-hint`}
                      required={key === 'desired_outcome'}
                      maxLength={PUBLIC_PLANNING_INPUT_LIMITS[key]}
                      value={inputs[key]}
                      onChange={(event) => changeInput(key, event.target.value)}
                      rows={3}
                      className={inputClass}
                    />
                  </label>
                ))}
              </fieldset>
              {error ? (
                <p
                  role="alert"
                  className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"
                >
                  {error}
                </p>
              ) : null}
              {cancelled ? (
                <p role="status" className="mt-4 text-slate-700">
                  Preparation cancelled. Your answers have not changed.
                </p>
              ) : null}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  data-testid="prepare-public-plan"
                  type="submit"
                  disabled={busy || continuing}
                  className={`${buttonClass} bg-blue-700 text-white hover:bg-blue-800`}
                >
                  {busy
                    ? 'Preparing suggested plan…'
                    : draft
                      ? 'Regenerate suggested plan'
                      : 'Prepare suggested plan'}
                </button>
                {busy ? (
                  <button
                    type="button"
                    onClick={cancelPreparation}
                    className={`${buttonClass} border border-slate-300 text-slate-900`}
                  >
                    Cancel preparation
                  </button>
                ) : null}
              </div>
              <p className="mt-3 text-sm text-slate-600">
                No account needed to preview. Preparing a plan does not save a
                project or contact a contractor.
              </p>
            </form>
            {draft ? (
              <section
                ref={previewRef}
                tabIndex={-1}
                className="mt-8 rounded-3xl border border-blue-200 bg-blue-50/50 p-5 outline-none sm:p-8"
                data-testid="public-plan-preview"
                aria-labelledby="suggested-plan-heading"
              >
                <p className="text-sm font-bold uppercase tracking-widest text-blue-700">
                  Review before saving · Not saved
                </p>
                <h2
                  id="suggested-plan-heading"
                  className="mt-2 text-3xl font-black text-slate-950"
                >
                  Suggested plan
                </h2>
                <p className="mt-4 whitespace-pre-line leading-7 text-slate-700">
                  {draft.proposal.summary}
                </p>
                <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                  {draft.proposal.limitations} Verify local requirements and
                  seek qualified professional advice where needed. Estimates are
                  planning aids, not quotes or commitments.
                </p>
                {stale ? (
                  <p
                    role="status"
                    className="mt-4 rounded-xl border border-amber-400 bg-white p-4 font-semibold text-amber-950"
                  >
                    Your answers have changed. Regenerate the plan before saving
                    so it reflects your latest answers.
                  </p>
                ) : null}
                {draft.proposal.warnings.length ? (
                  <div className="mt-6">
                    <h3 className="text-xl font-bold text-slate-950">
                      Professional review
                    </h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-700">
                      {draft.proposal.warnings.map((row, index) => (
                        <li key={index}>{row.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {draft.proposal.assumptions.length ? (
                  <div className="mt-6">
                    <h3 className="text-xl font-bold text-slate-950">
                      Assumptions to verify
                    </h3>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-700">
                      {draft.proposal.assumptions.map((row, index) => (
                        <li key={index}>{row}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {draft.proposal.questions.length ? (
                  <fieldset
                    disabled={busy || continuing}
                    className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
                  >
                    <legend className="px-1 text-xl font-bold text-slate-950">
                      Questions to consider
                    </legend>
                    <p className="text-sm text-slate-600">
                      Answer what you can, then regenerate. Unknown answers may
                      need an on-site professional review.
                    </p>
                    {draft.proposal.questions.map((row, index) => (
                      <label
                        key={`${index}-${row.id}`}
                        className="block font-semibold text-slate-900"
                      >
                        <span className="mb-2 block">{row.question}</span>
                        <textarea
                          rows={2}
                          maxLength={1000}
                          value={answers[index] || ''}
                          onChange={(event) =>
                            setAnswers((current) => ({
                              ...current,
                              [index]: event.target.value,
                            }))
                          }
                          className={inputClass}
                        />
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                <ol className="mt-6 space-y-5">
                  {draft.proposal.phases.map((phase, index) => (
                    <li
                      key={`${index}-${phase.client_id}`}
                      className="rounded-2xl border border-slate-200 bg-white p-5"
                    >
                      <h3 className="text-xl font-bold text-slate-950">
                        {index + 1}. {phase.title}
                      </h3>
                      {phase.description ? (
                        <p className="mt-2 whitespace-pre-line text-slate-600">
                          {phase.description}
                        </p>
                      ) : null}
                      <ul className="mt-4 space-y-5">
                        {phase.tasks.map((task, taskIndex) => (
                          <li
                            key={`${taskIndex}-${task.client_id}`}
                            className="border-t border-slate-200 pt-4"
                          >
                            <h4 className="font-bold text-slate-950">
                              {task.title}
                            </h4>
                            <p className="mt-1 text-sm font-semibold text-blue-800">
                              {participationLabels[task.participation_type]}
                            </p>
                            {task.professional_review_recommended ? (
                              <p className="mt-1 text-sm font-bold text-amber-900">
                                Professional review recommended
                              </p>
                            ) : null}
                            <p className="mt-2 whitespace-pre-line leading-7 text-slate-700">
                              {task.description}
                            </p>
                            {task.reason ? (
                              <p className="mt-2 text-sm text-slate-600">
                                <strong>Why:</strong> {task.reason}
                              </p>
                            ) : null}
                            {task.prerequisite_notes ? (
                              <p className="mt-2 text-sm text-slate-600">
                                <strong>Before starting:</strong>{' '}
                                {task.prerequisite_notes}
                              </p>
                            ) : null}
                            {task.estimated_duration ? (
                              <p className="mt-2 text-sm text-slate-600">
                                Estimated duration: {task.estimated_duration}
                              </p>
                            ) : null}
                            {task.estimated_cost !== null ? (
                              <p className="mt-2 text-sm text-slate-600">
                                Planning cost estimate: ${task.estimated_cost}{' '}
                                (not a quote)
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ol>
                {storageError ? (
                  <p
                    role="alert"
                    className="mt-6 rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950"
                  >
                    Your browser could not keep this plan for sign-in. You are
                    still on this page and nothing was saved. Enable session
                    storage and try again, or copy the plan below before
                    leaving.
                  </p>
                ) : null}
                <div className="mt-7 flex flex-wrap gap-3">
                  <button
                    type="button"
                    data-testid="save-public-plan"
                    onClick={continueToSave}
                    disabled={busy || continuing || stale}
                    className={`${buttonClass} bg-blue-700 text-white hover:bg-blue-800`}
                  >
                    {continuing ? 'Continuing…' : 'Save this plan'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      formRef.current?.querySelector('input')?.focus()
                    }
                    disabled={busy || continuing}
                    className={`${buttonClass} border border-slate-300 bg-white text-slate-900`}
                  >
                    Edit project answers
                  </button>
                  <button
                    type="button"
                    onClick={discardPlan}
                    disabled={busy || continuing}
                    className={`${buttonClass} text-slate-700 underline`}
                  >
                    Discard suggested plan
                  </button>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Create an account or sign in, then confirm the plan in your
                  workspace. No contractor is contacted. You can organize DIY
                  work or request professional help after saving. This preview
                  stays in this tab for up to 24 hours. After verifying your
                  email, return to this tab to finish saving.
                </p>
                <details
                  open={storageError || undefined}
                  className="mt-6 rounded-xl border border-slate-200 bg-white p-4"
                >
                  <summary className="cursor-pointer font-bold text-blue-800">
                    Copy a text version of this plan
                  </summary>
                  <label className="mt-4 block text-sm font-semibold text-slate-700">
                    <span className="mb-2 block">
                      Select and copy this suggested plan
                    </span>
                    <textarea
                      readOnly
                      rows={12}
                      value={planText(draft)}
                      onFocus={(event) => event.target.select()}
                      className={inputClass}
                    />
                  </label>
                </details>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </LibraryShell>
  );
}
