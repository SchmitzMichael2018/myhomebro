// src/components/ContractorProfile.jsx
import React, { useEffect, useMemo, useState } from "react";
import api from "../api";

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

export default function ContractorProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [contractorId, setContractorId] = useState(null);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    business_name: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    license_number: "",
    license_expiration_date: "",
    skills: [],
  });

  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);

  const stateOptions = useMemo(
    () => US_STATES.map((s) => ({ value: s, label: s })),
    []
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      setSuccess("");
      try {
        const me = await api.get("/projects/contractors/me/");
        const data = me?.data || {};
        const id = data.id ?? data.pk ?? null;
        setContractorId(id);

        setForm({
          full_name: data.full_name || data.name || "",
          email: data.email || "",
          business_name: data.business_name || "",
          phone: data.phone || "",
          address: data.address || data.address_line1 || "",
          city: data.city || "",
          state: data.state || "",
          license_number: data.license_number || "",
          license_expiration_date: (data.license_expiration_date || "").slice(0, 10),
          skills: Array.isArray(data.skills)
            ? data.skills.map((s) =>
                typeof s === "string" ? s : (s.name || s.title || "")
              ).filter(Boolean)
            : [],
        });

        setLogoPreview(data.logo || data.logo_url || null);
      } catch (e) {
        setError("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
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
    if (file) {
      const url = URL.createObjectURL(file);
      setLogoPreview(url);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const fd = new FormData();
      fd.append("full_name", form.full_name || "");
      fd.append("business_name", form.business_name || "");
      fd.append("phone", form.phone || "");
      fd.append("address", form.address || "");
      fd.append("city", form.city || "");
      fd.append("state", form.state || "");
      fd.append("license_number", form.license_number || "");
      if (form.license_expiration_date) {
        fd.append("license_expiration_date", form.license_expiration_date);
      }

      // send skills both as repeated field and as JSON string (backend compatibility)
      form.skills.forEach((s) => fd.append("skills", s));
      fd.append("skills_json", JSON.stringify(form.skills));

      if (logoFile) fd.append("logo", logoFile);

      let id = contractorId;
      if (!id) {
        try {
          const me = await api.get("/projects/contractors/me/");
          id = me?.data?.id ?? me?.data?.pk;
          setContractorId(id || null);
        } catch { /* ignore */ }
      }

      const url = id
        ? `/projects/contractors/${id}/`
        : `/projects/contractors/me/`;

      await api.patch(url, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setSuccess("Profile saved.");
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

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-3xl bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-2xl font-bold mb-4">My Contractor Profile</h2>

        {error ? (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-red-700">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-700">
            {success}
          </div>
        ) : null}

        {loading ? (
          <div className="text-slate-600">Loading…</div>
        ) : (
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
                  className="w-full h-10 rounded border border-slate-300 px-3 bg-slate-100"
                  value={form.email}
                  onChange={onChange("email")}
                  placeholder="you@example.com"
                  disabled
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

            {/* Address */}
            <div className="mt-4">
              <label className="block text-sm font-semibold mb-1">Address</label>
              <input
                className="w-full h-10 rounded border border-slate-300 px-3"
                value={form.address}
                onChange={onChange("address")}
                placeholder="Street address"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div>
                <label className="block text-sm font-semibold mb-1">City</label>
                <input
                  className="w-full h-10 rounded border border-slate-300 px-3"
                  value={form.city}
                  onChange={onChange("city")}
                  placeholder="City"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">State</label>
                <select
                  className="w-full h-10 rounded border border-slate-300 px-3 bg-white"
                  value={form.state || ""}
                  onChange={onChange("state")}
                >
                  <option value="">Select…</option>
                  {stateOptions.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">Company Logo</label>
                <input type="file" accept="image/*" onChange={onLogo} />
                {logoPreview ? (
                  <img
                    src={logoPreview}
                    alt="Company logo preview"
                    className="mt-2 h-16 w-auto rounded border"
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
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSkill(name)}
                      />
                      {name}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* License */}
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
        )}
      </div>
    </div>
  );
}
