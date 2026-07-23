export function cx(...values) {
  return values.filter(Boolean).join(" ");
}

export function humanizeStatus(value = "") {
  return String(value)
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const canonicalStatuses = Object.freeze([
  "complete",
  "recommended",
  "required",
  "blocked",
  "pending",
  "draft",
  "published",
]);
