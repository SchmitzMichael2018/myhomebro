import React, { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

import api from "../api";
import ContractorPageSurface from "../components/dashboard/ContractorPageSurface.jsx";
import HubTabs from "../components/dashboard/HubTabs.jsx";
import { teamHubTabs } from "../components/dashboard/hubTabsConfig.js";
import { WorkflowHint } from "../components/WorkflowHint.jsx";
import { getSubcontractorHubHint } from "../lib/workflowHints.js";

const TABS = [
  { key: "directory", label: "Directory" },
  { key: "invitations", label: "Invitations" },
  { key: "assignments", label: "Assignments" },
  { key: "submissions", label: "Submitted Work" },
];

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function statusChip(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "accepted" || normalized === "active" || normalized === "approved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (normalized === "pending" || normalized === "submitted") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (normalized === "revoked" || normalized === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function reviewStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "submitted_for_review") return "Submitted for review";
  if (normalized === "approved") return "Reviewed";
  if (normalized === "needs_changes") return "Needs changes";
  return String(status || "").replaceAll("_", " ") || "Pending";
}

function complianceStatusLabel(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "compliant") return "Compliant";
  if (normalized === "pending_license") return "Pending License";
  if (normalized === "overridden") return "Overridden";
  if (normalized === "missing_license") return "Missing License";
  if (normalized === "missing_insurance") return "Missing Insurance";
  if (normalized === "not_required") return "Not Required";
  if (normalized === "unknown") return "Unknown";
  return "Unreviewed";
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function ModalShell({ title, subtitle, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default function SubcontractorsPage() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("directory");
  const [directoryRows, setDirectoryRows] = useState([]);
  const [invitationRows, setInvitationRows] = useState([]);
  const [assignmentRows, setAssignmentRows] = useState([]);
  const [submissionRows, setSubmissionRows] = useState([]);
  const [agreementRows, setAgreementRows] = useState([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  const [assignMilestones, setAssignMilestones] = useState([]);
  const [assignMilestonesLoading, setAssignMilestonesLoading] = useState(false);
  const [assignDecision, setAssignDecision] = useState(null);
  const [assignOverrideReason, setAssignOverrideReason] = useState("");
  const [inviteForm, setInviteForm] = useState({
    agreement_id: "",
    invite_name: "",
    invite_email: "",
    invited_message: "",
  });
  const [assignForm, setAssignForm] = useState({
    agreement_id: "",
    invitation_id: "",
    milestone_ids: [],
    agreed_pay: "",
    payment_release_mode: "manual_release",
  });

  async function loadHubData() {
    try {
      setLoading(true);
      const [directoryRes, invitesRes, assignmentsRes, submissionsRes, agreementsRes] =
        await Promise.all([
          api.get("/projects/subcontractors/"),
          api.get("/projects/subcontractor-invitations/"),
          api.get("/projects/subcontractor-assignments/"),
          api.get("/projects/subcontractor-work-submissions/"),
          api.get("/projects/agreements/"),
        ]);
      setDirectoryRows(normalizeList(directoryRes.data));
      setInvitationRows(normalizeList(invitesRes.data));
      setAssignmentRows(normalizeList(assignmentsRes.data));
      setSubmissionRows(normalizeList(submissionsRes.data));
      setAgreementRows(normalizeList(agreementsRes.data));
    } catch (error) {
      console.error(error);
      toast.error("Failed to load subcontractor hub.");
      setDirectoryRows([]);
      setInvitationRows([]);
      setAssignmentRows([]);
      setSubmissionRows([]);
      setAgreementRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHubData();
  }, []);

  useEffect(() => {
    async function loadMilestones() {
      if (!assignOpen || !assignForm.agreement_id) {
        setAssignMilestones([]);
        return;
      }
      try {
        setAssignMilestonesLoading(true);
        const { data } = await api.get("/projects/milestones/", {
          params: { agreement: assignForm.agreement_id },
        });
        setAssignMilestones(normalizeList(data));
      } catch (error) {
        console.error(error);
        toast.error("Failed to load agreement milestones.");
        setAssignMilestones([]);
      } finally {
        setAssignMilestonesLoading(false);
      }
    }

    loadMilestones();
  }, [assignForm.agreement_id, assignOpen]);

  const assignedNotStartedCount = useMemo(
    () =>
      assignmentRows.reduce((total, row) => {
        const assigned = Number(row.assigned_milestones_count || 0);
        const reviewed = Number(row.submitted_for_review_count || 0);
        const approved = Number(row.approved_count || 0);
        return total + Math.max(assigned - reviewed - approved, 0);
      }, 0),
    [assignmentRows]
  );
  const activeWorkCount = useMemo(
    () =>
      directoryRows.reduce((total, row) => total + Number(row.active_jobs_count || row.assigned_work_count || 0), 0),
    [directoryRows]
  );
  const overdueWorkCount = useMemo(
    () =>
      assignmentRows.reduce((total, row) => {
        const due = row.earliest_due_date ? new Date(row.earliest_due_date) : null;
        const isCompleted = String(row.status || "").toLowerCase() === "completed";
        if (!due || Number.isNaN(due.getTime()) || isCompleted) return total;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);
        return total + (due < today ? 1 : 0);
      }, 0),
    [assignmentRows]
  );
  const submittedForReviewCount = useMemo(
    () =>
      submissionRows.filter(
        (row) => String(row.review_status || "").toLowerCase() === "submitted_for_review"
      ).length,
      [submissionRows]
  );
  const subcontractorHint = useMemo(
    () =>
      getSubcontractorHubHint({
        invitationRows,
        assignmentRows,
        submissionRows,
      }),
    [assignmentRows, invitationRows, submissionRows]
  );

  const acceptedInvitesForAgreement = useMemo(
    () =>
      invitationRows.filter(
        (row) =>
          String(row.status || "").toLowerCase() === "accepted" &&
          String(row.agreement || "") === String(assignForm.agreement_id || "")
      ),
    [assignForm.agreement_id, invitationRows]
  );

  const availableMilestones = useMemo(
    () =>
      assignMilestones.filter(
        (milestone) =>
          !milestone.assigned_subcontractor_invitation ||
          String(milestone.assigned_subcontractor_invitation) ===
            String(assignForm.invitation_id || "")
      ),
    [assignForm.invitation_id, assignMilestones]
  );

  async function submitInvite() {
    if (!inviteForm.agreement_id || !inviteForm.invite_email) {
      toast.error("Agreement and email are required.");
      return;
    }
    try {
      setInviteBusy(true);
      await api.post("/projects/subcontractors/invite/", inviteForm);
      toast.success("Subcontractor invitation sent.");
      setInviteOpen(false);
      setInviteForm({
        agreement_id: "",
        invite_name: "",
        invite_email: "",
        invited_message: "",
      });
      await loadHubData();
    } catch (error) {
      console.error(error);
      toast.error(
        error?.response?.data?.detail ||
          error?.response?.data?.invite_email?.[0] ||
          "Failed to send subcontractor invitation."
      );
    } finally {
      setInviteBusy(false);
    }
  }

  async function revokeInvitation(invitationId) {
    try {
      await api.post(`/projects/subcontractor-invitations/${invitationId}/revoke/`, {});
      toast.success("Invitation revoked.");
      await loadHubData();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Failed to revoke invitation.");
    }
  }

  async function submitAssignment(complianceAction = "") {
    if (!assignForm.agreement_id || !assignForm.invitation_id || !assignForm.milestone_ids.length) {
      toast.error("Agreement, subcontractor, and milestones are required.");
      return;
    }
    try {
      setAssignBusy(true);
      const payload = { ...assignForm };
      if (payload.agreed_pay === "") {
        delete payload.agreed_pay;
      }
      if (complianceAction) {
        payload.compliance_action = complianceAction;
      }
      if (assignOverrideReason) {
        payload.override_reason = assignOverrideReason;
      }
      payload.send_agreement = true;
      await api.post(
        `/projects/agreements/${assignForm.agreement_id}/subcontractor-assignments/`,
        payload
      );
      setAssignDecision(null);
      setAssignOverrideReason("");
      toast.success(
        complianceAction === "request_license"
          ? "License request sent and assignment marked pending."
          : complianceAction === "assign_anyway"
          ? "Milestones assigned with override."
          : "Milestones assigned."
      );
      setAssignOpen(false);
      setAssignForm({
        agreement_id: "",
        invitation_id: "",
        milestone_ids: [],
        agreed_pay: "",
        payment_release_mode: "manual_release",
      });
      setAssignMilestones([]);
      await loadHubData();
    } catch (error) {
      console.error(error);
      const payload = error?.response?.data;
      if (error?.response?.status === 409 && payload?.compliance_decision_required) {
        setAssignOpen(false);
        setAssignDecision(payload);
        return;
      }
      toast.error(payload?.detail || "Failed to assign subcontractor.");
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleAssignmentDecision(action) {
    if (action === "choose_another") {
      setAssignDecision(null);
      setAssignOverrideReason("");
      setAssignOpen(true);
      setAssignForm((prev) => ({
        ...prev,
        invitation_id: "",
      }));
      return;
    }
    await submitAssignment(action);
  }

  async function reviewSubmission(submissionId, action) {
    try {
      setReviewBusy((prev) => ({ ...prev, [submissionId]: true }));
      await api.post(
        `/projects/subcontractor-work-submissions/${submissionId}/review/`,
        {
          action,
          response_note: reviewNotes[submissionId] || "",
        }
      );
      toast.success(action === "approve" ? "Submission marked reviewed." : "Changes requested.");
      setReviewNotes((prev) => ({ ...prev, [submissionId]: "" }));
      await loadHubData();
    } catch (error) {
      console.error(error);
      toast.error(error?.response?.data?.detail || "Failed to review submission.");
    } finally {
      setReviewBusy((prev) => ({ ...prev, [submissionId]: false }));
    }
  }

  return (
    <ContractorPageSurface
      eyebrow="Team"
      title="Subcontractors"
      subtitle="Manage invitations, assignments, and submitted work in one place."
      variant="operational"
      contentClassName="mx-auto max-w-7xl"
      actions={
        <>
          <button
            type="button"
            data-testid="subcontractors-new-assignment-button"
            onClick={() => setAssignOpen(true)}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            Assign Work
          </button>
          <button
            type="button"
            data-testid="subcontractors-invite-button"
            onClick={() => setInviteOpen(true)}
            className="rounded-xl border border-white/20 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-sky-50"
          >
            Invite Subcontractor
          </button>
        </>
      }
    >
      <HubTabs tabs={teamHubTabs} />

      <h1 data-testid="subcontractors-page-title" className="sr-only">
        Subcontractors
      </h1>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Awaiting Review" value={submittedForReviewCount} />
        <SummaryCard label="Assigned Not Started" value={assignedNotStartedCount} />
        <SummaryCard label="Active Work" value={activeWorkCount} />
        <SummaryCard label="Overdue Work" value={overdueWorkCount} />
      </section>

      <WorkflowHint
        hint={subcontractorHint}
        testId="subcontractors-workflow-hint"
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={[
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                activeTab === tab.key
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 text-sm text-slate-500">Loading subcontractor data…</div>
        ) : null}

        {!loading && activeTab === "directory" ? (
          <div className="mt-6 space-y-3" data-testid="subcontractors-directory">
            {directoryRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                No subcontractors yet. Invite one to start assigning work and seeing activity here.
              </div>
            ) : (
              <div className="overflow-x-auto" data-testid="subcontractors-directory-table">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Subcontractor</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Work</th>
                      <th className="px-4 py-3 text-left">Last Activity</th>
                      <th className="px-4 py-3 text-left">Assignments</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {directoryRows.map((row) => (
                      <tr key={row.key} data-testid={`subcontractor-directory-row-${row.key}`} className="align-top">
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-900">{row.display_name}</div>
                          <div className="mt-1 text-sm text-slate-600">{row.email}</div>
                          <div className="mt-2 text-xs text-slate-500">
                            Agreements: {row.agreements_count} · Active jobs: {row.active_jobs_count}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChip(
                              row.status
                            )}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          <div>Active work: {row.assigned_work_count}</div>
                          <div className="mt-1">Awaiting review: {row.pending_review_count}</div>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          {formatDateTime(row.last_activity_at)}
                        </td>
                        <td className="px-4 py-4">
                          {Array.isArray(row.agreements) && row.agreements.length ? (
                            <div className="flex flex-wrap gap-2">
                              {row.agreements.map((agreement) => (
                                <Link
                                  key={`${row.key}-${agreement.agreement_id}`}
                                  to={`/app/agreements/${agreement.agreement_id}`}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                                >
                                  {agreement.agreement_title}
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">No linked agreements</span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Link
                              to={`/app/team/assignments?subaccount=${row.subcontractor_user_id || ""}`}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              View Work
                            </Link>
                            <Link
                              to={`/app/team/schedule?subaccount=${row.subcontractor_user_id || ""}`}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Schedule
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {!loading && activeTab === "invitations" ? (
          <div className="mt-6 space-y-3" data-testid="subcontractors-invitations">
            {invitationRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                No invitations yet. Invite a subcontractor when you are ready to bring them into a project.
              </div>
            ) : (
              invitationRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {row.invite_name || row.invite_email}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">{row.invite_email}</div>
                      <div className="mt-2 text-xs text-slate-500">
                        {row.agreement_title || `Agreement #${row.agreement}`} · Sent {formatDateTime(row.invited_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChip(
                          row.status
                        )}`}
                      >
                        {row.status}
                      </span>
                      {String(row.status || "").toLowerCase() === "pending" ? (
                        <button
                          type="button"
                          onClick={() => revokeInvitation(row.id)}
                          className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          Revoke
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {!loading && activeTab === "assignments" ? (
          <div className="mt-6 space-y-3" data-testid="subcontractors-assignments">
            {assignmentRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                No subcontractor assignments yet. Accepted subcontractors appear here once work is assigned.
              </div>
            ) : (
              assignmentRows.map((row) => (
                <div key={`${row.agreement_id}-${row.invitation_id}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {row.subcontractor_display_name}
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.agreement_title}
                      </div>
                      <div className="mt-2 text-xs text-slate-500">
                        {row.assigned_milestones_count} milestones · {row.submitted_for_review_count} submitted ·
                        Work value {row.total_assigned_amount ? `$${Number(row.total_assigned_amount).toFixed(2)}` : "—"} ·
                        Earliest due {formatDate(row.earliest_due_date)}
                      </div>
                      {row.compliance_warning_snapshot?.warning_message ? (
                        <div className="mt-2 text-sm text-slate-700">
                          {row.compliance_warning_snapshot.warning_message}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChip(
                          row.status
                        )}`}
                      >
                        {String(row.status || "").replaceAll("_", " ")}
                      </span>
                      <span
                        data-testid={`subcontractor-assignment-compliance-${row.invitation_id}`}
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChip(
                          row.compliance_status
                        )}`}
                      >
                        {complianceStatusLabel(row.compliance_status)}
                      </span>
                      <Link
                        to={`/app/agreements/${row.agreement_id}`}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Open Agreement
                      </Link>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

        {!loading && activeTab === "submissions" ? (
          <div className="mt-6 space-y-3" data-testid="subcontractors-submissions">
            {submissionRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                No submitted work yet. Milestones waiting on review will appear here automatically.
              </div>
            ) : (
              submissionRows.map((row) => {
                const actionable =
                  String(row.review_status || "").toLowerCase() === "submitted_for_review";
                return (
                  <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {row.milestone_title}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {row.subcontractor_display_name || row.subcontractor_email} · {row.agreement_title}
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          Submitted {formatDateTime(row.submitted_at)}
                          {row.reviewed_at ? ` · Reviewed ${formatDateTime(row.reviewed_at)}` : ""}
                        </div>
                        {row.notes ? (
                          <div className="mt-2 text-sm whitespace-pre-wrap text-slate-700">
                            {row.notes}
                          </div>
                        ) : null}
                        {row.review_response_note ? (
                          <div className="mt-2 text-sm whitespace-pre-wrap text-amber-700">
                            {row.review_response_note}
                          </div>
                        ) : null}
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusChip(
                          row.review_status
                        )}`}
                      >
                        {reviewStatusLabel(row.review_status)}
                      </span>
                    </div>

                    {actionable ? (
                      <div className="mt-4 space-y-2">
                        <textarea
                          value={reviewNotes[row.id] || ""}
                          onChange={(e) =>
                            setReviewNotes((prev) => ({ ...prev, [row.id]: e.target.value }))
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          rows={2}
                          placeholder="Optional review response"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => reviewSubmission(row.id, "approve")}
                            disabled={reviewBusy[row.id]}
                            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                          >
                            {reviewBusy[row.id] ? "Working…" : "Mark Reviewed"}
                          </button>
                          <button
                            type="button"
                            onClick={() => reviewSubmission(row.id, "needs_changes")}
                            disabled={reviewBusy[row.id]}
                            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                          >
                            Needs Changes
                          </button>
                          <Link
                            to={`/app/agreements/${row.agreement_id}`}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Open Agreement
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </section>

      {inviteOpen ? (
        <ModalShell
          title="Invite Subcontractor"
          subtitle="Invite a subcontractor to collaborate on one agreement."
          onClose={() => setInviteOpen(false)}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              value={inviteForm.agreement_id}
              onChange={(e) =>
                setInviteForm((prev) => ({ ...prev, agreement_id: e.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
            >
              <option value="">Select agreement</option>
              {agreementRows.map((agreement) => (
                <option key={agreement.id} value={agreement.id}>
                  {agreement.title || agreement.project_title || `Agreement #${agreement.id}`}
                </option>
              ))}
            </select>
            <input
              value={inviteForm.invite_name}
              onChange={(e) =>
                setInviteForm((prev) => ({ ...prev, invite_name: e.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Name"
            />
            <input
              value={inviteForm.invite_email}
              onChange={(e) =>
                setInviteForm((prev) => ({ ...prev, invite_email: e.target.value }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Email"
            />
            <textarea
              value={inviteForm.invited_message}
              onChange={(e) =>
                setInviteForm((prev) => ({ ...prev, invited_message: e.target.value }))
              }
              rows={3}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
              placeholder="Optional message"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="subcontractors-invite-submit"
              onClick={submitInvite}
              disabled={inviteBusy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {inviteBusy ? "Sending…" : "Send Invite"}
            </button>
          </div>
        </ModalShell>
      ) : null}

      {assignDecision ? (
        <ModalShell
          title="Assignment Compliance Review"
          subtitle="This assignment needs a documented decision before it proceeds."
          onClose={() => setAssignDecision(null)}
        >
          <div
            data-testid="subcontractors-assignment-compliance-decision"
            className="rounded-xl border border-amber-200 bg-amber-50 p-4"
          >
            <div className="text-sm font-semibold text-slate-900">
              Compliance review needed
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {assignDecision?.compliance_evaluation?.warning_message}
            </div>
            <div className="mt-2 text-xs text-slate-600">
              {assignDecision?.compliance_evaluation?.trade_label ||
                assignDecision?.compliance_evaluation?.trade_key ||
                "Trade"}{" "}
              in {assignDecision?.compliance_evaluation?.state_code || "the selected state"}
            </div>
            <textarea
              data-testid="subcontractors-assignment-override-reason"
              rows={2}
              value={assignOverrideReason}
              onChange={(e) => setAssignOverrideReason(e.target.value)}
              className="mt-3 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm"
              placeholder="Optional note for assigning anyway"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="subcontractors-assignment-assign-anyway"
                onClick={() => handleAssignmentDecision("assign_anyway")}
                disabled={assignBusy}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                Assign anyway
              </button>
              <button
                type="button"
                data-testid="subcontractors-assignment-request-license"
                onClick={() => handleAssignmentDecision("request_license")}
                disabled={assignBusy}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
              >
                Request license
              </button>
              <button
                type="button"
                data-testid="subcontractors-assignment-choose-another"
                onClick={() => handleAssignmentDecision("choose_another")}
                disabled={assignBusy}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                Choose another
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {assignOpen ? (
        <ModalShell
          title="Create Assignment"
          subtitle="Assign accepted subcontractors to one or more milestones."
          onClose={() => setAssignOpen(false)}
        >
          <div className="grid gap-3">
            <select
              value={assignForm.agreement_id}
              onChange={(e) =>
                setAssignForm({
                  agreement_id: e.target.value,
                  invitation_id: "",
                  milestone_ids: [],
                  agreed_pay: "",
                  payment_release_mode: "manual_release",
                })
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Select agreement</option>
              {agreementRows.map((agreement) => (
                <option key={agreement.id} value={agreement.id}>
                  {agreement.title || agreement.project_title || `Agreement #${agreement.id}`}
                </option>
              ))}
            </select>

            <select
              value={assignForm.invitation_id}
              onChange={(e) =>
                setAssignForm((prev) => ({
                  ...prev,
                  invitation_id: e.target.value,
                  milestone_ids: [],
                }))
              }
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={!assignForm.agreement_id}
            >
              <option value="">
                {assignForm.agreement_id
                  ? "Select accepted subcontractor"
                  : "Choose an agreement first"}
              </option>
              {acceptedInvitesForAgreement.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.accepted_name || row.invite_name || row.invite_email}
                </option>
              ))}
            </select>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900">Milestone Agreement Terms</div>
              <div className="mt-1 text-xs text-slate-500">
                Applies to each selected milestone. Use a different assignment if you need different pay terms.
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Agreed Pay
                  </label>
                  <input
                    data-testid="subcontractor-assignment-agreed-pay"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={assignForm.agreed_pay}
                    onChange={(e) =>
                      setAssignForm((prev) => ({ ...prev, agreed_pay: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Per selected milestone"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Payment Release Mode
                  </label>
                  <select
                    data-testid="subcontractor-assignment-payment-release-mode"
                    value={assignForm.payment_release_mode}
                    onChange={(e) =>
                      setAssignForm((prev) => ({
                        ...prev,
                        payment_release_mode: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="manual_release">Manual Release</option>
                    <option value="auto_after_customer_approval">
                      Auto-Release After Customer Approval
                    </option>
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-900">Milestones</div>
              {assignMilestonesLoading ? (
                <div className="mt-2 text-sm text-slate-500">Loading milestones…</div>
              ) : availableMilestones.length === 0 ? (
                <div className="mt-2 text-sm text-slate-500">
                  No milestones available for this agreement.
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  {availableMilestones.map((milestone) => (
                    <label
                      key={milestone.id}
                      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={assignForm.milestone_ids.includes(milestone.id)}
                        onChange={(e) =>
                          setAssignForm((prev) => ({
                            ...prev,
                            milestone_ids: e.target.checked
                              ? [...prev.milestone_ids, milestone.id]
                              : prev.milestone_ids.filter((id) => id !== milestone.id),
                          }))
                        }
                      />
                      <div className="text-sm">
                        <div className="font-medium text-slate-900">{milestone.title}</div>
                        <div className="text-slate-500">
                          Due {formatDate(milestone.completion_date)}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAssignOpen(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="subcontractors-assignment-submit"
              onClick={() => submitAssignment()}
              disabled={assignBusy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {assignBusy ? "Assigning…" : "Assign Milestones"}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </ContractorPageSurface>
  );
}
