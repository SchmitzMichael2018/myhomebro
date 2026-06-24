import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import api from '../api';
import Modal from '../components/Modal.jsx';
import ContractorPageSurface from '../components/dashboard/ContractorPageSurface.jsx';
import QuickAddLeadModal from '../components/QuickAddLeadModal.jsx';
import { StartWithAIEntry } from '../components/StartWithAIAssistant.jsx';
import { WorkflowHint } from '../components/WorkflowHint.jsx';
import {
  buildAssistantHandoffSignature,
  getAssistantHandoff,
} from '../lib/assistantHandoff.js';
import {
  buildProjectSetupRecommendation,
  normalizeProjectSetupRecommendation,
} from '../lib/projectIntelligence.js';
import { FONT_THEME_OPTIONS, THEME_OPTIONS, getPublicProfileBranding } from '../lib/publicProfileBranding.js';
import { getPublicLeadHint, getPublicPresenceHint } from '../lib/workflowHints.js';
import { generateContractorPublicProfile } from '../api.js';
import { ProjectModeBadge } from '../components/projectMode.jsx';
import { contractorMatchTierClass, contractorMatchTierLabel } from '../lib/contractorMatching.js';
import ContractorContextualGuideModal, { pickContextualGuide } from '../components/ContractorContextualGuideModal.jsx';
import WebsiteBuilderWizard from '../components/website/WebsiteBuilderWizard.jsx';

const TABS = [
  { key: 'profile', label: 'Public Profile' },
  { key: 'website', label: 'Website Builder' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'leads', label: 'Website Leads' },
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
  if (normalized === 'pending') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (normalized === 'converted') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (normalized === 'declined') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (normalized === 'expired') return 'border-slate-200 bg-slate-100 text-slate-600';
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
  if (normalized === 'contractor_opportunity') return 'Homeowner Intake';
  if (normalized === 'landing_page') return 'Landing Page';
  if (normalized === 'public_profile' || normalized === 'profile') return 'Public Profile';
  if (normalized === 'quote_request') return 'Request a Quote';
  if (normalized === 'manual') return 'Manual';
  if (normalized === 'qr') return 'QR';
  if (normalized === 'contractor_sent_form') return 'Contractor Form';
  if (normalized === 'direct') return 'Direct';
  return value || 'Unknown';
}

function statusLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'pending') return 'New';
  if (normalized === 'accepted') return 'Accepted';
  if (normalized === 'converted') return 'Draft Ready';
  if (normalized === 'declined') return 'Declined';
  if (normalized === 'expired') return 'Expired';
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
  return ['contractor_sent_form', 'manual', 'quote_request'].includes(String(lead?.source || '').toLowerCase());
}

function isOpportunityLead(lead) {
  return String(lead?.source || '').toLowerCase() === 'contractor_opportunity' || Boolean(lead?.opportunity_id);
}

function opportunityBudgetText(lead) {
  if (lead?.budget_text) return lead.budget_text;
  const min = lead?.budget_min;
  const max = lead?.budget_max;
  if (min && max) return `$${Number(min).toLocaleString()}-$${Number(max).toLocaleString()}`;
  if (min) return `$${Number(min).toLocaleString()}+`;
  if (max) return `Up to $${Number(max).toLocaleString()}`;
  return '';
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
  if (isOpportunityLead(lead)) {
    const status = String(lead.status || '').toLowerCase();
    if (lead.converted_agreement || lead.agreement_id || lead.next_url) {
      return { kind: 'open_agreement', label: 'Open Draft Agreement' };
    }
    if (status === 'pending') return { kind: 'accept', label: 'Accept Opportunity' };
    if (status === 'accepted') return { kind: 'continue_review', label: 'Continue Review' };
    return null;
  }
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

function PublicPresenceBrandPreview({ profile, galleryRows, reviewsRows }) {
  const branding = getPublicProfileBranding(profile);
  const showReviews = Boolean(profile.show_reviews !== false && profile.allow_public_reviews !== false);
  const showGallery = Boolean(profile.show_gallery !== false);
  const showQuoteCta = Boolean(profile.show_quote_cta !== false && profile.allow_public_intake !== false);
  const heroImageUrl = profile.hero_image_url || profile.cover_image_url || '';
  const featuredGallery = Array.isArray(galleryRows) ? galleryRows.filter((item) => item.is_public !== false) : [];
  const featuredReviews = Array.isArray(reviewsRows) ? reviewsRows.filter((item) => item.is_public !== false) : [];

  return (
    <aside
      data-testid="public-presence-live-preview"
      className="rounded-3xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
          Live Preview
        </div>
        <div className="mt-1 text-sm text-slate-600">
          This preview updates as you change brand colors, theme, and visibility settings.
        </div>
      </div>
      <div className="p-4">
        <div
          className="relative overflow-hidden rounded-[2rem] border border-slate-200 text-white shadow-sm"
          style={{ background: branding.heroBackground, color: branding.textColor, fontFamily: branding.fontFamily }}
        >
          {heroImageUrl ? (
            <img
              src={heroImageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-25"
            />
          ) : null}
          <div className="absolute inset-0 bg-black/15" />
          <div className="relative space-y-4 p-5">
            <div className="flex items-start gap-3">
              {profile.logo_url ? (
                <img
                  src={profile.logo_url}
                  alt="Logo preview"
                  className="h-14 w-14 shrink-0 rounded-2xl border border-white/20 bg-white object-cover shadow-md"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-lg font-bold">
                  {(profile.business_name_public || 'C').slice(0, 1)}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/75">
                  {branding.theme} theme
                </div>
                <div className="mt-1 text-xl font-black tracking-tight">
                  {profile.business_name_public || 'Contractor Profile'}
                </div>
                {profile.tagline ? <p className="mt-2 text-sm text-white/85">{profile.tagline}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]">
              <span className="rounded-full px-3 py-1" style={{ backgroundColor: branding.heroChipBackground, color: branding.heroChipText }}>
                {profile.profile_theme || 'modern'}
              </span>
              <span className="rounded-full bg-white/15 px-3 py-1">
                {profile.brand_font_theme || 'clean_sans'}
              </span>
              <span className="rounded-full bg-white/15 px-3 py-1">
                Primary {profile.brand_primary_color || branding.primary}
              </span>
              <span className="rounded-full bg-white/15 px-3 py-1">
                Accent {profile.brand_accent_color || branding.accent}
              </span>
            </div>
            {showQuoteCta ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl px-4 py-2 text-sm font-semibold shadow-sm"
                  style={{ backgroundColor: branding.ctaBackground, color: branding.ctaText }}
                >
                  Request a Quote
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/30 bg-white/10 px-4 py-3 text-sm text-white/85">
                Request a Quote is hidden by your visibility settings.
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Brand summary</div>
            <div className="mt-2 grid gap-2 text-sm text-slate-700">
              <div data-testid="public-presence-preview-theme"><span className="font-semibold text-slate-900">Theme:</span> {profile.profile_theme || 'modern'}</div>
              <div data-testid="public-presence-preview-font"><span className="font-semibold text-slate-900">Font:</span> {profile.brand_font_theme || 'clean_sans'}</div>
              <div data-testid="public-presence-preview-primary"><span className="font-semibold text-slate-900">Primary:</span> {profile.brand_primary_color || branding.primary}</div>
              <div data-testid="public-presence-preview-accent"><span className="font-semibold text-slate-900">Accent:</span> {profile.brand_accent_color || branding.accent}</div>
            </div>
            <div className="mt-4 rounded-2xl border border-sky-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ways I Work</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {profile.accepts_diy_assistance ? (
                  <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                    DIY Assistance Available
                  </span>
                ) : null}
                {profile.accepts_consultation_only ? (
                  <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                    Consultation Available
                  </span>
                ) : null}
                {profile.accepts_inspection_only ? (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    Inspection Services Available
                  </span>
                ) : null}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                Guided project assistance, consultation, and inspection-friendly support are highlighted when enabled.
              </div>
            </div>
          </div>

          {showGallery ? (
            <div data-testid="public-presence-preview-gallery" className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Gallery preview</div>
              <div className="mt-1 text-xs text-slate-500">
                {featuredGallery.length ? `${featuredGallery.length} public gallery item${featuredGallery.length === 1 ? '' : 's'} visible` : 'No public gallery items to preview yet.'}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              Gallery is hidden in the public profile.
            </div>
          )}

          {showReviews ? (
            <div data-testid="public-presence-preview-reviews" className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-900">Reviews preview</div>
              <div className="mt-1 text-xs text-slate-500">
                {featuredReviews.length ? `${featuredReviews.length} public review${featuredReviews.length === 1 ? '' : 's'} visible` : 'No reviews to preview yet.'}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
              Reviews are hidden in the public profile.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
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
  proposal_tone: '',
  preferred_signoff: '',
  brand_primary_color: '',
  brand_accent_color: '',
  brand_font_theme: 'clean_sans',
  profile_theme: 'modern',
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
  show_reviews: true,
  show_gallery: true,
  show_quote_cta: true,
  allow_public_intake: true,
  allow_public_reviews: true,
  is_public: false,
  seo_title: '',
  seo_description: '',
  public_url: '',
  logo_url: '',
  cover_image_url: '',
  hero_image_url: '',
};

const PROPOSAL_TONE_OPTIONS = [
  ['', 'Choose a tone'],
  ['professional', 'Professional'],
  ['friendly', 'Friendly'],
  ['straightforward', 'Straightforward'],
  ['premium', 'Premium'],
  ['warm_and_consultative', 'Warm and Consultative'],
];

const defaultWebsiteReadiness = {
  loading: false,
  error: '',
  entitlements: { plan: 'free', features: {} },
  profile: null,
  readiness: { score: 0, complete_count: 0, total_count: 0, checklist: [], missing_required_fields: [] },
  draft: { status: 'placeholder', has_draft: false },
  recommended_next_steps: [],
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
  const [heroFile, setHeroFile] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPrefill, setQuickAddPrefill] = useState(null);
  const [generateProfileOpen, setGenerateProfileOpen] = useState(false);
  const [generateProfilePrompt, setGenerateProfilePrompt] = useState('');
  const [generatingProfile, setGeneratingProfile] = useState(false);
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
  const [websiteReadiness, setWebsiteReadiness] = useState(defaultWebsiteReadiness);
  const [websiteBuilderTab, setWebsiteBuilderTab] = useState('setup');
  const [selectedWebsitePageId, setSelectedWebsitePageId] = useState(null);
  const [websitePreviewMode, setWebsitePreviewMode] = useState('desktop');
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [websitePublishMessage, setWebsitePublishMessage] = useState('');
  const [activationSummary, setActivationSummary] = useState(null);
  const [dismissedContextualGuides, setDismissedContextualGuides] = useState(new Set());
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

  const websiteFeatures = websiteReadiness?.entitlements?.features || {};
  const websiteBuilderGate = websiteFeatures.website_builder || {};
  const websitePublishGate = websiteFeatures.website_publish || {};
  const websiteProfile = websiteReadiness?.profile || {};
  const websiteReadinessData = websiteReadiness?.readiness || {};
  const websiteChecklist = Array.isArray(websiteReadinessData.checklist) ? websiteReadinessData.checklist : [];
  const missingRequiredFields = Array.isArray(websiteReadinessData.missing_required_fields)
    ? websiteReadinessData.missing_required_fields
    : [];
  const websiteData = websiteReadiness?.website || {};
  const websitePages = Array.isArray(websiteReadiness?.pages) ? websiteReadiness.pages : [];
  const websiteLayout = websiteData.homepage_layout || {};
  const websiteSectionOrder = Array.isArray(websiteLayout.section_order)
    ? websiteLayout.section_order
    : ['hero', 'services', 'portfolio', 'reviews', 'trust', 'contact'];
  const websiteSections = websiteLayout.sections || {};
  const websitePublishBlockers = Array.isArray(websiteReadiness?.publish_blockers)
    ? websiteReadiness.publish_blockers
    : [];
  const selectedWebsitePage = websitePages.find((page) => page.id === selectedWebsitePageId) || websitePages[0] || null;
  const canCustomizeWebsite = Boolean(websiteBuilderGate.enabled);
  const canPublishWebsite = Boolean(websitePublishGate.enabled) && websitePublishBlockers.length === 0;
  const websitePreviewPayload = useMemo(
    () => ({
      profile: websiteProfile,
      pages: websitePages,
      website: websiteData,
      homepage_layout: websiteLayout,
      template_key: websiteData.template_key || websiteReadiness?.draft?.template_key || 'starter',
    }),
    [websiteData, websiteLayout, websitePages, websiteProfile, websiteReadiness?.draft?.template_key]
  );

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
  const selectedLeadMatching = useMemo(
    () => selectedLead?.matching || selectedLead?.ai_analysis?.contractor_match || null,
    [selectedLead]
  );
  const leadAssistantContext = useMemo(
    () => ({
      current_route: '/app/marketing',
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
  const activationLeadBanner = useMemo(() => {
    const sections = activationSummary?.guide_sections || {};
    if (activationSummary?.has_converted_opportunity && sections.draft_agreement?.visible && !sections.draft_agreement?.dismissed) {
      return 'This draft workspace was prepared to help you respond faster.';
    }
    if (activationSummary?.has_pending_opportunities && sections.public_leads?.visible && !sections.public_leads?.dismissed) {
      return 'This homeowner request came through MyHomeBro public discovery.';
    }
    return '';
  }, [activationSummary]);
  const publicLeadsGuide = useMemo(() => {
    if (activeTab !== 'leads') return null;
    const picked = pickContextualGuide(activationSummary, ['public_leads']);
    if (!picked || dismissedContextualGuides.has(picked.sectionKey)) return null;
    return picked;
  }, [activationSummary, activeTab, dismissedContextualGuides]);
  const selectedLeadRecommendedSetup = useMemo(() => {
    const baseRecommendation = buildProjectSetupRecommendation({
      projectTitle:
        selectedLead?.ai_analysis?.project_title ||
        selectedLead?.project_type ||
        selectedLead?.full_name ||
        '',
      projectType: selectedLead?.ai_analysis?.project_type || selectedLead?.project_type || '',
      projectSubtype: selectedLead?.ai_analysis?.project_subtype || '',
      description:
        selectedLead?.ai_analysis?.project_scope_summary ||
        selectedLead?.ai_analysis?.refined_description ||
        selectedLead?.project_description ||
        '',
      templateId:
        selectedLead?.ai_analysis?.recommended_template_id ||
        selectedLead?.ai_analysis?.template_id ||
        null,
      templateName: selectedLead?.ai_analysis?.template_name || '',
    });
    const backendRecommendation = normalizeProjectSetupRecommendation(
      selectedLead?.ai_analysis?.recommended_setup || {}
    );
    return {
      ...baseRecommendation,
      ...backendRecommendation,
      strongTemplateMatch:
        backendRecommendation.strongTemplateMatch || baseRecommendation.strongTemplateMatch,
    };
  }, [selectedLead]);

  async function loadAll() {
    try {
      setLoading(true);
      const [profileRes, qrRes, galleryRes, reviewsRes, leadsRes, activationRes, websiteRes] = await Promise.all([
        api.get('/projects/contractor/public-profile/'),
        api.get('/projects/contractor/public-profile/qr/'),
        api.get('/projects/contractor/gallery/'),
        api.get('/projects/contractor/reviews/'),
        api.get('/projects/contractor-opportunities/'),
        api.get('/projects/contractor-activation-summary/'),
        api.get('/projects/contractor/website/'),
      ]);
      setProfile({ ...defaultProfile, ...(profileRes.data || {}) });
      setQrData(qrRes.data || null);
      setGalleryRows(normalizeList(galleryRes.data));
      setReviewsRows(normalizeList(reviewsRes.data));
      const leadResults = normalizeList(leadsRes.data);
      setLeadsRows(leadResults);
      setSelectedLead(leadResults[0] || null);
      setActivationSummary(activationRes.data || null);
      setWebsiteReadiness({ ...defaultWebsiteReadiness, ...(websiteRes.data || {}), loading: false, error: '' });
    } catch (err) {
      console.error(err);
      setWebsiteReadiness((prev) => ({ ...prev, loading: false, error: 'Website readiness could not be loaded.' }));
      toast.error('Could not load public profile settings.');
    } finally {
      setLoading(false);
    }
  }

  async function dismissActivationSection(section) {
    setDismissedContextualGuides((current) => new Set([...current, section]));
    try {
      const { data } = await api.post('/projects/contractor-activation-summary/dismiss/', { section });
      setActivationSummary(data || null);
    } catch (err) {
      console.error(err);
      toast.error('Could not dismiss activation guidance.');
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!selectedWebsitePageId && websitePages.length) {
      setSelectedWebsitePageId(websitePages[0].id);
    }
  }, [selectedWebsitePageId, websitePages]);

  async function refreshWebsiteBuilder() {
    const { data } = await api.get('/projects/contractor/website/');
    setWebsiteReadiness({ ...defaultWebsiteReadiness, ...(data || {}), loading: false, error: '' });
    return data || {};
  }

  async function saveWebsiteSettings(patch) {
    if (!canCustomizeWebsite) {
      toast.error(websiteBuilderGate.reason || 'Website Builder requires Pro.');
      return;
    }
    try {
      setWebsiteBusy(true);
      const { data } = await api.patch('/projects/contractor/website/', patch);
      setWebsiteReadiness({ ...defaultWebsiteReadiness, ...(data || {}), loading: false, error: '' });
      toast.success('Website draft saved.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Could not save website settings.');
    } finally {
      setWebsiteBusy(false);
    }
  }

  function updateWebsiteLayout(layoutPatch) {
    saveWebsiteSettings({
      homepage_layout: {
        ...websiteLayout,
        ...layoutPatch,
        branding: { ...(websiteLayout.branding || {}), ...(layoutPatch.branding || {}) },
        sections: { ...(websiteLayout.sections || {}), ...(layoutPatch.sections || {}) },
      },
    });
  }

  async function saveWebsitePage(page, patch = page) {
    if (!page?.id) return;
    if (!canCustomizeWebsite) {
      toast.error(websiteBuilderGate.reason || 'Website Builder requires Pro.');
      return;
    }
    try {
      setWebsiteBusy(true);
      await api.patch(`/projects/contractor/website/pages/${page.id}/`, patch);
      await refreshWebsiteBuilder();
      toast.success('Website page saved.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Could not save website page.');
    } finally {
      setWebsiteBusy(false);
    }
  }

  async function publishWebsite() {
    if (!canPublishWebsite) {
      setWebsitePublishMessage(websitePublishBlockers[0] || websitePublishGate.reason || 'Website is not ready to publish.');
      return;
    }
    try {
      setWebsiteBusy(true);
      await api.post('/projects/contractor/website/publish/');
      setWebsitePublishMessage('Website published. The public route now serves the saved snapshot.');
      await refreshWebsiteBuilder();
      toast.success('Website published.');
    } catch (err) {
      console.error(err);
      const blockers = err?.response?.data?.blockers;
      const message = Array.isArray(blockers) && blockers.length ? blockers[0] : err?.response?.data?.detail || 'Could not publish website.';
      setWebsitePublishMessage(message);
      toast.error(message);
    } finally {
      setWebsiteBusy(false);
    }
  }

  async function pauseWebsite() {
    try {
      setWebsiteBusy(true);
      await api.post('/projects/contractor/website/pause/');
      await refreshWebsiteBuilder();
      setWebsitePublishMessage('Website paused. Public visitors will not see the site while it is paused.');
      toast.success('Website paused.');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Could not pause website.');
    } finally {
      setWebsiteBusy(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    const tab = params.get('tab');
    if (TABS.some((item) => item.key === tab)) {
      setActiveTab(tab);
    }
  }, [location.search]);

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
        'proposal_tone',
        'preferred_signoff',
        'brand_primary_color',
        'brand_accent_color',
        'brand_font_theme',
        'profile_theme',
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
        'show_reviews',
        'show_gallery',
        'show_quote_cta',
        'allow_public_intake',
        'allow_public_reviews',
        'is_public',
      ].forEach((field) => payload.append(field, profile[field] ? 'true' : 'false'));
      if (logoFile) payload.append('logo', logoFile);
      if (coverFile) payload.append('cover_image', coverFile);
      if (heroFile) payload.append('hero_image', heroFile);

      const { data } = await api.patch('/projects/contractor/public-profile/', payload);
      setProfile({ ...defaultProfile, ...(data || {}) });
      setLogoFile(null);
      setCoverFile(null);
      setHeroFile(null);
      const qrRes = await api.get('/projects/contractor/public-profile/qr/');
      setQrData(qrRes.data || null);
      await refreshWebsiteBuilder();
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
    if (isOpportunityLead(lead)) {
      toast.error('Opportunity updates are handled through the opportunity actions.');
      return;
    }
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
      const endpoint = isOpportunityLead(selectedLead)
        ? `/projects/contractor-opportunities/${selectedLead.opportunity_id || selectedLead.id}/accept/`
        : `/projects/contractor/public-leads/${selectedLead.id}/accept/`;
      const { data } = await api.post(endpoint);
      setLeadsRows((prev) => prev.map((row) => (row.id === data.id ? data : row)));
      setSelectedLead(data);
      toast.success(data?.notification_detail || (isOpportunityLead(data) ? 'Opportunity accepted.' : 'Lead accepted.'));
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
      const endpoint = isOpportunityLead(selectedLead)
        ? `/projects/contractor-opportunities/${selectedLead.opportunity_id || selectedLead.id}/decline/`
        : `/projects/contractor/public-leads/${selectedLead.id}/reject/`;
      const { data } = await api.post(endpoint);
      setLeadsRows((prev) => prev.map((row) => (row.id === data.id ? data : row)));
      setSelectedLead(data);
      toast.success(data?.notification_detail || (isOpportunityLead(data) ? 'Opportunity declined.' : 'Lead rejected.'));
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
    if (primaryLeadAction.kind === 'open_agreement' || selectedLead.converted_agreement || selectedLead.agreement_id || selectedLead.next_url) {
      navigate(selectedLead.next_url || `/app/agreements/${selectedLead.converted_agreement || selectedLead.agreement_id}`);
      return;
    }
    if (primaryLeadAction.kind === 'continue_review') return;
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

  async function generateProfileCopy(event) {
    event.preventDefault();
    try {
      setGeneratingProfile(true);
      const generated = await generateContractorPublicProfile(generateProfilePrompt);
      setProfile((prev) => ({
        ...prev,
        tagline: generated?.tagline || prev.tagline,
        bio: generated?.intro || prev.bio,
        proposal_tone: generated?.tone || prev.proposal_tone,
        work_types: Array.isArray(generated?.work_types) ? generated.work_types : prev.work_types,
        seo_title: generated?.seo_title || prev.seo_title,
        seo_description: generated?.seo_description || prev.seo_description,
      }));
      toast.success('Profile draft generated.');
      setGenerateProfilePrompt('');
      setGenerateProfileOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Unable to generate profile copy.');
    } finally {
      setGeneratingProfile(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading marketing workspace...</div>;
  }

  return (
    <ContractorPageSurface
      variant="operational"
      contentClassName="mx-auto max-w-7xl"
    >
      <div className="space-y-6">
      <ContractorContextualGuideModal
        guide={publicLeadsGuide}
        onDismiss={dismissActivationSection}
      />
      <Modal
        visible={generateProfileOpen}
        title="Generate My Profile"
        onClose={() => setGenerateProfileOpen(false)}
        testId="generate-profile-modal"
      >
        <form onSubmit={generateProfileCopy} className="space-y-4">
          <div className="text-sm text-slate-600">
            Tell us what you want the profile to feel like. We&apos;ll draft a tagline, intro, and SEO copy you can tweak before publishing.
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-800">Prompt</label>
            <textarea
              data-testid="generate-profile-prompt"
              value={generateProfilePrompt}
              onChange={(e) => setGenerateProfilePrompt(e.target.value)}
              rows={6}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
              placeholder="Example: Write a warm, premium profile for a kitchen and bath remodeling contractor that serves Austin homeowners."
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setGenerateProfileOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={generatingProfile}
              data-testid="generate-profile-submit"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {generatingProfile ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </form>
      </Modal>
      <QuickAddLeadModal
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        initialForm={quickAddPrefill}
        renderFab={false}
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
              Marketing
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Manage your public profile, gallery, reviews, website-ready leads, and shareable QR from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!profile.is_public ? (
              <span
                data-testid="public-presence-preview-banner"
                className="inline-flex items-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800"
              >
                Preview mode
              </span>
            ) : null}
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
            <div className="mt-6" data-testid="public-presence-profile-tab">
              {!profile.is_public ? (
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Preview mode: your public profile is not live yet. Use the generator below to draft copy, then publish when you&apos;re ready.
                </div>
              ) : null}
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Profile copy</div>
                      <div className="text-xs text-slate-500">Draft your tagline, intro, and search copy in one pass.</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setGenerateProfileOpen(true)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      ✨ Generate My Profile
                    </button>
                  </div>

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
                  </div>

                  <div
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    data-testid="brand-voice-profile-section"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Brand &amp; Voice</div>
                      <p className="mt-1 text-sm text-slate-600">
                        These preferences help shape how proposal drafts sound and appear.
                      </p>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <input
                        value={profile.tagline || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, tagline: e.target.value }))}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Tagline"
                      />
                      <select
                        data-testid="proposal-tone-selector"
                        value={profile.proposal_tone || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, proposal_tone: e.target.value }))}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      >
                        {PROPOSAL_TONE_OPTIONS.map(([value, label]) => (
                          <option key={value || 'default'} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        value={profile.bio || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))}
                        rows={4}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2"
                        placeholder="Short company intro"
                      />
                      <input
                        data-testid="preferred-signoff-input"
                        value={profile.preferred_signoff || ''}
                        onChange={(e) => setProfile((prev) => ({ ...prev, preferred_signoff: e.target.value }))}
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Preferred signoff"
                      />
                    </div>
                  </div>

                  <div
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                    data-testid="brand-appearance-profile-section"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Brand &amp; Appearance</div>
                      <p className="mt-1 text-sm text-slate-600">
                        Choose a controlled look that keeps the public profile polished and readable.
                      </p>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Primary color</span>
                        <input
                          data-testid="brand-primary-color-input"
                          type="color"
                          value={profile.brand_primary_color || '#0f172a'}
                          onChange={(e) => setProfile((prev) => ({ ...prev, brand_primary_color: e.target.value }))}
                          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-2 py-1"
                        />
                      </label>
                      <label className="space-y-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accent color</span>
                        <input
                          data-testid="brand-accent-color-input"
                          type="color"
                          value={profile.brand_accent_color || '#0ea5e9'}
                          onChange={(e) => setProfile((prev) => ({ ...prev, brand_accent_color: e.target.value }))}
                          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-2 py-1"
                        />
                      </label>
                      <label className="space-y-2 md:col-span-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Typography</span>
                        <select
                          data-testid="brand-font-theme-select"
                          value={profile.brand_font_theme || 'clean_sans'}
                          onChange={(e) => setProfile((prev) => ({ ...prev, brand_font_theme: e.target.value }))}
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        >
                          {FONT_THEME_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="md:col-span-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Theme preset</div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {THEME_OPTIONS.map((option) => {
                            const selected = String(profile.profile_theme || 'modern') === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                data-testid={`brand-theme-${option.value}`}
                                onClick={() => setProfile((prev) => ({ ...prev, profile_theme: option.value }))}
                                className={`rounded-2xl border px-4 py-3 text-left transition ${
                                  selected
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                <div className="text-sm font-semibold">{option.label}</div>
                                <div className={`mt-1 text-xs ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                                  Controlled preset with readable contrast.
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Logo</div>
                        {profile.logo_url ? <img src={profile.logo_url} alt="Logo" className="h-24 w-24 rounded-xl object-cover" /> : null}
                        <input type="file" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hero image</div>
                        {(profile.hero_image_url || profile.cover_image_url) ? (
                          <img
                            src={profile.hero_image_url || profile.cover_image_url}
                            alt="Hero"
                            className="h-24 w-full rounded-xl object-cover"
                          />
                        ) : null}
                        <input type="file" onChange={(e) => setHeroFile(e.target.files?.[0] || null)} />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Legacy cover image</div>
                        {profile.cover_image_url ? <img src={profile.cover_image_url} alt="Cover" className="h-24 w-full rounded-xl object-cover" /> : null}
                        <input type="file" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
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
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      ['is_public', 'Public profile visible'],
                      ['allow_public_intake', 'Allow public intake'],
                      ['allow_public_reviews', 'Allow public reviews'],
                      ['show_reviews', 'Show reviews section'],
                      ['show_gallery', 'Show gallery section'],
                      ['show_quote_cta', 'Show quote CTA'],
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

                <PublicPresenceBrandPreview profile={profile} galleryRows={galleryRows} reviewsRows={reviewsRows} />
              </div>
            </div>
          ) : null}

          {activeTab === 'website' ? (
            <WebsiteBuilderWizard
              profile={profile}
              setProfile={setProfile}
              websiteReadiness={websiteReadiness}
              setWebsiteReadiness={setWebsiteReadiness}
              galleryRows={galleryRows}
              reviewsRows={reviewsRows}
              logoFile={logoFile}
              setLogoFile={setLogoFile}
              heroFile={heroFile}
              setHeroFile={setHeroFile}
              onSaveProfile={saveProfile}
              onSaveWebsiteSettings={saveWebsiteSettings}
              onSaveWebsitePage={saveWebsitePage}
              onPublish={publishWebsite}
              onPause={pauseWebsite}
              onToggleGallery={toggleGalleryVisibility}
              onToggleReview={toggleReviewVisibility}
              galleryBusy={galleryBusy}
              reviewBusy={reviewBusy}
              busy={profileBusy || websiteBusy}
              publishMessage={websitePublishMessage}
            />
          ) : null}

          {false && activeTab === 'website' ? (
            <div className="mt-6 space-y-4" data-testid="marketing-website-builder-tab">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">
                      MVP Draft Builder
                    </div>
                    <h2 className="mt-4 text-2xl font-bold text-slate-900">Website Builder</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">
                      Build a simple, professional website from your existing public profile, gallery, reviews, service area, and brand settings.
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Current plan</div>
                    <div className="mt-1 text-lg font-bold text-slate-900">{websiteReadiness?.entitlements?.plan || 'free'}</div>
                    <div className="mt-1 text-xs text-slate-500">Status: {websiteData.status || websiteReadiness?.draft?.status || 'draft'}</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 lg:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="website-builder-plan-gate">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Plan gate</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {websiteBuilderGate.enabled ? 'Pro Website Builder enabled' : 'Pro Website Builder gated'}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {websiteBuilderGate.reason || 'Website Builder controls are available for this plan.'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="website-builder-readiness-score">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Readiness</div>
                    <div className="mt-2 text-2xl font-bold text-slate-900">{Number(websiteReadinessData.score || 0)}%</div>
                    <p className="mt-1 text-sm text-slate-600">
                      {Number(websiteReadinessData.complete_count || 0)} of {Number(websiteReadinessData.total_count || 0)} website signals ready.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="website-builder-preview-summary">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Preview source</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {websiteProfile?.identity?.business_name || profile.business_name_public || 'Public profile'}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {(websiteProfile?.gallery?.count || 0)} portfolio item{Number(websiteProfile?.gallery?.count || 0) === 1 ? '' : 's'} and {(websiteProfile?.reviews?.count || 0)} public review{Number(websiteProfile?.reviews?.count || 0) === 1 ? '' : 's'} ready for preview.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="website-builder-publish-status">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Publish</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">
                      {canPublishWebsite ? 'Ready to publish' : 'Not publishable yet'}
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {websitePublishBlockers[0] || websitePublishGate.reason || 'Publishing saves a public snapshot.'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex gap-2 overflow-x-auto border-b border-slate-200 pb-2" data-testid="website-builder-tabs">
                  {WEBSITE_BUILDER_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setWebsiteBuilderTab(tab.key)}
                      className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold ${
                        websiteBuilderTab === tab.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {websiteBuilderTab === 'setup' ? (
                  <div className="mt-5 space-y-4" data-testid="website-builder-setup-tab">
                    {missingRequiredFields.length ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="website-builder-missing-fields">
                        <div className="text-sm font-semibold text-amber-900">Missing required fields</div>
                        <div className="mt-1 text-sm text-amber-800">{missingRequiredFields.join(', ')}</div>
                      </div>
                    ) : null}

                    <div className="grid gap-2 md:grid-cols-2" data-testid="website-builder-readiness-checklist">
                      {websiteChecklist.map((item) => (
                        <div
                          key={item.key}
                          className={`rounded-2xl border px-4 py-3 text-sm ${
                            item.complete
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-50 text-slate-600'
                          }`}
                        >
                          <span className="font-semibold">{item.complete ? 'Ready' : item.required ? 'Required' : 'Suggested'}:</span> {item.label}
                          {!item.complete && item.action ? <div className="mt-1 text-xs">{item.action}</div> : null}
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="website-builder-next-steps">
                      <div className="text-sm font-semibold text-slate-900">Recommended next steps</div>
                      <div className="mt-3 space-y-2">
                        {(websiteReadiness.recommended_next_steps || []).map((step) => (
                          <div key={step.key} className="rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                            <span className="font-semibold text-slate-900">{step.label}</span>
                            {step.action ? <span className="text-slate-500"> - {step.action}</span> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {websiteBuilderTab === 'design' ? (
                  <div className="mt-5 space-y-5" data-testid="website-builder-design-tab">
                    {!canCustomizeWebsite ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        {websiteBuilderGate.reason || 'Upgrade to Pro to customize templates, sections, colors, and page content.'}
                      </div>
                    ) : null}

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      {WEBSITE_TEMPLATES.map((template) => (
                        <button
                          key={template.key}
                          type="button"
                          disabled={!canCustomizeWebsite || websiteBusy}
                          onClick={() => saveWebsiteSettings({ template_key: template.key })}
                          className={`rounded-2xl border p-4 text-left disabled:cursor-not-allowed disabled:opacity-60 ${
                            (websiteData.template_key || 'starter') === template.key ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                          }`}
                        >
                          <div className="text-sm font-bold text-slate-900">{template.label}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-600">{template.description}</div>
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <label className="text-sm font-semibold text-slate-700">
                        Primary color
                        <input
                          type="color"
                          disabled={!canCustomizeWebsite || websiteBusy}
                          value={websiteLayout.branding?.primary_color || websiteProfile?.branding?.primary_color || '#2563eb'}
                          onChange={(event) => updateWebsiteLayout({ branding: { primary_color: event.target.value } })}
                          className="mt-2 h-11 w-full rounded-xl border border-slate-300 p-1 disabled:opacity-60"
                          data-testid="website-builder-primary-color"
                        />
                      </label>
                      <label className="text-sm font-semibold text-slate-700">
                        Accent color
                        <input
                          type="color"
                          disabled={!canCustomizeWebsite || websiteBusy}
                          value={websiteLayout.branding?.accent_color || websiteProfile?.branding?.accent_color || '#14b8a6'}
                          onChange={(event) => updateWebsiteLayout({ branding: { accent_color: event.target.value } })}
                          className="mt-2 h-11 w-full rounded-xl border border-slate-300 p-1 disabled:opacity-60"
                          data-testid="website-builder-accent-color"
                        />
                      </label>
                      <label className="text-sm font-semibold text-slate-700">
                        Font theme
                        <select
                          disabled={!canCustomizeWebsite || websiteBusy}
                          value={websiteLayout.branding?.font_theme || websiteProfile?.branding?.font_theme || 'modern'}
                          onChange={(event) => updateWebsiteLayout({ branding: { font_theme: event.target.value } })}
                          className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                          data-testid="website-builder-font-theme"
                        >
                          {FONT_THEME_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-bold text-slate-900">Homepage sections</div>
                      <div className="mt-3 grid gap-2 md:grid-cols-3">
                        {websiteSectionOrder.map((key) => (
                          <label key={key} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              disabled={!canCustomizeWebsite || websiteBusy}
                              checked={websiteSections[key] !== false}
                              onChange={(event) => updateWebsiteLayout({ sections: { [key]: event.target.checked } })}
                            />
                            <span>{WEBSITE_SECTION_LABELS[key] || key}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid="website-builder-ai-branding-disabled">
                      <div className="text-sm font-bold text-slate-900">AI Branding Assistant</div>
                      <p className="mt-1 text-sm text-slate-600">Coming later. This MVP keeps AI copy generation disabled while the website data contract and publish flow stabilize.</p>
                    </div>
                  </div>
                ) : null}

                {websiteBuilderTab === 'pages' ? (
                  <div className="mt-5 grid gap-5 lg:grid-cols-[240px_1fr]" data-testid="website-builder-pages-tab">
                    <div className="space-y-2">
                      {websitePages.map((page) => (
                        <button
                          key={page.id}
                          type="button"
                          onClick={() => setSelectedWebsitePageId(page.id)}
                          className={`w-full rounded-xl px-4 py-3 text-left text-sm font-semibold ${
                            selectedWebsitePage?.id === page.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          {page.title || page.page_type}
                        </button>
                      ))}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      {selectedWebsitePage ? (
                        <div className="space-y-4">
                          {!canCustomizeWebsite ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                              {websiteBuilderGate.reason || 'Upgrade to Pro to edit website pages.'}
                            </div>
                          ) : null}
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="text-sm font-semibold text-slate-700">
                              Page title
                              <input
                                disabled={!canCustomizeWebsite || websiteBusy}
                                value={selectedWebsitePage.title || ''}
                                onChange={(event) => setWebsiteReadiness((prev) => ({
                                  ...prev,
                                  pages: websitePages.map((page) => page.id === selectedWebsitePage.id ? { ...page, title: event.target.value } : page),
                                }))}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                                data-testid="website-builder-page-title"
                              />
                            </label>
                            <label className="text-sm font-semibold text-slate-700">
                              Slug
                              <input
                                disabled={!canCustomizeWebsite || websiteBusy || selectedWebsitePage.page_type === 'home'}
                                value={selectedWebsitePage.slug || ''}
                                onChange={(event) => setWebsiteReadiness((prev) => ({
                                  ...prev,
                                  pages: websitePages.map((page) => page.id === selectedWebsitePage.id ? { ...page, slug: event.target.value } : page),
                                }))}
                                className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                              />
                            </label>
                          </div>
                          <label className="block text-sm font-semibold text-slate-700">
                            SEO title
                            <input
                              disabled={!canCustomizeWebsite || websiteBusy}
                              value={selectedWebsitePage.seo_title || ''}
                              onChange={(event) => setWebsiteReadiness((prev) => ({
                                ...prev,
                                pages: websitePages.map((page) => page.id === selectedWebsitePage.id ? { ...page, seo_title: event.target.value } : page),
                              }))}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                            />
                          </label>
                          <label className="block text-sm font-semibold text-slate-700">
                            SEO description
                            <textarea
                              disabled={!canCustomizeWebsite || websiteBusy}
                              value={selectedWebsitePage.seo_description || ''}
                              onChange={(event) => setWebsiteReadiness((prev) => ({
                                ...prev,
                                pages: websitePages.map((page) => page.id === selectedWebsitePage.id ? { ...page, seo_description: event.target.value } : page),
                              }))}
                              rows={2}
                              className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                            />
                          </label>
                          {selectedWebsitePage.page_type === 'home' ? (
                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="text-sm font-semibold text-slate-700">
                                Hero headline
                                <input
                                  disabled={!canCustomizeWebsite || websiteBusy}
                                  value={selectedWebsitePage.content_blocks?.hero?.headline || ''}
                                  onChange={(event) => setWebsiteReadiness((prev) => ({
                                    ...prev,
                                    pages: websitePages.map((page) => page.id === selectedWebsitePage.id ? {
                                      ...page,
                                      content_blocks: {
                                        ...(page.content_blocks || {}),
                                        hero: { ...(page.content_blocks?.hero || {}), headline: event.target.value },
                                      },
                                    } : page),
                                  }))}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                                  data-testid="website-builder-hero-headline"
                                />
                              </label>
                              <label className="text-sm font-semibold text-slate-700">
                                CTA text
                                <input
                                  disabled={!canCustomizeWebsite || websiteBusy}
                                  value={selectedWebsitePage.content_blocks?.hero?.cta_text || ''}
                                  onChange={(event) => setWebsiteReadiness((prev) => ({
                                    ...prev,
                                    pages: websitePages.map((page) => page.id === selectedWebsitePage.id ? {
                                      ...page,
                                      content_blocks: {
                                        ...(page.content_blocks || {}),
                                        hero: { ...(page.content_blocks?.hero || {}), cta_text: event.target.value },
                                      },
                                    } : page),
                                  }))}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                                />
                              </label>
                              <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                                Hero subheadline
                                <textarea
                                  disabled={!canCustomizeWebsite || websiteBusy}
                                  value={selectedWebsitePage.content_blocks?.hero?.subheadline || ''}
                                  onChange={(event) => setWebsiteReadiness((prev) => ({
                                    ...prev,
                                    pages: websitePages.map((page) => page.id === selectedWebsitePage.id ? {
                                      ...page,
                                      content_blocks: {
                                        ...(page.content_blocks || {}),
                                        hero: { ...(page.content_blocks?.hero || {}), subheadline: event.target.value },
                                      },
                                    } : page),
                                  }))}
                                  rows={3}
                                  className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
                                />
                              </label>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            disabled={!canCustomizeWebsite || websiteBusy}
                            onClick={() => saveWebsitePage(selectedWebsitePage, selectedWebsitePage)}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-600"
                            data-testid="website-builder-save-page"
                          >
                            {websiteBusy ? 'Saving...' : 'Save Page'}
                          </button>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500">No website pages have been created yet.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                {websiteBuilderTab === 'preview' ? (
                  <div className="mt-5 space-y-4" data-testid="website-builder-preview-tab">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm text-slate-600">Draft preview uses the same website payload as the future public renderer.</div>
                      <div className="flex rounded-xl bg-slate-100 p-1">
                        {['desktop', 'mobile'].map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setWebsitePreviewMode(mode)}
                            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${websitePreviewMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
                          >
                            {mode === 'desktop' ? 'Desktop' : 'Mobile'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <PublicWebsiteRenderer payload={websitePreviewPayload} previewMode={websitePreviewMode} />
                  </div>
                ) : null}

                {websiteBuilderTab === 'publish' ? (
                  <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_360px]" data-testid="website-builder-publish-tab">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-bold text-slate-900">Publish readiness</div>
                      <div className="mt-3 space-y-2">
                        {(websitePublishBlockers.length ? websitePublishBlockers : ['No publish blockers detected.']).map((blocker) => (
                          <div key={blocker} className={`rounded-xl px-3 py-2 text-sm ${websitePublishBlockers.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
                            {blocker}
                          </div>
                        ))}
                      </div>
                      {websitePublishMessage ? <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700">{websitePublishMessage}</div> : null}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="text-sm font-bold text-slate-900">Public route</div>
                      <div className="mt-2 break-all rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        {websiteData.public_url || '/websites/your-slug'}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={!canPublishWebsite || websiteBusy}
                          onClick={publishWebsite}
                          data-testid="website-builder-publish-button"
                          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-600"
                        >
                          {websiteBusy ? 'Publishing...' : 'Publish Snapshot'}
                        </button>
                        <button
                          type="button"
                          disabled={websiteBusy || websiteData.status !== 'published'}
                          onClick={pauseWebsite}
                          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Pause
                        </button>
                      </div>
                      <p className="mt-3 text-xs leading-5 text-slate-500">
                        Publishing stores a snapshot. Later draft changes will not affect the public site until you publish again.
                      </p>
                    </div>
                  </div>
                ) : null}
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
            <div className="mt-6 space-y-4" data-testid="public-presence-leads-tab">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Website Leads</div>
                  <div className="text-xs text-slate-500">Capture and review requests from your public profile, QR code, and future website.</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setQuickAddPrefill(null);
                    setQuickAddOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Add Lead
                </button>
              </div>
              {activationLeadBanner ? (
                <div
                  data-testid="public-leads-activation-banner"
                  className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-900"
                >
                  {activationLeadBanner}
                </div>
              ) : null}
              <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="space-y-3">
                {leadsRows.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                    No homeowner requests yet. Share your public profile or wait for matching project requests.
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
                    <div className="text-sm font-semibold">{lead.full_name || lead.homeowner_name || 'Homeowner Request'}</div>
                    <div className="mt-1 text-xs opacity-80">{lead.project_title || lead.project_type || 'New project request'}</div>
                    <div className="mt-1 text-xs opacity-80">{[lead.city, lead.state].filter(Boolean).join(', ') || 'Location not provided'}</div>
                    <div className="mt-2">
                      <ProjectModeBadge
                        mode={lead.project_mode}
                        dataTestId={`public-lead-project-mode-${lead.id}`}
                      />
                    </div>
                    {lead.matching?.tier ? (
                      <div className="mt-2">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${contractorMatchTierClass(lead.matching.tier)}`}>
                          {contractorMatchTierLabel(lead.matching.tier)}
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-2 inline-flex rounded-full border border-current/20 px-2 py-0.5 text-[11px] font-semibold opacity-90">
                      {sourceLabel(lead.source)}
                    </div>
                    <span className={`mt-2 ml-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusChipClass(lead.status)}`}>
                      {statusLabel(lead.status)}
                    </span>
                    {lead.selected_by_homeowner ? (
                      <div className="mt-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                        Homeowner selected you
                      </div>
                    ) : null}
                    <div className="mt-2 text-xs opacity-80">
                      {[opportunityBudgetText(lead), lead.timeline || lead.preferred_timeline].filter(Boolean).join(' · ')}
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
                      title="Project Assistant for this lead"
                      description="Use the current lead context to review, analyze, send intake, or draft the agreement."
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
                        <div className="text-lg font-semibold text-slate-900">{selectedLead.full_name || selectedLead.homeowner_name}</div>
                        <div className="mt-1 text-sm text-slate-600">
                          {selectedLead.email || 'No email'} · {selectedLead.phone || 'No phone'}
                        </div>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChipClass(selectedLead.status)}`}>
                        {statusLabel(selectedLead.status)}
                      </span>
                      <ProjectModeBadge
                        mode={selectedLead.project_mode}
                        dataTestId="public-lead-selected-project-mode"
                      />
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm text-slate-700">
                      <div><span className="font-semibold text-slate-900">Source:</span> {sourceLabel(selectedLead.source)}</div>
                      <div><span className="font-semibold text-slate-900">Timeline:</span> {selectedLead.timeline || selectedLead.preferred_timeline || '-'}</div>
                      <div><span className="font-semibold text-slate-900">Budget:</span> {opportunityBudgetText(selectedLead) || '-'}</div>
                      <div><span className="font-semibold text-slate-900">Selected:</span> {fmtDateTime(selectedLead.selected_at || selectedLead.created_at)}</div>
                      <div><span className="font-semibold text-slate-900">Location:</span> {[selectedLead.project_address, selectedLead.city, selectedLead.state, selectedLead.zip_code].filter(Boolean).join(', ') || '-'}</div>
                    </div>
                    {isOpportunityLead(selectedLead) ? (
                      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                        This request came from a homeowner project intake. MyHomeBro prepared the project details to help you respond faster.
                      </div>
                    ) : null}
                    {selectedLead.accepted_at ? (
                      <div className="mt-3 text-xs font-medium text-indigo-700">
                        Accepted: {fmtDateTime(selectedLead.accepted_at)}
                      </div>
                    ) : null}
                    <div className="mt-4 text-sm text-slate-700">
                    {selectedLead.ai_analysis?.project_scope_summary ||
                        selectedLead.ai_analysis?.suggested_description ||
                        selectedLead.refined_description ||
                        selectedLead.project_description ||
                        'No project description provided.'}
                    </div>
                    {selectedLead.refined_description ? (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Refined Description</div>
                        <div className="mt-1">{selectedLead.refined_description}</div>
                      </div>
                    ) : null}
                    {Array.isArray(selectedLead.measurements) && selectedLead.measurements.length ? (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Measurements</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedLead.measurements.map((item, index) => (
                            <span key={`${item?.label || item}-${index}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {typeof item === 'string' ? item : item.label || item.value || JSON.stringify(item)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {selectedLead.photos_count ? (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                        Photos attached: {selectedLead.photos_count}
                      </div>
                    ) : null}
                    {selectedLeadMatching?.tier ? (
                      <div
                        data-testid="public-lead-compatibility"
                        className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                            Why this project matches you
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${contractorMatchTierClass(selectedLeadMatching.tier)}`}>
                            {contractorMatchTierLabel(selectedLeadMatching.tier)}
                          </span>
                          {Number.isFinite(Number(selectedLeadMatching.score)) ? (
                            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                              Score {Number(selectedLeadMatching.score).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-700">
                          {selectedLeadMatching.summary || 'This lead looks like a reasonable fit for your contractor profile.'}
                        </div>
                        {Array.isArray(selectedLeadMatching.badges) && selectedLeadMatching.badges.length ? (
                          <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            {selectedLeadMatching.badges.slice(0, 4).map((badge) => (
                              <span key={badge} className="rounded-full border border-emerald-200 bg-white px-2 py-1 font-semibold text-emerald-800">
                                {badge}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {Array.isArray(selectedLeadMatching.reasons) && selectedLeadMatching.reasons.length ? (
                          <ul className="mt-3 space-y-1 text-xs text-slate-600">
                            {selectedLeadMatching.reasons.slice(0, 4).map((reason, index) => (
                              <li key={`${reason}-${index}`}>• {reason}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
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
                          {selectedLead.ai_analysis.project_family_label ? (
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-sky-700">
                              {selectedLead.ai_analysis.project_family_label}
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
                        {selectedLead.ai_analysis.project_scope_summary ||
                        selectedLead.ai_analysis.suggested_description ? (
                          <div className="mt-3 text-sm text-slate-700">
                            {selectedLead.ai_analysis.project_scope_summary || selectedLead.ai_analysis.suggested_description}
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
                        <div
                          data-testid="recommended-setup-section"
                          className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/70 p-4"
                        >
                          <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                            Recommended Setup
                          </div>
                          <div className="mt-2 text-sm font-semibold text-slate-900">
                            {selectedLeadRecommendedSetup.recommendedProjectType ||
                              'Recommended project setup'}
                          </div>
                          <div className="mt-1 text-sm text-slate-700">
                            Based on the project details provided. Use this as a starting point and adjust it in the agreement flow.
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-3 text-xs text-slate-700">
                            <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                              <div className="font-semibold text-slate-900">Workflow</div>
                              <div className="mt-1">{selectedLeadRecommendedSetup.suggestedWorkflow || 'General project review'}</div>
                            </div>
                            <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                              <div className="font-semibold text-slate-900">Template</div>
                              <div className="mt-1">
                                {selectedLeadRecommendedSetup.suggestedTemplateLabel ||
                                  selectedLeadRecommendedSetup.recommendedTemplateName ||
                                  'General project template'}
                              </div>
                            </div>
                            <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                              <div className="font-semibold text-slate-900">Project Type</div>
                              <div className="mt-1">
                                {selectedLeadRecommendedSetup.recommendedProjectType ||
                                  selectedLeadRecommendedSetup.projectFamilyLabel ||
                                  selectedLead.project_type ||
                                  '-'}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 rounded-xl border border-white/80 bg-white/80 px-4 py-3 text-sm text-slate-700">
                            {selectedLeadRecommendedSetup.recommendationNote ||
                              'This is a suggested setup. You can still choose a different path when you create the bid.'}
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
                      {!isOpportunityLead(selectedLead) ? (
                        <textarea value={selectedLead.internal_notes || ''} onChange={(e) => setSelectedLead((prev) => ({ ...prev, internal_notes: e.target.value }))} rows={4} className="rounded-xl border border-slate-300 px-3 py-2 text-sm md:col-span-2" placeholder="Internal notes" />
                      ) : null}
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
                      {isOpportunityLead(selectedLead) && selectedLead.status === 'pending' ? (
                        <button type="button" onClick={rejectLead} disabled={leadBusy || Boolean(selectedLead.converted_agreement)} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                          Decline
                        </button>
                      ) : null}
                      {!isOpportunityLead(selectedLead) && !leadCanSkipColdAcceptance(selectedLead) && selectedLead.status === 'new' ? (
                        <button type="button" onClick={rejectLead} disabled={leadBusy || Boolean(selectedLead.converted_agreement)} className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60">
                          Reject Lead
                        </button>
                      ) : null}
                      {!isOpportunityLead(selectedLead) ? (
                        <button type="button" onClick={analyzeLeadWithAi} disabled={leadBusy || !leadCanAnalyzeFromUi(selectedLead)} className="rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60">
                          Analyze Intake with AI
                        </button>
                      ) : null}
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
                      {!isOpportunityLead(selectedLead) ? (
                        <button type="button" onClick={() => updateLeadStatus('contacted')} disabled={leadBusy || selectedLead.status === 'contacted'} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                          Mark Contacted
                        </button>
                      ) : null}
                      {!isOpportunityLead(selectedLead) ? (
                        <button type="button" onClick={() => updateLeadStatus('closed')} disabled={leadBusy || selectedLead.status === 'closed'} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                          Mark Closed
                        </button>
                      ) : null}
                      {!isOpportunityLead(selectedLead) ? (
                        <button type="button" onClick={() => updateLeadStatus('archived')} disabled={leadBusy || selectedLead.status === 'archived'} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                          Archive Lead
                        </button>
                      ) : null}
                      {!selectedLead.converted_homeowner_id && leadCanRunAiActions(selectedLead) ? (
                        <button type="button" onClick={convertLeadToCustomer} disabled={leadBusy} className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-60">
                          Create Customer Record
                        </button>
                      ) : null}
                      {selectedLead.converted_agreement || selectedLead.agreement_id || selectedLead.next_url ? (
                        <button type="button" onClick={() => navigate(selectedLead.next_url || `/app/agreements/${selectedLead.converted_agreement || selectedLead.agreement_id}`)} className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">
                          Open Draft Agreement
                        </button>
                      ) : null}
                      {!isOpportunityLead(selectedLead) ? (
                        <button type="button" onClick={() => saveLead(selectedLead)} disabled={leadBusy} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                          {leadBusy ? 'Saving...' : 'Save Changes'}
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">Choose a homeowner request to review its details and next steps.</div>
                )}
              </div>
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
    </ContractorPageSurface>
  );
}
