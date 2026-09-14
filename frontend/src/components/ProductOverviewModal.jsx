import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  Home,
  Sparkles,
  X,
} from 'lucide-react';

import contractorWalkthroughPoster from '../assets/product-overview/myhomebro-contractor-walkthrough-poster.jpg?url';
import contractorWalkthroughSource from '../assets/product-overview/myhomebro-contractor-walkthrough.mp4?url';
import contractorWalkthroughTranscript from '../assets/product-overview/myhomebro-contractor-walkthrough.txt?no-inline';
import contractorWalkthroughCaptions from '../assets/product-overview/myhomebro-contractor-walkthrough.vtt?no-inline';
import homeownerWalkthroughPoster from '../assets/product-overview/myhomebro-homeowner-walkthrough-poster.jpg?url';
import homeownerWalkthroughSource from '../assets/product-overview/myhomebro-homeowner-walkthrough.mp4?url';
import homeownerWalkthroughTranscript from '../assets/product-overview/myhomebro-homeowner-walkthrough.txt?no-inline';
import homeownerWalkthroughCaptions from '../assets/product-overview/myhomebro-homeowner-walkthrough.vtt?no-inline';
import propertyManagerWalkthroughPoster from '../assets/product-overview/myhomebro-property-manager-walkthrough-poster.jpg?url';
import propertyManagerWalkthroughSource from '../assets/product-overview/myhomebro-property-manager-walkthrough.mp4?url';
import propertyManagerWalkthroughTranscript from '../assets/product-overview/myhomebro-property-manager-walkthrough.txt?no-inline';
import propertyManagerWalkthroughCaptions from '../assets/product-overview/myhomebro-property-manager-walkthrough.vtt?no-inline';
import { PUBLIC_FAQ_ITEMS } from '../lib/publicFaq.js';
import Modal from './Modal.jsx';

const TABS = [
  { id: 'overview', label: 'Tour' },
  { id: 'watch', label: 'Videos' },
  { id: 'questions', label: 'Quick Answers' },
];

const DEFAULT_AUDIENCE = '';

const AUDIENCE_PATHWAYS = {
  contractor: [
    {
      title: 'Capture the customer and job',
      description:
        'Collect the request, property details, photos, and field notes.',
      userAction:
        'Add a new lead or customer request, including the location, timing, photos, and known job details.',
      platformAction:
        'MyHomeBro keeps the request, contact information, files, and follow-up in one organized record.',
      result:
        'You have a project-ready record instead of scattered calls, texts, and notes.',
    },
    {
      title: 'Prepare the estimate',
      description: 'Build scope, pricing, options, and next steps.',
      userAction:
        'Review the request, clarify the scope, and enter your pricing, selections, and schedule assumptions.',
      platformAction:
        'Project Assistant can organize details and suggest reviewable scope or milestone language.',
      result:
        'The customer receives a clearer estimate that you control and approve before sending.',
    },
    {
      title: 'Send the agreement',
      description:
        'Confirm responsibilities, schedule, milestones, and payment terms.',
      userAction:
        'Review the agreement, make any necessary edits, sign it, and send it to the customer.',
      platformAction:
        'MyHomeBro connects the approved scope to signatures, amendments, milestones, and payment terms.',
      result: 'Both parties can see what was agreed to and what happens next.',
    },
    {
      title: 'Manage work and payments',
      description:
        'Coordinate customers, team members, progress, approvals, and funding.',
      userAction:
        'Assign work, document progress, complete milestones, and submit eligible payment requests.',
      platformAction:
        'MyHomeBro tracks work, messages, evidence, approvals, invoices, and payment status together.',
      result:
        'The project stays understandable even when several people and payments are involved.',
    },
    {
      title: 'Close out and keep records',
      description:
        'Preserve documents, warranties, receipts, photos, and project history.',
      userAction:
        'Finish the closeout, confirm payment status, and retain the final project records.',
      platformAction:
        'MyHomeBro keeps the signed documents, photos, receipts, warranties, and activity history connected.',
      result:
        'You and the customer retain a traceable record after the job is complete.',
    },
  ],
  homeowner: [
    {
      title: 'Start or join a project',
      description:
        'Share what you need or access a contractor-created project.',
      userAction:
        'Describe the work, location, timing, budget range, and attach any useful photos.',
      platformAction:
        'MyHomeBro organizes the request and routes it through the project path you choose.',
      result:
        'A participating contractor can understand the request and follow up without committing you to hire.',
    },
    {
      title: 'Review estimates',
      description:
        'Compare scope, pricing, selections, and project expectations.',
      userAction:
        'Read the proposed work, ask questions, and confirm that important details are included.',
      platformAction:
        'MyHomeBro keeps the estimate, messages, options, and supporting information together.',
      result:
        'You can make a more informed decision before accepting an estimate.',
    },
    {
      title: 'Approve the agreement',
      description:
        'Review responsibilities, milestones, schedule, and payment terms.',
      userAction:
        'Review the complete agreement and sign only when the scope, price, schedule, and terms are right.',
      platformAction:
        'MyHomeBro preserves signatures and uses documented amendments when signed terms need to change.',
      result:
        'The project begins from a shared, traceable set of expectations.',
    },
    {
      title: 'Follow progress and payments',
      description:
        'See updates, communicate, review work, and track payment activity.',
      userAction:
        'Follow milestone updates, review completed work, communicate, and respond to payment requests.',
      platformAction:
        'MyHomeBro connects project evidence and messages to the applicable work and payment records.',
      result:
        'You can understand what is ready, what needs attention, and what has already been approved.',
    },
    {
      title: 'Keep your property records',
      description:
        'Store agreements, receipts, photos, warranties, and project history.',
      userAction:
        'Keep the final project information and use the appropriate warranty or support workflow if needed.',
      platformAction:
        'MyHomeBro preserves your authorized property, project, payment, and warranty records.',
      result:
        'Important home-improvement records remain easier to find after the project ends.',
    },
  ],
  property_manager: [
    {
      title: 'Add the property or unit',
      description:
        'Organize properties, units, occupants, vendors, and existing records.',
      userAction:
        'Create the property or unit context and add the people and existing information needed for the work.',
      platformAction:
        'MyHomeBro keeps authorized property, occupant, vendor, and maintenance information connected.',
      result:
        'Each request begins with clearer ownership and location context.',
    },
    {
      title: 'Capture a maintenance need',
      description:
        'Record the issue, photos, urgency, location, and supporting details.',
      userAction:
        'Submit or review the maintenance need and document the affected area and urgency.',
      platformAction:
        'MyHomeBro organizes the request, attachments, status, and authorized communication.',
      result:
        'The person coordinating the repair receives a more actionable record.',
    },
    {
      title: 'Coordinate vendor work',
      description:
        'Review requests, assign work, collect estimates, and approve next steps.',
      userAction:
        'Choose the appropriate vendor path, clarify access, and approve the documented work plan.',
      platformAction:
        'MyHomeBro keeps the request, estimate, assignments, and approvals tied to the property record.',
      result:
        'Vendors and stakeholders can work from the same documented expectations.',
    },
    {
      title: 'Track completion and payment',
      description:
        'Follow updates, documentation, approvals, invoices, and completion.',
      userAction:
        'Monitor progress, review completion evidence, and respond to authorized payment activity.',
      platformAction:
        'MyHomeBro provides a connected view of work status, messages, documents, and payment records.',
      result: 'You can see what is complete, pending, or awaiting a decision.',
    },
    {
      title: 'Maintain property history',
      description:
        'Preserve maintenance, warranty, equipment, vendor, and unit records.',
      userAction:
        'Close the work and retain the records needed for future maintenance and warranty follow-up.',
      platformAction:
        'MyHomeBro maintains the authorized history without making it publicly available.',
      result:
        'Future property decisions start with better records and less guesswork.',
    },
  ],
};

const AUDIENCES = [
  {
    id: 'contractor',
    icon: BriefcaseBusiness,
    title: 'For contractors',
    text: 'Manage customers, estimates, projects, teams, payments, and field records.',
  },
  {
    id: 'homeowner',
    icon: Home,
    title: 'For homeowners',
    text: 'Review documents, follow progress, communicate, and keep property records.',
  },
  {
    id: 'property_manager',
    icon: Building2,
    title: 'For property managers',
    text: 'Track units, maintenance, vendors, warranties, and property history.',
  },
];

const AUDIENCE_CTA = {
  contractor: {
    primary: { label: 'Create Contractor Account', path: '/signup' },
    secondary: { label: 'Contractor Log In', path: '/login' },
  },
  homeowner: {
    primary: { label: 'Start a Project', path: '/start-project' },
    secondary: { label: 'Create Customer Account', path: '/create-account' },
  },
  property_manager: {
    primary: {
      label: 'Submit Maintenance Request',
      path: '/maintenance-request',
    },
    secondary: { label: 'Create an Account', path: '/create-account' },
  },
};

// Video URLs remain deployment configuration so an approved demo can be enabled
// without changing the tour. A video is shown only when both its source and
// captions are configured; posters and transcripts are optional enhancements.
const AUDIENCE_VIDEOS = {
  contractor: {
    title: 'From customer request to paid project',
    description:
      'A contractor-focused tour of estimates, agreements, milestones, team coordination, and payments.',
    duration: 'About 2 minutes',
    source:
      import.meta.env.VITE_PRODUCT_TOUR_CONTRACTOR_VIDEO_URL ||
      contractorWalkthroughSource,
    poster:
      import.meta.env.VITE_PRODUCT_TOUR_CONTRACTOR_POSTER_URL ||
      contractorWalkthroughPoster,
    captions:
      import.meta.env.VITE_PRODUCT_TOUR_CONTRACTOR_CAPTIONS_URL ||
      contractorWalkthroughCaptions,
    transcript:
      import.meta.env.VITE_PRODUCT_TOUR_CONTRACTOR_TRANSCRIPT_URL ||
      contractorWalkthroughTranscript,
    aiNarration: true,
  },
  homeowner: {
    title: 'From project idea to organized closeout',
    description:
      'A homeowner-focused tour of requests, estimates, agreements, progress reviews, payments, and records.',
    duration: 'About 90 seconds',
    source:
      import.meta.env.VITE_PRODUCT_TOUR_HOMEOWNER_VIDEO_URL ||
      homeownerWalkthroughSource,
    poster:
      import.meta.env.VITE_PRODUCT_TOUR_HOMEOWNER_POSTER_URL ||
      homeownerWalkthroughPoster,
    captions:
      import.meta.env.VITE_PRODUCT_TOUR_HOMEOWNER_CAPTIONS_URL ||
      homeownerWalkthroughCaptions,
    transcript:
      import.meta.env.VITE_PRODUCT_TOUR_HOMEOWNER_TRANSCRIPT_URL ||
      homeownerWalkthroughTranscript,
    aiNarration: true,
  },
  property_manager: {
    title: 'From maintenance request to property record',
    description:
      'A property-focused tour of maintenance intake, vendor coordination, approvals, completion, and history.',
    duration: 'About 1 minute 45 seconds',
    source:
      import.meta.env.VITE_PRODUCT_TOUR_PROPERTY_MANAGER_VIDEO_URL ||
      propertyManagerWalkthroughSource,
    poster:
      import.meta.env.VITE_PRODUCT_TOUR_PROPERTY_MANAGER_POSTER_URL ||
      propertyManagerWalkthroughPoster,
    captions:
      import.meta.env.VITE_PRODUCT_TOUR_PROPERTY_MANAGER_CAPTIONS_URL ||
      propertyManagerWalkthroughCaptions,
    transcript:
      import.meta.env.VITE_PRODUCT_TOUR_PROPERTY_MANAGER_TRANSCRIPT_URL ||
      propertyManagerWalkthroughTranscript,
    aiNarration: true,
  },
};

const QUICK_ANSWER_IDS = {
  contractor: [
    'contractor-tools',
    'estimates-agreements',
    'teams',
    'contractor-platform-fees',
    'ai-decisions',
  ],
  homeowner: [
    'after-project-request',
    'homeowner-cost',
    'payment-method-differences',
    'homeowner-refund-request',
    'dispute-process',
  ],
  property_manager: [
    'who-is-it-for',
    'property-records',
    'project-visibility',
    'warranty-vs-dispute',
  ],
};

function itemsById(ids) {
  return ids
    .map((id) => PUBLIC_FAQ_ITEMS.find((item) => item.id === id))
    .filter(Boolean);
}

function trackProductOverview(event, detail = {}) {
  window.dispatchEvent(
    new CustomEvent('mhb:analytics', {
      detail: { event, category: 'product_overview', ...detail },
    })
  );
}

function FaqAccordion({ items, openItemId, onToggle, idPrefix }) {
  return (
    <div
      data-testid={`${idPrefix}-accordion`}
      className="grid gap-2 md:grid-cols-2"
    >
      {items.map((item) => {
        const open = openItemId === item.id;
        const buttonId = `${idPrefix}-button-${item.id}`;
        const panelId = `${idPrefix}-panel-${item.id}`;
        return (
          <article
            key={item.id}
            data-testid={`product-question-${item.id}`}
            className={`self-start overflow-hidden rounded-xl border transition-colors motion-reduce:transition-none ${
              open
                ? 'border-sky-600 bg-slate-800'
                : 'border-slate-700 bg-slate-900 hover:border-slate-600'
            }`}
          >
            <h4>
              <button
                id={buttonId}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => onToggle(item)}
                className={`flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold leading-5 text-slate-50 transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 sm:text-[15px] ${
                  open ? 'bg-slate-800' : 'bg-slate-900 hover:bg-slate-800'
                }`}
              >
                <span>{item.question}</span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-sky-300 transition-transform motion-reduce:transition-none ${open ? 'rotate-180 text-amber-300' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </h4>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!open}
              className="border-t border-slate-700 bg-slate-950/70 px-4 py-3 text-sm leading-6 text-slate-300"
            >
              <p className="max-w-prose">{item.answer}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function WorkflowDetail({ step, testId }) {
  if (!step) return null;
  return (
    <div
      data-testid={testId}
      className="grid gap-3 rounded-xl border border-sky-500/45 bg-sky-950/35 p-4 sm:grid-cols-3"
    >
      {[
        ['What you do', step.userAction],
        ['How MyHomeBro helps', step.platformAction],
        ['What you get', step.result],
      ].map(([label, text]) => (
        <div key={label}>
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
            {label}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-200">{text}</p>
        </div>
      ))}
    </div>
  );
}

function VideoCard({ audienceId, video }) {
  const ready = Boolean(video.source && video.captions);
  return (
    <article
      data-testid={`product-video-${audienceId}`}
      className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900"
    >
      {ready ? (
        <video
          controls
          preload="metadata"
          playsInline
          poster={video.poster || undefined}
          className="aspect-video w-full bg-slate-950"
          aria-label={video.title}
        >
          <source src={video.source} type="video/mp4" />
          <track
            kind="captions"
            src={video.captions}
            srcLang="en"
            label="English"
            default
          />
        </video>
      ) : (
        <div className="flex min-h-32 items-center justify-center bg-[radial-gradient(circle_at_50%_20%,rgba(37,99,235,0.22),transparent_48%),#020617] p-5 text-center">
          <div>
            <Clapperboard
              className="mx-auto h-7 w-7 text-sky-300"
              aria-hidden="true"
            />
            <div className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
              Video in preparation
            </div>
          </div>
        </div>
      )}
      <div className="p-4">
        <h4 className="font-semibold text-white">{video.title}</h4>
        <p className="mt-1 text-sm leading-6 text-slate-300">
          {video.description}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold text-sky-200">
          <span>{video.duration}</span>
          {ready && video.transcript ? (
            <a
              href={video.transcript}
              className="underline underline-offset-4 hover:text-white"
            >
              Read transcript
            </a>
          ) : null}
        </div>
        {ready && video.aiNarration ? (
          <p className="mt-3 text-xs leading-5 text-slate-400">
            This walkthrough uses AI-generated narration.
          </p>
        ) : null}
      </div>
    </article>
  );
}

export default function ProductOverviewModal({
  visible,
  initialTab = 'overview',
  onClose,
  navigate,
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const [activeAudience, setActiveAudience] = useState(DEFAULT_AUDIENCE);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [openItemId, setOpenItemId] = useState('');
  const tabListRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setActiveTab(
      TABS.some((tab) => tab.id === initialTab) ? initialTab : 'overview'
    );
    setActiveAudience(DEFAULT_AUDIENCE);
    setActiveStepIndex(0);
    setOpenItemId('');
  }, [initialTab, visible]);

  const selectTab = (tabId, focus = false) => {
    setActiveTab(tabId);
    trackProductOverview('product_overview_tab_selected', { tab: tabId });
    if (focus) {
      requestAnimationFrame(() => {
        tabListRef.current?.querySelector(`[data-tab="${tabId}"]`)?.focus();
      });
    }
  };

  const handleTabKeyDown = (event) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex;
    if (event.key === 'ArrowRight')
      nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(TABS[nextIndex].id, true);
  };

  const toggleQuestion = (item) => {
    setOpenItemId((current) => {
      const next = current === item.id ? '' : item.id;
      if (next) {
        trackProductOverview('product_question_opened', {
          question_id: item.id,
        });
      }
      return next;
    });
  };

  const selectAudience = (audience) => {
    setActiveAudience(audience);
    setActiveStepIndex(0);
    setOpenItemId('');
    trackProductOverview('product_audience_selected', {
      audience,
      source: 'product_overview',
    });
  };

  const goTo = (destination, path) => {
    trackProductOverview('product_overview_cta_clicked', { destination });
    onClose('cta');
    navigate(path);
  };

  const activePathway = activeAudience ? AUDIENCE_PATHWAYS[activeAudience] : [];
  const activeStep = activePathway[activeStepIndex] || null;
  const quickQuestions = activeAudience
    ? itemsById(QUICK_ANSWER_IDS[activeAudience])
    : itemsById([
        'what-is-myhomebro',
        'who-is-it-for',
        'contractor-marketplace',
        'ai-decisions',
      ]);
  const activeCta = activeAudience ? AUDIENCE_CTA[activeAudience] : null;

  return (
    <Modal
      visible={visible}
      title="Explore MyHomeBro"
      onClose={onClose}
      testId="product-overview-modal"
      hideHeader
      labelledBy="product-overview-title"
      overlayClassName="bg-slate-950/72 px-0 sm:px-4 sm:py-6"
      containerClassName="flex h-[100dvh] max-h-[100dvh] flex-col !bg-slate-950 text-white sm:h-[calc(100dvh-3rem)] sm:max-h-[calc(100dvh-3rem)] sm:max-w-5xl sm:rounded-3xl sm:border sm:border-slate-700"
      bodyClassName="min-h-0 flex-1 overflow-hidden p-0"
    >
      <div
        data-testid="product-overview-surface"
        className="flex h-full min-h-0 flex-col bg-slate-950 text-slate-50"
      >
        <header className="z-10 shrink-0 border-b border-slate-700 bg-slate-950/95 px-[max(1rem,env(safe-area-inset-left))] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                Product tour
              </div>
              <h2
                id="product-overview-title"
                className="mt-1 text-xl font-semibold text-white sm:text-2xl"
              >
                Explore MyHomeBro
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close product overview"
              data-autofocus
              onClick={() => onClose('close_button')}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-white/14 text-sky-50 transition hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div
            ref={tabListRef}
            role="tablist"
            tabIndex={-1}
            aria-label="Product overview sections"
            onKeyDown={handleTabKeyDown}
            className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-slate-700 bg-slate-900 p-1"
          >
            {TABS.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  id={`product-tab-${tab.id}`}
                  data-tab={tab.id}
                  aria-selected={selected}
                  aria-controls={`product-panel-${tab.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectTab(tab.id)}
                  className={`min-h-11 rounded-lg px-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                    selected
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        <div
          data-testid="product-overview-scroll-area"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-950 px-[max(1rem,env(safe-area-inset-left))] py-4 sm:px-6 sm:py-5"
        >
          <section
            id="product-panel-overview"
            role="tabpanel"
            aria-labelledby="product-tab-overview"
            hidden={activeTab !== 'overview'}
            tabIndex={0}
          >
            <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Choose your role and follow the workflow
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              See what you do, how MyHomeBro helps, and what each step produces.
              Nothing is submitted or changed during this tour.
            </p>
            <div className="mt-5 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-200">
                Choose your view
              </h4>
              <span className="text-xs text-slate-400">
                {activeAudience ? 'Select any step for details' : 'Start here'}
              </span>
            </div>
            <div
              data-testid="product-overview-audiences"
              aria-label="Choose your product overview audience"
              className="mt-2 grid gap-2 sm:grid-cols-3"
            >
              {AUDIENCES.map(({ id, icon: Icon, title, text }) => {
                const selected = activeAudience === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    data-testid={`product-audience-${id}`}
                    onClick={() => selectAudience(id)}
                    className={`min-h-11 rounded-xl border p-3 text-left transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                      selected
                        ? 'border-sky-400 bg-sky-950/70'
                        : 'border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon
                        className={`h-5 w-5 ${selected ? 'text-amber-300' : 'text-sky-300'}`}
                        aria-hidden="true"
                      />
                      <span className="font-semibold text-white">{title}</span>
                      {selected ? (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-200">
                          <CheckCircle2
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                          Selected
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-300">
                      {text}
                    </span>
                  </button>
                );
              })}
            </div>
            {activeAudience ? (
              <>
                <ol
                  key={activeAudience}
                  data-testid="product-overview-workflow"
                  data-audience={activeAudience}
                  aria-live="polite"
                  className="mt-4 grid gap-3 transition-opacity motion-reduce:transition-none sm:grid-cols-2 lg:grid-cols-5"
                >
                  {activePathway.map((step, index) => {
                    const selected = activeStepIndex === index;
                    return (
                      <li key={step.title} className="relative min-w-0">
                        <button
                          type="button"
                          data-testid={`product-workflow-step-${index + 1}`}
                          aria-expanded={selected}
                          onClick={() => {
                            setActiveStepIndex(index);
                            trackProductOverview(
                              'product_workflow_step_opened',
                              {
                                audience: activeAudience,
                                step: index + 1,
                              }
                            );
                          }}
                          className={`flex min-h-full w-full gap-3 rounded-xl border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 lg:block ${
                            selected
                              ? 'border-sky-400 bg-sky-950/60'
                              : 'border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800'
                          }`}
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              selected
                                ? 'bg-amber-300 text-slate-950'
                                : 'bg-slate-700 text-sky-100'
                            }`}
                          >
                            {index + 1}
                          </span>
                          <span className="min-w-0 lg:mt-3 lg:block">
                            <span className="block text-sm font-semibold leading-5 text-white">
                              {step.title}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-slate-300">
                              {step.description}
                            </span>
                          </span>
                        </button>
                        {index < activePathway.length - 1 ? (
                          <ArrowRight
                            className="absolute -right-2.5 top-1/2 z-[1] hidden h-5 w-5 -translate-y-1/2 rounded-full bg-slate-950 p-0.5 text-sky-300 lg:block"
                            aria-hidden="true"
                          />
                        ) : null}
                        {selected ? (
                          <div className="mt-2 lg:hidden">
                            <WorkflowDetail
                              step={step}
                              testId="product-workflow-detail-mobile"
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-3 hidden lg:block">
                  <WorkflowDetail
                    step={activeStep}
                    testId="product-workflow-detail-desktop"
                  />
                </div>
              </>
            ) : (
              <div
                data-testid="product-overview-role-prompt"
                className="mt-4 rounded-xl border border-dashed border-sky-500/55 bg-sky-950/25 px-4 py-5 text-center"
              >
                <div className="font-semibold text-white">
                  Select the view that best matches you.
                </div>
                <p className="mt-1 text-sm text-slate-300">
                  Your five-step pathway, quick answers, videos, and next action
                  will update automatically.
                </p>
              </div>
            )}
          </section>

          <section
            id="product-panel-watch"
            role="tabpanel"
            aria-labelledby="product-tab-watch"
            hidden={activeTab !== 'watch'}
            tabIndex={0}
          >
            <h3 className="text-2xl font-semibold">Workflow videos</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-50/74">
              Watch available role-specific demonstrations with captions and
              transcripts. Videos still in preparation are clearly identified.
            </p>
            <div
              data-testid="product-video-library"
              className={`mt-5 grid gap-3 ${activeAudience ? 'max-w-2xl' : 'md:grid-cols-3'}`}
            >
              {(activeAudience
                ? [[activeAudience, AUDIENCE_VIDEOS[activeAudience]]]
                : Object.entries(AUDIENCE_VIDEOS)
              ).map(([audienceId, video]) => (
                <VideoCard
                  key={audienceId}
                  audienceId={audienceId}
                  video={video}
                />
              ))}
            </div>
            {!activeAudience ? (
              <p className="mt-4 text-sm text-slate-400">
                Choose a role in the Tour tab to narrow this library to the most
                relevant demonstration.
              </p>
            ) : null}
          </section>

          <section
            id="product-panel-questions"
            role="tabpanel"
            aria-labelledby="product-tab-questions"
            data-testid="product-questions-panel"
            hidden={activeTab !== 'questions'}
            tabIndex={0}
            className="bg-slate-950"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-2xl font-semibold">Quick answers</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {activeAudience
                    ? 'A short set of answers selected for your current view.'
                    : 'Choose a role in the Tour for personalized answers, or start with these essentials.'}
                </p>
              </div>
              <button
                type="button"
                data-testid="product-view-all-questions"
                onClick={() => {
                  goTo('faq', '/faq');
                  trackProductOverview('product_view_all_questions_clicked');
                }}
                className="min-h-11 self-start rounded-xl border border-amber-400/70 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:border-amber-300 hover:bg-amber-300/15 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:self-auto"
              >
                Search all FAQs
              </button>
            </div>
            <div className="mt-4 space-y-6">
              <FaqAccordion
                items={quickQuestions}
                openItemId={openItemId}
                onToggle={toggleQuestion}
                idPrefix="product-curated"
              />
            </div>
          </section>
        </div>

        <footer
          data-testid="product-overview-footer"
          className="z-10 shrink-0 border-t border-slate-700 bg-slate-950/96 px-[max(1rem,env(safe-area-inset-left))] pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:px-6 sm:py-3"
        >
          <div className="flex items-center gap-3 sm:justify-between">
            {activeCta ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    goTo(`${activeAudience}_primary`, activeCta.primary.path)
                  }
                  className="inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:flex-none sm:px-4"
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span className="truncate">{activeCta.primary.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    goTo(
                      `${activeAudience}_secondary`,
                      activeCta.secondary.path
                    )
                  }
                  className="hidden min-h-11 rounded-xl border border-sky-500 bg-slate-900 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:inline-flex sm:items-center"
                >
                  {activeCta.secondary.label}
                </button>
              </div>
            ) : (
              <p className="min-w-0 flex-1 text-xs leading-5 text-slate-300 sm:text-sm">
                Choose your view to see the right next step.
              </p>
            )}
            <div className="flex shrink-0 items-center text-sm font-semibold">
              <button
                type="button"
                onClick={() => goTo('login', '/login')}
                className="min-h-11 rounded-lg px-2 text-sky-300 underline-offset-4 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Log In
              </button>
            </div>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
