// src/pages/TeamPage.jsx
// Focused team administration workspace.

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";

import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamHubTabs } from "../components/dashboard/hubTabsConfig.js";
import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantPanel,
  ProjectAssistantSection,
} from "../components/ProjectAssistantExperience.jsx";

const ROLE_OPTIONS = [
  { value: "employee_readonly", label: "Read-only", summary: "Can view permitted account information with limited update access." },
  { value: "employee_milestones", label: "Completion Access", summary: "Can update permitted completion/status fields where authorized." },
  { value: "employee_supervisor", label: "Supervisor", summary: "Broader team administration access where authorized." },
];

const teamTabs = [
  { key: "members", label: "Members" },
  { key: "roles", label: "Roles" },
  { key: "capabilities", label: "Capabilities" },
  { key: "invitations", label: "Invitations" },
];

const operationalPanel = "mhb-operational-panel";
const operationalCard = "mhb-glass";
const operationalControl = "mhb-operational-control";
const operationalButton = "mhb-btn";
const operationalPrimaryButton = "mhb-btn primary";

function normalizeListResponse(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function formatDateTime(value) {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatDate(value) {
  if (!value) return "Never";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function formatRole(value) {
  return String(value || "")
    .replace(/^employee_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Role not set";
}

function capabilityLabel(capability) {
  const skill = capability?.skill_name || capability?.skill_slug || "Capability";
  const level = capability?.skill_level_label || capability?.skill_level || "";
  return level ? `${skill} - ${level}` : skill;
}

function capabilitySummary(row, limit = 2) {
  const capabilities = Array.isArray(row?.capabilities) ? row.capabilities : [];
  if (!capabilities.length) return "No capabilities recorded";
  const visible = capabilities.slice(0, limit).map(capabilityLabel);
  const hidden = capabilities.length - visible.length;
  return hidden > 0 ? `${visible.join(", ")} +${hidden} more` : visible.join(", ");
}

function statusBadgeClass(active) {
  return active
    ? "border-emerald-200/35 bg-emerald-400/12 text-emerald-100"
    : "border-white/12 bg-white/8 text-sky-100/70";
}

function EmptyState({ title, description, action = null }) {
  return (
    <div className={`${operationalCard} flex min-h-[11rem] items-center justify-center rounded-2xl px-5 py-7 text-center`} data-testid="team-empty-state">
      <div className="max-w-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-200/20 bg-sky-400/12 text-sky-100">
          <Users className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-lg font-black text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-sky-100/70">{description}</p>
        {action ? action : null}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, helper }) {
  return (
    <div className={`${operationalCard} rounded-xl px-4 py-3`}>
      <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/60">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{Number(value || 0).toLocaleString()}</div>
      {helper ? <div className="mt-1 text-xs font-semibold text-sky-100/60">{helper}</div> : null}
    </div>
  );
}

function MemberRow({ member, selected, onSelect }) {
  const accountStatus = member.last_login ? "Login active" : "Access not used";

  return (
    <article
      className={`${selected ? operationalPanel : operationalCard} rounded-xl p-4 transition`}
      data-testid={`team-member-row-${member.id}`}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_100px_145px_minmax(0,170px)_90px] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-black text-white">{member.display_name || "Unnamed team member"}</h3>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClass(member.is_active)}`}>
              {member.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-sky-100/65">{member.email || "No email listed"}</p>
        </div>
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/50">Type</div>
          <div className="mt-1 text-sm font-bold text-sky-50">Employee</div>
        </div>
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/50">Role</div>
          <div className="mt-1 text-sm font-bold text-sky-50">{member.role_label || formatRole(member.role)}</div>
        </div>
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/50">Capabilities</div>
          <div className="mt-1 line-clamp-2 text-sm font-semibold text-sky-100/70">{capabilitySummary(member)}</div>
        </div>
        <button
          type="button"
          onClick={() => onSelect(member)}
          className={`${operationalPrimaryButton} inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-black`}
          data-testid={`team-member-manage-${member.id}`}
        >
          Manage
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-sky-100/55">
        <span>Account: {accountStatus}</span>
        <span>Last login: {formatDate(member.last_login)}</span>
      </div>
    </article>
  );
}

function MemberDetailPanel({ member, onClose, onToggleActive, onDelete, onChangeRole, deletingId }) {
  const navigate = useNavigate();
  if (!member) {
    return (
      <aside className={`${operationalCard} rounded-2xl p-5`} data-testid="team-member-detail-panel">
        <h2 className="text-lg font-black text-white">Select a team member</h2>
        <p className="mt-2 text-sm leading-6 text-sky-100/70">
          Choose a member to review role, account access, capabilities, and notes.
        </p>
      </aside>
    );
  }

  const capabilities = Array.isArray(member.capabilities) ? member.capabilities : [];

  return (
    <aside className={`${operationalPanel} rounded-2xl p-5`} data-testid="team-member-detail-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-sky-100/55">Member profile</div>
          <h2 className="mt-1 truncate text-xl font-black text-white">{member.display_name || "Unnamed team member"}</h2>
          <p className="mt-1 text-sm font-semibold text-sky-100/65">{member.email || "No email listed"}</p>
        </div>
        <button type="button" onClick={onClose} className={`${operationalButton} rounded-lg px-3 py-2 text-sm font-bold lg:hidden`}>
          Close
        </button>
      </div>

      <div className="mt-5 space-y-4">
        <section>
          <h3 className="text-sm font-black text-white">Overview</h3>
          <dl className="mt-2 grid gap-2 text-sm">
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt className="text-sky-100/55">Member type</dt>
              <dd className="font-bold text-sky-50">Employee</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-white/10 pb-2">
              <dt className="text-sky-100/55">Membership status</dt>
              <dd className="font-bold text-sky-50">{member.is_active ? "Active" : "Inactive"}</dd>
            </div>
          </dl>
        </section>

        <section data-testid="team-member-detail-capabilities">
          <h3 className="text-sm font-black text-white">Capabilities</h3>
          {capabilities.length ? (
            <div className="mt-2 space-y-2">
              {capabilities.slice(0, 5).map((capability) => (
                <div key={`${member.id}-${capability.skill_id}`} className="rounded-lg border border-white/10 bg-white/6 px-3 py-2">
                  <div className="text-sm font-bold text-sky-50">{capability.skill_name || capability.skill_slug || "Capability"}</div>
                  <div className="mt-0.5 text-xs font-semibold text-sky-100/60">{capability.skill_level_label || capability.skill_level || "Level not set"}</div>
                </div>
              ))}
              {capabilities.length > 5 ? <div className="text-xs font-semibold text-sky-100/55">+{capabilities.length - 5} more on the full profile</div> : null}
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-white/16 bg-white/6 px-3 py-2 text-sm text-sky-100/65">
              No capability profile completed.
            </p>
          )}
          <button
            type="button"
            onClick={() => navigate(`/app/team/employees/${member.id}`)}
            className={`${operationalButton} mt-3 rounded-lg px-3 py-2 text-sm font-bold`}
          >
            Manage Capabilities
          </button>
        </section>

        <section>
          <h3 className="text-sm font-black text-white">Account Access</h3>
          <div className="mt-2 rounded-lg border border-white/10 bg-white/6 px-3 py-2 text-sm text-sky-100/70">
            <div className="font-bold text-sky-50">{member.last_login ? "Application access used" : "Application access created, not used yet"}</div>
            <div className="mt-1">
              Access is created directly when an employee is added with a temporary password. Password reset and welcome-email resend actions are not available here.
            </div>
            <div className="mt-1">Last login: {formatDate(member.last_login)}</div>
          </div>
          <button
            type="button"
            onClick={() => onToggleActive(member)}
            className={`${operationalButton} mt-3 rounded-lg px-3 py-2 text-sm font-bold`}
          >
            {member.is_active ? "Disable Access" : "Activate Access"}
          </button>
        </section>

        <section data-testid="team-member-detail-permissions">
          <h3 className="text-sm font-black text-white">Permissions</h3>
          <p className="mt-1 text-xs font-semibold text-sky-100/60">
            Change this member's assigned built-in access level. Custom role definitions are not currently available.
          </p>
          <label className="mt-2 block">
            <span className="text-xs font-black uppercase tracking-[0.13em] text-sky-100/55">Assigned role</span>
            <select
              value={member.role || "employee_readonly"}
              onChange={(event) => onChangeRole(member, event.target.value)}
              className={`${operationalControl} mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold`}
              data-testid="team-member-role-select"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h3 className="text-sm font-black text-white">Notes</h3>
          <p className="mt-2 rounded-lg border border-white/10 bg-white/6 px-3 py-2 text-sm text-sky-100/70">
            {member.notes || "No notes recorded. Use the full profile for supported editable fields."}
          </p>
        </section>

        <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <button
            type="button"
            onClick={() => navigate(`/app/team/employees/${member.id}`)}
            className={`${operationalPrimaryButton} rounded-lg px-3 py-2 text-sm font-black`}
          >
            Open Full Profile
          </button>
          <button
            type="button"
            onClick={() => onDelete(member)}
            disabled={deletingId === member.id}
            className="rounded-lg border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-sm font-bold text-rose-100 hover:bg-rose-400/16 disabled:opacity-50"
          >
            {deletingId === member.id ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function TeamPage() {
  const navigate = useNavigate();
  const { data: identity, loading: whoLoading, error: whoError } = useWhoAmI();

  const isContractor = useMemo(
    () => String(identity?.type || "").toLowerCase() === "contractor",
    [identity?.type]
  );

  const attentionCounts = identity?.attention_counts || {};

  const [subaccounts, setSubaccounts] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [subsError, setSubsError] = useState("");
  const [activeTab, setActiveTab] = useState("members");
  const [selectedMemberId, setSelectedMemberId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    search: "",
    type: "",
    role: "",
    status: "",
    account: "",
    capability: "",
    skillLevel: "",
  });
  const [form, setForm] = useState({
    display_name: "",
    email: "",
    role: "employee_readonly",
    password: "",
    notes: "",
  });
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const fetchSubaccounts = async () => {
    try {
      setLoadingSubs(true);
      setSubsError("");
      const res = await api.get("/projects/subaccounts/", {
        params: { page_size: 250, _ts: Date.now() },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });
      const rows = normalizeListResponse(res.data);
      setSubaccounts(rows);
      setSelectedMemberId((current) => current || rows[0]?.id || null);
    } catch (err) {
      console.error("fetchSubaccounts error", err?.response || err);
      const msg =
        err?.response?.data?.detail ||
        err?.response?.statusText ||
        "Unable to load employees.";
      setSubsError(String(msg));
      setSubaccounts([]);
    } finally {
      setLoadingSubs(false);
    }
  };

  useEffect(() => {
    if (whoLoading) return;
    if (whoError) return;
    if (!isContractor) return;
    fetchSubaccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whoLoading, whoError, isContractor]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (!form.display_name || !form.email || !form.password) {
      alert("Display name, email, and password are required.");
      return;
    }

    try {
      setCreating(true);
      const payload = {
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        role: form.role,
        password: form.password,
        is_active: true,
        notes: form.notes || "",
      };

      const res = await api.post("/projects/subaccounts/", payload);
      setSubaccounts((prev) => [res.data, ...prev]);
      setSelectedMemberId(res.data?.id || null);
      setForm({ display_name: "", email: "", role: "employee_readonly", password: "", notes: "" });
      setShowCreate(false);
      alert("Employee created. Share the login email and temporary password.");
    } catch (err) {
      console.error("Error creating subaccount", err?.response || err);
      const msg =
        err.response?.data?.detail ||
        err.response?.data?.email ||
        (Array.isArray(err.response?.data?.password) ? err.response.data.password[0] : null) ||
        "Unable to create employee. Check email uniqueness and try again.";
      alert(msg);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(sub) {
    try {
      const res = await api.patch(`/projects/subaccounts/${sub.id}/`, { is_active: !sub.is_active });
      setSubaccounts((prev) => prev.map((row) => (row.id === sub.id ? res.data : row)));
    } catch (err) {
      console.error("Error toggling active state", err?.response || err);
      alert("Unable to update employee status.");
    }
  }

  async function handleChangeRole(sub, newRole) {
    try {
      const res = await api.patch(`/projects/subaccounts/${sub.id}/`, { role: newRole });
      setSubaccounts((prev) => prev.map((row) => (row.id === sub.id ? res.data : row)));
    } catch (err) {
      console.error("Error changing role", err?.response || err);
      alert("Unable to change role.");
    }
  }

  async function handleDelete(sub) {
    const confirmed = window.confirm(
      `Permanently delete ${sub.display_name || "this employee"}?\n\n` +
        "This cannot be undone. If deletion is blocked, deactivate instead."
    );
    if (!confirmed) return;

    try {
      setDeletingId(sub.id);
      await api.delete(`/projects/subaccounts/${sub.id}/`);
      setSubaccounts((prev) => prev.filter((row) => row.id !== sub.id));
      setSelectedMemberId((current) => (current === sub.id ? null : current));
    } catch (err) {
      console.error("Error deleting subaccount", err?.response || err);
      const msg = err.response?.data?.detail || "Unable to delete employee. They may have linked account history.";
      alert(msg);
    } finally {
      setDeletingId(null);
    }
  }

  const teamSummary = useMemo(() => {
    const membersWithCapabilities = subaccounts.filter((row) => Array.isArray(row.capabilities) && row.capabilities.length > 0).length;
    const inactiveMembers = subaccounts.filter((row) => !row.is_active).length;
    const noAccessUse = subaccounts.filter((row) => !row.last_login).length;
    return {
      employees: subaccounts.length,
      subcontractors: Number(attentionCounts.active_subcontractor_count || 0),
      pendingInvitations: Number(attentionCounts.pending_invites_count || 0),
      incompleteCapabilityProfiles: Math.max(subaccounts.length - membersWithCapabilities, 0),
      membersWithCapabilities,
      inactiveMembers,
      noAccessUse,
    };
  }, [attentionCounts.active_subcontractor_count, attentionCounts.pending_invites_count, subaccounts]);

  const capabilityOptions = useMemo(() => {
    const byId = new Map();
    subaccounts.forEach((row) => {
      (Array.isArray(row.capabilities) ? row.capabilities : []).forEach((capability) => {
        if (!capability?.skill_id) return;
        byId.set(String(capability.skill_id), {
          id: String(capability.skill_id),
          name: capability.skill_name || capability.skill_slug || "Capability",
        });
      });
    });
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [subaccounts]);

  const skillLevelOptions = useMemo(() => {
    const byValue = new Map();
    subaccounts.forEach((row) => {
      (Array.isArray(row.capabilities) ? row.capabilities : []).forEach((capability) => {
        if (!capability?.skill_level) return;
        byValue.set(String(capability.skill_level), {
          value: String(capability.skill_level),
          label: capability.skill_level_label || capability.skill_level,
        });
      });
    });
    return Array.from(byValue.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [subaccounts]);

  const filteredSubaccounts = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return subaccounts.filter((row) => {
      const capabilities = Array.isArray(row.capabilities) ? row.capabilities : [];
      const searchable = `${row.display_name || ""} ${row.email || ""} ${row.role_label || ""} ${row.role || ""}`.toLowerCase();
      if (search && !searchable.includes(search)) return false;
      if (filters.type && filters.type !== "employee") return false;
      if (filters.role && row.role !== filters.role) return false;
      if (filters.status === "active" && !row.is_active) return false;
      if (filters.status === "inactive" && row.is_active) return false;
      if (filters.account === "used" && !row.last_login) return false;
      if (filters.account === "unused" && row.last_login) return false;
      if (filters.capability || filters.skillLevel) {
        return capabilities.some((capability) => {
          const skillMatches = !filters.capability || String(capability.skill_id) === String(filters.capability);
          const levelMatches = !filters.skillLevel || String(capability.skill_level) === String(filters.skillLevel);
          return skillMatches && levelMatches;
        });
      }
      return true;
    });
  }, [filters, subaccounts]);

  const selectedMember = useMemo(
    () => subaccounts.find((row) => String(row.id) === String(selectedMemberId)) || filteredSubaccounts[0] || null,
    [filteredSubaccounts, selectedMemberId, subaccounts]
  );

  const roleSummaries = useMemo(() => {
    return ROLE_OPTIONS.map((role) => ({
      ...role,
      count: subaccounts.filter((row) => row.role === role.value).length,
    }));
  }, [subaccounts]);

  const capabilityRows = useMemo(() => {
    return capabilityOptions.map((option) => {
      const members = subaccounts.filter((row) =>
        (Array.isArray(row.capabilities) ? row.capabilities : []).some((capability) => String(capability.skill_id) === option.id)
      );
      return { ...option, members };
    });
  }, [capabilityOptions, subaccounts]);

  const assistantSummary = teamSummary.incompleteCapabilityProfiles > 0
    ? `${teamSummary.incompleteCapabilityProfiles} team member${teamSummary.incompleteCapabilityProfiles === 1 ? "" : "s"} need capability profiles before team records are complete.`
    : "Team administration data looks complete enough for role, access, and capability review.";

  if (whoLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading your profile...</div>;
  }

  if (whoError || !isContractor) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-xl font-semibold">Team</h1>
        <p className="text-sm text-red-500">Only contractors can manage team members.</p>
      </div>
    );
  }

  const hasActiveFilters = Boolean(filters.search || filters.type || filters.role || filters.status || filters.account || filters.capability || filters.skillLevel);

  return (
    <ContractorPageSurface
      eyebrow="Team"
      title="Team Members"
      subtitle="Team administration for members, built-in roles, capabilities, and account access."
      actions={
        <button
          type="button"
          onClick={() => {
            setActiveTab("members");
            setShowCreate((value) => !value);
          }}
          className={`${operationalPrimaryButton} inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black`}
          data-testid="team-add-member-action"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add Team Member
        </button>
      }
      className="mx-auto max-w-[1180px]"
      contentClassName="space-y-4"
      variant="operational"
    >
      <div className="space-y-4" data-testid="team-admin-workspace">
        <HubTabs tabs={teamHubTabs} />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="team-admin-summary">
          <SummaryCard label="Employees" value={teamSummary.employees} helper="Application users" />
          <SummaryCard label="Subcontractors" value={teamSummary.subcontractors} helper="Tracked separately" />
          <SummaryCard label="Pending Access" value={teamSummary.noAccessUse} helper="Login not used" />
          <SummaryCard label="Pending Invites" value={teamSummary.pendingInvitations} helper="Subcontractor invites" />
          <SummaryCard label="Incomplete Profiles" value={teamSummary.incompleteCapabilityProfiles} helper="Capabilities missing" />
          <SummaryCard label="Inactive Members" value={teamSummary.inactiveMembers} helper="Access disabled" />
        </section>

        <ProjectAssistantPanel
          subtitle="Team Assistant"
          summary={assistantSummary}
          className={`${operationalPanel} text-white`}
          testId="team-admin-assistant"
        >
          <ProjectAssistantSection title="Administrative focus">
            Review missing capability profiles, unused employee access, inactive members, pending setup, and built-in role coverage here.
          </ProjectAssistantSection>
          <ProjectAssistantApprovalNotice compact>
            Project Assistant may summarize team data quality, but authorized users must create access, change roles, or update member status.
          </ProjectAssistantApprovalNotice>
        </ProjectAssistantPanel>

        <section className={`${operationalPanel} rounded-2xl`} data-testid="team-admin-tabs">
          <div className="overflow-x-auto border-b border-white/10 px-3 pt-3">
            <div className="flex min-w-max gap-2" role="tablist" aria-label="Team administration tabs">
              {teamTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  data-testid={`team-admin-tab-${tab.key}`}
                  onClick={() => setActiveTab(tab.key)}
                  className={`inline-flex items-center rounded-t-xl border px-4 py-2 text-sm font-black ${
                    activeTab === tab.key
                      ? "border-sky-300/45 bg-sky-400/16 text-white"
                      : "border-white/10 bg-white/6 text-sky-100/78 hover:border-white/22 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4" data-testid="team-admin-panel">
            {activeTab === "members" ? (
              <div className="space-y-4">
                {showCreate ? (
                  <form onSubmit={handleCreate} className={`${operationalCard} grid gap-3 rounded-2xl p-4 md:grid-cols-2`} data-testid="team-create-member-form">
                    <div className="md:col-span-2">
                      <h2 className="text-base font-black text-white">Add Team Member</h2>
                      <p className="mt-1 text-sm text-sky-100/65">
                        Creates application access directly with a temporary password. This does not send an employee invitation or welcome email.
                      </p>
                    </div>
                    <input name="display_name" value={form.display_name} onChange={handleChange} placeholder="Display name" className={`${operationalControl} rounded-lg px-3 py-2 text-sm`} />
                    <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="Email" className={`${operationalControl} rounded-lg px-3 py-2 text-sm`} />
                    <select name="role" value={form.role} onChange={handleChange} className={`${operationalControl} rounded-lg px-3 py-2 text-sm`}>
                      {ROLE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <input name="password" type="password" value={form.password} onChange={handleChange} placeholder="Temporary password" className={`${operationalControl} rounded-lg px-3 py-2 text-sm`} />
                    <textarea name="notes" value={form.notes} onChange={handleChange} rows={2} placeholder="Optional notes" className={`${operationalControl} rounded-lg px-3 py-2 text-sm md:col-span-2`} />
                    <div className="flex justify-end gap-2 md:col-span-2">
                      <button type="button" onClick={() => setShowCreate(false)} className={`${operationalButton} rounded-lg px-4 py-2 text-sm font-bold`}>Cancel</button>
                      <button disabled={creating} className={`${operationalPrimaryButton} rounded-lg px-4 py-2 text-sm font-black disabled:opacity-50`} type="submit">
                        {creating ? "Creating..." : "Create Employee Access"}
                      </button>
                    </div>
                  </form>
                ) : null}

                <section className="mhb-operational-toolbar rounded-2xl p-3" data-testid="team-member-filters">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <label className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-100/50" aria-hidden="true" />
                      <input
                        value={filters.search}
                        onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                        placeholder="Search by name, email, or role"
                        className={`${operationalControl} w-full rounded-xl py-2 pl-9 pr-3 text-sm font-semibold`}
                        data-testid="team-member-search"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setFiltersOpen((value) => !value)}
                      className={`${operationalButton} inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black`}
                      data-testid="team-filter-toggle"
                    >
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                      Filters
                    </button>
                  </div>
                  <div className={`${filtersOpen || hasActiveFilters ? "grid" : "hidden"} mt-3 gap-3 sm:grid-cols-2 lg:grid-cols-6`} data-testid="team-advanced-filters">
                    <select value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                      <option value="">All member types</option>
                      <option value="employee">Employees</option>
                      <option value="subcontractor">Subcontractors</option>
                    </select>
                    <select value={filters.role} onChange={(event) => setFilters((prev) => ({ ...prev, role: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                      <option value="">All roles</option>
                      {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                    <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                      <option value="">Any status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    <select value={filters.account} onChange={(event) => setFilters((prev) => ({ ...prev, account: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                      <option value="">Any account status</option>
                      <option value="used">Login used</option>
                      <option value="unused">Access not used</option>
                    </select>
                    <select value={filters.capability} onChange={(event) => setFilters((prev) => ({ ...prev, capability: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`} data-testid="team-capability-filter">
                      <option value="">All capabilities</option>
                      {capabilityOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                    <select value={filters.skillLevel} onChange={(event) => setFilters((prev) => ({ ...prev, skillLevel: event.target.value }))} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`} data-testid="team-skill-level-filter">
                      <option value="">All skill levels</option>
                      {skillLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={() => setFilters({ search: "", type: "", role: "", status: "", account: "", capability: "", skillLevel: "" })}
                      className={`${operationalButton} mt-3 rounded-lg px-3 py-2 text-sm font-bold`}
                      data-testid="team-clear-filters"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </section>

                {subsError ? <div className="rounded-lg border border-red-300/30 bg-red-400/10 p-4 text-sm font-semibold text-red-100">{subsError}</div> : null}

                {loadingSubs ? (
                  <div className={`${operationalCard} rounded-xl p-6 text-sm font-bold text-sky-100/70`}>Loading team members...</div>
                ) : filteredSubaccounts.length === 0 ? (
                  <EmptyState
                    title={subaccounts.length === 0 ? "No team members yet" : "No team members match these filters"}
                    description={subaccounts.length === 0
                      ? "Add employees or subcontractors to manage their role, capabilities, and account access."
                      : "Clear filters or search more broadly to find team members."}
                    action={subaccounts.length === 0 ? (
                      <button type="button" onClick={() => setShowCreate(true)} className={`${operationalPrimaryButton} mt-4 rounded-xl px-4 py-2 text-sm font-black`}>
                        Add Team Member
                      </button>
                    ) : null}
                  />
                ) : (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="min-w-0 space-y-3" data-testid="team-members-directory">
                      {filteredSubaccounts.map((sub) => (
                        <MemberRow
                          key={sub.id}
                          member={sub}
                          selected={String(selectedMember?.id) === String(sub.id)}
                          onSelect={(member) => setSelectedMemberId(member.id)}
                        />
                      ))}
                    </div>
                    <MemberDetailPanel
                      member={selectedMember}
                      onClose={() => setSelectedMemberId(null)}
                      onToggleActive={handleToggleActive}
                      onDelete={handleDelete}
                      onChangeRole={handleChangeRole}
                      deletingId={deletingId}
                    />
                  </div>
                )}
              </div>
            ) : null}

            {activeTab === "roles" ? (
              <div className="space-y-4" data-testid="team-roles-workspace">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-white">Roles</h2>
                    <p className="mt-1 text-sm text-sky-100/65">These are built-in employee access levels. Member type and account status are managed separately.</p>
                  </div>
                  <button type="button" disabled className={`${operationalButton} rounded-lg px-4 py-2 text-sm font-black disabled:opacity-45`}>
                    Custom Roles Unavailable
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {roleSummaries.map((role) => (
                    <article key={role.value} className={`${operationalCard} rounded-xl p-4`} data-testid={`team-role-${role.value}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-black text-white">{role.label}</h3>
                          <p className="mt-2 text-sm leading-6 text-sky-100/65">{role.summary}</p>
                        </div>
                        <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-xs font-bold text-sky-100/75">{role.count}</span>
                      </div>
                      <div className="mt-4 text-xs font-semibold text-sky-100/55">Built-in access level. Assign it from member detail.</div>
                    </article>
                  ))}
                </div>
                <div className={`${operationalCard} rounded-xl p-4 text-sm text-sky-100/70`}>
                  Custom role creation is not exposed by the current API. Role assignment remains available through the existing member-management behavior.
                </div>
              </div>
            ) : null}

            {activeTab === "capabilities" ? (
              <div className="space-y-4" data-testid="team-capabilities-workspace">
                <div>
                  <h2 className="text-lg font-black text-white">Capabilities</h2>
                  <p className="mt-1 text-sm text-sky-100/65">Review skills, proficiency, and capability profile completeness.</p>
                </div>
                {teamSummary.membersWithCapabilities === 0 ? (
                  <EmptyState
                    title="No capability profiles completed"
                    description="Add skills and experience to team-member profiles so administrative records are complete."
                  />
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {capabilityRows.map((row) => (
                      <article key={row.id} className={`${operationalCard} rounded-xl p-4`} data-testid={`team-capability-${row.id}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-black text-white">{row.name}</h3>
                            <p className="mt-1 text-sm text-sky-100/65">{row.members.length} member{row.members.length === 1 ? "" : "s"} with this capability</p>
                          </div>
                          <ShieldCheck className="h-5 w-5 text-sky-100/60" aria-hidden="true" />
                        </div>
                        <div className="mt-3 space-y-2">
                          {row.members.slice(0, 4).map((member) => (
                            <button
                              key={`${row.id}-${member.id}`}
                              type="button"
                              onClick={() => {
                                setActiveTab("members");
                                setSelectedMemberId(member.id);
                              }}
                              className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/6 px-3 py-2 text-left text-sm text-sky-100/80 hover:bg-white/10"
                            >
                              <span className="font-bold text-sky-50">{member.display_name || member.email}</span>
                              <span>{capabilitySummary(member, 1)}</span>
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {teamSummary.incompleteCapabilityProfiles > 0 ? (
                  <div className={`${operationalCard} rounded-xl p-4`} data-testid="team-capability-gaps">
                    <h3 className="font-black text-white">Incomplete capability profiles</h3>
                    <p className="mt-1 text-sm text-sky-100/65">{teamSummary.incompleteCapabilityProfiles} member{teamSummary.incompleteCapabilityProfiles === 1 ? "" : "s"} do not have skills recorded.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {subaccounts.filter((row) => !Array.isArray(row.capabilities) || row.capabilities.length === 0).slice(0, 5).map((member) => (
                        <button key={member.id} type="button" onClick={() => navigate(`/app/team/employees/${member.id}`)} className={`${operationalButton} rounded-lg px-3 py-2 text-sm font-bold`}>
                          {member.display_name || member.email}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === "invitations" ? (
              <div className="space-y-4" data-testid="team-invitations-workspace">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-white">Invitations</h2>
                    <p className="mt-1 text-sm text-sky-100/65">Employee access is created directly. Subcontractor invitations stay in the existing Subcontractors workspace.</p>
                  </div>
                  <Link to="/app/team/subcontractors" className={`${operationalPrimaryButton} inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-black`}>
                    Review subcontractor invitations
                  </Link>
                </div>
                {teamSummary.pendingInvitations > 0 ? (
                  <div className={`${operationalCard} rounded-xl p-4`}>
                    <h3 className="font-black text-white">{teamSummary.pendingInvitations} pending invitation{teamSummary.pendingInvitations === 1 ? "" : "s"}</h3>
                    <p className="mt-1 text-sm text-sky-100/65">
                      Pending subcontractor invitations are managed in the existing Subcontractors workspace; employee invitations are not part of the current access model.
                    </p>
                  </div>
                ) : (
                  <EmptyState
                    title="No pending invitations"
                    description="Subcontractor invitations appear in the existing Subcontractors workspace. Employee access is currently created directly through Add Team Member."
                  />
                )}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </ContractorPageSurface>
  );
}
