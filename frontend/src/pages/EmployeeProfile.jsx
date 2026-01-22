// frontend/src/pages/EmployeeProfile.jsx
// v2026-01-06 — Real Employee Profile UI (DB-backed fields)
// Uses:
//   GET   /projects/employee/profile/
//   PATCH /projects/employee/profile/  (multipart form-data)

import React, { useEffect, useState } from "react";
import api from "../api";

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}

export default function EmployeeProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [profile, setProfile] = useState(null);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone_number: "",
    home_address_line1: "",
    home_address_line2: "",
    home_city: "",
    home_state: "",
    home_postal_code: "",
    drivers_license_number: "",
    drivers_license_state: "",
    drivers_license_expiration: "",
    professional_license_type: "",
    professional_license_number: "",
    professional_license_expiration: "",
    assigned_work_schedule: "",
    day_off_requests: "",
  });

  const [photoFile, setPhotoFile] = useState(null);
  const [dlFile, setDlFile] = useState(null);
  const [plFile, setPlFile] = useState(null);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await api.get("/projects/employee/profile/");
      const p = res.data?.profile || null;
      setProfile(p);

      setForm({
        first_name: p?.first_name || "",
        last_name: p?.last_name || "",
        phone_number: p?.phone_number || "",
        home_address_line1: p?.home_address_line1 || "",
        home_address_line2: p?.home_address_line2 || "",
        home_city: p?.home_city || "",
        home_state: p?.home_state || "",
        home_postal_code: p?.home_postal_code || "",
        drivers_license_number: p?.drivers_license_number || "",
        drivers_license_state: p?.drivers_license_state || "",
        drivers_license_expiration: p?.drivers_license_expiration || "",
        professional_license_type: p?.professional_license_type || "",
        professional_license_number: p?.professional_license_number || "",
        professional_license_expiration: p?.professional_license_expiration || "",
        assigned_work_schedule: p?.assigned_work_schedule || "",
        day_off_requests: p?.day_off_requests || "",
      });

      setPhotoFile(null);
      setDlFile(null);
      setPlFile(null);
    } catch (e) {
      console.error(e);
      setErr("Unable to load employee profile.");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onChange(e) {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const fd = new FormData();

      Object.entries(form).forEach(([k, v]) => {
        fd.append(k, v ?? "");
      });

      if (photoFile) fd.append("photo", photoFile);
      if (dlFile) fd.append("drivers_license_file", dlFile);
      if (plFile) fd.append("professional_license_file", plFile);

      const res = await api.patch("/projects/employee/profile/", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const p = res.data?.profile || null;
      setProfile(p);

      setPhotoFile(null);
      setDlFile(null);
      setPlFile(null);
    } catch (e) {
      console.error(e);
      setErr("Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Profile</h1>
          <div className="text-sm text-slate-600 mt-1">
            Employee profile details (saved to your account).
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            className="rounded-lg border px-4 py-2 font-semibold bg-white hover:bg-slate-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={`rounded-lg px-4 py-2 font-semibold text-white ${
              saving ? "bg-slate-400" : "bg-slate-900 hover:bg-slate-800"
            }`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">
          {err}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-slate-500">Loading…</div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-2xl bg-white border border-slate-200 p-5">
              <div className="font-semibold text-slate-900 mb-3">Photo</div>

              {profile?.photo_url ? (
                <img
                  src={profile.photo_url}
                  alt="Employee"
                  className="w-full rounded-xl border"
                />
              ) : (
                <div className="text-sm text-slate-500">No photo uploaded.</div>
              )}

              <div className="mt-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-5 md:col-span-2">
              <div className="font-semibold text-slate-900 mb-3">Basic Info</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="First Name">
                  <input
                    name="first_name"
                    value={form.first_name}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>

                <Field label="Last Name">
                  <input
                    name="last_name"
                    value={form.last_name}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>

                <Field label="Phone Number">
                  <input
                    name="phone_number"
                    value={form.phone_number}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-white border border-slate-200 p-5">
            <div className="font-semibold text-slate-900 mb-3">Home Address</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Address Line 1">
                <input
                  name="home_address_line1"
                  value={form.home_address_line1}
                  onChange={onChange}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </Field>

              <Field label="Address Line 2">
                <input
                  name="home_address_line2"
                  value={form.home_address_line2}
                  onChange={onChange}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </Field>

              <Field label="City">
                <input
                  name="home_city"
                  value={form.home_city}
                  onChange={onChange}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </Field>

              <Field label="State">
                <input
                  name="home_state"
                  value={form.home_state}
                  onChange={onChange}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </Field>

              <Field label="Postal Code">
                <input
                  name="home_postal_code"
                  value={form.home_postal_code}
                  onChange={onChange}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </Field>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl bg-white border border-slate-200 p-5">
              <div className="font-semibold text-slate-900 mb-3">Driver’s License</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="License Number">
                  <input
                    name="drivers_license_number"
                    value={form.drivers_license_number}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>

                <Field label="State">
                  <input
                    name="drivers_license_state"
                    value={form.drivers_license_state}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>

                <Field label="Expiration">
                  <input
                    type="date"
                    name="drivers_license_expiration"
                    value={form.drivers_license_expiration || ""}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>
              </div>

              <div className="mt-3">
                {profile?.drivers_license_file_url ? (
                  <a
                    className="text-blue-700 font-semibold underline"
                    href={profile.drivers_license_file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View current license file
                  </a>
                ) : (
                  <div className="text-sm text-slate-500">No license file uploaded.</div>
                )}
              </div>

              <div className="mt-2">
                <input
                  type="file"
                  onChange={(e) => setDlFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-5">
              <div className="font-semibold text-slate-900 mb-3">Professional License</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="License Type">
                  <input
                    name="professional_license_type"
                    value={form.professional_license_type}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>

                <Field label="License Number">
                  <input
                    name="professional_license_number"
                    value={form.professional_license_number}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>

                <Field label="Expiration">
                  <input
                    type="date"
                    name="professional_license_expiration"
                    value={form.professional_license_expiration || ""}
                    onChange={onChange}
                    className="w-full border rounded-lg px-3 py-2"
                  />
                </Field>
              </div>

              <div className="mt-3">
                {profile?.professional_license_file_url ? (
                  <a
                    className="text-blue-700 font-semibold underline"
                    href={profile.professional_license_file_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View current professional license file
                  </a>
                ) : (
                  <div className="text-sm text-slate-500">No professional license file uploaded.</div>
                )}
              </div>

              <div className="mt-2">
                <input
                  type="file"
                  onChange={(e) => setPlFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-white border border-slate-200 p-5">
            <div className="font-semibold text-slate-900 mb-3">Schedule & Time Off</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Assigned Work Schedule">
                <textarea
                  name="assigned_work_schedule"
                  value={form.assigned_work_schedule}
                  onChange={onChange}
                  className="w-full border rounded-lg px-3 py-2 min-h-[120px]"
                />
              </Field>

              <Field label="Day Off Requests">
                <textarea
                  name="day_off_requests"
                  value={form.day_off_requests}
                  onChange={onChange}
                  className="w-full border rounded-lg px-3 py-2 min-h-[120px]"
                />
              </Field>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
