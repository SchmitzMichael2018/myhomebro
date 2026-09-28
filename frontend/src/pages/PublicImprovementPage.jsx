import React, { useEffect, useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
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
  const paymentDesign = item.slug === 'contractor-payment-plan';
  return (
    <LibraryShell>
      <div className={paymentDesign ? 'bg-[#f7f4ed]' : ''}>
      <article className={`mx-auto px-4 pb-24 pt-8 sm:px-6 ${paymentDesign ? 'max-w-6xl' : 'max-w-5xl'}`}>
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
        <header className={paymentDesign
          ? 'relative mt-8 overflow-hidden rounded-[2rem] bg-[#071b34] px-6 py-10 text-white shadow-[0_24px_60px_-30px_rgba(7,27,52,.65)] sm:px-10 lg:px-14 lg:py-16'
          : 'mt-8'}>
          <div className={paymentDesign ? 'relative grid gap-10 lg:grid-cols-[1.45fr_.55fr] lg:items-center' : ''}>
          <div>
          <p className={`text-sm font-bold uppercase tracking-[0.16em] ${paymentDesign ? 'text-amber-300' : 'text-blue-700'}`}>
            {paymentDesign ? <span className="sr-only">Contractor field guide: </span> : null}
            {item.audience_label ? `${item.audience_label} · ` : ''}
            {item.category_name} guide
          </p>
          <h1 className={`mt-3 text-4xl font-black tracking-tight sm:text-6xl ${paymentDesign ? 'max-w-3xl leading-[1.05] text-white' : 'text-slate-950'}`}>
            {item.title}
          </h1>
          <p className={`mt-5 max-w-3xl text-xl leading-8 ${paymentDesign ? 'text-sky-100' : 'text-slate-600'}`}>
            {item.summary}
          </p>
          {item.reviewed_at ? (
            <p className={`mt-3 text-sm ${paymentDesign ? 'text-sky-200' : 'text-slate-500'}`}>
              Last reviewed {new Date(item.reviewed_at).toLocaleDateString()}
            </p>
          ) : null}
          </div>
          {paymentDesign ? (
            <div aria-hidden="true" className="relative hidden rounded-3xl border border-sky-200/40 bg-[#102e4d]/95 p-5 shadow-xl lg:block"
              style={{ backgroundImage: 'linear-gradient(#b4d2e814 1px, transparent 1px), linear-gradient(90deg, #b4d2e814 1px, transparent 1px)', backgroundSize: '38px 38px' }}>
              <div className="flex items-center justify-between gap-2 border-b border-sky-200/25 pb-4 text-[10px] font-black uppercase tracking-[.12em] text-amber-300">
                <span>Project plan</span><span>01 / 03</span>
              </div>
              {['Define the work', 'Agree on review points', 'Record the outcome'].map((step, index) => (
                <div key={step} className="flex items-center gap-3 border-b border-sky-200/15 py-5 last:border-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300/70 text-xs font-black text-amber-300">0{index + 1}</span>
                  <span className="text-sm font-semibold text-white">{step}</span>
                </div>
              ))}
              <div className="mt-2 h-1 w-24 rounded-full bg-amber-300" />
            </div>
          ) : null}
          </div>
        </header>
        {item.problem ? (
          <div className={paymentDesign ? 'mt-8 rounded-[2rem] border border-[#e7e0d3] bg-white px-6 pb-10 pt-1 shadow-[0_20px_50px_-35px_rgba(7,27,52,.32)] sm:px-10 lg:px-16' : ''}>
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
            {paymentDesign ? <PaymentMilestoneExample /> : null}
            <PracticalSteps value={item.practical_steps} />
            <WalkthroughSection video={item.video} previewPlacement={preview && paymentDesign} />
            <section className={`mt-12 rounded-3xl p-6 sm:p-8 ${paymentDesign ? 'border border-[#e7e0d3] bg-[#f7f4ed]' : 'bg-blue-50'}`}>
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
                className={`mt-5 min-h-12 rounded-xl px-5 font-bold ${paymentDesign ? 'bg-[#071b34] text-white hover:bg-[#153959]' : 'bg-blue-700 text-white hover:bg-blue-800'}`}
              >
                {editorialActionLabel(item.next_action)}
              </button>
            </section>
          </div>
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
      </div>
    </LibraryShell>
  );
}

function PaymentMilestoneExample() {
  const steps = [
    ['Scope', 'Agree on the work and what completion means.'],
    ['Milestone', 'Set the stage and proof before work begins.'],
    ['Evidence', 'Document the completed work.'],
    ['Review', 'Give the customer a clear review point.'],
    ['Outcome', 'Follow the agreement and payment setup.'],
  ];
  return (
    <section className="mt-12" aria-labelledby="payment-example-heading" data-testid="payment-milestone-example">
      <p className="text-xs font-black uppercase tracking-[.2em] text-blue-800">A simple example</p>
      <h2 id="payment-example-heading" className="mt-2 text-2xl font-black text-[#071b34]">How one milestone moves forward</h2>
      <p className="mt-3 max-w-2xl leading-7 text-slate-700">A shared plan makes each review point clearer. It does not guarantee approval or payment release.</p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map(([title, description], index) => (
          <li key={title} className="relative rounded-2xl border border-[#dfd7c7] bg-[#fbf8f2] p-4">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#071b34] text-xs font-black text-amber-300">0{index + 1}</span>
            <h3 className="mt-4 font-black text-[#071b34]">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-700">{description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WalkthroughSection({ video, previewPlacement }) {
  if (!video && !previewPlacement) return null;
  if (!video) return (
    <section className="mt-12 rounded-3xl border-2 border-dashed border-[#cbbd9d] bg-[#f7f4ed] p-6 sm:p-8" data-testid="walkthrough-placement">
      <p className="text-xs font-black uppercase tracking-[.2em] text-blue-800">Editorial preview only</p>
      <h2 className="mt-2 text-2xl font-black text-[#071b34]">See how it works — planned placement</h2>
      <p className="mt-3 leading-7 text-slate-700">No walkthrough video is attached. This section stays hidden from readers until a real video, poster, and text alternative have been reviewed.</p>
      <p className="mt-4 text-sm font-semibold text-slate-700">Planned sequence: define the scope → set milestones → document completed work → customer review → payment outcome.</p>
    </section>
  );
  return (
    <section className="mt-12 overflow-hidden rounded-3xl bg-[#071b34] text-white" aria-labelledby="walkthrough-heading" data-testid="walkthrough-video">
      <div className="grid md:grid-cols-[1.05fr_.95fr]">
        <div className="p-6 sm:p-9">
          <p className="text-xs font-black uppercase tracking-[.2em] text-amber-300">Project walkthrough</p>
          <h2 id="walkthrough-heading" className="mt-2 text-2xl font-black">See how it works</h2>
          <h3 className="mt-5 text-xl font-bold">{video.title}</h3>
          <p className="mt-3 leading-7 text-sky-100">{video.description}</p>
          <a href={video.url} target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-300 px-5 font-black text-[#071b34] hover:bg-amber-200">
            <Play className="h-5 w-5 fill-current" aria-hidden="true" /> Play walkthrough <span className="sr-only">(opens in a new tab)</span>
          </a>
          <a href={video.url} target="_blank" rel="noopener noreferrer" className="mt-4 flex w-fit items-center gap-2 text-sm font-semibold text-sky-100 underline underline-offset-4 hover:text-white">
            Open video in a new tab <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
          {video.text_summary ? <p className="mt-6 whitespace-pre-line border-t border-sky-200/25 pt-5 text-sm leading-6 text-sky-100"><strong className="text-white">Text summary:</strong> {video.text_summary}</p> : null}
          {video.transcript_url ? <a href={video.transcript_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-amber-200 underline underline-offset-4 hover:text-amber-100">Read the transcript <span className="sr-only">(opens in a new tab)</span></a> : null}
        </div>
        <a href={video.url} target="_blank" rel="noopener noreferrer" aria-label={`Play ${video.title} (opens in a new tab)`} className="group relative block min-h-64 bg-[#102e4d]">
          <img src={video.poster_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute inset-0 bg-[#071b34]/30 transition group-hover:bg-[#071b34]/45" />
          <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-amber-300 text-[#071b34] shadow-lg"><Play className="h-7 w-7 fill-current" aria-hidden="true" /></span>
        </a>
      </div>
    </section>
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
    const continuation = new URLSearchParams({
      source: 'improvement_library',
      article: item.slug,
      cta: 'sign_up',
    });
    const current = new URLSearchParams(window.location.search);
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'ref',
    ]) {
      if (current.has(key)) continuation.set(key, current.get(key));
    }
    context.set('next', `${item.canonical_path}?${continuation}`);
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
  const lines = String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const steps = lines.filter((line) => /^\d+\.\s/.test(line));
  const notes = lines.filter((line) => !/^\d+\.\s/.test(line));
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-bold text-slate-950">Practical steps</h2>
      <ol className="mt-4 list-decimal space-y-3 pl-6 leading-8 text-slate-700">
        {steps.map((line, index) => (
          <li key={`${index}-${line}`}>{line.replace(/^\d+\.\s/, '')}</li>
        ))}
      </ol>
      {notes.map((note, index) => (
        <p
          key={`${index}-${note}`}
          className="mt-5 rounded-xl bg-amber-50 p-4 leading-7 text-slate-800"
        >
          {note}
        </p>
      ))}
    </section>
  );
}
