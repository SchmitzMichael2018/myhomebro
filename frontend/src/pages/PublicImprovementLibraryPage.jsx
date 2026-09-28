import React, { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, ClipboardList, Search, Wrench } from 'lucide-react';
import { Link } from 'react-router-dom';

import { applySeoMetadata, SITE_ORIGIN } from '../lib/seoMetadata.js';
import logo from '../assets/myhomebro_logo.png';

export default function PublicImprovementLibraryPage() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState({ categories: [], improvements: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          setLoading(true);
          setError(false);
          const response = await fetch(
            `/api/projects/public/improvements/${query ? `?q=${encodeURIComponent(query)}` : ''}`,
            { signal: controller.signal }
          );
          if (!response.ok) throw new Error('Library unavailable');
          const value = await response.json();
          setData(value);
          applySeoMetadata(window.location.pathname, {
            title: 'Home Improvement Projects & DIY Guides | MyHomeBro',
            description:
              'Explore home project guides, understand the work, and decide whether to DIY or get contractor help with MyHomeBro.',
            socialDescription:
              'Plan a home project, understand the work, and choose whether to DIY or get contractor help.',
            canonicalUrl: `${SITE_ORIGIN}/improvements/`,
            robots: value.improvements.length
              ? 'index, follow'
              : 'noindex, follow',
          });
        } catch {
          if (!controller.signal.aborted) setError(true);
        } finally {
          setLoading(false);
        }
      },
      query ? 180 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <LibraryShell>
      <section className="bg-[radial-gradient(circle_at_75%_20%,rgba(37,99,235,.25),transparent_40%),linear-gradient(145deg,#082044,#020617)] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.3fr_.7fr] md:items-center md:py-20">
        <div>
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-300">
          MyHomeBro Improvement Library
        </p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">
          Plan your next home project.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-200">
          Explore practical project guidance as guides are published. You can start planning a DIY project now, save the details, and choose when to ask a contractor for help.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/start-project" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-300 px-6 py-3 font-bold text-slate-950 hover:bg-amber-200">Start a project <ArrowRight size={18} aria-hidden="true" /></Link>
          <Link to="/san-antonio/" className="inline-flex min-h-12 items-center rounded-xl border border-white/35 px-6 py-3 font-bold hover:bg-white/10">Explore San Antonio</Link>
        </div>
        </div>
        <aside className="rounded-3xl border border-sky-200/20 bg-white/5 p-7" aria-label="How MyHomeBro helps">
          <BookOpen className="text-amber-300" size={30} aria-hidden="true" />
          <h2 className="mt-4 text-xl font-bold">From idea to completed work</h2>
          <ul className="mt-5 space-y-4 text-sm leading-6 text-slate-200">
            <li className="flex gap-3"><ClipboardList className="mt-1 shrink-0 text-sky-300" size={18} aria-hidden="true" /> Record your plan, scope, and progress.</li>
            <li className="flex gap-3"><Wrench className="mt-1 shrink-0 text-sky-300" size={18} aria-hidden="true" /> Do what you can yourself and invite help when needed.</li>
            <li className="flex gap-3"><BookOpen className="mt-1 shrink-0 text-sky-300" size={18} aria-hidden="true" /> Keep project and maintenance records together.</li>
          </ul>
        </aside>
        </div>
      </section>
      {(data.categories.length > 0 || query || loading) && <div className="mx-auto max-w-6xl px-5 pt-12 sm:px-6">
        <label className="relative block max-w-2xl text-left">
          <span className="sr-only">Search published improvements</span>
          <Search
            className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            data-testid="improvement-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects, rooms, or types of work"
            className="min-h-14 w-full rounded-2xl border border-slate-300 bg-white pl-12 pr-4 text-base shadow-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </label>
      </div>}

      {!query && data.categories.length ? (
        <section
          className="mx-auto max-w-6xl px-4 pb-8 sm:px-6"
          aria-labelledby="categories-heading"
        >
          <h2
            id="categories-heading"
            className="text-2xl font-bold text-slate-950"
          >
            Browse by category
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.categories.map((category) => (
              <Link
                key={category.slug}
                to={`/improvements/${category.slug}/`}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
              >
                <span className="text-lg font-bold text-slate-950">
                  {category.name}
                </span>
                <span className="mt-1 block text-sm text-slate-500">
                  {category.count} published{' '}
                  {category.count === 1 ? 'guide' : 'guides'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <ImprovementGrid
        items={data.improvements}
        loading={loading}
        error={error}
        query={query}
        heading={query ? 'Search results' : 'Published project guides'}
      />
    </LibraryShell>
  );
}

export function ImprovementGrid({ items, loading, heading, error = false, query = '' }) {
  return (
    <section
      className="mx-auto max-w-6xl px-4 pb-20 pt-10 sm:px-6"
      aria-labelledby="improvements-heading"
    >
      <h2
        id="improvements-heading"
        className="text-2xl font-bold text-slate-950"
      >
        {heading}
      </h2>
      {loading ? (
        <p className="mt-5 text-slate-600">Loading published guides…</p>
      ) : items.length ? (
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex flex-col rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
                {item.category_name}
              </p>
              <h3 className="mt-2 text-xl font-bold text-slate-950">
                <Link to={item.canonical_path}>{item.title}</Link>
              </h3>
              <p className="mt-3 flex-1 leading-7 text-slate-600">
                {item.summary}
              </p>
              <Link
                to={item.canonical_path}
                className="mt-5 inline-flex min-h-11 items-center gap-2 font-bold text-blue-700"
              >
                Explore project{' '}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="mt-5 rounded-2xl border border-slate-200 bg-white p-8 text-slate-700">The library is temporarily unavailable. Please try again later.</div>
      ) : query ? (
        <p className="mt-5 rounded-2xl border border-slate-200 bg-white p-8 text-slate-700">No published guides match “{query}”. Try another project or room.</p>
      ) : (
        <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Guides in preparation</p>
          <h3 className="mt-3 text-2xl font-bold text-slate-950">Start planning while we prepare the first guides.</h3>
          <p className="mt-3 max-w-2xl leading-7 text-slate-600">There are no published guides yet. You can still create a project, document your DIY plan, and choose whether to request contractor assistance.</p>
          <Link to="/start-project" className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-800">Start a project <ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
      )}
    </section>
  );
}

export function LibraryShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <a href="#library-main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-lg focus:bg-white focus:p-3">Skip to content</a>
      <header className="border-b border-white/10 bg-slate-950 text-white">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:flex-nowrap sm:px-6">
          <Link to="/" className="flex items-center gap-3 text-lg font-bold" aria-label="MyHomeBro home">
            <img src={logo} alt="" className="h-10 w-10 rounded-xl object-cover" />
            <span>MyHome<span className="text-amber-300">Bro</span></span>
          </Link>
          <div className="flex flex-wrap gap-4 text-sm font-bold">
            <Link to="/improvements/">Improvement Library</Link>
            <Link to="/login">Log In</Link>
          </div>
        </nav>
      </header>
      <main id="library-main">{children}</main>
      <footer className="border-t border-slate-200 px-5 py-8 text-center text-sm text-slate-600">MyHomeBro · Plan it. DIY it. Hire it. Manage it.</footer>
    </div>
  );
}
