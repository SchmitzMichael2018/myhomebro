import React, { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Home, Lock, Mail, ShieldCheck } from "lucide-react";

import api, { extractApiErrorMessage, setTokens } from "../api";
import logo from "../assets/myhomebro_logo.png";

const propertyTypes = [
  ["single_family", "Single family"],
  ["townhome", "Townhome"],
  ["condo", "Condo"],
  ["multi_family", "Multi-family"],
  ["commercial", "Commercial"],
  ["other", "Other"],
];

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-sky-50">{label}</span>
      <div className="mt-2">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-sky-100/62">{hint}</span> : null}
    </label>
  );
}

function TextInput(props) {
  return (
    <input
      {...props}
      className="w-full rounded-xl border border-white/14 bg-slate-950/55 px-4 py-3 text-white placeholder:text-sky-100/38 shadow-inner shadow-slate-950/30 outline-none transition focus:border-amber-300/75 focus:ring-2 focus:ring-amber-300/28"
    />
  );
}

function SelectInput(props) {
  return (
    <select
      {...props}
      className="w-full rounded-xl border border-white/14 bg-slate-950/55 px-4 py-3 text-white shadow-inner shadow-slate-950/30 outline-none transition focus:border-amber-300/75 focus:ring-2 focus:ring-amber-300/28"
    />
  );
}

function StepBadge({ active, complete, children }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold ${
        active
          ? "border-amber-300/60 bg-amber-300/12 text-amber-100"
          : complete
            ? "border-emerald-300/38 bg-emerald-400/10 text-emerald-100"
            : "border-white/10 bg-white/[0.03] text-sky-100/62"
      }`}
    >
      {complete ? <CheckCircle2 className="h-4 w-4" /> : null}
      {children}
    </div>
  );
}

export default function CustomerAccountOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const verifiedParam = searchParams.get("verified") === "1";

  const [step, setStep] = useState(verifiedParam ? "signin" : "account");
  const [accountForm, setAccountForm] = useState({
    full_name: "",
    email: "",
    phone_number: "",
    password: "",
    password_confirm: "",
  });
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [propertyForm, setPropertyForm] = useState({
    display_name: "Primary Property",
    property_type: "single_family",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    postal_code: "",
  });
  const [portalToken, setPortalToken] = useState("");
  const [propertyProfileId, setPropertyProfileId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeStepIndex = useMemo(() => {
    if (step === "account") return 0;
    if (step === "verify" || step === "signin") return 1;
    if (step === "property") return 2;
    return 3;
  }, [step]);

  const updateAccount = (field, value) => setAccountForm((current) => ({ ...current, [field]: value }));
  const updateLogin = (field, value) => setLoginForm((current) => ({ ...current, [field]: value }));
  const updateProperty = (field, value) => setPropertyForm((current) => ({ ...current, [field]: value }));

  const propertyNeedsSetup = (profile) => {
    if (!profile) return true;
    const hasAddress = [profile.address_line1, profile.city, profile.state, profile.postal_code].some((value) =>
      String(value || "").trim()
    );
    const name = String(profile.display_name || "").trim().toLowerCase();
    return !hasAddress && (!name || name === "primary property");
  };

  const submitAccount = async (event) => {
    event.preventDefault();
    setError("");
    if (accountForm.password !== accountForm.password_confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/accounts/auth/customer-register/", {
        full_name: accountForm.full_name,
        email: accountForm.email,
        phone_number: accountForm.phone_number,
        password: accountForm.password,
      });
      setLoginForm({ email: accountForm.email.trim().toLowerCase(), password: "" });
      setStep("verify");
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const submitLogin = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const loginResponse = await api.post("/auth/login/", {
        email: loginForm.email.trim().toLowerCase(),
        password: loginForm.password,
      });
      const access = loginResponse.data?.access || loginResponse.data?.access_token;
      const refresh = loginResponse.data?.refresh || loginResponse.data?.refresh_token;
      if (!access) throw new Error("Login succeeded but no token was returned.");
      setTokens(access, refresh || null, true);
      const { data } = await api.get("/projects/customer-portal/account/");
      const token = data?.account?.portal_token || "";
      setPortalToken(token);
      const profiles = Array.isArray(data?.property_profiles) ? data.property_profiles : [];
      const setupProfile = profiles.find((profile) => propertyNeedsSetup(profile));
      const hasReadyProperty = profiles.some((profile) => !propertyNeedsSetup(profile));
      if (hasReadyProperty && token) {
        navigate(`/portal/${encodeURIComponent(token)}`);
      } else {
        if (setupProfile?.id) {
          setPropertyProfileId(setupProfile.id);
          setPropertyForm((current) => ({
            ...current,
            display_name: setupProfile.display_name || current.display_name,
            property_type: setupProfile.property_type || current.property_type,
            address_line1: setupProfile.address_line1 || "",
            address_line2: setupProfile.address_line2 || "",
            city: setupProfile.city || "",
            state: setupProfile.state || "",
            postal_code: setupProfile.postal_code || "",
          }));
        }
        setStep("property");
      }
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const submitProperty = async (event) => {
    event.preventDefault();
    setError("");
    if (!portalToken) {
      setError("We could not load your customer portal yet. Please sign in again.");
      setStep("signin");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...propertyForm,
        is_primary: true,
        ...(propertyProfileId ? { id: propertyProfileId } : {}),
      };
      if (propertyProfileId) {
        await api.patch(`/projects/customer-portal/${encodeURIComponent(portalToken)}/property/`, payload);
      } else {
        await api.post(`/projects/customer-portal/${encodeURIComponent(portalToken)}/property/`, payload);
      }
      setStep("dashboard");
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_35%_8%,rgba(37,99,235,0.26),transparent_28%),linear-gradient(135deg,#020617_0%,#082044_52%,#0f172a_100%)] text-white">
      <header className="border-b border-white/10 bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo} alt="MyHomeBro" className="h-10 w-10 rounded-xl object-cover" />
            <div className="text-xl font-bold">MyHome<span className="text-amber-300">Bro</span></div>
          </Link>
          <Link to="/portal" className="rounded-xl border border-white/16 px-4 py-2 text-sm font-semibold text-sky-50 hover:bg-white/8">
            Customer Log In
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-8 lg:py-12">
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/45 bg-amber-300/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-100">
            <ShieldCheck className="h-4 w-4" />
            Free customer account
          </div>
          <div>
            <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">Create your MyHomeBro account.</h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-sky-50/76">
              Set up your customer portal, add your first property, and keep documents, requests, estimates, and project updates organized when you need them.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["No project required", "Create your account now and start a project later."],
              ["Secure portal", "Verify your email before your property dashboard opens."],
              ["No duplicates", "Future project requests link back to this account by email."],
              ["Property-first", "Add the address once so future requests are easier."],
            ].map(([title, text]) => (
              <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="font-semibold text-white">{title}</div>
                <div className="mt-1 text-sm leading-6 text-sky-100/66">{text}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/12 bg-slate-950/58 p-5 shadow-2xl shadow-slate-950/35 sm:p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            {["Create account", "Verify email", "Add property", "Dashboard"].map((label, index) => (
              <StepBadge key={label} active={activeStepIndex === index} complete={activeStepIndex > index}>
                {label}
              </StepBadge>
            ))}
          </div>

          {error ? (
            <div data-testid="customer-account-error" className="mb-4 rounded-2xl border border-rose-300/30 bg-rose-500/12 p-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {step === "account" ? (
            <form data-testid="customer-account-create-form" className="space-y-4" onSubmit={submitAccount}>
              <Field label="Full name">
                <TextInput data-testid="customer-account-name" value={accountForm.full_name} onChange={(e) => updateAccount("full_name", e.target.value)} required autoComplete="name" />
              </Field>
              <Field label="Email" hint="If you later submit a project, we'll link it to this account automatically.">
                <TextInput data-testid="customer-account-email" type="email" value={accountForm.email} onChange={(e) => updateAccount("email", e.target.value)} required autoComplete="email" />
              </Field>
              <Field label="Phone">
                <TextInput data-testid="customer-account-phone" value={accountForm.phone_number} onChange={(e) => updateAccount("phone_number", e.target.value)} autoComplete="tel" />
              </Field>
              <Field label="Password">
                <TextInput data-testid="customer-account-password" type="password" value={accountForm.password} onChange={(e) => updateAccount("password", e.target.value)} required autoComplete="new-password" />
              </Field>
              <Field label="Confirm password">
                <TextInput data-testid="customer-account-password-confirm" type="password" value={accountForm.password_confirm} onChange={(e) => updateAccount("password_confirm", e.target.value)} required autoComplete="new-password" />
              </Field>
              <button data-testid="customer-account-create-submit" type="submit" disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-950/25 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60">
                {loading ? "Creating account..." : "Create Free Account"}
              </button>
            </form>
          ) : null}

          {step === "verify" ? (
            <div data-testid="customer-account-verify-step" className="space-y-5">
              <div className="rounded-2xl border border-emerald-300/28 bg-emerald-400/10 p-4">
                <div className="flex items-center gap-3 text-lg font-semibold text-emerald-100">
                  <Mail className="h-5 w-5" />
                  Check your email
                </div>
                <p className="mt-3 text-sm leading-6 text-sky-50/76">
                  We sent a verification link to {accountForm.email || loginForm.email}. Verify your email, then sign in here to add your first property.
                </p>
              </div>
              <button type="button" data-testid="customer-account-verified-continue" onClick={() => setStep("signin")} className="w-full rounded-xl border border-amber-300/45 bg-amber-300/12 px-5 py-3 font-semibold text-amber-100 hover:bg-amber-300/18">
                I verified my email
              </button>
            </div>
          ) : null}

          {step === "signin" ? (
            <form data-testid="customer-account-signin-form" className="space-y-4" onSubmit={submitLogin}>
              <Field label="Email">
                <TextInput data-testid="customer-account-signin-email" type="email" value={loginForm.email} onChange={(e) => updateLogin("email", e.target.value)} required autoComplete="email" />
              </Field>
              <Field label="Password">
                <TextInput data-testid="customer-account-signin-password" type="password" value={loginForm.password} onChange={(e) => updateLogin("password", e.target.value)} required autoComplete="current-password" />
              </Field>
              <button data-testid="customer-account-signin-submit" type="submit" disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-950/25 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60">
                {loading ? "Signing in..." : "Continue to Property Setup"}
              </button>
            </form>
          ) : null}

          {step === "property" ? (
            <form data-testid="customer-account-property-form" className="space-y-4" onSubmit={submitProperty}>
              <div className="rounded-2xl border border-blue-300/24 bg-blue-500/10 p-4 text-sm leading-6 text-sky-50/76">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Home className="h-4 w-4" />
                  Add your first property
                </div>
                <p className="mt-2">This gives your dashboard a home base. You can start a project later.</p>
              </div>
              <Field label="Property nickname">
                <TextInput data-testid="customer-account-property-name" value={propertyForm.display_name} onChange={(e) => updateProperty("display_name", e.target.value)} required />
              </Field>
              <Field label="Property type">
                <SelectInput data-testid="customer-account-property-type" value={propertyForm.property_type} onChange={(e) => updateProperty("property_type", e.target.value)}>
                  {propertyTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </SelectInput>
              </Field>
              <Field label="Street address">
                <TextInput data-testid="customer-account-property-address" value={propertyForm.address_line1} onChange={(e) => updateProperty("address_line1", e.target.value)} required autoComplete="street-address" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="City">
                  <TextInput data-testid="customer-account-property-city" value={propertyForm.city} onChange={(e) => updateProperty("city", e.target.value)} required />
                </Field>
                <Field label="State">
                  <TextInput data-testid="customer-account-property-state" value={propertyForm.state} onChange={(e) => updateProperty("state", e.target.value)} required />
                </Field>
                <Field label="ZIP">
                  <TextInput data-testid="customer-account-property-zip" value={propertyForm.postal_code} onChange={(e) => updateProperty("postal_code", e.target.value)} required />
                </Field>
              </div>
              <button data-testid="customer-account-property-submit" type="submit" disabled={loading} className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-950/25 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-60">
                {loading ? "Saving property..." : "Save Property"}
              </button>
            </form>
          ) : null}

          {step === "dashboard" ? (
            <div data-testid="customer-account-dashboard-ready" className="space-y-5">
              <div className="rounded-2xl border border-emerald-300/28 bg-emerald-400/10 p-5">
                <div className="flex items-center gap-3 text-xl font-semibold text-emerald-100">
                  <CheckCircle2 className="h-6 w-6" />
                  Your customer dashboard is ready.
                </div>
                <p className="mt-3 text-sm leading-6 text-sky-50/76">
                  Your property is saved. When you submit a project later, MyHomeBro will link it to this account automatically.
                </p>
              </div>
              <button type="button" data-testid="customer-account-go-dashboard" onClick={() => navigate(`/portal/${encodeURIComponent(portalToken)}`)} className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-950/25 hover:from-blue-500 hover:to-indigo-500">
                Go to Customer Dashboard
              </button>
            </div>
          ) : null}

          <div className="mt-5 flex items-center gap-2 text-xs text-sky-100/58">
            <Lock className="h-4 w-4" />
            Your account uses email verification before dashboard access.
          </div>
        </section>
      </main>
    </div>
  );
}
