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

const ONLINE_PRESENCE_STEPS = [
  { key: 'decision', label: 'Website Decision', eyebrow: 'Step 0' },
  { key: 'profile', label: 'Business Information', eyebrow: 'Step 1' },
  { key: 'gallery', label: 'Photo Gallery', eyebrow: 'Step 2' },
  { key: 'reviews', label: 'Reviews & Testimonials', eyebrow: 'Step 3' },
  { key: 'website', label: 'Design & Content', eyebrow: 'Step 4' },
  { key: 'seo', label: 'SEO & Visibility', eyebrow: 'Step 5' },
  { key: 'final', label: 'Final Review', eyebrow: 'Step 6' },
  { key: 'publish', label: 'Publish', eyebrow: 'Step 7' },
];

const DESIGN_STYLE_OPTIONS = [
  { key: 'starter', label: 'Modern', description: 'Clean sections, blue accents, and a direct quote path.' },
  { key: 'premium_home', label: 'Classic', description: 'Warm, trust-led presentation for residential projects.' },
  { key: 'bold_contractor', label: 'Bold', description: 'Strong contrast and action-forward content blocks.' },
  { key: 'clean_local_service', label: 'Local', description: 'Friendly, practical, and tuned for service calls.' },
];

const WEBSITE_SECTION_LABELS = {
  hero: 'Hero',
  services: 'Services',
  portfolio: 'Portfolio',
  reviews: 'Reviews',
  trust: 'Trust',
  contact: 'Contact / Quote',
};

const SERVICE_AREA_MODES = [
  ['radius', 'Radius'],
  ['cities', 'Cities'],
  ['counties', 'Counties'],
];

const CREDENTIAL_OPTIONS = [
  ['licensed', 'Licensed'],
  ['insured', 'Insured'],
  ['bonded', 'Bonded'],
  ['emergency_service', 'Emergency service'],
  ['free_estimates', 'Free estimates'],
  ['financing_available', 'Financing available'],
  ['residential', 'Residential'],
  ['commercial', 'Commercial'],
];

const CUSTOMER_TRUST_BADGES = [
  'Family-owned',
  'Veteran-owned',
  'Locally owned',
  'Woman-owned',
  'Minority-owned',
  'Manufacturer certified',
  'Background-checked employees',
  'Warranty included',
  'Satisfaction guaranteed',
  'Eco-friendly',
  'BBB accredited',
  'Same-day service',
  '24/7 emergency service',
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
    return { kind: 'create_agreement', label: 'Prepare Agreement Draft' };
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

function AiSuggestionCard({ suggestion, onAccept, onRegenerate, onDismiss }) {
  if (!suggestion) return null;
  const configured = suggestion.configured !== false;
  const hasValue = Boolean(String(suggestion.suggested_value || '').trim());
  return (
    <div className={`mt-3 rounded-xl border p-4 text-sm ${configured ? 'border-blue-200 bg-blue-50 text-blue-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`} data-testid={`ai-suggestion-${suggestion.target}`}>
      <div className="font-black">{configured ? 'Project Assistant suggestion ready' : 'Project Assistant is not configured yet'}</div>
      {hasValue ? <p className="mt-2 leading-6">{suggestion.suggested_value}</p> : <p className="mt-2 leading-6">{suggestion.detail || 'Project Assistant is not configured yet.'}</p>}
      {Array.isArray(suggestion.suggestions) && suggestion.suggestions.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {suggestion.suggestions.slice(0, 5).map((item) => <li key={String(item)}>{String(item)}</li>)}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {hasValue ? <button type="button" onClick={onAccept} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white" data-testid={`ai-accept-${suggestion.target}`}>Accept</button> : null}
        <button type="button" onClick={onRegenerate} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700">Regenerate</button>
        <button type="button" onClick={onDismiss} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700">Dismiss</button>
      </div>
    </div>
  );
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
  owner_contact_name: '',
  primary_trade: '',
  service_area_mode: 'radius',
  service_cities: [],
  service_counties: [],
  credentials: {},
  customer_trust_badges: [],
  has_existing_website: false,
  existing_website_url: '',
  website_analysis_status: 'not_started',
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
  const [activeTab, setActiveTab] = useState('decision');
  const [profile, setProfile] = useState(defaultProfile);
  const [profileBusy, setProfileBusy] = useState(false);
  const [websiteDecisionError, setWebsiteDecisionError] = useState('');
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
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [websitePublishMessage, setWebsitePublishMessage] = useState('');
  const [aiBusyTarget, setAiBusyTarget] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState({});
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
  const websiteDevelopmentOverrideActive = Boolean(websiteReadiness?.entitlements?.development_override_active);
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
  const canCustomizeWebsite = websiteDevelopmentOverrideActive || Boolean(websiteReadiness?.entitlements?.can_customize || websiteBuilderGate.enabled);
  const canPublishWebsite =
    websiteDevelopmentOverrideActive ||
    (Boolean(websiteReadiness?.entitlements?.can_publish || websitePublishGate.enabled) && websitePublishBlockers.length === 0);
  const websiteFullPreviewUrl = (mode = 'desktop') => `/app/marketing/preview?mode=${mode}`;
  const websiteHeroImage =
    websiteProfile?.images?.hero ||
    websiteProfile?.images?.cover ||
    websiteProfile?.branding?.hero_image_url ||
    websiteProfile?.branding?.cover_image_url ||
    websiteProfile?.gallery?.items?.[0]?.image_url ||
    '';
  const websiteBusinessName =
    websiteProfile?.identity?.business_name ||
    profile.business_name_public ||
    profile.business_name ||
    'Your business';
  const selectedDesignLabel =
    DESIGN_STYLE_OPTIONS.find((option) => option.key === (websiteData.template_key || 'starter'))?.label || 'Modern';

  const specialtiesText = useMemo(
    () => (Array.isArray(profile.specialties) ? profile.specialties.join(', ') : ''),
    [profile.specialties]
  );
  const workTypesText = useMemo(
    () => (Array.isArray(profile.work_types) ? profile.work_types.join(', ') : ''),
    [profile.work_types]
  );
  const serviceCitiesText = useMemo(
    () => (Array.isArray(profile.service_cities) ? profile.service_cities.join(', ') : ''),
    [profile.service_cities]
  );
  const serviceCountiesText = useMemo(
    () => (Array.isArray(profile.service_counties) ? profile.service_counties.join(', ') : ''),
    [profile.service_counties]
  );
  const credentials = profile.credentials && typeof profile.credentials === 'object' ? profile.credentials : {};
  const customerTrustBadges = Array.isArray(profile.customer_trust_badges)
    ? profile.customer_trust_badges
    : [];
  const stepOneReadiness = useMemo(() => {
    const checks = [
      Boolean(profile.business_name_public),
      Boolean(profile.bio),
      Boolean(profile.phone_public || profile.email_public),
      Boolean(profile.primary_trade || workTypesText || specialtiesText),
      Boolean(profile.city && profile.state),
      Boolean(profile.service_area_text || serviceCitiesText || serviceCountiesText),
      Boolean(profile.years_in_business),
      Boolean(credentials.licensed || credentials.insured || profile.show_license_public),
      customerTrustBadges.length > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [
    credentials.insured,
    credentials.licensed,
    customerTrustBadges.length,
    profile.business_name_public,
    profile.bio,
    profile.city,
    profile.email_public,
    profile.phone_public,
    profile.primary_trade,
    profile.service_area_text,
    profile.show_license_public,
    profile.state,
    profile.years_in_business,
    serviceCitiesText,
    serviceCountiesText,
    specialtiesText,
    workTypesText,
  ]);
  const activeStepIndex = Math.max(
    0,
    ONLINE_PRESENCE_STEPS.findIndex((step) => step.key === activeTab)
  );
  const currentStep = ONLINE_PRESENCE_STEPS[activeStepIndex] || ONLINE_PRESENCE_STEPS[0];
  const setupProgress = Math.round(((activeStepIndex + 1) / ONLINE_PRESENCE_STEPS.length) * 100);
  const completedStepKeys = new Set(
    ONLINE_PRESENCE_STEPS.slice(0, activeStepIndex).map((step) => step.key)
  );
  const homePage = websitePages.find((page) => page.page_type === 'home') || selectedWebsitePage;
  const heroContent = homePage?.content_blocks?.hero || {};
  const serviceKeywords = [
    ...new Set(
      [
        ...(Array.isArray(profile.specialties) ? profile.specialties : []),
        ...(Array.isArray(profile.work_types) ? profile.work_types : []),
        profile.primary_trade,
      ].filter(Boolean)
    ),
  ];
  const buildAiContext = () => ({
    business_identity: {
      company_name: profile.business_name_public,
      years_in_business: profile.years_in_business,
      owner_contact_name: profile.owner_contact_name,
      description: profile.bio,
    },
    trades_services: {
      primary_trade: profile.primary_trade,
      trades: Array.isArray(profile.work_types) ? profile.work_types : [],
      services: Array.isArray(profile.specialties) ? profile.specialties : [],
    },
    service_area: {
      city: profile.city,
      state: profile.state,
      mode: profile.service_area_mode,
      radius: profile.service_radius,
      cities: profile.service_cities,
      counties: profile.service_counties,
      text: profile.service_area_text,
    },
    credentials: profile.credentials || {},
    customer_trust_badges: customerTrustBadges,
    reviews: reviewsRows
      .filter((review) => review.is_public)
      .map((review) => ({
        rating: review.rating,
        text: review.review_text || review.public_comment || '',
      })),
    gallery: galleryRows.map((item) => ({
      title: item.title,
      description: item.description,
      category: item.category,
    })),
  });

  async function requestAiSuggestion(action, target, currentValue = '', extra = {}) {
    try {
      setAiBusyTarget(target);
      const { data } = await api.post('/projects/contractor/website/ai-assist/', {
        action,
        current_value: currentValue,
        context: buildAiContext(),
        ...extra,
      });
      setAiSuggestions((prev) => ({
        ...prev,
        [target]: {
          target,
          action,
          configured: data?.configured !== false,
          detail: data?.detail || '',
          suggested_value: data?.suggested_value || data?.suggestion || '',
          suggestions: Array.isArray(data?.suggestions) ? data.suggestions : [],
        },
      }));
    } catch (err) {
      const detail = err?.response?.data?.detail || 'Project Assistant is not configured yet.';
      setAiSuggestions((prev) => ({
        ...prev,
        [target]: {
          target,
          action,
          configured: false,
          detail,
          suggested_value: '',
          suggestions: [],
        },
      }));
    } finally {
      setAiBusyTarget('');
    }
  }

  function dismissAiSuggestion(target) {
    setAiSuggestions((prev) => {
      const next = { ...prev };
      delete next[target];
      return next;
    });
  }

  function acceptAiSuggestion(target, applyValue) {
    const suggestion = aiSuggestions[target];
    const value = suggestion?.suggested_value;
    if (!String(value || '').trim()) return;
    applyValue(value);
    dismissAiSuggestion(target);
  }

  const goToStep = (key) => {
    if (ONLINE_PRESENCE_STEPS.some((step) => step.key === key)) {
      setActiveTab(key);
    }
  };
  const goToPreviousStep = () => {
    const previous = ONLINE_PRESENCE_STEPS[Math.max(0, activeStepIndex - 1)];
    if (previous) setActiveTab(previous.key);
  };
  const goToNextStep = () => {
    if (activeTab === 'decision') {
      void continueFromWebsiteDecision();
      return;
    }
    const next = ONLINE_PRESENCE_STEPS[Math.min(ONLINE_PRESENCE_STEPS.length - 1, activeStepIndex + 1)];
    if (next) setActiveTab(next.key);
  };
  const updateHomePageHero = (patch) => {
    if (!homePage) return;
    setWebsiteReadiness((prev) => ({
      ...prev,
      pages: (Array.isArray(prev.pages) ? prev.pages : []).map((page) =>
        page.id === homePage.id
          ? {
              ...page,
              content_blocks: {
                ...(page.content_blocks || {}),
                hero: {
                  ...(page.content_blocks?.hero || {}),
                  ...patch,
                },
              },
            }
          : page
      ),
    }));
  };
  const saveHomePageHero = () => {
    if (!homePage) return;
    saveWebsitePage(homePage, homePage);
  };
  const setCredential = (key, value) => {
    setProfile((prev) => ({
      ...prev,
      credentials: {
        ...(prev.credentials || {}),
        [key]: value,
      },
    }));
  };
  const toggleCustomerTrustBadge = (badge) => {
    setProfile((prev) => {
      const badges = Array.isArray(prev.customer_trust_badges) ? prev.customer_trust_badges : [];
      return {
        ...prev,
        customer_trust_badges: badges.includes(badge)
          ? badges.filter((item) => item !== badge)
          : [...badges, badge],
      };
    });
  };
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
    if (location.pathname.includes('/app/marketing')) {
      loadAll();
    }
  }, [location.pathname, location.search]);

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
    if (tab === 'leads') {
      setActiveTab('profile');
      return;
    }
    if (ONLINE_PRESENCE_STEPS.some((item) => item.key === tab)) {
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
        navigate('/app/opportunities?source=website');
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
      navigate('/app/opportunities?source=manual');
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

  async function saveProfile(overrides = {}) {
    try {
      setProfileBusy(true);
      const profileToSave = { ...profile, ...overrides };
      const payload = new FormData();
      const scalarFields = [
        'slug',
        'business_name_public',
        'tagline',
        'bio',
        'owner_contact_name',
        'primary_trade',
        'service_area_mode',
        'existing_website_url',
        'website_analysis_status',
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
        if (profileToSave[field] !== undefined && profileToSave[field] !== null) {
          payload.append(field, profileToSave[field]);
        }
      });
      payload.append('specialties', JSON.stringify((Array.isArray(profileToSave.specialties) ? profileToSave.specialties : []).map((item) => String(item).trim()).filter(Boolean)));
      payload.append('work_types', JSON.stringify((Array.isArray(profileToSave.work_types) ? profileToSave.work_types : []).map((item) => String(item).trim()).filter(Boolean)));
      payload.append('service_cities', JSON.stringify((Array.isArray(profileToSave.service_cities) ? profileToSave.service_cities : []).map((item) => String(item).trim()).filter(Boolean)));
      payload.append('service_counties', JSON.stringify((Array.isArray(profileToSave.service_counties) ? profileToSave.service_counties : []).map((item) => String(item).trim()).filter(Boolean)));
      payload.append('credentials', JSON.stringify(profileToSave.credentials || {}));
      payload.append('customer_trust_badges', JSON.stringify(Array.isArray(profileToSave.customer_trust_badges) ? profileToSave.customer_trust_badges : []));
      [
        'has_existing_website',
        'show_license_public',
        'show_phone_public',
        'show_email_public',
        'show_reviews',
        'show_gallery',
        'show_quote_cta',
        'allow_public_intake',
        'allow_public_reviews',
        'is_public',
      ].forEach((field) => payload.append(field, profileToSave[field] ? 'true' : 'false'));
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

  function normalizeExistingWebsiteUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }

  async function continueFromWebsiteDecision() {
    if (profile.has_existing_website) {
      const normalizedUrl = normalizeExistingWebsiteUrl(profile.existing_website_url);
      try {
        const parsed = new URL(normalizedUrl);
        if (!parsed.hostname || !parsed.hostname.includes('.')) {
          throw new Error('Invalid website URL');
        }
        setWebsiteDecisionError('');
        const nextProfile = {
          ...profile,
          has_existing_website: true,
          existing_website_url: normalizedUrl,
          website_analysis_status: profile.website_analysis_status || 'not_started',
        };
        setProfile(nextProfile);
        await saveProfile(nextProfile);
        setActiveTab('profile');
      } catch (_err) {
        setWebsiteDecisionError('Enter a valid website address, like https://example.com.');
      }
      return;
    }

    setWebsiteDecisionError('');
    const nextProfile = {
      ...profile,
      has_existing_website: false,
      existing_website_url: '',
      website_analysis_status: profile.website_analysis_status || 'not_started',
    };
    setProfile(nextProfile);
    await saveProfile(nextProfile);
    setActiveTab('profile');
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
      contentClassName="w-full max-w-none"
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
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
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
          navigate('/app/opportunities?source=manual');
          setQuickAddPrefill(null);
        }}
        onClose={() => setQuickAddPrefill(null)}
      />
      <div className="mhb-online-presence-light-theme overflow-hidden rounded-[28px] border border-slate-200 shadow-sm" data-testid="online-presence-setup-shell">
        <header className="border-b border-slate-200 bg-white px-5 py-4 lg:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 data-testid="public-presence-title" className="text-xl font-black text-slate-950">
                Marketing Workspace
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Build your public profile, gallery, reviews, website design, visibility, and publish checklist in one guided flow.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={websiteFullPreviewUrl('desktop')}
                target="_blank"
                rel="noreferrer"
                data-testid="online-presence-preview-website-link"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Preview Website
              </a>
              <button
                type="button"
                onClick={copyUrl}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Copy Public URL
              </button>
              <a
                href={profile.public_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Open Public Profile
              </a>
              <button
                type="button"
                onClick={() => setGenerateProfileOpen(true)}
                className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100"
              >
                Project Assistant
              </button>
            </div>
          </div>
        </header>

        <div className="px-5 py-5 lg:px-6" data-testid="online-presence-setup-nav">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-black text-slate-950">Marketing Setup</div>
            <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm" data-testid="online-presence-readiness-score">
              Readiness {websiteReadinessData.score || 0}%
            </div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {ONLINE_PRESENCE_STEPS.map((step, index) => {
              const isActive = activeTab === step.key;
              const isComplete = completedStepKeys.has(step.key);
              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => goToStep(step.key)}
                  aria-current={isActive ? 'step' : undefined}
                  className={[
                    'flex min-w-[132px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold transition',
                    isActive
                      ? 'border-blue-400 bg-blue-50 text-blue-700 shadow-sm'
                      : isComplete
                      ? 'border-emerald-200 bg-white text-slate-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-slate-950',
                  ].join(' ')}
                >
                  <span className={['flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]', isActive ? 'bg-blue-600 text-white' : isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'].join(' ')}>
                    {isComplete ? '✓' : index}
                  </span>
                  <span className="whitespace-nowrap">{step.label}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${setupProgress}%` }} />
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-black">NEXT STEP</span>
            <span className="ml-2">
              {activeTab === 'decision'
                ? 'Turn on public visibility to start receiving leads from your profile page.'
                : activeTab === 'profile'
                ? 'Add business facts that showcase your work and build customer trust.'
                : activeTab === 'gallery'
                ? 'Collect and display reviews and testimonials from your happy customers.'
                : activeTab === 'reviews'
                ? 'Choose your website style, colors, and content structure.'
                : activeTab === 'website'
                ? 'Optimize your website so customers can find you online.'
                : activeTab === 'seo'
                ? 'Review your online presence and launch when everything looks right.'
                : activeTab === 'final'
                ? 'Publish your website snapshot.'
                : 'Share your live profile, promote your business, and watch leads come in.'}
            </span>
          </div>
        </div>

        <main className="px-5 pb-6 lg:px-6" data-testid="online-presence-step-content">
          {activeTab === 'decision' ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="website-decision-step">
              <div className="text-xs font-bold text-slate-500">Step 0 of 7</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">Let&apos;s start with your website.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                This helps us personalize your experience and provide the best recommendations.
              </p>
              <div className="mt-6 grid gap-5 lg:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    setWebsiteDecisionError('');
                    setProfile((prev) => ({ ...prev, has_existing_website: false, existing_website_url: '' }));
                  }}
                  className={[
                    'min-h-[260px] rounded-xl border bg-white p-6 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                    !profile.has_existing_website ? 'border-blue-600 ring-2 ring-blue-100' : 'border-slate-200',
                  ].join(' ')}
                  data-testid="website-decision-no-website"
                >
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-2xl text-blue-600">▣</div>
                  <div className="mt-5 text-lg font-black text-slate-950">I don&apos;t have a website</div>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-600">
                    We&apos;ll build a beautiful website for you using your business information.
                  </p>
                  <span className="mt-5 inline-flex rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white">Continue</span>
                </button>
                <div
                  className={[
                    'rounded-xl border bg-white p-6 text-center shadow-sm transition',
                    profile.has_existing_website ? 'border-blue-600 ring-2 ring-blue-100' : 'border-slate-200',
                  ].join(' ')}
                  data-testid="website-decision-existing-website"
                >
                  <button type="button" onClick={() => setProfile((prev) => ({ ...prev, has_existing_website: true }))} className="w-full text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-3xl text-slate-400">◎</div>
                    <div className="mt-5 text-lg font-black text-slate-950">I already have a website</div>
                    <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-600">
                      Enter your website and we&apos;ll keep it ready for future analysis and improvements.
                    </p>
                  </button>
                  <label className="mx-auto mt-5 block max-w-sm text-left">
                    <span className="text-sm font-bold text-slate-800">Website URL</span>
                    <input
                      value={profile.existing_website_url || ''}
                      onChange={(event) => {
                        setWebsiteDecisionError('');
                        setProfile((prev) => ({
                          ...prev,
                          has_existing_website: true,
                          existing_website_url: event.target.value,
                          website_analysis_status: prev.website_analysis_status || 'not_started',
                        }));
                      }}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                      placeholder="https://yourcompany.com"
                      data-testid="existing-website-url-input"
                    />
                  </label>
                  {websiteDecisionError ? (
                    <div className="mx-auto mt-2 max-w-sm text-left text-sm font-bold text-rose-700" data-testid="existing-website-url-error">
                      {websiteDecisionError}
                    </div>
                  ) : null}
                  {profile.has_existing_website && profile.existing_website_url ? (
                    <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-left" data-testid="existing-website-coming-soon-card">
                      <div className="font-black text-blue-950">Great!</div>
                      <div className="mt-1 text-xs font-black uppercase tracking-wide text-blue-700">Coming Soon</div>
                      <div className="mt-3 grid gap-2 text-sm text-blue-950 sm:grid-cols-2">
                        {['Analyze your website', 'Improve SEO', 'Improve website copy', 'Suggest a modern redesign', 'Rebuild your website using AI'].map((item) => (
                          <div key={item} className="flex items-center gap-2">
                            <span className="font-black text-blue-700">✓</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === 'profile' ? (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]" data-testid="public-presence-profile-tab">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold text-slate-500">Step 1 of 7</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Business Information</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Add your business details and the services you provide.</p>
                <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  We imported this from your MyHomeBro profile. Review and update anything that has changed.
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Company / business name</span>
                    <input value={profile.business_name_public || ''} onChange={(e) => setProfile((prev) => ({ ...prev, business_name_public: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="C.S.W. Power Solutions" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Primary trade</span>
                    <select value={profile.primary_trade || ''} onChange={(e) => setProfile((prev) => ({ ...prev, primary_trade: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="business-primary-trade-select">
                      <option value="">Select a trade</option>
                      {['Electrical contractor', 'General contractor', 'Kitchen remodeling', 'Bathroom remodeling', 'HVAC', 'Plumbing', 'Roofing', 'Painting', 'Landscaping', profile.primary_trade].filter(Boolean).filter((item, index, arr) => arr.indexOf(item) === index).map((trade) => <option key={trade} value={trade}>{trade}</option>)}
                    </select>
                    <input value={profile.primary_trade || ''} onChange={(e) => setProfile((prev) => ({ ...prev, primary_trade: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Or add a custom trade" data-testid="business-primary-trade-custom" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Owner / contact name</span>
                    <input value={profile.owner_contact_name || ''} onChange={(e) => setProfile((prev) => ({ ...prev, owner_contact_name: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Owner or office contact" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Additional trades/services</span>
                    <input value={workTypesText} onChange={(e) => setProfile((prev) => ({ ...prev, work_types: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Lighting, generator installation" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Business phone</span>
                    <input value={profile.phone_public || ''} onChange={(e) => setProfile((prev) => ({ ...prev, phone_public: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="(210) 504-9796" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Business email</span>
                    <input value={profile.email_public || ''} onChange={(e) => setProfile((prev) => ({ ...prev, email_public: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="hello@example.com" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Years in business</span>
                    <input value={profile.years_in_business || ''} onChange={(e) => setProfile((prev) => ({ ...prev, years_in_business: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="12" />
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm font-bold text-slate-800">Business type</span>
                    <input value={specialtiesText} onChange={(e) => setProfile((prev) => ({ ...prev, specialties: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Residential, commercial" />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-800">
                      <span>Business description</span>
                      <button type="button" onClick={() => requestAiSuggestion('business_description', 'business-description', profile.bio)} disabled={aiBusyTarget === 'business-description'} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 disabled:opacity-60" data-testid="ai-generate-business-description">
                        {aiBusyTarget === 'business-description' ? 'Generating...' : profile.bio ? 'Improve with Project Assistant' : 'Generate Description with Project Assistant'}
                      </button>
                    </span>
                    <textarea value={profile.bio || ''} onChange={(e) => setProfile((prev) => ({ ...prev, bio: e.target.value }))} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="What you do, who you serve, and why customers trust you." data-testid="business-description-input" />
                    <AiSuggestionCard
                      suggestion={aiSuggestions['business-description']}
                      onAccept={() => acceptAiSuggestion('business-description', (value) => setProfile((prev) => ({ ...prev, bio: value })))}
                      onRegenerate={() => requestAiSuggestion('business_description', 'business-description', profile.bio)}
                      onDismiss={() => dismissAiSuggestion('business-description')}
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ['show_phone_public', 'Show phone publicly'],
                    ['show_email_public', 'Show email publicly'],
                    ['show_license_public', 'Show license publicly'],
                    ['allow_public_intake', 'Allow quote requests'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      <input type="checkbox" checked={Boolean(profile[key])} onChange={(e) => setProfile((prev) => ({ ...prev, [key]: e.target.checked }))} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-900">Why customers choose you</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {CUSTOMER_TRUST_BADGES.slice(0, 10).map((badge) => (
                      <button
                        key={badge}
                        type="button"
                        onClick={() => toggleCustomerTrustBadge(badge)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold ${customerTrustBadges.includes(badge) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}
                      >
                        {badge}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-5 flex justify-end">
                  <button type="button" data-testid="public-presence-save-profile" onClick={saveProfile} disabled={profileBusy} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                    {profileBusy ? 'Saving...' : 'Save Business Information'}
                  </button>
                </div>
              </div>
              <aside className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-black text-slate-950">Your Progress</div>
                  <div className="mt-1 text-xs text-slate-500">Step 1 of 7</div>
                  <div className="mt-3 rounded-full bg-blue-600 px-3 py-1.5 text-center text-sm font-black text-white" data-testid="business-info-readiness-score">{stepOneReadiness}% complete</div>
                  <div className="mt-4 space-y-2 text-sm">
                    {ONLINE_PRESENCE_STEPS.map((step, index) => (
                      <div key={step.key} className="flex items-center gap-2 text-slate-700">
                        <span className={`h-3 w-3 rounded-full ${index < activeStepIndex ? 'bg-emerald-500' : index === activeStepIndex ? 'bg-blue-600' : 'bg-slate-200'}`} />
                        <span>{step.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-black text-slate-950">Share your profile/website</div>
                  <div className="mt-2 break-all text-xs text-slate-600">{qrData?.public_url || profile.public_url || '-'}</div>
                  {qrData?.qr_svg ? <img data-testid="public-presence-qr-image" src={qrData.qr_svg} alt="Public profile QR code" className="mt-4 w-full rounded-xl border border-slate-200 bg-white p-4" /> : null}
                </div>
              </aside>
            </section>
          ) : null}

          {activeTab === 'gallery' ? (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]" data-testid="public-presence-gallery-tab">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold text-slate-500">Step 2 of 7</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Photo Gallery</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Add photos that showcase your work and build trust with potential customers.</p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-black text-slate-900">Logo</div>
                    <div className="mt-4 flex min-h-36 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                      {profile.logo_url ? (
                        <img src={profile.logo_url} alt="Logo" className="max-h-28 object-contain" />
                      ) : (
                        <div>
                          <div className="text-lg font-black uppercase tracking-wide text-slate-950">{profile.business_name_public || 'Your Company Name'}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">{profile.primary_trade || 'Contractor'}</div>
                        </div>
                      )}
                    </div>
                    <label className="mt-3 inline-flex cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                      Upload New Logo
                      <input type="file" className="hidden" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
                    </label>
                    <button type="button" onClick={() => requestAiSuggestion('logo_generation', 'logo-generation', profile.business_name_public)} disabled={aiBusyTarget === 'logo-generation'} className="ml-2 mt-3 inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-60" data-testid="ai-generate-logo">
                      Generate Professional Logo
                    </button>
                    <AiSuggestionCard
                      suggestion={aiSuggestions['logo-generation']}
                      onAccept={() => dismissAiSuggestion('logo-generation')}
                      onRegenerate={() => requestAiSuggestion('logo_generation', 'logo-generation', profile.business_name_public)}
                      onDismiss={() => dismissAiSuggestion('logo-generation')}
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-black text-slate-900">Hero Image</div>
                    <div className="mt-4 flex h-36 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                      {profile.hero_image_url || profile.cover_image_url ? <img src={profile.hero_image_url || profile.cover_image_url} alt="Hero" className="h-full w-full object-cover" /> : <span className="text-sm font-bold text-slate-400">Add a strong project photo</span>}
                    </div>
                    <label className="mt-3 inline-flex cursor-pointer rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                      Upload Hero Image
                      <input type="file" className="hidden" onChange={(e) => setHeroFile(e.target.files?.[0] || null)} />
                    </label>
                    <button type="button" onClick={() => requestAiSuggestion('hero_image_generation', 'hero-image-generation', profile.primary_trade)} disabled={aiBusyTarget === 'hero-image-generation'} className="ml-2 mt-3 inline-flex rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-60" data-testid="ai-generate-hero-image">
                      Generate Hero Image
                    </button>
                    <AiSuggestionCard
                      suggestion={aiSuggestions['hero-image-generation']}
                      onAccept={() => dismissAiSuggestion('hero-image-generation')}
                      onRegenerate={() => requestAiSuggestion('hero_image_generation', 'hero-image-generation', profile.primary_trade)}
                      onDismiss={() => dismissAiSuggestion('hero-image-generation')}
                    />
                  </div>
                </div>
                <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-black text-slate-900">Project / Portfolio Photos</div>
                    <div className="flex gap-2">
                      <label className="cursor-pointer rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700">
                        Upload Photos
                        <input type="file" className="hidden" data-testid="gallery-image-input" onChange={(e) => setGalleryImage(e.target.files?.[0] || null)} />
                      </label>
                      <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Manage Order</button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {galleryRows.length ? galleryRows.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        {item.image_url ? <img src={item.image_url} alt={item.title || 'Gallery item'} className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center bg-slate-100 text-xs font-bold text-slate-400">{item.title || 'Project photo'}</div>}
                        <div className="p-2 text-xs font-bold text-slate-700">{item.title || 'Untitled project'}</div>
                      </div>
                    )) : (
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500 sm:col-span-2 lg:col-span-5">Upload your best project photos to start the gallery.</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <input value={galleryForm.title} onChange={(e) => setGalleryForm((prev) => ({ ...prev, title: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Photo title" data-testid="gallery-title-input" />
                    <button type="button" onClick={() => requestAiSuggestion('photo_title', 'photo-title', galleryForm.title)} className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-photo-title">Improve title with Project Assistant</button>
                    <AiSuggestionCard suggestion={aiSuggestions['photo-title']} onAccept={() => acceptAiSuggestion('photo-title', (value) => setGalleryForm((prev) => ({ ...prev, title: value })))} onRegenerate={() => requestAiSuggestion('photo_title', 'photo-title', galleryForm.title)} onDismiss={() => dismissAiSuggestion('photo-title')} />
                  </div>
                  <div>
                    <input value={galleryForm.category} onChange={(e) => setGalleryForm((prev) => ({ ...prev, category: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Category" data-testid="gallery-category-input" />
                    <button type="button" onClick={() => requestAiSuggestion('photo_category', 'photo-category', galleryForm.category)} className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-photo-category">Suggest category with Project Assistant</button>
                    <AiSuggestionCard suggestion={aiSuggestions['photo-category']} onAccept={() => acceptAiSuggestion('photo-category', (value) => setGalleryForm((prev) => ({ ...prev, category: value })))} onRegenerate={() => requestAiSuggestion('photo_category', 'photo-category', galleryForm.category)} onDismiss={() => dismissAiSuggestion('photo-category')} />
                  </div>
                  <div className="md:col-span-2">
                    <textarea value={galleryForm.description} onChange={(e) => setGalleryForm((prev) => ({ ...prev, description: e.target.value }))} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Caption" data-testid="gallery-caption-input" />
                    <button type="button" onClick={() => requestAiSuggestion('photo_caption', 'photo-caption', galleryForm.description)} className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-photo-caption">Improve caption with Project Assistant</button>
                    <AiSuggestionCard suggestion={aiSuggestions['photo-caption']} onAccept={() => acceptAiSuggestion('photo-caption', (value) => setGalleryForm((prev) => ({ ...prev, description: value })))} onRegenerate={() => requestAiSuggestion('photo_caption', 'photo-caption', galleryForm.description)} onDismiss={() => dismissAiSuggestion('photo-caption')} />
                  </div>
                </div>
                <button type="button" onClick={addGalleryItem} disabled={galleryBusy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
                  {galleryBusy ? 'Saving...' : 'Add Gallery Item'}
                </button>
              </div>
              <aside className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-black text-slate-950">Your Progress</div>
                  <div className="mt-1 text-xs text-slate-500">Step 2 of 7</div>
                  <div className="mt-4 space-y-2 text-sm">{ONLINE_PRESENCE_STEPS.map((step, index) => <div key={step.key} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${index < activeStepIndex ? 'bg-emerald-500' : index === activeStepIndex ? 'bg-blue-600' : 'bg-slate-200'}`} />{step.label}</div>)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-black text-slate-950">Tips for best results</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {['Use high quality, well-lit photos', 'Show before & after photos', 'Add captions to tell your story', 'Feature your best work'].map((tip) => <div key={tip} className="flex gap-2"><span className="text-emerald-600">✓</span>{tip}</div>)}
                  </div>
                </div>
              </aside>
            </section>
          ) : null}

          {activeTab === 'reviews' ? (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]" data-testid="public-presence-reviews-tab">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold text-slate-500">Step 3 of 7</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Reviews &amp; Testimonials</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Collect and display reviews from happy customers and choose which content to include.</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" onClick={copyUrl} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Share Review Request Link</button>
                  <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Add Testimonial Manually</button>
                  <button
                    type="button"
                    onClick={() => requestAiSuggestion('review_summary', 'review-summary', reviewsRows.map((review) => review.review_text || review.public_comment || '').join('\n'))}
                    disabled={!reviewsRows.filter((review) => review.is_public).length || aiBusyTarget === 'review-summary'}
                    className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50"
                    data-testid="ai-review-summary"
                  >
                    Generate Trust Summary with Project Assistant
                  </button>
                </div>
                {!reviewsRows.length ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="ai-review-summary-empty">Add or request reviews first to generate a trust summary.</div> : null}
                <AiSuggestionCard
                  suggestion={aiSuggestions['review-summary']}
                  onAccept={() => dismissAiSuggestion('review-summary')}
                  onRegenerate={() => requestAiSuggestion('review_summary', 'review-summary', reviewsRows.map((review) => review.review_text || review.public_comment || '').join('\n'))}
                  onDismiss={() => dismissAiSuggestion('review-summary')}
                />
                <div className="mt-5 space-y-3">
                  {reviewsRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">No reviews have been submitted yet. Share your profile link to start collecting customer feedback.</div>
                  ) : reviewsRows.map((review) => (
                    <div key={review.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{review.customer_name || review.reviewer_name || 'Customer'}</div>
                          <div className="mt-1 text-sm text-amber-500">{'★'.repeat(Number(review.rating || 5))}</div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${review.is_public ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{review.is_public ? 'Public' : 'Pending moderation'}</span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{review.review_text || review.public_comment}</p>
                      <button type="button" onClick={() => toggleReviewVisibility(review)} disabled={reviewBusy} className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-60">{review.is_public ? 'Hide Review' : 'Publish Review'}</button>
                    </div>
                  ))}
                </div>
              </div>
              <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-black text-slate-950">Your Progress</div>
                <div className="mt-1 text-xs text-slate-500">Step 3 of 7</div>
                <div className="mt-4 space-y-2 text-sm">{ONLINE_PRESENCE_STEPS.map((step, index) => <div key={step.key} className="flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${index < activeStepIndex ? 'bg-emerald-500' : index === activeStepIndex ? 'bg-blue-600' : 'bg-slate-200'}`} />{step.label}</div>)}</div>
              </aside>
            </section>
          ) : null}

          {activeTab === 'website' ? (
            <section className="space-y-5" data-testid="marketing-website-builder-tab">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="website-builder-design-tab">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-500">Step 4 of 7</div>
                    <h2 className="mt-2 text-2xl font-black text-slate-950">Design &amp; Content</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">Choose how your website will look and what content it includes.</p>
                  </div>
                  <a
                    href={websiteFullPreviewUrl('desktop')}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="website-builder-preview-button"
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
                  >
                    Preview Website
                  </a>
                </div>
                {!canCustomizeWebsite ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{websiteBuilderGate.reason || 'Upgrade to customize website design.'}</div> : null}
                {websiteDevelopmentOverrideActive ? <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-800">Developer Override Active</div> : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => requestAiSuggestion('design_recommendation', 'design-recommendation', websiteData.template_key || 'starter')} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700" data-testid="ai-design-recommendation">Recommend design style</button>
                  <button type="button" onClick={() => requestAiSuggestion('about_section', 'about-section', heroContent.subheadline || profile.bio)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700" data-testid="ai-about-section">Generate About section</button>
                  <button type="button" onClick={() => requestAiSuggestion('service_description', 'service-description', serviceKeywords.join(', '))} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700" data-testid="ai-service-description">Generate service descriptions</button>
                  <button type="button" onClick={() => requestAiSuggestion('faq_generation', 'faq-generation', '')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600" data-testid="ai-faq-generation">FAQ generation coming soon</button>
                </div>
                <AiSuggestionCard suggestion={aiSuggestions['design-recommendation']} onAccept={() => dismissAiSuggestion('design-recommendation')} onRegenerate={() => requestAiSuggestion('design_recommendation', 'design-recommendation', websiteData.template_key || 'starter')} onDismiss={() => dismissAiSuggestion('design-recommendation')} />
                <AiSuggestionCard suggestion={aiSuggestions['about-section']} onAccept={() => acceptAiSuggestion('about-section', (value) => updateHomePageHero({ subheadline: value }))} onRegenerate={() => requestAiSuggestion('about_section', 'about-section', heroContent.subheadline || profile.bio)} onDismiss={() => dismissAiSuggestion('about-section')} />
                <AiSuggestionCard suggestion={aiSuggestions['service-description']} onAccept={() => dismissAiSuggestion('service-description')} onRegenerate={() => requestAiSuggestion('service_description', 'service-description', serviceKeywords.join(', '))} onDismiss={() => dismissAiSuggestion('service-description')} />
                <AiSuggestionCard suggestion={aiSuggestions['faq-generation']} onAccept={() => dismissAiSuggestion('faq-generation')} onRegenerate={() => requestAiSuggestion('faq_generation', 'faq-generation', '')} onDismiss={() => dismissAiSuggestion('faq-generation')} />
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {DESIGN_STYLE_OPTIONS.map((template) => (
                    <button key={template.key} type="button" disabled={!canCustomizeWebsite || websiteBusy} onClick={() => saveWebsiteSettings({ template_key: template.key })} className={`relative rounded-xl border p-4 text-left transition disabled:opacity-60 ${(websiteData.template_key || 'starter') === template.key ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-200'}`}>
                      {(websiteData.template_key || 'starter') === template.key ? <span className="absolute right-3 top-3 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">✓</span> : null}
                      <div className="text-sm font-black text-slate-950">{template.label}</div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{template.description}</p>
                    </button>
                  ))}
                </div>
                <div className="mt-6 grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-black text-slate-900">Brand Colors</div>
                    <label className="mt-4 block text-xs font-bold text-slate-700">Primary Color<input type="color" disabled={!canCustomizeWebsite || websiteBusy} value={websiteLayout.branding?.primary_color || websiteProfile?.branding?.primary_color || profile.brand_primary_color || '#2563eb'} onChange={(event) => updateWebsiteLayout({ branding: { primary_color: event.target.value } })} className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white p-1" data-testid="website-builder-primary-color" /></label>
                    <label className="mt-4 block text-xs font-bold text-slate-700">Secondary Color<input type="color" disabled={!canCustomizeWebsite || websiteBusy} value={websiteLayout.branding?.accent_color || websiteProfile?.branding?.accent_color || profile.brand_accent_color || '#facc15'} onChange={(event) => updateWebsiteLayout({ branding: { accent_color: event.target.value } })} className="mt-2 h-10 w-full rounded-lg border border-slate-300 bg-white p-1" data-testid="website-builder-accent-color" /></label>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-sm font-black text-slate-900">Website Content</div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="space-y-1 md:col-span-2"><span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700"><span>Headline</span><button type="button" onClick={() => requestAiSuggestion('hero_headline', 'hero-headline', heroContent.headline || '')} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-hero-headline">Improve with Project Assistant</button></span><input disabled={!canCustomizeWebsite || websiteBusy} value={heroContent.headline || ''} onChange={(e) => updateHomePageHero({ headline: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="website-builder-hero-headline" /><AiSuggestionCard suggestion={aiSuggestions['hero-headline']} onAccept={() => acceptAiSuggestion('hero-headline', (value) => updateHomePageHero({ headline: value }))} onRegenerate={() => requestAiSuggestion('hero_headline', 'hero-headline', heroContent.headline || '')} onDismiss={() => dismissAiSuggestion('hero-headline')} /></label>
                      <label className="space-y-1 md:col-span-2"><span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700"><span>Subheadline</span><button type="button" onClick={() => requestAiSuggestion('hero_subheadline', 'hero-subheadline', heroContent.subheadline || '')} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-hero-subheadline">Improve with Project Assistant</button></span><textarea disabled={!canCustomizeWebsite || websiteBusy} value={heroContent.subheadline || ''} onChange={(e) => updateHomePageHero({ subheadline: e.target.value })} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="website-builder-hero-subheadline" /><AiSuggestionCard suggestion={aiSuggestions['hero-subheadline']} onAccept={() => acceptAiSuggestion('hero-subheadline', (value) => updateHomePageHero({ subheadline: value }))} onRegenerate={() => requestAiSuggestion('hero_subheadline', 'hero-subheadline', heroContent.subheadline || '')} onDismiss={() => dismissAiSuggestion('hero-subheadline')} /></label>
                      <label className="space-y-1"><span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700"><span>CTA text</span><button type="button" onClick={() => requestAiSuggestion('cta_text', 'cta-text', heroContent.cta_text || '')} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-cta-text">AI</button></span><input disabled={!canCustomizeWebsite || websiteBusy} value={heroContent.cta_text || ''} onChange={(e) => updateHomePageHero({ cta_text: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="website-builder-cta-text" /><AiSuggestionCard suggestion={aiSuggestions['cta-text']} onAccept={() => acceptAiSuggestion('cta-text', (value) => updateHomePageHero({ cta_text: value }))} onRegenerate={() => requestAiSuggestion('cta_text', 'cta-text', heroContent.cta_text || '')} onDismiss={() => dismissAiSuggestion('cta-text')} /></label>
                      <label className="space-y-1"><span className="text-sm font-bold text-slate-700">Font theme</span><select disabled={!canCustomizeWebsite || websiteBusy} value={websiteLayout.branding?.font_theme || websiteProfile?.branding?.font_theme || 'modern'} onChange={(event) => updateWebsiteLayout({ branding: { font_theme: event.target.value } })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="website-builder-font-theme">{FONT_THEME_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    </div>
                    <button type="button" disabled={!canCustomizeWebsite || websiteBusy || !homePage} onClick={saveHomePageHero} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60" data-testid="website-builder-save-page">{websiteBusy ? 'Saving...' : 'Save Content'}</button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {activeTab === 'seo' ? (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]" data-testid="online-presence-seo-tab">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold text-slate-500">Step 5 of 7</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">SEO &amp; Visibility</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Optimize your profile so customers can find you online.</p>
                <div className="mt-5 grid gap-4">
                  <label className="space-y-1"><span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-800"><span>Page Title</span><button type="button" onClick={() => requestAiSuggestion('seo_title', 'seo-title', profile.seo_title || '')} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-seo-title">AI</button></span><input value={profile.seo_title || ''} onChange={(e) => setProfile((prev) => ({ ...prev, seo_title: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="seo-title-input" /><AiSuggestionCard suggestion={aiSuggestions['seo-title']} onAccept={() => acceptAiSuggestion('seo-title', (value) => setProfile((prev) => ({ ...prev, seo_title: value })))} onRegenerate={() => requestAiSuggestion('seo_title', 'seo-title', profile.seo_title || '')} onDismiss={() => dismissAiSuggestion('seo-title')} /></label>
                  <label className="space-y-1"><span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-800"><span>Meta Description</span><button type="button" onClick={() => requestAiSuggestion('seo_description', 'seo-description', profile.seo_description || '')} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-seo-description">AI</button></span><textarea value={profile.seo_description || ''} onChange={(e) => setProfile((prev) => ({ ...prev, seo_description: e.target.value }))} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="seo-description-input" /><AiSuggestionCard suggestion={aiSuggestions['seo-description']} onAccept={() => acceptAiSuggestion('seo-description', (value) => setProfile((prev) => ({ ...prev, seo_description: value })))} onRegenerate={() => requestAiSuggestion('seo_description', 'seo-description', profile.seo_description || '')} onDismiss={() => dismissAiSuggestion('seo-description')} /></label>
                  <label className="space-y-1"><span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-800"><span>Keywords</span><button type="button" onClick={() => requestAiSuggestion('seo_keywords', 'seo-keywords', serviceKeywords.join(', '))} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700" data-testid="ai-seo-keywords">AI</button></span><input value={serviceKeywords.join(', ')} onChange={(e) => setProfile((prev) => ({ ...prev, specialties: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" data-testid="seo-keywords-input" /><AiSuggestionCard suggestion={aiSuggestions['seo-keywords']} onAccept={() => acceptAiSuggestion('seo-keywords', (value) => setProfile((prev) => ({ ...prev, specialties: value.split(',').map((item) => item.trim()).filter(Boolean) })))} onRegenerate={() => requestAiSuggestion('seo_keywords', 'seo-keywords', serviceKeywords.join(', '))} onDismiss={() => dismissAiSuggestion('seo-keywords')} /></label>
                  <button type="button" onClick={() => requestAiSuggestion('local_business_schema', 'local-business-schema', '')} className="w-fit rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600" data-testid="ai-local-business-schema">Local business schema coming soon</button>
                  <AiSuggestionCard suggestion={aiSuggestions['local-business-schema']} onAccept={() => dismissAiSuggestion('local-business-schema')} onRegenerate={() => requestAiSuggestion('local_business_schema', 'local-business-schema', '')} onDismiss={() => dismissAiSuggestion('local-business-schema')} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ['allow_public_intake', 'Show in Opportunities', 'Display your profile in customer contractor searches and lead workflows.'],
                    ['is_public', 'Public profile status', 'Controls whether customers can view your public business profile.'],
                    ['show_quote_cta', 'Allow QR/link sharing', 'Anyone with your QR code or shared link can open your public profile or website.'],
                    ['show_reviews', 'Show reviews publicly', 'Display approved reviews on your public profile and website.'],
                  ].map(([key, label, hint]) => (
                    <label key={key} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
                      <span><span>{label}</span><span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{hint}</span></span>
                      <input type="checkbox" checked={Boolean(profile[key])} onChange={(e) => setProfile((prev) => ({ ...prev, [key]: e.target.checked }))} />
                    </label>
                  ))}
                </div>
                <button type="button" onClick={saveProfile} disabled={profileBusy} className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{profileBusy ? 'Saving...' : 'Save SEO & Visibility'}</button>
              </div>
              <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-black text-slate-950">Public Profile Status</div>
                <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${profile.is_public ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{profile.is_public ? 'Ready to Publish' : 'Preview mode'}</div>
              </aside>
            </section>
          ) : null}

          {activeTab === 'final' ? (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="online-presence-final-review-tab">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-bold text-slate-500">Step 6 of 7</div>
                <h2 className="mt-2 text-2xl font-black text-slate-950">Final Review</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Review your online presence before publishing.</p>
                <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm" data-testid="website-preview-summary-card">
                  <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="min-h-[220px] bg-slate-100">
                      {websiteHeroImage ? (
                        <img src={websiteHeroImage} alt="" className="h-full min-h-[220px] w-full object-cover" />
                      ) : (
                        <div className="flex h-full min-h-[220px] items-center justify-center bg-gradient-to-br from-blue-600 via-slate-900 to-emerald-500 p-8 text-center text-white">
                          <div>
                            <div className="text-3xl font-black">{websiteBusinessName}</div>
                            <div className="mt-3 text-sm font-semibold text-white/80">Preview thumbnail will use your hero or portfolio photo once available.</div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="bg-white p-5">
                      <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Website summary</div>
                      <h3 className="mt-2 text-xl font-black text-slate-950">{websiteBusinessName}</h3>
                      <div className="mt-4 grid gap-3 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="font-bold text-slate-600">Selected design</span>
                          <span className="font-black text-slate-950">{selectedDesignLabel}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="font-bold text-slate-600">Readiness score</span>
                          <span className="font-black text-blue-700">{websiteReadinessData.score || 0}%</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="font-bold text-slate-600">Website status</span>
                          <span className="font-black capitalize text-slate-950">{websiteData.status || 'draft'}</span>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <a href={websiteFullPreviewUrl('desktop')} target="_blank" rel="noreferrer" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white" data-testid="final-preview-desktop">Preview Desktop</a>
                        <a href={websiteFullPreviewUrl('mobile')} target="_blank" rel="noreferrer" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700" data-testid="final-preview-mobile">Preview Mobile</a>
                        <a href={websiteFullPreviewUrl('desktop')} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700" data-testid="final-open-full-preview">Open Full Preview</a>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black text-slate-900">Business Information</div><p className="mt-2 text-sm text-slate-600">{profile.business_name_public || 'Business name missing'} - {profile.primary_trade || 'Primary trade missing'}</p></div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black text-slate-900">Photos</div><p className="mt-2 text-sm text-slate-600">{galleryRows.length} gallery item{galleryRows.length === 1 ? '' : 's'} ready.</p></div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black text-slate-900">Reviews</div><p className="mt-2 text-sm text-slate-600">{reviewsRows.filter((review) => review.is_public).length} public review{reviewsRows.filter((review) => review.is_public).length === 1 ? '' : 's'}.</p></div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-black text-slate-900">SEO & Visibility</div><p className="mt-2 text-sm text-slate-600">{profile.seo_title || profile.business_name_public || 'SEO title will use your business name.'}</p></div>
                </div>
              </div>
              <aside className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="ai-website-audit-card">
                  <div className="text-sm font-black text-slate-950">AI Website Audit</div>
                  <div className="mt-2 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-black text-blue-700">Website score {websiteReadinessData.score || 0}%</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    {[
                      'Improve hero',
                      galleryRows.length < 3 ? 'Add more photos' : 'Photos look strong',
                      profile.seo_description ? 'SEO basics ready' : 'Improve SEO',
                      reviewsRows.filter((review) => review.is_public).length ? 'Reviews added' : 'Add reviews',
                      heroContent.cta_text ? 'CTA ready' : 'Strengthen CTA',
                    ].map((item) => <div key={item} className="flex gap-2"><span className="text-blue-600">•</span>{item}</div>)}
                  </div>
                  <button type="button" onClick={() => requestAiSuggestion('final_website_audit', 'final-website-audit', '')} className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700" data-testid="ai-final-review-suggestions">Review Suggestions</button>
                  <button type="button" onClick={() => goToStep('publish')} className="ml-2 mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Publish Anyway</button>
                  <AiSuggestionCard suggestion={aiSuggestions['final-website-audit']} onAccept={() => dismissAiSuggestion('final-website-audit')} onRegenerate={() => requestAiSuggestion('final_website_audit', 'final-website-audit', '')} onDismiss={() => dismissAiSuggestion('final-website-audit')} />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-black text-slate-950">Publish Checklist</div>
                <div className="mt-3 space-y-2 text-sm">{(websitePublishBlockers.length ? websitePublishBlockers : ['Business information complete', 'Photos can be added later', 'At least one review added', 'SEO settings optimized']).map((item) => <div key={item} className="flex gap-2 text-slate-700"><span className={websitePublishBlockers.length ? 'text-amber-600' : 'text-emerald-600'}>{websitePublishBlockers.length ? '!' : '✓'}</span>{item}</div>)}</div>
                </div>
              </aside>
            </section>
          ) : null}

          {activeTab === 'publish' ? (
            <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="online-presence-publish-tab">
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                {websiteData.status === 'published' ? <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500 text-4xl font-black text-white">✓</div> : <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-blue-100 text-3xl font-black text-blue-700">7</div>}
                <h2 className="mt-5 text-3xl font-black text-slate-950">{websiteData.status === 'published' ? "You're Live!" : 'Ready to Publish'}</h2>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{websiteData.status === 'published' ? 'Your online presence has been published successfully.' : 'Publish your website snapshot when you are ready to make it live.'}</p>
                <div className="mx-auto mt-5 max-w-xl rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 break-all">{websiteData.public_url || profile.public_url || '/websites/your-slug'}</div>
                {websitePublishMessage ? <div className="mx-auto mt-4 max-w-xl rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">{websitePublishMessage}</div> : null}
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <button type="button" disabled={!canPublishWebsite || websiteBusy} onClick={publishWebsite} data-testid="website-builder-publish-button" className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-600">{websiteBusy ? 'Publishing...' : 'Publish Website'}</button>
                  <a href={websiteData.public_url || profile.public_url || '#'} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700">View Your Website</a>
                  <button type="button" onClick={() => goToStep('decision')} className="rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700">Back to Marketing</button>
                </div>
              </div>
              <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-sm font-black text-slate-950">What&apos;s Next?</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">Share your profile, promote your business, and watch leads come in.</p>
                <button type="button" onClick={copyUrl} className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700">Share Your Profile</button>
              </aside>
            </section>
          ) : null}

          <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
            <button type="button" onClick={goToPreviousStep} disabled={activeStepIndex === 0} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-40">Back</button>
            {activeTab === 'publish' ? (
              <button type="button" disabled={!canPublishWebsite || websiteBusy} onClick={publishWebsite} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300">{websiteBusy ? 'Publishing...' : 'Publish'}</button>
            ) : (
              <button type="button" onClick={goToNextStep} data-testid={activeTab === 'decision' ? 'website-decision-continue' : undefined} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white">Continue</button>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900" data-testid="online-presence-leads-handoff">
            Leads from your profile, QR code, and website appear in Opportunities.
            <a href="/app/opportunities?source=website" className="ml-2 font-bold underline">View website leads in Opportunities</a>
          </div>
        </main>
      </div>

      </div>
    </ContractorPageSurface>
  );
}
