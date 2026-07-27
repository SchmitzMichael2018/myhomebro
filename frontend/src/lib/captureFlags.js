function envFlag(name) {
  return String(import.meta.env[name] || "")
    .trim()
    .toLowerCase() === "true";
}

export const captureFlags = Object.freeze({
  foundation: envFlag("VITE_CAPTURE_FOUNDATION_ENABLED"),
  inbox: envFlag("VITE_CAPTURE_INBOX_ENABLED"),
  review: envFlag("VITE_CAPTURE_REVIEW_ENABLED"),
  application: envFlag("VITE_CAPTURE_APPLICATION_ENABLED"),
  qr: envFlag("VITE_CAPTURE_QR_ENABLED"),
  fieldFindings: envFlag("VITE_CAPTURE_FIELD_FINDINGS_ENABLED"),
});

export function isCaptureFieldFindingsEnabled(flags = captureFlags) {
  return Boolean(isCaptureReviewEnabled(flags) && flags.fieldFindings);
}

export function isCaptureInboxEnabled(flags = captureFlags) {
  return Boolean(flags.foundation && flags.inbox);
}

export function isCaptureReviewEnabled(flags = captureFlags) {
  return Boolean(isCaptureInboxEnabled(flags) && flags.review);
}

export function isCaptureApplicationEnabled(flags = captureFlags) {
  return Boolean(isCaptureReviewEnabled(flags) && flags.application);
}

export function isCaptureQrEnabled(flags = captureFlags) {
  return Boolean(isCaptureInboxEnabled(flags) && flags.qr);
}
