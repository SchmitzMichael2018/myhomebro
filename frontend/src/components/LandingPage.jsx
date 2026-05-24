// src/components/LandingPage.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Globe2,
  Home,
  Lock,
  MessageSquareText,
  Play,
  ShieldCheck,
  Sparkles,
  Star,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import logo from "../assets/myhomebro_logo.png";
import homeownerCardImage from "../assets/homeowner-card.jpg";
import contractorCardImage from "../assets/contractor-card.jpg";
import kitchenPreviewImage from "../assets/kitchen-preview.jpg";

const platformRowOne = [
  {
    icon: Lock,
    title: "Secure & Private",
    text: "Your information stays organized and shared only with the contractors you choose.",
  },
  {
    icon: ShieldCheck,
    title: "Escrow Protected",
    text: "Use escrow-supported payments for clearer project funding and release milestones.",
  },
  {
    icon: Sparkles,
    title: "AI-Powered",
    text: "Turn rough project ideas into clearer scope, planning notes, and next steps.",
  },
  {
    icon: ClipboardList,
    title: "Organized & Clear",
    text: "Keep details, documents, decisions, and updates in one project workspace.",
  },
];

const platformRowTwo = [
  {
    icon: Building2,
    title: "Residential & Commercial",
    text: "Plan home projects, remodels, repairs, commercial buildouts, and maintenance work.",
  },
  {
    icon: BriefcaseBusiness,
    title: "Contractor Platform Built-In",
    text: "Contractors can manage customers, agreements, milestones, payments, and project records.",
  },
];

const howItWorks = [
  { icon: Wrench, title: "Share Your Project", text: "Tell us what you want to get done in your own words." },
  { icon: ClipboardList, title: "We Organize It", text: "We shape your details into a clearer contractor-ready project plan." },
  { icon: UsersRound, title: "We Find Local Pros", text: "We help surface trusted local contractors that fit the work." },
  { icon: MessageSquareText, title: "Compare & Connect", text: "Review options, ask questions, and choose the right fit." },
  { icon: Home, title: "Get It Done", text: "Manage documents, updates, payments, and next steps in one place." },
];

const previewBullets = [
  "AI-powered project planning",
  "Matches you with trusted pros",
  "Escrow-secured payments",
  "Real-time updates & messaging",
  "All your project docs in one place",
];

const featureChips = ["AI Planning", "Escrow Security", "Match & Connect", "Project Management"];

export default function LandingPage() {
  const navigate = useNavigate();
  const [loginOpen, setLoginOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setLoginOpen(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") setLoginOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div
      data-testid="landing-page"
      className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_50%_13%,rgba(37,99,235,0.22),transparent_26%),linear-gradient(135deg,#020617_0%,#061d3d_48%,#0f172a_100%)] text-white"
    >
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/82 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-3 rounded-2xl text-left focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            aria-label="Go to MyHomeBro homepage"
          >
            <img src={logo} alt="MyHomeBro" className="h-10 w-10 rounded-xl object-cover shadow-lg shadow-blue-950/30" />
            <div className="text-2xl font-bold tracking-tight">
              MyHome<span className="text-amber-300">Bro</span>
            </div>
          </button>

          <div className="order-3 flex w-full flex-wrap items-center justify-center gap-1 text-sm font-semibold text-sky-50/82 lg:order-2 lg:w-auto">
            <button type="button" onClick={() => scrollTo("how-it-works")} className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50">
              How It Works
            </button>
            <button type="button" onClick={() => scrollTo("for-homeowners")} className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50">
              For Homeowners
            </button>
            <button type="button" onClick={() => scrollTo("for-contractors")} className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50">
              For Contractors
            </button>
            <button type="button" onClick={() => scrollTo("resources")} className="inline-flex items-center gap-1 rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50">
              Resources
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scrollTo("about")} className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50">
              About Us
            </button>
          </div>

          <div className="relative order-2 flex items-center gap-3 lg:order-3" ref={menuRef}>
            <button
              type="button"
              data-testid="landing-sign-in-button"
              onClick={() => setLoginOpen((open) => !open)}
              aria-expanded={loginOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-2 rounded-xl border border-white/18 bg-slate-950/45 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:border-sky-200/35 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              Log In
              <ChevronDown className={`h-4 w-4 transition ${loginOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => navigate("/start-project")}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200/60 hover:from-blue-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Start a Project
            </button>

            {loginOpen ? (
              <LoginDropdown navigate={navigate} />
            ) : null}
          </div>
        </nav>
      </header>

      <main>
        <div data-testid="landing-maintenance-notice" className="border-b border-white/10 bg-blue-950/24">
          <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 py-2.5 text-center text-sm text-sky-50/78 sm:px-6 lg:px-8">
            <ShieldCheck className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
            <span className="font-semibold text-white">We&apos;re making improvements to serve you better.</span>
            <span className="hidden text-xs text-sky-100/55 sm:inline">Some features may be temporarily unavailable while updates are in progress.</span>
            <a href="/legal/terms-of-service/" className="hidden text-xs font-semibold text-sky-300 hover:text-sky-200 sm:inline">Learn more</a>
            <X className="ml-auto hidden h-4 w-4 text-sky-100/65 md:block" aria-hidden="true" />
          </div>
        </div>

        <section className="mx-auto max-w-6xl px-4 pb-14 pt-12 text-center sm:px-6 sm:pb-16 sm:pt-16 lg:px-8 lg:pb-18 lg:pt-18">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-amber-300/55 bg-amber-300/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200 shadow-[0_0_22px_rgba(251,191,36,0.12)]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            The smarter way to build, remodel & manage
          </div>

          <h1 data-testid="landing-hero-heading" className="mx-auto mt-6 max-w-5xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
            Everything you need to plan, hire, and manage your project.
            <span className="block text-amber-300">All in one place.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-sky-50/78">
            MyHomeBro connects homeowners with trusted contractors and gives them the tools, security, and clarity to get projects done right.
          </p>

          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              data-testid="landing-start-project-intake-button"
              onClick={() => navigate("/start-project")}
              className="inline-flex min-w-60 items-center justify-center gap-3 rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200/60 hover:from-blue-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              <span className="text-left leading-tight">
                <span className="block">Start a Project</span>
                <span className="block text-xs font-medium text-white/78">It&apos;s free to get started</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => scrollTo("how-it-works")}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/18 bg-white/[0.04] px-6 py-4 text-base font-semibold text-white transition hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
            >
              <Play className="h-5 w-5 text-amber-300" aria-hidden="true" />
              How It Works
            </button>
          </div>

          <div className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-sky-50/82">
            {["No Obligation", "Always Free", "Secure & Private"].map((item) => (
              <div key={item} className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-amber-300" aria-hidden="true" />
                {item}
              </div>
            ))}
          </div>
        </section>

        <PlatformStrip />
        <HowItWorks />
        <VideoPreview />
        <AudienceCards navigate={navigate} />
        <TrustBand />
      </main>

      <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-sky-50/62">
        <div>&copy; {new Date().getFullYear()} MyHomeBro</div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-semibold">
          <a href="/legal/terms-of-service/" className="text-sky-300 hover:text-sky-200">
            Terms of Service
          </a>
          <a href="/legal/privacy-policy/" className="text-sky-300 hover:text-sky-200">
            Privacy Policy
          </a>
        </div>
      </footer>
    </div>
  );
}

function LoginDropdown({ navigate }) {
  return (
    <div
      role="menu"
      aria-label="Log in options"
      className="absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/15 bg-slate-950/96 shadow-2xl shadow-slate-950/50 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">Log In</div>
        <X className="h-4 w-4 text-sky-100/55" aria-hidden="true" />
      </div>

      <div className="space-y-4 p-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">Homeowners</div>
          <div className="mt-2 text-sm font-semibold text-white">View Your Project</div>
          <p className="mt-1 text-sm leading-6 text-sky-50/72">
            Check updates, progress, documents, and messages from your contractor.
          </p>
          <button
            type="button"
            onClick={() => navigate("/portal")}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/22 transition hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
          >
            Homeowner Log In
          </button>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Contractors</div>
          <div className="mt-2 text-sm font-semibold text-white">Contractor Log In</div>
          <p className="mt-1 text-sm leading-6 text-sky-50/72">
            Manage projects, clients, documents, and payments.
          </p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-3 w-full rounded-xl border border-sky-300/35 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-sky-50 transition hover:bg-sky-400/10 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
          >
            Contractor Log In
          </button>
          <button
            type="button"
            onClick={() => navigate("/signup")}
            className="mt-3 text-sm font-semibold text-amber-200 hover:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300/50"
          >
            Contractors: Sign Up
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformStrip() {
  return (
    <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-white/16 bg-slate-950/18 shadow-2xl shadow-slate-950/18 backdrop-blur">
        <div className="grid gap-0 divide-y divide-white/10 md:grid-cols-4 md:divide-x md:divide-y-0">
          {platformRowOne.map((item) => (
            <InfoCard key={item.title} {...item} />
          ))}
        </div>
        <div className="grid gap-0 border-t border-white/10 md:grid-cols-2 md:divide-x md:divide-white/10">
          {platformRowTwo.map((item) => (
            <InfoCard key={item.title} {...item} wide />
          ))}
        </div>
      </div>
    </section>
  );
}

function InfoCard({ icon: Icon, title, text, wide = false }) {
  return (
    <div className={`bg-slate-950/18 p-5 ${wide ? "md:p-6" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-blue-300/35 bg-blue-500/10 text-blue-200 shadow-[0_0_24px_rgba(37,99,235,0.12)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="font-semibold text-white">{title}</div>
      </div>
      <p className="mt-3 text-sm leading-6 text-sky-50/68">{text}</p>
    </div>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
      <div className="flex items-center justify-center gap-6">
        <div className="hidden h-px w-24 bg-gradient-to-r from-transparent to-amber-300/70 sm:block" />
        <h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">How It Works</h2>
        <div className="hidden h-px w-24 bg-gradient-to-l from-transparent to-amber-300/70 sm:block" />
      </div>
      <div className="mt-10 grid gap-7 md:grid-cols-5">
        {howItWorks.map(({ icon: Icon, title, text }, index) => (
          <div key={title} className="relative text-center">
            {index < howItWorks.length - 1 ? (
              <div className="absolute left-[calc(50%+2.5rem)] top-8 hidden w-[calc(100%-5rem)] border-t border-dashed border-sky-200/28 md:block" />
            ) : null}
            <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-blue-300/24 bg-blue-500/8 text-blue-250 shadow-[0_0_26px_rgba(37,99,235,0.12)]">
              <div className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-amber-300 text-xs font-bold text-slate-950">
                {index + 1}
              </div>
              <Icon className="h-7 w-7 text-blue-300" aria-hidden="true" />
            </div>
            <div className="mt-5 font-semibold text-white">{title}</div>
            <p className="mx-auto mt-3 max-w-48 text-sm leading-6 text-sky-50/68">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function VideoPreview() {
  return (
    <section className="mx-auto px-4 pb-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 overflow-hidden rounded-[2rem] border border-white/12 bg-slate-950/30 p-4 shadow-2xl shadow-slate-950/18 backdrop-blur lg:grid-cols-[0.58fr_1.42fr]">
      <div className="p-3 sm:p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">Platform Preview</div>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">See MyHomeBro in Action</h2>
        <p className="mt-4 max-w-xl text-base leading-7 text-sky-50/72">
          A quick look at how we help you plan, connect, and manage with confidence.
        </p>
        <div className="mt-7 space-y-3">
          {previewBullets.map((item) => (
            <div key={item} className="flex items-center gap-3 text-sm text-sky-50/78">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
              {item}
            </div>
          ))}
        </div>
      </div>

      <div data-testid="landing-video-preview" className="relative">
        <div className="grid gap-3 md:grid-cols-[1fr_13rem]">
          <div className="relative min-h-[20rem] overflow-hidden rounded-[1.45rem] border border-white/12 bg-slate-950 shadow-xl shadow-slate-950/22">
          <img
            src={kitchenPreviewImage}
            alt="Warm kitchen remodel planning preview"
            data-testid="landing-video-preview-asset"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.18),rgba(2,6,23,0.02)_44%,rgba(2,6,23,0.30)),radial-gradient(circle_at_50%_50%,transparent_38%,rgba(2,6,23,0.34)_100%)]" />
          <div className="absolute inset-x-8 top-8 h-20 rounded-full bg-amber-200/16 blur-2xl" />
          <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-slate-950/90 via-slate-950/28 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              aria-label="Play MyHomeBro preview"
              className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-blue-700 shadow-2xl shadow-slate-950/45 transition hover:scale-[1.03] focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              <Play className="ml-1 h-9 w-9" aria-hidden="true" />
            </button>
          </div>
          <div className="absolute bottom-5 left-5 right-5 rounded-2xl border border-white/10 bg-slate-950/62 p-4 backdrop-blur">
            <div className="text-sm font-semibold text-white">Kitchen remodel workspace</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {[
                ["Scope", "AI organized"],
                ["Escrow", "Funding ready"],
                ["Docs", "All in one place"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-white/[0.06] px-3 py-2">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-sky-100/52">{label}</div>
                  <div className="mt-1 text-xs font-semibold text-sky-50">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
          <div className="hidden overflow-hidden rounded-[1.45rem] border border-white/12 bg-slate-950/65 p-3 md:block">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <img src={logo} alt="" className="h-5 w-5 rounded object-cover" />
                MyHome<span className="text-amber-300">Bro</span>
              </div>
              <div className="h-2 w-2 rounded-full bg-emerald-300" />
            </div>
            <div className="space-y-2 text-xs font-semibold text-sky-50/72">
              {["Overview", "Tasks", "Messages", "Documents", "Schedule", "Budgets"].map((item, index) => (
                <div key={item} className={`rounded-lg px-3 py-2 ${index === 0 ? "bg-blue-600/55 text-white" : "bg-white/[0.04]"}`}>
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-3 min-h-28 rounded-xl border border-white/10 bg-[linear-gradient(135deg,rgba(251,191,36,0.24),rgba(37,99,235,0.20)),linear-gradient(150deg,#0f172a,#78350f)]" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {featureChips.map((chip) => (
            <span key={chip} className="rounded-full border border-white/10 bg-slate-950/35 px-3 py-1.5 text-xs font-semibold text-sky-50/78">
              {chip}
            </span>
          ))}
        </div>
      </div>
      </div>
    </section>
  );
}

function AudienceCards({ navigate }) {
  return (
    <section className="mx-auto grid max-w-7xl gap-5 px-4 pb-8 sm:px-6 lg:grid-cols-2 lg:px-8">
      <AudienceCard
        id="for-homeowners"
        eyebrow="For Homeowners"
        title="Plan with confidence. Get it done right."
        bullets={[
          "Organize your project the smart way",
          "Get matched with trusted local contractors",
          "Compare and choose at your pace",
          "It's free, secure, and commitment-free",
        ]}
        primaryLabel="Start a Project"
        secondaryLabel="View Your Project / Log In"
        onPrimary={() => navigate("/start-project")}
        onSecondary={() => navigate("/portal")}
        tone="homeowner"
      />
      <AudienceCard
        id="for-contractors"
        eyebrow="For Contractors"
        title="More quality projects. Less guesswork."
        bullets={[
          "Get matched with qualified homeowners",
          "Manage projects in one simple platform",
          "Get paid securely with escrow",
          "Grow your business and your reputation",
        ]}
        primaryLabel="Contractor Sign Up"
        secondaryLabel="Contractor Log In"
        onPrimary={() => navigate("/signup")}
        onSecondary={() => navigate("/login")}
        tone="contractor"
      />
    </section>
  );
}

function AudienceCard({ id, eyebrow, title, bullets, primaryLabel, secondaryLabel, onPrimary, onSecondary, tone }) {
  const isHomeowner = tone === "homeowner";
  return (
    <div
      id={id}
      data-testid={`landing-${tone}-card`}
      className={`overflow-hidden rounded-3xl border bg-white/[0.055] shadow-2xl shadow-slate-950/20 backdrop-blur ${
        isHomeowner ? "border-blue-300/28" : "border-amber-300/30"
      }`}
    >
      <div className="grid h-full md:grid-cols-[0.86fr_1.08fr]">
        <div className="p-5 sm:p-6">
          <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isHomeowner ? "text-sky-300" : "text-amber-200"}`}>
            {eyebrow}
          </div>
          <h2 className="mt-4 whitespace-pre-line text-3xl font-semibold leading-tight text-white">
            {title.replace(". ", ".\n")}
          </h2>
          <div className="mt-4 space-y-2">
            {bullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-3 text-sm leading-6 text-sky-50/76">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${isHomeowner ? "text-sky-300" : "text-amber-300"}`} aria-hidden="true" />
                {bullet}
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-col items-start gap-3">
            <button
              type="button"
              onClick={onPrimary}
              className="rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-950/22 transition hover:border-amber-200/60 hover:from-blue-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              onClick={onSecondary}
              data-testid={isHomeowner ? "landing-customer-portal-button" : undefined}
              className="text-sm font-semibold text-sky-300 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
            >
              {secondaryLabel} →
            </button>
          </div>
        </div>
        <div className={`min-h-60 border-t border-white/10 p-3.5 md:border-l md:border-t-0 ${isHomeowner ? "bg-blue-500/5" : "bg-amber-300/5"}`}>
          <div
            className={`relative flex h-full min-h-56 items-center justify-center overflow-hidden rounded-[1.5rem] border p-4 ${
              isHomeowner
                ? "border-blue-300/22 bg-[radial-gradient(circle_at_84%_16%,rgba(96,165,250,0.34),transparent_25%),radial-gradient(circle_at_18%_18%,rgba(251,191,36,0.22),transparent_22%),linear-gradient(160deg,#06142d_0%,#12306b_54%,#7c3b08_100%)]"
                : "border-amber-300/26 bg-[radial-gradient(circle_at_78%_18%,rgba(251,191,36,0.30),transparent_24%),radial-gradient(circle_at_18%_18%,rgba(37,99,235,0.26),transparent_22%),linear-gradient(160deg,#071121_0%,#10285c_48%,#4a1d04_100%)]"
            }`}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_36%,rgba(2,6,23,0.46)_100%)]" />
            <div className={`absolute inset-y-0 w-44 rounded-full blur-2xl ${isHomeowner ? "-right-10 bg-blue-400/18" : "right-0 bg-amber-300/18"}`} />
            <div className={`absolute h-72 w-72 rounded-full border ${isHomeowner ? "-right-24 bottom-[-7rem] border-amber-200/36" : "-right-20 bottom-[-6rem] border-amber-200/34"}`} />
            <div className={`absolute h-80 w-80 rounded-full border ${isHomeowner ? "-right-28 bottom-[-7.75rem] border-blue-200/22" : "-right-24 bottom-[-7.25rem] border-blue-200/22"}`} />
            {isHomeowner ? (
              <div data-testid="landing-homeowner-image-panel" className="relative h-56 w-full max-w-md overflow-hidden rounded-[1.25rem] border border-blue-200/20 shadow-2xl shadow-slate-950/35">
                <img
                  src={homeownerCardImage}
                  alt="Upscale residential project exterior at dusk"
                  data-testid="landing-homeowner-visual-asset"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.04),rgba(2,6,23,0.10)_48%,rgba(2,6,23,0.50)),radial-gradient(circle_at_78%_28%,rgba(251,191,36,0.16),transparent_32%)]" />
                <div className="absolute -right-20 bottom-[-6.25rem] h-64 w-64 rounded-full border border-amber-200/38" />
                <div className="absolute -right-24 bottom-[-6.8rem] h-72 w-72 rounded-full border border-blue-200/18" />
                <div className="absolute bottom-4 left-4 rounded-2xl border border-white/14 bg-slate-950/54 px-4 py-3 shadow-xl shadow-slate-950/25 backdrop-blur">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">Project ready</div>
                  <div className="mt-1 text-sm font-semibold text-white">Organized for local pros</div>
                </div>
              </div>
            ) : (
              <div data-testid="landing-contractor-image-panel" className="relative h-56 w-full max-w-md overflow-hidden rounded-[1.25rem] border border-amber-200/22 shadow-2xl shadow-slate-950/38">
                <img
                  src={contractorCardImage}
                  alt="Professional contractor reviewing a home project"
                  data-testid="landing-contractor-visual-asset"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.08),rgba(2,6,23,0.04)_52%,rgba(2,6,23,0.56)),radial-gradient(circle_at_75%_24%,rgba(251,191,36,0.15),transparent_32%)]" />
                <div
                  data-testid="landing-contractor-sweatshirt-logo"
                  className="pointer-events-none absolute left-[34%] top-[43%] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-slate-950/12 p-1.5 shadow-[0_0_22px_rgba(251,191,36,0.18)]"
                >
                  <img
                    src={logo}
                    alt=""
                    className="h-16 w-16 object-contain opacity-95 mix-blend-screen contrast-125 saturate-125 sm:h-20 sm:w-20"
                  />
                </div>
                <div className="absolute -right-20 bottom-[-6.25rem] h-64 w-64 rounded-full border border-amber-200/38" />
                <div className="absolute -right-24 bottom-[-6.8rem] h-72 w-72 rounded-full border border-blue-200/18" />
                <div className="absolute bottom-4 right-4 rounded-2xl border border-amber-200/18 bg-slate-950/58 px-4 py-3 shadow-xl shadow-slate-950/28 backdrop-blur">
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <img src={logo} alt="" className="h-7 w-7 rounded-lg object-cover" />
                    MyHome<span className="text-amber-300">Bro</span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-sky-100/72">Contractor workspace</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustBand() {
  return (
    <section id="about" className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
      <div className="rounded-3xl border border-white/12 bg-white/[0.052] shadow-2xl shadow-slate-950/18 backdrop-blur">
        <div className="grid gap-0 divide-y divide-white/10 p-6 md:grid-cols-4 md:divide-x md:divide-y-0">
        <div className="pb-5 md:pb-0 md:pr-6">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/35 bg-amber-300/10 text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.12)]">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Built on trust. Focused on results.</h2>
              <p className="mt-2 text-sm leading-6 text-sky-50/68">We&apos;re here to help you every step of the way.</p>
            </div>
          </div>
        </div>
        <TrustMetric icon={UsersRound} value="10K+" label="Homeowners and growing" tone="blue" />
        <TrustMetric icon={Star} value="4.9" label="Average homeowner rating" tone="amber" stars />
        <TrustMetric icon={Globe2} value="Thousands" label="of projects started across the U.S. and Canada" tone="blue" />
        </div>
        <div id="resources" className="border-t border-white/10 px-6 py-4 text-sm font-semibold">
          <a href="/legal/terms-of-service/" className="mr-4 text-sky-300 hover:text-sky-200">Terms of Service</a>
          <a href="/legal/privacy-policy/" className="text-sky-300 hover:text-sky-200">Privacy Policy</a>
        </div>
      </div>
    </section>
  );
}

function TrustMetric({ icon: Icon, value, label, tone = "blue", stars = false }) {
  return (
    <div className="px-0 py-5 md:px-6 md:py-0">
      <div className="flex items-center gap-4">
        <Icon className={`h-9 w-9 ${tone === "amber" ? "text-amber-300" : "text-blue-300"}`} aria-hidden="true" />
        <div>
          <div className="flex items-center gap-3">
            <div className="text-3xl font-semibold text-white">{value}</div>
            {stars ? <div className="text-amber-300">★★★★★</div> : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-sky-50/70">{label}</p>
        </div>
      </div>
    </div>
  );
}
