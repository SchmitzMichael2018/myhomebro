import React from 'react';

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

export default function PublicWebsiteRenderer({ payload, currentPage, previewMode = 'desktop' }) {
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
  const primary = color(branding.primary_color, profile.branding?.primary_color || '#2563eb');
  const accent = color(branding.accent_color, profile.branding?.accent_color || '#14b8a6');
  const heroImage = profile.images?.hero || profile.images?.cover || gallery.items?.[0]?.image_url || '';
  const serviceItems = [
    ...(Array.isArray(services.specialties) ? services.specialties : []),
    ...(Array.isArray(services.work_types) ? services.work_types : []),
    ...(Array.isArray(services.skills) ? services.skills : []),
  ].filter(Boolean).slice(0, 8);
  const serviceCards = Array.isArray(serviceBlock.items) && serviceBlock.items.length
    ? serviceBlock.items
    : serviceItems.map((item) => ({ title: item, description: '' }));
  const sections = visibleSections(layout);

  return (
    <article
      data-testid="public-website-renderer"
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm ${
        previewMode === 'mobile' ? 'mx-auto max-w-sm' : 'w-full'
      }`}
      style={{ '--website-primary': primary, '--website-accent': accent }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {profile.images?.logo ? (
            <img src={profile.images.logo} alt="" className="h-10 w-10 rounded-xl object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-xl" style={{ background: primary }} />
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{identity.business_name || 'Contractor Website'}</div>
            <div className="truncate text-xs text-slate-500">{serviceArea.service_area_text || [serviceArea.city, serviceArea.state].filter(Boolean).join(', ')}</div>
          </div>
        </div>
        <a
          href={contact.phone_public ? `tel:${contact.phone_public}` : '#contact'}
          className="rounded-full px-4 py-2 text-xs font-bold text-white"
          style={{ background: primary }}
        >
          Request Quote
        </a>
      </header>

      {sections.includes('hero') ? (
        <section className="grid gap-0 md:grid-cols-[1.05fr_0.95fr]">
          <div className="px-6 py-10 md:px-8 md:py-14">
            <div className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
              {identity.tagline || 'Local contractor'}
            </div>
            <h1 className="mt-4 text-3xl font-black leading-tight md:text-5xl">
              {hero.headline || identity.business_name || 'Build with confidence'}
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              {hero.subheadline || about.body || identity.bio || 'Professional project planning, clear agreements, and reliable communication from first request to final walkthrough.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#contact" className="rounded-xl px-5 py-3 text-sm font-bold text-white" style={{ background: primary }}>
                {hero.cta_text || 'Request a Quote'}
              </a>
              <a href="#portfolio" className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-800">
                View Work
              </a>
            </div>
          </div>
          <div className="min-h-64 bg-slate-100">
            {heroImage ? (
              <img src={heroImage} alt="" className="h-full min-h-64 w-full object-cover" />
            ) : (
              <div className="flex h-full min-h-64 items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">
                Add a hero or portfolio photo
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
              <div key={item.title || item} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="font-semibold">{item.title || item}</div>
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
            {!gallery.items?.length ? <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Portfolio photos will appear here.</div> : null}
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
                <figcaption className="mt-3 text-xs font-semibold text-slate-500">{review.reviewer_name || 'Customer'}</figcaption>
              </figure>
            ))}
            {!reviews.selected?.length ? <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Approved reviews will appear here.</div> : null}
          </div>
        </section>
      ) : null}

      {sections.includes('trust') ? (
        <section className="border-t border-slate-200 px-6 py-8 md:px-8">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4 text-sm"><span className="font-bold">Licensed:</span> {trust.license_public ? 'Visible' : 'Not shown'}</div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm"><span className="font-bold">Reviews:</span> {reviews.count || 0}</div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm"><span className="font-bold">Portfolio:</span> {gallery.count || 0} items</div>
          </div>
        </section>
      ) : null}

      {sections.includes('contact') ? (
        <section id="contact" className="border-t border-slate-200 px-6 py-8 md:px-8">
          <div className="rounded-2xl p-6 text-white" style={{ background: primary }}>
            <h2 className="text-2xl font-black">{contactBlock.heading || 'Ready to start?'}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/85">{contactBlock.body || 'Share the basics and we will help turn the project into a clear next step.'}</p>
            <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
              {contact.show_phone_public && contact.phone_public ? <a href={`tel:${contact.phone_public}`} className="rounded-xl bg-white px-4 py-2" style={{ color: primary }}>{contact.phone_public}</a> : null}
              {contact.show_email_public && contact.email_public ? <a href={`mailto:${contact.email_public}`} className="rounded-xl bg-white px-4 py-2" style={{ color: primary }}>{contact.email_public}</a> : null}
              {!contact.phone_public && !contact.email_public ? <span className="rounded-xl bg-white px-4 py-2" style={{ color: primary }}>Use the quote request form</span> : null}
            </div>
          </div>
        </section>
      ) : null}
    </article>
  );
}
