import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';

import api from '../api';

const emptyLeadForm = {
  source: 'profile',
  full_name: '',
  email: '',
  phone: '',
  project_address: '',
  city: '',
  state: '',
  zip_code: '',
  project_type: '',
  project_description: '',
  preferred_timeline: '',
  budget_text: '',
};

const emptyReviewForm = {
  customer_name: '',
  rating: 5,
  title: '',
  review_text: '',
};

function fmtRating(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(1) : '-';
}

export default function PublicProfile() {
  const { slug = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [leadForm, setLeadForm] = useState(emptyLeadForm);
  const [reviewForm, setReviewForm] = useState(emptyReviewForm);

  useEffect(() => {
    let active = true;
    async function loadProfile() {
      try {
        setLoading(true);
        setError('');
        const { data } = await api.get(`/projects/public/contractors/${slug}/`);
        if (!active) return;
        setProfile(data);
      } catch (err) {
        console.error(err);
        if (!active) return;
        setError(err?.response?.status === 404 ? 'This contractor profile is not available.' : 'Unable to load contractor profile.');
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
    if (profile.show_license_public) items.push('Licensed business');
    if (profile.years_in_business) items.push(`${profile.years_in_business}+ years in business`);
    if (Array.isArray(profile.work_types)) items.push(...profile.work_types.slice(0, 2));
    return items;
  }, [profile]);

  async function submitLead(event) {
    event.preventDefault();
    try {
      setSubmitting(true);
      await api.post(`/projects/public/contractors/${slug}/intake/`, leadForm);
      toast.success('Your project request was submitted.');
      setLeadForm(emptyLeadForm);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Unable to submit your request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReview(event) {
    event.preventDefault();
    try {
      setReviewSubmitting(true);
      await api.post(`/projects/public/contractors/${slug}/reviews/`, reviewForm);
      toast.success('Thanks for your review. It will appear after moderation.');
      setReviewForm(emptyReviewForm);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || err?.response?.data?.rating?.[0] || 'Unable to submit your review.');
    } finally {
      setReviewSubmitting(false);
    }
  }

  if (loading) {
    return <div className="px-4 py-16 text-center text-sm text-slate-500">Loading contractor profile…</div>;
  }

  if (error || !profile) {
    return <div className="px-4 py-16 text-center text-sm text-rose-700">{error || 'Contractor not found.'}</div>;
  }

  const gallery = Array.isArray(profile.gallery) ? profile.gallery : [];
  const reviews = Array.isArray(profile.reviews) ? profile.reviews : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <section className="relative overflow-hidden border-b border-slate-200 bg-slate-900 text-white">
        {profile.cover_image_url ? (
          <img src={profile.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" />
        ) : null}
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
            <div className="mt-6 flex flex-wrap gap-3">
              <a href="#intake" className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">Request Project</a>
              <a href="#gallery" className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20">View Gallery</a>
              {profile.allow_public_reviews ? (
                <a href="#review-form" className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white hover:bg-white/20">Leave Review</a>
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
          {profile.review_count ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              {fmtRating(profile.average_rating)} average rating · {profile.review_count} reviews
            </div>
          ) : null}
        </section>

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

        <section id="gallery" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
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
            <div className="mt-4 text-sm text-slate-500">Gallery coming soon.</div>
          )}
        </section>

        {profile.allow_public_reviews ? (
          <section id="reviews" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-slate-900">Reviews</h2>
              {profile.review_count ? <div className="text-sm font-semibold text-slate-600">{fmtRating(profile.average_rating)} / 5</div> : null}
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
                      <span>{new Date(review.submitted_at).toLocaleDateString()}</span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-500">No public reviews yet.</div>
            )}

            <div id="review-form" className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-lg font-semibold text-slate-900">Leave a Review</div>
              <p className="mt-2 text-sm text-slate-600">
                Reviews are moderated before they appear on the public profile.
              </p>
              <form onSubmit={submitReview} className="mt-4 grid gap-4 md:grid-cols-2">
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
                <div className="md:col-span-2">
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
          </section>
        ) : null}

        {profile.allow_public_intake ? (
          <section id="intake" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Start Your Project</h2>
            <p className="mt-2 text-sm text-slate-600">Tell this contractor about your project and they can follow up directly.</p>
            <form onSubmit={submitLead} className="mt-6 grid gap-4 md:grid-cols-2">
              <input value={leadForm.full_name} onChange={(e) => setLeadForm((prev) => ({ ...prev, full_name: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Full name" />
              <input value={leadForm.email} onChange={(e) => setLeadForm((prev) => ({ ...prev, email: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Email" />
              <input value={leadForm.phone} onChange={(e) => setLeadForm((prev) => ({ ...prev, phone: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Phone" />
              <input value={leadForm.project_type} onChange={(e) => setLeadForm((prev) => ({ ...prev, project_type: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Project type" />
              <input value={leadForm.project_address} onChange={(e) => setLeadForm((prev) => ({ ...prev, project_address: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Project address" />
              <input value={leadForm.city} onChange={(e) => setLeadForm((prev) => ({ ...prev, city: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="City" />
              <input value={leadForm.state} onChange={(e) => setLeadForm((prev) => ({ ...prev, state: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="State" />
              <input value={leadForm.zip_code} onChange={(e) => setLeadForm((prev) => ({ ...prev, zip_code: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="ZIP code" />
              <input value={leadForm.preferred_timeline} onChange={(e) => setLeadForm((prev) => ({ ...prev, preferred_timeline: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Preferred timeline" />
              <input value={leadForm.budget_text} onChange={(e) => setLeadForm((prev) => ({ ...prev, budget_text: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Budget" />
              <textarea value={leadForm.project_description} onChange={(e) => setLeadForm((prev) => ({ ...prev, project_description: e.target.value }))} rows={5} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Tell us about your project" />
              <div className="md:col-span-2">
                <button type="submit" disabled={submitting} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {submitting ? 'Submitting…' : 'Submit Project Request'}
                </button>
              </div>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
