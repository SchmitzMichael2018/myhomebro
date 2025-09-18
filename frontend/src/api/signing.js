// src/api/signing.js
// Modern signing helpers + compatibility shims for older pages.
// Uses shared axios client `api` (baseURL: "/api") — DO NOT prefix paths with "/api".
import api from "../api";

/* =========================================================
   Modern helpers
   ========================================================= */

/** Inline preview URL (use in <iframe src=...>) */
export const agreementPreviewHref = (agreementId) =>
  `/api/projects/agreements/${agreementId}/pdf/preview/`;

/** Direct download URL (use in window.open or <a href=...>) */
export const agreementPdfHref = (agreementId) =>
  `/api/projects/agreements/${agreementId}/pdf/`;

/**
 * Sign an agreement (typed-name e-sign + optional wet signature image).
 * Matches your AgreementSignSerializer:
 *   signer_name, signer_role ("contractor"|"homeowner"),
 *   agree_tos, agree_privacy, signature_text, [signature_image]
 */
export async function signAgreement(
  agreementId,
  { signer_name, signer_role, agree_tos, agree_privacy, signature_text, signature_image }
) {
  const form = new FormData();
  form.append("signer_name", signer_name);
  form.append("signer_role", signer_role);
  form.append("agree_tos", agree_tos ? "true" : "false");
  form.append("agree_privacy", agree_privacy ? "true" : "false");
  form.append("signature_text", signature_text ?? signer_name);
  if (signature_image) form.append("signature_image", signature_image);

  const { data } = await api.post(`/projects/agreements/${agreementId}/sign/`, form);
  return data;
}

/* =========================================================
   Compatibility shims (so older pages keep building)
   ========================================================= */

/**
 * fetchAgreementReview(agreementId)
 * Legacy code expected an API; the new flow just needs URLs.
 * Return an object mirroring the old shape with preview/pdf hrefs.
 */
export async function fetchAgreementReview(agreementId) {
  return {
    preview_url: agreementPreviewHref(agreementId),
    pdf_url: agreementPdfHref(agreementId),
  };
}

/**
 * postAgreementEmail(agreementId, payload)
 * Optional: if you add a backend endpoint later (POST /projects/agreements/:id/email/),
 * this will use it; otherwise it fails gracefully so the UI won't crash.
 */
export async function postAgreementEmail(agreementId, payload = {}) {
  try {
    const { data } = await api.post(`/projects/agreements/${agreementId}/email/`, payload);
    return { ok: true, data };
  } catch (err) {
    const detail =
      err?.response?.data?.detail ||
      err?.response?.data?.error ||
      err?.message ||
      "Email endpoint not available.";
    return { ok: false, error: detail };
  }
}

/**
 * postAgreementPreview(agreementId)
 * Old code did a POST to a preview endpoint. We just return the preview URL.
 */
export async function postAgreementPreview(agreementId) {
  return { ok: true, preview_url: agreementPreviewHref(agreementId) };
}

/**
 * postAgreementMarkReviewed(agreementId)
 * If you later add an action like POST /projects/agreements/:id/mark_reviewed/,
 * we'll call it. Until then, resolve success so the UI flow continues.
 */
export async function postAgreementMarkReviewed(agreementId) {
  try {
    // Try an optional backend action if it exists in your codebase
    const { data } = await api.post(`/projects/agreements/${agreementId}/mark_reviewed/`, {});
    return { ok: true, data };
  } catch (err) {
    // No-op success for compatibility
    return { ok: true, skipped: true };
  }
}

/**
 * postAgreementRegeneratePdf(agreementId)
 * Ideal backend: POST /projects/agreements/:id/pdf/regenerate/
 * If that doesn't exist, we "touch" the preview endpoint which (re)generates
 * the file in our current setup, then return success.
 */
export async function postAgreementRegeneratePdf(agreementId) {
  try {
    // Preferred: explicit regenerate endpoint if you add one later
    const { data } = await api.post(`/projects/agreements/${agreementId}/pdf/regenerate/`, {});
    return { ok: true, data, href: agreementPdfHref(agreementId) };
  } catch {
    // Fallback: hit preview to ensure a fresh file exists
    await fetch(agreementPreviewHref(agreementId), { method: "GET", credentials: "include" });
    return { ok: true, href: agreementPdfHref(agreementId) };
  }
}

/** Simple helper retained for older code */
export function legacyPreview(agreementId) {
  return agreementPreviewHref(agreementId);
}
