export const ESTIMATE_QUEUE_STAGES = [
  { key: "all_active", label: "All Active" },
  { key: "needs_estimate", label: "Needs Estimate" },
  { key: "in_progress", label: "In Progress" },
  { key: "ready_to_send", label: "Ready to Send" },
  { key: "with_customer", label: "With Customer" },
  { key: "accepted", label: "Accepted" },
  { key: "converted", label: "Converted" },
  { key: "closed", label: "Closed" },
];

export const ESTIMATE_STATUS_LABELS = {
  draft: "Draft",
  site_visit: "Site Visit",
  in_progress: "In Progress",
  ready: "Ready to Send",
  sent: "Sent · Awaiting Review",
  viewed: "Viewed · Awaiting Decision",
  accepted: "Accepted · Agreement Ready",
  declined: "Declined",
  revision_requested: "Changes Requested",
  expired: "Expired",
  converted: "Converted",
  cancelled: "Cancelled",
};

export function estimateQueueStage(estimate) {
  const status = String(estimate?.status || "").trim().toLowerCase();
  if (status === "converted" || estimate?.linked_agreement_id) return "converted";
  if (status === "declined" || status === "expired" || status === "cancelled") return "closed";
  if (status === "accepted") return "accepted";
  if (status === "sent" || status === "viewed") return "with_customer";
  if (status === "ready") return "ready_to_send";
  if (["site_visit", "in_progress", "revision_requested"].includes(status)) return "in_progress";
  return "needs_estimate";
}

export function isActiveEstimateStage(stage) {
  return !["converted", "closed"].includes(stage);
}

export function estimateStageCounts(estimates) {
  const counts = Object.fromEntries(ESTIMATE_QUEUE_STAGES.map(({ key }) => [key, 0]));
  for (const estimate of estimates) {
    const stage = estimateQueueStage(estimate);
    counts[stage] += 1;
    if (isActiveEstimateStage(stage)) counts.all_active += 1;
  }
  return counts;
}

export function estimateMatchesStage(estimate, stage) {
  const actual = estimateQueueStage(estimate);
  return stage === "all_active" ? isActiveEstimateStage(actual) : actual === stage;
}

export function estimateNextPriority(estimates) {
  const statuses = new Set(estimates.map((row) => String(row?.status || "").toLowerCase()));
  if (statuses.has("revision_requested")) return "Review customer change requests and revise the estimate.";
  if (statuses.has("accepted")) return "Create an agreement for an accepted estimate.";
  if (statuses.has("ready")) return "Send completed estimates to customers for review.";
  if (["draft", "site_visit", "in_progress"].some((status) => statuses.has(status))) return "Continue preparing the highest-priority estimate.";
  if (statuses.has("sent") || statuses.has("viewed")) return "Customer review is underway; no contractor action is currently required.";
  return "No active estimate work requires attention.";
}
