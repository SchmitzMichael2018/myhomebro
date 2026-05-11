import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';

import api, { getContractorRating } from '../api';
import Modal from '../components/Modal.jsx';
import RatingDisplay from '../components/RatingDisplay.jsx';
import PublicQuoteRequestWizard from '../components/PublicQuoteRequestWizard.jsx';
import { buildPublicProfileThemeStyle, getPublicProfileBranding } from '../lib/publicProfileBranding.js';
import { contractorMatchTierClass, contractorMatchTierLabel } from '../lib/contractorMatching.js';

const buildEmptyReviewForm = (context = {}) => ({
  customer_name: '',
  rating: 5,
  title: '',
  review_text: '',
  linked_invoice: context.linked_invoice || '',
  linked_milestone: context.linked_milestone || '',
});

export default function PublicProfile() {
  const { slug = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [ratingInfo, setRatingInfo] = useState({ average_rating: null, review_count: 0, preview: false, new_on_myhomebro: true });
  const [error, setError] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewForm, setReviewForm] = useState(() => buildEmptyReviewForm());
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [quoteWizardOpen, setQuoteWizardOpen] = useState(false);
  const reviewLinkedInvoice = searchParams.get('invoice') || '';
  const reviewLinkedMilestone = searchParams.get('milestone') || '';
  const reviewRequested = searchParams.get('review') === '1' || Boolean(reviewLinkedInvoice || reviewLinkedMilestone);

  useEffect(() => {
    if (!reviewRequested) return;
    setReviewModalOpen(true);
    setReviewForm((prev) => ({
      ...prev,
      linked_invoice: reviewLinkedInvoice,
      linked_milestone: reviewLinkedMilestone,
    }));
  }, [reviewLinkedInvoice, reviewLinkedMilestone, reviewRequested]);

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      try {
        setLoading(true);
        setError('');
        const [profileResult, ratingResult] = await Promise.allSettled([
          api.get(`/projects/public/contractors/${slug}/`),
          getContractorRating(slug),
        ]);
        if (profileResult.status !== 'fulfilled') {
          throw profileResult.reason;
        }
        const { data } = profileResult.value;
        if (!active) return;
        setProfile(data);
        setPreviewMode(Boolean(data?.preview || data?.is_public === false));
        const ratingData = ratingResult.status === 'fulfilled' ? ratingResult.value?.data : null;
        const average = ratingData?.average_rating ?? data?.average_rating ?? null;
        const count = Number(ratingData?.review_count ?? data?.review_count ?? 0);
        setRatingInfo({
          average_rating: Number.isFinite(Number(average)) ? Number(average) : null,
          review_count: Number.isFinite(count) ? count : 0,
          preview: Boolean(ratingData?.preview ?? data?.preview ?? data?.is_public === false),
          new_on_myhomebro: Number.isFinite(count) ? count === 0 : true,
          display_label: ratingData?.display_label || data?.display_label || '',
        });
      } catch (err) {
        console.error(err);
        if (!active) return;
        setError(
          err?.response?.status === 404
            ? 'This contractor profile is not available.'
            : 'Unable to load this contractor profile.'
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    loadProfile();
    return () => {
      active = false;
    };
  }, [slug]);

  const trustItems = useMemo(() => {
    if (!profile) return [];
    const items = [];
    if (Array.isArray(profile.public_trust_indicators)) {
      items.push(...profile.public_trust_indicators);
    }
    if (profile.years_in_business) items.push(`${profile.years_in_business}+ years in business`);
    if (Array.isArray(profile.work_types)) items.push(...profile.work_types.slice(0, 2));
    return [...new Set(items)];
  }, [profile]);

  async function submitReview(event) {
    event.preventDefault();
    try {
      setReviewSubmitting(true);
      const payload = Object.fromEntries(
        Object.entries(reviewForm).filter(([, value]) => value !== '' && value !== null && value !== undefined)
      );
      await api.post(`/projects/public/contractors/${slug}/reviews/`, payload);
      const verified = Boolean(reviewForm.linked_invoice || reviewForm.linked_milestone);
      toast.success(verified ? 'Thanks for your verified review.' : 'Thanks for sharing your review. It will appear after moderation.');
      setReviewForm(buildEmptyReviewForm());
      setReviewModalOpen(false);
      const { data } = await getContractorRating(slug);
      setRatingInfo({
        average_rating: Number.isFinite(Number(data?.average_rating)) ? Number(data.average_rating) : null,
        review_count: Number.isFinite(Number(data?.review_count)) ? Number(data.review_count) : 0,
        preview: Boolean(data?.preview),
        new_on_myhomebro: Number.isFinite(Number(data?.review_count)) ? Number(data.review_count) === 0 : true,
        display_label: data?.display_label || '',
      });
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || err?.response?.data?.rating?.[0] || 'Unable to submit your review.');
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (loading) {
    return <div className="px-4 py-16 text-center text-sm text-slate-500">Loading public profile…</div>;
  }

  if (error || !profile) {
    return <div className="px-4 py-16 text-center text-sm text-rose-700">{error || 'Contractor not found.'}</div>;
  }

  const gallery = Array.isArray(profile.gallery) ? profile.gallery : [];
  const reviews = Array.isArray(profile.reviews) ? profile.reviews : [];
  const contractorProfileInsights = Array.isArray(profile.contractor_profile_insights)
    ? profile.contractor_profile_insights
    : [];
  const compatibilityProfile = profile.compatibility_profile || {};
  const compatibilityBadges = Array.isArray(profile.compatibility_badges) ? profile.compatibility_badges : [];
  const waysIWork = Array.isArray(profile.ways_i_work) ? profile.ways_i_work : [];
  const branding = getPublicProfileBranding(profile);
  const brandingStyle = buildPublicProfileThemeStyle(profile);
  const showReviews = Boolean(profile.show_reviews !== false && profile.allow_public_reviews !== false);
  const showGallery = Boolean(profile.show_gallery !== false);
  const showQuoteCta = Boolean(profile.show_quote_cta !== false);
  const ratingCount = Number(ratingInfo.review_count || 0);
  const ratingValue = ratingInfo.average_rating;
  const verifiedReviewCount = ratingCount;
  const quoteRequestEnabled = Boolean(profile.allow_public_intake && showQuoteCta && !previewMode);
  const heroImageUrl = profile.hero_image_url || profile.cover_image_url || '';

  return (
    <div data-testid="public-profile-root" className="min-h-screen bg-slate-50" style={brandingStyle}>
      {previewMode ? (
        <div
          data-testid="public-profile-preview-banner"
          className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-medium text-amber-800"
        >
          Preview mode: this contractor profile is not public yet.
        </div>
      ) : null}
      <section
        className="relative overflow-hidden border-b border-slate-200 text-white"
        style={{ background: branding.heroBackground, color: branding.textColor }}
      >
        {heroImageUrl ? (
          <img src={heroImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-30" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-br from-black/20 to-black/40" />
        <div className="relative mx-auto grid max-w-6xl gap-6 px-4 py-14 md:grid-cols-[160px_minmax(0,1fr)] md:px-6">
          <div>
            {profile.logo_url ? (
              <img src={profile.logo_url} alt={profile.business_name_public || 'Contractor logo'} className="h-36 w-36 rounded-3xl border border-white/20 bg-white/10 object-cover shadow-lg" />
            ) : (
              <div className="flex h-36 w-36 items-center justify-center rounded-3xl border border-white/20 bg-white/10 text-3xl font-bold">
                {(profile.business_name_public || 'C').slice(0, 1)}
              </div>
            )}
          </div>
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-200">MyHomeBro Contractor</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight">{profile.business_name_public || 'Contractor Profile'}</h1>
            {profile.tagline ? <p className="mt-3 max-w-2xl text-lg text-slate-100">{profile.tagline}</p> : null}
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-100">
              {(profile.city || profile.state) ? <span>{[profile.city, profile.state].filter(Boolean).join(', ')}</span> : null}
              {profile.service_area_text ? <span>{profile.service_area_text}</span> : null}
              {profile.show_phone_public && profile.phone_public ? <span>{profile.phone_public}</span> : null}
              {profile.show_email_public && profile.email_public ? <span>{profile.email_public}</span> : null}
            </div>
            {showReviews ? (
              <div className="mt-5">
                <RatingDisplay
                  testId="public-profile-rating-display"
                  rating={ratingValue}
                  count={verifiedReviewCount}
                  fallbackLabel="New on MyHomeBro"
                  inverted
                />
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap gap-3">
              {showQuoteCta ? (
                <button
                  type="button"
                  onClick={() => setQuoteWizardOpen(true)}
                  disabled={!quoteRequestEnabled}
                  data-testid="public-profile-request-quote-cta"
                  className="rounded-xl px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  style={{ backgroundColor: branding.ctaBackground, color: branding.ctaText }}
                >
                  Request a Quote
                </button>
              ) : null}
              {showGallery ? (
                <a href="#gallery" className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20">View Gallery</a>
              ) : null}
              {showReviews ? (
                <button
                  type="button"
                  onClick={() => setReviewModalOpen(true)}
                  className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20"
                >
                  Leave Review
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 md:px-6">
        <section className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 xl:grid-cols-4">
          {trustItems.map((item) => (
            <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              {item}
            </div>
          ))}
          {showReviews ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <RatingDisplay
                testId="public-profile-rating-summary"
                rating={ratingValue}
                count={verifiedReviewCount}
                fallbackLabel="New on MyHomeBro"
              />
            </div>
          ) : null}
        </section>

        {contractorProfileInsights.length ? (
          <section
            data-testid="public-profile-contractor-insights"
            className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                  How this contractor works
                </div>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">A few things to know before you reach out</h2>
              </div>
            </div>
            <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-700">
              {contractorProfileInsights.slice(0, 6).map((item, index) => (
                <li key={`${item}-${index}`} className="flex gap-3">
                  <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {(compatibilityBadges.length || waysIWork.length || compatibilityProfile.summary) ? (
          <section data-testid="public-profile-compatibility" className="rounded-3xl border border-sky-200 bg-sky-50/80 p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Ways I Work
                </div>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">Good fit for collaborative projects</h2>
              </div>
              {compatibilityProfile.tier ? (
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${contractorMatchTierClass(compatibilityProfile.tier)}`}>
                  {contractorMatchTierLabel(compatibilityProfile.tier)}
                </span>
              ) : null}
            </div>
            {compatibilityProfile.summary ? (
              <p className="mt-3 text-sm leading-6 text-slate-700">{compatibilityProfile.summary}</p>
            ) : null}
            {compatibilityBadges.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {compatibilityBadges.map((badge) => (
                  <span key={badge} className="rounded-full border border-sky-200 bg-white px-3 py-1 text-sm font-semibold text-sky-700">
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
            {waysIWork.length ? (
              <ul className="mt-5 space-y-3 text-sm leading-7 text-slate-700">
                {waysIWork.slice(0, 5).map((item, index) => (
                  <li key={`${item?.key || item?.label || index}`} className="flex gap-3">
                    <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden="true" />
                    <span>
                      <span className="font-semibold text-slate-900">{item?.label || 'Project support'}</span>
                      {item?.description ? ` — ${item.description}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {Array.isArray(compatibilityProfile.reasons) && compatibilityProfile.reasons.length ? (
              <div className="mt-4 rounded-2xl border border-white bg-white p-4 text-sm text-slate-700 shadow-sm">
                <div className="font-semibold text-slate-900">Why this contractor fits collaborative work</div>
                <ul className="mt-2 space-y-2">
                  {compatibilityProfile.reasons.slice(0, 4).map((reason, index) => (
                    <li key={`${reason}-${index}`}>• {reason}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {profile.bio ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">About</h2>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-700">{profile.bio}</p>
          </section>
        ) : null}

        {(Array.isArray(profile.specialties) && profile.specialties.length) || (Array.isArray(profile.work_types) && profile.work_types.length) ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Services & Specialties</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {[...(profile.specialties || []), ...(profile.work_types || [])].map((label) => (
                <span key={label} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700">
                  {label}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {showGallery ? (
        <section id="gallery" data-testid="public-profile-gallery-section" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-slate-900">Gallery</h2>
            <div className="text-sm text-slate-500">{gallery.length} public project photos</div>
          </div>
          {gallery.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {gallery.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {item.image_url ? <img src={item.image_url} alt={item.title || 'Project photo'} className="h-56 w-full object-cover" /> : null}
                  <div className="p-4">
                    <div className="text-lg font-semibold text-slate-900">{item.title || 'Featured project'}</div>
                    <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{item.category || 'Project'}</div>
                    {item.description ? <p className="mt-3 text-sm text-slate-700">{item.description}</p> : null}
                    {(item.project_city || item.project_state) ? (
                      <div className="mt-3 text-xs text-slate-500">{[item.project_city, item.project_state].filter(Boolean).join(', ')}</div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-4 text-sm text-slate-500">No public project photos yet.</div>
          )}
        </section>
        ) : null}

        {showReviews ? (
          <section id="reviews" data-testid="public-profile-reviews-section" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-slate-900">Reviews</h2>
              <RatingDisplay
                testId="public-profile-reviews-rating"
                rating={ratingValue}
                count={verifiedReviewCount}
                fallbackLabel="New on MyHomeBro"
                className="items-end text-right"
              />
            </div>
            {reviews.length ? (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                {reviews.map((review) => (
                  <article key={review.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{review.customer_name}</div>
                        {review.title ? <div className="mt-1 text-sm text-slate-700">{review.title}</div> : null}
                      </div>
                      <div className="text-sm font-bold text-slate-900">{review.rating}/5</div>
                    </div>
                    {review.review_text ? <p className="mt-3 text-sm text-slate-700">{review.review_text}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                      {review.is_verified ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">Verified</span> : null}
                      {review.linked_invoice_id ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-700">Invoice linked</span> : null}
                      {review.linked_milestone_id ? <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">Milestone linked</span> : null}
                      <span>{new Date(review.submitted_at).toLocaleDateString()}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                <div className="font-semibold text-slate-900">New on MyHomeBro</div>
                <p className="mt-1">This contractor is building their verified review history. Leave the first review after your approved invoice or completed milestone.</p>
              </div>
            )}
          </section>
        ) : null}

        {showQuoteCta ? (
        <section id="intake" data-testid="public-profile-quote-cta-section" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold text-slate-900">Request a Quote</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Use the guided quote request to share the project details, photos, timing, and contact preferences in one place. The contractor will review it and follow up directly.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setQuoteWizardOpen(true)}
              disabled={!quoteRequestEnabled}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Request a Quote
            </button>
          </div>
          <div className="mt-5 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Project basics and a clear description</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">Photos, timing, property, and budget</div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">A direct request goes to the contractor queue</div>
          </div>
          {!quoteRequestEnabled ? (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Preview mode: this contractor profile is not public yet, so quote requests are disabled for now.
            </div>
          ) : null}
        </section>
        ) : null}
      </div>

      <PublicQuoteRequestWizard
        open={quoteWizardOpen && quoteRequestEnabled}
        slug={slug}
        contractorName={profile.business_name_public}
        businessName={profile.business_name_public}
        profile={profile}
        onClose={() => setQuoteWizardOpen(false)}
        onSubmitted={() => {}}
      />

      <Modal
        visible={reviewModalOpen}
        title={ratingCount > 0 ? 'Leave a Review' : 'Be the first to review'}
        onClose={() => setReviewModalOpen(false)}
        testId="public-profile-review-modal"
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="font-semibold text-slate-900">Verified review option</div>
            <p className="mt-1">
              If this review came from an approved invoice or a completed milestone, we will mark it verified so it counts toward the contractor's public rating.
            </p>
          </div>
          <form onSubmit={submitReview} className="grid gap-4 md:grid-cols-2">
            <input
              value={reviewForm.customer_name}
              onChange={(e) => setReviewForm((prev) => ({ ...prev, customer_name: e.target.value }))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              placeholder="Your name"
            />
            <input
              type="number"
              min="1"
              max="5"
              value={reviewForm.rating}
              onChange={(e) => setReviewForm((prev) => ({ ...prev, rating: Number(e.target.value || 5) }))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              placeholder="Rating"
            />
            <input
              value={reviewForm.title}
              onChange={(e) => setReviewForm((prev) => ({ ...prev, title: e.target.value }))}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder="Review title"
            />
            <textarea
              value={reviewForm.review_text}
              onChange={(e) => setReviewForm((prev) => ({ ...prev, review_text: e.target.value }))}
              rows={4}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
              placeholder="Share your experience"
            />
            {reviewForm.linked_invoice || reviewForm.linked_milestone ? (
              <div className="md:col-span-2 flex flex-wrap gap-2 text-xs text-slate-500">
                {reviewForm.linked_invoice ? <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 font-semibold text-blue-700">Invoice linked</span> : null}
                {reviewForm.linked_milestone ? <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">Milestone linked</span> : null}
              </div>
            ) : null}
            <div className="md:col-span-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setReviewModalOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={reviewSubmitting}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {reviewSubmitting ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
