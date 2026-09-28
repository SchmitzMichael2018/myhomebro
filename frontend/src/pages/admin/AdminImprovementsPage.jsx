import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../api';

const initial = {
  public_title: '',
  public_slug: '',
  public_category_slug: 'contractor-practice',
  public_audience: 'contractor',
  public_summary: '',
  public_problem: '',
  public_evidence: '',
  public_evidence_source: '',
  public_viewpoint: '',
  public_practical_steps: '',
  public_next_action: 'sign_up',
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
];
const buttonClass =
  'min-h-11 rounded-xl border border-white/20 bg-white/10 px-4 py-2 font-bold text-white hover:bg-white/20 disabled:opacity-50';

export default function AdminImprovementsPage() {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      const { data } = await api.get('/projects/admin/improvements/');
      setRows(data.results);
      if (articleId) {
        const current = data.results.find(
          (row) => String(row.id) === String(articleId)
        );
        if (current) {
          setForm(
            Object.fromEntries(
              Object.keys(initial).map((key) => [
                key,
                current[key] ?? initial[key],
              ])
            )
          );
          setStatus(current.publication_status);
        } else setError('Article not found.');
      }
    } catch {
      setError('Could not load the editorial library.');
    }
  };
  useEffect(() => {
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
      await load();
    } catch (caught) {
      setError(JSON.stringify(caught.response?.data || 'Transition failed.'));
    } finally {
      setBusy(false);
    }
  };
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
            <Link
              to="/app/admin/improvements"
              className="mt-3 block rounded-lg bg-amber-300 px-3 py-2 font-bold text-slate-950"
            >
              + New draft
            </Link>
            <ul className="mt-4 space-y-2">
              {rows.map((row) => (
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
              </div>
              {articleId ? (
                <Link
                  to={`/app/admin/improvements/preview/${form.public_slug}`}
                  className={buttonClass}
                >
                  Preview design
                </Link>
              ) : null}
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
                              key === 'public_evidence_source' ? 'url' : 'text'
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
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1 block font-bold">Audience</span>
                  <select
                    value={form.public_audience}
                    onChange={(event) =>
                      set('public_audience', event.target.value)
                    }
                    className="min-h-11 w-full rounded-lg bg-white p-2 text-slate-950"
                  >
                    <option value="contractor">Contractors</option>
                    <option value="homeowner">Homeowners</option>
                    <option value="property_manager">Property Managers</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1 block font-bold">5. Next action</span>
                  <select
                    value={form.public_next_action}
                    onChange={(event) =>
                      set('public_next_action', event.target.value)
                    }
                    className="min-h-11 w-full rounded-lg bg-white p-2 text-slate-950"
                  >
                    <option value="sign_up">Sign up</option>
                    <option value="create_project">Create a project</option>
                    <option value="request_help">Request help</option>
                  </select>
                </label>
              </div>
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
                  Select the guides to recommend after this article. Only published
                  guides appear on the public page.
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
                disabled={busy}
                onClick={save}
                className="min-h-11 rounded-xl bg-amber-300 px-5 font-extrabold text-slate-950 disabled:opacity-50"
              >
                Save draft
              </button>
              {articleId && status === 'draft' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => transition('submit')}
                  className={buttonClass}
                >
                  Submit for review
                </button>
              ) : null}
              {articleId && status === 'ready_for_review' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => transition('review')}
                  className={buttonClass}
                >
                  Record review
                </button>
              ) : null}
              {articleId && status === 'ready_for_review' ? (
                <button
                  type="button"
                  disabled={busy}
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
