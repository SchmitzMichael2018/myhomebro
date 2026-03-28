import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import api from '../api';
import QuickAddLeadModal from '../components/QuickAddLeadModal.jsx';
import { StartWithAIEntry } from '../components/StartWithAIAssistant.jsx';
import { WorkflowHint } from '../components/WorkflowHint.jsx';
import {
  buildAssistantHandoffSignature,
  getAssistantHandoff,
} from '../lib/assistantHandoff.js';
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
  if (normalized === 'pending_customer_response') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (normalized === 'ready_for_review') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (normalized === 'accepted') return 'border-indigo-200 bg-indigo-50 text-indigo-700';
  if (normalized === 'rejected') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (normalized === 'contacted' || normalized === 'qualified') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (normalized === 'closed') return 'border-violet-200 bg-violet-50 text-violet-700';
  if (normalized === 'archived') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

function sourceLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'landing_page') return 'Landing Page';
  if (normalized === 'public_profile' || normalized === 'profile') return 'Public Profile';
  if (normalized === 'manual') return 'Manual';
  if (normalized === 'qr') return 'QR';
  if (normalized === 'contractor_sent_form') return 'Contractor Form';
  if (normalized === 'direct') return 'Direct';
  return value || 'Unknown';
}

function statusLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'new') return 'New Inbound';
  if (normalized === 'pending_customer_response') return 'Waiting on Customer';
  if (normalized === 'ready_for_review') return 'Ready for Review';
  if (normalized === 'accepted') return 'Accepted';
  if (normalized === 'rejected') return 'Rejected';
  if (normalized === 'contacted') return 'Contacted';
  if (normalized === 'qualified') return 'Qualified';
  if (normalized === 'closed') return 'Closed';
  if (normalized === 'archived') return 'Archived';
  return value || 'Unknown';
}

function leadCanSkipColdAcceptance(lead) {
  return ['contractor_sent_form', 'manual'].includes(String(lead?.source || '').toLowerCase());
}

function leadHasScopeDetails(lead) {
  return Boolean(
    [
      lead?.project_type,
      lead?.project_description,
      lead?.preferred_timeline,
      lead?.budget_text,
    ]
      .map((value) => String(value || '').trim())
      .find(Boolean)
  );
}

function leadCanRunAiActions(lead) {
  if (!lead) return false;
  const status = String(lead.status || '').toLowerCase();
  if (status === 'accepted') return true;
  return (
    leadCanSkipColdAcceptance(lead) &&
    ['ready_for_review', 'contacted', 'qualified'].includes(status)
  );
}

function leadCanSendIntake(lead) {
  return (
    String(lead?.source || '').toLowerCase() === 'manual' &&
    Boolean(String(lead?.email || '').trim()) &&
    !lead?.converted_agreement
  );
}

function leadCanAnalyzeFromUi(lead) {
  if (!leadCanRunAiActions(lead)) return false;
  if (String(lead?.source || '').toLowerCase() === 'manual') {
    return leadHasScopeDetails(lead);
  }
  return true;
}

function getLeadPrimaryAction(lead) {
  if (!lead) return null;
  if (lead.converted_agreement) {
    return { kind: 'open_agreement', label: 'Open Draft Agreement' };
  }
  if (String(lead.source || '').toLowerCase() === 'manual') {
    if (String(lead.status || '').toLowerCase() === 'pending_customer_response' && lead.source_intake_id) {
      return { kind: 'review_intake', label: 'Review Intake' };
    }
    if (leadCanSendIntake(lead) && !lead.source_intake_id && !leadHasScopeDetails(lead)) {
      return { kind: 'send_intake', label: 'Send Intake Form' };
    }
  }
  if (leadCanSkipColdAcceptance(lead) && lead.source_intake_id) {
    return { kind: 'review_intake', label: 'Review Intake' };
  }
  if (!leadCanSkipColdAcceptance(lead) && String(lead.status || '').toLowerCase() === 'new') {
    return { kind: 'accept', label: 'Accept Lead' };
  }
  if (leadCanRunAiActions(lead)) {
    return { kind: 'create_agreement', label: 'Create AI-Assisted Agreement' };
  }
  return null;
}

function getAnalysisConfidenceLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'recommended') return 'Recommended';
  if (normalized === 'possible') return 'Possible';
  if (normalized === 'none') return 'No strong match';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function leadHasAnalysis(lead) {
  return Boolean(lead?.ai_analysis && Object.keys(lead.ai_analysis).length);
}

function getLeadFunnelCurrentStep(lead) {
  if (!lead) return 0;
  if (lead.converted_agreement) return 2;
  if (leadHasAnalysis(lead)) return 2;
  const status = String(lead.status || '').toLowerCase();
  if (leadCanSkipColdAcceptance(lead) && ['ready_for_review', 'contacted', 'qualified'].includes(status)) {
    return 1;
  }
  if (!leadCanSkipColdAcceptance(lead) && ['accepted', 'contacted', 'qualified'].includes(status)) {
    return 1;
  }
  return 0;
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
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [profile, setProfile] = useState(defaultProfile);
  const [profileBusy, setProfileBusy] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPrefill, setQuickAddPrefill] = useState(null);
  const [assistantLeadBanner, setAssistantLeadBanner] = useState('');
  const assistantHandoff = useMemo(() => getAssistantHandoff(location.state), [location.state]);
  const assistantHandoffSignature = useMemo(
    () => buildAssistantHandoffSignature(assistantHandoff),
    [assistantHandoff]
  );
  const appliedAssistantRef = useRef('');
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
  const primaryLeadAction = useMemo(() => getLeadPrimaryAction(selectedLead), [selectedLead]);
  const leadFunnelCurrentStep = useMemo(() => getLeadFunnelCurrentStep(selectedLead), [selectedLead]);
  const leadAssistantContext = useMemo(
    () => ({
      current_route: '/app/public-presence',
      lead_id: selectedLead?.id || null,
      lead_summary: {
        source: selectedLead?.source || '',
        full_name: selectedLead?.full_name || '',
        email: selectedLead?.email || '',
        phone: selectedLead?.phone || '',
        project_type: selectedLead?.project_type || '',
        project_description: selectedLead?.project_description || '',
        project_address: selectedLead?.project_address || '',
        city: selectedLead?.city || '',
        state: selectedLead?.state || '',
        zip_code: selectedLead?.zip_code || '',
        status: selectedLead?.status || '',
        source_intake_id: selectedLead?.source_intake_id || null,
        converted_agreement: selectedLead?.converted_agreement || null,
        ai_analysis: selectedLead?.ai_analysis || null,
        internal_notes: selectedLead?.internal_notes || '',
      },
    }),
    [selectedLead]
  );

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
      toast.error('Could not load public profile settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!assistantHandoffSignature || assistantHandoffSignature === appliedAssistantRef.current) {
      return;
    }

    if (assistantHandoff.context?.lead_id && Array.isArray(leadsRows) && leadsRows.length) {
      const matchedLead = leadsRows.find(
        (row) => String(row.id) === String(assistantHandoff.context.lead_id)
      );
      if (matchedLead) {
        setActiveTab('leads');
        setSelectedLead(matchedLead);
      }
    }

    const prefillName =
      assistantHandoff.prefillFields.full_name ||
      assistantHandoff.prefillFields.customer_name ||
      assistantHandoff.draftPayload.homeowner_name ||
      '';
    const prefillPhone =
      assistantHandoff.prefillFields.phone || assistantHandoff.draftPayload.phone || '';
    const prefillEmail =
      assistantHandoff.prefillFields.email || assistantHandoff.draftPayload.email || '';

    if (assistantHandoff.intent === 'create_lead' && (prefillName || prefillPhone || prefillEmail)) {
      setActiveTab('leads');
      setQuickAddPrefill({
        full_name: prefillName,
        phone: prefillPhone,
        email: prefillEmail,
        project_address:
          assistantHandoff.prefillFields.address_line1 ||
          assistantHandoff.draftPayload.address_line1 ||
          '',
        notes:
          assistantHandoff.prefillFields.project_summary ||
          assistantHandoff.draftPayload.description ||
          '',
      });
      setQuickAddOpen(true);
      setAssistantLeadBanner('AI prefilled a new lead capture based on your request.');
    } else {
      setAssistantLeadBanner('');
    }

    appliedAssistantRef.current = assistantHandoffSignature;
  }, [assistantHandoff, assistantHandoffSignature, leadsRows]);

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

  async function sendLeadIntake() {
    if (!selectedLead) return;
    try {
      setLeadBusy(true);
      const { data } = await api.post(
        `/projects/contractor/public-leads/${selectedLead.id}/send-intake/`
      );
      const updated = {
        ...selectedLead,
        status: data?.lead_status || 'pending_customer_response',
        source_intake_id: data?.intake_id || selectedLead.source_intake_id,
      };
      setLeadsRows((prev) =>
        prev.map((row) => (row.id === selectedLead.id ? updated : row))
      );
      setSelectedLead(updated);
      toast.success(data?.email ? `Intake sent to ${data.email}.` : 'Intake form sent.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.email?.[0] || err?.response?.data?.detail || 'Failed to send intake form.');
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

  async function runPrimaryLeadAction() {
    if (!selectedLead || !primaryLeadAction) return;
    if (primaryLeadAction.kind === 'accept') {
      await acceptLead();
      return;
    }
    if (primaryLeadAction.kind === 'send_intake') {
      await sendLeadIntake();
      return;
    }
    if (primaryLeadAction.kind === 'review_intake') {
      navigate(`/app/intake/new?intakeId=${selectedLead.source_intake_id}`);
      return;
    }
    if (selectedLead.converted_agreement) {
      navigate(`/app/agreements/${selectedLead.converted_agreement}`);
      return;
    }
    await createAgreementFromLead();
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

  function handleLeadAssistantAction(plan) {
    if (!selectedLead) return false;
    const actionKey = plan?.next_action?.action_key;
    if (actionKey === 'send_intake_form') {
      void sendLeadIntake();
      return true;
    }
    if (actionKey === 'review_lead_intake') {
      navigate(`/app/intake/new?intakeId=${selectedLead.source_intake_id}`);
      return true;
    }
    if (actionKey === 'analyze_lead') {
      void analyzeLeadWithAi();
      return true;
    }
    if (actionKey === 'create_agreement_from_lead') {
      void createAgreementFromLead();
      return true;
    }
    if (actionKey === 'open_existing_agreement' && selectedLead.converted_agreement) {
      navigate(`/app/agreements/${selectedLead.converted_agreement}`);
      return true;
    }
    if (actionKey === 'create_customer_record') {
      void convertLeadToCustomer();
      return true;
    }
    return false;
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(qrData?.public_url || profile.public_url || '');
      toast.success('Public profile link copied.');
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
      <QuickAddLeadModal
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        initialForm={quickAddPrefill}
        onCreated={(lead) => {
          setLeadsRows((prev) => [lead, ...prev.filter((row) => row.id !== lead.id)]);
          setSelectedLead(lead);
          setActiveTab('leads');
          setQuickAddPrefill(null);
        }}
        onClose={() => setQuickAddPrefill(null)}
      />
      <header className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 data-testid="public-presence-title" className="text-2xl font-bold text-slate-900">
              Public Presence
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Manage your public profile, gallery, reviews, leads, and shareable QR from one place.
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
                New public reviews stay hidden until you publish them here. Verified badges remain read-only unless an agreement-linked workflow sets them.
              </div>

              {reviewsRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                  No reviews have been submitted yet. Share your profile link to start collecting customer feedback.
                </div>
              ) : (
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
              )}
            </div>
          ) : null}

          {activeTab === 'leads' ? (
            <div className="mt-6 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="public-presence-leads-tab">
              <div className="space-y-3">
                {leadsRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                    No leads yet. Use Quick Add Lead, share your public profile, or post your QR code to start collecting project requests.
                  </div>
                ) : leadsRows.map((lead) => (
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
                    <div className="mt-2 inline-flex rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold opacity-90">
                      {sourceLabel(lead.source)}
                    </div>
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {selectedLead ? (
                  <>
                    <StartWithAIEntry
                      className="mb-4"
                      testId="public-lead-ai-entry"
                      title="Start with AI for this lead"
                      description="Use the current lead context to decide whether to review, analyze, send intake, or draft the agreement."
                      context={leadAssistantContext}
                      onAction={handleLeadAssistantAction}
                    />
                    <WorkflowHint
                      hint={selectedLeadHint}
                      testId="public-lead-workflow-hint"
                      className="mb-4"
                    />
                    {assistantLeadBanner ? (
                      <div
                        data-testid="public-lead-assistant-banner"
                        className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900"
                      >
                        {assistantLeadBanner}
                      </div>
                    ) : null}
                    <div
                      data-testid="public-lead-funnel"
                      className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Lead Funnel
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {[
                          ['Review', 'Confirm fit and intake details'],
                          ['Analyze', 'Use AI and template guidance'],
                          ['Draft', 'Open the agreement and continue pricing'],
                        ].map(([label, detail], index) => {
                          const isComplete = leadFunnelCurrentStep > index;
                          const isCurrent = leadFunnelCurrentStep === index;
                          return (
                            <div
                              key={label}
                              data-testid={`public-lead-funnel-step-${label.toLowerCase()}`}
                              className={`rounded-xl border px-3 py-2 text-sm ${
                                isCurrent
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : isComplete
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-200 bg-slate-50 text-slate-600'
                              }`}
                            >
                              <div className="text-xs font-semibold uppercase tracking-wide">
                                Step {index + 1}
                              </div>
                              <div className="mt-1 font-semibold">{label}</div>
                              <div className={`mt-1 text-xs ${isCurrent ? 'text-slate-200' : ''}`}>
                                {detail}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-slate-900">{selectedLead.full_name}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {selectedLead.email || 'No email'} · {selectedLead.phone || 'No phone'}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChipClass(selectedLead.status)}`}>
                        {statusLabel(selectedLead.status)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-slate-700">
                      <div><span className="font-semibold text-slate-900">Source:</span> {sourceLabel(selectedLead.source)}</div>
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
                          {selectedLead.ai_analysis.confidence ? (
                            <span className="rounded-full border border-indigo-200 bg-white px-2 py-1 text-slate-700">
                              {getAnalysisConfidenceLabel(selectedLead.ai_analysis.confidence)}
                            </span>
                          ) : null}
                        </div>
                        {selectedLead.ai_analysis.suggested_description ? (
                          <div className="mt-3 text-sm text-slate-700">
                            {selectedLead.ai_analysis.suggested_description}
                          </div>
                        ) : null}
                        {selectedLead.ai_analysis.reason ? (
                          <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            Why this template path: {selectedLead.ai_analysis.reason}
                          </div>
                        ) : null}
                        {Array.isArray(selectedLead.ai_analysis.recommended_templates) &&
                        selectedLead.ai_analysis.recommended_templates.length ? (
                          <div className="mt-3">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Template Options
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs">
                              {selectedLead.ai_analysis.recommended_templates.slice(0, 3).map((template, index) => (
                                <span
                                  key={`${template.id || template.name || 'template'}-${index}`}
                                  className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700"
                                >
                                  {template.name || `Template ${index + 1}`}
                                  {template.confidence ? ` · ${getAnalysisConfidenceLabel(template.confidence)}` : ''}
                                </span>
                              ))}
                            </div>
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
                      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Workflow
                        </div>
                        <div className="mt-1">
                          Lead states are guided by the action buttons below so the pipeline stays consistent from review through agreement drafting.
                        </div>
                      </div>
                      <textarea value={selectedLead.internal_notes || ''} onChange={(e) => setSelectedLead((prev) => ({ ...prev, internal_notes: e.target.value }))} rows={4} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Internal notes" />
                    </div>
                    {selectedLead.converted_homeowner_name ? (
                      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        Converted to customer: {selectedLead.converted_homeowner_name}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      {primaryLeadAction ? (
                        <button
                          type="button"
                          onClick={runPrimaryLeadAction}
                          disabled={leadBusy}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {primaryLeadAction.label}
                        </button>
                      ) : null}
                      {!leadCanSkipColdAcceptance(selectedLead) && selectedLead.status === 'new' ? (
                        <button type="button" onClick={rejectLead} disabled={leadBusy || Boolean(selectedLead.converted_agreement)} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                          Reject Lead
                        </button>
                      ) : null}
                      <button type="button" onClick={analyzeLeadWithAi} disabled={leadBusy || !leadCanAnalyzeFromUi(selectedLead)} className="rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
                        Analyze Intake with AI
                      </button>
                      {leadCanSendIntake(selectedLead) &&
                      primaryLeadAction?.kind !== 'send_intake' ? (
                        <button
                          type="button"
                          onClick={sendLeadIntake}
                          disabled={leadBusy}
                          className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                        >
                          Send Intake Form
                        </button>
                      ) : null}
                      {!selectedLead.converted_agreement &&
                      leadCanRunAiActions(selectedLead) &&
                      primaryLeadAction?.kind !== 'create_agreement' ? (
                        <button type="button" onClick={createAgreementFromLead} disabled={leadBusy} className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">
                          Create AI-Assisted Agreement
                        </button>
                      ) : null}
                      <button type="button" onClick={() => updateLeadStatus('contacted')} disabled={leadBusy || selectedLead.status === 'contacted'} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        Mark Contacted
                      </button>
                      <button type="button" onClick={() => updateLeadStatus('closed')} disabled={leadBusy || selectedLead.status === 'closed'} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        Mark Closed
                      </button>
                      <button type="button" onClick={() => updateLeadStatus('archived')} disabled={leadBusy || selectedLead.status === 'archived'} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        Archive Lead
                      </button>
                      {!selectedLead.converted_homeowner_id && leadCanRunAiActions(selectedLead) ? (
                        <button type="button" onClick={convertLeadToCustomer} disabled={leadBusy} className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60">
                          Create Customer Record
                        </button>
                      ) : null}
                      {selectedLead.converted_agreement ? (
                        <button type="button" onClick={() => navigate(`/app/agreements/${selectedLead.converted_agreement}`)} className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
                          Open Draft Agreement
                        </button>
                      ) : null}
                      <button type="button" onClick={() => saveLead(selectedLead)} disabled={leadBusy} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                        {leadBusy ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">Choose a lead to review its details, status, and next actions.</div>
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
