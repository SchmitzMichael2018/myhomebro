import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api';

const base = '/projects/admin/improvements/';
const empty = {
  name: '', public_title: '', public_slug: '', public_category_slug: '',
  public_summary: '', public_intro: '', default_scope: '', difficulty: '',
  estimated_duration_min_days: '', estimated_duration_max_days: '',
  cost_guidance: '', tools_guidance: '', preparation: '', safety_guidance: '',
  common_mistakes: '', diy_guidance: '', pro_guidance: '', seo_title: '',
  seo_description: '', social_image: '', is_featured_public: false,
  public_faqs: [],
};

const fields = [
  ['name', 'Working title', 'text', true],
  ['public_title', 'Public headline', 'text'],
  ['public_slug', 'URL slug', 'text', true],
  ['public_category_slug', 'Category slug', 'text', true],
  ['public_summary', 'Card summary', 'textarea', true],
  ['public_intro', 'Introduction', 'textarea', true],
  ['default_scope', 'Scope of work', 'textarea'],
  ['preparation', 'Preparation', 'textarea'],
  ['safety_guidance', 'Safety considerations', 'textarea'],
  ['tools_guidance', 'Tools to plan for', 'textarea'],
  ['cost_guidance', 'Cost considerations', 'textarea'],
  ['common_mistakes', 'Common issues to avoid', 'textarea'],
  ['diy_guidance', 'DIY guidance', 'textarea'],
  ['pro_guidance', 'When to get professional help', 'textarea'],
  ['estimated_duration_min_days', 'Minimum days', 'number'],
  ['estimated_duration_max_days', 'Maximum days', 'number'],
  ['seo_title', 'Search title (70 characters max)', 'text'],
  ['seo_description', 'Search description (170 characters max)', 'textarea', true],
  ['social_image', 'Approved social PNG path', 'text'],
];

function errorMessage(error) {
  const data = error?.response?.data;
  if (typeof data?.detail === 'string') return data.detail;
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([field, value]) => `${field}: ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ');
  }
  return 'The guide could not be saved. Please try again.';
}

function formValues(item) {
  return { ...empty, ...item,
    estimated_duration_min_days: item?.estimated_duration_min_days ?? '',
    estimated_duration_max_days: item?.estimated_duration_max_days ?? '',
    public_faqs: item?.public_faqs || [],
  };
}

const inputStyle = 'mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500';
const buttonStyle = 'min-h-11 rounded-xl border border-white/25 px-4 py-2 font-semibold text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';

export default function AdminImprovementLibraryPage() {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(formValues(empty));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    api.get(base).then(({ data }) => { if (mounted) setItems(data.results || []); })
      .catch((err) => { if (mounted) setError(errorMessage(err)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const choose = (item) => {
    setSelected(item);
    setForm(formValues(item || empty));
    setMessage(''); setError('');
  };

  const sync = (item) => {
    setItems((previous) => [item, ...previous.filter((row) => row.id !== item.id)]);
    choose(item);
  };

  const save = async (event) => {
    event.preventDefault();
    setError(''); setMessage(''); setBusy(true);
    const payload = { ...form, public_faqs: form.public_faqs,
      estimated_duration_min_days: form.estimated_duration_min_days === '' ? null : Number(form.estimated_duration_min_days),
      estimated_duration_max_days: form.estimated_duration_max_days === '' ? null : Number(form.estimated_duration_max_days),
    };
    try {
      const { data } = selected
        ? await api.patch(`${base}${selected.id}/`, payload)
        : await api.post(base, payload);
      sync(data); setMessage('Draft saved. Review it before publishing.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const transition = async (action) => {
    if (!selected || busy) return;
    if (action === 'publish' && !window.confirm('I have reviewed this guide and want to publish it publicly now. Continue?')) return;
    if (action === 'archive' && !window.confirm('Remove this guide from the public library? Continue?')) return;
    setError(''); setMessage(''); setBusy(true);
    try {
      const { data } = await api.post(`${base}${selected.id}/transition/`, {
        action, confirmed: action === 'publish',
      });
      sync(data);
      setMessage(action === 'publish' ? 'Guide published.' : action === 'archive' ? 'Guide removed from public view.' : 'Status updated.');
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const status = selected?.status || 'new draft';
  const isLive = status === 'published';
  return (
    <div className="mx-auto max-w-7xl space-y-7 px-4 py-8 text-white sm:px-6" data-testid="admin-improvement-library">
      <header>
        <p className="text-sm font-bold uppercase tracking-widest text-amber-300">Content &amp; discovery</p>
        <h1 className="mt-2 text-3xl font-bold">Improvement Library</h1>
        <p className="mt-3 max-w-3xl text-sky-100/75">Write project guidance, check its public preview, and explicitly publish reviewed guides. Your agreement templates remain separate.</p>
        <Link className="mt-3 inline-block text-sky-200 underline underline-offset-4" to="/improvements/">View public library</Link>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-300/50 bg-red-900/40 p-4">{error}</p>}
      {message && <p role="status" className="rounded-xl border border-emerald-300/50 bg-emerald-900/30 p-4">{message}</p>}
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-white/15 bg-white/5 p-4">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-bold">Guides</h2><button type="button" className={buttonStyle} onClick={() => choose(null)}>New guide</button></div>
          <p className="mt-2 text-sm text-sky-100/70">Only guides created for public publication appear here.</p>
          {loading ? <p className="mt-5">Loading guides…</p> : items.length ? (
            <ul className="mt-5 space-y-2">{items.map((item) => (
              <li key={item.id}><button type="button" onClick={() => choose(item)} aria-current={selected?.id === item.id ? 'true' : undefined} className={`w-full rounded-xl border p-3 text-left hover:border-amber-300 ${selected?.id === item.id ? 'border-amber-300 bg-slate-800' : 'border-white/15'}`}><span className="block font-bold">{item.public_title || item.name}</span><span className="mt-1 block text-sm text-sky-100/75">{item.status.replaceAll('_', ' ')}</span></button></li>
            ))}</ul>
          ) : <p className="mt-5 text-sm text-sky-100/75">No editorial guides yet. Create a draft to begin.</p>}
        </aside>
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/15 bg-white/5 p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-bold">{selected ? 'Edit guide' : 'Create a guide'}</h2><span className="rounded-full border border-amber-300/50 px-3 py-1 text-sm font-bold text-amber-200">{status.replaceAll('_', ' ')}</span></div>
            <p className="mt-3 text-sm text-sky-100/70">Save first, then mark ready for review. Published guides must be archived before editing; archiving removes them from public view.</p>
            <form onSubmit={save} className="mt-6 grid gap-5 sm:grid-cols-2">
              {fields.map(([key, label, type, required]) => (
                <label key={key} className={`block text-sm font-semibold ${type === 'textarea' ? 'sm:col-span-2' : ''}`}>{label}{required && <span className="text-amber-300"> *</span>}
                  {type === 'textarea' ? <textarea rows={key === 'public_intro' ? 5 : 3} className={inputStyle} value={form[key] ?? ''} onChange={(event) => setForm({ ...form, [key]: event.target.value })} disabled={isLive || busy || (selected?.contractor_template_visible && key === 'default_scope')} required={required} /> : <input type={type} min={type === 'number' ? 1 : undefined} max={type === 'number' ? 3650 : undefined} className={inputStyle} value={form[key] ?? ''} onChange={(event) => setForm({ ...form, [key]: event.target.value })} disabled={isLive || busy || (selected?.contractor_template_visible && key === 'name')} required={required} />}
                </label>
              ))}
              <label className="block text-sm font-semibold">Difficulty<select className={inputStyle} value={form.difficulty} onChange={(event) => setForm({ ...form, difficulty: event.target.value })} disabled={isLive || busy}><option value="">Not specified</option><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="professional">Professional recommended</option></select></label>
              <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={form.is_featured_public} onChange={(event) => setForm({ ...form, is_featured_public: event.target.checked })} disabled={isLive || busy} /> Feature this guide</label>
              <div className="sm:col-span-2">
                <div className="flex items-center justify-between gap-3"><h3 className="font-bold">Frequently asked questions</h3><button type="button" className={buttonStyle} disabled={isLive || busy} onClick={() => setForm({ ...form, public_faqs: [...form.public_faqs, { question: '', answer: '' }] })}>Add question</button></div>
                <div className="mt-3 space-y-4">{form.public_faqs.map((faq, index) => (
                  <div key={index} className="rounded-xl border border-white/20 p-4">
                    {['question', 'answer'].map((field) => <label key={field} className="mt-3 block text-sm font-semibold">{field === 'question' ? 'Question' : 'Answer'}<textarea rows={field === 'question' ? 2 : 3} className={inputStyle} value={faq[field] || ''} disabled={isLive || busy} onChange={(event) => setForm({ ...form, public_faqs: form.public_faqs.map((row, position) => position === index ? { ...row, [field]: event.target.value } : row) })} /></label>)}
                    <button type="button" className="mt-3 text-sm font-semibold text-amber-200 underline" disabled={isLive || busy} onClick={() => setForm({ ...form, public_faqs: form.public_faqs.filter((_, position) => position !== index) })}>Remove question</button>
                  </div>
                ))}</div>
              </div>
              <div className="sm:col-span-2"><button type="submit" disabled={isLive || busy} className="min-h-12 rounded-xl bg-amber-300 px-6 py-3 font-bold text-slate-950 hover:bg-amber-200 disabled:opacity-50">{selected ? 'Save changes' : 'Create draft'}</button></div>
            </form>
          </div>
          {selected && <div className="rounded-2xl border border-white/15 bg-white/5 p-5 sm:p-7">
            <h2 className="text-xl font-bold">Preview and publication</h2>
            <p className="mt-2 text-sm text-sky-100/75">This preview shows saved editorial content. The public URL works only while the guide is published.</p>
            <article className="mt-5 space-y-5 rounded-2xl bg-white p-6 text-slate-950"><div><p className="text-sm font-bold uppercase tracking-widest text-blue-700">{selected.public_category_slug?.replaceAll('-', ' ') || 'Uncategorized'}</p><h3 className="mt-3 text-2xl font-bold">{selected.public_title || selected.name}</h3><p className="mt-3 text-slate-600">{selected.public_summary || 'Add a short summary.'}</p><p className="mt-4 whitespace-pre-line text-slate-700">{selected.public_intro || 'Add your guide introduction.'}</p></div>
              {[
                ['Scope of work', 'default_scope'], ['Preparation', 'preparation'],
                ['Safety considerations', 'safety_guidance'], ['Tools', 'tools_guidance'],
                ['Cost', 'cost_guidance'], ['Common issues', 'common_mistakes'],
                ['DIY guidance', 'diy_guidance'], ['Professional help', 'pro_guidance'],
              ].filter(([, key]) => selected[key]).map(([title, key]) => <section key={key}><h4 className="font-bold">{title}</h4><p className="mt-1 whitespace-pre-line text-slate-700">{selected[key]}</p></section>)}
              {selected.public_faqs?.length > 0 && <section><h4 className="font-bold">Questions and answers</h4>{selected.public_faqs.map((faq, index) => <div key={index} className="mt-3"><p className="font-semibold">{faq.question}</p><p className="text-slate-700">{faq.answer}</p></div>)}</section>}
              {selected.public_preview?.materials && <section><h4 className="font-bold">Materials</h4><p className="mt-1 text-slate-700">{selected.public_preview.materials}</p></section>}
              {selected.public_preview?.milestones?.length > 0 && <section><h4 className="font-bold">Template milestones</h4><ol className="mt-2 list-inside list-decimal space-y-2">{selected.public_preview.milestones.map((step) => <li key={step.id}>{step.title}: {step.description}</li>)}</ol></section>}
              <section className="border-t border-slate-200 pt-4 text-sm"><h4 className="font-bold">Search preview</h4><p className="mt-2 text-blue-700">{selected.seo_title || `${selected.public_title || selected.name}: DIY & Project Guide | MyHomeBro`}</p><p className="text-slate-600">{selected.seo_description || 'Add a search description.'}</p></section>
            </article>
            <div className="mt-5 flex flex-wrap gap-3">
              {(status === 'draft' || status === 'archived') && <button type="button" className={buttonStyle} disabled={busy} onClick={() => transition('request_review')}>Ready for review</button>}
              {status === 'ready_for_review' && <><button type="button" className={buttonStyle} disabled={busy} onClick={() => transition('return_to_draft')}>Return to draft</button><button type="button" className="min-h-11 rounded-xl bg-amber-300 px-5 font-bold text-slate-950 disabled:opacity-50" disabled={busy} onClick={() => transition('publish')}>Review and publish</button></>}
              {isLive && <><a className={buttonStyle} href={selected.public_url} target="_blank" rel="noreferrer">View published guide</a><button type="button" className={buttonStyle} disabled={busy} onClick={() => transition('archive')}>Archive guide</button></>}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}
