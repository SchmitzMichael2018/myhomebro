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
  const [skillCatalog, setSkillCatalog] = useState([]);
  const [skillLevels, setSkillLevels] = useState([]);
  const [capabilities, setCapabilities] = useState([]);
  const [newSkillId, setNewSkillId] = useState("");
  const [newSkillLevel, setNewSkillLevel] = useState("working");

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
      const [profileRes, catalogRes] = await Promise.all([
        api.get("/projects/employee/profile/"),
        api.get("/projects/workforce/catalog/"),
      ]);
      const res = profileRes;
      const p = res.data?.profile || null;
      const catalog = Array.isArray(catalogRes.data?.skills) ? catalogRes.data.skills : [];
      const levels = Array.isArray(catalogRes.data?.skill_levels) ? catalogRes.data.skill_levels : [];
      setProfile(p);
      setSkillCatalog(catalog);
      setSkillLevels(levels);
      setCapabilities(
        Array.isArray(p?.capabilities)
          ? p.capabilities.map((item) => ({
              skill_id: item.skill_id,
              skill_name: item.skill_name,
              skill_slug: item.skill_slug,
              skill_level: item.skill_level || "working",
              skill_level_label: item.skill_level_label || "Working",
            }))
          : []
      );
      setNewSkillLevel(levels[1]?.value || levels[0]?.value || "working");

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
      fd.append(
        "capabilities_json",
        JSON.stringify(
          capabilities
            .filter((item) => item.skill_id && item.skill_level)
            .map((item) => ({
              skill_id: Number(item.skill_id),
              skill_level: item.skill_level,
            }))
        )
      );

      if (photoFile) fd.append("photo", photoFile);
      if (dlFile) fd.append("drivers_license_file", dlFile);
      if (plFile) fd.append("professional_license_file", plFile);

      const res = await api.patch("/projects/employee/profile/", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const p = res.data?.profile || null;
      setProfile(p);
      setCapabilities(
        Array.isArray(p?.capabilities)
          ? p.capabilities.map((item) => ({
              skill_id: item.skill_id,
              skill_name: item.skill_name,
              skill_slug: item.skill_slug,
              skill_level: item.skill_level || "working",
              skill_level_label: item.skill_level_label || "Working",
            }))
          : []
      );

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

  function skillLabel(skillId) {
    const row = skillCatalog.find((skill) => String(skill.id) === String(skillId));
    return row?.name || "Capability";
  }

  function levelLabel(value) {
    const row = skillLevels.find((level) => String(level.value) === String(value));
    return row?.label || String(value || "Working");
  }

  function addCapability() {
    if (!newSkillId) return;
    if (capabilities.some((item) => String(item.skill_id) === String(newSkillId))) {
      setErr("That capability is already listed.");
      return;
    }
    setErr("");
    setCapabilities((current) => [
      ...current,
      {
        skill_id: Number(newSkillId),
        skill_name: skillLabel(newSkillId),
        skill_level: newSkillLevel || "working",
        skill_level_label: levelLabel(newSkillLevel || "working"),
      },
    ]);
    setNewSkillId("");
  }

  function removeCapability(skillId) {
    setCapabilities((current) => current.filter((item) => String(item.skill_id) !== String(skillId)));
  }

  function updateCapabilityLevel(skillId, level) {
    setCapabilities((current) =>
      current.map((item) =>
        String(item.skill_id) === String(skillId)
          ? { ...item, skill_level: level, skill_level_label: levelLabel(level) }
          : item
      )
    );
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

          <div className="mt-6 rounded-2xl bg-white border border-slate-200 p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="font-semibold text-slate-900">Capabilities</div>
                <div className="mt-1 text-sm text-slate-500">
                  Track the trades and skill levels you can be assigned for later workforce planning.
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
              <Field label="Trade / Skill">
                <select
                  value={newSkillId}
                  onChange={(event) => setNewSkillId(event.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  data-testid="employee-capability-skill-select"
                >
                  <option value="">Select capability</option>
                  {skillCatalog
                    .filter((skill) => !capabilities.some((item) => String(item.skill_id) === String(skill.id)))
                    .map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="Skill Level">
                <select
                  value={newSkillLevel}
                  onChange={(event) => setNewSkillLevel(event.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  data-testid="employee-capability-level-select"
                >
                  {skillLevels.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={addCapability}
                  disabled={!newSkillId}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  data-testid="employee-capability-add"
                >
                  Add capability
                </button>
              </div>
            </div>

            <div className="mt-4">
              {capabilities.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No capabilities listed yet.
                </div>
              ) : (
                <div className="flex flex-wrap gap-3" data-testid="employee-capabilities-list">
                  {capabilities.map((capability) => (
                    <div
                      key={capability.skill_id}
                      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {capability.skill_name || skillLabel(capability.skill_id)}
                        </div>
                        <div className="text-xs text-slate-500">{levelLabel(capability.skill_level)}</div>
                      </div>
                      <select
                        value={capability.skill_level}
                        onChange={(event) => updateCapabilityLevel(capability.skill_id, event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm"
                        aria-label={`Skill level for ${capability.skill_name || skillLabel(capability.skill_id)}`}
                      >
                        {skillLevels.map((level) => (
                          <option key={level.value} value={level.value}>
                            {level.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeCapability(capability.skill_id)}
                        className="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
