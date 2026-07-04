import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamHubTabs } from "../components/dashboard/hubTabsConfig.js";

function roleLabel(value) {
  return String(value || "")
    .replace(/^employee_/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Employee";
}

function bySkillName(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""));
}

export default function TeamEmployeeDetailPage() {
  const { subaccountId } = useParams();
  const navigate = useNavigate();
  const [employee, setEmployee] = useState(null);
  const [catalog, setCatalog] = useState({ skills: [], skill_levels: [] });
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [capabilities, setCapabilities] = useState([]);
  const [newSkillId, setNewSkillId] = useState("");
  const [newSkillLevel, setNewSkillLevel] = useState("working");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [employeeRes, catalogRes, scheduleRes] = await Promise.all([
        api.get(`/projects/subaccounts/${subaccountId}/`),
        api.get("/projects/workforce/catalog/"),
        api.get(`/projects/subaccounts/${subaccountId}/schedule/`).catch(() => ({ data: null })),
      ]);
      setEmployee(employeeRes.data || null);
      setCapabilities(Array.isArray(employeeRes.data?.capabilities) ? employeeRes.data.capabilities : []);
      setCatalog(catalogRes.data || { skills: [], skill_levels: [] });
      setSchedule(scheduleRes.data || null);
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

  const workingDays = schedule
    ? ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].filter((day) => schedule[`work_${day}`]).length
    : null;

  return (
    <ContractorPageSurface variant="operational" contentClassName="mx-auto max-w-6xl">
      <div className="space-y-6" data-testid="team-employee-detail-page">
        <HubTabs tabs={teamHubTabs} />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link to="/app/team/members" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
              Back to Employees
            </Link>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-950">
              {employee?.display_name || "Employee profile"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Permission role controls app access. Trade capabilities describe the work this employee can perform.
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
            <section className="grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Email</div>
                <div className="mt-2 text-sm font-bold text-slate-950">{employee?.email || "No email"}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="team-employee-permission-role">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Permission Role</div>
                <div className="mt-2 text-sm font-bold text-slate-950">{employee?.role_label || roleLabel(employee?.role)}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Status</div>
                <div className={`mt-2 text-sm font-bold ${employee?.is_active ? "text-emerald-700" : "text-slate-500"}`}>
                  {employee?.is_active ? "Active" : "Inactive"}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Workload</div>
                <div className="mt-2 text-sm font-bold text-slate-950">
                  {Number(employee?.active_assignment_count || 0)} active / {Number(employee?.pending_review_count || 0)} review
                </div>
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-capabilities-section">
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
                    No capabilities assigned. Add trade skills so this employee can be found in workforce planning.
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
              </div>

              <aside className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-schedule-summary">
                  <h2 className="text-base font-bold text-slate-950">Schedule Summary</h2>
                  {schedule ? (
                    <p className="mt-2 text-sm text-slate-600">
                      {workingDays} working day{workingDays === 1 ? "" : "s"} configured.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-slate-600">No schedule summary available yet.</p>
                  )}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="team-employee-assigned-work-summary">
                  <h2 className="text-base font-bold text-slate-950">Assigned Work</h2>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-lg font-bold text-slate-950">{Number(employee?.assignment_count || 0)}</div>
                      <div className="text-[11px] font-semibold text-slate-500">Total</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-lg font-bold text-slate-950">{Number(employee?.active_assignment_count || 0)}</div>
                      <div className="text-[11px] font-semibold text-slate-500">Active</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2">
                      <div className="text-lg font-bold text-slate-950">{Number(employee?.overdue_milestone_count || 0)}</div>
                      <div className="text-[11px] font-semibold text-slate-500">Overdue</div>
                    </div>
                  </div>
                </div>
              </aside>
            </section>
          </>
        )}
      </div>
    </ContractorPageSurface>
  );
}
