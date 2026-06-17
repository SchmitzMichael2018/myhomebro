import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../api";
import logo from "../assets/myhomebro_logo.png";

const DEFAULT_FORM = {
  submitted_by_name: "",
  submitted_by_email: "",
  submitted_by_phone: "",
  unit_id: "",
  category: "general_repair",
  urgency: "normal",
  title: "",
  description: "",
  permission_to_enter: false,
  pets_present: false,
  preferred_access_times: "",
};

const DEFAULT_VERIFICATION_FORM = {
  property_query: "",
  unit_label: "",
  tenant_last_name: "",
  contact: "",
};

export default function TenantMaintenanceRequestPage() {
  const { token = "" } = useParams();
  const [context, setContext] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [verificationForm, setVerificationForm] = useState(DEFAULT_VERIFICATION_FORM);
  const [verificationToken, setVerificationToken] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [attachments, setAttachments] = useState([]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setConfirmation(null);
    setAttachments([]);
    if (!token) {
      setContext(null);
      setForm(DEFAULT_FORM);
      setVerificationToken("");
      setVerificationError("");
      setLoading(false);
      return () => {
        alive = false;
      };
    }
    api
      .get(`/projects/maintenance-request/${encodeURIComponent(token)}/`)
      .then(({ data }) => {
        if (!alive) return;
        setContext(data);
        if (data?.unit?.id) {
          setForm((prev) => ({ ...prev, unit_id: String(data.unit.id) }));
        }
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.response?.data?.detail || "We could not open this maintenance request link.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const categories = context?.categories?.length ? context.categories : [{ value: "general_repair", label: "General Repair" }];
  const urgencies = context?.urgencies?.length ? context.urgencies : [{ value: "normal", label: "Normal" }];
  const units = context?.units || [];
  const fixedUnit = context?.unit || null;
  const canSubmit = useMemo(() => {
    return Boolean(
      (form.submitted_by_name.trim() || form.submitted_by_email.trim() || form.submitted_by_phone.trim()) &&
        form.title.trim() &&
        form.description.trim()
    );
  }, [form]);

  const canVerify = useMemo(() => {
    return Boolean(
      verificationForm.property_query.trim() &&
        verificationForm.unit_label.trim() &&
        verificationForm.tenant_last_name.trim() &&
        verificationForm.contact.trim()
    );
  }, [verificationForm]);

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const updateVerification = (field, value) => {
    setVerificationForm((prev) => ({ ...prev, [field]: value }));
    setVerificationError("");
  };

  const verifyTenant = async (event) => {
    event.preventDefault();
    if (!canVerify) return;
    setVerifying(true);
    setVerificationError("");
    setError("");
    try {
      const { data } = await api.post("/projects/maintenance-request/verify/", verificationForm);
      setContext(data);
      setVerificationToken(data?.verification_token || "");
      setForm((prev) => ({
        ...prev,
        submitted_by_name: verificationForm.tenant_last_name,
        submitted_by_email: verificationForm.contact.includes("@") ? verificationForm.contact : prev.submitted_by_email,
        submitted_by_phone: verificationForm.contact.includes("@") ? prev.submitted_by_phone : verificationForm.contact,
        unit_id: data?.unit?.id ? String(data.unit.id) : prev.unit_id,
      }));
    } catch (err) {
      setVerificationError(err?.response?.data?.detail || "We could not verify those details. Check the information and try again.");
    } finally {
      setVerifying(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      let payload;
      if (attachments.length) {
        payload = new FormData();
        Object.entries(form).forEach(([key, value]) => {
          if (key === "unit_id") {
            if (value) payload.append(key, value);
            return;
          }
          payload.append(key, value ?? "");
        });
        if (!token) payload.append("verification_token", verificationToken);
        attachments.forEach((file) => payload.append("attachments", file));
      } else {
        payload = {
          ...form,
          unit_id: form.unit_id ? Number(form.unit_id) : null,
        };
        if (!token) payload.verification_token = verificationToken;
      }
      const endpoint = token
        ? `/projects/maintenance-request/${encodeURIComponent(token)}/`
        : "/projects/maintenance-request/verified-submit/";
      const { data } = await api.post(endpoint, payload);
      setConfirmation(data?.request || {});
    } catch (err) {
      setError(err?.response?.data?.detail || "We could not submit this request right now.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <main className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-3">
            <img src={logo} alt="MyHomeBro" className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
            <span className="text-sm font-black uppercase tracking-[0.2em] text-amber-100">MyHomeBro</span>
          </Link>
        </div>

        <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5 shadow-2xl shadow-slate-950/40">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-amber-100">Maintenance Requests</div>
          <h1 className="mt-2 text-2xl font-black text-white">Submit a Maintenance Request</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Send the property manager the details they need to review your request.
          </p>

          {loading ? (
            <div data-testid="tenant-maintenance-loading" className="mt-5 rounded-xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-300">
              Loading request form...
            </div>
          ) : !token && !verificationToken && !context && !confirmation ? (
            <form data-testid="tenant-maintenance-verify-form" onSubmit={verifyTenant} className="mt-5 space-y-4">
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
                Enter your property, unit, and contact details so we can route your request to the right property manager.
              </div>

              <label className="block text-sm font-medium text-slate-200">
                Property name or address
                <input
                  data-testid="tenant-maintenance-property"
                  value={verificationForm.property_query}
                  onChange={(event) => updateVerification("property_query", event.target.value)}
                  autoComplete="street-address"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-200">
                  Unit / apartment
                  <input
                    data-testid="tenant-maintenance-unit-label"
                    value={verificationForm.unit_label}
                    onChange={(event) => updateVerification("unit_label", event.target.value)}
                    autoComplete="address-line2"
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-200">
                  Last name
                  <input
                    data-testid="tenant-maintenance-last-name"
                    value={verificationForm.tenant_last_name}
                    onChange={(event) => updateVerification("tenant_last_name", event.target.value)}
                    autoComplete="family-name"
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  />
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-200">
                Email or phone
                <input
                  data-testid="tenant-maintenance-contact"
                  value={verificationForm.contact}
                  onChange={(event) => updateVerification("contact", event.target.value)}
                  autoComplete="email"
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                />
              </label>

              {verificationError ? (
                <div data-testid="tenant-maintenance-verify-error" className="rounded-xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-100">
                  {verificationError}
                </div>
              ) : null}

              <button
                type="submit"
                data-testid="tenant-maintenance-verify-submit"
                disabled={!canVerify || verifying}
                className="w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {verifying ? "Verifying..." : "Continue"}
              </button>
            </form>
          ) : error && !context ? (
            <div data-testid="tenant-maintenance-error" className="mt-5 rounded-xl border border-rose-300/35 bg-rose-400/10 p-4 text-sm text-rose-100">
              {error}
            </div>
          ) : confirmation ? (
            <div data-testid="tenant-maintenance-confirmation" className="mt-5 rounded-xl border border-emerald-300/35 bg-emerald-400/10 p-4 text-sm text-emerald-100">
              <div className="font-bold">Maintenance request submitted.</div>
              <p className="mt-1">Reference: {confirmation.reference || "Submitted"}</p>
              <p className="mt-1">Status: {confirmation.status_label || "Submitted"}</p>
            </div>
          ) : (
            <form data-testid="tenant-maintenance-form" onSubmit={submit} className="mt-5 space-y-4">
              <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
                <div className="font-semibold text-white">{context?.property?.display_name || "Managed property"}</div>
                {fixedUnit ? <div className="mt-1">Unit: {fixedUnit.unit_label}</div> : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm font-medium text-slate-200">
                  Name
                  <input
                    data-testid="tenant-maintenance-name"
                    value={form.submitted_by_name}
                    onChange={(event) => update("submitted_by_name", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-200">
                  Email
                  <input
                    data-testid="tenant-maintenance-email"
                    type="email"
                    value={form.submitted_by_email}
                    onChange={(event) => update("submitted_by_email", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  />
                </label>
                <label className="block text-sm font-medium text-slate-200">
                  Phone
                  <input
                    data-testid="tenant-maintenance-phone"
                    value={form.submitted_by_phone}
                    onChange={(event) => update("submitted_by_phone", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  />
                </label>
              </div>

              {!fixedUnit ? (
                <label className="block text-sm font-medium text-slate-200">
                  Unit
                  <select
                    data-testid="tenant-maintenance-unit"
                    value={form.unit_id}
                    onChange={(event) => update("unit_id", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  >
                    <option value="">No unit / whole property</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>{unit.unit_label}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-200">
                  Category
                  <select
                    data-testid="tenant-maintenance-category"
                    value={form.category}
                    onChange={(event) => update("category", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  >
                    {categories.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-200">
                  Urgency
                  <select
                    data-testid="tenant-maintenance-urgency"
                    value={form.urgency}
                    onChange={(event) => update("urgency", event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                  >
                    {urgencies.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-200">
                Title
                <input
                  data-testid="tenant-maintenance-title"
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                />
              </label>

              <label className="block text-sm font-medium text-slate-200">
                Description
                <textarea
                  data-testid="tenant-maintenance-description"
                  value={form.description}
                  onChange={(event) => update("description", event.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                  <input
                    data-testid="tenant-maintenance-permission"
                    type="checkbox"
                    checked={form.permission_to_enter}
                    onChange={(event) => update("permission_to_enter", event.target.checked)}
                  />
                  Permission to enter
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200">
                  <input
                    data-testid="tenant-maintenance-pets"
                    type="checkbox"
                    checked={form.pets_present}
                    onChange={(event) => update("pets_present", event.target.checked)}
                  />
                  Pets present
                </label>
              </div>

              <label className="block text-sm font-medium text-slate-200">
                Preferred access times
                <input
                  data-testid="tenant-maintenance-access-times"
                  value={form.preferred_access_times}
                  onChange={(event) => update("preferred_access_times", event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300"
                />
              </label>

              <label className="block text-sm font-medium text-slate-200">
                Photos or files
                <input
                  data-testid="tenant-maintenance-attachments"
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => setAttachments(Array.from(event.target.files || []))}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-300 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-950"
                />
              </label>
              {attachments.length ? (
                <div data-testid="tenant-maintenance-selected-files" className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-xs text-slate-300">
                  <div className="font-semibold text-white">Selected files</div>
                  <ul className="mt-2 space-y-1">
                    {attachments.map((file) => (
                      <li key={`${file.name}-${file.size}`}>{file.name}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {error ? (
                <div data-testid="tenant-maintenance-submit-error" className="rounded-xl border border-rose-300/35 bg-rose-400/10 p-3 text-sm text-rose-100">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                data-testid="tenant-maintenance-submit"
                disabled={!canSubmit || submitting}
                className="w-full rounded-xl bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
