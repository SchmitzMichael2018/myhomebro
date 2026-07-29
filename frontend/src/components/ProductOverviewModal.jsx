import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  Home,
  Play,
  Sparkles,
  X,
} from "lucide-react";

import {
  PUBLIC_FAQ_CATEGORIES,
  PUBLIC_FAQ_CURATED_ITEMS,
} from "../lib/publicFaq.js";
import Modal from "./Modal.jsx";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "watch", label: "Watch" },
  { id: "questions", label: "Questions" },
];

const DEFAULT_AUDIENCE = "contractor";

const AUDIENCE_PATHWAYS = {
  contractor: [
    {
      title: "Capture the customer and job",
      description: "Collect the request, property details, photos, and field notes.",
    },
    {
      title: "Prepare the estimate",
      description: "Build scope, pricing, options, and next steps.",
    },
    {
      title: "Send the agreement",
      description: "Confirm responsibilities, schedule, milestones, and payment terms.",
    },
    {
      title: "Manage work and payments",
      description: "Coordinate customers, team members, progress, approvals, and funding.",
    },
    {
      title: "Close out and keep records",
      description: "Preserve documents, warranties, receipts, photos, and project history.",
    },
  ],
  homeowner: [
    {
      title: "Start or join a project",
      description: "Share what you need or access a contractor-created project.",
    },
    {
      title: "Review estimates",
      description: "Compare scope, pricing, selections, and project expectations.",
    },
    {
      title: "Approve the agreement",
      description: "Review responsibilities, milestones, schedule, and payment terms.",
    },
    {
      title: "Follow progress and payments",
      description: "See updates, communicate, review work, and track payment activity.",
    },
    {
      title: "Keep your property records",
      description: "Store agreements, receipts, photos, warranties, and project history.",
    },
  ],
  property_manager: [
    {
      title: "Add the property or unit",
      description: "Organize properties, units, occupants, vendors, and existing records.",
    },
    {
      title: "Capture a maintenance need",
      description: "Record the issue, photos, urgency, location, and supporting details.",
    },
    {
      title: "Coordinate vendor work",
      description: "Review requests, assign work, collect estimates, and approve next steps.",
    },
    {
      title: "Track completion and payment",
      description: "Follow updates, documentation, approvals, invoices, and completion.",
    },
    {
      title: "Maintain property history",
      description: "Preserve maintenance, warranty, equipment, vendor, and unit records.",
    },
  ],
};

const AUDIENCES = [
  {
    id: "contractor",
    icon: BriefcaseBusiness,
    title: "For contractors",
    text: "Manage customers, estimates, projects, teams, payments, and field records.",
  },
  {
    id: "homeowner",
    icon: Home,
    title: "For homeowners",
    text: "Review documents, follow progress, communicate, and keep property records.",
  },
  {
    id: "property_manager",
    icon: Building2,
    title: "For property managers",
    text: "Track units, maintenance, vendors, warranties, and property history.",
  },
];

function trackProductOverview(event, detail = {}) {
  window.dispatchEvent(
    new CustomEvent("mhb:analytics", {
      detail: { event, category: "product_overview", ...detail },
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
                ? "border-sky-600 bg-slate-800"
                : "border-slate-700 bg-slate-900 hover:border-slate-600"
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
                  open ? "bg-slate-800" : "bg-slate-900 hover:bg-slate-800"
                }`}
              >
                <span>{item.question}</span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-sky-300 transition-transform motion-reduce:transition-none ${open ? "rotate-180 text-amber-300" : ""}`}
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

export default function ProductOverviewModal({ visible, onClose, navigate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [activeAudience, setActiveAudience] = useState(DEFAULT_AUDIENCE);
  const [openItemId, setOpenItemId] = useState("");
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const tabListRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setActiveTab("overview");
    setActiveAudience(DEFAULT_AUDIENCE);
    setOpenItemId("");
    setShowAllQuestions(false);
  }, [visible]);

  const selectTab = (tabId, focus = false) => {
    setActiveTab(tabId);
    trackProductOverview("product_overview_tab_selected", { tab: tabId });
    if (focus) {
      requestAnimationFrame(() => {
        tabListRef.current?.querySelector(`[data-tab="${tabId}"]`)?.focus();
      });
    }
  };

  const handleTabKeyDown = (event) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectTab(TABS[nextIndex].id, true);
  };

  const toggleQuestion = (item) => {
    setOpenItemId((current) => {
      const next = current === item.id ? "" : item.id;
      if (next) {
        trackProductOverview("product_question_opened", { question_id: item.id });
      }
      return next;
    });
  };

  const selectAudience = (audience) => {
    setActiveAudience(audience);
    trackProductOverview("product_audience_selected", {
      audience,
      source: "product_overview",
    });
  };

  const goTo = (destination, path) => {
    trackProductOverview("product_overview_cta_clicked", { destination });
    onClose("cta");
    navigate(path);
  };

  return (
    <Modal
      visible={visible}
      title="See MyHomeBro in action"
      onClose={onClose}
      testId="product-overview-modal"
      hideHeader
      labelledBy="product-overview-title"
      overlayClassName="bg-slate-950/72 px-0 sm:px-4 sm:py-6"
      containerClassName="h-[100dvh] max-h-[100dvh] !bg-slate-950 text-white sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:max-w-5xl sm:rounded-3xl sm:border sm:border-slate-700"
      bodyClassName="h-full max-h-full overflow-y-auto overscroll-contain p-0"
    >
      <div data-testid="product-overview-surface" className="flex min-h-full flex-col bg-slate-950 text-slate-50">
        <header className="sticky top-0 z-10 border-b border-slate-700 bg-slate-950/95 px-[max(1rem,env(safe-area-inset-left))] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
                Product tour
              </div>
              <h2 id="product-overview-title" className="mt-1 text-xl font-semibold text-white sm:text-2xl">
                See MyHomeBro in action
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close product overview"
              data-autofocus
              onClick={() => onClose("close_button")}
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
                    selected ? "bg-blue-600 text-white shadow-sm" : "text-slate-200 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex-1 bg-slate-950 px-[max(1rem,env(safe-area-inset-left))] py-4 sm:px-6 sm:py-5">
          <section
            id="product-panel-overview"
            role="tabpanel"
            aria-labelledby="product-tab-overview"
            hidden={activeTab !== "overview"}
            tabIndex={0}
          >
            <h3 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              See how MyHomeBro keeps projects moving
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              MyHomeBro brings customers, estimates, agreements, payments, project updates, messages,
              and property records into one guided workspace.
            </p>
            <div className="mt-5 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold uppercase tracking-[0.14em] text-sky-200">
                Choose your view
              </h4>
              <span className="text-xs text-slate-400">Pathway updates below</span>
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
                        ? "border-sky-400 bg-sky-950/70"
                        : "border-slate-700 bg-slate-900 hover:border-slate-600 hover:bg-slate-800"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Icon className={`h-5 w-5 ${selected ? "text-amber-300" : "text-sky-300"}`} aria-hidden="true" />
                      <span className="font-semibold text-white">{title}</span>
                      {selected ? (
                        <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-sky-200">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Selected
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate-300">{text}</span>
                  </button>
                );
              })}
            </div>
            <ol
              key={activeAudience}
              data-testid="product-overview-workflow"
              data-audience={activeAudience}
              aria-live="polite"
              className="mt-4 grid gap-3 transition-opacity motion-reduce:transition-none sm:grid-cols-2 lg:grid-cols-5"
            >
              {AUDIENCE_PATHWAYS[activeAudience].map((step, index) => (
                <li
                  key={step.title}
                  data-testid={`product-workflow-step-${index + 1}`}
                  className="relative flex min-h-full gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3 lg:block"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-300 text-xs font-bold text-slate-950">
                    {index + 1}
                  </span>
                  <div className="min-w-0 lg:mt-3">
                    <h4 className="text-sm font-semibold leading-5 text-white">{step.title}</h4>
                    <p className="mt-1 text-xs leading-5 text-slate-300">{step.description}</p>
                  </div>
                  {index < AUDIENCE_PATHWAYS[activeAudience].length - 1 ? (
                    <ArrowRight
                      className="absolute -right-2.5 top-1/2 z-[1] hidden h-5 w-5 -translate-y-1/2 rounded-full bg-slate-950 p-0.5 text-sky-300 lg:block"
                      aria-hidden="true"
                    />
                  ) : null}
                </li>
              ))}
            </ol>
          </section>

          <section
            id="product-panel-watch"
            role="tabpanel"
            aria-labelledby="product-tab-watch"
            hidden={activeTab !== "watch"}
            tabIndex={0}
          >
            <h3 className="text-2xl font-semibold">Watch the project workflow</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-50/74">
              Watch how a customer request becomes an organized project—from intake and estimating
              through agreements, milestones, and records.
            </p>
            <div
              data-testid="product-video-fallback"
              className="mt-5 aspect-video w-full overflow-hidden rounded-2xl border border-white/12 bg-[radial-gradient(circle_at_50%_42%,rgba(37,99,235,0.24),transparent_38%),linear-gradient(135deg,#020617,#071a3a)]"
            >
              <div className="flex h-full flex-col items-center justify-center px-5 text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full border border-sky-300/25 bg-blue-500/10">
                  <Play className="ml-1 h-7 w-7 text-sky-200" aria-hidden="true" />
                </span>
                <h4 className="mt-4 text-lg font-semibold text-white">Demo video coming soon</h4>
                <p className="mt-2 max-w-md text-sm leading-6 text-sky-50/68">
                  The product overview and common questions are available now while the approved
                  demonstration is being prepared.
                </p>
              </div>
            </div>
          </section>

          <section
            id="product-panel-questions"
            role="tabpanel"
            aria-labelledby="product-tab-questions"
            data-testid="product-questions-panel"
            hidden={activeTab !== "questions"}
            tabIndex={0}
            className="bg-slate-950"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-2xl font-semibold">Common questions</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Clear answers about the platform, payments, AI assistance, privacy, and records.
                </p>
              </div>
              {!showAllQuestions ? (
                <button
                  type="button"
                  data-testid="product-view-all-questions"
                  onClick={() => {
                    setShowAllQuestions(true);
                    setOpenItemId("");
                    trackProductOverview("product_view_all_questions_clicked");
                  }}
                  className="min-h-11 self-start rounded-xl border border-amber-400/70 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:border-amber-300 hover:bg-amber-300/15 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:self-auto"
                >
                  View all questions
                </button>
              ) : null}
            </div>
            <div className="mt-4 space-y-6">
              {showAllQuestions ? (
                PUBLIC_FAQ_CATEGORIES.map((category) => (
                  <section key={category.id} aria-labelledby={`product-category-${category.id}`}>
                    <h4
                      id={`product-category-${category.id}`}
                      className="mb-2 border-l-2 border-amber-300 pl-3 text-xs font-semibold uppercase tracking-[0.16em] text-sky-200"
                    >
                      {category.label}
                    </h4>
                    <FaqAccordion
                      items={category.items}
                      openItemId={openItemId}
                      onToggle={toggleQuestion}
                      idPrefix={`product-${category.id}`}
                    />
                  </section>
                ))
              ) : (
                <FaqAccordion
                  items={PUBLIC_FAQ_CURATED_ITEMS}
                  openItemId={openItemId}
                  onToggle={toggleQuestion}
                  idPrefix="product-curated"
                />
              )}
            </div>
          </section>
        </div>

        <footer className="sticky bottom-0 border-t border-slate-700 bg-slate-950/96 px-[max(1rem,env(safe-area-inset-left))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => goTo("start_project", "/start-project")}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Start a Project
              </button>
              <button
                type="button"
                onClick={() => goTo("create_account", "/create-account")}
                className="min-h-11 rounded-xl border border-sky-500 bg-slate-900 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Create Free Account
              </button>
            </div>
            <div className="flex items-center justify-center gap-4 text-sm font-semibold sm:justify-end">
              <button type="button" onClick={() => goTo("login", "/login")} className="min-h-11 rounded-lg px-2 text-sky-300 underline-offset-4 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                Log In
              </button>
              <button type="button" onClick={() => goTo("support", "/login")} className="min-h-11 rounded-lg px-2 text-sky-300 underline-offset-4 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                Contact Support
              </button>
            </div>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
