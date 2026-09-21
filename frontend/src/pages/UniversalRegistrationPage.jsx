import React from 'react';
import { BriefcaseBusiness, Building2, Home } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import logo from '../assets/myhomebro_logo.png';
import { registrationDestination } from '../lib/universalRegistration.js';
import { trackAcquisitionEvent } from '../lib/acquisitionAttribution.js';

const ROLES = [
  {
    id: 'customer',
    title: 'Homeowner',
    description: 'Plan projects, manage estimates and agreements, and keep your property records together.',
    icon: Home,
  },
  {
    id: 'contractor',
    title: 'Contractor',
    description: 'Manage customers, estimates, agreements, projects, teams, payments, and your public presence.',
    icon: BriefcaseBusiness,
  },
  {
    id: 'property_manager',
    title: 'Property Manager',
    description: 'Organize properties, maintenance, vendors, documents, warranties, and work history.',
    icon: Building2,
  },
];

export default function UniversalRegistrationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referralCode = searchParams.get('ref') || '';

  const selectRole = (role) => {
    trackAcquisitionEvent('role_selected', window.location, { role: role === 'customer' ? 'homeowner' : role });
    navigate(registrationDestination(role, referralCode));
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_35%_8%,rgba(37,99,235,0.26),transparent_28%),linear-gradient(135deg,#020617_0%,#082044_52%,#0f172a_100%)] text-white">
      <header className="border-b border-white/10 bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="MyHomeBro" className="h-10 w-10 rounded-xl object-cover" />
            <span className="text-xl font-bold">MyHome<span className="text-amber-300">Bro</span></span>
          </Link>
          <Link to="/login" className="rounded-xl border border-white/16 px-4 py-2 text-sm font-semibold text-sky-50 hover:bg-white/8">Sign In</Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-3xl text-center">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">Create your free account</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">How will you use MyHomeBro?</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-sky-50/76">Choose your role and we’ll take you to the correct registration and onboarding experience.</p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3" data-testid="universal-registration-roles">
          {ROLES.map(({ id, title, description, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => selectRole(id)}
              data-testid={`register-role-${id}`}
              className="group rounded-3xl border border-white/14 bg-white/[0.05] p-6 text-left shadow-xl transition hover:-translate-y-1 hover:border-amber-300/60 hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-amber-300/70"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-300/30 bg-blue-500/12 text-blue-100"><Icon className="h-6 w-6" /></span>
              <span className="mt-5 block text-xl font-semibold">{title}</span>
              <span className="mt-3 block text-sm leading-6 text-sky-50/70">{description}</span>
              <span className="mt-5 block text-sm font-semibold text-amber-200 group-hover:text-amber-100">Continue as {title} →</span>
            </button>
          ))}
        </div>
        {referralCode ? <p className="mt-6 text-center text-sm text-emerald-200" data-testid="universal-registration-referral">Your referral will remain attached to whichever account role you choose.</p> : null}
      </main>
    </div>
  );
}
