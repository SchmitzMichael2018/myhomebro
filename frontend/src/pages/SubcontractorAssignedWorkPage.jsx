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

function complianceStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "pending_license") return "Pending license";
  if (normalized === "overridden") return "Assigned with override";
  if (normalized === "compliant") return "Compliance on file";
  if (normalized === "missing_license") return "License missing";
  if (normalized === "missing_insurance") return "Insurance missing";
  if (normalized === "not_required") return "No tracked requirement";
  return "Compliance review in progress";
}

export default function SubcontractorAssignedWorkPage() {
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [detailsLoading, setDetailsLoading] = useState({});
  const [agreementBusy, setAgreementBusy] = useState({});
  const [commentsByMilestone, setCommentsByMilestone] = useState({});
  const [filesByMilestone, setFilesByMilestone] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});
  const [commentBusy, setCommentBusy] = useState({});
  const [fileBusy, setFileBusy] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const [reviewBusy, setReviewBusy] = useState({});
  const [completionNotes, setCompletionNotes] = useState({});
  const [completionBusy, setCompletionBusy] = useState({});
  const [quoteDrafts, setQuoteDrafts] = useState({});
  const [quoteBusy, setQuoteBusy] = useState({});

  function completionStatusLabel(status) {
    const normalized = String(status || "not_submitted").toLowerCase();
    if (normalized === "submitted_for_review") return "Submitted for review";
    if (normalized === "approved") return "Reviewed";
    if (normalized === "needs_changes") return "Needs changes";
    return "Not submitted";
  }

  function releaseModeLabel(mode) {
    const normalized = String(mode || "").toLowerCase();
    if (normalized === "auto_after_customer_approval") {
      return "Auto-release after customer approval";
    }
    return "Manual release";
  }

  function paymentStatusCopy(milestone) {
    const payout = milestone?.subcontractor_payout_orchestration || milestone?.payout_orchestration || {};
    const releaseMode = String(
      payout.payment_release_mode ||
        milestone?.subcontractor_agreement?.payment_release_mode ||
        milestone?.payment_release_mode ||
        ""
    ).toLowerCase();
    const payoutState = String(payout.payout_state || payout.next_status || "").toLowerCase();
    const workStatus = String(
      milestone?.work_submission_status || milestone?.subcontractor_completion_status || ""
    ).toLowerCase();
    const isWorkApproved = workStatus === "approved" || payoutState === "ready" || payoutState === "scheduled";

    if (payoutState === "paid" || payout.payout_paid_at) {
      return {
        label: "Payment paid.",
        tone: "text-emerald-900",
      };
    }
    if (payoutState === "failed" || payout.payout_failed_at) {
      return {
        label: "Payment delayed — your contractor has been notified.",
        tone: "text-rose-900",
      };
    }
    if (!isWorkApproved) {
      return {
        label: "Waiting on customer approval.",
        tone: "text-slate-700",
      };
    }
    if (releaseMode === "auto_after_customer_approval" || payoutState === "scheduled") {
      return {
        label: "Payment will release automatically after customer approval.",
        tone: "text-sky-900",
      };
    }
    return {
      label: "Payment pending — your contractor will release payment after customer approval.",
      tone: "text-amber-900",
    };
  }

  function quoteStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "sent") return "Waiting for your quote";
    if (normalized === "responded") return "Quote submitted";
    if (normalized === "accepted") return "Accepted";
    if (normalized === "declined") return "Declined";
    if (normalized === "revision_requested") return "Revision requested";
    if (normalized === "cancelled") return "Cancelled";
    return "Open";
  }

  function formatMoney(value) {
    const amount = Number.parseFloat(String(value ?? "0"));
    return Number.isFinite(amount)
      ? `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "$0.00";
  }

  function updateMilestoneInGroups(milestoneId, patch) {
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        milestones: (group.milestones || []).map((milestone) =>
          milestone.id === milestoneId ? { ...milestone, ...patch } : milestone
        ),
      }))
    );
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

  async function acceptAgreement(milestoneId) {
    try {
      setAgreementBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(
        `/projects/subcontractor/milestones/${milestoneId}/agreement/accept/`,
        {}
      );
      updateMilestoneInGroups(milestoneId, {
        ...(data?.agreement ? { subcontractor_agreement: data.agreement } : {}),
        can_current_user_submit_work: true,
      });
      toast.success("Milestone agreement accepted.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to accept the agreement.");
    } finally {
      setAgreementBusy((prev) => ({ ...prev, [milestoneId]: false }));
    }
  }

  async function declineAgreement(milestoneId) {
    try {
      setAgreementBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(
        `/projects/subcontractor/milestones/${milestoneId}/agreement/decline/`,
        {}
      );
      updateMilestoneInGroups(milestoneId, {
        ...(data?.agreement ? { subcontractor_agreement: data.agreement } : {}),
        can_current_user_submit_work: false,
      });
      toast.success("Milestone agreement declined.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to decline the agreement.");
    } finally {
      setAgreementBusy((prev) => ({ ...prev, [milestoneId]: false }));
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

  async function submitQuoteResponse(milestoneId, quote) {
    if (!quote?.id) return;
    const draft = quoteDrafts[milestoneId] || {};
    const quotedAmount = String(draft.quoted_amount || "").trim();
    if (!quotedAmount) {
      toast.error("Enter a quoted amount.");
      return;
    }
    try {
      setQuoteBusy((prev) => ({ ...prev, [milestoneId]: true }));
      const { data } = await api.post(`/projects/subcontractor-quotes/${quote.id}/respond/`, {
        quoted_amount: quotedAmount,
        subcontractor_message: draft.subcontractor_message || "",
        estimated_start_date: draft.estimated_start_date || null,
        estimated_completion_date: draft.estimated_completion_date || null,
      });
      updateMilestoneInGroups(milestoneId, {
        subcontractor_quote_request: data,
      });
      toast.success("Quote submitted.");
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.detail || "Failed to submit quote.");
    } finally {
      setQuoteBusy((prev) => ({ ...prev, [milestoneId]: false }));
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

                    {milestone.assignment_compliance?.warning_snapshot?.warning_message ? (
                      <div
                        data-testid={`assigned-milestone-compliance-${milestone.id}`}
                        className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700"
                      >
                        <div className="font-semibold text-slate-900">
                          {complianceStatusLabel(milestone.assignment_compliance?.status)}
                        </div>
                        <div className="mt-1">
                          {milestone.assignment_compliance.warning_snapshot.warning_message}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            Review Agreement (Required)
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            Open the terms below, then accept before submitting work.
                          </div>
                        </div>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${
                            String(milestone.subcontractor_agreement?.agreement_acceptance_status || "").toLowerCase() === "accepted"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : String(milestone.subcontractor_agreement?.agreement_acceptance_status || "").toLowerCase() === "declined"
                                ? "border-rose-200 bg-rose-50 text-rose-800"
                                : "border-amber-200 bg-amber-50 text-amber-800"
                          }`}
                        >
                          {String(
                            milestone.subcontractor_agreement?.agreement_acceptance_status || "not_sent"
                          ).replaceAll("_", " ")}
                        </span>
                      </div>

                      {milestone.subcontractor_agreement ? (
                        <div
                          data-testid={`assigned-milestone-agreement-summary-${milestone.id}`}
                          className="mt-3 space-y-2 text-sm text-slate-700"
                        >
                          <div className="font-semibold text-slate-900">
                            {milestone.subcontractor_agreement.contractor_business_name ||
                              milestone.subcontractor_agreement.contractor_name ||
                              "Contractor"}
                          </div>
                          <div className="text-slate-600">
                            {milestone.subcontractor_agreement.milestone_title}
                          </div>
                          <div className="text-slate-600 whitespace-pre-wrap">
                            {milestone.subcontractor_agreement.milestone_description ||
                              "No scope notes provided."}
                          </div>
                          <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm md:grid-cols-2">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Agreed Pay
                              </div>
                              <div className="font-semibold text-slate-900">
                                {formatMoney(milestone.subcontractor_agreement.agreed_pay)}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Payment Release
                              </div>
                              <div className="font-semibold text-slate-900">
                                {releaseModeLabel(
                                  milestone.subcontractor_agreement.payment_release_mode
                                )}
                              </div>
                            </div>
                            <div className="md:col-span-2">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Payment Status
                              </div>
                              <div
                                data-testid={`assigned-milestone-payment-status-${milestone.id}`}
                                className={`font-semibold ${paymentStatusCopy(milestone).tone}`}
                              >
                                {paymentStatusCopy(milestone).label}
                              </div>
                              {Array.isArray(
                                milestone.subcontractor_payout_orchestration?.blocking_reasons_labels
                              ) &&
                              milestone.subcontractor_payout_orchestration.blocking_reasons_labels.length ? (
                                <div className="mt-1 text-xs text-slate-500">
                                  {milestone.subcontractor_payout_orchestration.blocking_reasons_labels.join(
                                    " · "
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          {String(milestone.subcontractor_agreement.agreement_acceptance_status || "").toLowerCase() !==
                          "accepted" ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                              <div className="text-sm font-semibold text-slate-900">
                                You must review the agreement before signing.
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  data-testid={`assigned-milestone-accept-agreement-${milestone.id}`}
                                  onClick={() => acceptAgreement(milestone.id)}
                                  disabled={agreementBusy[milestone.id]}
                                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                                >
                                  {agreementBusy[milestone.id] ? "Working..." : "Accept Agreement"}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`assigned-milestone-decline-agreement-${milestone.id}`}
                                  onClick={() => declineAgreement(milestone.id)}
                                  disabled={agreementBusy[milestone.id]}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                              Agreement accepted. You can submit work for review.
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 text-sm text-slate-500">
                          No milestone agreement terms have been prepared yet.
                        </div>
                      )}
                    </div>

                    {milestone.subcontractor_quote_request ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Quote Request</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {quoteStatusLabel(milestone.subcontractor_quote_request.status)}
                            </div>
                          </div>
                          <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            {quoteStatusLabel(milestone.subcontractor_quote_request.status)}
                          </span>
                        </div>

                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                          <div className="font-semibold text-slate-900">
                            {milestone.subcontractor_quote_request.contractor_message ||
                              "No contractor note provided."}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-slate-600">
                            {milestone.subcontractor_quote_request.scope_snapshot?.milestone_description ||
                              milestone.subcontractor_quote_request.scope_snapshot?.milestone_title ||
                              milestone.description ||
                              "Please review the scope and submit your quote."}
                          </div>
                        </div>

                        {["sent", "revision_requested"].includes(
                          String(milestone.subcontractor_quote_request.status || "").toLowerCase()
                        ) ? (
                          <div className="mt-3 space-y-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Quoted Amount
                                </label>
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={quoteDrafts[milestone.id]?.quoted_amount || ""}
                                  onChange={(e) =>
                                    setQuoteDrafts((prev) => ({
                                      ...prev,
                                      [milestone.id]: {
                                        ...(prev[milestone.id] || {}),
                                        quoted_amount: e.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                  placeholder="0.00"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Estimated Start
                                </label>
                                <input
                                  type="date"
                                  value={quoteDrafts[milestone.id]?.estimated_start_date || ""}
                                  onChange={(e) =>
                                    setQuoteDrafts((prev) => ({
                                      ...prev,
                                      [milestone.id]: {
                                        ...(prev[milestone.id] || {}),
                                        estimated_start_date: e.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                  Estimated Completion
                                </label>
                                <input
                                  type="date"
                                  value={quoteDrafts[milestone.id]?.estimated_completion_date || ""}
                                  onChange={(e) =>
                                    setQuoteDrafts((prev) => ({
                                      ...prev,
                                      [milestone.id]: {
                                        ...(prev[milestone.id] || {}),
                                        estimated_completion_date: e.target.value,
                                      },
                                    }))
                                  }
                                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Optional message
                              </label>
                              <textarea
                                rows={3}
                                value={quoteDrafts[milestone.id]?.subcontractor_message || ""}
                                onChange={(e) =>
                                  setQuoteDrafts((prev) => ({
                                    ...prev,
                                    [milestone.id]: {
                                      ...(prev[milestone.id] || {}),
                                      subcontractor_message: e.target.value,
                                    },
                                  }))
                                }
                                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                placeholder="Add a short message with your quote."
                              />
                            </div>

                            <button
                              type="button"
                              data-testid={`assigned-milestone-submit-quote-${milestone.id}`}
                              onClick={() => submitQuoteResponse(milestone.id, milestone.subcontractor_quote_request)}
                              disabled={quoteBusy[milestone.id]}
                              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                              {quoteBusy[milestone.id] ? "Submitting..." : "Submit Quote"}
                            </button>
                          </div>
                        ) : null}

                        {String(milestone.subcontractor_quote_request.status || "").toLowerCase() === "responded" ? (
                          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                            Your quote has been submitted. The contractor will review it next.
                          </div>
                        ) : null}
                      </div>
                    ) : null}

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
                            !milestone.can_current_user_submit_work ||
                            (milestone.work_submission_status || milestone.subcontractor_completion_status) === "approved"
                          }
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {completionBusy[milestone.id]
                            ? "Submitting..."
                            : "Submit Work for Review"}
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
