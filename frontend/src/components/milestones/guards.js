export function canMarkComplete(agreement) {
  if (!agreement) return false;
  const s = (agreement.status || "").toLowerCase();
  const funded = Boolean(agreement.escrow_funded);
  // Only allow after signatures *and* escrow funded
  // If your statuses are "signed" then "funded", we require funded explicitly.
  return funded && (s === "funded" || s === "signed" || s === "active");
}
