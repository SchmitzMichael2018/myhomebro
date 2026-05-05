const TERMINAL_DISPUTE_STATUSES = new Set([
  "resolved",
  "resolved_contractor",
  "resolved_customer",
  "resolved_homeowner",
  "closed",
  "canceled",
  "cancelled",
]);

export function normalizeDisputeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

export function isDisputeTerminal(status) {
  const normalized = normalizeDisputeStatus(status);
  if (!normalized) return false;
  if (TERMINAL_DISPUTE_STATUSES.has(normalized)) return true;
  return normalized.startsWith("resolved_");
}

export function canRespondToDispute(status) {
  const normalized = normalizeDisputeStatus(status);
  return !isDisputeTerminal(normalized) && (normalized === "open" || normalized === "under_review");
}

export function canCancelDispute(status) {
  const normalized = normalizeDisputeStatus(status);
  return !isDisputeTerminal(normalized) && (normalized === "initiated" || normalized === "open");
}

export function canUploadToDispute(status) {
  return !isDisputeTerminal(status);
}

export function canResolveDispute(status) {
  return !isDisputeTerminal(status);
}

export function isDisputeArchived(dispute) {
  return Boolean(dispute?.is_archived);
}

export function getDisputeReadOnlyLabel(status) {
  return isDisputeTerminal(status) ? "Read only" : "";
}
