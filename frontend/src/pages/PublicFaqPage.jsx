import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ExternalLink, Search, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import logo from '../assets/myhomebro_logo.png';
import {
  buildPublicFaqJsonLd,
  filterPublicFaqItems,
  PUBLIC_FAQ_CATEGORIES,
  PUBLIC_FAQ_ITEMS,
} from '../lib/publicFaq.js';

const AUDIENCES = [
  { id: 'all', label: 'Everyone' },
  { id: 'customer', label: 'Homeowners' },
  { id: 'contractor', label: 'Contractors' },
];

function questionFromHash(hash) {
  return decodeURIComponent(String(hash || '').replace(/^#/, ''));
}

export default function PublicFaqPage() {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState('all');
  const [category, setCategory] = useState('all');
  const [openItemId, setOpenItemId] = useState(() =>
    questionFromHash(location.hash)
  );

  const filteredItems = useMemo(
    () => filterPublicFaqItems({ query, audience, category }),
    [query, audience, category]
  );

  const groupedItems = useMemo(
    () =>
      PUBLIC_FAQ_CATEGORIES.map((group) => ({
        ...group,
        items: filteredItems.filter((item) => item.categoryId === group.id),
      })).filter((group) => group.items.length),
    [filteredItems]
  );

  useEffect(() => {
    document.title = 'Frequently Asked Questions | MyHomeBro';
    let description = document.querySelector('meta[name="description"]');
    const created = !description;
    if (!description) {
      description = document.createElement('meta');
      description.name = 'description';
      document.head.appendChild(description);
    }
    const previous = description.content;
    description.content =
      'Clear answers about MyHomeBro projects, contractors, payments, refunds, disputes, AI assistance, privacy, and records.';
    return () => {
      document.title = 'MyHomeBro - Secure Escrow Payments';
      if (created) description.remove();
      else description.content = previous;
    };
  }, []);

  useEffect(() => {
    const hashItem = questionFromHash(location.hash);
    if (!hashItem || !PUBLIC_FAQ_ITEMS.some((item) => item.id === hashItem))
      return;
    setOpenItemId(hashItem);
    requestAnimationFrame(() =>
      document.getElementById(hashItem)?.scrollIntoView({ block: 'center' })
    );
  }, [location.hash]);

  const toggleQuestion = (itemId) => {
    const next = openItemId === itemId ? '' : itemId;
    setOpenItemId(next);
    const nextUrl = `${location.pathname}${location.search}${next ? `#${next}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  };

  const clearFilters = () => {
    setQuery('');
    setAudience('all');
    setCategory('all');
  };

  const jsonLd = JSON.stringify(buildPublicFaqJsonLd(PUBLIC_FAQ_ITEMS)).replace(
    /</g,
    '\\u003c'
  );

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_50%_8%,rgba(37,99,235,0.22),transparent_28%),linear-gradient(135deg,#020617_0%,#061d3d_50%,#0f172a_100%)] text-white">
      <script
        type="application/ld+json"
        data-testid="faq-jsonld"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/90 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <img
              src={logo}
              alt="MyHomeBro"
              className="h-10 w-10 rounded-xl object-cover"
            />
            <span className="text-xl font-bold tracking-tight">
              MyHome<span className="text-amber-300">Bro</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="hidden min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-white/5 sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Home
            </Link>
            <Link
              to="/start-project"
              className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Start a Project
            </Link>
          </div>
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        <section className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">
            Help Center
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
            Frequently Asked Questions
          </h1>
          <p className="mt-4 text-base leading-7 text-sky-50/72 sm:text-lg">
            Clear answers about getting started, project workflows, payments,
            refunds, disputes, AI assistance, and privacy.
          </p>
        </section>

        <section
          aria-label="Search and filter FAQs"
          className="mt-8 rounded-3xl border border-white/12 bg-slate-950/45 p-4 shadow-2xl shadow-slate-950/20 sm:p-6"
        >
          <label
            htmlFor="faq-search"
            className="text-sm font-semibold text-sky-100"
          >
            Search questions
          </label>
          <div className="relative mt-2">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-sky-300"
              aria-hidden="true"
            />
            <input
              id="faq-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try “refund,” “invoice,” “dispute,” or “employee”"
              className="min-h-12 w-full rounded-xl border border-slate-600 bg-slate-900 pl-12 pr-4 text-base text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/25"
            />
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Show answers for
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {AUDIENCES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={audience === item.id}
                    onClick={() => setAudience(item.id)}
                    className={`min-h-11 rounded-full border px-4 py-2 text-sm font-semibold ${audience === item.id ? 'border-sky-300 bg-blue-600 text-white' : 'border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-400'}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="text-sm font-semibold text-sky-100 lg:min-w-72">
              Category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-white focus:border-sky-400 focus:outline-none"
              >
                <option value="all">All categories</option>
                {PUBLIC_FAQ_CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-1 rounded-2xl border border-white/10 bg-slate-950/35 p-3">
              <button
                type="button"
                onClick={() => setCategory('all')}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold ${category === 'all' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/5'}`}
              >
                All categories
              </button>
              {PUBLIC_FAQ_CATEGORIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold ${category === item.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-white/5'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </aside>

          <section
            aria-live="polite"
            aria-label="FAQ results"
            className="min-w-0"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-300">
                <span className="font-semibold text-white">
                  {filteredItems.length}
                </span>{' '}
                {filteredItems.length === 1 ? 'answer' : 'answers'}
              </p>
              {query || audience !== 'all' || category !== 'all' ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
                >
                  <X className="h-4 w-4" aria-hidden="true" /> Clear filters
                </button>
              ) : null}
            </div>

            {groupedItems.length ? (
              groupedItems.map((group) => (
                <section
                  key={group.id}
                  className="mb-8"
                  aria-labelledby={`faq-category-${group.id}`}
                >
                  <h2
                    id={`faq-category-${group.id}`}
                    className="mb-3 border-l-2 border-amber-300 pl-3 text-sm font-semibold uppercase tracking-[0.16em] text-sky-200"
                  >
                    {group.label}
                  </h2>
                  <div className="space-y-3">
                    {group.items.map((item) => {
                      const open = openItemId === item.id;
                      return (
                        <article
                          id={item.id}
                          key={item.id}
                          className={`scroll-mt-28 overflow-hidden rounded-2xl border ${open ? 'border-sky-500 bg-slate-900' : 'border-white/10 bg-slate-950/35'}`}
                        >
                          <div className="flex items-stretch">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-controls={`answer-${item.id}`}
                              onClick={() => toggleQuestion(item.id)}
                              className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-left font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 sm:px-5"
                            >
                              <span>{item.question}</span>
                              <ChevronDown
                                className={`h-5 w-5 shrink-0 text-sky-300 transition-transform ${open ? 'rotate-180 text-amber-300' : ''}`}
                                aria-hidden="true"
                              />
                            </button>
                            <a
                              href={`#${item.id}`}
                              onClick={() => setOpenItemId(item.id)}
                              aria-label={`Direct link to ${item.question}`}
                              title="Link to this answer"
                              className="flex w-12 shrink-0 items-center justify-center border-l border-white/10 text-slate-400 hover:bg-white/5 hover:text-sky-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
                            >
                              <ExternalLink
                                className="h-4 w-4"
                                aria-hidden="true"
                              />
                            </a>
                          </div>
                          <div
                            id={`answer-${item.id}`}
                            hidden={!open}
                            className="border-t border-white/10 px-4 py-4 text-sm leading-7 text-slate-300 sm:px-5 sm:text-base"
                          >
                            {item.answer}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-950/35 p-8 text-center">
                <h2 className="text-xl font-semibold">No matching questions</h2>
                <p className="mt-2 text-slate-300">
                  Try a broader search or clear the filters.
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 min-h-11 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Clear filters
                </button>
              </div>
            )}
          </section>
        </div>

        <section className="mt-10 rounded-3xl border border-amber-300/25 bg-amber-300/8 p-6 text-center sm:p-8">
          <h2 className="text-2xl font-semibold">Still need help?</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-sky-50/72">
            Open your authenticated Support workspace for an account-specific
            question, or start a project if you are ready to describe the work
            you need.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              to="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-sky-400 bg-slate-950/45 px-4 py-2 text-sm font-semibold text-sky-100"
            >
              Log In for Support
            </Link>
            <Link
              to="/start-project"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Start a Project
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-sky-50/62">
        <div>&copy; {new Date().getFullYear()} MyHomeBro</div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 font-semibold">
          <Link to="/faq" className="text-sky-300">
            FAQs
          </Link>
          <Link to="/legal/terms-of-service/" className="text-sky-300">
            Terms of Service
          </Link>
          <Link to="/legal/privacy-policy/" className="text-sky-300">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}
