import React, { useEffect, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { Link } from 'react-router-dom';

import { applySeoMetadata, SITE_ORIGIN } from '../lib/seoMetadata.js';

export default function PublicImprovementLibraryPage() {
  const [query, setQuery] = useState('');
  const [data, setData] = useState({ categories: [], improvements: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          setLoading(true);
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
      <section className="mx-auto max-w-5xl px-4 pb-10 pt-14 text-center sm:px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-blue-700">
          MyHomeBro Improvement Library
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-6xl">
          Plan your next home project.
        </h1>
        <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-600">
          Explore project guides, understand what the work involves, decide
          whether to DIY or hire help, and turn what you learn into an actual
          MyHomeBro project.
        </p>
        <label className="relative mx-auto mt-8 block max-w-2xl text-left">
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
      </section>

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
        heading={query ? 'Search results' : 'Published project guides'}
      />
    </LibraryShell>
  );
}

export function ImprovementGrid({ items, loading, heading }) {
  return (
    <section
      className="mx-auto max-w-6xl px-4 pb-20 sm:px-6"
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
      ) : (
        <p className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
          No published improvements match this search.
        </p>
      )}
    </section>
  );
}

export function LibraryShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-black text-slate-950">
            MyHome<span className="text-amber-500">Bro</span>
          </Link>
          <div className="flex gap-4 text-sm font-bold">
            <Link to="/improvements/">Improvement Library</Link>
            <Link to="/login">Log In</Link>
          </div>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
