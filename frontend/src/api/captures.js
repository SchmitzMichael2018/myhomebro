import api from "../api";

export async function listCaptures(params = {}) {
  const response = await api.get("/projects/captures/", { params });
  return response.data;
}

export async function getCapture(captureId) {
  const response = await api.get(
    `/projects/captures/${encodeURIComponent(captureId)}/`
  );
  return response.data;
}

export async function createCapture(payload) {
  const response = await api.post("/projects/captures/", payload);
  return response.data;
}

export async function updateCapture(captureId, payload) {
  const response = await api.patch(
    `/projects/captures/${encodeURIComponent(captureId)}/`,
    payload
  );
  return response.data;
}

export async function archiveCapture(captureId, payload) {
  const response = await api.post(
    `/projects/captures/${encodeURIComponent(captureId)}/archive/`,
    payload
  );
  return response.data;
}

export async function retryCapture(captureId, payload) {
  const response = await api.post(
    `/projects/captures/${encodeURIComponent(captureId)}/retry/`,
    payload
  );
  return response.data;
}

export async function getCaptureReceipt(captureId) {
  const response = await api.get(
    `/projects/captures/${encodeURIComponent(captureId)}/receipt/`
  );
  return response.data;
}
