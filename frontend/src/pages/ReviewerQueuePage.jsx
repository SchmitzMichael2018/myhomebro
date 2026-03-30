import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";

import api from "../api";
import { useWhoAmI } from "../hooks/useWhoAmI";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";

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

export default function ReviewerQueuePage() {
  const { isContractor } = useWhoAmI();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [responseNotes, setResponseNotes] = useState({});
  const [busy, setBusy] = useState({});

  useEffect(() => {
    let active = true;

    async function loadQueue() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/milestones/reviewer-queue/");
        if (!active) return;
        setGroups(Array.isArray(data?.groups) ? data.groups : []);
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error("Failed to load awaiting review items.");
        setGroups([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadQueue();
    return () => {
      active = false;
    };
  }, []);

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
    >
      <div
        data-testid="reviewer-queue-title"
        className="sr-only"
      >
        Awaiting Review
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white/90 px-6 py-10 text-center text-sm text-slate-700 shadow-sm">
          Loading review queue...
        </div>
      ) : groups.length === 0 ? (
        <div
          data-testid="reviewer-queue-empty"
          className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-6 py-12 text-center shadow-sm"
        >
          <div className="text-base font-semibold text-slate-900">
            No milestones are awaiting your review right now.
          </div>
          <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-700">
            New work submissions will appear here so you can approve them quickly or send them back with notes.
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section
              key={group.agreement_id}
              data-testid={`reviewer-queue-group-${group.agreement_id}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {group.project_title ||
                    group.agreement_title ||
                    `Agreement #${group.agreement_id}`}
                </h2>
                <div className="mt-1 text-xs text-slate-500">
                  Agreement #{group.agreement_id}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(group.milestones || []).map((milestone) => (
                  <div
                    key={milestone.id}
                    data-testid={`reviewer-queue-item-${milestone.id}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">
                          {milestone.title}
                        </div>
                        <div className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">
                          {milestone.description || "No description provided."}
                        </div>
                      </div>
                      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {submissionStatusLabel(milestone.work_submission_status)}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <div className="font-semibold text-slate-900">
                          Assigned Worker
                        </div>
                        <div>{milestone.assigned_worker_display || "Unassigned"}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">Reviewer</div>
                        <div>{milestone.reviewer_display || "Reviewer"}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">
                          Submitted
                        </div>
                        <div>{formatDateTime(milestone.work_submitted_at)}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">Due</div>
                        <div>{formatDateTime(milestone.completion_date)}</div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
                      <div className="font-semibold text-slate-900">
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
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Optional response note"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`reviewer-queue-approve-${milestone.id}`}
                          onClick={() => reviewMilestone(milestone.id, "approve")}
                          disabled={busy[milestone.id]}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {busy[milestone.id] ? "Saving..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          data-testid={`reviewer-queue-send-back-${milestone.id}`}
                          onClick={() => reviewMilestone(milestone.id, "send_back")}
                          disabled={busy[milestone.id]}
                          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                        >
                          {busy[milestone.id] ? "Saving..." : "Send Back"}
                        </button>
                        {isContractor && milestone.agreement_id ? (
                          <Link
                            to={`/app/agreements/${milestone.agreement_id}`}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Open Agreement
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </ContractorPageSurface>
  );
}
