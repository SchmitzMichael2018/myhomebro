import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import api from '../api';
import { WorkflowHint } from '../components/WorkflowHint.jsx';
import { getPublicLeadHint, getPublicPresenceHint } from '../lib/workflowHints.js';

const TABS = [
  { key: 'profile', label: 'Public Profile' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'leads', label: 'Public Leads' },
];

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function fmtDateTime(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function statusChipClass(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'new') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (normalized === 'accepted') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (normalized === 'rejected') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (normalized === 'contacted' || normalized === 'qualified') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (normalized === 'closed') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (normalized === 'archived') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

const defaultProfile = {
  slug: '',
  business_name_public: '',
  tagline: '',
  bio: '',
  city: '',
  state: '',
  service_area_text: '',
  years_in_business: '',
  website_url: '',
  phone_public: '',
  email_public: '',
  specialties: [],
  work_types: [],
  show_license_public: true,
  show_phone_public: true,
  show_email_public: false,
  allow_public_intake: true,
  allow_public_reviews: true,
  is_public: false,
  seo_title: '',
  seo_description: '',
  public_url: '',
  logo_url: '',
  cover_image_url: '',
};

export default function ContractorPublicPresencePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [profile, setProfile] = useState(defaultProfile);
  const [profileBusy, setProfileBusy] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [qrData, setQrData] = useState(null);
  const [galleryRows, setGalleryRows] = useState([]);
  const [reviewsRows, setReviewsRows] = useState([]);
  const [leadsRows, setLeadsRows] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [leadBusy, setLeadBusy] = useState(false);
  const [galleryForm, setGalleryForm] = useState({
    title: '',
    description: '',
    category: '',
    sort_order: 0,
    project_city: '',
    project_state: '',
    is_featured: false,
    is_public: true,
  });
  const [galleryImage, setGalleryImage] = useState(null);

  const specialtiesText = useMemo(
    () => (Array.isArray(profile.specialties) ? profile.specialties.join(', ') : ''),
    [profile.specialties]
  );
  const workTypesText = useMemo(
    () => (Array.isArray(profile.work_types) ? profile.work_types.join(', ') : ''),
    [profile.work_types]
  );
  const profileHint = useMemo(
    () => getPublicPresenceHint({ profile, galleryRows, reviewsRows, qrData }),
    [galleryRows, profile, qrData, reviewsRows]
  );
  const selectedLeadHint = useMemo(() => getPublicLeadHint(selectedLead), [selectedLead]);

  async function loadAll() {
    try {
      setLoading(true);
      const [profileRes, qrRes, galleryRes, reviewsRes, leadsRes] = await Promise.all([
        api.get('/projects/contractor/public-profile/'),
        api.get('/projects/contractor/public-profile/qr/'),
        api.get('/projects/contractor/gallery/'),
        api.get('/projects/contractor/reviews/'),
        api.get('/projects/contractor/public-leads/'),
      ]);
      setProfile({ ...defaultProfile, ...(profileRes.data || {}) });
      setQrData(qrRes.data || null);
      setGalleryRows(normalizeList(galleryRes.data));
      setReviewsRows(normalizeList(reviewsRes.data));
      const leadResults = normalizeList(leadsRes.data);
      setLeadsRows(leadResults);
      setSelectedLead(leadResults[0] || null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load public presence.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function saveProfile() {
    try {
      setProfileBusy(true);
      const payload = new FormData();
      const scalarFields = [
        'slug',
        'business_name_public',
        'tagline',
        'bio',
        'city',
        'state',
        'service_area_text',
        'years_in_business',
        'website_url',
        'phone_public',
        'email_public',
        'seo_title',
        'seo_description',
      ];
      scalarFields.forEach((field) => {
        if (profile[field] !== undefined && profile[field] !== null) {
          payload.append(field, profile[field]);
        }
      });
      payload.append('specialties', JSON.stringify(specialtiesText.split(',').map((item) => item.trim()).filter(Boolean)));
      payload.append('work_types', JSON.stringify(workTypesText.split(',').map((item) => item.trim()).filter(Boolean)));
      [
        'show_license_public',
        'show_phone_public',
        'show_email_public',
        'allow_public_intake',
        'allow_public_reviews',
        'is_public',
      ].forEach((field) => payload.append(field, profile[field] ? 'true' : 'false'));
      if (logoFile) payload.append('logo', logoFile);
      if (coverFile) payload.append('cover_image', coverFile);

      const { data } = await api.patch('/projects/contractor/public-profile/', payload);
      setProfile({ ...defaultProfile, ...(data || {}) });
      setLogoFile(null);
      setCoverFile(null);
      const qrRes = await api.get('/projects/contractor/public-profile/qr/');
      setQrData(qrRes.data || null);
      toast.success('Public profile saved.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || err?.response?.data?.slug?.[0] || 'Failed to save public profile.');
    } finally {
      setProfileBusy(false);
    }
  }

  async function addGalleryItem() {
    if (!galleryImage) {
      toast.error('Select an image first.');
      return;
    }
    try {
      setGalleryBusy(true);
      const payload = new FormData();
      Object.entries(galleryForm).forEach(([key, value]) => {
        payload.append(key, typeof value === 'boolean' ? String(value) : value ?? '');
      });
      payload.append('image', galleryImage);
      await api.post('/projects/contractor/gallery/', payload);
      setGalleryForm({
        title: '',
        description: '',
        category: '',
        sort_order: 0,
        project_city: '',
        project_state: '',
        is_featured: false,
        is_public: true,
      });
      setGalleryImage(null);
      const { data } = await api.get('/projects/contractor/gallery/');
      setGalleryRows(normalizeList(data));
      toast.success('Gallery item added.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to add gallery item.');
    } finally {
      setGalleryBusy(false);
    }
  }

  async function toggleGalleryVisibility(item) {
    try {
      const { data } = await api.patch(`/projects/contractor/gallery/${item.id}/`, {
        is_public: !item.is_public,
      });
      setGalleryRows((prev) => prev.map((row) => (row.id === item.id ? data : row)));
    } catch (err) {
      console.error(err);
      toast.error('Failed to update gallery item.');
    }
  }

  async function deleteGalleryItem(item) {
    try {
      await api.delete(`/projects/contractor/gallery/${item.id}/`);
      setGalleryRows((prev) => prev.filter((row) => row.id !== item.id));
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete gallery item.');
    }
  }

  async function toggleReviewVisibility(review) {
    try {
      setReviewBusy(true);
      const { data } = await api.patch(`/projects/contractor/reviews/${review.id}/`, {
        is_public: !review.is_public,
      });
      setReviewsRows((prev) => prev.map((row) => (row.id === review.id ? data : row)));
    } catch (err) {
      console.error(err);
      toast.error('Failed to update review visibility.');
    } finally {
      setReviewBusy(false);
    }
  }

  async function saveLead(lead) {
    try {
      setLeadBusy(true);
      const { data } = await api.patch(`/projects/contractor/public-leads/${lead.id}/`, {
        status: lead.status,
        internal_notes: lead.internal_notes || '',
      });
      setLeadsRows((prev) => prev.map((row) => (row.id === data.id ? data : row)));
      setSelectedLead(data);
      toast.success('Lead updated.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update lead.');
    } finally {
      setLeadBusy(false);
    }
  }

  async function updateLeadStatus(nextStatus) {
    if (!selectedLead) return;
    await saveLead({ ...selectedLead, status: nextStatus });
  }

  async function acceptLead() {
    if (!selectedLead) return;
    try {
      setLeadBusy(true);
      const { data } = await api.post(
        `/projects/contractor/public-leads/${selectedLead.id}/accept/`
      );
      setLeadsRows((prev) => prev.map((row) => (row.id === data.id ? data : row)));
      setSelectedLead(data);
      toast.success(data?.notification_detail || 'Lead accepted.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.email?.[0] || 'Failed to accept lead.');
    } finally {
      setLeadBusy(false);
    }
  }

  async function rejectLead() {
    if (!selectedLead) return;
    try {
      setLeadBusy(true);
      const { data } = await api.post(
        `/projects/contractor/public-leads/${selectedLead.id}/reject/`
      );
      setLeadsRows((prev) => prev.map((row) => (row.id === data.id ? data : row)));
      setSelectedLead(data);
      toast.success(data?.notification_detail || 'Lead rejected.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Failed to reject lead.');
    } finally {
      setLeadBusy(false);
    }
  }

  async function analyzeLeadWithAi() {
    if (!selectedLead) return;
    try {
      setLeadBusy(true);
      const { data } = await api.post(
        `/projects/contractor/public-leads/${selectedLead.id}/analyze/`
      );
      const updated = { ...selectedLead, ai_analysis: data?.ai_analysis || {} };
      setLeadsRows((prev) =>
        prev.map((row) => (row.id === selectedLead.id ? updated : row))
      );
      setSelectedLead(updated);
      toast.success('Lead analyzed with AI.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Failed to analyze lead.');
    } finally {
      setLeadBusy(false);
    }
  }

  async function createAgreementFromLead() {
    if (!selectedLead) return;
    try {
      setLeadBusy(true);
      const { data } = await api.post(
        `/projects/contractor/public-leads/${selectedLead.id}/create-agreement/`
      );
      const updated = {
        ...selectedLead,
        converted_agreement: data?.agreement_id || selectedLead.converted_agreement,
      };
      setLeadsRows((prev) =>
        prev.map((row) => (row.id === selectedLead.id ? updated : row))
      );
      setSelectedLead(updated);
      navigate(data?.wizard_url || `/app/agreements/${data?.agreement_id}`);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Failed to create agreement.');
    } finally {
      setLeadBusy(false);
    }
  }

  async function convertLeadToCustomer() {
    if (!selectedLead) return;
    try {
      setLeadBusy(true);
      const { data } = await api.post(
        `/projects/contractor/public-leads/${selectedLead.id}/convert-homeowner/`
      );
      setLeadsRows((prev) => prev.map((row) => (row.id === data.id ? data : row)));
      setSelectedLead(data);
      toast.success('Lead converted to customer.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.email?.[0] || 'Failed to convert lead.');
    } finally {
      setLeadBusy(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(qrData?.public_url || profile.public_url || '');
      toast.success('Public URL copied.');
    } catch (err) {
      console.error(err);
      toast.error('Unable to copy URL.');
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading public presence…</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 data-testid="public-presence-title" className="text-2xl font-bold text-slate-900">
              Public Presence
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Manage your public contractor profile, gallery, leads, reviews, and shareable QR.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyUrl}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Copy Public URL
            </button>
            <a
              href={profile.public_url || '#'}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Public Profile
            </a>
          </div>
        </div>
        <WorkflowHint
          hint={profileHint}
          testId="public-presence-profile-hint"
          className="mt-4"
        />
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_320px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={[
                  'rounded-full px-4 py-2 text-sm font-semibold transition',
                  activeTab === tab.key
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                ].join(' ')}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'profile' ? (
            <div className="mt-6 space-y-4" data-testid="public-presence-profile-tab">
              <div className="grid gap-4 md:grid-cols-2">
                <input
                  value={profile.business_name_public || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, business_name_public: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Public business name"
                />
                <input
                  value={profile.slug || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, slug: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Public slug"
                />
                <input
                  value={profile.tagline || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, tagline: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="Tagline"
                />
                <textarea
                  value={profile.bio || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))}
                  rows={5}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="About your business"
                />
                <input
                  value={profile.city || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, city: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="City"
                />
                <input
                  value={profile.state || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, state: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="State"
                />
                <input
                  value={profile.service_area_text || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, service_area_text: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="Service area"
                />
                <input
                  value={profile.years_in_business || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, years_in_business: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Years in business"
                />
                <input
                  value={profile.website_url || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, website_url: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Website URL"
                />
                <input
                  value={profile.phone_public || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, phone_public: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Public phone"
                />
                <input
                  value={profile.email_public || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, email_public: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Public email"
                />
                <input
                  value={specialtiesText}
                  onChange={(e) => setProfile((prev) => ({ ...prev, specialties: e.target.value.split(',') }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="Specialties (comma separated)"
                />
                <input
                  value={workTypesText}
                  onChange={(e) => setProfile((prev) => ({ ...prev, work_types: e.target.value.split(',') }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="Work types (comma separated)"
                />
                <input
                  value={profile.seo_title || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, seo_title: e.target.value }))}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="SEO title"
                />
                <textarea
                  value={profile.seo_description || ''}
                  onChange={(e) => setProfile((prev) => ({ ...prev, seo_description: e.target.value }))}
                  rows={3}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                  placeholder="SEO description"
                />
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Logo</div>
                  {profile.logo_url ? <img src={profile.logo_url} alt="Logo" className="h-24 w-24 rounded-xl object-cover" /> : null}
                  <input type="file" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cover image</div>
                  {profile.cover_image_url ? <img src={profile.cover_image_url} alt="Cover" className="h-24 w-full rounded-xl object-cover" /> : null}
                  <input type="file" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['is_public', 'Public profile visible'],
                  ['allow_public_intake', 'Allow public intake'],
                  ['allow_public_reviews', 'Show public reviews'],
                  ['show_license_public', 'Show license status'],
                  ['show_phone_public', 'Show phone publicly'],
                  ['show_email_public', 'Show email publicly'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(profile[key])}
                      onChange={(e) => setProfile((prev) => ({ ...prev, [key]: e.target.checked }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  data-testid="public-presence-save-profile"
                  onClick={saveProfile}
                  disabled={profileBusy}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {profileBusy ? 'Saving…' : 'Save Public Profile'}
                </button>
              </div>
            </div>
          ) : null}

          {activeTab === 'gallery' ? (
            <div className="mt-6 space-y-4" data-testid="public-presence-gallery-tab">
              <div className="grid gap-4 md:grid-cols-2">
                <input value={galleryForm.title} onChange={(e) => setGalleryForm((prev) => ({ ...prev, title: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Title" />
                <input value={galleryForm.category} onChange={(e) => setGalleryForm((prev) => ({ ...prev, category: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Category" />
                <textarea value={galleryForm.description} onChange={(e) => setGalleryForm((prev) => ({ ...prev, description: e.target.value }))} rows={3} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Description" />
                <input value={galleryForm.project_city} onChange={(e) => setGalleryForm((prev) => ({ ...prev, project_city: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Project city" />
                <input value={galleryForm.project_state} onChange={(e) => setGalleryForm((prev) => ({ ...prev, project_state: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Project state" />
                <input type="number" value={galleryForm.sort_order} onChange={(e) => setGalleryForm((prev) => ({ ...prev, sort_order: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="Sort order" />
                <input type="file" onChange={(e) => setGalleryImage(e.target.files?.[0] || null)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={galleryForm.is_featured} onChange={(e) => setGalleryForm((prev) => ({ ...prev, is_featured: e.target.checked }))} /> Featured</label>
                <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={galleryForm.is_public} onChange={(e) => setGalleryForm((prev) => ({ ...prev, is_public: e.target.checked }))} /> Public</label>
              </div>
              <button type="button" onClick={addGalleryItem} disabled={galleryBusy} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                {galleryBusy ? 'Saving…' : 'Add Gallery Item'}
              </button>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {galleryRows.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    {item.image_url ? <img src={item.image_url} alt={item.title || 'Gallery item'} className="h-40 w-full rounded-xl object-cover" /> : null}
                    <div className="mt-3 text-sm font-semibold text-slate-900">{item.title || 'Untitled project'}</div>
                    <div className="mt-1 text-xs text-slate-500">{item.category || 'Uncategorized'}</div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={() => toggleGalleryVisibility(item)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                        {item.is_public ? 'Hide' : 'Make Public'}
                      </button>
                      <button type="button" onClick={() => deleteGalleryItem(item)} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeTab === 'reviews' ? (
            <div className="mt-6 space-y-4" data-testid="public-presence-reviews-tab">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                Public review submissions stay hidden until you publish them here. Verified badges stay read-only unless a safe agreement-linked workflow sets them.
              </div>

              <div className="space-y-3">
                {reviewsRows.map((review) => (
                  <div key={review.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{review.customer_name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {review.rating}/5 {review.title ? `· ${review.title}` : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            review.is_public
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {review.is_public ? 'Public' : 'Pending moderation'}
                        </span>
                        {review.is_verified ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                            Verified
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-slate-700">{review.review_text}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => toggleReviewVisibility(review)}
                        disabled={reviewBusy}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {review.is_public ? 'Hide Review' : 'Publish Review'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {activeTab === 'leads' ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="public-presence-leads-tab">
              <div className="space-y-3">
                {leadsRows.map((lead) => (
                  <button
                    key={lead.id}
                    type="button"
                    onClick={() => setSelectedLead(lead)}
                    className={[
                      'w-full rounded-2xl border p-4 text-left',
                      selectedLead?.id === lead.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-slate-800',
                    ].join(' ')}
                  >
                    <div className="text-sm font-semibold">{lead.full_name}</div>
                    <div className="mt-1 text-xs opacity-80">{lead.project_type || 'New project request'}</div>
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {selectedLead ? (
                  <>
                    <WorkflowHint
                      hint={selectedLeadHint}
                      testId="public-lead-workflow-hint"
                      className="mb-4"
                    />
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-slate-900">{selectedLead.full_name}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {selectedLead.email || 'No email'} · {selectedLead.phone || 'No phone'}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChipClass(selectedLead.status)}`}>
                        {selectedLead.status}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-slate-700">
                      <div><span className="font-semibold text-slate-900">Source:</span> {selectedLead.source}</div>
                      <div><span className="font-semibold text-slate-900">Timeline:</span> {selectedLead.preferred_timeline || '-'}</div>
                      <div><span className="font-semibold text-slate-900">Budget:</span> {selectedLead.budget_text || '-'}</div>
                      <div><span className="font-semibold text-slate-900">Created:</span> {fmtDateTime(selectedLead.created_at)}</div>
                    </div>
                    {selectedLead.accepted_at ? (
                      <div className="mt-3 text-xs font-medium text-indigo-700">
                        Accepted: {fmtDateTime(selectedLead.accepted_at)}
                      </div>
                    ) : null}
                    <div className="mt-4 text-sm text-slate-700">{selectedLead.project_description || 'No project description provided.'}</div>
                    {selectedLead.ai_analysis?.suggested_title ? (
                      <div className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                          AI Intake Analysis
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">
                          {selectedLead.ai_analysis.suggested_title}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {selectedLead.ai_analysis.project_type ? (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">
                              {selectedLead.ai_analysis.project_type}
                            </span>
                          ) : null}
                          {selectedLead.ai_analysis.project_subtype ? (
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">
                              {selectedLead.ai_analysis.project_subtype}
                            </span>
                          ) : null}
                          {selectedLead.ai_analysis.template_name ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                              Template: {selectedLead.ai_analysis.template_name}
                            </span>
                          ) : null}
                        </div>
                        {selectedLead.ai_analysis.suggested_description ? (
                          <div className="mt-3 text-sm text-slate-700">
                            {selectedLead.ai_analysis.suggested_description}
                          </div>
                        ) : null}
                        <div className="mt-3 grid gap-3 md:grid-cols-2 text-xs text-slate-600">
                          <div>
                            Clarifications: {Array.isArray(selectedLead.ai_analysis.clarifications_needed) ? selectedLead.ai_analysis.clarifications_needed.length : 0}
                          </div>
                          <div>
                            Milestones: {Array.isArray(selectedLead.ai_analysis.milestone_outline) ? selectedLead.ai_analysis.milestone_outline.length : 0}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <select value={selectedLead.status} onChange={(e) => setSelectedLead((prev) => ({ ...prev, status: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
                        <option value="new">New</option>
                        <option value="accepted">Accepted</option>
                        <option value="rejected">Rejected</option>
                        <option value="contacted">Contacted</option>
                        <option value="qualified">Qualified</option>
                        <option value="closed">Closed</option>
                        <option value="archived">Archived</option>
                      </select>
                      <textarea value={selectedLead.internal_notes || ''} onChange={(e) => setSelectedLead((prev) => ({ ...prev, internal_notes: e.target.value }))} rows={4} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Internal notes" />
                    </div>
                    {selectedLead.converted_homeowner_name ? (
                      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        Converted to customer: {selectedLead.converted_homeowner_name}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {selectedLead.status !== 'accepted' ? (
                        <button type="button" onClick={acceptLead} disabled={leadBusy} className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">
                          Accept
                        </button>
                      ) : null}
                      {selectedLead.status !== 'rejected' ? (
                        <button type="button" onClick={rejectLead} disabled={leadBusy || Boolean(selectedLead.converted_agreement)} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                          Reject
                        </button>
                      ) : null}
                      <button type="button" onClick={analyzeLeadWithAi} disabled={leadBusy || selectedLead.status !== 'accepted'} className="rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
                        Analyze Intake with AI
                      </button>
                      <button type="button" onClick={createAgreementFromLead} disabled={leadBusy || selectedLead.status !== 'accepted'} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                        Create AI-Assisted Agreement
                      </button>
                      <button type="button" onClick={() => updateLeadStatus('contacted')} disabled={leadBusy} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        Mark Contacted
                      </button>
                      <button type="button" onClick={() => updateLeadStatus('closed')} disabled={leadBusy} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        Mark Closed
                      </button>
                      <button type="button" onClick={() => updateLeadStatus('archived')} disabled={leadBusy} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        Archive Lead
                      </button>
                      {!selectedLead.converted_homeowner_id ? (
                        <button type="button" onClick={convertLeadToCustomer} disabled={leadBusy} className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60">
                          Convert to Customer
                        </button>
                      ) : null}
                      {selectedLead.converted_agreement ? (
                        <button type="button" onClick={() => navigate(`/app/agreements/${selectedLead.converted_agreement}`)} className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
                          Open Draft Agreement
                        </button>
                      ) : null}
                      <button type="button" onClick={() => saveLead(selectedLead)} disabled={leadBusy} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                        {leadBusy ? 'Saving...' : 'Save Lead'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">No public leads yet.</div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Share</div>
          <div className="mt-3 text-lg font-semibold text-slate-900">Public profile QR</div>
          <div className="mt-2 text-sm text-slate-600 break-all">{qrData?.public_url || profile.public_url || '-'}</div>
          {qrData?.qr_svg ? (
            <img
              data-testid="public-presence-qr-image"
              src={qrData.qr_svg}
              alt="Public profile QR code"
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white p-4"
            />
          ) : null}
          {qrData?.qr_svg ? (
            <a
              href={qrData.qr_svg}
              download={qrData.download_filename || 'public-profile-qr.svg'}
              className="mt-4 inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Download QR
            </a>
          ) : null}
        </aside>
      </section>
    </div>
  );
}
