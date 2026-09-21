// src/components/LandingPage.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Home,
  Download,
  Menu,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  QrCode,
  UsersRound,
  Wrench,
  X,
} from 'lucide-react';
import logo from '../assets/myhomebro_logo.png';
import homeownerCardImage from '../assets/landing/homeowner-card.png';
import contractorCardImage from '../assets/landing/contractor-card.png';
import kitchenPreviewImage from '../assets/kitchen-preview.jpg';
import { PwaAppIcon, PwaInstallButton } from './PwaInstallAccess.jsx';
import ProductOverviewModal from './ProductOverviewModal.jsx';
import { PWA_FLAGS } from '../lib/pwaFlags.js';
import {
  buildPublicFaqJsonLd,
  PUBLIC_FAQ_CURATED_ITEMS,
} from '../lib/publicFaq.js';

const platformHighlights = [
  {
    icon: Sparkles,
    title: 'Free project planning',
    text: 'Turn an early idea into a clearer project request.',
  },
  {
    icon: UsersRound,
    title: 'Local contractor connections',
    text: 'Connect with participating contractors who fit the work.',
  },
  {
    icon: ShieldCheck,
    title: 'Milestone-based project funding',
    text: 'Fund milestones and release payment as work is approved.',
  },
  {
    icon: ClipboardList,
    title: 'Agreements and records',
    text: 'Keep documents, decisions, and project history together.',
  },
];

const howItWorks = [
  {
    icon: Wrench,
    title: 'Share Your Project',
    text: 'Tell us what you want to get done in your own words.',
    detail:
      'Add the location, timing, budget range, and photos you already have. You can start with a rough idea and refine it before anything is sent.',
  },
  {
    icon: ClipboardList,
    title: 'We Organize It',
    text: 'We shape your details into a clearer contractor-ready project plan.',
    detail:
      'Project Assistant can identify missing details and prepare a clearer description. You review and control the information that becomes part of your request.',
  },
  {
    icon: UsersRound,
    title: 'We Find Local Pros',
    text: 'We help surface participating local contractors that fit the work.',
    detail:
      'Your project details help participating contractors understand the work. Availability and matching depend on the project, location, and contractor participation.',
  },
  {
    icon: MessageSquareText,
    title: 'Compare & Connect',
    text: 'Review options, ask questions, and choose the right fit.',
    detail:
      'Keep estimates, questions, contractor responses, and decisions connected so you can compare the scope—not just the bottom-line price.',
  },
  {
    icon: Home,
    title: 'Get It Done',
    text: 'Manage documents, updates, payments, and next steps in one place.',
    detail:
      'Follow milestones, review work, communicate, and retain agreements, receipts, photos, warranties, and project history in your workspace.',
  },
];

const landingFaqItems = [
  'what-is-myhomebro',
  'after-project-request',
  'homeowner-cost',
  'payment-method-differences',
]
  .map((id) => PUBLIC_FAQ_CURATED_ITEMS.find((item) => item.id === id))
  .filter(Boolean);

export default function LandingPage() {
  const navigate = useNavigate();
  const [loginOpen, setLoginOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [accountRoleOpen, setAccountRoleOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target))
        setLoginOpen(false);
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setLoginOpen(false);
        setAccountRoleOpen(false);
        setMobileMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const scrollTo = (id) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            onClick={() => navigate('/')}
            className="flex items-center gap-3 rounded-2xl text-left focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            aria-label="Go to MyHomeBro homepage"
          >
            <img
              src={logo}
              alt="MyHomeBro"
              className="h-10 w-10 rounded-xl object-cover shadow-lg shadow-blue-950/30"
            />
            <div className="text-2xl font-bold tracking-tight">
              MyHome<span className="text-amber-300">Bro</span>
            </div>
          </button>

          <div className="hidden items-center gap-1 text-sm font-semibold text-sky-50/82 lg:flex">
            <button
              type="button"
              onClick={() => scrollTo('how-it-works')}
              className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
            >
              How It Works
            </button>
            <button
              type="button"
              onClick={() => scrollTo('for-homeowners')}
              className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
            >
              For Customers
            </button>
            <button
              type="button"
              onClick={() => scrollTo('for-contractors')}
              className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
            >
              For Contractors
            </button>
            <button
              type="button"
              data-testid="landing-guided-help-link"
              onClick={() => scrollTo('guided-help')}
              className="rounded-full px-3 py-2 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
            >
              Guided Help
            </button>
          </div>

          <div
            className="relative order-2 flex items-center gap-3 lg:order-3"
            ref={menuRef}
          >
            <PwaInstallButton
              compact
              hideWhenInstalled
              installLabel="Install App"
              className="min-h-11 px-3 max-[374px]:w-11 max-[374px]:px-0 max-[374px]:[&>span:last-child]:sr-only"
              testId="landing-header-pwa-install-button"
            />
            <button
              type="button"
              data-testid="landing-sign-in-button"
              onClick={() => setLoginOpen((open) => !open)}
              aria-expanded={loginOpen}
              aria-haspopup="menu"
              className="inline-flex items-center gap-2 rounded-xl border border-white/18 bg-slate-950/45 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:border-sky-200/35 hover:bg-white/8 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              Log In
              <ChevronDown
                className={`h-4 w-4 transition ${loginOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              data-testid="landing-mobile-menu-button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-expanded={mobileMenuOpen}
              aria-label="Open navigation menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/18 bg-slate-950/45 text-white lg:hidden"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
            {loginOpen ? (
              <LoginDropdown
                navigate={navigate}
                onLoginSelect={() => setLoginOpen(false)}
              />
            ) : null}
          </div>
          {mobileMenuOpen ? (
            <div className="order-4 grid w-full gap-1 border-t border-white/10 pt-3 text-sm font-semibold text-sky-50/82 lg:hidden" data-testid="landing-mobile-menu">
              {[
                ['How It Works', 'how-it-works'],
                ['For Customers', 'for-homeowners'],
                ['For Contractors', 'for-contractors'],
                ['Guided Help', 'guided-help'],
              ].map(([label, id]) => (
                <button key={id} type="button" onClick={() => { setMobileMenuOpen(false); scrollTo(id); }} className="rounded-lg px-3 py-2.5 text-left hover:bg-white/8">
                  {label}
                </button>
              ))}
              <a href="/faq" className="rounded-lg px-3 py-2.5 hover:bg-white/8">FAQs</a>
              <a href="/maintenance-request" data-testid="landing-resident-maintenance-link" className="rounded-lg px-3 py-2.5 text-amber-200 hover:bg-amber-300/10">Resident Maintenance</a>
            </div>
          ) : null}
        </nav>
      </header>

      <main>
        <div
          data-testid="landing-feedback-invitation"
          className="border-b border-white/10 bg-blue-950/24"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 py-2.5 text-center text-sm sm:px-6 lg:px-8">
            <MessageSquareText
              className="h-4 w-4 shrink-0 text-amber-300"
              aria-hidden="true"
            />
            <span className="font-semibold text-white">
              Help us serve you better.
            </span>
            <span className="text-xs text-sky-100/65">
              Have a comment or suggestion about MyHomeBro?
            </span>
            <a
              data-testid="landing-share-comment-link"
              href="mailto:info@myhomebro.com?subject=MyHomeBro%20Feedback"
              className="inline-flex min-h-8 items-center rounded-full border border-sky-300/30 bg-white/8 px-3 text-xs font-semibold text-sky-200 transition hover:border-amber-200/55 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              Share a comment
            </a>
          </div>
        </div>

        <section className="mx-auto max-w-6xl px-4 pb-14 pt-12 text-center sm:px-6 sm:pb-16 sm:pt-16 lg:px-8 lg:pb-18 lg:pt-18">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-amber-300/55 bg-amber-300/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200 shadow-[0_0_22px_rgba(251,191,36,0.12)]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            The smarter way to build, remodel & manage
          </div>

          <h1
            data-testid="landing-hero-heading"
            className="mx-auto mt-6 max-w-5xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            Everything you need to plan, hire, and manage your project.
            <span className="block text-amber-300">All in one place.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-sky-50/78">
            MyHomeBro connects homeowners with participating contractors and
            gives them the tools, security, and clarity to get projects done
            right.
          </p>

          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              data-testid="landing-start-project-intake-button"
              onClick={() => navigate('/start-project')}
              className="inline-flex min-w-60 items-center justify-center gap-3 rounded-xl border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-950/25 transition hover:border-amber-200/60 hover:from-blue-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              <span className="text-left leading-tight">
                <span className="block">Start a Project</span>
                <span className="block text-xs font-medium text-white/78">
                  It&apos;s free to get started
                </span>
              </span>
            </button>
            <button
              type="button"
              data-testid="landing-create-free-account-button"
              onClick={() => setAccountRoleOpen(true)}
              aria-haspopup="dialog"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300/35 bg-amber-300/10 px-6 py-4 text-base font-semibold text-amber-100 transition hover:border-amber-200/70 hover:bg-amber-300/16 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              Create an Account
            </button>
          </div>
          <button
            type="button"
            onClick={() => scrollTo('how-it-works')}
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-300 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
          >
            See How It Works
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>

          <div className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-sky-50/82">
            {['No Obligation', 'Free to Get Started', 'Secure & Private'].map(
              (item) => (
                <div key={item} className="inline-flex items-center gap-2">
                  <CheckCircle2
                    className="h-4 w-4 text-amber-300"
                    aria-hidden="true"
                  />
                  {item}
                </div>
              )
            )}
          </div>
        </section>

        <PlatformStrip />
        {PWA_FLAGS.enabled ? (
          <section
            className="mx-auto max-w-6xl px-4 py-10 sm:px-6"
            data-testid="landing-pwa-install-section"
          >
            <div className="grid gap-5 rounded-3xl border border-amber-300/30 bg-slate-950/35 p-5 shadow-2xl shadow-slate-950/20 backdrop-blur sm:p-7 md:grid-cols-[1fr_auto] md:items-center">
              <div className="flex items-start gap-4">
                <PwaAppIcon className="h-14 w-14 sm:h-16 sm:w-16" />
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-200">
                    <Download className="h-5 w-5" aria-hidden="true" />
                    Take MyHomeBro with you
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Install MyHomeBro
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-50/72">
                    Keep your projects, estimates, messages, agreements, photos,
                    payments, and property records in one place. Install
                    MyHomeBro for faster access from your phone or desktop.
                  </p>
                  <ul
                    className="mt-3 grid gap-1.5 text-sm text-sky-50/82 sm:grid-cols-3"
                    data-testid="landing-pwa-benefits"
                  >
                    {[
                      'Track projects and milestones',
                      'Access estimates, agreements, and payments',
                      'Keep messages, photos, warranties, and records organized',
                    ].map((benefit) => (
                      <li key={benefit} className="flex items-start gap-1.5">
                        <CheckCircle2
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                          aria-hidden="true"
                        />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <PwaInstallButton
                className="min-h-11 w-full md:w-auto"
                installLabel="Install App"
              />
            </div>
          </section>
        ) : null}
        <HowItWorks />
        <AudienceCards navigate={navigate} />
        <VideoPreview navigate={navigate} />
        <TrustBand />
        <RegistrationQrSection navigate={navigate} />
        <LandingFaq navigate={navigate} />
      </main>

      <footer className="border-t border-white/10 px-4 py-6 text-center text-sm text-sky-50/62">
        <div>&copy; {new Date().getFullYear()} MyHomeBro</div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-semibold">
          <a
            href="/legal/terms-of-service/"
            className="text-sky-300 hover:text-sky-200"
          >
            Terms of Service
          </a>
          <a href="/faq" className="text-sky-300 hover:text-sky-200">
            FAQs
          </a>
          <a href="/maintenance-request" data-testid="landing-resident-maintenance-link" className="text-sky-300 hover:text-sky-200">
            Resident Maintenance
          </a>
          <a href="/portal" className="text-sky-300 hover:text-sky-200">
            Customer Login
          </a>
          <a
            href="/legal/privacy-policy/"
            className="text-sky-300 hover:text-sky-200"
          >
            Privacy Policy
          </a>
        </div>
      </footer>
      {accountRoleOpen ? (
        <AccountRoleSelector
          onClose={() => setAccountRoleOpen(false)}
          onSelect={(role) => {
            setAccountRoleOpen(false);
            if (role === 'contractor') {
              window.dispatchEvent(new CustomEvent('mhb:open-signup'));
              return;
            }
            navigate(`/create-account?role=${role}`);
          }}
        />
      ) : null}
    </div>
  );
}

function AccountRoleSelector({ onClose, onSelect }) {
  const roles = [
    {
      id: 'customer',
      icon: Home,
      title: 'Customer',
      text: 'Plan projects, review estimates and agreements, track work, and keep property records.',
    },
    {
      id: 'contractor',
      icon: BriefcaseBusiness,
      title: 'Contractor',
      text: 'Manage customers, estimates, agreements, projects, teams, and payments.',
    },
    {
      id: 'property_manager',
      icon: Building2,
      title: 'Property Manager',
      text: 'Organize properties, maintenance, vendors, documents, warranties, and history.',
    },
  ];

  return (
    <div
      data-testid="landing-account-role-selector"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-role-selector-title"
        className="relative w-full max-w-3xl rounded-3xl border border-white/14 bg-[#071a3a] p-6 shadow-2xl shadow-slate-950/55 sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close account role selector"
          className="absolute right-4 top-4 rounded-xl border border-white/12 p-2 text-sky-100/70 hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-300/60"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="pr-12">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-200">Create an account</div>
          <h2 id="account-role-selector-title" className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
            How will you use MyHomeBro?
          </h2>
          <p className="mt-2 text-sm leading-6 text-sky-50/72">Choose a role to open the correct account setup. One email can support more than one role.</p>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {roles.map(({ id, icon: Icon, title, text }) => (
            <button
              key={id}
              type="button"
              data-testid={`landing-account-role-${id}`}
              onClick={() => onSelect(id)}
              className="group rounded-2xl border border-white/12 bg-white/[0.04] p-5 text-left transition hover:border-amber-300/55 hover:bg-amber-300/10 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              <span className="inline-flex rounded-xl border border-sky-300/25 bg-sky-400/10 p-2 text-sky-200 group-hover:border-amber-300/35 group-hover:text-amber-200">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="mt-4 block text-lg font-semibold text-white">{title}</span>
              <span className="mt-2 block text-sm leading-6 text-sky-50/68">{text}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function LoginDropdown({ navigate, onLoginSelect }) {
  const openLoginModal = (audience) => {
    window.dispatchEvent(
      new CustomEvent('mhb:open-login', { detail: { audience } })
    );
    onLoginSelect?.();
  };
  const openSignupModal = () => {
    window.dispatchEvent(new CustomEvent('mhb:open-signup'));
    onLoginSelect?.();
  };

  return (
    <div
      role="menu"
      aria-label="Log in options"
      data-testid="landing-login-menu"
      className="mhb-landing-login-menu absolute right-0 top-[calc(100%+0.75rem)] z-50 w-[min(22rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.13] bg-[#071a3a] shadow-[0_20px_50px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.04)]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-200">
          Log In
        </div>
        <X className="h-4 w-4 text-sky-100/55" aria-hidden="true" />
      </div>

      <div className="space-y-4 p-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
            Customers
          </div>
          <div className="mt-2 text-sm font-semibold text-white">
            View Your Project
          </div>
          <p className="mt-1 text-sm leading-6 text-sky-50/72">
            Check updates, progress, documents, maintenance, and messages from
            your contractor or property team.
          </p>
          <button
            type="button"
            onClick={() => {
              onLoginSelect?.();
              navigate('/portal');
            }}
            className="mt-3 w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-950/22 transition hover:from-blue-500 hover:to-indigo-500 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
          >
            Customer Log In
          </button>
          <button
            type="button"
            onClick={() => {
              onLoginSelect?.();
              navigate('/register');
            }}
            className="mt-3 w-full rounded-xl border border-amber-300/35 bg-amber-300/10 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:border-amber-200/70 hover:bg-amber-300/16 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
          >
            Create Free Account
          </button>
        </div>

        <div className="border-t border-white/10 pt-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
            Contractors
          </div>
          <div className="mt-2 text-sm font-semibold text-white">
            Contractor Log In
          </div>
          <p className="mt-1 text-sm leading-6 text-sky-50/72">
            Manage projects, clients, documents, and payments.
          </p>
          <button
            type="button"
            onClick={() => openLoginModal('contractor')}
            className="mt-3 w-full rounded-xl border border-sky-300/35 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-sky-50 transition hover:bg-sky-400/10 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
          >
            Contractor Log In
          </button>
          <button
            type="button"
            data-testid="landing-contractor-signup-button"
            onClick={openSignupModal}
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
        <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-white/10 md:grid-cols-4 md:divide-y-0">
          {platformHighlights.map((item) => (
            <InfoCard key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function RegistrationQrSection({ navigate }) {
  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6" data-testid="landing-registration-qr-section">
      <div className="grid gap-5 rounded-2xl border border-amber-300/30 bg-slate-950/38 p-5 shadow-xl shadow-slate-950/20 backdrop-blur md:grid-cols-[1fr_auto] md:items-center md:p-6">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-amber-200">
            <QrCode className="h-5 w-5" aria-hidden="true" />
            Register from your phone
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Ready to get started?</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-50/74">Choose your role and create an account, or scan the code to continue on another device.</p>
          <button
            type="button"
            onClick={() => navigate('/register')}
            className="mt-5 rounded-xl bg-amber-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-white/70"
            data-testid="landing-registration-qr-button"
          >
            Create an Account
          </button>
          <div className="mt-3 text-sm font-semibold text-sky-200">myhomebro.com/register</div>
        </div>
        <div className="mx-auto hidden rounded-2xl bg-white p-3 shadow-xl md:block md:mx-0">
          <img
            src="/api/accounts/public/registration-qr/"
            alt="QR code to create a MyHomeBro account"
            className="h-36 w-36"
            width="208"
            height="208"
            loading="lazy"
            data-testid="landing-registration-qr-image"
          />
        </div>
      </div>
    </section>
  );
}

function InfoCard({ icon: Icon, title, text }) {
  return (
    <div className="bg-slate-950/18 p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-300/35 bg-blue-500/10 text-blue-200">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="font-semibold text-white">{title}</div>
      </div>
      <p className="mt-2 text-xs leading-5 text-sky-50/68 sm:text-sm">{text}</p>
    </div>
  );
}

function HowItWorks() {
  const [activeStep, setActiveStep] = useState(-1);

  return (
    <section
      id="how-it-works"
      className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8"
    >
      <div className="flex items-center justify-center gap-6">
        <div className="hidden h-px w-24 bg-gradient-to-r from-transparent to-amber-300/70 sm:block" />
        <h2 className="text-center text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          How It Works
        </h2>
        <div className="hidden h-px w-24 bg-gradient-to-l from-transparent to-amber-300/70 sm:block" />
      </div>
      <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-6 text-sky-50/68 sm:text-base">
        Select any stage to see what happens and what you control.
      </p>
      <div className="mt-10 grid gap-7 md:grid-cols-5">
        {howItWorks.map(({ icon: Icon, title, text, detail }, index) => {
          const active = activeStep === index;
          const detailId = `how-it-works-detail-${index + 1}`;
          return (
            <button
              key={title}
              type="button"
              data-testid={`how-it-works-step-${index + 1}`}
              aria-expanded={active}
              aria-controls={detailId}
              onClick={() => setActiveStep(index)}
              onMouseEnter={() => setActiveStep(index)}
              onFocus={() => setActiveStep(index)}
              className={`relative min-h-11 rounded-2xl px-3 py-4 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
                active
                  ? 'bg-slate-950/48 shadow-lg shadow-slate-950/15'
                  : 'hover:bg-white/[0.04]'
              }`}
            >
              {index < howItWorks.length - 1 ? (
                <div className="absolute left-[calc(50%+2.5rem)] top-8 hidden w-[calc(100%-5rem)] border-t border-dashed border-sky-200/28 md:block" />
              ) : null}
              <div
                className={`relative mx-auto flex h-16 w-16 items-center justify-center rounded-full border text-blue-250 shadow-[0_0_26px_rgba(37,99,235,0.12)] transition-colors ${
                  active
                    ? 'border-amber-300/60 bg-amber-300/10'
                    : 'border-blue-300/24 bg-blue-500/8'
                }`}
              >
                <div className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-amber-300 text-xs font-bold text-slate-950">
                  {index + 1}
                </div>
                <Icon className="h-7 w-7 text-blue-300" aria-hidden="true" />
              </div>
              <div className="mt-5 font-semibold text-white">{title}</div>
              <p className="mx-auto mt-3 max-w-48 text-sm leading-6 text-sky-50/68">
                {text}
              </p>
              <div
                id={detailId}
                data-testid={`how-it-works-detail-${index + 1}`}
                hidden={!active}
                className="mt-4 border-t border-white/10 pt-4 text-left text-sm leading-6 text-sky-50/82"
              >
                <span className="font-semibold text-amber-200">
                  What happens:{' '}
                </span>
                {detail}
              </div>
              <span
                className={`mx-auto mt-3 flex w-fit items-center gap-1 text-xs font-semibold ${active ? 'text-amber-200' : 'text-sky-300'}`}
              >
                {active ? 'Details shown' : 'Learn more'}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${active ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LandingFaq({ navigate }) {
  const [openItemId, setOpenItemId] = useState(landingFaqItems[0]?.id || '');

  const viewAllQuestions = () => {
    navigate('/faq');
    window.dispatchEvent(
      new CustomEvent('mhb:analytics', {
        detail: {
          event: 'public_faq_opened',
          category: 'faq',
          source: 'landing_faq',
        },
      })
    );
  };

  return (
    <section
      id="frequently-asked-questions"
      className="mx-auto max-w-5xl scroll-mt-28 px-4 pb-10 sm:px-6 lg:px-8"
    >
      <div className="rounded-2xl border border-white/12 bg-slate-950/25 p-4 shadow-xl shadow-slate-950/16 backdrop-blur sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
              Helpful answers
            </div>
            <h2 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Frequently Asked Questions
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-5 text-sky-50/70">
              Quick answers about projects, contractors, and payments.
            </p>
          </div>
          <button
            type="button"
            data-testid="landing-view-all-faqs"
            onClick={viewAllQuestions}
            className="min-h-11 self-start rounded-xl border border-amber-300/55 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:border-amber-200 hover:bg-amber-300/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:self-auto"
          >
            View All FAQs
          </button>
        </div>

        <div
          className="mt-4 grid gap-2 md:grid-cols-2"
          data-testid="landing-faq-preview"
        >
          {landingFaqItems.map((item) => {
            const open = openItemId === item.id;
            const panelId = `landing-faq-answer-${item.id}`;
            return (
              <article
                key={item.id}
                className={`self-start overflow-hidden rounded-xl border ${open ? 'border-sky-500/60 bg-slate-900' : 'border-white/10 bg-slate-950/35'}`}
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() =>
                      setOpenItemId((current) =>
                        current === item.id ? '' : item.id
                      )
                    }
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm font-semibold leading-5 text-white hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-300"
                  >
                    <span>{item.question}</span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-sky-300 transition-transform ${open ? 'rotate-180 text-amber-300' : ''}`}
                      aria-hidden="true"
                    />
                  </button>
                </h3>
                <div
                  id={panelId}
                  hidden={!open}
                  className="border-t border-white/10 px-3.5 py-2.5 text-sm leading-5 text-sky-50/72"
                >
                  {item.answer}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function VideoPreview({ navigate }) {
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewInitialTab, setOverviewInitialTab] = useState('overview');
  const triggerRef = useRef(null);
  const openerRef = useRef(null);
  const jsonLd = JSON.stringify(
    buildPublicFaqJsonLd(PUBLIC_FAQ_CURATED_ITEMS)
  ).replace(/</g, '\\u003c');

  const openOverview = () => {
    setOverviewInitialTab('overview');
    openerRef.current = triggerRef.current;
    setOverviewOpen(true);
    window.dispatchEvent(
      new CustomEvent('mhb:analytics', {
        detail: {
          event: 'product_overview_opened',
          category: 'product_overview',
        },
      })
    );
  };

  const closeOverview = (method = 'dismiss') => {
    setOverviewOpen(false);
    window.dispatchEvent(
      new CustomEvent('mhb:analytics', {
        detail: {
          event: 'product_overview_closed',
          category: 'product_overview',
          method,
        },
      })
    );
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <>
      <section
        id="guided-help"
        className="mx-auto scroll-mt-28 px-4 pb-16 sm:px-6 lg:px-8"
      >
        <script
          type="application/ld+json"
          data-testid="landing-faq-jsonld"
          dangerouslySetInnerHTML={{ __html: jsonLd }}
        />
        <div className="mx-auto grid max-w-6xl gap-5 overflow-hidden rounded-2xl border border-white/12 bg-slate-950/30 p-4 shadow-xl shadow-slate-950/18 backdrop-blur lg:grid-cols-[0.7fr_1.3fr]">
          <div className="p-3 sm:p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300">
              Guided Help
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Choose your role and learn MyHomeBro
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-sky-50/72">
              Select customer, contractor, or property manager to see the
              videos and answers built for your workflow.
            </p>
          </div>

          <div data-testid="landing-video-preview" className="relative">
            <div className="grid gap-3">
              <div className="relative min-h-[17rem] overflow-hidden rounded-[1.25rem] border border-white/12 bg-slate-950 shadow-xl shadow-slate-950/22 lg:min-h-[18rem]">
                <img
                  src={kitchenPreviewImage}
                  alt="Warm kitchen remodel planning preview"
                  data-testid="landing-video-preview-asset"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.18),rgba(2,6,23,0.02)_44%,rgba(2,6,23,0.30)),radial-gradient(circle_at_50%_50%,transparent_38%,rgba(2,6,23,0.34)_100%)]" />
                <div className="absolute inset-x-8 top-8 h-20 rounded-full bg-amber-200/16 blur-2xl" />
                <div className="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-slate-950/90 via-slate-950/28 to-transparent" />
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  <button
                    ref={triggerRef}
                    type="button"
                    aria-label="Open role-based MyHomeBro Guided Help"
                    data-testid="product-overview-trigger"
                    onClick={openOverview}
                    className="inline-flex min-h-14 items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-blue-800 shadow-2xl shadow-slate-950/45 transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-amber-300/60 sm:text-base"
                  >
                    <Sparkles className="h-5 w-5" aria-hidden="true" />
                    Open Guided Help
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <div className="pointer-events-none absolute bottom-5 left-5 right-5 rounded-2xl border border-white/10 bg-slate-950/62 p-4 backdrop-blur">
                  <div className="text-sm font-semibold text-white">
                    Kitchen remodel workspace
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {[
                      ['Scope', 'AI organized'],
                      ['Payments', 'Milestone controls'],
                      ['Docs', 'All in one place'],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl bg-white/[0.06] px-3 py-2"
                      >
                        <div className="text-[11px] uppercase tracking-[0.14em] text-sky-100/52">
                          {label}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-sky-50">
                          {value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <ProductOverviewModal
          visible={overviewOpen}
          initialTab={overviewInitialTab}
          onClose={closeOverview}
          navigate={navigate}
        />
      </section>
    </>
  );
}

function AudienceCards({ navigate }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8">
      <div className="grid gap-4 lg:grid-cols-2">
        <AudienceCard
        id="for-homeowners"
        eyebrow="For Customers"
        title="Plan with confidence. Get it done right."
        bullets={[
          'Organize your project the smart way',
          'Connect with participating local contractors',
          'Compare and choose at your pace',
          "It's free, secure, and commitment-free",
        ]}
        primaryLabel="Start a Project"
        secondaryLabel="Customer Log In"
        onPrimary={() => navigate('/start-project')}
        onSecondary={() => navigate('/portal')}
        tone="homeowner"
        />
        <AudienceCard
        id="for-contractors"
        eyebrow="For Contractors"
        title="More quality projects. Less guesswork."
        bullets={[
          'Get matched with qualified homeowners',
          'Manage projects in one simple platform',
          'Fund milestones and release payment as work is approved',
          'Grow your business and your reputation',
        ]}
        primaryLabel="Contractor Sign Up"
        secondaryLabel="Contractor Log In"
        onPrimary={() =>
          window.dispatchEvent(new CustomEvent('mhb:open-signup'))
        }
        onSecondary={() =>
          window.dispatchEvent(
            new CustomEvent('mhb:open-login', {
              detail: { audience: 'contractor' },
            })
          )
        }
        tone="contractor"
        />
      </div>
      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/12 bg-slate-950/28 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">For Property Managers</div>
          <div className="mt-1 font-semibold text-white">Organize properties, maintenance, vendors, and records.</div>
        </div>
        <button type="button" onClick={() => navigate('/create-account?role=property_manager')} className="min-h-11 rounded-xl border border-sky-300/35 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-300/10">
          Explore Property Management
        </button>
      </div>
    </section>
  );
}

function AudienceCard({
  id,
  eyebrow,
  title,
  bullets,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  tone,
}) {
  const isHomeowner = tone === 'homeowner';
  const cardImage = isHomeowner ? homeownerCardImage : contractorCardImage;
  return (
    <div
      id={id}
      data-testid={`landing-${tone}-card`}
      className={`relative min-h-[17rem] overflow-hidden rounded-2xl border bg-slate-950 shadow-2xl shadow-slate-950/24 ${
        isHomeowner
          ? 'border-blue-300/34 shadow-blue-950/20'
          : 'border-amber-300/34 shadow-amber-950/16'
      }`}
    >
      <img
        src={cardImage}
        alt={
          isHomeowner
            ? 'MyHomeBro homeowner project visual'
            : 'MyHomeBro contractor platform visual'
        }
        data-testid={
          isHomeowner
            ? 'landing-homeowner-visual-asset'
            : 'landing-contractor-visual-asset'
        }
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/75 to-slate-950/10" />
      <div
        className={`absolute inset-0 ${
          isHomeowner
            ? 'bg-[radial-gradient(circle_at_78%_22%,rgba(59,130,246,0.18),transparent_34%)]'
            : 'bg-[radial-gradient(circle_at_78%_22%,rgba(251,191,36,0.16),transparent_34%)]'
        }`}
      />
      <div
        data-testid={
          isHomeowner
            ? 'landing-homeowner-image-panel'
            : 'landing-contractor-image-panel'
        }
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      />
      <div className="relative z-10 flex min-h-[17rem] items-center">
        <div className="w-full max-w-[17rem] p-4 sm:p-5">
          <div
            className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${isHomeowner ? 'text-sky-300' : 'text-amber-200'}`}
          >
            {eyebrow}
          </div>
          <h2 className="mt-1.5 whitespace-pre-line text-xl font-semibold leading-tight text-white">
            {title.replace('. ', '.\n')}
          </h2>
          <div className="mt-2.5 space-y-1">
            {bullets.map((bullet) => (
              <div
                key={bullet}
                className="flex items-start gap-2 text-[11px] leading-4 text-sky-50/76"
              >
                <CheckCircle2
                  className={`mt-0.5 h-3 w-3 shrink-0 ${isHomeowner ? 'text-sky-300' : 'text-amber-300'}`}
                  aria-hidden="true"
                />
                {bullet}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onPrimary}
              className="rounded-lg border border-blue-300/30 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-700 px-3.5 py-2 text-[11px] font-semibold text-white shadow-lg shadow-blue-950/22 transition hover:border-amber-200/60 hover:from-blue-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-amber-300/60"
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              onClick={onSecondary}
              data-testid={
                isHomeowner ? 'landing-customer-portal-button' : undefined
              }
              className="text-[11px] font-semibold text-sky-300 hover:text-sky-200 focus:outline-none focus:ring-2 focus:ring-sky-300/50"
            >
              {secondaryLabel} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustBand() {
  return (
    <section
      id="about"
      className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8"
    >
      <div
        data-testid="landing-trust-section"
        className="rounded-3xl border border-white/12 bg-white/[0.052] p-6 shadow-2xl shadow-slate-950/18 backdrop-blur"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/35 bg-amber-300/10 text-amber-200 shadow-[0_0_24px_rgba(251,191,36,0.12)]">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">
              Built on trust. Focused on results.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-sky-50/68">
              MyHomeBro helps customers and contractors keep project scope,
              payments, records, and approvals organized from start to finish.
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <TrustValueCard
            icon={ShieldCheck}
            title="Milestone-Based Payment Controls"
            text="Fund project milestones and keep payment approvals organized and documented."
            tone="amber"
          />
          <TrustValueCard
            icon={ClipboardList}
            title="Agreements, Documents & Records"
            text="Keep agreements, approvals, warranties, photos, receipts, and property history together."
          />
          <TrustValueCard
            icon={MessageSquareText}
            title="Project Transparency & Dispute Workflow"
            text="Track project activity, communication, evidence, and dispute resolution through one workflow."
            tone="amber"
          />
        </div>
      </div>
    </section>
  );
}

function TrustValueCard({
  icon: Icon,
  value,
  label,
  title,
  text,
  tone = 'blue',
  stars = false,
}) {
  const displayTitle = title || value;
  const displayText = text || label;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/24 p-4">
      <div className="flex items-center gap-4">
        <Icon
          className={`h-9 w-9 ${tone === 'amber' ? 'text-amber-300' : 'text-blue-300'}`}
          aria-hidden="true"
        />
        <div>
          <div className="flex items-center gap-3">
            <div className="text-base font-semibold text-white">
              {displayTitle}
            </div>
            {stars ? <div className="text-amber-300">★★★★★</div> : null}
          </div>
          <p className="mt-1 text-sm leading-6 text-sky-50/70">{displayText}</p>
        </div>
      </div>
    </div>
  );
}
