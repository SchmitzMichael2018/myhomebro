import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{Number(value || 0).toLocaleString()}</div>
      {sub ? <div className="mt-1 text-xs text-slate-600">{sub}</div> : null}
    </div>
  );
}

function normalizeListResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

export default function TeamOverviewPage() {
  const navigate = useNavigate();
  const { data: identity, loading: whoLoading } = useWhoAmI();
  const attentionCounts = identity?.attention_counts || {};

  const [operations, setOperations] = useState(null);
  const [teamRows, setTeamRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const [operationsRes, teamRes] = await Promise.all([
          api.get("/projects/dashboard/operations/"),
          api.get("/projects/subaccounts/", { params: { page_size: 200 } }),
        ]);
        if (!active) return;
        setOperations(operationsRes.data || null);
        setTeamRows(normalizeListResponse(teamRes.data));
      } catch (error) {
        console.error(error);
        if (!active) return;
        setOperations(null);
        setTeamRows([]);
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
      return type.includes("review") || type.includes("overdue") || type.includes("needs_changes");
    });
  }, [operations]);

  const weekItems = useMemo(() => {
    const items = [
      ...(Array.isArray(operations?.tomorrow) ? operations.tomorrow : []),
      ...(Array.isArray(operations?.this_week) ? operations.this_week : []),
    ];
    return items.slice(0, 6);
  }, [operations]);

  const quickActionButton = (label, to, testId, tone = "primary") => (
    <button
      key={label}
      type="button"
      data-testid={testId}
      onClick={() => navigate(to)}
      className={[
        "rounded-xl px-4 py-3 text-sm font-semibold transition",
        tone === "primary"
          ? "bg-slate-900 text-white hover:bg-slate-800"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
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
    >
      <div className="space-y-6">
        <section data-testid="team-overview-summary" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Active Team"
            value={attentionCounts.active_subcontractor_count || teamRows.filter((row) => row.is_active).length}
            sub="Employees and active subcontractors"
          />
          <SummaryCard
            label="Unassigned Work"
            value={attentionCounts.unassigned_assignment_count || 0}
            sub="Needs an owner"
          />
          <SummaryCard
            label="Awaiting Review"
            value={attentionCounts.awaiting_review_count || 0}
            sub="Submitted work waiting on action"
          />
          <SummaryCard
            label="Overdue"
            value={attentionCounts.overdue_milestone_count || 0}
            sub="Work that has slipped past due date"
          />
        </section>

        <section data-testid="team-overview-actions" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-base font-bold text-slate-900">Quick Actions</div>
              <div className="mt-1 text-sm text-slate-600">
                The shortest path to clear the queue and keep the team moving.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {quickActionButton("Assign Work", "/app/assignments", "team-overview-assign-work", "primary")}
              {quickActionButton("Invite Subcontractor", "/app/subcontractors", "team-overview-invite-subcontractor")}
              {quickActionButton("Add Employee", "/app/team", "team-overview-add-employee")}
              {quickActionButton("Review Submitted Work", "/app/reviewer/queue", "team-overview-review-work")}
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section data-testid="team-overview-attention" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-bold text-slate-900">Needs Attention</div>
                <div className="mt-1 text-sm text-slate-600">
                  Items currently asking for a decision or follow-up.
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
                <div className="text-sm font-semibold text-slate-900">No attention items right now</div>
                <div className="mt-1 text-sm text-slate-700">
                  Once work is submitted or overdue, it will show here automatically.
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
              onClick={() => navigate("/app/team")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Team Page
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
                            onClick={() => navigate(`/app/assignments?subaccount=${row.id}`)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            View Work
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/app/team-schedule?subaccount=${row.id}`)}
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
