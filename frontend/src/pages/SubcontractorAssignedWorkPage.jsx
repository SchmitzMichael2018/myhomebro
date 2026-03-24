import React, { useEffect, useState } from "react";
import api from "../api";
import toast from "react-hot-toast";
import RoleAwareWorkboard from "../components/RoleAwareWorkboard.jsx";

function statusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "invoiced") {
    return "border-blue-200 bg-blue-50 text-blue-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

export default function SubcontractorAssignedWorkPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [payoutAccount, setPayoutAccount] = useState(null);
  const [payoutAccountLoading, setPayoutAccountLoading] = useState(true);
  const [payoutAccountBusy, setPayoutAccountBusy] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [detailsLoading, setDetailsLoading] = useState({});
  const [commentsByMilestone, setCommentsByMilestone] = useState({});
  const [filesByMilestone, setFilesByMilestone] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [commentBusy, setCommentBusy] = useState({});
  const [fileBusy, setFileBusy] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const [reviewBusy, setReviewBusy] = useState({});
  const [completionNotes, setCompletionNotes] = useState({});
  const [completionBusy, setCompletionBusy] = useState({});

  function completionStatusLabel(status) {
    const normalized = String(status || "not_submitted").toLowerCase();
    if (normalized === "submitted_for_review") return "Submitted for review";
    if (normalized === "approved") return "Approved";
    if (normalized === "needs_changes") return "Needs changes";
    return "Not submitted";
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const { data } = await api.get("/projects/subcontractor/milestones/my-assigned/");
        if (!active) return;
        setGroups(Array.isArray(data?.groups) ? data.groups : []);
      } catch (err) {
        if (!active) return;
        console.error(err);
        toast.error("Failed to load assigned work.");
        setGroups([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPayoutAccount() {
      try {
        setPayoutAccountLoading(true);
        const { data } = await api.get("/projects/subcontractor/payout-account/status/");
        if (!active) return;
        setPayoutAccount(data || null);
      } catch (err) {
        if (!active) return;
        console.error(err);
        setPayoutAccount(null);
      } finally {
        if (active) setPayoutAccountLoading(false);
      }
    }

    loadPayoutAccount();
    return () => {
      active = false;
    };
  }, []);

  async function openPayoutOnboarding(mode = "start") {
    try {
      setPayoutAccountBusy(true);
      const { data } = await api.post(
        mode === "manage"
          ? "/projects/subcontractor/payout-account/manage/"
          : "/projects/subcontractor/payout-account/start/",
        {}
      );
      const url = data?.url;
      if (!url) {
        toast.error("Stripe onboarding URL was not returned.");
        return;
      }
      window.location.href = url;
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to open payout onboarding.");
    } finally {
      setPayoutAccountBusy(false);
    }
  }

  function payoutStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "ready") return "Ready to receive payouts";
    if (normalized === "onboarding_incomplete") return "Onboarding incomplete";
    if (normalized === "disabled") return "Stripe disabled";
    return "Not connected";
  }

  async function toggleDetails(milestoneId) {
    setExpanded((prev) => ({ ...prev, [milestoneId]: !prev[milestoneId] }));
    if (expanded[milestoneId]) return;
    if (commentsByMilestone[milestoneId] || filesByMilestone[milestoneId]) return;

    try {
      setDetailsLoading((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.get(`/projects/subcontractor/milestones/${milestoneId}/`);
      setCommentsByMilestone((prev) => ({
        ...prev,
        [milestoneId]: Array.isArray(data?.comments) ? data.comments : [],
      }));
      setFilesByMilestone((prev) => ({
        ...prev,
        [milestoneId]: Array.isArray(data?.files) ? data.files : [],
      }));
    } catch (err) {
      console.error(err);
      toast.error("Failed to load collaboration details.");
    } finally {
      setDetailsLoading((prev) => ({ ...prev, [milestoneId]: false }));
    }
  }

  async function submitComment(milestoneId) {
    const content = (commentDrafts[milestoneId] || "").trim();
    if (!content) {
      toast.error("Comment cannot be empty.");
      return;
    }
    try {
      setCommentBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(
        `/projects/subcontractor/milestones/${milestoneId}/comments/`,
        { content }
      );
      setCommentsByMilestone((prev) => ({
        ...prev,
        [milestoneId]: [data, ...(prev[milestoneId] || [])],
      }));
      setCommentDrafts((prev) => ({ ...prev, [milestoneId]: "" }));
      toast.success("Comment added.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to add comment.");
    } finally {
      setCommentBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  }

  async function uploadFile(milestoneId, file) {
    if (!file) return;
    try {
      setFileBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post(
        `/projects/subcontractor/milestones/${milestoneId}/files/`,
        formData
      );
      setFilesByMilestone((prev) => ({
        ...prev,
        [milestoneId]: [data, ...(prev[milestoneId] || [])],
      }));
      toast.success("File uploaded.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to upload file.");
    } finally {
      setFileBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  }

  async function requestReview(milestoneId) {
    try {
      setReviewBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const note = (reviewNotes[milestoneId] || "").trim();
      const { data } = await api.post(
        `/projects/subcontractor/milestones/${milestoneId}/request-review/`,
        { note }
      );
      const updatedMilestone = data?.milestone || {};
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          milestones: (group.milestones || []).map((milestone) =>
            milestone.id === milestoneId
              ? { ...milestone, ...updatedMilestone }
              : milestone
          ),
        }))
      );
      setReviewNotes((prev) => ({ ...prev, [milestoneId]: "" }));
      toast.success("Review requested.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to request review.");
    } finally {
      setReviewBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  }

  async function submitCompletion(milestoneId) {
    try {
      setCompletionBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const note = (completionNotes[milestoneId] || "").trim();
      const { data } = await api.post(
        `/projects/milestones/${milestoneId}/submit-work/`,
        { note }
      );
      const updatedMilestone = data || data?.milestone || {};
      setGroups((prev) =>
        prev.map((group) => ({
          ...group,
          milestones: (group.milestones || []).map((milestone) =>
            milestone.id === milestoneId
              ? { ...milestone, ...updatedMilestone }
              : milestone
          ),
        }))
      );
      setCompletionNotes((prev) => ({ ...prev, [milestoneId]: "" }));
      toast.success("Completion submitted for review.");
    } catch (err) {
      console.error(err);
      toast.error(
        err?.response?.data?.detail || "Failed to submit completion for review."
      );
    } finally {
      setCompletionBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 data-testid="subcontractor-assigned-work-title" className="text-2xl font-bold text-slate-900">
          My Assigned Work
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Review milestones assigned to you across your active MyHomeBro agreements.
        </p>
      </div>

      <RoleAwareWorkboard />

      <section
        data-testid="subcontractor-payout-account"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Payout Account</h2>
            <p className="mt-1 text-sm text-slate-600">
              Connect Stripe to receive subcontractor milestone payouts when they are ready.
            </p>
          </div>
          <div
            data-testid="subcontractor-payout-account-status"
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
          >
            {payoutAccountLoading
              ? "Checking…"
              : payoutStatusLabel(payoutAccount?.onboarding_status)}
          </div>
        </div>

        {!payoutAccountLoading ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {!payoutAccount?.connected ? (
              <button
                type="button"
                data-testid="subcontractor-payout-account-start"
                onClick={() => openPayoutOnboarding("start")}
                disabled={payoutAccountBusy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {payoutAccountBusy ? "Opening..." : "Connect / Continue Stripe"}
              </button>
            ) : null}
            {payoutAccount?.account_linked ? (
              <button
                type="button"
                data-testid="subcontractor-payout-account-manage"
                onClick={() => openPayoutOnboarding("manage")}
                disabled={payoutAccountBusy}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {payoutAccountBusy ? "Opening..." : "Manage Stripe"}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {loading ? (
        <div className="text-sm text-slate-500">Loading assigned work...</div>
      ) : groups.length === 0 ? (
        <div
          data-testid="subcontractor-assigned-work-empty"
          className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm"
        >
          No milestones are assigned to you yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section
              key={group.agreement_id}
              data-testid={`assigned-work-group-${group.agreement_id}`}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-lg font-semibold text-slate-900">
                  {group.project_title || group.agreement_title || `Agreement #${group.agreement_id}`}
                </h2>
                <div className="mt-1 text-xs text-slate-500">
                  Agreement #{group.agreement_id}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {(group.milestones || []).map((milestone) => (
                  <div
                    key={milestone.id}
                    data-testid={`assigned-milestone-${milestone.id}`}
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
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(
                          milestone.status
                        )}`}
                      >
                        {String(milestone.status || "pending").replaceAll("_", " ")}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
                      <div>
                        <div className="font-semibold text-slate-900">Start</div>
                        <div>{formatDate(milestone.start_date)}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">Due</div>
                        <div>{formatDate(milestone.completion_date)}</div>
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">Assigned</div>
                        <div>
                          {milestone.assigned_worker_display ||
                            milestone.assigned_subcontractor?.display_name ||
                            milestone.assigned_subcontractor?.email ||
                            "Assigned"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">
                        Work Submission
                      </div>
                      <div
                        data-testid={`assigned-milestone-completion-state-${milestone.id}`}
                        className="mt-2 text-sm text-slate-600"
                      >
                        <div>{completionStatusLabel(milestone.work_submission_status || milestone.subcontractor_completion_status)}</div>
                        <div className="mt-1">
                          Reviewer: {milestone.reviewer_display || "Contractor Owner"}
                        </div>
                        {milestone.work_submitted_at || milestone.subcontractor_marked_complete_at ? (
                          <div className="mt-1">
                            Submitted: {formatDate(milestone.work_submitted_at || milestone.subcontractor_marked_complete_at)}
                          </div>
                        ) : null}
                        {milestone.work_submission_note || milestone.subcontractor_completion_note ? (
                          <div className="mt-1 whitespace-pre-wrap">
                            Your note: {milestone.work_submission_note || milestone.subcontractor_completion_note}
                          </div>
                        ) : null}
                        {milestone.work_review_response_note || milestone.subcontractor_review_response_note ? (
                          <div className="mt-1 whitespace-pre-wrap text-amber-700">
                            Reviewer response: {milestone.work_review_response_note || milestone.subcontractor_review_response_note}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 space-y-2">
                        <textarea
                          data-testid={`assigned-milestone-completion-note-${milestone.id}`}
                          rows={2}
                          value={completionNotes[milestone.id] || ""}
                          onChange={(e) =>
                            setCompletionNotes((prev) => ({
                              ...prev,
                              [milestone.id]: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Optional completion note for the contractor"
                        />
                        <button
                          type="button"
                          data-testid={`assigned-milestone-submit-complete-${milestone.id}`}
                          onClick={() => submitCompletion(milestone.id)}
                          disabled={
                            completionBusy[milestone.id] ||
                            (milestone.work_submission_status || milestone.subcontractor_completion_status) === "approved"
                          }
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {completionBusy[milestone.id]
                            ? "Submitting..."
                            : "Submit Complete for Review"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-sm font-semibold text-slate-900">
                        Contractor Review
                      </div>
                      <div
                        data-testid={`assigned-milestone-review-state-${milestone.id}`}
                        className="mt-2 text-sm text-slate-600"
                      >
                        {milestone.subcontractor_review_requested ? (
                          <>
                            <div className="font-semibold text-amber-700">
                              Review requested
                            </div>
                            <div className="mt-1">
                              Requested: {formatDate(milestone.subcontractor_review_requested_at)}
                            </div>
                            {milestone.subcontractor_review_note ? (
                              <div className="mt-1 whitespace-pre-wrap">
                                Note: {milestone.subcontractor_review_note}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <div>Review not requested</div>
                        )}
                      </div>

                      <div className="mt-3 space-y-2">
                        <textarea
                          data-testid={`assigned-milestone-review-note-${milestone.id}`}
                          rows={2}
                          value={reviewNotes[milestone.id] || ""}
                          onChange={(e) =>
                            setReviewNotes((prev) => ({
                              ...prev,
                              [milestone.id]: e.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          placeholder="Optional note for the contractor"
                        />
                        <button
                          type="button"
                          data-testid={`assigned-milestone-request-review-${milestone.id}`}
                          onClick={() => requestReview(milestone.id)}
                          disabled={reviewBusy[milestone.id]}
                          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                        >
                          {reviewBusy[milestone.id] ? "Submitting..." : "Request Review"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4">
                      <button
                        type="button"
                        data-testid={`assigned-milestone-toggle-${milestone.id}`}
                        onClick={() => toggleDetails(milestone.id)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {expanded[milestone.id] ? "Hide Collaboration" : "Show Collaboration"}
                      </button>
                    </div>

                    {expanded[milestone.id] ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                        {detailsLoading[milestone.id] ? (
                          <div className="text-sm text-slate-500">Loading comments and files...</div>
                        ) : (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                Comments
                              </div>
                              <div className="mt-3 space-y-2">
                                {(commentsByMilestone[milestone.id] || []).length === 0 ? (
                                  <div className="text-sm text-slate-500">No comments yet.</div>
                                ) : (
                                  (commentsByMilestone[milestone.id] || []).map((comment) => (
                                    <div
                                      key={comment.id}
                                      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                                    >
                                      <div className="text-xs font-semibold text-slate-700">
                                        {comment.author_name || "User"}
                                      </div>
                                      <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                                        {comment.content}
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">
                                        {formatDate(comment.created_at)}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                              <div className="mt-3 space-y-2">
                                <textarea
                                  data-testid={`assigned-milestone-comment-input-${milestone.id}`}
                                  rows={3}
                                  value={commentDrafts[milestone.id] || ""}
                                  onChange={(e) =>
                                    setCommentDrafts((prev) => ({
                                      ...prev,
                                      [milestone.id]: e.target.value,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  placeholder="Add a collaboration note"
                                />
                                <button
                                  type="button"
                                  data-testid={`assigned-milestone-comment-submit-${milestone.id}`}
                                  onClick={() => submitComment(milestone.id)}
                                  disabled={commentBusy[milestone.id]}
                                  className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                                >
                                  {commentBusy[milestone.id] ? "Saving..." : "Add Comment"}
                                </button>
                              </div>
                            </div>

                            <div>
                              <div className="text-sm font-semibold text-slate-900">Files</div>
                              <div className="mt-3 space-y-2">
                                {(filesByMilestone[milestone.id] || []).length === 0 ? (
                                  <div className="text-sm text-slate-500">No files uploaded yet.</div>
                                ) : (
                                  (filesByMilestone[milestone.id] || []).map((file) => (
                                    <div
                                      key={file.id}
                                      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                                    >
                                      <a
                                        href={file.file_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-sm font-semibold text-blue-700 hover:underline"
                                      >
                                        {file.file_name || "File"}
                                      </a>
                                      <div className="mt-1 text-xs text-slate-500">
                                        {file.uploaded_by_name || "User"} - {formatDate(file.uploaded_at)}
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>

                              <div className="mt-3 space-y-2">
                                <input
                                  data-testid={`assigned-milestone-file-input-${milestone.id}`}
                                  type="file"
                                  onChange={(e) => uploadFile(milestone.id, e.target.files?.[0])}
                                  className="block w-full text-sm text-slate-600"
                                />
                                {fileBusy[milestone.id] ? (
                                  <div className="text-xs text-slate-500">Uploading file...</div>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
