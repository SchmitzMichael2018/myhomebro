import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  House,
  Search,
  Building2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo.jsx';
import { applySeoMetadata, SITE_ORIGIN } from '../lib/seoMetadata.js';

const audiences = [
  {
    value: 'contractor',
    label: 'Contractors',
    icon: BriefcaseBusiness,
    description: 'Scope work, explain changes, and plan payment conversations.',
  },
  {
    value: 'homeowner',
    label: 'Homeowners',
    icon: House,
    description: 'Understand projects and decide what to do next.',
  },
  {
    value: 'property_manager',
    label: 'Property Managers',
    icon: Building2,
    description: 'Keep property work and decisions organized.',
  },
];

export default function PublicImprovementLibraryPage() {
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState({
    categories: [],
    improvements: [],
    published_count: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          setLoading(true);
          setError(false);
          const params = new URLSearchParams();
          if (query.trim()) params.set('q', query.trim());
          if (audience) params.set('audience', audience);
          if (category) params.set('category', category);
          const response = await fetch(
            `/api/projects/public/improvements/${params.size ? `?${params}` : ''}`,
            { signal: controller.signal }
          );
          if (!response.ok) throw new Error('Library unavailable');
          const value = await response.json();
          setData(value);
          applySeoMetadata(window.location.pathname, {
            title: 'Home Improvement Projects & Practical Guides | MyHomeBro',
            description:
              'Practical home-project guidance for contractors, homeowners, and property managers. Explore the work and choose a useful next step.',
            canonicalUrl: `${SITE_ORIGIN}/improvements/`,
            robots: value.published_count ? 'index, follow' : 'noindex, follow',
          });
        } catch (caught) {
          if (caught.name !== 'AbortError') setError(true);
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query ? 180 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, audience, category, retry]);
  return (
    <LibraryShell>
      <section className="bg-[#071b34] text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.25fr_.75fr] lg:items-center lg:py-20">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-amber-300">
              MyHomeBro Improvement Library
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-black leading-tight sm:text-6xl">
              Plan your next home project.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-sky-100">
              Explore practical project guides for the work ahead.{' '}
              {data.contractor_published_count
                ? 'Start with our contractor guides: real problems, sourced context, our viewpoint, and useful next steps.'
                : 'Our contractor-first editorial series is in review and will connect real problems, sourced context, our viewpoint, and useful next steps.'}
            </p>
            <a
              href="#guides"
              className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-300 px-5 font-extrabold text-slate-950 hover:bg-amber-200"
            >
              Explore guides{' '}
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </a>
          </div>
          <div className="rounded-3xl border border-sky-300/20 bg-white/10 p-6 shadow-2xl">
            <BookOpen className="h-9 w-9 text-amber-300" aria-hidden="true" />
            <h2 className="mt-5 text-2xl font-bold">
              Start with a clearer plan.
            </h2>
            <p className="mt-3 leading-7 text-sky-100">
              Good work starts with a shared scope and a next step everyone can
              understand. Our guides help you ask better questions before the
              work begins.
            </p>
          </div>
        </div>
      </section>
      <section
        className="mx-auto max-w-6xl px-4 py-12 sm:px-6"
        aria-labelledby="audiences-heading"
      >
        <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">
          Choose your path
        </p>
        <h2
          id="audiences-heading"
          className="mt-2 text-3xl font-black text-slate-950"
        >
          Guidance for the role you play
        </h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {audiences.map(({ value, label, description, icon: Icon }, index) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setAudience(value);
                document
                  .getElementById('guides')
                  ?.scrollIntoView({ behavior: 'smooth' });
              }}
              aria-pressed={audience === value}
              className={`min-h-48 rounded-2xl border p-6 text-left shadow-sm transition hover:shadow-lg focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-500 ${audience === value ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}
            >
              <Icon className="h-8 w-8 text-blue-700" aria-hidden="true" />
              <span className="mt-4 block text-xl font-extrabold text-slate-950">
                {label}
                {index === 0 ? (
                  <span className="ml-2 rounded-full bg-amber-200 px-2 py-1 align-middle text-[10px] uppercase tracking-wide text-amber-950">
                    Featured first
                  </span>
                ) : null}
              </span>
              <span className="mt-2 block leading-6 text-slate-700">
                {description}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section
        id="guides"
        className="mx-auto max-w-6xl scroll-mt-8 px-4 pb-20 sm:px-6"
        aria-labelledby="improvements-heading"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">
              From insight to action
            </p>
            <h2
              id="improvements-heading"
              className="mt-2 text-3xl font-black text-slate-950"
            >
              Published project guides
            </h2>
          </div>
          <p className="text-sm text-slate-600">
            {data.published_count || 0} published
          </p>
        </div>
        <div className="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[2fr_1fr_1fr]">
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-800">
              Search guides
            </span>
            <span className="relative block">
              <Search
                className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                data-testid="improvement-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a project or question"
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-slate-950 focus-visible:outline focus-visible:outline-4 focus-visible:outline-blue-300"
              />
            </span>
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-800">
              Audience
            </span>
            <select
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-950"
            >
              <option value="">All audiences</option>
              {audiences.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-2 block text-sm font-bold text-slate-800">
              Category
            </span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-950"
            >
              <option value="">All categories</option>
              {data.categories.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ImprovementGrid
          items={data.improvements}
          loading={loading}
          error={error}
          hasFilters={Boolean(query || audience || category)}
          onRetry={() => setRetry((current) => current + 1)}
        />
      </section>
    </LibraryShell>
  );
}

export function ImprovementGrid({
  items,
  loading,
  error = false,
  hasFilters = false,
  onRetry,
  heading,
}) {
  return (
    <div aria-live="polite">
      {heading ? (
        <h2 className="mt-8 text-2xl font-bold text-slate-950">{heading}</h2>
      ) : null}
      {loading ? (
        <p className="mt-5 text-slate-600">Loading published guides…</p>
      ) : error ? (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-8 text-rose-900">
          Guides are temporarily unavailable.{' '}
          <button
            type="button"
            onClick={onRetry}
            className="font-bold underline"
          >
            Try again
          </button>
        </div>
      ) : items.length ? (
        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg"
            >
              <div className="h-2 bg-gradient-to-r from-blue-700 via-sky-500 to-amber-300" />
              <div className="flex flex-1 flex-col p-6">
                <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wide">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-900">
                    {item.audience_label || 'Homeowners'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                    {item.category_name}
                  </span>
                </div>
                <h3 className="mt-5 text-2xl font-black leading-snug text-slate-950">
                  <Link
                    className="hover:text-blue-700"
                    to={item.canonical_path}
                  >
                    {item.title}
                  </Link>
                </h3>
                <p className="mt-3 flex-1 leading-7 text-slate-700">
                  {item.summary}
                </p>
                <Link
                  to={item.canonical_path}
                  className="mt-6 inline-flex min-h-11 items-center gap-2 font-bold text-blue-800 hover:underline"
                >
                  Read guide{' '}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center sm:p-12">
          <BookOpen
            className="mx-auto h-10 w-10 text-blue-700"
            aria-hidden="true"
          />
          <h3 className="mt-4 text-xl font-bold text-slate-950">
            {hasFilters
              ? 'No guides match those filters yet.'
              : 'The library is getting ready.'}
          </h3>
          <p className="mx-auto mt-2 max-w-xl leading-7 text-slate-700">
            {hasFilters
              ? 'Try another audience, category, or search term.'
              : 'Our first contractor guides are being reviewed. In the meantime, you can start a project or create an account.'}
          </p>
          {!hasFilters ? (
            <Link
              to="/start-project"
              className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-5 font-bold text-white hover:text-white"
            >
              Start a project
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function LibraryShell({ children, showBrandText = false }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav
          aria-label="Main navigation"
          className={`mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 ${showBrandText ? 'pt-14 sm:pt-3 sm:pr-48' : ''}`}
        >
          <Link to="/" aria-label="MyHomeBro home">
            <BrandLogo height={48} showText={showBrandText} />
          </Link>
          <div className="flex flex-wrap items-center gap-4 text-sm font-bold text-slate-800">
            <Link className="hover:text-blue-700" to="/improvements/">
              Improvement Library
            </Link>
            <Link className="hover:text-blue-700" to="/start-project">
              Start a Project
            </Link>
            <Link
              className="rounded-lg border border-slate-300 px-3 py-2"
              to="/login"
            >
              Log In
            </Link>
          </div>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="border-t border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
        <Link className="font-bold text-blue-800" to="/">
          MyHomeBro
        </Link>{' '}
        · Practical guidance for planning your next step.
      </footer>
    </div>
  );
}
