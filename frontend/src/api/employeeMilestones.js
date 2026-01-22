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

  const res = await api.post(`/projects/employee/milestones/${milestoneId}/files/`, fd, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

/**
 * POST /api/projects/employee/milestones/:id/complete/
 * Returns: { updated: boolean, completed: boolean }
 */
export async function markEmployeeMilestoneComplete(milestoneId) {
  if (!milestoneId) throw new Error("milestoneId is required");
  const res = await api.post(`/projects/employee/milestones/${milestoneId}/complete/`);
  return res.data;
}
