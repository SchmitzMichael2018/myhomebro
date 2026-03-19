// src/components/ContractorProfile.jsx
// v2025-11-27 — Business Profile + Account & Login with mini sidebar (no duplicate heading)
// v2026-02-16 — ✅ Add Plan & Billing tab (AI Pro flag + Direct Pay rate display)
// v2026-02-16b — ✅ Show Escrow tiered rate + intro countdown + cancel/manage subscription buttons
// v2026-02-19 — ✅ Show AI Credits (free remaining) + “1 credit = 1 agreement” in Plan & Billing
// v2026-02-23 — ✅ Add Zip Code + Autocomplete fills City/State/Zip + require Address/City/State/Zip
//             — ✅ Fix: remove premature “Business address required” checks that blocked profile load
// v2026-02-23c — ✅ FIX: Split Address Search (Google) from persisted Street Address field (no widget display issues)

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

function normalizeTierName(tier) {
  const s = String(tier || "").trim().toLowerCase();
  if (!s) return "free";
  if (s.includes("ai") && s.includes("pro")) return "ai_pro";
  if (s === "pro") return "ai_pro";
  return s;
}

function isAiProActive(meData) {
  const bp = meData?.billing_profile || meData?.billingProfile || null;

  if (bp && bp.ai_subscription_active === true) return true;
  if (meData?.ai_subscription_active === true) return true;

  const tier = normalizeTierName(bp?.ai_subscription_tier || meData?.ai_subscription_tier);
  if (tier === "ai_pro") return true;

  return false;
}

function planLabel(meData) {
  return isAiProActive(meData) ? "AI Pro" : "Free";
}

function directPayRateLabel(meData) {
  // LOCKED
  return isAiProActive(meData) ? "1% + $1" : "2% + $1";
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

function getAiCreditsFromMe(meData) {
  // Supports both payload shapes:
  // 1) new convenience shape: meData.ai.credits_remaining / credits_total
  // 2) current shape: meData.ai_agreement_writer.free_remaining / free_total / free_used

  const aw =
    meData?.ai?.agreement_writer ||
    meData?.ai_agreement_writer ||
    meData?.aiAgreementWriter ||
    null;

  const remaining =
    meData?.ai?.credits_remaining ??
    meData?.ai?.creditsRemaining ??
    aw?.free_remaining ??
    aw?.freeRemaining ??
    null;

  const total =
    meData?.ai?.credits_total ??
    meData?.ai?.creditsTotal ??
    aw?.free_total ??
    aw?.freeTotal ??
    null;

  const used =
    aw?.free_used ??
    aw?.freeUsed ??
    (total != null && remaining != null
      ? Math.max(0, Number(total) - Number(remaining))
      : null);

  const enabled =
    aw?.enabled === true ||
    meData?.ai?.enabled === true ||
    (remaining != null && Number(remaining) > 0);

  return {
    remaining: remaining == null ? null : Number(remaining),
    total: total == null ? null : Number(total),
    used: used == null ? null : Number(used),
    enabled: !!enabled,
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
    const plan = planLabel(meData);
    const dpRate = directPayRateLabel(meData);

    const bp = meData?.billing_profile || meData?.billingProfile || null;
    const tier = normalizeTierName(bp?.ai_subscription_tier || meData?.ai_subscription_tier || "free");
    const aiActive = isAiProActive(meData);

    const stripeCustomerId = bp?.stripe_customer_id || "";
    const stripeSubscriptionId = bp?.stripe_subscription_id || "";
    const periodEnd = bp?.current_period_end || null;

    const { introActive, introDaysRemaining } = computeIntroCountdownDays(meData);
    const introDaysText =
      introDaysRemaining != null
        ? `${introDaysRemaining} day${introDaysRemaining === 1 ? "" : "s"} remaining`
        : null;

    const escrowRateLine = escrowInfo.ratePercent
      ? `${escrowInfo.ratePercent} + $${Number(escrowInfo.fixedFee || 1).toFixed(0)}`
      : null;

    const aiCredits = getAiCreditsFromMe(meData);

    return (
      <div className="space-y-4">
        {/* Plan overview */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Plan & Billing</div>
              <div className="mt-1 text-sm text-slate-700">
                <b>Current Plan:</b> {plan}
                <span
                  className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    aiActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-800"
                  }`}
                >
                  {aiActive ? "AI PRO ACTIVE" : "FREE"}
                </span>
              </div>

              <div className="mt-2 text-sm text-slate-700">
                <b>Direct Pay Rate:</b> {dpRate}
              </div>

              <div className="mt-2 text-xs text-slate-600">
                Direct Pay is intended for fast invoices (subcontractor-style billing). Escrow remains tiered and separate.
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {!aiActive ? (
                <button
                  type="button"
                  onClick={() => {
                    const subject = encodeURIComponent("Request: AI Pro Subscription");
                    const body = encodeURIComponent(
                      "Hi MyHomeBro,\n\nI would like to enable AI Pro on my contractor account.\n\nThanks!"
                    );
                    window.location.href = `mailto:support@myhomebro.com?subject=${subject}&body=${body}`;
                  }}
                  className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  title="Request AI Pro (Stripe subscription checkout can replace this later)"
                >
                  Upgrade to AI Pro
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      alert("Manage Subscription will connect to Stripe billing portal once enabled.");
                    }}
                    className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    title="Manage subscription (Stripe portal later)"
                  >
                    Manage Subscription
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const subject = encodeURIComponent("Request: Cancel AI Pro Subscription");
                      const body = encodeURIComponent(
                        "Hi MyHomeBro,\n\nPlease cancel AI Pro on my contractor account.\n\nThanks!"
                      );
                      window.location.href = `mailto:support@myhomebro.com?subject=${subject}&body=${body}`;
                    }}
                    className="rounded border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                    title="Request cancellation (Stripe portal later)"
                  >
                    Cancel AI Pro
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={async () => {
                  try {
                    await refreshMe();
                    await refreshEscrowPricing();
                  } catch {
                    // ignore
                  }
                }}
                className="rounded border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                title="Refresh plan status"
              >
                Refresh Status
              </button>
            </div>
          </div>
        </div>

        {/* ✅ AI Credits */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">AI Credits</div>
              <div className="mt-1 text-xs text-slate-600">
                Credits are used by the AI Agreement Writing tools.
              </div>
            </div>
            <button
              type="button"
              onClick={refreshMe}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              title="Refresh credits"
            >
              Refresh Credits
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Remaining</div>
              <div className="text-sm font-semibold text-slate-900">
                {aiCredits.remaining != null ? aiCredits.remaining : "—"}
              </div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Used</div>
              <div className="text-sm font-semibold text-slate-900">
                {aiCredits.used != null ? aiCredits.used : "—"}
              </div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Total (Free)</div>
              <div className="text-sm font-semibold text-slate-900">
                {aiCredits.total != null ? aiCredits.total : "—"}
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-600">
            <b>Rule:</b> 1 credit = 1 AI-written agreement. Re-clicking “Generate” for the same agreement should not double-charge once we enforce idempotency in the AI endpoint.
          </div>

          {!aiCredits.enabled && aiCredits.total != null ? (
            <div className="mt-2 text-xs text-rose-700">
              No AI credits remaining.
            </div>
          ) : null}
        </div>

        {/* Escrow Pricing (tiered) */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Escrow Pricing (Tiered)</div>
              <div className="mt-1 text-xs text-slate-600">
                This is your current escrow (protected) pricing tier. It may change as your monthly volume changes.
              </div>
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
              No agreements yet. Create your first agreement to compute tiered escrow pricing and previews.
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

        {/* Plan Details */}
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">Plan Details</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Tier Key</div>
              <div className="text-sm font-semibold text-slate-900">{tier}</div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">AI Subscription Active</div>
              <div className="text-sm font-semibold text-slate-900">{aiActive ? "Yes" : "No"}</div>
            </div>

            <div className="rounded border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Next Renewal / Period End</div>
              <div className="text-sm font-semibold text-slate-900">
                {periodEnd ? String(periodEnd) : "—"}
              </div>
            </div>
          </div>

          {(stripeCustomerId || stripeSubscriptionId) ? (
            <div className="mt-3 text-xs text-slate-600">
              <div><b>Stripe Customer:</b> {stripeCustomerId || "—"}</div>
              <div><b>Stripe Subscription:</b> {stripeSubscriptionId || "—"}</div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-slate-500">
              Stripe subscription IDs will appear here once subscription automation is enabled.
            </div>
          )}
        </div>

        {/* Pricing explanation */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">How AI Pro affects pricing</div>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-900/90 space-y-1">
            <li>Free plan Direct Pay: <b>2% + $1</b></li>
            <li>AI Pro Direct Pay: <b>1% + $1</b></li>
            <li>Escrow pricing stays tiered and is not waived by AI Pro.</li>
          </ul>
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
                  isAiProActive(meData) ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"
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