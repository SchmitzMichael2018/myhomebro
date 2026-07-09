import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamHubTabs } from "../components/dashboard/hubTabsConfig.js";
import {
  ProjectAssistantApprovalNotice,
  ProjectAssistantCard,
  ProjectAssistantConfidenceBadge,
  ProjectAssistantPanel,
  ProjectAssistantSection,
} from "../components/ProjectAssistantExperience.jsx";

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function SummaryCard({ label, value, sub, onClick }) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={[
        "rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm",
        onClick ? "transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md" : "",
      ].join(" ")}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{Number(value || 0).toLocaleString()}</div>
      {sub ? <div className="mt-1 text-xs text-slate-600">{sub}</div> : null}
    </Component>
  );
}

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
  return text ? text.replace(/\b\w/g, (char) => char.toUpperCase()) : "Open";
}

function capacityTone(state) {
  if (state === "overbooked") return "border-rose-200 bg-rose-50 text-rose-800";
  if (state === "near_capacity") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "available") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function SummaryPill({ label, value, tone = "slate" }) {
  const toneClass =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : tone === "danger"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : tone === "good"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-xs font-bold uppercase tracking-[0.14em] opacity-75">{label}</div>
      <div className="mt-1 text-xl font-black">{Number(value || 0).toLocaleString()}</div>
    </div>
  );
}

function isDraftOrPlanningItem(item) {
  const statusText = [
    item?.status,
    item?.agreement_status,
    item?.project_status,
    item?.signature_status,
    item?.workflow_status,
  ]
    .map(normalizeText)
    .join(" ");

  if (item?.is_draft || item?.is_archived) return true;
  if (statusText.includes("draft") || statusText.includes("unsigned") || statusText.includes("planning")) return true;
  if (statusText.includes("not_sent") || statusText.includes("not sent")) return true;
  return false;
}

function itemHasAssignedTeamSignal(item, teamRows = []) {
  if (
    item?.assigned_subaccount_id ||
    item?.subaccount_id ||
    item?.assigned_worker_id ||
    item?.assigned_worker?.subaccount_id ||
    item?.assigned_subcontractor?.subaccount_id ||
    item?.delegated_reviewer_subaccount?.id
  ) {
    return true;
  }

  const itemText = normalizeText(
    [
      item?.title,
      item?.subtitle,
      item?.assigned_worker_display,
      item?.assigned_subcontractor_display,
      item?.employee_name,
      item?.subcontractor_display_name,
      item?.assignee_name,
    ].join(" ")
  );

  return teamRows.some((row) => {
    const name = normalizeText(row?.display_name);
    const email = normalizeText(row?.email);
    return (name && itemText.includes(name)) || (email && itemText.includes(email));
  });
}

export default function TeamOverviewPage() {
  const navigate = useNavigate();
  const { data: identity, loading: whoLoading } = useWhoAmI();
  const attentionCounts = identity?.attention_counts || {};

  const [operations, setOperations] = useState(null);
  const [teamRows, setTeamRows] = useState([]);
  const [workforce, setWorkforce] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const [operationsRes, teamRes, workforceRes] = await Promise.all([
          api.get("/projects/dashboard/operations/"),
          api.get("/projects/subaccounts/", { params: { page_size: 200 } }),
          api.get("/projects/workforce/assignments/"),
        ]);
        if (!active) return;
        setOperations(operationsRes.data || null);
        setTeamRows(normalizeListResponse(teamRes.data));
        setWorkforce(workforceRes.data || null);
      } catch (error) {
        console.error(error);
        if (!active) return;
        setOperations(null);
        setTeamRows([]);
        setWorkforce(null);
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

  const teamActivityRows = useMemo(() => {
    return teamRows
      .slice()
      .sort((a, b) => Number(b.active_assignment_count || 0) - Number(a.active_assignment_count || 0))
      .slice(0, 6);
  }, [teamRows]);

  const attentionItems = useMemo(() => {
    const today = Array.isArray(operations?.today) ? operations.today : [];
    return today.filter((item) => {
      const type = String(item?.item_type || "").toLowerCase();
      const isActionable =
        type.includes("review") ||
        type.includes("overdue") ||
        type.includes("needs_changes") ||
        type.includes("submitted");
      return isActionable && !isDraftOrPlanningItem(item) && itemHasAssignedTeamSignal(item, teamRows);
    });
  }, [operations, teamRows]);

  const weekItems = useMemo(() => {
    const items = [
      ...(Array.isArray(operations?.tomorrow) ? operations.tomorrow : []),
      ...(Array.isArray(operations?.this_week) ? operations.this_week : []),
    ];
    return items.filter((item) => !isDraftOrPlanningItem(item) && itemHasAssignedTeamSignal(item, teamRows)).slice(0, 6);
  }, [operations, teamRows]);

  const summaryCounts = useMemo(() => {
    const activeRows = teamRows.filter((row) => row.is_active);
    const subcontractors = activeRows.filter((row) => normalizeText(row.role).includes("subcontractor"));
    return {
      activeTeam: attentionCounts.active_subcontractor_count || activeRows.length,
      subcontractors: subcontractors.length,
      assignedWork:
        attentionCounts.assigned_work_count ||
        activeRows.reduce((total, row) => total + Number(row.active_assignment_count || 0), 0),
      unassignedWork: attentionCounts.unassigned_assignment_count || 0,
      awaitingReview: attentionCounts.awaiting_review_count || attentionCounts.submitted_for_review_count || 0,
      upcomingSchedule: weekItems.length,
    };
  }, [attentionCounts, teamRows, weekItems.length]);

  const workforceRows = useMemo(() => {
    return Array.isArray(workforce?.results) ? workforce.results : [];
  }, [workforce]);

  const workforceSummary = workforce?.summary || {};
  const capacityRows = useMemo(() => {
    return Array.isArray(workforce?.capacity) ? workforce.capacity.slice(0, 6) : [];
  }, [workforce]);
  const skillRows = useMemo(() => {
    return Array.isArray(workforce?.skills_matrix) ? workforce.skills_matrix.slice(0, 8) : [];
  }, [workforce]);
  const mixedWorkRows = useMemo(() => {
    return workforceRows
      .filter((row) => row.is_warranty_work || row.is_maintenance_work || row.is_estimate_work || row.source_type === "unassigned_milestone")
      .slice(0, 8);
  }, [workforceRows]);
  const assistant = workforce?.assistant || {};

  const quickActionButton = (label, to, testId, tone = "primary") => (
    <button
      key={label}
      type="button"
      data-testid={testId}
      onClick={() => navigate(to)}
      className={[
        "rounded-xl px-4 py-3 text-sm font-semibold transition",
        tone === "primary"
          ? "mhb-operational-filter-chip is-active"
          : "mhb-operational-filter-chip",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <ContractorPageSurface
      eyebrow="Team"
      title="Team Overview"
      subtitle="A quick operational read on who is active, what needs attention, and what is moving this week."
      className="max-w-[1360px]"
      variant="operational"
    >
      <div className="space-y-6">
        <HubTabs tabs={teamHubTabs} />

        <section data-testid="team-overview-actions" className="rounded-2xl border border-white/12 bg-slate-950/45 p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-base font-bold text-white">Quick Actions</div>
              <div className="mt-1 text-sm text-sky-100/70">
                The shortest path to assign work, invite help, and clear submitted items.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {quickActionButton("Assign Work", "/app/team/assignments", "team-overview-assign-work", "primary")}
              {quickActionButton("Invite Subcontractor", "/app/team/subcontractors", "team-overview-invite-subcontractor")}
              {quickActionButton("Add Employee", "/app/team/members", "team-overview-add-employee")}
              {quickActionButton("Review Submitted Work", "/app/reviewer/queue", "team-overview-review-work")}
            </div>
          </div>
        </section>

        <section data-testid="team-overview-summary" className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard
            label="Team Members"
            value={summaryCounts.activeTeam}
            sub="Active employees and crews"
            onClick={() => navigate("/app/team/members")}
          />
          <SummaryCard
            label="Subcontractors"
            value={summaryCounts.subcontractors}
            sub="Active external partners"
            onClick={() => navigate("/app/team/subcontractors")}
          />
          <SummaryCard
            label="Assigned Work"
            value={summaryCounts.assignedWork}
            sub="Currently routed to the team"
            onClick={() => navigate("/app/team/assignments?assignment_status=assigned")}
          />
          <SummaryCard
            label="Unassigned Work"
            value={summaryCounts.unassignedWork}
            sub="Use Assignments to route"
            onClick={() => navigate("/app/team/assignments?assignment_status=unassigned")}
          />
          <SummaryCard
            label="Awaiting Review"
            value={summaryCounts.awaitingReview}
            sub="Submitted work waiting on action"
            onClick={() => navigate("/app/team/assignments?assignment_status=awaiting_review")}
          />
          <SummaryCard
            label="Upcoming Schedule"
            value={summaryCounts.upcomingSchedule}
            sub="Assigned items this week"
            onClick={() => navigate("/app/team/schedule")}
          />
        </section>

        <section data-testid="team-workforce-command-center" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-base font-bold text-slate-900">Workforce Command Center</div>
              <div className="mt-1 text-sm text-slate-600">
                Unified read layer for agreements, milestones, estimates, warranty, maintenance, and crew planning.
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/team/assignments")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Workload
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <SummaryPill label="Total" value={workforceSummary.total} />
            <SummaryPill label="Today" value={workforceSummary.today_count} />
            <SummaryPill label="This Week" value={workforceSummary.this_week_count} />
            <SummaryPill label="Unassigned" value={workforceSummary.unassigned_count} tone="warn" />
            <SummaryPill label="At Risk" value={workforceSummary.at_risk_count} tone="danger" />
            <SummaryPill label="Warranty" value={workforceSummary.warranty_count} />
            <SummaryPill label="Maintenance" value={workforceSummary.maintenance_count} />
            <SummaryPill label="Estimates" value={workforceSummary.estimate_count} />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section data-testid="team-workload-mixed-types" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-bold text-slate-900">Unified Workload</div>
                <div className="mt-1 text-sm text-slate-600">
                  Mixed work types stay visible without becoming separate assignment systems.
                </div>
              </div>
            </div>
            {loading ? (
              <div className="mt-4 text-sm text-slate-500">Loading workload...</div>
            ) : mixedWorkRows.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center text-sm text-slate-700">
                No estimate, warranty, maintenance, or unassigned milestone work is currently active.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {mixedWorkRows.map((row) => (
                  <div key={`${row.source_type}-${row.source_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                            {formatStatus(row.source_label || row.source_type)}
                          </span>
                          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                            {formatStatus(row.status)}
                          </span>
                        </div>
                        <div className="mt-2 text-sm font-bold text-slate-950">
                          {row.milestone_label || row.project_label || row.agreement_label || row.source_label}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {row.customer_label || "No customer"} {row.property_address ? `| ${row.property_address}` : ""}
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          Assigned to {row.member_name || "Unassigned"} | {formatDateTime(row.scheduled_start)}
                        </div>
                      </div>
                      {row.open_url ? (
                        <button
                          type="button"
                          onClick={() => navigate(row.open_url)}
                          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                        >
                          Open Source
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section data-testid="team-capacity-indicators" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <div className="text-base font-bold text-slate-900">Capacity Indicators</div>
              <div className="mt-1 text-sm text-slate-600">
                Launch thresholds based on current scheduled and assigned work.
              </div>
            </div>
            {loading ? (
              <div className="mt-4 text-sm text-slate-500">Loading capacity...</div>
            ) : capacityRows.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center text-sm text-slate-700">
                Add employees to see capacity indicators.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {capacityRows.map((row) => (
                  <div key={row.member_id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-slate-950">{row.member_name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          Today {Number(row.assignment_count_today || 0)} | Week {Number(row.assignment_count_week || 0)} | Total{" "}
                          {Number(row.assignment_count_total || 0)}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${capacityTone(row.state)}`}>
                        {formatStatus(row.state)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <section data-testid="team-skills-matrix" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div>
              <div className="text-base font-bold text-slate-900">Skills Matrix</div>
              <div className="mt-1 text-sm text-slate-600">
                Foundation view for matching required work skills to employee capabilities.
              </div>
            </div>
            {loading ? (
              <div className="mt-4 text-sm text-slate-500">Loading skills...</div>
            ) : skillRows.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center text-sm text-slate-700">
                Add employee capabilities to build the skills matrix.
              </div>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {skillRows.map((row) => (
                  <div key={row.skill} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-bold text-slate-900">{row.skill}</div>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-black ${capacityTone(row.coverage === "missing" ? "overbooked" : row.coverage === "thin" ? "near_capacity" : "available")}`}>
                        {formatStatus(row.coverage)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {Number(row.member_count || 0)} team member{Number(row.member_count || 0) === 1 ? "" : "s"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <ProjectAssistantPanel
            testId="team-assistant-panel"
            subtitle="Team Assistant"
            summary={assistant.summary || "Review workforce coverage, capacity, and missing assignment context before committing work."}
            actions={<ProjectAssistantConfidenceBadge value={assistant.confidence || "medium"} />}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <ProjectAssistantCard title="Recommended Focus" tone="advisory">
                <ul className="space-y-2 text-sm leading-6">
                  {(assistant.recommendations || ["Review unassigned work and capacity before committing new dates."]).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </ProjectAssistantCard>
              <ProjectAssistantSection title="Safe Prepared Actions">
                {(assistant.safe_actions || ["Prepare assignment review", "Open source records"]).join(", ")}
              </ProjectAssistantSection>
            </div>
            <ProjectAssistantApprovalNotice compact>
              Team Assistant may prepare assignment and capacity reviews, but authorized users must assign people or contact customers.
            </ProjectAssistantApprovalNotice>
          </ProjectAssistantPanel>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section data-testid="team-overview-attention" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-bold text-slate-900">Needs Attention</div>
                <div className="mt-1 text-sm text-slate-600">
                  Assigned team work currently asking for a decision or follow-up.
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate("/app/reviewer/queue")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Open Review Queue
              </button>
            </div>

            {loading ? (
              <div className="mt-4 text-sm text-slate-500">Loading team overview…</div>
            ) : attentionItems.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center">
                <div className="text-sm font-semibold text-slate-900">No assigned team items need attention right now.</div>
                <div className="mt-1 text-sm text-slate-700">
                  Use Assignments to assign work and Team Schedule to review timing.
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {attentionItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.subtitle}</div>
                      </div>
                      <div className="text-xs font-semibold text-slate-500">
                        {formatDateTime(item.occurred_at || item.start_date || item.start)}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(item.actions || []).slice(0, 2).map((action) => (
                        <button
                          key={`${item.id}-${action.label}`}
                          type="button"
                          onClick={() =>
                            navigate(
                              String(action.target || "/app/dashboard").replace(
                                "{id}",
                                String(item.milestone_id || item.agreement_id || "")
                              )
                            )
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section data-testid="team-overview-upcoming" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-bold text-slate-900">Upcoming This Week</div>
                <div className="mt-1 text-sm text-slate-600">
                  The next few things that will land on the schedule.
                </div>
              </div>
            </div>

            {loading ? (
              <div className="mt-4 text-sm text-slate-500">Loading schedule…</div>
            ) : weekItems.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center">
                <div className="text-sm font-semibold text-slate-900">No upcoming items this week</div>
                <div className="mt-1 text-sm text-slate-700">
                  Schedule activity will appear here when work is planned or due.
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {weekItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 text-sm text-slate-600">{item.subtitle}</div>
                    <div className="mt-2 text-xs text-slate-500">
                      {formatDateTime(item.occurred_at || item.start_date)} {item.milestone_title ? `· ${item.milestone_title}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section data-testid="team-overview-members" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-base font-bold text-slate-900">Team Members</div>
              <div className="mt-1 text-sm text-slate-600">
                Quick visibility into who is working, who is waiting, and who is due.
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/team/members")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Manage Employees
            </button>
          </div>

          {loading ? (
            <div className="mt-4 text-sm text-slate-500">Loading team members…</div>
          ) : teamActivityRows.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-7 text-center">
              <div className="text-sm font-semibold text-slate-900">No team members yet</div>
              <div className="mt-1 text-sm text-slate-700">
                Add an employee in Team to start routing work and schedules.
              </div>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Work</th>
                    <th className="px-4 py-3 text-left">Last Activity</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {teamActivityRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{row.display_name}</div>
                        <div className="mt-1 text-xs text-slate-500">{row.email}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{row.role_label || row.role}</div>
                        <div className="mt-1 text-xs text-slate-500">{row.is_active ? "Active" : "Inactive"}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>Active: {Number(row.active_assignment_count || 0)}</div>
                        <div className="mt-1">Review: {Number(row.pending_review_count || 0)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{formatDateTime(row.last_activity_at || row.last_login)}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/app/team/assignments?subaccount=${row.id}`)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            View Work
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/app/team/schedule?subaccount=${row.id}`)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Schedule
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ContractorPageSurface>
  );
}
