// frontend/src/api/employeeMilestones.js
// v2026-01-06 — Employee milestone API helpers (subaccount endpoints)
// Fix: import api from "../api" (NOT "./api")

import api from "../api";

/**
 * GET /api/projects/employee/milestones/
 * Returns: { can_work: boolean, milestones: [...] }
 */
export async function fetchEmployeeMilestones() {
  const res = await api.get("/projects/employee/milestones/");
  return res.data;
}

/**
 * GET /api/projects/employee/milestones/:id/
 * Returns: { can_work, milestone, comments, files }
 */
export async function fetchEmployeeMilestoneDetail(milestoneId) {
  if (!milestoneId) throw new Error("milestoneId is required");
  const res = await api.get(`/projects/employee/milestones/${milestoneId}/`);
  return res.data;
}

/**
 * POST /api/projects/employee/milestones/:id/comments/
 * Body: { content: string }
 * Returns: { id, author_email, content, created_at }
 */
export async function addEmployeeMilestoneComment(milestoneId, content) {
  if (!milestoneId) throw new Error("milestoneId is required");
  const text = (content || "").trim();
  if (!text) throw new Error("content is required");

  const res = await api.post(`/projects/employee/milestones/${milestoneId}/comments/`, {
    content: text,
  });
  return res.data;
}

/**
 * POST /api/projects/employee/milestones/:id/files/
 * multipart/form-data with file=<File>
 * Returns: { id, uploaded_by_email, file_url, uploaded_at }
 */
export async function uploadEmployeeMilestoneFile(milestoneId, file) {
  if (!milestoneId) throw new Error("milestoneId is required");
  if (!file) throw new Error("file is required");

  const fd = new FormData();
  fd.append("file", file);

  // Let the browser set Content-Type so the multipart boundary is included.
  // Supplying the header manually can produce an empty upload on mobile WebViews.
  const res = await api.post(`/projects/employee/milestones/${milestoneId}/files/`, fd);
  return res.data;
}

export async function deleteEmployeeMilestoneFile(milestoneId, fileId) {
  if (!milestoneId) throw new Error("milestoneId is required");
  if (!fileId) throw new Error("fileId is required");
  await api.delete(`/projects/employee/milestones/${milestoneId}/files/${fileId}/`);
}

/**
 * POST /api/projects/employee/milestones/:id/complete/
 * Returns: { updated: boolean, completed: boolean }
 */
export async function submitEmployeeMilestoneForReview(milestoneId, note = "") {
  if (!milestoneId) throw new Error("milestoneId is required");
  const res = await api.post(`/projects/employee/milestones/${milestoneId}/complete/`, { note });
  return res.data;
}
