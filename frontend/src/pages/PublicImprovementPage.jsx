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

const contractorGuides = {
  'contractor-payment-plan': {
    plan: [
      ['Plan', [0, 1]],
      ['Review', [2, 3]],
      ['Outcome', [4]],
    ],
    exampleTitle: 'How one milestone moves forward',
    exampleIntro: 'The three project-plan phases group five concrete steps. A shared plan makes each review point clearer; it does not guarantee approval or payment release.',
    exampleSteps: [
      ['Scope', 'Agree on the work and what completion means.'],
      ['Milestone', 'Set the stage and proof before work begins.'],
      ['Evidence', 'Document the completed work.'],
      ['Customer review', 'Give the customer a clear review point.'],
      ['Payment outcome', 'Follow the agreement and payment setup.'],
    ],
    ctaTitle: 'Set up your project and payment milestones',
    ctaDescription: 'Start a contractor account, then define scope, proof, and review points in an agreement. Payment availability and release depend on the project setup and agreement.',
    ctaLabel: 'Sign up to plan milestones',
    intent: 'payment_milestones',
    walkthroughSequence: 'define the scope → set milestones → document completed work → customer review → payment outcome',
  },
  'contractor-deposit-vs-milestones': {
    plan: [
      ['Plan', [0, 1]],
      ['Review', [2, 3]],
      ['Outcome', [4]],
    ],
    exampleTitle: 'Where a startup amount fits',
    exampleIntro: 'An early material cost belongs in a complete schedule—not in place of one. The agreed terms and local rules determine what is appropriate.',
    exampleSteps: [
      ['Startup need', 'Explain what an upfront amount would cover, such as a custom-order material.'],
      ['Payment schedule', 'Record every later stage and when it would be due.'],
      ['Work proof', 'Capture the agreed deliverable and evidence at each stage.'],
      ['Customer review', 'Give the customer the agreed opportunity to review progress.'],
      ['Final payment step', 'Identify remaining items and the final step in the agreement.'],
    ],
    ctaTitle: 'Plan the whole payment schedule',
    ctaDescription: 'Start a contractor account and put any startup amount alongside the scope, later milestones, and customer review points. Funding and release options depend on the agreement and payment setup.',
    ctaLabel: 'Sign up to plan payments',
    intent: 'payment_schedule',
    walkthroughSequence: 'explain the startup need → set the full schedule → document work → customer review → final payment step',
  },
  'contractor-change-orders': {
    plan: [
      ['Discover', [0, 1]],
      ['Decide', [2, 3]],
      ['Continue', [4]],
    ],
    exampleTitle: 'When a hidden condition changes the job',
    exampleIntro: 'Use the finding to make a specific decision before extra work proceeds. An amendment records agreement; it does not guarantee payment or prevent every dispute.',
    exampleSteps: [
      ['Pause', 'Pause the affected work while the new condition is assessed.'],
      ['Document', 'Photograph what is known and note what still needs inspection.'],
      ['Explain options', 'Show the proposed scope, price, and schedule impact.'],
      ['Document approval', 'Record the customer decision in an amendment.'],
      ['Agreed work', 'Continue the extra work only after the change is approved.'],
    ],
    ctaTitle: 'Keep scope changes connected to the agreement',
    ctaDescription: 'Start a contractor account to organize the original scope and document proposed changes for customer review before extra work proceeds.',
    ctaLabel: 'Sign up to document changes',
    intent: 'scope_changes',
    walkthroughSequence: 'pause affected work → document the finding → explain options → record approval → continue agreed work',
  },
};

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
  const contractorGuide = contractorGuides[item.slug];
  return (
    <LibraryShell showBrandText>
      <div className={contractorGuide ? 'bg-[#f7f4ed]' : ''}>
      <article className={`mx-auto px-4 pb-24 pt-8 sm:px-6 ${contractorGuide ? 'max-w-6xl' : 'max-w-5xl'}`}>
        {preview ? (
          <div
            role="status"
            className="rounded-xl border border-amber-400 bg-amber-100 p-4 font-bold text-amber-950"
          >
            Editorial preview · {item.publication_status}. This draft is not a
            public page.
          </div>
        ) : null}
        <Link to="/improvements/" className="mb-4 inline-flex min-h-11 items-center font-bold text-blue-800 underline-offset-4 hover:underline focus-visible:underline" data-testid="article-back-to-library">
          ← Back to Improvement Library
        </Link>
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
        <header className={contractorGuide
          ? 'relative mt-8 overflow-hidden rounded-[2rem] bg-[#071b34] px-6 py-10 text-white shadow-[0_24px_60px_-30px_rgba(7,27,52,.65)] sm:px-10 lg:px-14 lg:py-16'
          : 'mt-8'}>
          <div className={contractorGuide ? 'relative grid gap-10 lg:grid-cols-[1.45fr_.55fr] lg:items-center' : ''}>
          <div>
          <p className={`text-sm font-bold uppercase tracking-[0.16em] ${contractorGuide ? 'text-amber-300' : 'text-blue-700'}`}>
            {contractorGuide ? <span className="sr-only">Contractor field guide: </span> : null}
            {item.audience_label ? `${item.audience_label} · ` : ''}
            {item.category_name} guide
          </p>
          <h1 className={`mt-3 text-4xl font-black tracking-tight sm:text-6xl ${contractorGuide ? 'max-w-3xl leading-[1.05] text-white' : 'text-slate-950'}`}>
            {item.title}
          </h1>
          <p className={`mt-5 max-w-3xl text-xl leading-8 ${contractorGuide ? 'text-sky-100' : 'text-slate-600'}`}>
            {item.summary}
          </p>
          {item.reviewed_at ? (
            <p className={`mt-3 text-sm ${contractorGuide ? 'text-sky-200' : 'text-slate-500'}`}>
              Last reviewed {new Date(item.reviewed_at).toLocaleDateString()}
            </p>
          ) : null}
          </div>
          {contractorGuide ? <BlueprintPlan guide={contractorGuide} /> : null}
          </div>
        </header>
        {item.problem ? (
          <div className={contractorGuide ? 'mt-8 rounded-[2rem] border border-[#e7e0d3] bg-white px-6 pb-10 pt-1 shadow-[0_20px_50px_-35px_rgba(7,27,52,.32)] sm:px-10 lg:px-16' : ''}>
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
            {contractorGuide ? <ContractorVisualExample guide={contractorGuide} /> : null}
            <PracticalSteps value={item.practical_steps} />
            {(item.sections || []).map((section) => (
              <ContentSection key={section.id} title={section.title} value={section.body} />
            ))}
            <WalkthroughSection video={item.video} previewPlacement={preview && Boolean(contractorGuide)} previewSequence={contractorGuide?.walkthroughSequence} />
            <section className={`mt-12 rounded-3xl p-6 sm:p-8 ${contractorGuide ? 'border border-[#e7e0d3] bg-[#f7f4ed]' : 'bg-blue-50'}`}>
              <h2 className="text-2xl font-bold text-slate-950">
                {contractorGuide?.ctaTitle || 'A useful next step'}
              </h2>
              <p className="mt-3 leading-7 text-slate-700">
                {contractorGuide?.ctaDescription || 'Use MyHomeBro to organize the project conversation. Features and payment options depend on the project setup and agreement.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {(item.audiences || [item.audience]).map((audience) => {
                  const action = item.audience_actions?.[audience] || item.next_action;
                  const label = audience === 'contractor' ? 'Contractor' : audience === 'property_manager' ? 'Property manager' : 'Homeowner';
                  return (
                    <button
                      key={audience}
                      type="button"
                      onClick={() =>
                        act(
                          action === 'sign_up' ? 'signup_started' : 'hire_pro_clicked',
                          editorialTarget(item, contractorGuide, audience, action)
                        )
                      }
                      className={`min-h-12 rounded-xl px-5 font-bold ${contractorGuide ? 'bg-[#071b34] text-white hover:bg-[#153959]' : 'bg-blue-700 text-white hover:bg-blue-800'}`}
                    >
                      {contractorGuide?.ctaLabel && (item.audiences || []).length === 1
                        ? contractorGuide.ctaLabel
                        : `${label}: ${editorialActionLabel(action)}`}
                    </button>
                  );
                })}
              </div>
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
            {(item.sections || []).map((section) => (
              <ContentSection key={section.id} title={section.title} value={section.body} />
            ))}
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

function BlueprintPlan({ guide }) {
  return (
    <div role="group" aria-label="Project plan in three phases" className="relative rounded-3xl border border-sky-200/40 bg-[#102e4d]/95 p-5 shadow-xl"
      style={{ backgroundImage: 'linear-gradient(#b4d2e814 1px, transparent 1px), linear-gradient(90deg, #b4d2e814 1px, transparent 1px)', backgroundSize: '38px 38px' }}>
      <div className="flex items-center justify-between gap-2 border-b border-sky-200/25 pb-4 text-[10px] font-black uppercase tracking-[.12em] text-amber-300">
        <span>Project plan</span><span>3 phases</span>
      </div>
      {guide.plan.map(([phase, stepIndexes], index) => (
        <div key={phase} className="flex items-start gap-3 border-b border-sky-200/15 py-5 last:border-0">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300/70 text-xs font-black text-amber-300">0{index + 1}</span>
          <span className="text-sm text-white"><strong className="block">{phase}</strong><span className="mt-1 block text-xs leading-5 text-sky-100">{stepIndexes.map((stepIndex) => guide.exampleSteps[stepIndex][0]).join(' + ')}</span></span>
        </div>
      ))}
      <div className="mt-2 h-1 w-24 rounded-full bg-amber-300" />
    </div>
  );
}

function ContractorVisualExample({ guide }) {
  return (
    <section className="mt-12" aria-labelledby="contractor-example-heading" data-testid="contractor-visual-example">
      <p className="text-xs font-black uppercase tracking-[.2em] text-blue-800">A simple example</p>
      <h2 id="contractor-example-heading" className="mt-2 text-2xl font-black text-[#071b34]">{guide.exampleTitle}</h2>
      <p className="mt-3 max-w-2xl leading-7 text-slate-700">{guide.exampleIntro}</p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {guide.exampleSteps.map(([title, description], index) => (
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

function WalkthroughSection({ video, previewPlacement, previewSequence }) {
  if (!video && !previewPlacement) return null;
  if (!video) return (
    <section className="mt-12 rounded-3xl border-2 border-dashed border-[#cbbd9d] bg-[#f7f4ed] p-6 sm:p-8" data-testid="walkthrough-placement">
      <p className="text-xs font-black uppercase tracking-[.2em] text-blue-800">Editorial preview only</p>
      <h2 className="mt-2 text-2xl font-black text-[#071b34]">See how it works — planned placement</h2>
      <p className="mt-3 leading-7 text-slate-700">No walkthrough video is attached. This section stays hidden from readers until a real video, poster, and text alternative have been reviewed.</p>
      {previewSequence ? <p className="mt-4 text-sm font-semibold text-slate-700">Planned sequence: {previewSequence}.</p> : null}
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

function editorialTarget(item, contractorGuide, audience, action) {
  const selectedAudience = audience || item.audience || item.public_audience;
  const selectedAction = action || item.next_action || 'create_project';
  const context = new URLSearchParams({
    source: 'improvement_library',
    template_id: String(item.id),
    article: item.slug,
    audience: selectedAudience,
    cta: selectedAction,
  });
  if (contractorGuide?.intent) context.set('intent', contractorGuide.intent);
  if (selectedAction === 'sign_up') {
    const continuation = new URLSearchParams({
      source: 'improvement_library',
      article: item.slug,
      audience: selectedAudience,
      cta: 'sign_up',
    });
    if (contractorGuide?.intent) continuation.set('intent', contractorGuide.intent);
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
    if (selectedAudience === 'contractor')
      return `/signup?${context}`;
    context.set(
      'role',
      selectedAudience === 'property_manager'
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
