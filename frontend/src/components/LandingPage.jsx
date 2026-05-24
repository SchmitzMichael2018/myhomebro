// src/components/LandingPage.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  FileText,
  Home,
  Lock,
  MessageSquareText,
  Play,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";
import logo from "../assets/myhomebro_logo.png";

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
      className="min-h-screen overflow-x-hidden bg-[linear-gradient(135deg,#020617_0%,#061d3d_48%,#0f172a_100%)] text-white"
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
            <button type="button" onClick={() => scrollTo("resources")} className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50">
              Resources
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
              className="rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200/60 hover:from-blue-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
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
          </div>
        </div>

        <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pb-20 sm:pt-20 lg:px-8 lg:pb-24 lg:pt-24">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-amber-300/28 bg-amber-300/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Residential, commercial, and contractor-ready
          </div>

          <h1 data-testid="landing-hero-heading" className="mx-auto mt-7 max-w-5xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
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
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-6 py-4 text-base font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200/60 hover:from-blue-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              Start a Project
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
        &copy; {new Date().getFullYear()} MyHomeBro
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
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          {platformRowOne.map((item) => (
            <InfoCard key={item.title} {...item} />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
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
    <div className={`rounded-3xl border border-white/10 bg-slate-950/28 p-5 shadow-xl shadow-slate-950/12 ${wide ? "md:p-6" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-300/22 bg-blue-500/8 text-blue-200">
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
    <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-18 sm:px-6 sm:py-20 lg:px-8">
      <h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">How It Works</h2>
      <div className="mt-12 grid gap-7 md:grid-cols-5">
        {howItWorks.map(({ icon: Icon, title, text }, index) => (
          <div key={title} className="relative text-center">
            {index < howItWorks.length - 1 ? (
              <div className="absolute left-[calc(50%+2.5rem)] top-9 hidden w-[calc(100%-5rem)] border-t border-dashed border-sky-200/18 md:block" />
            ) : null}
            <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-blue-300/20 bg-blue-500/8 text-blue-250">
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
    <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
      <div>
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

      <div data-testid="landing-video-preview" className="rounded-[2rem] border border-white/12 bg-slate-950/34 p-3 shadow-2xl shadow-slate-950/24">
        <div className="relative min-h-[22rem] overflow-hidden rounded-[1.55rem] bg-[linear-gradient(135deg,rgba(3,7,18,0.40),rgba(15,23,42,0.88)),linear-gradient(135deg,#1e3a8a_0%,#0f172a_52%,#92400e_100%)]">
          <div className="absolute inset-6 rounded-[1.25rem] border border-white/10 bg-white/[0.04]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              aria-label="Play MyHomeBro preview"
              className="flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/12 text-white shadow-2xl shadow-slate-950/40 backdrop-blur transition hover:bg-white/18 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
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
        <div className="mt-4 flex flex-wrap gap-2">
          {featureChips.map((chip) => (
            <span key={chip} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-sky-50/76">
              {chip}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function AudienceCards({ navigate }) {
  return (
    <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-8 sm:px-6 lg:grid-cols-2 lg:px-8">
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
        isHomeowner ? "border-blue-300/24" : "border-amber-300/24"
      }`}
    >
      <div className="grid h-full md:grid-cols-[1.05fr_0.95fr]">
        <div className="p-6 sm:p-8">
          <div className={`text-xs font-semibold uppercase tracking-[0.18em] ${isHomeowner ? "text-sky-300" : "text-amber-200"}`}>
            {eyebrow}
          </div>
          <h2 className="mt-4 whitespace-pre-line text-3xl font-semibold leading-tight text-white">
            {title.replace(". ", ".\n")}
          </h2>
          <div className="mt-6 space-y-3">
            {bullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-3 text-sm leading-6 text-sky-50/76">
                <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${isHomeowner ? "text-sky-300" : "text-amber-300"}`} aria-hidden="true" />
                {bullet}
              </div>
            ))}
          </div>
          <div className="mt-7 flex flex-col items-start gap-3">
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
        <div className={`min-h-72 border-t border-white/10 p-6 md:border-l md:border-t-0 ${isHomeowner ? "bg-blue-500/5" : "bg-amber-300/5"}`}>
          <div
            className={`flex h-full min-h-64 items-center justify-center overflow-hidden rounded-[1.5rem] border p-6 ${
              isHomeowner
                ? "border-blue-300/18 bg-[linear-gradient(135deg,rgba(37,99,235,0.16),rgba(15,23,42,0.70)),linear-gradient(160deg,#0f172a_0%,#1e3a8a_55%,#78350f_100%)]"
                : "border-amber-300/18 bg-[linear-gradient(135deg,rgba(245,158,11,0.13),rgba(15,23,42,0.76)),linear-gradient(160deg,#111827_0%,#1e3a8a_48%,#451a03_100%)]"
            }`}
          >
            {isHomeowner ? (
              <div className="relative h-44 w-56">
                <div className="absolute bottom-0 left-4 right-4 h-24 rounded-t-3xl border border-blue-200/25 bg-slate-950/50" />
                <div className="absolute bottom-20 left-8 h-20 w-40 rotate-[-4deg] rounded-t-3xl border border-amber-200/28 bg-amber-300/12" />
                <div className="absolute bottom-6 left-20 h-16 w-16 rounded-t-2xl bg-blue-500/25" />
                <Home className="absolute bottom-9 left-[5.75rem] h-10 w-10 text-sky-100" aria-hidden="true" />
              </div>
            ) : (
              <div className="relative flex h-48 w-48 items-center justify-center">
                <div className="absolute h-44 w-32 rounded-[2.5rem] border border-amber-200/22 bg-slate-950/55" />
                <div className="absolute top-5 h-16 w-16 rounded-full border border-amber-200/25 bg-amber-300/12" />
                <div className="absolute bottom-10 rounded-2xl border border-amber-200/22 bg-blue-950/70 px-5 py-4 text-center shadow-xl shadow-slate-950/40">
                  <img src={logo} alt="" className="mx-auto h-10 w-10 rounded-lg object-cover" />
                  <div className="mt-2 text-sm font-bold text-white">MyHome<span className="text-amber-300">Bro</span></div>
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
      <div className="grid gap-6 rounded-3xl border border-white/12 bg-white/[0.052] p-6 shadow-2xl shadow-slate-950/18 backdrop-blur md:grid-cols-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/28 bg-amber-300/8 text-amber-200">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">Built on trust. Focused on results.</h2>
              <p className="mt-2 text-sm leading-6 text-sky-50/68">We&apos;re here to help you every step of the way.</p>
            </div>
          </div>
        </div>
        <TrustNote icon={UsersRound} title="Homeowners and growing" text="Built for people who want clearer project records and contractor communication." />
        <TrustNote icon={CircleDollarSign} title="Average homeowner rating" text="Trust signals and reviews will appear as verified customer data grows." />
        <TrustNote icon={FileText} title="Projects started across the U.S. and Canada" text="Supporting residential and commercial planning without overpromising fake metrics." />
        <div id="resources" className="md:col-span-4 border-t border-white/10 pt-4 text-sm font-semibold">
          <a href="/legal/terms-of-service/" className="mr-4 text-sky-300 hover:text-sky-200">Terms of Service</a>
          <a href="/legal/privacy-policy/" className="text-sky-300 hover:text-sky-200">Privacy Policy</a>
        </div>
      </div>
    </section>
  );
}

function TrustNote({ icon: Icon, title, text }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/22 p-4">
      <Icon className="h-6 w-6 text-blue-300" aria-hidden="true" />
      <div className="mt-3 font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-6 text-sky-50/66">{text}</p>
    </div>
  );
}
