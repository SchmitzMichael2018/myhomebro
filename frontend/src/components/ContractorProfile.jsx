// src/components/ContractorProfile.jsx

import React, { useState, useEffect, useCallback } from "react";
import InputMask from "react-input-mask";
import { Link } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";

const SKILL_OPTIONS = [
  "Masonry", "Roofing", "Windows", "Drywall", "Tile", "Plumbing",
  "Electrical", "Painting", "Landscaping", "Flooring", "HVAC",
  "Carpentry", "Concrete", "Siding", "Insulation",
];

export default function ContractorProfile() {
  const { user } = useAuth();
  const contractorId = user?.contractor_id;

  const [form, setForm] = useState({
    business_name: "",
    phone: "",
    address: "",
    skills: [],
    license_number: "",
    license_expiration: "",
    logo: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/contractors/me/");
      setForm({
        business_name: data.business_name || "",
        phone: data.phone || "",
        address: data.address || "",
        skills: data.skills || [],
        license_number: data.license_number || "",
        license_expiration: data.license_expiration || "",
        logo: data.logo || "",
      });
      setLogoPreview(data.logo || "");
    } catch (err) {
      console.error("Failed to load profile:", err);
      toast.error("Could not load your profile data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSkillsChange = (skill) => {
    setForm(prev => {
      const newSkills = prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill];
      return { ...prev, skills: newSkills };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/contractors/me/", form);
      toast.success("Profile updated successfully.");
    } catch (err) {
      console.error("Save failed:", err);
      const errorMsg = err.response?.data?.detail || "Failed to update profile.";
      toast.error(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("logo", file);

    try {
      const response = await api.post("/contractors/upload-logo/", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const newUrl = response.data.logo;
      toast.success("Logo uploaded successfully.");
      setLogoPreview(newUrl);
      fetchProfile(); // refresh profile
    } catch (err) {
      console.error("Logo upload failed:", err);
      toast.error("Logo upload failed.");
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

      <div className="space-y-6">
        <Input label="Full Name" name="name" value={user?.name || ""} disabled />
        <Input label="Email Address" name="email" type="email" value={user?.email || ""} disabled />

        <hr />

        <Input label="Business Name" name="business_name" value={form.business_name} onChange={handleChange} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <InputMask mask="(999) 999-9999" value={form.phone} onChange={handleChange}>
            {(inputProps) => <input {...inputProps} name="phone" className="form-input" />}
          </InputMask>
        </div>

        <Input label="Address" name="address" value={form.address} onChange={handleChange} />

        {/* Logo Upload */}
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
            onChange={handleLogoUpload}
            className="block w-full text-sm text-gray-600"
          />
        </div>

        {/* Skills */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Skills</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {SKILL_OPTIONS.map(skill => (
              <label key={skill} className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.skills.includes(skill)}
                  onChange={() => handleSkillsChange(skill)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{skill}</span>
              </label>
            ))}
          </div>
        </div>

        <Input label="License Number" name="license_number" value={form.license_number} onChange={handleChange} />
        <Input
          label="License Expiration Date"
          name="license_expiration"
          type="date"
          value={form.license_expiration}
          onChange={handleChange}
        />

        <div className="pt-4">
          <button
            onClick={handleSave}
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
        className={`form-input ${disabled ? 'bg-gray-100' : ''}`}
        disabled={disabled}
        {...props}
      />
    </div>
  );
}
