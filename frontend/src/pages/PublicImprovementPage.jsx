import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api';

import { trackAcquisitionEvent } from '../lib/acquisitionAttribution.js';
import { applySeoMetadata, SITE_ORIGIN } from '../lib/seoMetadata.js';
import { LibraryShell } from './PublicImprovementLibraryPage.jsx';

const sections = [
  ['Preparation', 'preparation'],
  ['Safety considerations', 'safety_guidance'],
  ['Cost considerations', 'cost_guidance'],
  ['Tools to plan for', 'tools_guidance'],
  ['Common issues to avoid', 'common_mistakes'],
];

export default function PublicImprovementPage({ preview = false }) {
  const { categorySlug, improvementSlug, publicSlug } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);

  useEffect(() => {
    let active = true;
    const source = preview
      ? api
          .get(`/projects/admin/improvements/preview/${publicSlug}/`)
          .then((response) => response.data)
      : fetch(
          `/api/projects/public/improvements/${categorySlug}/${improvementSlug}/`
        ).then((response) =>
          response.ok ? response.json() : Promise.reject()
        );
    source.then((value) => {
      if (!active) return;
      setItem(value);
      const canonicalUrl = `${SITE_ORIGIN}${value.canonical_path}`;
      const structuredData = [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Home',
              item: `${SITE_ORIGIN}/`,
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Improvement Library',
              item: `${SITE_ORIGIN}/improvements/`,
            },
            {
              '@type': 'ListItem',
              position: 3,
              name: value.category_name,
              item: `${SITE_ORIGIN}/improvements/${value.category_slug}/`,
            },
            {
              '@type': 'ListItem',
              position: 4,
              name: value.title,
              item: canonicalUrl,
            },
          ],
        },
      ];
      if (value.faqs.length) {
        structuredData.push({
          '@type': 'FAQPage',
          mainEntity: value.faqs.map((faq) => ({
            '@type': 'Question',
            name: faq.question,
            acceptedAnswer: { '@type': 'Answer', text: faq.answer },
          })),
        });
      }
      applySeoMetadata(window.location.pathname, {
        title: value.seo_title,
        description: value.seo_description,
        socialDescription: value.seo_description,
        canonicalUrl,
        image: `${SITE_ORIGIN}${value.social_image}`,
        robots: preview ? 'noindex, nofollow' : 'index, follow',
        structuredData,
      });
      if (!preview)
        trackAcquisitionEvent('improvement_template_view', window.location, {
          objectType: 'improvement',
          objectId: value.id,
          metadata: { category: value.category_slug },
        });
    });
    return () => {
      active = false;
    };
  }, [categorySlug, improvementSlug, publicSlug, preview]);

  const act = (eventType, target) => {
    trackAcquisitionEvent(eventType, window.location, {
      objectType: 'improvement',
      objectId: item.id,
      metadata: { category: item.category_slug },
    });
    sessionStorage.setItem(
      'mhb-improvement-intent',
      JSON.stringify({
        eventType,
        templateId: item.id,
        path: item.canonical_path,
      })
    );
    const params = new URLSearchParams(window.location.search);
    const destination = new URL(target, window.location.origin);
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'ref',
    ]) {
      if (params.has(key)) destination.searchParams.set(key, params.get(key));
    }
    navigate(`${destination.pathname}${destination.search}`);
  };

  if (!item)
    return (
      <LibraryShell>
        <p className="mx-auto max-w-6xl px-4 py-20 text-slate-600">
          Loading published project guide…
        </p>
      </LibraryShell>
    );
  return (
    <LibraryShell>
      <article className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
        {preview ? (
          <div
            role="status"
            className="rounded-xl border border-amber-400 bg-amber-100 p-4 font-bold text-amber-950"
          >
            Editorial preview · {item.publication_status}. This draft is not a
            public page.
          </div>
        ) : null}
        <nav
          aria-label="Breadcrumb"
          data-testid="improvement-breadcrumbs"
          className="flex flex-wrap gap-2 text-sm text-slate-600"
        >
          <Link to="/">Home</Link>
          <span>›</span>
          <Link to="/improvements/">Improvement Library</Link>
          <span>›</span>
          <Link to={`/improvements/${item.category_slug}/`}>
            {item.category_name}
          </Link>
          <span>›</span>
          <span>{item.title}</span>
        </nav>
        <header className="mt-8">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-700">
            {item.audience_label ? `${item.audience_label} · ` : ''}
            {item.category_name} guide
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950 sm:text-6xl">
            {item.title}
          </h1>
          <p className="mt-5 max-w-3xl text-xl leading-8 text-slate-600">
            {item.summary}
          </p>
          {item.reviewed_at ? (
            <p className="mt-3 text-sm text-slate-500">
              Last reviewed {new Date(item.reviewed_at).toLocaleDateString()}
            </p>
          ) : null}
        </header>
        {item.problem ? (
          <>
            <ContentSection title="The problem" value={item.problem} />
            <section className="mt-10">
              <h2 className="text-2xl font-bold text-slate-950">
                What the evidence says
              </h2>
              <p className="mt-3 whitespace-pre-line leading-8 text-slate-700">
                {item.evidence}
              </p>
              {item.evidence_source ? (
                <a
                  href={item.evidence_source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block font-bold text-blue-800 underline"
                >
                  Read the source{' '}
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : null}
            </section>
            <section className="mt-10 rounded-3xl border-l-8 border-amber-400 bg-[#071b34] p-6 text-white sm:p-8">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                MyHomeBro viewpoint
              </p>
              <h2 className="mt-2 text-2xl font-bold">Our take</h2>
              <p className="mt-4 whitespace-pre-line leading-8 text-sky-50">
                {item.viewpoint}
              </p>
            </section>
            <PracticalSteps value={item.practical_steps} />
            <section className="mt-12 rounded-3xl bg-blue-50 p-6 sm:p-8">
              <h2 className="text-2xl font-bold text-slate-950">
                A useful next step
              </h2>
              <p className="mt-3 leading-7 text-slate-700">
                Use MyHomeBro to organize the project conversation. Features and
                payment options depend on the project setup and agreement.
              </p>
              <button
                type="button"
                onClick={() =>
                  act(
                    item.next_action === 'sign_up'
                      ? 'signup_started'
                      : 'hire_pro_clicked',
                    editorialTarget(item)
                  )
                }
                className="mt-5 min-h-12 rounded-xl bg-blue-700 px-5 font-bold text-white hover:bg-blue-800"
              >
                {editorialActionLabel(item.next_action)}
              </button>
            </section>
          </>
        ) : (
          <>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {item.difficulty_label ? (
                <Fact label="Difficulty" value={item.difficulty_label} />
              ) : null}
              {item.estimated_duration_min_days ? (
                <Fact
                  label="Estimated duration"
                  value={`${item.estimated_duration_min_days}${item.estimated_duration_max_days && item.estimated_duration_max_days !== item.estimated_duration_min_days ? `–${item.estimated_duration_max_days}` : ''} days`}
                />
              ) : null}
              <Fact label="Project path" value="DIY or contractor help" />
            </div>
            {item.intro ? (
              <ContentSection
                title="What does this project involve?"
                value={item.intro}
              />
            ) : null}
            {item.scope ? (
              <ContentSection title="Project scope" value={item.scope} />
            ) : null}
            {sections.map(([title, key]) =>
              item[key] ? (
                <ContentSection key={key} title={title} value={item[key]} />
              ) : null
            )}
            {item.materials ? (
              <ContentSection
                title="Materials to consider"
                value={item.materials}
              />
            ) : null}
            {item.milestones.length ? (
              <section className="mt-10">
                <h2 className="text-2xl font-bold">Typical project steps</h2>
                <ol className="mt-4 space-y-4">
                  {item.milestones.map((step, index) => (
                    <li
                      key={step.id}
                      className="rounded-2xl border border-slate-200 bg-white p-5"
                    >
                      <span className="text-sm font-bold text-blue-700">
                        Step {index + 1}
                      </span>
                      <h3 className="mt-1 text-lg font-bold">{step.title}</h3>
                      {step.description ? (
                        <p className="mt-2 whitespace-pre-line text-slate-600">
                          {step.description}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            <section className="mt-12 rounded-3xl bg-slate-950 p-6 text-white sm:p-10">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-amber-300">
                DIY or hire a pro?
              </p>
              <h2 className="mt-2 text-3xl font-bold">
                Choose the path that fits this project.
              </h2>
              {item.diy_guidance ? (
                <p className="mt-4 text-slate-200">
                  <strong>DIY:</strong> {item.diy_guidance}
                </p>
              ) : null}
              {item.pro_guidance ? (
                <p className="mt-3 text-slate-200">
                  <strong>Professional help:</strong> {item.pro_guidance}
                </p>
              ) : null}
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <button
                  data-testid="diy-this-project"
                  onClick={() =>
                    act(
                      'diy_project_started',
                      `/register?role=customer&intent=diy&template_id=${item.id}&next=${encodeURIComponent(`/portal?workspace=diy-planner&action=create&template_id=${item.id}`)}`
                    )
                  }
                  className="min-h-14 rounded-xl bg-amber-400 px-5 font-bold text-slate-950"
                >
                  DIY This Project
                </button>
                <button
                  data-testid="get-contractor-help"
                  onClick={() =>
                    act(
                      'hire_pro_clicked',
                      `/start-project?source=improvement_library&template_id=${item.id}`
                    )
                  }
                  className="min-h-14 rounded-xl border border-white/30 px-5 font-bold text-white"
                >
                  Get Contractor Help
                </button>
              </div>
            </section>
          </>
        )}
        {item.faqs.length ? (
          <section className="mt-12">
            <h2 className="text-2xl font-bold">Questions about this project</h2>
            <div className="mt-4 space-y-3">
              {item.faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <summary className="cursor-pointer font-bold text-slate-950">
                    {faq.question}
                  </summary>
                  <p className="mt-3 leading-7 text-slate-700">{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>
        ) : null}
        {item.related.length ? (
          <section className="mt-12">
            <h2 className="text-2xl font-bold">Related improvements</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {item.related.map((related) => (
                <Link
                  key={related.id}
                  to={
                    preview && related.publication_status !== 'published'
                      ? `/app/admin/improvements/preview/${related.slug}`
                      : related.canonical_path
                  }
                  className="rounded-2xl border border-slate-200 bg-white p-5 font-bold text-blue-700"
                >
                  {related.title}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </article>
    </LibraryShell>
  );
}

function editorialActionLabel(action) {
  return (
    {
      sign_up: 'Sign up',
      create_project: 'Create a project',
      request_help: 'Request help',
    }[action] || 'Start a project'
  );
}

function editorialTarget(item) {
  const context = new URLSearchParams({
    source: 'improvement_library',
    template_id: String(item.id),
    article: item.slug,
    cta: item.next_action || 'create_project',
  });
  if (item.next_action === 'sign_up') {
    context.set('next', item.canonical_path);
    if ((item.audience || item.public_audience) === 'contractor')
      return `/signup?${context}`;
    context.set(
      'role',
      (item.audience || item.public_audience) === 'property_manager'
        ? 'property_manager'
        : 'customer'
    );
    return `/create-account?${context}`;
  }
  return `/start-project?${context}`;
}

function Fact({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-2 font-bold text-slate-950">{value}</div>
    </div>
  );
}
function ContentSection({ title, value }) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-slate-950">{title}</h2>
      <p className="mt-3 whitespace-pre-line leading-8 text-slate-700">
        {value}
      </p>
    </section>
  );
}

function PracticalSteps({ value }) {
  const lines = String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const steps = lines.filter((line) => /^\d+\.\s/.test(line));
  const notes = lines.filter((line) => !/^\d+\.\s/.test(line));
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-slate-950">Practical steps</h2>
      <ol className="mt-4 list-decimal space-y-3 pl-6 leading-8 text-slate-700">
        {steps.map((line, index) => <li key={`${index}-${line}`}>{line.replace(/^\d+\.\s/, '')}</li>)}
      </ol>
      {notes.map((note, index) => (
        <p key={`${index}-${note}`} className="mt-5 rounded-xl bg-amber-50 p-4 leading-7 text-slate-800">{note}</p>
      ))}
    </section>
  );
}
