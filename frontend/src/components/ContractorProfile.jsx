// src/components/ContractorProfile.jsx
// Business Profile + Account & Login with mini sidebar.
// AI is included in the base experience.

import React, { useEffect, useMemo, useState } from "react";
import api from "../api";
import AccountSettings from "./AccountSettings";
import AddressAutocomplete from "./AddressAutocomplete.jsx";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","PR"
];

const SKILL_OPTIONS = [
  "Masonry","Roofing","Windows","Drywall","Tile","Plumbing","Electrical",
  "Painting","Landscaping","Flooring","HVAC","Carpentry","Concrete","Siding","Insulation",
];
const SERVICE_RADIUS_OPTIONS = [10, 25, 50, 100];

function isAiProActive() {
  return true;
}

function planLabel() {
  return "Included";
}

function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function titleize(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safeDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeIntroCountdownDays(meData) {
  // Use the same best-effort fields as your dashboard
  const createdRaw =
    meData?.created_at ||
    meData?.contractor_created_at ||
    meData?.contractor?.created_at ||
    meData?.user_created_at ||
    meData?.user?.date_joined ||
    null;

  const created = safeDate(createdRaw);
  if (!created) return { introActive: false, introDaysRemaining: null };

  const INTRO_DAYS = 60;
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysActive = Math.floor((now.getTime() - created.getTime()) / msPerDay);
  const remaining = INTRO_DAYS - daysActive;

  return {
    introActive: remaining > 0,
    introDaysRemaining: Math.max(0, remaining),
  };
}

function getAiStatusFromMe(meData) {
  const ai = meData?.ai || {};
  return {
    access: ai.access || "included",
    enabled: ai.enabled !== false,
    unlimited: ai.unlimited !== false,
  };
}

function formatComplianceLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatComplianceDate(value) {
  if (!value) return "No expiration date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString();
}

export default function ContractorProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [meData, setMeData] = useState(null);

  // Google autocomplete search/display ONLY (helper)
  const [businessAddrSearch, setBusinessAddrSearch] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    business_name: "",
    phone: "",
    address: "", // persisted street line1
    city: "",
    state: "",
    zip: "",
    service_radius_miles: 25,
    license_number: "",
    license_expiration_date: "",
    skills: [],
  });

  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  // License & insurance upload state
  const [licenseFile, setLicenseFile] = useState(null);
  const [licenseUrl, setLicenseUrl] = useState(null);
  const [insuranceFile, setInsuranceFile] = useState(null);
  const [insuranceUrl, setInsuranceUrl] = useState(null);

  // Mini sidebar active tab
  const [activeTab, setActiveTab] = useState("business"); // 'business' | 'billing' | 'account'
  const [complianceTradeRequirements, setComplianceTradeRequirements] = useState([]);
  const [complianceRecords, setComplianceRecords] = useState([]);
  const [insuranceStatus, setInsuranceStatus] = useState({
    has_insurance: false,
    status: "missing",
  });
  const [compliancePreviewLoading, setCompliancePreviewLoading] = useState(false);
  const [compliancePreviewError, setCompliancePreviewError] = useState("");

  const stateOptions = useMemo(
    () => US_STATES.map((s) => ({ value: s, label: s })),
    []
  );

  const refreshMe = async () => {
    const me = await api.get("/projects/contractors/me/");
    const data = me?.data || {};
    setMeData(data);
    setComplianceTradeRequirements(
      Array.isArray(data.compliance_trade_requirements) ? data.compliance_trade_requirements : []
    );
    setComplianceRecords(Array.isArray(data.compliance_records) ? data.compliance_records : []);
    setInsuranceStatus(data.insurance_status || { has_insurance: false, status: "missing" });
    return data;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const data = await refreshMe();

        const addrLine1 = (data.address || data.address_line1 || "").toString();

        setForm({
          full_name: data.full_name || data.name || "",
          email: data.email || (data.user && data.user.email) || "",
          business_name: data.business_name || "",
          phone: data.phone || "",
          address: addrLine1,
          city: data.city || "",
          state: data.state || "",
          zip: data.zip || "",
          service_radius_miles: Number(data.service_radius_miles || 25),
          license_number: data.license_number || "",
          license_expiration_date:
            (data.license_expiration_date || data.license_expiration || "").slice(0, 10),
          skills: Array.isArray(data.skills)
            ? data.skills
                .map((s) => (typeof s === "string" ? s : (s.name || s.title || "")))
                .filter(Boolean)
            : typeof data.skills === "string"
            ? data.skills.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        });

        // Search helper can start empty; persisted address is shown in Street Address input.
        setBusinessAddrSearch("");

        setLogoPreview(data.logo || data.logo_url || null);

        // file URLs from backend
        setLicenseUrl(data.license_file || data.license_document || null);
        setInsuranceUrl(data.insurance_file || data.insurance_document || null);
      } catch (e) {
        setError("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab !== "business") return undefined;

    const state = String(form.state || "").trim().toUpperCase();
    const skills = Array.isArray(form.skills) ? form.skills : [];
    if (!state || !skills.length) {
      setCompliancePreviewError("");
      setCompliancePreviewLoading(false);
      return undefined;
    }

    let active = true;
    const timer = setTimeout(async () => {
      try {
        setCompliancePreviewLoading(true);
        setCompliancePreviewError("");
        const { data } = await api.post("/projects/compliance/profile-preview/", {
          state,
          skills,
        });
        if (!active) return;
        setComplianceTradeRequirements(
          Array.isArray(data?.trade_requirements) ? data.trade_requirements : []
        );
      } catch (err) {
        if (!active) return;
        setCompliancePreviewError("Unable to refresh compliance requirements right now.");
      } finally {
        if (active) setCompliancePreviewLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeTab, form.state, form.skills]);

  const onChange = (key) => (e) => {
    const val = e?.target?.value ?? e;
    setForm((f) => ({ ...f, [key]: val }));
  };

  const toggleSkill = (name) => {
    setForm((f) => {
      const has = f.skills.includes(name);
      const next = has ? f.skills.filter((s) => s !== name) : [...f.skills, name];
      return { ...f, skills: next };
    });
  };

  const onLogo = (e) => {
    const file = e.target.files?.[0] || null;
    setLogoFile(file);
    if (file) setLogoPreview(URL.createObjectURL(file));
  };

  const onLicense = (e) => {
    const file = e.target.files?.[0] || null;
    setLicenseFile(file);
    if (file) setLicenseUrl(null);
  };

  const onInsurance = (e) => {
    const file = e.target.files?.[0] || null;
    setInsuranceFile(file);
    if (file) setInsuranceUrl(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      // ✅ Require business address (needed for matching + payments + documents)
      const missingAddress =
        !(form.address || "").trim() ||
        !(form.city || "").trim() ||
        !(form.state || "").trim() ||
        !(form.zip || "").trim();

      if (missingAddress) {
        setSaving(false);
        return setError("Business address is required (Street, City, State, Zip).");
      }

      const fd = new FormData();

      // Linked user
      fd.append("email", (form.email || "").trim());
      if (form.full_name) fd.append("full_name", form.full_name);

      // Contractor
      fd.append("business_name", form.business_name || "");
      fd.append("phone", form.phone || "");
      fd.append("address", form.address || "");
      fd.append("city", form.city || "");
      fd.append("state", form.state || "");

      // ✅ ZIP: backend field is literally "zip"
      fd.append("zip", (form.zip || "").trim());
      fd.append("service_radius_miles", String(form.service_radius_miles || 25));

      fd.append("license_number", form.license_number || "");
      if (form.license_expiration_date) {
        fd.append("license_expiration_date", form.license_expiration_date);
      }

      form.skills.forEach((s) => fd.append("skills", s));
      fd.append("skills_json", JSON.stringify(form.skills));

      if (logoFile) fd.append("logo", logoFile);
      if (licenseFile) fd.append("license_file", licenseFile);
      if (insuranceFile) fd.append("insurance_file", insuranceFile);

      await api.patch("/projects/contractors/me/", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setSuccess("Profile saved.");

      try {
        await refreshMe();
      } catch {
        // ignore
      }
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.response?.statusText ||
        err?.message ||
        "Save failed.";
      setError(`Failed to save profile: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const renderBilling = () => {
    const pricing = meData?.pricing_summary || {};
    const fallbackIntro = computeIntroCountdownDays(meData);
    const introActive = pricing.intro_active ?? fallbackIntro.introActive;
    const introDaysRemaining = pricing.intro_days_remaining ?? fallbackIntro.introDaysRemaining;
    const introDaysText =
      introDaysRemaining != null
        ? `${introDaysRemaining} day${introDaysRemaining === 1 ? "" : "s"} remaining`
        : null;
    const currentRateLabel = pricing.current_rate_label || null;
    const tierType = titleize(pricing.tier_type || pricing.tier_name || "");
    const feeCapLabel = pricing.fee_cap_label || "$750 per agreement";
    const introStatusLabel =
      pricing.intro_status_label || (introActive ? "Intro pricing active" : "Intro period ended");
    const monthlyVolumeLabel = pricing.monthly_volume_label || fmtMoney(pricing.monthly_volume);
    const volumeDiscountLabel = pricing.volume_discount_label || "";
    const volumeProgressPct = Number(pricing.volume_progress_pct);
    const volumeDiscountActive = pricing.volume_discount_active === true;

    const aiStatus = getAiStatusFromMe(meData);

    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="contractor-pricing-summary">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Current Platform Rate</div>
              <div className="mt-1 text-xs text-slate-600">
                Your current pricing snapshot comes from the backend fee engine.
              </div>
            </div>
            <button
              type="button"
              onClick={refreshMe}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              title="Refresh pricing snapshot"
            >
              Refresh Pricing
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Current rate</div>
            <div className="mt-1 text-3xl font-semibold text-slate-900">
              {currentRateLabel || "Pricing data unavailable"}
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Tier type: <span className="font-semibold text-slate-900">{tierType || "Unknown"}</span>
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Fee cap: <span className="font-semibold text-slate-900">{feeCapLabel}</span>
            </div>
            <div className="mt-2 text-sm text-slate-600">
              {introStatusLabel}
              {introActive && introDaysText ? ` - ${introDaysText}` : ""}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Tier Type</div>
              <div className="text-sm font-semibold text-slate-900">{tierType || "Unknown"}</div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Fee Cap</div>
              <div className="text-sm font-semibold text-slate-900">{feeCapLabel}</div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Intro Status</div>
              <div className="text-sm font-semibold text-slate-900">{introStatusLabel}</div>
              {introActive && introDaysText ? (
                <div className="mt-1 text-xs text-slate-600">{introDaysText}</div>
              ) : null}
            </div>
          </div>

          {monthlyVolumeLabel ? (
            <div className="mt-4 rounded border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="font-medium text-slate-900">
                  This month&apos;s processed volume: {monthlyVolumeLabel}
                </div>
                <div className="text-xs font-medium text-slate-500">
                  {volumeDiscountLabel || "Volume data from backend"}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${volumeDiscountActive ? "bg-emerald-600" : "bg-slate-900"}`}
                  style={{
                    width: `${Math.max(0, Math.min(100, Number.isFinite(volumeProgressPct) ? volumeProgressPct : 0))}%`,
                  }}
                />
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {volumeDiscountActive
                  ? "Volume discount active for this month."
                  : volumeDiscountLabel || "Volume discount information unavailable."}
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">AI Availability</div>
              <div className="mt-1 text-xs text-slate-600">
                Current AI access status for this account.
              </div>
            </div>
            <button
              type="button"
              onClick={refreshMe}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              title="Refresh AI status"
            >
              Refresh
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Availability</div>
              <div className="text-sm font-semibold text-slate-900">
                {aiStatus.unlimited ? "Included" : "Available"}
              </div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Access</div>
              <div className="text-sm font-semibold text-slate-900">
                {String(aiStatus.access || "included").toUpperCase()}
              </div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Status</div>
              <div className="text-sm font-semibold text-slate-900">
                {aiStatus.enabled ? "Enabled" : "Unavailable"}
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-600">
            Status only. Billing and fee details are listed below.
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Billing &amp; Fees</div>

          <div className="mt-4 space-y-4 text-sm text-slate-700">
            <div>
              <div className="font-semibold text-slate-900">AI Access</div>
              <div className="mt-1">All AI tools are included with your account.</div>
            </div>

            <div>
              <div className="font-semibold text-slate-900">Platform Fees (MyHomeBro)</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Intro pricing: 3% + $1 for the first 60 days</li>
                <li>Standard pricing: 4.5% + $1</li>
                <li>Volume discount: 3.5% + $1</li>
                <li>$750 cap per agreement</li>
              </ul>
            </div>

            <div>
              <div className="font-semibold text-slate-900">Payment Processing (Stripe)</div>
              <div className="mt-1">
                Payments are processed through Stripe. Processing fees are separate from MyHomeBro platform fees and may vary by payment method.
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Card payments: typically about 2.9% + $0.30</li>
                <li>Bank payments (ACH): typically lower</li>
              </ul>
            </div>

            <div>
              <div className="font-semibold text-slate-900">What You&apos;ll See in the App</div>
              <div className="mt-1">For every agreement, invoice, and payout, display:</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Total amount</li>
                <li>MyHomeBro platform fee</li>
                <li>Net payout</li>
              </ul>
              <div className="mt-2 text-xs text-slate-600">
                Processing fees may apply depending on payment method.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderBusinessProfileForm = () => {
    if (loading) {
      return <div className="text-slate-600">Loading…</div>;
    }

    return (
      <form onSubmit={handleSave}>
        {/* Name & Email */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Full Name</label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.full_name}
              onChange={onChange("full_name")}
              placeholder="Your full name"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Email Address</label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.email}
              onChange={onChange("email")}
              placeholder="you@example.com"
            />
          </div>
        </div>

        {/* Business, Phone */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Business Name</label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.business_name}
              onChange={onChange("business_name")}
              placeholder="Your company LLC"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Phone</label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.phone}
              onChange={onChange("phone")}
              placeholder="(555) 555-5555"
            />
          </div>
        </div>

        {/* ✅ Address Search (Google helper) */}
        <div className="mt-4">
          <label className="block text-sm font-semibold mb-1">
            Address Search
          </label>

          <AddressAutocomplete
            value={businessAddrSearch || ""}
            onChangeText={(text) => {
              setBusinessAddrSearch(text);
            }}
            onSelect={(a) => {
              const display = a.formatted_address || a.line1 || "";
              setBusinessAddrSearch(display);

              // Fill persisted fields
              setForm((p) => ({
                ...p,
                address: a.line1 || p.address || "",
                city: a.city || p.city || "",
                state: a.state || p.state || "",
                zip: (a.postal_code || "").trim(),
              }));

              try {
                sessionStorage.setItem(
                  "mhb_contractor_business_geo",
                  JSON.stringify({
                    place_id: a.place_id || "",
                    formatted_address: a.formatted_address || "",
                    lat: a.lat ?? null,
                    lng: a.lng ?? null,
                  })
                );
              } catch {
                // ignore
              }
            }}
            placeholder="Start typing your business address (pick from suggestions)…"
          />

          <div className="mt-1 text-xs text-slate-500">
            Tip: pick an address from the dropdown so Street/City/State/Zip fill automatically.
          </div>
        </div>

        {/* ✅ Persisted address fields (always visible, always saved) */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-1">
              Street Address <span className="text-red-600">*</span>
            </label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.address || ""}
              onChange={onChange("address")}
              placeholder="123 Main St"
              autoComplete="street-address"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              City <span className="text-red-600">*</span>
            </label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.city}
              onChange={onChange("city")}
              placeholder="City"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              State <span className="text-red-600">*</span>
            </label>
            <select
              className="w-full h-10 rounded border border-slate-300 px-3 bg-white"
              value={form.state || ""}
              onChange={onChange("state")}
            >
              <option value="">Select…</option>
              {stateOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
          <div>
            <label className="block text-sm font-semibold mb-1">
              Zip Code <span className="text-red-600">*</span>
            </label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.zip || ""}
              onChange={onChange("zip")}
              placeholder="ZIP"
              inputMode="numeric"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">Service Range (miles)</label>
            <select
              className="w-full h-10 rounded border border-slate-300 px-3 bg-white"
              value={String(form.service_radius_miles || 25)}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  service_radius_miles: Number(e.target.value || 25),
                }))
              }
            >
              {SERVICE_RADIUS_OPTIONS.map((miles) => (
                <option key={miles} value={miles}>
                  {miles}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-semibold mb-1">Company Logo</label>
            <input type="file" accept="image/*" onChange={onLogo} />
            {logoPreview ? (
              <img
                src={logoPreview}
                alt="Company logo preview"
                className="mt-2 h-16 w-auto rounded border object-contain"
              />
            ) : null}
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-600">
          Your ZIP is used as the center of your service area.
        </div>

        {/* Skills */}
        <div className="mt-5">
          <div className="text-sm font-semibold mb-2">Skills</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {SKILL_OPTIONS.map((name) => {
              const checked = form.skills.includes(name);
              return (
                <label key={name} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={checked} onChange={() => toggleSkill(name)} />
                  {name}
                </label>
              );
            })}
          </div>
        </div>

        <div
          data-testid="contractor-compliance-preview"
          className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Licensing & insurance guidance</div>
              <div className="mt-1 text-xs text-slate-600">
                MyHomeBro uses your selected state and trades to flag common licensing requirements.
              </div>
            </div>
            {compliancePreviewLoading ? (
              <div className="text-xs font-medium text-slate-500">Checking…</div>
            ) : null}
          </div>

          {compliancePreviewError ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {compliancePreviewError}
            </div>
          ) : null}

          {complianceTradeRequirements.length ? (
            <div className="mt-4 space-y-3">
              {complianceTradeRequirements.map((item, idx) => {
                const tone =
                  item.warning_level === "critical"
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : item.warning_level === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-sky-200 bg-sky-50 text-sky-900";
                return (
                  <div
                    key={`${item.trade_key || idx}-${item.state_code || form.state}`}
                    className={`rounded-lg border px-3 py-3 ${tone}`}
                  >
                    <div className="text-sm font-semibold">
                      {formatComplianceLabel(item.trade_key)} in {item.state_code || form.state || "this state"}
                    </div>
                    <div className="mt-1 text-sm">
                      {item.message || "No specific statewide license requirement is currently configured."}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs">
                      <span>
                        License required: {item.required ? "Typically yes" : "Not typically statewide"}
                      </span>
                      <span>
                        Insurance: {item.insurance_required ? "Expected" : "Not specifically flagged"}
                      </span>
                      <span>
                        License on file: {item.contractor_has_license_on_file ? "Yes" : "No"}
                      </span>
                    </div>
                    {item.official_lookup_url ? (
                      <a
                        href={item.official_lookup_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-xs font-semibold underline"
                      >
                        View official source
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 text-sm text-slate-600">
              Select a state and one or more trades to see requirement guidance.
            </div>
          )}
        </div>

        {/* License fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="block text-sm font-semibold mb-1">License Number</label>
            <input
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.license_number}
              onChange={onChange("license_number")}
              placeholder="License #"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">License Expiration Date</label>
            <input
              type="date"
              className="w-full h-10 rounded border border-slate-300 px-3"
              value={form.license_expiration_date || ""}
              onChange={onChange("license_expiration_date")}
            />
          </div>
        </div>

        {/* License & Insurance file uploads */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-semibold mb-1">
              License Document (PDF or image)
            </label>
            <input type="file" accept=".pdf,image/*" onChange={onLicense} />
            {licenseUrl ? (
              <a
                href={licenseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-xs text-blue-600 underline"
              >
                View current license document
              </a>
            ) : null}
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">
              Insurance Certificate (PDF or image)
            </label>
            <input type="file" accept=".pdf,image/*" onChange={onInsurance} />
            {insuranceUrl ? (
              <a
                href={insuranceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-xs text-blue-600 underline"
              >
                View current insurance document
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div
            data-testid="contractor-compliance-records"
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="text-sm font-semibold text-slate-900">Documents on file</div>
            <div className="mt-1 text-xs text-slate-600">
              Uploaded compliance records remain editable and do not imply live state verification.
            </div>
            {complianceRecords.length ? (
              <div className="mt-4 space-y-3">
                {complianceRecords.map((record) => (
                  <div
                    key={record.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900">
                        {formatComplianceLabel(record.record_type)}
                        {record.trade_key ? ` · ${formatComplianceLabel(record.trade_key)}` : ""}
                      </div>
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        {formatComplianceLabel(record.status)}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
                      {record.state_code ? <span>State: {record.state_code}</span> : null}
                      {record.identifier ? <span>ID: {record.identifier}</span> : null}
                      <span>Expiration: {formatComplianceDate(record.expiration_date)}</span>
                    </div>
                    {record.file_url ? (
                      <a
                        href={record.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-xs font-semibold text-blue-700 underline"
                      >
                        View uploaded document
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-600">
                No license or insurance documents are on file yet.
              </div>
            )}
          </div>

          <div
            data-testid="contractor-insurance-status"
            className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="text-sm font-semibold text-slate-900">Insurance status</div>
            <div className="mt-3 text-sm text-slate-700">
              {insuranceStatus?.has_insurance ? "Insurance certificate on file." : "Insurance certificate missing."}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Status: {formatComplianceLabel(insuranceStatus?.status || "missing")}
            </div>
            {!insuranceStatus?.has_insurance ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Upload an insurance certificate so MyHomeBro can surface insurance-on-file trust signals safely.
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6">
          <button
            type="submit"
            disabled={saving}
            className="w-40 h-10 rounded bg-blue-700 text-white font-semibold hover:bg-blue-800 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>
      </form>
    );
  };

  const planBadgeActive = isAiProActive(meData);
  const onboarding = meData?.onboarding || {};
  const showSetupReminder =
    onboarding?.status && (onboarding.status !== "complete" || onboarding?.show_soft_stripe_prompt);

  return (
    <div className="flex justify-center">
      <div className="w-full rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">

        {showSetupReminder ? (
          <div
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
            data-testid="profile-stripe-reminder"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-amber-900">
                  {onboarding?.show_soft_stripe_prompt
                    ? "Stripe onboarding incomplete"
                    : "Account setup still in progress"}
                </div>
                <div className="mt-1 text-sm text-amber-800">
                  {onboarding?.show_soft_stripe_prompt
                    ? "You are ready to explore the app, but payments require a connected Stripe account."
                    : "Finish your trades, region, and first-job setup to unlock tailored guidance."}
                </div>
              </div>
              <a
                href="/app/onboarding"
                className="rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-950"
              >
                {onboarding?.show_soft_stripe_prompt ? "Resume Stripe setup" : "Resume onboarding"}
              </a>
            </div>
          </div>
        ) : null}

        {/* Top-level alerts for Business Profile tab */}
        {activeTab === "business" && error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-red-700">
            {error}
          </div>
        ) : null}
        {activeTab === "business" && success ? (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-700">
            {success}
          </div>
        ) : null}

        <div className="flex flex-col md:flex-row gap-6">
          {/* Mini sidebar */}
          <div className="md:w-56 w-full">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Account
            </div>
            <nav className="space-y-1">
              <button
                type="button"
                onClick={() => setActiveTab("business")}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm ${
                  activeTab === "business"
                    ? "bg-slate-900 text-white font-semibold shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <span>Business Profile</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("billing")}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm ${
                  activeTab === "billing"
                    ? "bg-slate-900 text-white font-semibold shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <span>Plan &amp; Billing</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  planBadgeActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
                }`}>
                  {planLabel(meData)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("account")}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm ${
                  activeTab === "account"
                    ? "bg-slate-900 text-white font-semibold shadow-sm"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <span>Account &amp; Login</span>
              </button>
            </nav>
          </div>

          {/* Content pane */}
          <div className="flex-1">
            {activeTab === "business" ? (
              <>
                <h3 className="mb-3 text-lg font-semibold text-slate-900">Business Profile</h3>
                {renderBusinessProfileForm()}
              </>
            ) : activeTab === "billing" ? (
              <>
                <h3 className="mb-3 text-lg font-semibold text-slate-900">Plan &amp; Billing</h3>
                {renderBilling()}
              </>
            ) : (
              <AccountSettings />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
