import React, { useEffect, useMemo, useState } from "react";
import { Plus, Search, SlidersHorizontal, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamOrganizationTabs } from "../components/dashboard/hubTabsConfig.js";
import { Button, EmptyState, InlineAlert, LoadingSkeleton } from "../components/ui";

const ROLE_OPTIONS = [
  { value: "employee_readonly", label: "Read-only", summary: "Can view permitted account information with limited update access." },
  { value: "employee_milestones", label: "Completion Access", summary: "Can update permitted completion/status fields where authorized." },
  { value: "employee_supervisor", label: "Supervisor", summary: "Broader team administration access where authorized." },
];

const operationalPanel = "mhb-operational-panel";
const operationalCard = "mhb-glass";
const operationalButton = "mhb-btn";
const operationalControl = "mhb-operational-control";
const sectionTitleClass = "text-base font-bold text-white";
const sectionHelperClass = "mt-1 text-sm text-sky-100/70";
const loadingTextClass = "mt-4 text-sm text-sky-100/60";
const emptyStateClass =
  "rounded-2xl border border-dashed border-white/16 bg-white/6 px-5 py-7 text-center text-sm text-sky-100/74";

function normalizeListResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatStatus(value) {
  const text = String(value || "").replaceAll("_", " ").trim();
  return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : "Unknown";
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

function roleLabel(value, fallback = "") {
  return ROLE_OPTIONS.find((role) => role.value === value)?.label || fallback || formatRole(value);
}

function capabilityName(capability) {
  return capability?.skill_name || capability?.skill_slug || capability?.name || "Capability";
}

function capabilitySummary(row, limit = 2) {
  const capabilities = Array.isArray(row?.capabilities) ? row.capabilities : [];
  if (!capabilities.length) return "No capabilities recorded";
  const visible = capabilities.slice(0, limit).map(capabilityName);
  const hidden = capabilities.length - visible.length;
  return hidden > 0 ? `${visible.join(", ")} +${hidden} more` : visible.join(", ");
}

function SummaryCard({ label, value, helper, onClick }) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={[
        operationalCard,
        "rounded-xl px-4 py-3 text-left",
        onClick ? "transition hover:-translate-y-0.5 hover:border-white/24 hover:bg-white/12" : "",
      ].join(" ")}
    >
      <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/60">{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{Number(value || 0).toLocaleString()}</div>
      {helper ? <div className="mt-1 text-xs font-semibold text-sky-100/60">{helper}</div> : null}
    </Component>
  );
}

function statusBadgeClass(status) {
  const normalized = normalizeText(status);
  if (normalized === "active" || normalized === "accepted") return "border-emerald-200/35 bg-emerald-400/12 text-emerald-100";
  if (normalized === "pending") return "border-amber-200/35 bg-amber-400/12 text-amber-100";
  if (normalized === "inactive" || normalized === "expired" || normalized === "revoked") return "border-rose-200/35 bg-rose-400/12 text-rose-100";
  return "border-white/12 bg-white/8 text-sky-100/70";
}

export default function TeamOverviewPage() {
  const navigate = useNavigate();
  const { data: identity, loading: whoLoading, error: whoError } = useWhoAmI();
  const attentionCounts = identity?.attention_counts || {};

  const [teamRows, setTeamRows] = useState([]);
  const [subcontractorRows, setSubcontractorRows] = useState([]);
  const [invitationRows, setInvitationRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const [teamRes, subcontractorsRes, invitationsRes] = await Promise.all([
          api.get("/projects/subaccounts/", { params: { page_size: 200 } }),
          api.get("/projects/subcontractors/"),
          api.get("/projects/subcontractor-invitations/"),
        ]);
        if (!active) return;
        setTeamRows(normalizeListResponse(teamRes.data));
        setSubcontractorRows(normalizeListResponse(subcontractorsRes.data));
        setInvitationRows(normalizeListResponse(invitationsRes.data));
      } catch (error) {
        console.error(error);
        if (!active) return;
        setTeamRows([]);
        setSubcontractorRows([]);
        setInvitationRows([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    if (!whoLoading) {
      load();
    }

    return () => {
      active = false;
    };
  }, [whoLoading]);

  const isContractor = ["contractor", "contractor_owner", "employee_supervisor"].includes(
    String(identity?.identity_type || identity?.role || identity?.type || "").toLowerCase()
  );

  const organizationMembers = useMemo(() => {
    const employees = teamRows.map((row) => ({
      key: `employee-${row.id}`,
      id: row.id,
      type: "Employee",
      name: row.display_name || row.email || "Unnamed employee",
      email: row.email || "",
      role: roleLabel(row.role, row.role_label),
      roleValue: row.role,
      status: row.is_active ? "active" : "inactive",
      capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
      lastSeen: row.last_login || row.last_activity_at,
      openUrl: `/app/team/employees/${row.id}`,
    }));

    const subcontractors = subcontractorRows.map((row) => ({
      key: `subcontractor-${row.key || row.subcontractor_user_id || row.email}`,
      id: row.subcontractor_user_id || row.key || row.email,
      type: "Subcontractor",
      name: row.display_name || row.name || row.email || "Unnamed subcontractor",
      email: row.email || "",
      role: "External partner",
      roleValue: "subcontractor",
      status: row.status || "active",
      capabilities: [],
      lastSeen: row.last_activity_at,
      openUrl: "/app/team/subcontractors",
    }));

    return [...employees, ...subcontractors];
  }, [subcontractorRows, teamRows]);

  const capabilityRows = useMemo(() => {
    const coverage = new Map();
    teamRows.forEach((member) => {
      (Array.isArray(member.capabilities) ? member.capabilities : []).forEach((capability) => {
        const id = String(capability.skill_id || capability.skill_slug || capabilityName(capability));
        const existing = coverage.get(id) || {
          id,
          name: capabilityName(capability),
          count: 0,
        };
        existing.count += 1;
        coverage.set(id, existing);
      });
    });
    return Array.from(coverage.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [teamRows]);

  const roleRows = useMemo(
    () =>
      ROLE_OPTIONS.map((role) => ({
        ...role,
        count: teamRows.filter((row) => row.role === role.value).length,
      })),
    [teamRows]
  );

  const filteredMembers = useMemo(() => {
    const q = normalizeText(search);
    return organizationMembers.filter((member) => {
      if (typeFilter && normalizeText(member.type) !== typeFilter) return false;
      if (statusFilter && normalizeText(member.status) !== statusFilter) return false;
      if (capabilityFilter) {
        const hasCapability = member.capabilities.some((capability) => {
          const id = String(capability.skill_id || capability.skill_slug || capabilityName(capability));
          return id === capabilityFilter;
        });
        if (!hasCapability) return false;
      }
      if (!q) return true;
      return [member.name, member.email, member.role, member.type, member.status, capabilitySummary(member)]
        .map(normalizeText)
        .some((value) => value.includes(q));
    });
  }, [capabilityFilter, organizationMembers, search, statusFilter, typeFilter]);

  const summaryCounts = useMemo(() => {
    const employees = teamRows.length;
    const subcontractors = subcontractorRows.length || Number(attentionCounts.active_subcontractor_count || 0);
    const pendingInvitations =
      invitationRows.filter((row) => normalizeText(row.status) === "pending").length ||
      Number(attentionCounts.pending_invites_count || 0);
    const incompleteProfiles = teamRows.filter((row) => !Array.isArray(row.capabilities) || row.capabilities.length === 0).length;
    const activeAccounts = teamRows.filter((row) => row.is_active).length;
    const inactiveMembers = teamRows.filter((row) => !row.is_active).length;
    return { employees, subcontractors, pendingInvitations, incompleteProfiles, activeAccounts, inactiveMembers };
  }, [attentionCounts.active_subcontractor_count, attentionCounts.pending_invites_count, invitationRows, subcontractorRows.length, teamRows]);

  const invitationSummary = useMemo(() => {
    const counts = invitationRows.reduce(
      (acc, row) => {
        const status = normalizeText(row.status);
        if (status === "accepted") acc.accepted += 1;
        else if (status === "expired" || status === "revoked") acc.expired += 1;
        else acc.pending += 1;
        return acc;
      },
      { pending: 0, accepted: 0, expired: 0 }
    );
    if (!invitationRows.length && attentionCounts.pending_invites_count) {
      counts.pending = Number(attentionCounts.pending_invites_count || 0);
    }
    return counts;
  }, [attentionCounts.pending_invites_count, invitationRows]);

  const organizationIssues = useMemo(() => {
    const issues = [];
    if (summaryCounts.incompleteProfiles > 0) {
      issues.push(
        summaryCounts.incompleteProfiles === 1
          ? "1 member needs a capability profile."
          : `${summaryCounts.incompleteProfiles} members need capability profiles.`
      );
    }
    if (invitationSummary.pending > 0) {
      issues.push(`${invitationSummary.pending} subcontractor invitation${invitationSummary.pending === 1 ? "" : "s"} still pending.`);
    }
    if (!roleRows.some((role) => role.value === "employee_supervisor" && role.count > 0)) {
      issues.push("No supervisor access level is currently represented.");
    }
    if (summaryCounts.inactiveMembers > 0) {
      issues.push(`${summaryCounts.inactiveMembers} member${summaryCounts.inactiveMembers === 1 ? "" : "s"} are inactive.`);
    }
    if (capabilityRows.length === 0) {
      issues.push("No capabilities have been recorded yet.");
    }
    return issues;
  }, [capabilityRows.length, invitationSummary.pending, roleRows, summaryCounts.inactiveMembers, summaryCounts.incompleteProfiles]);

  if (whoLoading) {
    return (
      <ContractorPageSurface eyebrow="Team" title="Team" subtitle="Loading your organization..." variant="operational">
        <LoadingSkeleton theme="operational" variant="workspace" label="Loading team profile" />
      </ContractorPageSurface>
    );
  }

  if (whoError || !isContractor) {
    return (
      <ContractorPageSurface eyebrow="Team" title="Team" subtitle="Manage your organization." variant="operational">
        <InlineAlert theme="operational" tone="danger" title="Team is unavailable">Only contractors can view team organization.</InlineAlert>
      </ContractorPageSurface>
    );
  }

  return (
    <ContractorPageSurface
      eyebrow="Team"
      title="Team"
      subtitle="Manage your employees, subcontractors, roles, capabilities, and organization."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            theme="operational"
            icon={Plus}
            onClick={() => navigate("/app/team/members")}
            data-testid="team-overview-add-member"
          >
            Add Team Member
          </Button>
          <Button
            theme="operational"
            variant="secondary"
            onClick={() => navigate("/app/team/subcontractors")}
            data-testid="team-overview-invite-subcontractor"
          >
            Invite Subcontractor
          </Button>
        </div>
      }
      className="mx-auto max-w-[1180px]"
      contentClassName="space-y-4"
      variant="operational"
    >
      <div className="space-y-4" data-testid="team-organization-overview">
        <HubTabs tabs={teamOrganizationTabs} />

        <section data-testid="team-health-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Employees" value={summaryCounts.employees} helper="Application users" onClick={() => navigate("/app/team/members")} />
          <SummaryCard label="Subcontractors" value={summaryCounts.subcontractors} helper="External partners" onClick={() => navigate("/app/team/subcontractors")} />
          <SummaryCard label="Pending Invitations" value={summaryCounts.pendingInvitations} helper="Subcontractor invites" onClick={() => navigate("/app/team/subcontractors")} />
          <SummaryCard label="Incomplete Profiles" value={summaryCounts.incompleteProfiles} helper="Capabilities missing" onClick={() => navigate("/app/team/members")} />
          <SummaryCard label="Active Accounts" value={summaryCounts.activeAccounts} helper="Enabled members" onClick={() => navigate("/app/team/members")} />
          <SummaryCard label="Inactive Members" value={summaryCounts.inactiveMembers} helper="Access disabled" onClick={() => navigate("/app/team/members")} />
        </section>

        <section data-testid="team-directory" className={`${operationalPanel} rounded-2xl p-4`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className={sectionTitleClass}>Team Directory</div>
              <div className={sectionHelperClass}>Employees and subcontractors in one organization view. Open administration for access, profile, and capability changes.</div>
            </div>
            <button type="button" onClick={() => navigate("/app/team/members")} className={operationalButton} data-testid="team-overview-manage-members">
              Manage Access & Profiles
            </button>
          </div>

          <div className="mhb-operational-toolbar mt-4 rounded-2xl p-3" data-testid="team-directory-filters">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-100/50" aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, email, role, or capability"
                  className={`${operationalControl} w-full rounded-xl py-2 pl-9 pr-3 text-sm font-semibold`}
                  data-testid="team-directory-search"
                />
              </label>
              <button
                type="button"
                onClick={() => setFiltersOpen((value) => !value)}
                className={`${operationalButton} inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black`}
                data-testid="team-directory-filter-toggle"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                Filters
              </button>
            </div>
            <div className={`${filtersOpen || typeFilter || statusFilter || capabilityFilter ? "grid" : "hidden"} mt-3 gap-3 sm:grid-cols-3`} data-testid="team-directory-advanced-filters">
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                <option value="">All member types</option>
                <option value="employee">Employees</option>
                <option value="subcontractor">Subcontractors</option>
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`}>
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="pending">Pending</option>
              </select>
              <select value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value)} className={`${operationalControl} rounded-lg px-3 py-2 text-sm font-semibold`} data-testid="team-directory-capability-filter">
                <option value="">All capabilities</option>
                {capabilityRows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <LoadingSkeleton theme="operational" variant="list" label="Loading team directory" className="mt-4" />
          ) : filteredMembers.length === 0 ? (
            <EmptyState theme="operational" className="mt-4" data-testid="team-directory-empty" title="No team members match this view" description="Clear filters or add team members to build your organization." />
          ) : (
            <div className="mt-4 grid gap-3" data-testid="team-directory-results">
              {filteredMembers.map((member) => (
                <article key={member.key} className={`${operationalCard} rounded-xl p-4`}>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_110px_minmax(0,170px)_minmax(0,180px)_90px] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-black text-white">{member.name}</h3>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadgeClass(member.status)}`}>{formatStatus(member.status)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold text-sky-100/65">{member.email || "No email listed"}</p>
                    </div>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/50">Type</div>
                      <div className="mt-1 text-sm font-bold text-sky-50">{member.type}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/50">Role</div>
                      <div className="mt-1 text-sm font-bold text-sky-50">{member.role}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-[0.13em] text-sky-100/50">Capabilities</div>
                      <div className="mt-1 line-clamp-2 text-sm font-semibold text-sky-100/70">{capabilitySummary(member)}</div>
                    </div>
                    <button type="button" onClick={() => navigate(member.openUrl)} className={`${operationalButton} rounded-lg px-3 py-2 text-sm font-bold`}>
                      View
                    </button>
                  </div>
                  <div className="mt-3 text-xs font-semibold text-sky-100/55">Last login/activity: {formatDate(member.lastSeen)}</div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
          <section data-testid="team-capability-coverage" className={`${operationalPanel} rounded-2xl p-4`}>
            <div>
              <div className={sectionTitleClass}>Capability Coverage</div>
              <div className={sectionHelperClass}>A read-only view of company capabilities. Click a capability to filter the directory.</div>
            </div>
            {loading ? (
              <div className={loadingTextClass}>Loading capability coverage...</div>
            ) : capabilityRows.length === 0 ? (
              <div className={`mt-4 ${emptyStateClass}`}>
                Add capabilities in Team Members to show company coverage here.
              </div>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {capabilityRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setCapabilityFilter(row.id);
                      setFiltersOpen(true);
                    }}
                    className="rounded-xl border border-white/10 bg-white/6 px-3 py-2 text-left transition hover:border-white/24 hover:bg-white/10"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-bold text-white">{row.name}</span>
                      <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-xs font-black text-sky-100">{row.count}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section data-testid="team-roles-overview" className={`${operationalPanel} rounded-2xl p-4`}>
            <div>
              <div className={sectionTitleClass}>Built-in Roles</div>
              <div className={sectionHelperClass}>Current access levels and employee counts. Custom role creation is not available yet.</div>
            </div>
            <div className="mt-4 space-y-3">
              {roleRows.map((role) => (
                <div key={role.value} className="rounded-xl border border-white/10 bg-white/6 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-white">{role.label}</div>
                      <div className="mt-1 text-xs leading-5 text-sky-100/65">{role.summary}</div>
                    </div>
                    <span className="rounded-full border border-white/12 bg-white/8 px-2.5 py-1 text-xs font-black text-sky-100">{role.count}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[0.9fr_1fr]">
          <section data-testid="team-invitations-overview" className={`${operationalPanel} rounded-2xl p-4`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className={sectionTitleClass}>Invitations</div>
                <div className={sectionHelperClass}>Subcontractor invitation progress. Employees are created directly in Team Members.</div>
              </div>
              <button type="button" onClick={() => navigate("/app/team/subcontractors")} className={operationalButton}>
                Open Invitations
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <SummaryCard label="Pending" value={invitationSummary.pending} helper="Awaiting response" />
              <SummaryCard label="Accepted" value={invitationSummary.accepted} helper="Joined" />
              <SummaryCard label="Expired" value={invitationSummary.expired} helper="Closed invites" />
            </div>
          </section>

          <section data-testid="team-organization-growth" className={`${operationalPanel} rounded-2xl p-4`}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className={sectionTitleClass}>Organization Growth</div>
                <div className={sectionHelperClass}>Recommended improvements based on your current team records.</div>
              </div>
              <span className="inline-flex w-fit rounded-full border border-white/12 bg-white/8 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-sky-100/70">
                Next Steps
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {(organizationIssues.length ? organizationIssues : ["Organization setup looks healthy. Keep profiles, roles, and capabilities current as the company grows."]).map((item) => (
                <div key={item} className="flex gap-3 rounded-xl border border-white/10 bg-white/6 p-3 text-sm font-semibold text-sky-100/75">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-sky-100/55" aria-hidden="true" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </ContractorPageSurface>
  );
}
