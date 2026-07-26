function envFlag(name) {
  return String(import.meta.env[name] || "")
    .trim()
    .toLowerCase() === "true";
}

export const captureFlags = Object.freeze({
  foundation: envFlag("VITE_CAPTURE_FOUNDATION_ENABLED"),
  inbox: envFlag("VITE_CAPTURE_INBOX_ENABLED"),
  review: envFlag("VITE_CAPTURE_REVIEW_ENABLED"),
});

export function isCaptureInboxEnabled(flags = captureFlags) {
  return Boolean(flags.foundation && flags.inbox);
}

export function isCaptureReviewEnabled(flags = captureFlags) {
  return Boolean(isCaptureInboxEnabled(flags) && flags.review);
}
