import React, { useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
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

const WORKFLOW = [
  "Capture the customer and job",
  "Prepare the estimate",
  "Review and approve the agreement",
  "Track work, milestones, and payments",
  "Keep records, warranties, and project history",
];

const AUDIENCES = [
  {
    icon: BriefcaseBusiness,
    title: "For contractors",
    text: "Manage customers, estimates, projects, teams, payments, and field records.",
  },
  {
    icon: Home,
    title: "For homeowners",
    text: "Review documents, follow progress, communicate, and keep property records.",
  },
  {
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
    <div className="divide-y divide-white/10 overflow-hidden rounded-2xl border border-white/12 bg-slate-950/35">
      {items.map((item) => {
        const open = openItemId === item.id;
        const buttonId = `${idPrefix}-button-${item.id}`;
        const panelId = `${idPrefix}-panel-${item.id}`;
        return (
          <article key={item.id} data-testid={`product-question-${item.id}`}>
            <h4>
              <button
                id={buttonId}
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => onToggle(item)}
                className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm font-semibold leading-6 text-white transition hover:bg-white/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300 sm:px-5 sm:text-base"
              >
                <span>{item.question}</span>
                <ChevronDown
                  className={`h-5 w-5 shrink-0 text-sky-300 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </h4>
            <div
              id={panelId}
              role="region"
              aria-labelledby={buttonId}
              hidden={!open}
              className="px-4 pb-5 pr-10 text-sm leading-6 text-sky-50/78 sm:px-5 sm:pr-14"
            >
              <p>{item.answer}</p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function ProductOverviewModal({ visible, onClose, navigate }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [openItemId, setOpenItemId] = useState("");
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const tabListRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setActiveTab("overview");
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
      containerClassName="h-[100dvh] max-h-[100dvh] bg-[#071a3a] text-white sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:max-w-5xl sm:rounded-3xl sm:border sm:border-white/14"
      bodyClassName="h-full max-h-full overflow-y-auto overscroll-contain p-0"
    >
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-10 border-b border-white/10 bg-[#071a3a]/95 px-[max(1rem,env(safe-area-inset-left))] pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:pt-4">
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
            className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-slate-950/35 p-1"
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
                    selected ? "bg-blue-600 text-white shadow" : "text-sky-100/72 hover:bg-white/6 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex-1 px-[max(1rem,env(safe-area-inset-left))] py-5 sm:px-6 sm:py-6">
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
            <p className="mt-3 max-w-3xl text-sm leading-6 text-sky-50/76 sm:text-base">
              MyHomeBro brings customers, estimates, agreements, payments, project updates, messages,
              and property records into one guided workspace.
            </p>
            <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {WORKFLOW.map((step, index) => (
                <li key={step} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-300 text-xs font-bold text-slate-950">
                    {index + 1}
                  </span>
                  <span className="mt-3 block text-sm font-semibold leading-5 text-white">{step}</span>
                </li>
              ))}
            </ol>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              {AUDIENCES.map(({ icon: Icon, title, text }) => (
                <article key={title} className="rounded-2xl border border-sky-300/15 bg-blue-950/30 p-4">
                  <Icon className="h-5 w-5 text-amber-300" aria-hidden="true" />
                  <h4 className="mt-3 font-semibold text-white">{title}</h4>
                  <p className="mt-2 text-sm leading-6 text-sky-50/72">{text}</p>
                </article>
              ))}
            </div>
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
            hidden={activeTab !== "questions"}
            tabIndex={0}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-2xl font-semibold">Common questions</h3>
                <p className="mt-2 text-sm leading-6 text-sky-50/72">
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
                  className="min-h-11 self-start rounded-xl px-3 text-sm font-semibold text-amber-200 hover:bg-amber-300/8 hover:text-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:self-auto"
                >
                  View all questions
                </button>
              ) : null}
            </div>
            <div className="mt-5 space-y-7">
              {showAllQuestions ? (
                PUBLIC_FAQ_CATEGORIES.map((category) => (
                  <section key={category.id} aria-labelledby={`product-category-${category.id}`}>
                    <h4
                      id={`product-category-${category.id}`}
                      className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-200"
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

        <footer className="sticky bottom-0 border-t border-white/10 bg-[#071a3a]/96 px-[max(1rem,env(safe-area-inset-left))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
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
                className="min-h-11 rounded-xl border border-white/16 px-4 py-2 text-sm font-semibold text-white hover:bg-white/8 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              >
                Create Free Account
              </button>
            </div>
            <div className="flex items-center justify-center gap-4 text-sm font-semibold sm:justify-end">
              <button type="button" onClick={() => goTo("login", "/login")} className="min-h-11 text-sky-200 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                Log In
              </button>
              <button type="button" onClick={() => goTo("support", "/login")} className="min-h-11 text-sky-200 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">
                Contact Support
              </button>
            </div>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
