// src/components/ContractorProfile.jsx
import React, { useState, useEffect, useCallback } from "react";
import InputMask from "react-input-mask";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";

const SKILL_OPTIONS = [
  "masonry", "roofing", "windows", "drywall", "tile", "plumbing",
  "electrical", "painting", "landscaping", "flooring", "hvac",
  "carpentry", "concrete", "siding", "insulation",
];

const toISO = (v) => {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const [_, mm, dd, yyyy] = m;
    const pad = (n) => String(n).padStart(2, "0");
    return `${yyyy}-${pad(mm)}-${pad(dd)}`;
  }
  return v;
};

export default function ContractorProfile() {
  const { user } = useAuth();
  const contractorId = user?.contractor_id;

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    business_name: "",
    phone: "",
    address: "",
    skills: [],
    license_number: "",
    license_expiration: "",
  });

  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setErrors(null);
    try {
      // Try top-level, then projects-namespaced endpoint
      let data = null;
      for (const url of ["/contractors/me/", "/projects/contractors/me/"]) {
        try { data = (await api.get(url)).data; break; } catch (_e) {}
      }
      if (!data) throw new Error("Profile endpoint not found.");

      setForm({
        full_name: data.name || data.user_name || "",
        email: data.email || data.user_email || "",
        business_name: data.business_name || "",
        phone: data.phone || "",
        address: data.address || "",
        skills:
          Array.isArray(data.skills) ? data.skills.map((s) => (s?.slug || s?.name || s)).map((x) => String(x).toLowerCase()) : [],
        license_number: data.license_number || "",
        license_expiration: (data.license_expiration || data.license_expiration_date || "").slice(0, 10),
      });
      setLogoPreview(data.logo_url || data.logo || "");
    } catch (err) {
      console.error("Failed to load profile:", err);
      setErrors({ detail: "Could not load your profile data." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const onChange = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const toggleSkill = (slug) =>
    setForm((p) => ({
      ...p,
      skills: p.skills.includes(slug)
        ? p.skills.filter((s) => s !== slug)
        : [...p.skills, slug],
    }));

  const save = async () => {
    setSaving(true);
    setErrors(null);
    try {
      const payloadIsFormData = !!logoFile;
      let payload;
      let headers = {};

      if (payloadIsFormData) {
        payload = new FormData();
        Object.entries({
          full_name: form.full_name || undefined,
          email: form.email || undefined,
          business_name: form.business_name || undefined,
          phone: form.phone || undefined,
          address: form.address || undefined,
          license_number: form.license_number || undefined,
          license_expiration: toISO(form.license_expiration) || undefined,
        })
          .filter(([, v]) => v !== undefined)
          .forEach(([k, v]) => payload.append(k, v));

        (form.skills || []).forEach((s) => payload.append("skills", String(s).toLowerCase()));
        payload.append("logo", logoFile);
      } else {
        payload = {
          full_name: form.full_name || undefined,
          email: form.email || undefined,
          business_name: form.business_name || undefined,
          phone: form.phone || undefined,
          address: form.address || undefined,
          license_number: form.license_number || undefined,
          license_expiration: toISO(form.license_expiration) || undefined,
          skills: (form.skills || []).map((s) => String(s).toLowerCase()),
        };
        headers["Content-Type"] = "application/json";
      }

      // PATCH (partial) – try both routes
      let ok = false;
      for (const url of ["/contractors/me/", "/projects/contractors/me/"]) {
        try { await api.patch(url, payload, { headers }); ok = true; break; }
        catch (err) {
          const code = err?.response?.status;
          if (code && ![404, 405].includes(code)) throw err;
        }
      }
      if (!ok) throw new Error("No profile endpoint accepted the request.");

      // update preview if a new logo was chosen
      if (logoFile) {
        const url = URL.createObjectURL(logoFile);
        setLogoPreview(url);
        setLogoFile(null);
      }

      toast.success("Profile updated successfully.");
      setErrors(null);
    } catch (err) {
      console.error("Save failed:", err);
      const d = err?.response?.data;
      setErrors(d || { detail: "Failed to update profile. Check your entries and try again." });
      toast.error(d?.detail || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-center text-gray-500">Loading profile...</div>;

  return (
    <div className="max-w-2xl mx-auto p-8 bg-white rounded-lg shadow-md">
      <h2 className="text-3xl font-bold mb-6 text-gray-800">My Contractor Profile</h2>

      {contractorId && (
        <div className="text-right mb-4">
          <Link
            to={`/contractors/${contractorId}/profile`}
            className="text-blue-600 underline text-sm hover:text-blue-800"
          >
            View Public Profile
          </Link>
        </div>
      )}

      {/* show top-level errors */}
      {errors && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errors.detail && <div>{errors.detail}</div>}
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(errors)
              .filter(([k]) => k !== "detail")
              .map(([k, v]) => (
                <li key={k}>
                  <strong>{k}:</strong> {Array.isArray(v) ? v.join(", ") : String(v)}
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="space-y-6">
        {/* Contact (editable) */}
        <Input label="Full Name" name="full_name" value={form.full_name} onChange={onChange} />
        <Input label="Email Address" name="email" type="email" value={form.email} onChange={onChange} />

        <hr />

        <Input label="Business Name" name="business_name" value={form.business_name} onChange={onChange} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <InputMask mask="(999) 999-9999" value={form.phone} onChange={onChange}>
            {(inputProps) => <input {...inputProps} name="phone" className="form-input" />}
          </InputMask>
        </div>

        <Input label="Address" name="address" value={form.address} onChange={onChange} />

        {/* Logo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company Logo</label>
          {logoPreview && (
            <img
              src={logoPreview}
              alt="Company Logo"
              className="w-32 h-32 object-contain border rounded mb-2"
            />
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-600"
          />
        </div>

        {/* Skills */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Skills</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {SKILL_OPTIONS.map((slug) => (
              <label key={slug} className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100 cursor-pointer capitalize">
                <input
                  type="checkbox"
                  checked={form.skills.includes(slug)}
                  onChange={() => toggleSkill(slug)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{slug}</span>
              </label>
            ))}
          </div>
        </div>

        <Input label="License Number" name="license_number" value={form.license_number} onChange={onChange} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">License Expiration Date</label>
          <input
            type="date"
            name="license_expiration"
            value={form.license_expiration?.slice(0, 10) || ""}
            onChange={onChange}
            className="form-input"
          />
        </div>

        <div className="pt-4">
          <button
            onClick={save}
            disabled={saving}
            className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, disabled = false, ...props }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        className={`form-input ${disabled ? "bg-gray-100" : ""}`}
        disabled={disabled}
        {...props}
      />
    </div>
  );
}
