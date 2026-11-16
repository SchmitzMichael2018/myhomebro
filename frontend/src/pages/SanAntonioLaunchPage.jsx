import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  ClipboardList,
  HardHat,
  Home,
  HousePlus,
  MapPin,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import logo from '../assets/myhomebro_logo.png';
import {
  CONTRACTOR_SEARCH_HANDOFF,
  DIY_PLANNER_HANDOFF,
  sanAntonioCtaUrl,
} from '../lib/sanAntonioLaunch.js';

const services = [
  {
    title: 'Flooring',
    detail:
      'Describe the room, existing surface, material preference, and timing.',
  },
  {
    title: 'Concrete',
    detail:
      'Share the area, intended use, access, and any site conditions you know.',
  },
  {
    title: 'Bathroom remodeling',
    detail:
      'Outline the fixtures, finishes, layout changes, and your priorities.',
  },
];

export default function SanAntonioLaunchPage() {
  const { search } = useLocation();
  const cta = (path) => sanAntonioCtaUrl(path, search);

  return (
    <div
      className="min-h-screen bg-slate-950 text-white"
      data-testid="san-antonio-launch"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-slate-950"
      >
        Skip to content
      </a>
      <header className="border-b border-white/10 bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link
            to="/"
            className="flex items-center gap-3"
            aria-label="MyHomeBro national home"
          >
            <img
              src={logo}
              alt=""
              className="h-10 w-10 rounded-xl object-cover"
            />
            <span className="text-xl font-bold">
              MyHome<span className="text-amber-300">Bro</span>
            </span>
          </Link>
          <a
            href="#paths-heading"
            className="rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
          >
            Choose your role
          </a>
        </div>
      </header>

      <main id="main-content">
        <section className="bg-[radial-gradient(circle_at_75%_20%,rgba(37,99,235,.26),transparent_35%),linear-gradient(145deg,#082044,#020617)]">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.3fr_.7fr] md:items-center md:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-200">
                <MapPin size={16} aria-hidden="true" /> San Antonio citywide
                launch
              </p>
              <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
                Plan home projects in San Antonio with a clearer next step.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-200">
                Plan a DIY project or hire help, keep home maintenance history
                in one place, and manage agreed payment milestones when you work
                with a contractor. Start with a practical guide, prepare a
                suggested plan, then decide what to do yourself and where to ask
                for help.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#bathroom-guides"
                  data-testid="san-antonio-explore-guides"
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-300 px-6 py-3 font-bold text-slate-950 hover:bg-amber-200"
                >
                  Explore bathroom guides{' '}
                  <ArrowRight size={18} aria-hidden="true" />
                </a>
                <Link
                  data-testid="san-antonio-start-project"
                  to={cta('/start-project')}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/40 px-6 py-3 font-bold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Start a project <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <Link
                  data-testid="san-antonio-find-contractor"
                  to={cta(CONTRACTOR_SEARCH_HANDOFF)}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/40 px-6 py-3 font-semibold text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
                >
                  <Search size={18} aria-hidden="true" /> Find a contractor
                </Link>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Contractor search follows project intake so location and scope
                can inform your choices. Listings and responses depend on
                participating contractors; no match is promised.
              </p>
            </div>
            <aside
              className="rounded-3xl border border-sky-200/20 bg-white/5 p-7 shadow-2xl"
              aria-label="How the launch works"
            >
              <h2 className="text-xl font-bold">You remain in control</h2>
              <ol className="mt-5 space-y-5 text-sm leading-6 text-slate-200">
                <li>
                  <strong className="text-white">1. Learn and plan.</strong>{' '}
                  Read a published guide and answer questions about your
                  project. Review a suggested plan before saving it.
                </li>
                <li>
                  <strong className="text-white">2. Save and choose.</strong>{' '}
                  Keep your plan private, choose DIY tasks, or prepare a request
                  for professional help.
                </li>
                <li>
                  <strong className="text-white">
                    3. Get help when ready.
                  </strong>{' '}
                  Review your request, then choose whom to invite. Saving a plan
                  does not contact contractors.
                </li>
              </ol>
              <p className="mt-6 rounded-xl border border-amber-200/30 bg-amber-200/10 p-4 text-sm leading-6 text-amber-100">
                Automatic matching is available only where trade-specific
                readiness is met and approved. A saved request does not
                automatically go to contractors.
              </p>
            </aside>
          </div>
        </section>

        <BathroomGuides cta={cta} />

        <section
          className="border-b border-white/10 bg-slate-900/70"
          aria-labelledby="benefits-heading"
        >
          <div className="mx-auto max-w-6xl px-5 py-16">
            <p className="text-sm font-bold uppercase tracking-widest text-amber-300">
              More than finding a contractor
            </p>
            <h2
              id="benefits-heading"
              className="mt-3 max-w-3xl text-3xl font-bold"
            >
              A clearer way to care for your home and manage the work
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              <article className="rounded-2xl border border-white/15 bg-slate-950 p-6">
                <ShieldCheck className="text-sky-300" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">
                  Keep control of milestone payments
                </h3>
                <p className="mt-3 leading-7 text-slate-300">
                  For projects using milestone funding, agree on the work and
                  payment stages, then review completed work before approving a
                  release. Available payment options depend on the agreement.
                </p>
              </article>
              <article className="rounded-2xl border border-white/15 bg-slate-950 p-6">
                <HousePlus className="text-sky-300" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">
                  Build a maintenance history for your home
                </h3>
                <p className="mt-3 leading-7 text-slate-300">
                  Keep requests, photos, documents, warranties, and completed
                  work connected to your property so you can look back at what
                  was done.
                </p>
              </article>
              <article className="rounded-2xl border border-white/15 bg-slate-950 p-6">
                <Wrench className="text-sky-300" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">
                  Plan it yourself; ask for help when you need it
                </h3>
                <p className="mt-3 leading-7 text-slate-300">
                  Break a DIY project into phases and tasks, track your
                  progress, and request contractor help for work you decide not
                  to do yourself. Contractor responses depend on participation.
                </p>
                <Link
                  data-testid="san-antonio-diy"
                  to={cta(DIY_PLANNER_HANDOFF)}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-amber-200 underline-offset-4 hover:underline"
                >
                  Create an account to plan DIY work{' '}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            </div>
          </div>
        </section>

        <section
          className="mx-auto max-w-6xl px-5 py-16"
          aria-labelledby="service-heading"
        >
          <p className="text-sm font-bold uppercase tracking-widest text-amber-300">
            Citywide starting points
          </p>
          <h2 id="service-heading" className="mt-3 text-3xl font-bold">
            What are you planning?
          </h2>
          <p className="mt-3 max-w-2xl leading-7 text-slate-300">
            These are ways to describe your work, not promises of contractor
            supply or project availability.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {services.map((service) => (
              <article
                key={service.title}
                className="rounded-2xl border border-white/15 bg-slate-900 p-6"
              >
                <ClipboardList className="text-sky-300" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">{service.title}</h3>
                <p className="mt-3 min-h-20 leading-7 text-slate-300">
                  {service.detail}
                </p>
                <Link
                  to={cta('/start-project')}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-amber-200 underline-offset-4 hover:underline"
                >
                  Plan this project <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section
          className="border-y border-white/10 bg-slate-900/70"
          aria-labelledby="paths-heading"
        >
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 id="paths-heading" className="text-3xl font-bold">
              A path for each role
            </h2>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <article className="rounded-2xl border border-white/15 bg-slate-950 p-6">
                <Home className="text-sky-300" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">Homeowners</h3>
                <p className="mt-3 leading-7 text-slate-300">
                  Plan DIY or contractor-led work, keep maintenance records with
                  your property, and review project milestones and payments when
                  you hire a contractor.
                </p>
                <Link
                  data-testid="san-antonio-homeowner"
                  to={cta('/create-account?role=customer')}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-amber-200"
                >
                  Create a customer account{' '}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
              <article className="rounded-2xl border border-white/15 bg-slate-950 p-6">
                <HardHat className="text-sky-300" aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">Contractors</h3>
                <p className="mt-3 leading-7 text-slate-300">
                  Build your business profile, prepare estimates, and document
                  agreed milestones and payment requests. Participation does not
                  guarantee leads.
                </p>
                <Link
                  data-testid="san-antonio-contractor"
                  to={cta('/signup')}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-amber-200"
                >
                  Join as a contractor{' '}
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-4 rounded-2xl border border-white/15 bg-slate-950/70 p-5">
              <Building2 className="shrink-0 text-sky-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h3 className="font-bold">Property managers</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Organize property work, maintenance, vendors, and records in a
                  dedicated workspace.
                </p>
              </div>
              <Link
                data-testid="san-antonio-property-manager"
                to={cta('/create-account?role=property_manager')}
                className="inline-flex min-h-11 items-center gap-2 font-semibold text-amber-200"
              >
                Explore property manager setup{' '}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-slate-400">
        <span>MyHomeBro · San Antonio, Texas</span>
        <Link
          to="/"
          className="text-slate-300 underline-offset-4 hover:text-white hover:underline"
        >
          Visit the national homepage
        </Link>
      </footer>
    </div>
  );
}

function BathroomGuides({ cta }) {
  const [state, setState] = useState({
    loading: true,
    guides: [],
    error: false,
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, guides: [], error: false });
    fetch(
      '/api/projects/public/improvements/?category=bathroom&audience=homeowner',
      { signal: controller.signal }
    )
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('Unavailable'))
      )
      .then((data) => {
        if (!controller.signal.aborted)
          setState({
            loading: false,
            guides: (data.improvements || [])
              .filter(
                (guide) =>
                  guide.category_slug === 'bathroom' &&
                  /^\/improvements\/bathroom\/[a-z0-9-]+\/?$/.test(
                    guide.canonical_path
                  )
              )
              .slice(0, 3),
            error: false,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({ loading: false, guides: [], error: true });
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <section
      id="bathroom-guides"
      className="mx-auto max-w-6xl px-5 py-16"
      aria-labelledby="bathroom-guides-heading"
    >
      <p className="text-sm font-bold uppercase tracking-widest text-amber-300">
        Learn before you commit
      </p>
      <h2 id="bathroom-guides-heading" className="mt-3 text-3xl font-bold">
        Start with your bathroom project
      </h2>
      <p className="mt-3 max-w-3xl leading-7 text-slate-300">
        Explore the scope, preparation, and safety considerations. From a
        published guide, Project Assistant can help prepare a plan for you to
        review and save privately.
      </p>
      <div aria-live="polite" className="mt-6">
        {state.loading ? (
          <p>Loading published bathroom guides…</p>
        ) : state.error ? (
          <div role="alert">
            <p>Bathroom guides are temporarily unavailable.</p>
            <button
              type="button"
              onClick={() => setRetry((value) => value + 1)}
              className="mt-3 rounded-xl border border-white/30 px-4 py-3 font-bold"
            >
              Try again
            </button>
          </div>
        ) : state.guides.length ? (
          <div className="grid gap-5 md:grid-cols-3">
            {state.guides.map((guide) => (
              <article
                key={guide.id}
                className="rounded-2xl border border-white/15 bg-slate-900 p-6"
              >
                <h3 className="text-xl font-bold">{guide.title}</h3>
                <p className="mt-3 leading-7 text-slate-300">{guide.summary}</p>
                <Link
                  to={cta(guide.canonical_path)}
                  className="mt-5 inline-flex min-h-11 items-center gap-2 font-semibold text-amber-200"
                >
                  Read guide <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-white/15 p-5 text-slate-300">
            Bathroom guides are being reviewed. You can still create a private
            project plan while the library is being prepared.
          </p>
        )}
      </div>
      <Link
        to={cta(DIY_PLANNER_HANDOFF)}
        className="mt-6 inline-flex min-h-11 items-center font-semibold text-amber-200"
      >
        Start a private plan without a guide →
      </Link>
    </section>
  );
}
