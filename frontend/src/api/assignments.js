// frontend/src/api/assignments.js
import api from "../api";

export async function assignAgreementToSubaccount(agreementId, subaccountId) {
  const res = await api.post(`/api/projects/assignments/agreements/${agreementId}/assign/`, {
    subaccount_id: subaccountId,
  });
  return res.data;
}

export async function unassignAgreementFromSubaccount(agreementId, subaccountId) {
  const res = await api.post(`/api/projects/assignments/agreements/${agreementId}/unassign/`, {
    subaccount_id: subaccountId,
  });
  return res.data;
}

export async function assignMilestoneToSubaccount(milestoneId, subaccountId) {
  const res = await api.post(`/api/projects/assignments/milestones/${milestoneId}/assign/`, {
    subaccount_id: subaccountId,
  });
  return res.data;
}

export async function unassignMilestone(milestoneId) {
  const res = await api.post(`/api/projects/assignments/milestones/${milestoneId}/unassign/`);
  return res.data;
}

// ✅ NEW: assignment status
export async function fetchAgreementAssignmentStatus(agreementId) {
  const res = await api.get(`/api/projects/assignments/agreements/${agreementId}/status/`);
  return res.data;
}

export async function fetchMilestoneAssignmentStatus(milestoneId) {
  const res = await api.get(`/api/projects/assignments/milestones/${milestoneId}/status/`);
  return res.data;
}
