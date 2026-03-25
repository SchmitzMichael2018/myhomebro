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

function isAiProActive() {
  return true;
}

function planLabel() {
  return "Included";
}

function fmtPercent(rateDecimal) {
  const r = Number(rateDecimal);
  if (!Number.isFinite(r)) return null;
  return `${(r * 100).toFixed(2)}%`;
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

function pickZipFromData(data) {
  return (
    data?.zip ||
    data?.zipcode ||
    data?.postal_code ||
    data?.postalCode ||
    data?.zip_code ||
    ""
  );
}

function detectZipFieldName(data) {
  // To avoid breaking backend, only send ZIP if the backend appears to accept it.
  // We'll pick the first matching key present in /me payload.
  if (data && Object.prototype.hasOwnProperty.call(data, "zip")) return "zip";
  if (data && Object.prototype.hasOwnProperty.call(data, "zipcode")) return "zipcode";
  if (data && Object.prototype.hasOwnProperty.call(data, "zip_code")) return "zip_code";
  if (data && Object.prototype.hasOwnProperty.call(data, "postal_code")) return "postal_code";
  if (data && Object.prototype.hasOwnProperty.call(data, "postalCode")) return "postalCode";
  return null;
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

  // ✅ NEW: escrow pricing snapshot (tiered)
  const [escrowInfo, setEscrowInfo] = useState({
    loading: true,
    hasAgreement: false,
    tierName: null,
    isIntro: null,
    ratePercent: null, // "4.50%"
    fixedFee: 1,
    error: "",
  });

  const stateOptions = useMemo(
    () => US_STATES.map((s) => ({ value: s, label: s })),
    []
  );

  const refreshMe = async () => {
    const me = await api.get("/projects/contractors/me/");
    const data = me?.data || {};
    setMeData(data);
    return data;
  };

  const refreshEscrowPricing = async () => {
    setEscrowInfo((s) => ({ ...s, loading: true, error: "" }));
    try {
      // Find latest agreement (to pull funding_preview tier/rate)
      const { data } = await api.get("/projects/agreements/");
      const list = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
        ? data
        : [];

      if (!list.length) {
        setEscrowInfo({
          loading: false,
          hasAgreement: false,
          tierName: null,
          isIntro: null,
          ratePercent: null,
          fixedFee: 1,
          error: "",
        });
        return;
      }

      const latest = [...list].sort((a, b) => (b?.id || 0) - (a?.id || 0))[0];
      const agreementId = latest?.id;

      if (!agreementId) {
        setEscrowInfo({
          loading: false,
          hasAgreement: false,
          tierName: null,
          isIntro: null,
          ratePercent: null,
          fixedFee: 1,
          error: "",
        });
        return;
      }

      const { data: fp } = await api.get(`/projects/agreements/${agreementId}/funding_preview/`);
      const ratePercent = fp?.rate != null ? fmtPercent(fp.rate) : null;

      setEscrowInfo({
        loading: false,
        hasAgreement: true,
        tierName: fp?.tier_name ?? (fp?.is_intro ? "INTRO" : null),
        isIntro: fp?.is_intro ?? null,
        ratePercent,
        fixedFee: fp?.fixed_fee ?? 1,
        error: "",
      });
    } catch (e) {
      console.error("Failed to load escrow pricing preview:", e);
      setEscrowInfo({
        loading: false,
        hasAgreement: false,
        tierName: null,
        isIntro: null,
        ratePercent: null,
        fixedFee: 1,
        error: "Unable to load escrow tier/rate right now.",
      });
    }
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

        // preload escrow pricing snapshot
        await refreshEscrowPricing();
      } catch (e) {
        setError("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const { introActive, introDaysRemaining } = computeIntroCountdownDays(meData);
    const introDaysText =
      introDaysRemaining != null
        ? `${introDaysRemaining} day${introDaysRemaining === 1 ? "" : "s"} remaining`
        : null;

    const escrowRateLine = escrowInfo.ratePercent
      ? `${escrowInfo.ratePercent} + $${Number(escrowInfo.fixedFee || 1).toFixed(0)}`
      : null;

    const aiStatus = getAiStatusFromMe(meData);

    return (
      <div className="space-y-4">
        {/* AI availability */}
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

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
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

        {/* Escrow Pricing (tiered) */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Escrow Pricing (Tiered)</div>
            </div>
            <button
              type="button"
              onClick={refreshEscrowPricing}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Refresh Escrow Rate
            </button>
          </div>

          {escrowInfo.loading ? (
            <div className="mt-3 text-sm text-slate-600">Loading escrow tier…</div>
          ) : escrowInfo.error ? (
            <div className="mt-3 text-sm text-rose-700">{escrowInfo.error}</div>
          ) : !escrowInfo.hasAgreement ? (
            <div className="mt-3 text-sm text-slate-600">
              No agreements yet. Create your first agreement to see your current escrow tier.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Current Tier</div>
                <div className="text-sm font-semibold text-slate-900">
                  {String(escrowInfo.tierName || (escrowInfo.isIntro ? "INTRO" : "—")).toUpperCase()}
                </div>
              </div>

              <div className="rounded border bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Escrow Rate</div>
                <div className="text-sm font-semibold text-slate-900">
                  {escrowRateLine || "—"}
                </div>
              </div>

              <div className="rounded border bg-slate-50 p-3">
                <div className="text-xs text-slate-500">Intro Window</div>
                <div className="text-sm font-semibold text-slate-900">
                  {introActive ? (introDaysText || "Active") : "Ended"}
                </div>
              </div>
            </div>
          )}
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

              <div className="mt-3 font-medium text-slate-900">Escrow Payments</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>3% + $1 for the first 60 days on new accounts</li>
                <li>4.5% + $1 standard rate</li>
                <li>3.5% + $1 with volume discount</li>
                <li>$750 maximum fee per agreement/project</li>
              </ul>

              <div className="mt-3 font-medium text-slate-900">Direct Pay</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>2% + $1 per transaction</li>
              </ul>
            </div>

            <div>
              <div className="font-semibold text-slate-900">Payment Processing (Stripe)</div>
              <div className="mt-1">
                Payments are processed through Stripe. Processing fees are separate from platform fees and may vary depending on payment method.
              </div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Typical card processing fees are around 2.9% + $0.30 per transaction</li>
                <li>ACH bank payments are typically ~0.8% (capped at $5)</li>
              </ul>
              <div className="mt-2">Actual processing fees may vary based on:</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>card type</li>
                <li>international payments</li>
                <li>payment method</li>
              </ul>
            </div>

            <div>
              <div className="font-semibold text-slate-900">What You’ll See in the App</div>
              <div className="mt-1">For every agreement, invoice, and payout, display:</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>total amount</li>
                <li>platform fee</li>
                <li>processing fee</li>
                <li>total deductions</li>
                <li>net payout</li>
              </ul>
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

          <div className="md:col-span-3">
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

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-5xl bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-2xl font-bold mb-4">My Profile</h2>

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
            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">
              Account
            </div>
            <nav className="space-y-1">
              <button
                type="button"
                onClick={() => setActiveTab("business")}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-sm ${
                  activeTab === "business"
                    ? "bg-blue-600 text-white font-semibold"
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
                    ? "bg-blue-600 text-white font-semibold"
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
                    ? "bg-blue-600 text-white font-semibold"
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
                <h3 className="text-lg font-semibold mb-3">Business Profile</h3>
                {renderBusinessProfileForm()}
              </>
            ) : activeTab === "billing" ? (
              <>
                <h3 className="text-lg font-semibold mb-3">Plan &amp; Billing</h3>
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
