import React from 'react';

const buttonClass =
  'min-h-11 rounded-xl border border-current/20 bg-white/10 px-4 py-2 font-bold hover:bg-white/20 disabled:opacity-50';

export const assistedArticleFields = {
  public_summary: 'Short summary',
  public_problem: 'Problem',
  public_viewpoint: 'Our take',
  public_practical_steps: 'Practical steps',
};

const briefFields = [
  ['idea', 'Article idea'],
  ['problem', 'Problem to solve'],
  ['readers', 'Intended readers'],
  ['viewpoint', 'MyHomeBro viewpoint'],
  ['desired_action', 'Desired reader action'],
  ['sources', 'Staff-supplied sources'],
];

export default function ImprovementEditorialAssistant({
  form,
  section,
  busy,
  error,
  proposal,
  reviewFlags = [],
  stale = false,
  unsaved = false,
  showBrief = false,
  onBriefChange,
  onSectionChange,
  onRequest,
  onProposalChange,
  onApplyValue,
  onInsert,
  onDiscard,
}) {
  const selectedIsEmpty = !String(form?.[section] || '').trim();
  const directSuggestions = proposal?.article_titles || proposal?.seo_titles;
  const insertable = proposal && Object.keys(proposal).some((key) => assistedArticleFields[key]);

  return (
    <section
      className="rounded-xl border border-sky-300/40 bg-sky-950/60 p-4 text-white"
      aria-labelledby="editor-assistant-title"
      data-testid="improvement-editorial-assistant"
    >
      <h3 id="editor-assistant-title" className="text-lg font-bold">
        Project Assistant writing help
      </h3>
      <p className="mt-2 text-sm text-sky-100">
        Proposals are advisory and unsaved. Evidence, source links, numerical claims,
        titles, and publication stay under staff control.
      </p>
      {unsaved ? (
        <p className="mt-2 rounded-lg border border-amber-200/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          Unsaved editor state is included in this writing context.
        </p>
      ) : null}
      {showBrief ? (
        <fieldset className="mt-5 rounded-xl border border-white/15 p-4">
          <legend className="px-2 font-bold text-amber-200">Optional article brief</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {briefFields.map(([key, label]) => (
              <label key={key} className="block text-sm font-bold">
                {label}
                <textarea
                  rows={key === 'sources' ? 3 : 2}
                  value={form.public_editorial_brief?.[key] || ''}
                  onChange={(event) => onBriefChange?.(key, event.target.value)}
                  className="mt-1 w-full rounded-lg bg-white p-3 font-normal text-slate-950"
                />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <button type="button" className={buttonClass} disabled={busy} onClick={() => onRequest('titles')}>
          Suggest titles
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => onRequest('outline')}>
          Outline this article
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => onRequest('draft')}>
          Draft article sections
        </button>
        <label className="text-sm font-bold">
          Section
          <select
            value={section}
            onChange={(event) => onSectionChange(event.target.value)}
            className="mt-1 block min-h-11 rounded-lg bg-white p-2 text-slate-950"
          >
            {Object.entries(assistedArticleFields).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => onRequest('rewrite')}>
          {selectedIsEmpty ? 'Create selected section' : 'Rewrite selected section'}
        </button>
      </div>
      {busy ? <p role="status" className="mt-4">Preparing a proposal…</p> : null}
      {error ? <p role="alert" className="mt-4 text-rose-200">{error}</p> : null}
      {proposal ? (
        <div className="mt-5 rounded-xl border border-amber-200/40 bg-slate-900/70 p-4" data-testid="editorial-ai-proposal">
          <h4 className="font-bold text-amber-200">Review the proposal</h4>
          <p className="mt-1 text-sm text-sky-100">
            Edit or reject every suggestion. Applying text changes only this unsaved editor state.
          </p>
          {Object.entries(proposal).map(([key, value]) => (
            <div key={key} className="mt-4">
              {Array.isArray(value) ? (
                <>
                  <p className="font-bold">{key === 'article_titles' ? 'Article titles' : 'SEO titles'}</p>
                  <div className="mt-2 space-y-3">
                    {value.map((suggestion, index) => (
                      <div key={`${key}-${index}`} className="flex flex-col gap-2 sm:flex-row">
                        <input
                          value={suggestion}
                          onChange={(event) => onProposalChange(key, event.target.value, index)}
                          className="min-h-11 flex-1 rounded-lg bg-white p-3 text-slate-950"
                        />
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={stale}
                          onClick={() => onApplyValue(key === 'article_titles' ? 'public_title' : 'seo_title', suggestion)}
                        >
                          Use suggestion
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <label className="block font-bold">
                  {assistedArticleFields[key] || (key === 'editorial_outline' ? 'Article outline' : key)}
                  <textarea
                    rows={key === 'public_practical_steps' || key === 'editorial_outline' ? 8 : 4}
                    value={value}
                    onChange={(event) => onProposalChange(key, event.target.value)}
                    className="mt-1 w-full rounded-lg bg-white p-3 font-normal text-slate-950"
                  />
                </label>
              )}
            </div>
          ))}
          {reviewFlags.map((flag) => (
            <p key={flag} role="alert" className="mt-3 rounded-lg bg-amber-950/70 p-3 text-sm text-amber-100">
              Review flag: {flag}
            </p>
          ))}
          {stale ? <p className="mt-3 text-sm text-amber-200">The article changed after this proposal. Generate a fresh proposal before applying it.</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            {insertable && !directSuggestions ? (
              <button type="button" onClick={onInsert} disabled={stale} className="min-h-11 rounded-xl bg-amber-300 px-4 font-bold text-slate-950 disabled:opacity-50">
                Insert into editor
              </button>
            ) : null}
            <button type="button" onClick={onDiscard} className={buttonClass}>Discard proposal</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
