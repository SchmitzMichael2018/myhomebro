import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";
import {
  assignMilestoneToSubaccount,
  fetchMilestoneAssignmentStatus,
  unassignMilestone,
} from "../api/assignments";
import AssignEmployeeInline from "./AssignEmployeeInline";
import AssignSubcontractorInline from "./AssignSubcontractorInline";
import MilestoneCollaboratorsInline from "./MilestoneCollaboratorsInline";

export default function MilestoneAssignmentDialog({ milestone, onClose, onUpdated }) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [subcontractors, setSubcontractors] = useState([]);

  const refresh = async () => {
    if (!milestone?.id) return;
    const agreementId = milestone.agreement_id || milestone._agId || milestone.agreement;
    setLoading(true);
    try {
      const [assignmentResult, subcontractorResult] = await Promise.all([
        fetchMilestoneAssignmentStatus(milestone.id),
        agreementId
          ? api.get(`/projects/agreements/${agreementId}/subcontractor-invitations/`)
          : Promise.resolve({ data: { accepted_subcontractors: [] } }),
      ]);
      setStatus(assignmentResult);
      setSubcontractors(subcontractorResult.data?.accepted_subcontractors || []);
    } catch (error) {
      console.error(error);
      toast.error("Could not load assignment options.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [milestone?.id]);

  const finishUpdate = async () => {
    await refresh();
    await onUpdated?.();
  };

  const assignEmployee = async (subaccountId) => {
    if (milestone.assigned_subcontractor) {
      throw new Error("Remove the subcontractor before assigning an employee.");
    }
    await assignMilestoneToSubaccount(milestone.id, subaccountId);
    toast.success("Milestone assigned to team member.");
    await finishUpdate();
  };

  const removeEmployee = async () => {
    await unassignMilestone(milestone.id);
    toast.success("Team member assignment removed.");
    await finishUpdate();
  };

  const assignSubcontractor = async (invitationId, options = {}) => {
    if (status?.override_subaccount || status?.collaborator_subaccounts?.length) {
      throw new Error("Remove all assigned team members before assigning a subcontractor.");
    }
    const payload = {
      invitation_id: invitationId,
      compliance_action: options.complianceAction || undefined,
      override_reason: options.overrideReason || undefined,
      agreed_pay: options.agreedPay || undefined,
      payment_release_mode: options.paymentReleaseMode || "manual_release",
      send_agreement: options.sendAgreement !== false,
    };
    await api.post(`/projects/milestones/${milestone.id}/assign-subcontractor/`, payload);
    toast.success("Milestone assigned to subcontractor.");
    await finishUpdate();
  };

  const removeSubcontractor = async () => {
    await api.patch(`/projects/milestones/${milestone.id}/`, {
      assigned_subcontractor_invitation: null,
    });
    toast.success("Subcontractor assignment removed.");
    await finishUpdate();
  };

  if (!milestone) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="milestone-assignment-title">
      <div data-testid="milestone-assignment-dialog" className="max-h-[90vh] w-full max-w-4xl overflow-x-hidden overflow-y-auto rounded-2xl border border-white/15 bg-[#061d42] p-5 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-sky-100/55">Assign milestone</div>
            <h2 id="milestone-assignment-title" className="mt-1 text-xl font-bold">{milestone.title || "Milestone"}</h2>
            <p className="mt-1 text-sm text-sky-100/65">Choose one primary worker for accountability, then add any other employees who will work on this milestone.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold hover:bg-white/10">Close</button>
        </div>

        {loading ? <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4 text-sky-100/70">Loading assignment options...</div> : (
          <div className="mt-5 space-y-4">
            <AssignEmployeeInline
              theme="operational"
              label="Assign Team Member"
              help="This person will see and submit work for this milestone. Assign additional milestones the same way."
              currentAssignment={status?.override_subaccount}
              onAssign={assignEmployee}
              onUnassign={removeEmployee}
              assignButtonLabel="Assign Team Member"
              unassignButtonLabel="Remove Team Member"
              unassignRequiresSelection={false}
              disabled={!!milestone.assigned_subcontractor}
            />
            <MilestoneCollaboratorsInline
              milestoneId={milestone.id}
              disabled={!!milestone.assigned_subcontractor}
              onUpdated={refresh}
            />
            <AssignSubcontractorInline
              theme="operational"
              acceptedSubcontractors={subcontractors}
              currentAssignment={milestone.assigned_subcontractor}
              currentCompliance={milestone.subcontractor_assignment_compliance}
              currentAgreement={milestone.subcontractor_milestone_agreement}
              milestoneAmount={milestone.amount}
              onAssign={assignSubcontractor}
              onUnassign={removeSubcontractor}
              disabled={!!status?.override_subaccount || !!status?.collaborator_subaccounts?.length}
            />
          </div>
        )}
      </div>
    </div>
  );
}
