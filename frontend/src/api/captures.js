import api from "../api";

export async function listCaptures(params = {}) {
  const response = await api.get("/projects/captures/", { params });
  return response.data;
}

export async function listCaptureQrAssets() {
  const response = await api.get("/projects/capture-qr-assets/");
  return response.data;
}

export async function createCaptureQrAsset(payload) {
  const response = await api.post("/projects/capture-qr-assets/", payload);
  return response.data;
}

export async function updateCaptureQrAsset(assetId, payload) {
  const response = await api.patch(`/projects/capture-qr-assets/${assetId}/`, payload);
  return response.data;
}

export async function actOnCaptureQrAsset(assetId, action) {
  const response = await api.post(`/projects/capture-qr-assets/${assetId}/${action}/`);
  return response.data;
}

export async function getCaptureQrAnalytics(assetId) {
  const response = await api.get(`/projects/capture-qr-assets/${assetId}/analytics/`);
  return response.data;
}

export async function downloadCaptureQr(assetId) {
  const response = await api.get(`/projects/capture-qr-assets/${assetId}/qr/`, {
    responseType: "blob",
  });
  return response.data;
}

export async function getPublicCaptureQr(token) {
  const response = await api.get(`/projects/public/capture-qr/${encodeURIComponent(token)}/`);
  return response.data;
}

export async function submitPublicCaptureQr(token, payload, options = {}) {
  const response = await api.post(
    `/projects/public/capture-qr/${encodeURIComponent(token)}/`,
    payload,
    options
  );
  return response.data;
}

export async function getCapture(captureId) {
  const response = await api.get(
    `/projects/captures/${encodeURIComponent(captureId)}/`
  );
  return response.data;
}

export async function getCaptureTimeline(captureId) {
  const response = await api.get(
    `/projects/captures/${encodeURIComponent(captureId)}/timeline/`
  );
  return response.data;
}

export async function getCaptureArtifacts(captureId) {
  const response = await api.get(
    `/projects/captures/${encodeURIComponent(captureId)}/artifacts/`
  );
  return response.data;
}

export async function createCapture(payload) {
  const response = await api.post("/projects/captures/", payload);
  return response.data;
}

export async function getCaptureProjectOptions() {
  const response = await api.get("/projects/captures/project-options/");
  return response.data?.results || [];
}

export async function createProjectCapture(payload, files = []) {
  const form = new FormData();
  form.append("capture_type", payload.capture_type);
  form.append("capture_method", payload.capture_method || "typed");
  form.append("project_id", String(payload.project_id));
  if (payload.milestone_id) form.append("milestone_id", String(payload.milestone_id));
  form.append("raw_text_payload", JSON.stringify(payload.raw_text_payload || {}));
  files.forEach((file) => form.append("files", file));
  const response = await api.post("/projects/captures/", form);
  return response.data;
}

export async function createPhotoCapture(file) {
  const form = new FormData();
  form.append("capture_type", "photo");
  form.append("capture_method", "camera");
  form.append("file", file);
  const response = await api.post("/projects/captures/", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
}

export async function getCaptureSummary() {
  const response = await api.get("/projects/captures/summary/");
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

export async function processCapture(captureId, payload) {
  const response = await api.post(
    `/projects/captures/${encodeURIComponent(captureId)}/process/`,
    payload
  );
  return response.data;
}

export async function updateCaptureReview(captureId, payload) {
  const response = await api.patch(
    `/projects/captures/${encodeURIComponent(captureId)}/review/`,
    payload
  );
  return response.data;
}

export async function approveCaptureReview(captureId, payload) {
  const response = await api.post(
    `/projects/captures/${encodeURIComponent(captureId)}/approve/`,
    payload
  );
  return response.data;
}

export async function getCaptureDuplicates(captureId) {
  const response = await api.get(
    `/projects/captures/${encodeURIComponent(captureId)}/duplicates/`
  );
  return response.data;
}

export async function previewCaptureApplication(captureId, payload) {
  const response = await api.post(
    `/projects/captures/${encodeURIComponent(captureId)}/application-preview/`,
    payload
  );
  return response.data;
}

export async function applyCapture(captureId, payload) {
  const response = await api.post(
    `/projects/captures/${encodeURIComponent(captureId)}/apply/`,
    payload
  );
  return response.data;
}

export async function listCaptureCustomers() {
  const response = await api.get("/projects/homeowners/", {
    params: { page_size: 100, ordering: "full_name" },
  });
  return Array.isArray(response.data) ? response.data : response.data?.results || [];
}

export async function getCaptureReceipt(captureId) {
  const response = await api.get(
    `/projects/captures/${encodeURIComponent(captureId)}/receipt/`
  );
  return response.data;
}

export async function getMeasurementSession(sessionId) {
  const response = await api.get(`/projects/measurements/${encodeURIComponent(sessionId)}/`);
  return response.data;
}

export async function listPlanDocuments(sessionId) {
  const response = await api.get("/projects/measurement-plan-documents/", {
    params: { measurement_session: sessionId },
  });
  return response.data;
}

export async function createPlanDocument(sessionId, file) {
  const form = new FormData();
  form.append("measurement_session", String(sessionId));
  form.append("file", file);
  const response = await api.post("/projects/measurement-plan-documents/", form);
  return response.data;
}

export async function createPlanDocumentFromArtifact(sessionId, artifactId) {
  const response = await api.post("/projects/measurement-plan-documents/", {
    measurement_session: sessionId,
    artifact_id: artifactId,
  });
  return response.data;
}

export async function getPlanDocument(documentId) {
  const response = await api.get(`/projects/measurement-plan-documents/${encodeURIComponent(documentId)}/`);
  return response.data;
}

export async function getPlanPdfData(documentId) {
  const response = await api.get(
    `/projects/measurement-plan-documents/${encodeURIComponent(documentId)}/file/`,
    { responseType: "arraybuffer" }
  );
  return response.data;
}

export async function createPlanCalibration(documentId, payload) {
  const response = await api.post(`/projects/measurement-plan-documents/${encodeURIComponent(documentId)}/calibrations/`, payload);
  return response.data;
}

export async function createPlanAnnotation(documentId, payload) {
  const response = await api.post(`/projects/measurement-plan-documents/${encodeURIComponent(documentId)}/annotations/`, payload);
  return response.data;
}

export async function actOnPlanAnnotation(annotationId, action, payload = {}) {
  const response = await api.post(`/projects/measurement-plan-annotations/${encodeURIComponent(annotationId)}/${action}/`, payload);
  return response.data;
}

export async function listMaterials() {
  const response = await api.get("/projects/materials/", { params: { active: "true" } });
  return response.data?.results || [];
}

export async function createMaterial(payload) {
  const response = await api.post("/projects/materials/", payload);
  return response.data;
}

export async function createTakeoff(payload) {
  const response = await api.post("/projects/takeoffs/", payload);
  return response.data;
}

export async function getTakeoff(takeoffId) {
  const response = await api.get(`/projects/takeoffs/${encodeURIComponent(takeoffId)}/`);
  return response.data;
}

export async function updateTakeoff(takeoffId, payload) {
  const response = await api.patch(`/projects/takeoffs/${encodeURIComponent(takeoffId)}/`, payload);
  return response.data;
}

export async function actOnTakeoff(takeoffId, action, payload) {
  const response = await api.post(`/projects/takeoffs/${encodeURIComponent(takeoffId)}/${action}/`, payload);
  return response.data;
}

export async function previewTakeoffEstimate(takeoffId) {
  const response = await api.post(`/projects/takeoffs/${encodeURIComponent(takeoffId)}/estimate-preview/`, {});
  return response.data;
}
