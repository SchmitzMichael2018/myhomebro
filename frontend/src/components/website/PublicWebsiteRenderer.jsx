import React, { useMemo, useState } from 'react';

import api from '../../api';

function getBlock(page, key) {
  return page?.content_blocks?.[key] || {};
}

function visibleSections(layout) {
  const sections = layout?.sections || {};
  const order = Array.isArray(layout?.section_order)
    ? layout.section_order
    : ['hero', 'services', 'portfolio', 'reviews', 'trust', 'contact'];
  return order.filter((key) => sections[key] !== false);
}

function pageByType(pages, type) {
  return (Array.isArray(pages) ? pages : []).find((page) => page.page_type === type) || null;
}

function color(value, fallback) {
  return value || fallback;
}

function initials(value) {
  return String(value || 'MB')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'MB';
}

function emptyIntakeForm() {
  return {
    full_name: '',
    email: '',
    phone: '',
    project_type: '',
    raw_description: '',
    desired_timing_text: '',
    project_address_line1: '',
    project_city: '',
    project_state: '',
    project_postal_code: '',
    budget_range_text: '',
    payment_preference: 'discuss',
    preferred_contact_method: 'email',
    contact_consent: false,
    files: [],
  };
}

function fieldClass() {
  return 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
}

function websiteCtaText(value) {
  return String(value || '').trim().toLowerCase() === 'request a quote'
    ? 'Start a Project'
    : (value || 'Start a Project');
}

export default function PublicWebsiteRenderer({ payload, currentPage, previewMode = 'desktop', slug = '' }) {
  const profile = payload?.profile || {};
  const pages = payload?.pages || [];
  const layout = payload?.homepage_layout || payload?.website?.homepage_layout || {};
  const branding = layout.branding || {};
  const identity = profile.identity || {};
  const contact = profile.contact || {};
  const serviceArea = profile.service_area || {};
  const services = profile.services || {};
  const gallery = profile.gallery || {};
  const reviews = profile.reviews || {};
  const trust = profile.trust || {};
  const homePage = currentPage || pageByType(pages, 'home') || pages[0] || {};
  const servicesPage = pageByType(pages, 'services') || {};
  const galleryPage = pageByType(pages, 'gallery') || {};
  const reviewsPage = pageByType(pages, 'reviews') || {};
  const contactPage = pageByType(pages, 'contact') || {};
  const hero = getBlock(homePage, 'hero');
  const about = getBlock(homePage, 'about');
  const serviceBlock = getBlock(servicesPage, 'services');
  const portfolioBlock = getBlock(galleryPage, 'portfolio');
  const reviewsBlock = getBlock(reviewsPage, 'reviews');
  const contactBlock = getBlock(contactPage, 'contact');
  const primary = color(branding.primary_color, profile.branding?.primary_color || profile.branding?.brand_primary_color || '#2563eb');
  const accent = color(branding.accent_color, profile.branding?.accent_color || profile.branding?.brand_accent_color || '#14b8a6');
  const images = profile.images || {};
  const logoImage = images.logo || profile.branding?.logo_url || '';
  const heroImage = images.hero || images.cover || profile.branding?.hero_image_url || profile.branding?.cover_image_url || gallery.items?.[0]?.image_url || '';
  const serviceItems = [
    ...(Array.isArray(services.specialties) ? services.specialties : []),
    ...(Array.isArray(services.work_types) ? services.work_types : []),
    ...(Array.isArray(services.skills) ? services.skills : []),
  ].filter(Boolean).slice(0, 8);
  const serviceCards = Array.isArray(serviceBlock.items) && serviceBlock.items.length
    ? serviceBlock.items
    : serviceItems.map((item) => ({ title: item, description: '' }));
  const sections = visibleSections(layout);
  const businessName = identity.business_name || 'this contractor';
  const leadFormEnabled = contact.allow_public_intake !== false && contactBlock.lead_form_enabled !== false;
  const [intakeForm, setIntakeForm] = useState(emptyIntakeForm);
  const [submitState, setSubmitState] = useState({ status: 'idle', message: '' });
  const isPreviewOnly = !slug;

  const defaultProjectTypes = useMemo(() => {
    const names = serviceCards.map((item) => item.title || item).filter(Boolean);
    return names.length ? names.slice(0, 5) : ['Remodeling', 'Repair', 'Installation', 'Inspection'];
  }, [serviceCards]);

  function updateForm(key, value) {
    setIntakeForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submitIntake(event) {
    event.preventDefault();
    if (!leadFormEnabled) {
      setSubmitState({ status: 'error', message: 'This contractor is not accepting website requests right now.' });
      return;
    }
    if (isPreviewOnly) {
      setSubmitState({ status: 'success', message: `Preview: your request would be sent to ${businessName}.` });
      return;
    }
    setSubmitState({ status: 'submitting', message: '' });
    try {
      const data = new FormData();
      Object.entries(intakeForm).forEach(([key, value]) => {
        if (key === 'files') return;
        data.append(key, key === 'contact_consent' ? String(Boolean(value)) : value || '');
      });
      (intakeForm.files || []).forEach((file) => data.append('photos', file));
      const response = await api.post(`/projects/public/websites/${encodeURIComponent(slug)}/intake/`, data, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSubmitState({
        status: 'success',
        message: response?.data?.message || `Your request was sent to ${businessName}.`,
      });
      setIntakeForm(emptyIntakeForm());
    } catch (error) {
      const message = error?.response?.data?.detail
        || Object.values(error?.response?.data || {})?.flat?.()?.[0]
        || 'We could not send your request yet. Please check the required fields and try again.';
      setSubmitState({ status: 'error', message });
    }
  }

  return (
    <article
      data-testid="public-website-renderer"
      className={`overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white text-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.16)] ${
        previewMode === 'mobile' ? 'mx-auto max-w-sm' : 'w-full'
      }`}
      style={{ '--website-primary': primary, '--website-accent': accent }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          {logoImage ? (
            <img src={logoImage} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-black text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
              {initials(businessName)}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{businessName}</div>
            <div className="truncate text-xs text-slate-500">{serviceArea.service_area_text || [serviceArea.city, serviceArea.state].filter(Boolean).join(', ')}</div>
          </div>
        </div>
        <a href="#website-intake" className="rounded-full px-4 py-2 text-xs font-black text-white shadow-lg shadow-slate-200 transition hover:-translate-y-0.5" style={{ background: primary }}>
          Start a Project
        </a>
      </header>

      {sections.includes('hero') ? (
        <section className="grid gap-0 bg-slate-50 md:grid-cols-[1.05fr_0.95fr]">
          <div className="px-6 py-10 md:px-8 md:py-14">
            <div className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.18em] shadow-sm" style={{ color: accent }}>
              {identity.tagline || 'Local contractor'}
            </div>
            <h1 className="mt-5 text-3xl font-black leading-tight tracking-tight md:text-5xl">
              {hero.headline || businessName || 'Build with confidence'}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              {hero.subheadline || about.body || identity.bio || 'Professional project planning, clear agreements, and reliable communication from first request to final walkthrough.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#website-intake" className="rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:-translate-y-0.5" style={{ background: primary }}>
                {websiteCtaText(hero.cta_text)}
              </a>
              <a href="#portfolio" className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-sm transition hover:bg-slate-50">
                View Work
              </a>
            </div>
          </div>
          <div className="min-h-64 bg-slate-100">
            {heroImage ? (
              <img src={heroImage} alt="" className="h-full min-h-64 w-full object-cover" />
            ) : (
              <div className="flex h-full min-h-64 items-center justify-center p-8 text-center text-white" style={{ background: `radial-gradient(circle at 20% 20%, ${accent} 0, transparent 28%), linear-gradient(135deg, ${primary}, #0f172a)` }}>
                <div>
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-white/15 text-2xl font-black shadow-2xl backdrop-blur">{initials(businessName)}</div>
                  <div className="mt-4 text-sm font-semibold text-white/85">Add a hero or portfolio photo when you are ready.</div>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {sections.includes('services') ? (
        <section className="border-t border-slate-200 px-6 py-8 md:px-8">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-black">{serviceBlock.heading || 'Services'}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{serviceBlock.intro || 'Clear scopes and reliable execution for the work your customers request most.'}</p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(serviceCards.length ? serviceCards : ['Residential projects', 'Repairs', 'Renovations'].map((item) => ({ title: item, description: '' }))).map((item) => (
              <div key={item.title || item} className="rounded-2xl border border-slate-200 bg-white p-5 text-sm shadow-sm">
                <div className="font-black text-slate-950">{item.title || item}</div>
                {item.description ? <div className="mt-2 leading-6 text-slate-600">{item.description}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {sections.includes('portfolio') ? (
        <section id="portfolio" className="border-t border-slate-200 px-6 py-8 md:px-8">
          <h2 className="text-2xl font-black">{portfolioBlock.heading || 'Recent Work'}</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(gallery.items || []).slice(0, 6).map((item) => (
              <div key={item.id || item.title} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {item.image_url ? <img src={item.image_url} alt={item.title || ''} className="h-40 w-full object-cover" /> : null}
                <div className="p-4">
                  <div className="font-bold">{item.title || 'Project photo'}</div>
                  <div className="mt-1 text-sm text-slate-600">{item.description || [item.project_city, item.project_state].filter(Boolean).join(', ')}</div>
                </div>
              </div>
            ))}
            {!gallery.items?.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-500">Portfolio photos will appear here after you select public gallery images.</div> : null}
          </div>
        </section>
      ) : null}

      {sections.includes('reviews') ? (
        <section className="border-t border-slate-200 px-6 py-8 md:px-8">
          <h2 className="text-2xl font-black">{reviewsBlock.heading || 'Customer Reviews'}</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {(reviews.selected || []).slice(0, 4).map((review) => (
              <figure key={review.id || review.reviewer_name} className="rounded-xl border border-slate-200 bg-slate-50 p-5">
                <div className="text-sm font-bold text-slate-900">{review.rating || 5}/5</div>
                <blockquote className="mt-2 text-sm leading-6 text-slate-700">{review.public_comment || review.comment || 'Great work and clear communication.'}</blockquote>
                <figcaption className="mt-3 text-xs font-semibold text-slate-500">{review.reviewer_name || review.customer_name || 'Customer'}</figcaption>
              </figure>
            ))}
            {!reviews.selected?.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-500">Approved reviews will appear here. Until then, the trust section highlights service area, licensing, and portfolio signals.</div> : null}
          </div>
        </section>
      ) : null}

      {sections.includes('trust') ? (
        <section className="border-t border-slate-200 px-6 py-8 md:px-8">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4 text-sm"><span className="font-bold">Licensed:</span> {trust.license_public || trust.show_license_public ? 'Visible' : 'Not shown'}</div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm"><span className="font-bold">Reviews:</span> {reviews.count || 0}</div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm"><span className="font-bold">Portfolio:</span> {gallery.count || 0} items</div>
          </div>
        </section>
      ) : null}

      {sections.includes('contact') ? (
        <section id="contact" className="border-t border-slate-200 px-6 py-8 md:px-8">
          <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-2xl p-6 text-white" style={{ background: primary }}>
              <h2 className="text-2xl font-black">{contactBlock.heading || 'Ready to start?'}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/85">{contactBlock.body || 'Share the basics and we will help turn the project into a clear next step.'}</p>
              <a href="#website-intake" className="mt-5 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-bold" style={{ color: primary }}>
                {websiteCtaText(contactBlock.cta_text || 'Start Your Project')}
              </a>
              <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
                {contact.show_phone_public && contact.phone_public ? <a href={`tel:${contact.phone_public}`} className="rounded-xl bg-white/15 px-4 py-2 text-white">{contact.phone_public}</a> : null}
                {contact.show_email_public && contact.email_public ? <a href={`mailto:${contact.email_public}`} className="rounded-xl bg-white/15 px-4 py-2 text-white">{contact.email_public}</a> : null}
              </div>
            </div>

            <form id="website-intake" data-testid="public-website-intake-form" onSubmit={submitIntake} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>Project intake</div>
              <h3 className="mt-2 text-xl font-black text-slate-900">Start a Project</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {contactBlock.intake_intro || `Tell ${businessName} what you want done, where the project is, and how soon you would like to start.`}
              </p>

              {!leadFormEnabled ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Website quote requests are paused right now.
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Name
                  <input required className={`${fieldClass()} mt-1`} value={intakeForm.full_name} onChange={(event) => updateForm('full_name', event.target.value)} placeholder="Full name" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Email
                  <input required type="email" className={`${fieldClass()} mt-1`} value={intakeForm.email} onChange={(event) => updateForm('email', event.target.value)} placeholder="you@example.com" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Phone
                  <input className={`${fieldClass()} mt-1`} value={intakeForm.phone} onChange={(event) => updateForm('phone', event.target.value)} placeholder="Phone number" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Project type
                  <input list="website-project-types" className={`${fieldClass()} mt-1`} value={intakeForm.project_type} onChange={(event) => updateForm('project_type', event.target.value)} placeholder="Kitchen remodel, repair, etc." />
                  <datalist id="website-project-types">
                    {defaultProjectTypes.map((item) => <option key={item} value={item} />)}
                  </datalist>
                </label>
              </div>

              <label className="mt-3 block text-sm font-semibold text-slate-700">
                Project details
                <textarea required rows={4} className={`${fieldClass()} mt-1`} value={intakeForm.raw_description} onChange={(event) => updateForm('raw_description', event.target.value)} placeholder="Tell us what you want done and any important details." />
              </label>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Timeline
                  <input className={`${fieldClass()} mt-1`} value={intakeForm.desired_timing_text} onChange={(event) => updateForm('desired_timing_text', event.target.value)} placeholder="ASAP, next month, flexible..." />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Budget
                  <input className={`${fieldClass()} mt-1`} value={intakeForm.budget_range_text} onChange={(event) => updateForm('budget_range_text', event.target.value)} placeholder="$5k-$10k, not sure..." />
                </label>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-[1.3fr_0.7fr_0.5fr]">
                <label className="text-sm font-semibold text-slate-700">
                  Service location
                  <input className={`${fieldClass()} mt-1`} value={intakeForm.project_address_line1} onChange={(event) => updateForm('project_address_line1', event.target.value)} placeholder="Street address" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  City
                  <input className={`${fieldClass()} mt-1`} value={intakeForm.project_city} onChange={(event) => updateForm('project_city', event.target.value)} />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  State
                  <input className={`${fieldClass()} mt-1`} value={intakeForm.project_state} onChange={(event) => updateForm('project_state', event.target.value)} />
                </label>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Payment preference
                  <select className={`${fieldClass()} mt-1`} value={intakeForm.payment_preference} onChange={(event) => updateForm('payment_preference', event.target.value)}>
                    <option value="discuss">Discuss options</option>
                    <option value="escrow">Escrow milestone payments</option>
                    <option value="direct">Direct payment</option>
                  </select>
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Photos
                  <input type="file" multiple accept="image/*" className={`${fieldClass()} mt-1`} onChange={(event) => updateForm('files', Array.from(event.target.files || []))} />
                </label>
              </div>

              <label className="mt-4 flex items-start gap-2 rounded-xl bg-white p-3 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" checked={intakeForm.contact_consent} onChange={(event) => updateForm('contact_consent', event.target.checked)} required />
                <span>I agree that {businessName} may contact me about this project request.</span>
              </label>

              {submitState.message ? (
                <div
                  className={`mt-4 rounded-xl p-3 text-sm ${
                    submitState.status === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                  }`}
                  data-testid="public-website-intake-message"
                >
                  {submitState.message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={!leadFormEnabled || submitState.status === 'submitting'}
                className="mt-4 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:bg-slate-300"
                style={{ background: leadFormEnabled ? primary : undefined }}
                data-testid="public-website-intake-submit"
              >
                {submitState.status === 'submitting' ? 'Sending...' : 'Start Your Project'}
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </article>
  );
}
