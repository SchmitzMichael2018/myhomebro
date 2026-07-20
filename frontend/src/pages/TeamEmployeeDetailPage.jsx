import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamOrganizationTabs } from "../components/dashboard/hubTabsConfig.js";

function roleLabel(value) {
  return String(value || "")
    .replace(/^employee_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Employee";
}

function bySkillName(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

const EMPTY_COMPENSATION = {
  cost_basis: "hourly",
  hourly_cost: "",
  annual_salary: "",
  standard_hours_per_week: "",
  overtime_multiplier: "",
  labor_cost_notes: "",
};

function compensationFromEmployee(employee) {
  return {
    cost_basis: employee?.cost_basis || "hourly",
    hourly_cost: employee?.hourly_cost || "",
    annual_salary: employee?.annual_salary || "",
    standard_hours_per_week: employee?.standard_hours_per_week || "",
    overtime_multiplier: employee?.overtime_multiplier || "",
    labor_cost_notes: employee?.labor_cost_notes || "",
  };
}

function formatMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDateTime(value) {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function setupStatusLabel(employee) {
  return employee?.setup_status_label || (employee?.last_login ? "Access Active" : "Setup Link Not Sent");
}

function setupActionLabel(employee) {
  const status = employee?.setup_status || "";
  if (status === "access_not_created") return "Create Access & Send Setup Link";
  if (status === "setup_pending") return "Resend Setup Link";
  if (status === "setup_link_expired") return "Send New Setup Link";
  return "Send Setup Link";
}

function shouldShowSetupAction(employee) {
  const status = employee?.setup_status || "";
  return status !== "access_active" && status !== "access_disabled";
}

function accessBadgeClass(employee) {
  const status = employee?.setup_status || "";
  if (status === "access_active") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "access_disabled") return "border-slate-200 bg-slate-100 text-slate-700";
  if (status === "setup_link_expired") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "setup_pending") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-white text-slate-700";
}

function CompensationInput({ label, name, value, onChange, testId }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      <input
        type="number"
        min="0"
        step="0.01"
        name={name}
        value={value || ""}
        onChange={onChange}
        data-testid={testId}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
      />
    </label>
  );
}

export default function TeamEmployeeDetailPage() {
  const { subaccountId } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [catalog, setCatalog] = useState({ skills: [], skill_levels: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [capabilities, setCapabilities] = useState([]);
  const [newSkillId, setNewSkillId] = useState("");
  const [newSkillLevel, setNewSkillLevel] = useState("working");
  const [compensation, setCompensation] = useState(EMPTY_COMPENSATION);
  const [compensationOpen, setCompensationOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeRes, catalogRes] = await Promise.all([
        api.get(`/projects/subaccounts/${subaccountId}/`),
        api.get("/projects/workforce/catalog/"),
      ]);
      setEmployee(employeeRes.data || null);
      setCapabilities(Array.isArray(employeeRes.data?.capabilities) ? employeeRes.data.capabilities : []);
      setCompensation(compensationFromEmployee(employeeRes.data));
      setCatalog(catalogRes.data || { skills: [], skill_levels: [] });
    } catch (err) {
      console.error(err);
      if (err?.response?.status === 404) {
        setError("Employee not found.");
      } else if (err?.response?.status === 403) {
        setError("You cannot edit this employee.");
      } else {
        setError("Could not load this employee.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [subaccountId]);

  const skillOptions = useMemo(() => {
    const used = new Set(capabilities.map((capability) => String(capability.skill_id)));
    return (Array.isArray(catalog.skills) ? catalog.skills : [])
      .filter((skill) => !used.has(String(skill.id)))
      .sort(bySkillName);
  }, [capabilities, catalog.skills]);

  const levels = Array.isArray(catalog.skill_levels) ? catalog.skill_levels : [];
  const canManageCompensation = employee && Object.prototype.hasOwnProperty.call(employee, "cost_basis");

  const saveCapabilities = async (nextCapabilities) => {
    setSaving(true);
    try {
      const payload = nextCapabilities.map((capability) => ({
        skill_id: capability.skill_id,
        skill_level: capability.skill_level,
      }));
      const { data } = await api.patch(`/projects/subaccounts/${subaccountId}/capabilities/`, {
        capabilities: payload,
      });
      setEmployee(data || null);
      setCapabilities(Array.isArray(data?.capabilities) ? data.capabilities : []);
      toast.success("Employee capabilities updated.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || err?.response?.data?.capabilities || "Could not update capabilities.");
    } finally {
      setSaving(false);
    }
  };

  const updateCompensation = (event) => {
    const { name, value } = event.target;
    setCompensation((current) => ({ ...current, [name]: value }));
  };

  const saveCompensation = async () => {
    setSaving(true);
    try {
      const payload = {
        cost_basis: compensation.cost_basis || "hourly",
        hourly_cost: compensation.hourly_cost || null,
        annual_salary: compensation.annual_salary || null,
        standard_hours_per_week: compensation.standard_hours_per_week || null,
        overtime_multiplier: compensation.overtime_multiplier || null,
        labor_cost_notes: compensation.labor_cost_notes || "",
      };
      const { data } = await api.patch(`/projects/subaccounts/${subaccountId}/`, payload);
      setEmployee(data || null);
      setCompensation(compensationFromEmployee(data));
      toast.success("Labor cost profile updated.");
    } catch (err) {
      console.error(err);
      const errors = err?.response?.data || {};
      const firstError = Object.values(errors).flat?.()?.[0];
      toast.error(err?.response?.data?.detail || firstError || "Could not update labor cost profile.");
    } finally {
      setSaving(false);
    }
  };

  const toggleAccess = async () => {
    if (!employee) return;
    const nextEnabled = !employee.is_active;
    const confirmed = window.confirm(
      `${nextEnabled ? "Enable" : "Disable"} application access for ${employee.display_name || "this employee"}?`
    );
    if (!confirmed) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`/projects/subaccounts/${subaccountId}/`, { is_active: nextEnabled });
      setEmployee(data || null);
      setCapabilities(Array.isArray(data?.capabilities) ? data.capabilities : capabilities);
      setCompensation(compensationFromEmployee(data));
      toast.success(nextEnabled ? "Application access enabled." : "Application access disabled.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Could not update application access.");
    } finally {
      setSaving(false);
    }
  };

  const sendSetupLink = async () => {
    if (!employee) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/projects/subaccounts/${subaccountId}/send-setup-link/`);
      setEmployee((current) => ({
        ...current,
        setup_status: data?.setup_status || current?.setup_status,
        setup_status_label: data?.setup_status_label || current?.setup_status_label,
        setup_sent_at: data?.setup_sent_at || current?.setup_sent_at,
        setup_completed_at: null,
        application_access_enabled: false,
        has_usable_password: false,
      }));
      toast.success("Account setup link sent.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || err?.response?.data?.email || "Could not send setup link.");
    } finally {
      setSaving(false);
    }
  };

  const addCapability = () => {
    if (!newSkillId) return;
    const skill = (catalog.skills || []).find((item) => String(item.id) === String(newSkillId));
    if (!skill) return;
    saveCapabilities([
      ...capabilities,
      {
        id: `new-${skill.id}`,
        skill_id: skill.id,
        skill_name: skill.name,
        skill_slug: skill.slug,
        skill_level: newSkillLevel,
        skill_level_label: levels.find((level) => level.value === newSkillLevel)?.label || newSkillLevel,
      },
    ]);
    setNewSkillId("");
    setNewSkillLevel("working");
  };

  const changeLevel = (skillId, nextLevel) => {
    saveCapabilities(
      capabilities.map((capability) =>
        String(capability.skill_id) === String(skillId)
          ? { ...capability, skill_level: nextLevel }
          : capability
      )
    );
  };

  const removeCapability = (skillId) => {
    saveCapabilities(capabilities.filter((capability) => String(capability.skill_id) !== String(skillId)));
  };

  return (
    <ContractorPageSurface variant="operational" contentClassName="mx-auto max-w-6xl">
      <div className="space-y-6" data-testid="team-employee-detail-page">
        <HubTabs tabs={teamOrganizationTabs} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to="/app/team/members" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
              Back to Employees
            </Link>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-950">
              {employee?.display_name || "Employee profile"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Permission role controls app access. Trade capabilities describe this employee's skills and profile completeness.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/app/team/members")}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Employees
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-600">
            Loading employee profile...
          </div>
        ) : error ? (
          <div data-testid="team-employee-detail-error" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-950">
            {error}
          </div>
        ) : (
          <>
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-profile-summary">
                <h2 className="text-base font-bold text-slate-950">Profile Summary</h2>
                <dl className="mt-4 grid gap-3 text-sm text-slate-600">
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Name</dt>
                    <dd className="text-right font-bold text-slate-950">{employee?.display_name || "Unnamed employee"}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Email</dt>
                    <dd className="min-w-0 break-all text-right font-bold text-slate-950">{employee?.email || "No email"}</dd>
                  </div>
                  {employee?.phone_number ? (
                    <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                      <dt>Phone</dt>
                      <dd className="text-right font-bold text-slate-950">{employee.phone_number}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Member Type</dt>
                    <dd className="font-bold text-slate-950">Employee</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Member Status</dt>
                    <dd className={`font-bold ${employee?.is_active ? "text-emerald-700" : "text-slate-500"}`}>
                      {employee?.is_active ? "Active" : "Inactive"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2" data-testid="team-employee-permission-role">
                    <dt>Assigned Role</dt>
                    <dd className="text-right font-bold text-slate-950">{employee?.role_label || roleLabel(employee?.role)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Profile Completeness</dt>
                    <dd className="text-right font-bold text-slate-950">
                      {capabilities.length ? `${capabilities.length} capabilities recorded` : "Capabilities missing"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-account-access-summary">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-950">Account Access</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Send a secure setup link so this team member can create their login credentials.
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${accessBadgeClass(employee)}`}>
                    {setupStatusLabel(employee)}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-sm text-slate-600">
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Application Access</dt>
                    <dd className="text-right font-bold text-slate-950">{setupStatusLabel(employee)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Login Email</dt>
                    <dd className="min-w-0 break-all text-right font-bold text-slate-950">{employee?.email || "No email"}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Setup Link Sent</dt>
                    <dd className="text-right font-bold text-slate-950">{formatDateTime(employee?.setup_sent_at)}</dd>
                  </div>
                  {employee?.setup_completed_at ? (
                    <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                      <dt>Setup Completed</dt>
                      <dd className="text-right font-bold text-slate-950">{formatDateTime(employee.setup_completed_at)}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                    <dt>Last Login</dt>
                    <dd className="text-right font-bold text-slate-950">{employee?.last_login ? new Date(employee.last_login).toLocaleDateString() : "Never"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Permission Role</dt>
                    <dd className="text-right font-bold text-slate-950">{employee?.role_label || roleLabel(employee?.role)}</dd>
                  </div>
                </dl>
                {employee?.setup_status === "setup_pending" && employee?.email ? (
                  <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">
                    A setup link was sent to {employee.email}. The member must complete setup before signing in.
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {shouldShowSetupAction(employee) ? (
                    <button
                      type="button"
                      onClick={sendSetupLink}
                      disabled={saving}
                      className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-60"
                      data-testid="team-employee-send-setup-link"
                    >
                      {setupActionLabel(employee)}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={toggleAccess}
                    disabled={saving}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    data-testid="team-employee-toggle-access"
                  >
                    {employee?.is_active ? "Disable Access" : "Enable Access"}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-permissions-section">
              <h2 className="text-lg font-bold text-slate-950">Permissions</h2>
              <p className="mt-1 text-sm text-slate-600">
                Permission role controls app access level. It is separate from member status and login setup.
              </p>
              <dl className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Member Status</dt>
                  <dd className="mt-1 font-bold text-slate-950">{employee?.is_active ? "Active" : "Inactive"}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Application Access</dt>
                  <dd className="mt-1 font-bold text-slate-950">{setupStatusLabel(employee)}</dd>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Permission Role</dt>
                  <dd className="mt-1 font-bold text-slate-950">{employee?.role_label || roleLabel(employee?.role)}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-capabilities-section">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">Trade Capabilities</h2>
                  <p className="mt-1 text-sm text-slate-600">Capabilities are trade skills, separate from permission roles.</p>
                </div>
                {saving ? <span className="text-sm font-semibold text-slate-500">Saving...</span> : null}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
                <select
                  data-testid="team-employee-add-skill"
                  value={newSkillId}
                  onChange={(event) => setNewSkillId(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Add trade / skill</option>
                  {skillOptions.map((skill) => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </select>
                <select
                  data-testid="team-employee-add-level"
                  value={newSkillLevel}
                  onChange={(event) => setNewSkillLevel(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {levels.map((level) => (
                    <option key={level.value} value={level.value}>{level.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="team-employee-add-capability"
                  onClick={addCapability}
                  disabled={!newSkillId || saving}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add
                </button>
              </div>

              {capabilities.length === 0 ? (
                <div data-testid="team-employee-no-capabilities" className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                  No capabilities assigned. Add trade skills so this employee profile is complete.
                </div>
              ) : (
                <div className="mt-5 space-y-3" data-testid="team-employee-capability-list">
                  {capabilities.map((capability) => (
                    <div key={capability.skill_id} data-testid={`team-employee-capability-${capability.skill_id}`} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-bold text-slate-950">{capability.skill_name}</div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Trade capability</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <select
                          aria-label={`Skill level for ${capability.skill_name}`}
                          data-testid={`team-employee-capability-level-${capability.skill_id}`}
                          value={capability.skill_level}
                          onChange={(event) => changeLevel(capability.skill_id, event.target.value)}
                          disabled={saving}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          {levels.map((level) => (
                            <option key={level.value} value={level.value}>{level.label}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          data-testid={`team-employee-capability-remove-${capability.skill_id}`}
                          onClick={() => removeCapability(capability.skill_id)}
                          disabled={saving}
                          className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {canManageCompensation ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-compensation-section">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-slate-950">Compensation</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Owner-only internal cost assumptions. This does not change payroll or payments.
                    </p>
                  </div>
                  <div className="rounded-lg bg-slate-950 px-3 py-2 text-right text-white" data-testid="team-employee-effective-hourly-cost">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Effective hourly</div>
                    <div className="text-base font-black">{formatMoney(employee?.calculated_effective_hourly_cost)}</div>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="team-employee-edit-compensation"
                  onClick={() => setCompensationOpen((value) => !value)}
                  disabled={saving}
                  className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {compensationOpen ? "Hide Compensation Fields" : "Edit Compensation"}
                </button>

                {compensationOpen ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <label className="block">
                      <span className="text-sm font-semibold text-slate-700">Cost basis</span>
                      <select
                        name="cost_basis"
                        data-testid="team-employee-cost-basis"
                        value={compensation.cost_basis}
                        onChange={updateCompensation}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="hourly">Hourly</option>
                        <option value="salary">Salary</option>
                      </select>
                    </label>
                    <CompensationInput label="Hourly cost" name="hourly_cost" value={compensation.hourly_cost} onChange={updateCompensation} testId="team-employee-hourly-cost" />
                    <CompensationInput label="Annual salary" name="annual_salary" value={compensation.annual_salary} onChange={updateCompensation} testId="team-employee-annual-salary" />
                    <CompensationInput label="Standard hours / week" name="standard_hours_per_week" value={compensation.standard_hours_per_week} onChange={updateCompensation} testId="team-employee-standard-hours" />
                    <CompensationInput label="Overtime multiplier" name="overtime_multiplier" value={compensation.overtime_multiplier} onChange={updateCompensation} testId="team-employee-overtime-multiplier" />
                    <label className="block md:col-span-3">
                      <span className="text-sm font-semibold text-slate-700">Labor cost notes</span>
                      <textarea
                        name="labor_cost_notes"
                        data-testid="team-employee-labor-cost-notes"
                        value={compensation.labor_cost_notes}
                        onChange={updateCompensation}
                        rows={3}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        placeholder="Internal assumptions, burdened rate notes, or administrative caveats"
                      />
                    </label>
                    <button
                      type="button"
                      data-testid="team-employee-save-compensation"
                      onClick={saveCompensation}
                      disabled={saving}
                      className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 md:col-span-3 md:w-fit"
                    >
                      Save Compensation
                    </button>
                  </div>
                ) : null}
              </section>
            ) : null}

            <section className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-notes-section">
              <h2 className="text-lg font-bold text-slate-950">Notes</h2>
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {employee?.notes || "No notes recorded. Use Team Members to update supported profile notes."}
              </p>
            </section>
          </>
        )}
      </div>
    </ContractorPageSurface>
  );
}
