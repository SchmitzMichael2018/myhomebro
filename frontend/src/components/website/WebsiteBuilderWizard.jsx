import React, { useEffect, useMemo, useState } from 'react';

import PublicWebsiteRenderer from './PublicWebsiteRenderer.jsx';

const STEPS = [
  { key: 'basics', label: 'Business Basics' },
  { key: 'branding', label: 'Branding' },
  { key: 'services', label: 'Services' },
  { key: 'trust', label: 'Trust' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'contact', label: 'Contact & Leads' },
  { key: 'publish', label: 'Preview & Publish' },
];

const TEMPLATES = [
  { key: 'starter', label: 'Starter', description: 'Clean, direct, and profile-led.' },
  { key: 'modern_trade', label: 'Modern Trade', description: 'Bold sections for trade contractors.' },
  { key: 'premium_home', label: 'Premium Home', description: 'A polished residential layout.' },
  { key: 'commercial', label: 'Commercial', description: 'Structured and trust-forward.' },
];

const SECTION_ORDER = ['hero', 'services', 'portfolio', 'reviews', 'trust', 'contact'];

function csvToList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function useObjectUrl(file) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) {
      setUrl('');
      return undefined;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);
  return url;
}

function pageByType(pages, type) {
  return (Array.isArray(pages) ? pages : []).find((page) => page.page_type === type) || null;
}

function mergePageContent(page, blockKey, patch) {
  return {
    ...page,
    content_blocks: {
      ...(page.content_blocks || {}),
      [blockKey]: {
        ...(page.content_blocks?.[blockKey] || {}),
        ...patch,
      },
    },
  };
}

function StepCard({ title, helper, children, actions }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] md:p-7">
      <div className="max-w-3xl">
        <h3 className="text-2xl font-black text-slate-950">{title}</h3>
        {helper ? <p className="mt-2 text-base leading-7 text-slate-600">{helper}</p> : null}
      </div>
      <div className="mt-7 space-y-6">{children}</div>
      {actions ? <div className="mt-7 flex flex-wrap gap-3 border-t border-slate-100 pt-5">{actions}</div> : null}
    </section>
  );
}

function Field({ label, helper, children }) {
  return (
    <label className="block">
      <span className="block text-sm font-black text-slate-800">{label}</span>
      {helper ? <span className="mt-1 block text-sm font-normal leading-6 text-slate-500">{helper}</span> : null}
      <div className="mt-3">{children}</div>
    </label>
  );
}

function inputClass() {
  return 'min-h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500';
}

export function WebsiteBuilderStepNav({ steps, activeStep, onStepChange, readinessScore }) {
  const activeIndex = Math.max(0, steps.findIndex((step) => step.key === activeStep));
  const progress = steps.length ? Math.round(((activeIndex + 1) / steps.length) * 100) : 0;
  return (
    <nav className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.07)]" data-testid="website-builder-step-nav">
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px] md:items-center">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Setup progress</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-950 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white">
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300">Readiness</div>
          <div className="mt-1 text-2xl font-black">{Number(readinessScore || 0)}%</div>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {steps.map((step, index) => (
          <button
            key={step.key}
            type="button"
            onClick={() => onStepChange(step.key)}
            className={`flex min-w-[148px] items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-black transition ${
              activeStep === step.key ? 'bg-slate-950 text-white shadow-lg shadow-slate-200' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs ${activeStep === step.key ? 'bg-white text-slate-950' : 'bg-white text-slate-500'}`}>
              {index + 1}
            </span>
            <span className="leading-5">{step.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function WebsiteBuilderLivePreview({ payload, previewMode, setPreviewMode }) {
  return (
    <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start" data-testid="website-builder-live-preview">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_14px_40px_rgba(15,23,42,0.07)]">
        <div>
          <div className="text-lg font-black text-slate-950">Live Preview</div>
          <div className="text-sm text-slate-500">Updates as you edit each step.</div>
        </div>
        <div className="flex rounded-2xl bg-slate-100 p-1.5" data-testid="website-builder-preview-toggle">
          {['desktop', 'mobile'].map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPreviewMode(mode)}
              className={`rounded-xl px-4 py-2 text-sm font-black transition ${previewMode === mode ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:text-slate-950'}`}
            >
              {mode === 'desktop' ? 'Desktop' : 'Mobile'}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-auto rounded-[2rem] border border-slate-200 bg-slate-950 p-3 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        <div className={previewMode === 'mobile' ? 'mx-auto max-w-[390px]' : 'min-w-[620px]'}>
          <PublicWebsiteRenderer payload={payload} previewMode={previewMode} />
        </div>
      </div>
    </aside>
  );
}

export function WebsiteBuilderBasicsStep({ profile, setProfile, onSave, busy }) {
  return (
    <StepCard
      title="Business Basics"
      helper="These details appear at the top of your website and help customers understand where you work."
      actions={<button type="button" onClick={onSave} disabled={busy} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 disabled:bg-slate-300 disabled:shadow-none">Save Basics</button>}
    >
      <Field label="Business name" helper="This appears in your website header.">
        <input className={inputClass()} value={profile.business_name_public || ''} onChange={(event) => setProfile((prev) => ({ ...prev, business_name_public: event.target.value }))} data-testid="wizard-business-name" />
      </Field>
      <Field label="Tagline" helper="A short one-line promise customers see near the hero headline.">
        <input className={inputClass()} value={profile.tagline || ''} onChange={(event) => setProfile((prev) => ({ ...prev, tagline: event.target.value }))} data-testid="wizard-tagline" />
      </Field>
      <Field label="Short description" helper="Use two or three sentences about the work you do best.">
        <textarea className={inputClass()} rows={4} value={profile.bio || ''} onChange={(event) => setProfile((prev) => ({ ...prev, bio: event.target.value }))} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Phone">
          <input className={inputClass()} value={profile.phone_public || ''} onChange={(event) => setProfile((prev) => ({ ...prev, phone_public: event.target.value }))} />
        </Field>
        <Field label="Email">
          <input className={inputClass()} value={profile.email_public || ''} onChange={(event) => setProfile((prev) => ({ ...prev, email_public: event.target.value }))} />
        </Field>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.show_phone_public !== false} onChange={(event) => setProfile((prev) => ({ ...prev, show_phone_public: event.target.checked }))} /> Show phone publicly</label>
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.show_email_public === true} onChange={(event) => setProfile((prev) => ({ ...prev, show_email_public: event.target.checked }))} /> Show email publicly</label>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="City">
          <input className={inputClass()} value={profile.city || ''} onChange={(event) => setProfile((prev) => ({ ...prev, city: event.target.value }))} />
        </Field>
        <Field label="State">
          <input className={inputClass()} value={profile.state || ''} onChange={(event) => setProfile((prev) => ({ ...prev, state: event.target.value }))} />
        </Field>
        <Field label="Service area">
          <input className={inputClass()} value={profile.service_area_text || ''} onChange={(event) => setProfile((prev) => ({ ...prev, service_area_text: event.target.value }))} data-testid="wizard-service-area" />
        </Field>
      </div>
    </StepCard>
  );
}

export function WebsiteBuilderBrandingStep({
  profile,
  setProfile,
  logoFile,
  setLogoFile,
  heroFile,
  setHeroFile,
  website,
  onSaveProfile,
  onSaveWebsiteSettings,
  canCustomize,
  gateReason,
  busy,
}) {
  return (
    <StepCard
      title="Branding"
      helper="Set the visual first impression: logo, hero image, colors, font style, and starter template."
      actions={<button type="button" onClick={onSaveProfile} disabled={busy} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 disabled:bg-slate-300 disabled:shadow-none">Save Branding</button>}
    >
      {!canCustomize ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">{gateReason || 'Upgrade to Pro to customize website templates.'}</div> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Logo" helper="This appears in the website header.">
          <input type="file" accept="image/*" onChange={(event) => setLogoFile(event.target.files?.[0] || null)} className={inputClass()} />
          {logoFile ? <div className="mt-1 text-xs text-slate-500">Selected: {logoFile.name}</div> : null}
        </Field>
        <Field label="Hero image" helper="This appears in the first visual section of your site.">
          <input type="file" accept="image/*" onChange={(event) => setHeroFile(event.target.files?.[0] || null)} className={inputClass()} />
          {heroFile ? <div className="mt-1 text-xs text-slate-500">Selected: {heroFile.name}</div> : null}
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Primary color">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <input type="color" className="h-12 w-full rounded-xl border border-slate-300 bg-white p-1" value={profile.brand_primary_color || '#2563eb'} onChange={(event) => setProfile((prev) => ({ ...prev, brand_primary_color: event.target.value }))} data-testid="wizard-primary-color" />
            <div className="mt-2 text-center text-xs font-bold uppercase text-slate-500">{profile.brand_primary_color || '#2563eb'}</div>
          </div>
        </Field>
        <Field label="Accent color">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <input type="color" className="h-12 w-full rounded-xl border border-slate-300 bg-white p-1" value={profile.brand_accent_color || '#14b8a6'} onChange={(event) => setProfile((prev) => ({ ...prev, brand_accent_color: event.target.value }))} />
            <div className="mt-2 text-center text-xs font-bold uppercase text-slate-500">{profile.brand_accent_color || '#14b8a6'}</div>
          </div>
        </Field>
        <Field label="Font/theme style">
          <select className={inputClass()} value={profile.brand_font_theme || 'modern'} onChange={(event) => setProfile((prev) => ({ ...prev, brand_font_theme: event.target.value }))}>
            <option value="modern">Modern</option>
            <option value="classic">Classic</option>
            <option value="bold">Bold</option>
            <option value="warm">Warm</option>
          </select>
        </Field>
      </div>
      <div>
        <div className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">Template selection</div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              disabled={!canCustomize || busy}
              onClick={() => onSaveWebsiteSettings({ template_key: template.key })}
              className={`group rounded-3xl border p-5 text-left transition disabled:opacity-60 ${(website.template_key || 'starter') === template.key ? 'border-blue-500 bg-blue-50 shadow-[0_14px_35px_rgba(37,99,235,0.14)]' : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg hover:shadow-slate-100'}`}
            >
              <div className="mb-4 grid h-20 grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-2">
                <div className="col-span-2 rounded-xl bg-white shadow-sm" />
                <div className="rounded-xl bg-slate-300" />
                <div className="rounded-xl bg-slate-300" />
                <div className="col-span-2 rounded-xl bg-white shadow-sm" />
              </div>
              <div className="text-base font-black text-slate-950">{template.label}</div>
              <div className="mt-1 text-sm leading-6 text-slate-600">{template.description}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-5 shadow-inner" data-testid="website-builder-ai-branding-disabled">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-base font-black text-slate-950">Need help branding your page?</div>
          <span className="rounded-full bg-blue-600 px-2.5 py-1 text-xs font-black uppercase tracking-[0.12em] text-white">Coming Soon</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Coming soon for Pro/Growth: suggested colors, tagline, hero headline, About copy, service descriptions, template recommendation, and SEO text.
        </p>
      </div>
    </StepCard>
  );
}

export function WebsiteBuilderServicesStep({ profile, setProfile, servicesPage, setPage, onSaveProfile, onSavePage, canCustomize, busy }) {
  const servicesBlock = servicesPage?.content_blocks?.services || {};
  const serviceItems = Array.isArray(servicesBlock.items) ? servicesBlock.items : [];
  function updateItem(index, patch) {
    const nextItems = [...serviceItems];
    nextItems[index] = { ...(nextItems[index] || {}), ...patch };
    setPage(servicesPage, mergePageContent(servicesPage, 'services', { items: nextItems }));
  }
  return (
    <StepCard
      title="Services"
      helper="Help customers quickly see what you do. Keep service names simple and descriptions practical."
      actions={
        <>
          <button type="button" onClick={onSaveProfile} disabled={busy} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 disabled:bg-slate-300 disabled:shadow-none">Save Service Lists</button>
          <button type="button" onClick={() => onSavePage(servicesPage)} disabled={!canCustomize || busy || !servicesPage} className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 transition hover:bg-slate-50 disabled:opacity-50">Save Service Cards</button>
        </>
      }
    >
      <Field label="Work types" helper="Comma-separated, such as Renovation, Repair, Installation.">
        <input className={inputClass()} value={(profile.work_types || []).join(', ')} onChange={(event) => setProfile((prev) => ({ ...prev, work_types: csvToList(event.target.value) }))} data-testid="wizard-work-types" />
      </Field>
      <Field label="Specialties" helper="Comma-separated service specialties customers should know.">
        <input className={inputClass()} value={(profile.specialties || []).join(', ')} onChange={(event) => setProfile((prev) => ({ ...prev, specialties: csvToList(event.target.value) }))} />
      </Field>
      <Field label="Services section intro">
        <textarea className={inputClass()} rows={2} disabled={!canCustomize || !servicesPage} value={servicesBlock.intro || ''} onChange={(event) => setPage(servicesPage, mergePageContent(servicesPage, 'services', { intro: event.target.value }))} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <input disabled={!canCustomize || !servicesPage} className={inputClass()} placeholder={`Service ${index + 1}`} value={serviceItems[index]?.title || ''} onChange={(event) => updateItem(index, { title: event.target.value })} />
            <textarea disabled={!canCustomize || !servicesPage} className={`${inputClass()} mt-2`} rows={2} placeholder="Short description" value={serviceItems[index]?.description || ''} onChange={(event) => updateItem(index, { description: event.target.value })} />
          </div>
        ))}
      </div>
    </StepCard>
  );
}

export function WebsiteBuilderTrustStep({ profile, setProfile, reviewsRows, onToggleReview, onSaveProfile, reviewBusy, busy }) {
  return (
    <StepCard
      title="Trust"
      helper="Choose which credibility signals appear publicly. Missing items are guidance, not errors."
      actions={<button type="button" onClick={onSaveProfile} disabled={busy} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 disabled:bg-slate-300 disabled:shadow-none">Save Trust Settings</button>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.show_license_public !== false} onChange={(event) => setProfile((prev) => ({ ...prev, show_license_public: event.target.checked }))} /> Show license/insurance indicators when available</label>
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.show_reviews !== false} onChange={(event) => setProfile((prev) => ({ ...prev, show_reviews: event.target.checked }))} /> Show reviews section</label>
      </div>
      <Field label="Years in business">
        <input type="number" min="0" className={inputClass()} value={profile.years_in_business || ''} onChange={(event) => setProfile((prev) => ({ ...prev, years_in_business: event.target.value }))} />
      </Field>
      <div>
        <div className="text-sm font-bold text-slate-900">Public reviews</div>
        <div className="mt-3 space-y-2">
          {(reviewsRows || []).slice(0, 5).map((review) => (
            <button key={review.id} type="button" disabled={reviewBusy} onClick={() => onToggleReview(review)} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm leading-6 shadow-sm transition hover:bg-slate-50">
              <span className="font-semibold text-slate-900">{review.is_public === false ? 'Hidden' : 'Visible'}:</span> {review.reviewer_name || 'Customer'} - {review.rating || 5}/5
            </button>
          ))}
          {!reviewsRows?.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-500">Approved reviews will appear here when available.</div> : null}
        </div>
      </div>
    </StepCard>
  );
}

export function WebsiteBuilderPortfolioStep({ galleryRows, onToggleGallery, galleryBusy }) {
  return (
    <StepCard title="Portfolio" helper="Pick which gallery photos appear on the public site. Captions come from the existing gallery title and description.">
      <div className="grid gap-4 md:grid-cols-2">
        {(galleryRows || []).map((item) => (
          <div key={item.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            {item.image_url ? <img src={item.image_url} alt="" className="h-40 w-full rounded-2xl object-cover" /> : <div className="flex h-32 items-center justify-center rounded-2xl bg-slate-100 text-sm text-slate-500">No image preview</div>}
            <div className="mt-4 text-base font-black text-slate-950">{item.title || 'Gallery photo'}</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">{item.description || 'No caption yet.'}</div>
            <button type="button" disabled={galleryBusy} onClick={() => onToggleGallery(item)} className="mt-4 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50">
              {item.is_public === false ? 'Show publicly' : 'Hide publicly'}
            </button>
          </div>
        ))}
        {!galleryRows?.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-500">Add gallery photos from the Gallery tab, then choose what appears here.</div> : null}
      </div>
    </StepCard>
  );
}

export function WebsiteBuilderContactStep({ profile, setProfile, contactPage, setPage, onSaveProfile, onSavePage, canCustomize, busy }) {
  const contactBlock = contactPage?.content_blocks?.contact || {};
  return (
    <StepCard
      title="Contact & Leads"
      helper="Shape the call to action and decide how customers can reach you."
      actions={
        <>
          <button type="button" onClick={onSaveProfile} disabled={busy} className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800 disabled:bg-slate-300 disabled:shadow-none">Save Contact Settings</button>
          <button type="button" onClick={() => onSavePage(contactPage)} disabled={!canCustomize || busy || !contactPage} className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 transition hover:bg-slate-50 disabled:opacity-50">Save Contact Copy</button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.show_quote_cta !== false} onChange={(event) => setProfile((prev) => ({ ...prev, show_quote_cta: event.target.checked }))} /> Show quote request CTA</label>
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.allow_public_intake !== false} onChange={(event) => setProfile((prev) => ({ ...prev, allow_public_intake: event.target.checked }))} /> Allow lead intake form</label>
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.show_phone_public !== false} onChange={(event) => setProfile((prev) => ({ ...prev, show_phone_public: event.target.checked }))} /> Show phone on website</label>
        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700"><input className="mt-1" type="checkbox" checked={profile.show_email_public === true} onChange={(event) => setProfile((prev) => ({ ...prev, show_email_public: event.target.checked }))} /> Show email on website</label>
      </div>
      <Field label="Contact section heading">
        <input className={inputClass()} disabled={!canCustomize || !contactPage} value={contactBlock.heading || ''} onChange={(event) => setPage(contactPage, mergePageContent(contactPage, 'contact', { heading: event.target.value }))} />
      </Field>
      <Field label="CTA button text" helper="This appears in the contact section button.">
        <input className={inputClass()} disabled={!canCustomize || !contactPage} value={contactBlock.cta_text || ''} onChange={(event) => setPage(contactPage, mergePageContent(contactPage, 'contact', { cta_text: event.target.value }))} data-testid="wizard-contact-cta-text" />
      </Field>
      <Field label="Contact form intro text">
        <textarea className={inputClass()} rows={3} disabled={!canCustomize || !contactPage} value={contactBlock.body || ''} onChange={(event) => setPage(contactPage, mergePageContent(contactPage, 'contact', { body: event.target.value }))} />
      </Field>
      <Field label="Intake form helper text" helper="This appears above the project request form.">
        <textarea className={inputClass()} rows={3} disabled={!canCustomize || !contactPage} value={contactBlock.intake_intro || ''} onChange={(event) => setPage(contactPage, mergePageContent(contactPage, 'contact', { intake_intro: event.target.value }))} data-testid="wizard-contact-intake-intro" />
      </Field>
      <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 text-slate-700">
        <input
          className="mt-1"
          type="checkbox"
          disabled={!canCustomize || !contactPage}
          checked={contactBlock.lead_form_enabled !== false}
          onChange={(event) => setPage(contactPage, mergePageContent(contactPage, 'contact', { lead_form_enabled: event.target.checked }))}
        />
        Show website intake form
      </label>
    </StepCard>
  );
}

export function WebsiteBuilderPublishStep({
  readiness,
  blockers,
  website,
  onPublish,
  onPause,
  canPublish,
  publishMessage,
  busy,
}) {
  const checklist = Array.isArray(readiness?.checklist) ? readiness.checklist : [];
  return (
    <StepCard title="Preview & Publish" helper="Check desktop/mobile preview, readiness guidance, blockers, and the public URL before publishing.">
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5" data-testid="website-builder-readiness-checklist">
        <div className="text-base font-black text-slate-950">Readiness checklist</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {checklist.map((item) => (
            <div key={item.key} className={`rounded-2xl px-4 py-3 text-sm leading-6 ${item.complete ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-slate-600 shadow-sm'}`}>
              <span className="font-semibold">{item.complete ? 'Ready' : item.required ? 'Helpful next step' : 'Optional'}:</span> {item.label}
              {!item.complete && item.action ? <div className="mt-1 text-xs">{item.action}</div> : null}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="website-builder-publish-tab">
        <div className="text-base font-black text-slate-950">Publish blockers</div>
        <div className="mt-4 space-y-2">
          {(blockers?.length ? blockers : ['No publish blockers detected.']).map((blocker) => (
            <div key={blocker} className={`rounded-2xl px-4 py-3 text-sm font-semibold leading-6 ${blockers?.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>{blocker}</div>
          ))}
        </div>
        <div className="mt-5 break-all rounded-2xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">{website.public_url || '/websites/your-slug'}</div>
        {publishMessage ? <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">{publishMessage}</div> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={onPublish} disabled={!canPublish || busy} data-testid="website-builder-publish-button" className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none">Publish Snapshot</button>
          <button type="button" onClick={onPause} disabled={busy || website.status !== 'published'} className="rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Pause</button>
        </div>
      </div>
    </StepCard>
  );
}

export default function WebsiteBuilderWizard({
  profile,
  setProfile,
  websiteReadiness,
  setWebsiteReadiness,
  galleryRows,
  reviewsRows,
  logoFile,
  setLogoFile,
  heroFile,
  setHeroFile,
  onSaveProfile,
  onSaveWebsiteSettings,
  onSaveWebsitePage,
  onPublish,
  onPause,
  onToggleGallery,
  onToggleReview,
  galleryBusy,
  reviewBusy,
  busy,
  publishMessage,
}) {
  const [activeStep, setActiveStep] = useState('basics');
  const [previewMode, setPreviewMode] = useState('desktop');
  const logoPreview = useObjectUrl(logoFile);
  const heroPreview = useObjectUrl(heroFile);
  const features = websiteReadiness?.entitlements?.features || {};
  const builderGate = features.website_builder || {};
  const publishGate = features.website_publish || {};
  const canCustomize = Boolean(builderGate.enabled);
  const pages = Array.isArray(websiteReadiness?.pages) ? websiteReadiness.pages : [];
  const website = websiteReadiness?.website || {};
  const readiness = websiteReadiness?.readiness || {};
  const blockers = Array.isArray(websiteReadiness?.publish_blockers) ? websiteReadiness.publish_blockers : [];
  const canPublish = Boolean(publishGate.enabled) && blockers.length === 0;
  const servicesPage = pageByType(pages, 'services');
  const contactPage = pageByType(pages, 'contact');

  function setPage(originalPage, nextPage) {
    if (!originalPage?.id) return;
    setWebsiteReadiness((prev) => ({
      ...prev,
      pages: (Array.isArray(prev.pages) ? prev.pages : []).map((page) => (page.id === originalPage.id ? nextPage : page)),
    }));
  }

  const previewPayload = useMemo(() => {
    const baseProfile = websiteReadiness?.profile || {};
    const publicGallery = (galleryRows || []).filter((item) => item.is_public !== false);
    const publicReviews = (reviewsRows || []).filter((item) => item.is_public !== false);
    return {
      profile: {
        ...baseProfile,
        identity: {
          ...(baseProfile.identity || {}),
          business_name: profile.business_name_public || baseProfile.identity?.business_name || '',
          tagline: profile.tagline || '',
          bio: profile.bio || '',
        },
        branding: {
          ...(baseProfile.branding || {}),
          primary_color: profile.brand_primary_color || baseProfile.branding?.primary_color || '#2563eb',
          accent_color: profile.brand_accent_color || baseProfile.branding?.accent_color || '#14b8a6',
          font_theme: profile.brand_font_theme || baseProfile.branding?.font_theme || 'modern',
        },
        images: {
          ...(baseProfile.images || {}),
          logo: logoPreview || baseProfile.images?.logo || profile.logo_url || '',
          hero: heroPreview || baseProfile.images?.hero || profile.hero_image_url || profile.cover_image_url || '',
          cover: heroPreview || baseProfile.images?.cover || profile.cover_image_url || '',
        },
        service_area: {
          ...(baseProfile.service_area || {}),
          city: profile.city || '',
          state: profile.state || '',
          service_area_text: profile.service_area_text || '',
        },
        services: {
          ...(baseProfile.services || {}),
          specialties: profile.specialties || [],
          work_types: profile.work_types || [],
        },
        contact: {
          ...(baseProfile.contact || {}),
          phone_public: profile.phone_public || '',
          email_public: profile.email_public || '',
          show_phone_public: profile.show_phone_public !== false,
          show_email_public: profile.show_email_public === true,
          allow_public_intake: profile.allow_public_intake !== false,
        },
        trust: {
          ...(baseProfile.trust || {}),
          license_public: profile.show_license_public !== false,
          years_in_business: profile.years_in_business || '',
        },
        gallery: {
          count: publicGallery.length,
          items: publicGallery,
        },
        reviews: {
          count: publicReviews.length,
          selected: publicReviews,
        },
      },
      pages,
      website,
      homepage_layout: {
        ...(website.homepage_layout || {}),
        branding: {
          ...(website.homepage_layout?.branding || {}),
          primary_color: profile.brand_primary_color || '#2563eb',
          accent_color: profile.brand_accent_color || '#14b8a6',
          font_theme: profile.brand_font_theme || 'modern',
        },
        section_order: website.homepage_layout?.section_order || SECTION_ORDER,
      },
    };
  }, [galleryRows, heroPreview, logoPreview, pages, profile, reviewsRows, website, websiteReadiness?.profile]);

  const stepProps = {
    profile,
    setProfile,
    canCustomize,
    busy,
  };

  return (
    <div className="mt-6 space-y-6 overflow-hidden rounded-[2rem] bg-slate-50 p-4 sm:p-6" data-testid="marketing-website-builder-tab">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_rgba(15,23,42,0.08)] md:p-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
          <div>
            <div className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-blue-800">
              Guided Website Setup
            </div>
            <h2 className="mt-4 text-3xl font-black text-slate-950 md:text-4xl">Website Builder</h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              Move through one focused step at a time. The preview updates immediately as you shape your public profile and website draft.
            </p>
          </div>
          <div className="rounded-3xl bg-slate-950 px-5 py-4 text-white">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">Plan</div>
            <div className="mt-1 text-2xl font-black capitalize">{websiteReadiness?.entitlements?.plan || 'free'}</div>
            <div className="mt-2 text-sm text-slate-300">Status: {website.status || 'draft'}</div>
          </div>
        </div>
      </div>

      <WebsiteBuilderStepNav steps={STEPS} activeStep={activeStep} onStepChange={setActiveStep} readinessScore={readiness.score} />

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(420px,0.9fr)_minmax(540px,1.1fr)]">
        <div className="min-w-0" data-testid={`website-builder-${activeStep}-step`}>
          {activeStep === 'basics' ? <WebsiteBuilderBasicsStep {...stepProps} onSave={onSaveProfile} /> : null}
          {activeStep === 'branding' ? (
            <WebsiteBuilderBrandingStep
              {...stepProps}
              logoFile={logoFile}
              setLogoFile={setLogoFile}
              heroFile={heroFile}
              setHeroFile={setHeroFile}
              website={website}
              onSaveProfile={onSaveProfile}
              onSaveWebsiteSettings={onSaveWebsiteSettings}
              gateReason={builderGate.reason}
            />
          ) : null}
          {activeStep === 'services' ? (
            <WebsiteBuilderServicesStep
              {...stepProps}
              servicesPage={servicesPage}
              setPage={setPage}
              onSaveProfile={onSaveProfile}
              onSavePage={onSaveWebsitePage}
            />
          ) : null}
          {activeStep === 'trust' ? (
            <WebsiteBuilderTrustStep
              {...stepProps}
              reviewsRows={reviewsRows}
              onToggleReview={onToggleReview}
              onSaveProfile={onSaveProfile}
              reviewBusy={reviewBusy}
            />
          ) : null}
          {activeStep === 'portfolio' ? (
            <WebsiteBuilderPortfolioStep galleryRows={galleryRows} onToggleGallery={onToggleGallery} galleryBusy={galleryBusy} />
          ) : null}
          {activeStep === 'contact' ? (
            <WebsiteBuilderContactStep
              {...stepProps}
              contactPage={contactPage}
              setPage={setPage}
              onSaveProfile={onSaveProfile}
              onSavePage={onSaveWebsitePage}
            />
          ) : null}
          {activeStep === 'publish' ? (
            <WebsiteBuilderPublishStep
              readiness={readiness}
              blockers={blockers}
              website={website}
              onPublish={onPublish}
              onPause={onPause}
              canPublish={canPublish}
              publishMessage={publishMessage}
              busy={busy}
            />
          ) : null}
        </div>

        <WebsiteBuilderLivePreview payload={previewPayload} previewMode={previewMode} setPreviewMode={setPreviewMode} />
      </div>
    </div>
  );
}
