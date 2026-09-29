import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api';
import { useAssistantDock } from '../../components/AssistantDock.jsx';
import ImprovementEditorialAssistant from '../../components/ImprovementEditorialAssistant.jsx';

const initial = {
  public_title: '',
  public_slug: '',
  public_category_slug: 'contractor-practice',
  public_audience: 'contractor',
  public_audiences: ['contractor'],
  public_audience_actions: { contractor: 'sign_up' },
  public_editorial_brief: {},
  public_summary: '',
  public_problem: '',
  public_evidence: '',
  public_evidence_source: '',
  public_viewpoint: '',
  public_practical_steps: '',
  public_next_action: 'sign_up',
  public_video_url: '',
  public_video_title: '',
  public_video_description: '',
  public_video_poster_url: '',
  public_video_text_summary: '',
  public_video_transcript_url: '',
  seo_title: '',
  seo_description: '',
  is_featured_public: false,
  related_ids: [],
};
const fieldGroups = [
  [
    'Public identity',
    [
      ['public_title', 'Article title'],
      ['public_slug', 'URL slug'],
      ['public_category_slug', 'Category slug'],
      ['public_summary', 'Short summary'],
    ],
  ],
  [
    'Editorial sequence',
    [
      ['public_problem', '1. Recognizable problem'],
      ['public_evidence', '2. Evidence and population/source qualifiers'],
      ['public_evidence_source', 'Evidence source URL'],
      ['public_viewpoint', '3. MyHomeBro viewpoint — Our take'],
      ['public_practical_steps', '4. Practical steps'],
    ],
  ],
  [
    'Search and sharing',
    [
      ['seo_title', 'SEO title'],
      ['seo_description', 'SEO description'],
    ],
  ],
  [
    'Walkthrough video (optional)',
    [
      ['public_video_url', 'Video URL (HTTPS)'],
      ['public_video_title', 'Video title'],
      ['public_video_description', 'Short video description'],
      ['public_video_poster_url', 'Thumbnail or poster image URL (HTTPS)'],
      ['public_video_text_summary', 'Text summary'],
      ['public_video_transcript_url', 'Transcript link (HTTPS)'],
    ],
  ],
];
const buttonClass =
  'min-h-11 rounded-xl border border-white/20 bg-white/10 px-4 py-2 font-bold text-white hover:bg-white/20 disabled:opacity-50';
const audiences = [
  ['contractor', 'Contractors'],
  ['homeowner', 'Homeowners'],
  ['property_manager', 'Property Managers'],
];

export default function AdminImprovementsPage() {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const { updateAssistantContext, updateAssistantOnAction } = useAssistantDock();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initial);
  const [savedForm, setSavedForm] = useState(initial);
  const [status, setStatus] = useState('');
  const [reviewedById, setReviewedById] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [aiSection, setAiSection] = useState('public_problem');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [proposal, setProposal] = useState(null);
  const [proposalBasis, setProposalBasis] = useState('');
  const [reviewFlags, setReviewFlags] = useState([]);
  const proposalRequestId = useRef(0);
  const dirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  const visibleRows = rows.filter(
    (row) => statusFilter === 'all' || row.publication_status === statusFilter
  );
  const load = async () => {
    try {
      const { data } = await api.get('/projects/admin/improvements/');
      setRows(data.results);
      if (articleId) {
        const current = data.results.find(
          (row) => String(row.id) === String(articleId)
        );
        if (current) {
          const loaded = Object.fromEntries(
            Object.keys(initial).map((key) => [
              key,
              current[key] ?? initial[key],
            ])
          );
          setForm(loaded);
          setSavedForm(loaded);
          setStatus(current.publication_status);
          setReviewedById(current.reviewed_by_id);
        } else setError('Article not found.');
      } else {
        setForm(initial);
        setSavedForm(initial);
        setStatus('');
        setReviewedById(null);
      }
    } catch {
      setError('Could not load the editorial library.');
    }
  };
  useEffect(() => {
    proposalRequestId.current += 1;
    setProposal(null);
    setAiError('');
    setAiBusy(false);
    load();
  }, [articleId]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = articleId
        ? await api.patch(`/projects/admin/improvements/${articleId}/`, form)
        : await api.post('/projects/admin/improvements/', form);
      setStatus(data.publication_status);
      setReviewedById(data.reviewed_by_id);
      setProposal(null);
      await load();
      if (!articleId) navigate(`/app/admin/improvements/${data.id}`);
    } catch (caught) {
      setError(JSON.stringify(caught.response?.data || 'Save failed.'));
    } finally {
      setBusy(false);
    }
  };
  const transition = async (action) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(
        `/projects/admin/improvements/${articleId}/${action}/`
      );
      setStatus(data.publication_status);
      setReviewedById(data.reviewed_by_id);
      setProposal(null);
      await load();
    } catch (caught) {
      setError(JSON.stringify(caught.response?.data || 'Transition failed.'));
    } finally {
      setBusy(false);
    }
  };
  const requestProposal = async (mode) => {
    const requestId = ++proposalRequestId.current;
    setAiBusy(true);
    setAiError('');
    setProposal(null);
    try {
      const { data } = await api.post('/projects/admin/improvements/assist/', {
        mode,
        section: mode === 'rewrite' ? aiSection : undefined,
        article: form,
      });
      if (requestId === proposalRequestId.current) {
        setProposal(data.proposal);
        setReviewFlags(data.review_flags || []);
        setProposalBasis(JSON.stringify(form));
      }
    } catch (caught) {
      if (requestId === proposalRequestId.current) {
        setAiError(
          caught.response?.data?.detail ||
            'Project Assistant is unavailable. Continue editing manually.'
        );
      }
    } finally {
      if (requestId === proposalRequestId.current) setAiBusy(false);
    }
  };
  const insertProposal = () => {
    if (!proposal || proposalBasis !== JSON.stringify(form)) return;
    const insertable = Object.fromEntries(
      Object.entries(proposal).filter(([key]) => key in assistedFields)
    );
    setForm((current) => ({ ...current, ...insertable }));
    setProposal(null);
  };
  const assistedFields = {
    public_summary: true,
    public_problem: true,
    public_viewpoint: true,
    public_practical_steps: true,
  };
  const updateProposal = (key, value, index) => setProposal((current) => {
    if (index === undefined) return { ...current, [key]: value };
    const next = [...current[key]];
    next[index] = value;
    return { ...current, [key]: next };
  });
  const applyProposalValue = (key, value) => {
    if (proposalBasis !== JSON.stringify(form)) return;
    set(key, value);
    setProposal(null);
  };
  useEffect(() => {
    updateAssistantContext({
      workspace_mode: 'admin',
      page: 'admin',
      article_id: articleId || null,
      article_title: form.public_title || 'Unsaved Improvement Library draft',
      unsaved_changes: dirty,
      editorial_assistant: {
        form,
        section: aiSection,
        busy: aiBusy,
        error: aiError,
        proposal,
        reviewFlags,
        stale: Boolean(proposal && proposalBasis !== JSON.stringify(form)),
        unsaved: dirty,
      },
    });
  }, [articleId, form, dirty, aiSection, aiBusy, aiError, proposal, proposalBasis, reviewFlags, updateAssistantContext]);
  useEffect(() => {
    const handler = (action) => {
      if (action.type === 'request') requestProposal(action.mode);
      if (action.type === 'section') setAiSection(action.section);
      if (action.type === 'proposal') updateProposal(action.key, action.value, action.index);
      if (action.type === 'apply_value') applyProposalValue(action.key, action.value);
      if (action.type === 'insert') insertProposal();
      if (action.type === 'discard') setProposal(null);
    };
    updateAssistantOnAction(handler);
    return () => updateAssistantOnAction(null);
  }, [aiSection, form, proposal, proposalBasis, updateAssistantOnAction]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main className="min-h-screen bg-[#071b34] p-4 text-white sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[.2em] text-amber-300">
              Admin publishing
            </p>
            <h1 className="mt-2 text-3xl font-black">Improvement Library</h1>
            <p className="mt-2 text-sky-100">
              Write, preview, review, then publish. Editorial changes return an
              article to draft.
            </p>
          </div>
          <Link to="/improvements/" className={buttonClass}>
            View public library
          </Link>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-rose-300 bg-rose-900/40 p-4 text-rose-50"
          >
            {error}
          </p>
        ) : null}
        <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="rounded-2xl border border-white/15 bg-white/5 p-4">
            <h2 className="text-lg font-bold">Articles</h2>
            <label
              className="mt-3 block text-sm font-bold"
              htmlFor="article-status-filter"
            >
              Filter by status
            </label>
            <select
              id="article-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg bg-white p-2 text-slate-950"
            >
              <option value="all">All ({rows.length})</option>
              {['draft', 'ready_for_review', 'published', 'archived'].map(
                (value) => (
                  <option key={value} value={value}>
                    {value.replaceAll('_', ' ')} (
                    {
                      rows.filter((row) => row.publication_status === value)
                        .length
                    }
                    )
                  </option>
                )
              )}
            </select>
            <Link
              to="/app/admin/improvements"
              className="mt-3 block rounded-lg bg-amber-300 px-3 py-2 font-bold text-slate-950"
            >
              + New draft
            </Link>
            <ul className="mt-4 space-y-2">
              {visibleRows.map((row) => (
                <li key={row.id}>
                  <Link
                    to={`/app/admin/improvements/${row.id}`}
                    className={`block rounded-lg border p-3 text-sm hover:bg-white/10 ${String(articleId) === String(row.id) ? 'border-amber-300' : 'border-white/10'}`}
                  >
                    <span className="block font-bold">{row.title}</span>
                    <span className="mt-1 block capitalize text-sky-200">
                      {row.publication_status.replaceAll('_', ' ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {visibleRows.length === 0 ? (
              <p className="mt-4 text-sm text-sky-100">
                No articles in this status.
              </p>
            ) : null}
          </aside>
          <section
            className="rounded-2xl border border-white/15 bg-white/5 p-5 sm:p-8"
            aria-labelledby="editor-heading"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="editor-heading" className="text-2xl font-bold">
                  {articleId ? 'Edit article' : 'Create a draft'}
                </h2>
                <p className="mt-1 text-sky-100">
                  Status:{' '}
                  <strong className="capitalize">
                    {status ? status.replaceAll('_', ' ') : 'New draft'}
                  </strong>
                </p>
                {reviewedById ? (
                  <p className="mt-1 text-sm text-emerald-200">
                    Human review recorded
                  </p>
                ) : null}
              </div>
              {articleId && !dirty ? (
                <Link
                  to={`/app/admin/improvements/preview/${form.public_slug}`}
                  className={buttonClass}
                >
                  Preview design
                </Link>
              ) : articleId ? (
                <span className="text-sm text-amber-200">
                  Save changes before previewing.
                </span>
              ) : null}
            </div>
            <div className="mt-6">
              <ImprovementEditorialAssistant
                form={form}
                section={aiSection}
                busy={aiBusy}
                error={aiError}
                proposal={proposal}
                reviewFlags={reviewFlags}
                stale={Boolean(proposal && proposalBasis !== JSON.stringify(form))}
                showBrief
                onBriefChange={(key, value) =>
                  set('public_editorial_brief', {
                    ...form.public_editorial_brief,
                    [key]: value,
                  })
                }
                onSectionChange={setAiSection}
                onRequest={requestProposal}
                onProposalChange={updateProposal}
                onApplyValue={applyProposalValue}
                onInsert={insertProposal}
                onDiscard={() => setProposal(null)}
              />
            </div>
            <div className="mt-6 grid gap-7">
              {fieldGroups.map(([group, fields]) => (
                <fieldset
                  key={group}
                  className="rounded-xl border border-white/10 p-4"
                >
                  <legend className="px-2 text-lg font-bold text-amber-200">
                    {group}
                  </legend>
                  <div className="grid gap-4">
                    {group === 'Walkthrough video (optional)' ? (
                      <p className="text-sm leading-6 text-sky-100">
                        Add a real video and poster only when ready. A text
                        summary or transcript is required before publication.
                        The section stays hidden until editorial review is
                        recorded; no video is attached to these drafts yet.
                      </p>
                    ) : null}
                    {fields.map(([key, label]) => (
                      <label key={key} className="block">
                        <span className="mb-1 block font-bold text-sky-50">
                          {label}
                        </span>
                        {[
                          'public_problem',
                          'public_evidence',
                          'public_viewpoint',
                          'public_practical_steps',
                          'public_summary',
                          'seo_description',
                          'public_video_description',
                          'public_video_text_summary',
                        ].includes(key) ? (
                          <textarea
                            rows={key === 'public_practical_steps' ? 7 : 4}
                            value={form[key]}
                            onChange={(event) => set(key, event.target.value)}
                            className="w-full rounded-lg border border-slate-500 bg-white p-3 text-slate-950"
                          />
                        ) : (
                          <input
                            type={
                              ['public_evidence_source', 'public_video_url',
                                'public_video_poster_url', 'public_video_transcript_url'].includes(key)
                                ? 'url' : 'text'
                            }
                            value={form[key]}
                            onChange={(event) => set(key, event.target.value)}
                            className="min-h-11 w-full rounded-lg border border-slate-500 bg-white p-3 text-slate-950"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <fieldset className="rounded-xl border border-white/10 p-4">
                <legend className="px-2 text-lg font-bold text-amber-200">Audiences and final actions</legend>
                <p className="mb-3 text-sm text-sky-100">Select at least one audience. Each role can have its own final action.</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {audiences.map(([value, label]) => {
                    const checked = form.public_audiences.includes(value);
                    return (
                      <div key={value} className="rounded-lg border border-white/10 p-3">
                        <label className="flex items-center gap-3 font-bold">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...form.public_audiences, value]
                                : form.public_audiences.filter((item) => item !== value);
                              const nextActions = { ...form.public_audience_actions };
                              if (event.target.checked) nextActions[value] = nextActions[value] || (value === 'contractor' ? 'sign_up' : 'create_project');
                              else delete nextActions[value];
                              setForm((current) => ({
                                ...current,
                                public_audiences: next,
                                public_audience: next[0] || current.public_audience,
                                public_audience_actions: nextActions,
                                public_next_action: nextActions[next[0]] || current.public_next_action,
                              }));
                            }}
                          />
                          {label}
                        </label>
                        {checked ? (
                          <label className="mt-3 block text-sm font-bold">
                            Final action
                            <select
                              value={form.public_audience_actions[value] || 'create_project'}
                              onChange={(event) => set('public_audience_actions', {
                                ...form.public_audience_actions,
                                [value]: event.target.value,
                              })}
                              className="mt-1 min-h-11 w-full rounded-lg bg-white p-2 text-slate-950"
                            >
                              <option value="sign_up">Sign up</option>
                              <option value="create_project">Create a project</option>
                              <option value="request_help">Request help</option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {!form.public_audiences.length ? <p role="alert" className="mt-3 text-rose-200">Select at least one audience.</p> : null}
              </fieldset>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.is_featured_public}
                  onChange={(event) =>
                    set('is_featured_public', event.target.checked)
                  }
                />
                Feature this article first after publication
              </label>
              <fieldset className="rounded-xl border border-white/10 p-4">
                <legend className="px-2 text-lg font-bold text-amber-200">
                  Related articles
                </legend>
                <p className="mb-3 text-sm text-sky-100">
                  Select the guides to recommend after this article. Only
                  published guides appear on the public page.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {rows
                    .filter((row) => String(row.id) !== String(articleId))
                    .map((row) => (
                      <label key={row.id} className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={form.related_ids.includes(row.id)}
                          onChange={(event) =>
                            set(
                              'related_ids',
                              event.target.checked
                                ? [...form.related_ids, row.id]
                                : form.related_ids.filter((id) => id !== row.id)
                            )
                          }
                        />
                        <span>{row.title}</span>
                      </label>
                    ))}
                </div>
              </fieldset>
            </div>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy || (Boolean(articleId) && !dirty)}
                onClick={save}
                className="min-h-11 rounded-xl bg-amber-300 px-5 font-extrabold text-slate-950 disabled:opacity-50"
              >
                Save draft
              </button>
              {articleId && status === 'draft' ? (
                <button
                  type="button"
                  disabled={busy || dirty}
                  onClick={() => transition('submit')}
                  className={buttonClass}
                >
                  Submit for review
                </button>
              ) : null}
              {articleId && status === 'ready_for_review' && !reviewedById ? (
                <button
                  type="button"
                  disabled={busy || dirty}
                  onClick={() => transition('review')}
                  className={buttonClass}
                >
                  Record review
                </button>
              ) : null}
              {articleId && status === 'ready_for_review' && reviewedById ? (
                <button
                  type="button"
                  disabled={busy || dirty}
                  onClick={() => transition('publish')}
                  className={buttonClass}
                >
                  Publish reviewed article
                </button>
              ) : null}
              {articleId && status === 'published' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => transition('withdraw')}
                  className={buttonClass}
                >
                  Withdraw to draft
                </button>
              ) : null}
            </div>
            <p className="mt-4 text-sm text-sky-100">
              Publishing requires all editorial fields, an evidence source, SEO
              description, and a recorded review. Preview is staff-only and
              never indexed.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
