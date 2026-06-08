// frontend/src/api/expenses.js
import api from "../api";

export async function listExpenses(params = {}) {
  const { data } = await api.get("/projects/expense-requests/", { params });
  return data;
}

export async function getExpense(id) {
  const { data } = await api.get(`/projects/expense-requests/${id}/`);
  return data;
}

export async function createExpense({ agreement, milestone, description, amount, incurred_date, file, notes_to_homeowner, request_kind, category }) {
  const form = new FormData();
  if (agreement) form.append("agreement", agreement);
  if (milestone) form.append("milestone", milestone);
  form.append("description", description);
  form.append("amount", amount);
  if (incurred_date) form.append("incurred_date", incurred_date);
  if (notes_to_homeowner) form.append("notes_to_homeowner", notes_to_homeowner);
  if (request_kind) form.append("request_kind", request_kind);
  if (category) form.append("category", category);
  if (file) form.append("receipt", file);
  const { data } = await api.post("/projects/expense-requests/", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function updateExpense(id, payload) {
  const { data } = await api.patch(`/projects/expense-requests/${id}/`, payload);
  return data;
}

export async function uploadReceipt(id, file) {
  const form = new FormData();
  form.append("receipt", file);
  const { data } = await api.patch(`/projects/expense-requests/${id}/`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function contractorSignExpense(id) {
  const { data } = await api.post(`/projects/expense-requests/${id}/contractor_sign/`);
  return data;
}

export async function sendExpenseToHomeowner(id) {
  const { data } = await api.post(`/projects/expense-requests/${id}/send_to_homeowner/`);
  return data;
}

export async function homeownerAcceptExpense(id) {
  const { data } = await api.post(`/projects/expense-requests/${id}/homeowner_accept/`);
  return data;
}

export async function homeownerRejectExpense(id) {
  const { data } = await api.post(`/projects/expense-requests/${id}/homeowner_reject/`);
  return data;
}

export async function markExpensePaid(id) {
  const { data } = await api.post(`/projects/expense-requests/${id}/mark_paid/`);
  return data;
}
