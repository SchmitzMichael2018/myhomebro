import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import { normalizeProjectClass } from "../utils/projectClass.js";
import { Button, Card, EmptyState, LoadingSkeleton, StatusBadge } from "../components/ui";

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function submissionStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "submitted_for_review") return "Submitted for Review";
  if (normalized === "needs_changes") return "Needs Changes";
  if (normalized === "approved") return "Approved";
  return "Not Submitted";
}

function projectClassLabel(value) {
  return normalizeProjectClass(value) === "commercial" ? "Commercial" : "Residential";
}

function normalizeProjectClassFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "commercial" || normalized === "residential" ? normalized : "all";
}

export default function ReviewerQueuePage() {
  const { isContractor } = useWhoAmI();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [queueCount, setQueueCount] = useState(0);
  const [responseNotes, setResponseNotes] = useState({});
  const [busy, setBusy] = useState({});
  const projectClassFilter = useMemo(
    () => normalizeProjectClassFilter(new URLSearchParams(location.search).get("project_class")),
    [location.search]
  );

  useEffect(() => {
    let active = true;

    async function loadQueue() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/milestones/reviewer-queue/");
        if (!active) return;
        setGroups(Array.isArray(data?.groups) ? data.groups : []);
        setQueueCount(Number(data?.count || 0));
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error("Failed to load awaiting review items.");
        setGroups([]);
        setQueueCount(0);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadQueue();
    return () => {
      active = false;
    };
  }, []);

  const filteredGroups = useMemo(() => {
    if (projectClassFilter === "all") return groups;
    return groups
      .map((group) => ({
        ...group,
        milestones: (group.milestones || []).filter((milestone) => {
          const value = normalizeProjectClass(
            milestone?.project_class ||
              milestone?.project_class_label ||
              group?.project_class ||
              group?.project_class_label
          );
          return value === projectClassFilter;
        }),
      }))
      .filter((group) => (group.milestones || []).length > 0);
  }, [groups, projectClassFilter]);

  const visibleCount = useMemo(
    () => filteredGroups.reduce((sum, group) => sum + (group.milestones || []).length, 0),
    [filteredGroups]
  );

  const updateQueryParam = (key, value) => {
    const params = new URLSearchParams(location.search);
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    navigate(`${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`, { replace: true });
  };

  function removeMilestone(milestoneId) {
    setGroups((prev) =>
      prev
        .map((group) => ({
          ...group,
          milestones: (group.milestones || []).filter((m) => m.id !== milestoneId),
        }))
        .filter((group) => (group.milestones || []).length > 0)
    );
  }

  async function reviewMilestone(milestoneId, decision) {
    const endpoint =
      decision === "approve" ? "approve-work" : "send-back-work";
    const successMessage =
      decision === "approve"
        ? "Submission approved."
        : "Submission sent back for changes.";

    try {
      setBusy((prev) => ({ ...prev, [milestoneId]: true }));
      await api.post(`/projects/milestones/${milestoneId}/${endpoint}/`, {
        response_note: (responseNotes[milestoneId] || "").trim(),
      });
      removeMilestone(milestoneId);
      setResponseNotes((prev) => ({ ...prev, [milestoneId]: "" }));
      toast.success(successMessage);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to update work review.");
    } finally {
      setBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  }

  return (
    <ContractorPageSurface
      eyebrow="Work"
      title="Awaiting Review"
      subtitle="Review submitted milestone work assigned to you and send it back if it needs changes."
      className="max-w-[1320px]"
      variant="operational"
    >
      <div className="mhb-operational-toolbar mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[24px] p-4">
        <div>
          <div
            data-testid="reviewer-queue-title"
            className="sr-only"
          >
            Awaiting Review
          </div>
          <div className="text-sm font-semibold text-sky-100/75">
            {visibleCount} pending review item{visibleCount === 1 ? "" : "s"}
            {projectClassFilter !== "all" ? ` · ${projectClassLabel(projectClassFilter)} only` : ""}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={projectClassFilter}
            onChange={(e) => updateQueryParam("project_class", e.target.value)}
            className="mhb-operational-control rounded-xl px-3 py-2 text-sm font-semibold"
            data-testid="reviewer-queue-project-class-filter"
          >
            <option value="all">All Projects</option>
            <option value="residential">Residential</option>
            <option value="commercial">Commercial</option>
          </select>
          <div className="mhb-operational-filter-chip is-active rounded-xl px-3 py-2 text-sm font-extrabold">
            Pending: {queueCount}
          </div>
        </div>
      </div>

      {loading ? (
        <Card theme="operational"><LoadingSkeleton theme="operational" variant="list" label="Loading review queue" /></Card>
      ) : filteredGroups.length === 0 ? (
        <EmptyState
          theme="operational"
          data-testid="reviewer-queue-empty"
          title="No milestones are awaiting your review right now"
          description="New work submissions will appear here so you can approve them quickly or send them back with notes."
        />
      ) : (
        <div className="space-y-6">
          {filteredGroups.map((group) => (
            <Card
              as="section"
              theme="operational"
              key={group.agreement_id}
              data-testid={`reviewer-queue-group-${group.agreement_id}`}
            >
              <div className="border-b border-[var(--mhb-border-divider)] pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-[var(--mhb-text-primary)]">
                    {group.project_title ||
                      group.agreement_title ||
                      `Agreement #${group.agreement_id}`}
                  </h2>
                  <StatusBadge theme="operational" status="draft" label={group.project_class_label || projectClassLabel(group.project_class)} />
                </div>
                <div className="mt-1 text-xs text-sky-100/55">
                  Agreement #{group.agreement_id}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(group.milestones || []).map((milestone) => (
                  <div
                    key={milestone.id}
                    data-testid={`reviewer-queue-item-${milestone.id}`}
                    className="rounded-xl border border-white/10 bg-slate-950/35 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-white">
                          {milestone.title}
                        </div>
                        <div className="mt-1 text-sm text-sky-100/70 whitespace-pre-wrap">
                          {milestone.description || "No description provided."}
                        </div>
                      </div>
                      <StatusBadge theme="operational" status="pending" label={submissionStatusLabel(milestone.work_submission_status)} />
                    </div>

                    <div className="mt-3 grid gap-3 text-sm text-sky-100/70 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <div className="font-semibold text-white">
                          Assigned Worker
                        </div>
                        <div>{milestone.assigned_worker_display || "Unassigned"}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-white">Reviewer</div>
                        <div>{milestone.reviewer_display || "Reviewer"}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-white">
                          Submitted
                        </div>
                        <div>{formatDateTime(milestone.work_submitted_at)}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-white">Due</div>
                        <div>{formatDateTime(milestone.completion_date)}</div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm text-sky-100/70">
                      <div className="font-semibold text-white">
                        Worker Submission Note
                      </div>
                      <div className="mt-1 whitespace-pre-wrap">
                        {milestone.work_submission_note || "No submission note provided."}
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <textarea
                        data-testid={`reviewer-queue-response-note-${milestone.id}`}
                        rows={2}
                        value={responseNotes[milestone.id] || ""}
                        onChange={(e) =>
                          setResponseNotes((prev) => ({
                            ...prev,
                            [milestone.id]: e.target.value,
                          }))
                        }
                        className="mhb-operational-control w-full rounded-lg px-3 py-2 text-sm"
                        placeholder="Optional response note"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          theme="operational"
                          size="sm"
                          data-testid={`reviewer-queue-approve-${milestone.id}`}
                          onClick={() => reviewMilestone(milestone.id, "approve")}
                          disabled={busy[milestone.id]}
                          loading={busy[milestone.id]}
                          loadingLabel="Saving..."
                        >
                          Approve
                        </Button>
                        <Button
                          theme="operational"
                          variant="secondary"
                          size="sm"
                          data-testid={`reviewer-queue-send-back-${milestone.id}`}
                          onClick={() => reviewMilestone(milestone.id, "send_back")}
                          disabled={busy[milestone.id]}
                          loading={busy[milestone.id]}
                          loadingLabel="Saving..."
                        >
                          Send Back
                        </Button>
                        {isContractor && milestone.agreement_id ? (
                          <Link
                            to={`/app/agreements/${milestone.agreement_id}`}
                            className="mhb-operational-filter-chip rounded-lg px-3 py-2 text-sm font-semibold"
                          >
                            Open Agreement
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </ContractorPageSurface>
  );
}
