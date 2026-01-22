// frontend/src/api/schedule.js
import api from "../api";

export async function fetchSubaccountSchedule(subaccountId) {
  const res = await api.get(`/api/projects/subaccounts/${subaccountId}/schedule/`);
  return res.data;
}

export async function updateSubaccountSchedule(subaccountId, payload) {
  const res = await api.put(`/api/projects/subaccounts/${subaccountId}/schedule/`, payload);
  return res.data;
}

export async function addScheduleException(subaccountId, payload) {
  // payload: { date: "YYYY-MM-DD", is_working: true/false, note: "" }
  const res = await api.post(`/api/projects/subaccounts/${subaccountId}/schedule/exceptions/`, payload);
  return res.data;
}

export async function deleteScheduleException(subaccountId, exceptionId) {
  const res = await api.delete(`/api/projects/subaccounts/${subaccountId}/schedule/exceptions/${exceptionId}/`);
  return res.data;
}
