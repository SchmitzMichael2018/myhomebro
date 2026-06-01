export function formatGeneratedScopeAsBullets(value = "") {
  const raw = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const hasBullets = /(^|\n)\s*[-*]\s+\S/.test(raw);
  const hasNumberedList = /(^|\n)\s*\d+[.)]\s+\S/.test(raw);
  if (hasBullets && !hasNumberedList) return raw;

  const normalized = raw
    .replace(/(^|\n)\s*\d+[.)]\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const sentenceParts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.replace(/[.!?]+$/g, "").trim())
    .filter(Boolean);

  if (sentenceParts.length < 2 && !hasNumberedList && !/,/.test(normalized)) return raw;

  const included = [];
  const exclusions = [];
  const customer = [];

  sentenceParts.forEach((sentence) => {
    const cleaned = sentence
      .replace(/^(scope of work|work includes|included work|includes)\s*[:,-]?\s*/i, "")
      .trim();
    if (!cleaned) return;
    if (/\b(not included|excluded|exclusions?|unless specified|unless added)\b/i.test(cleaned)) {
      exclusions.push(cleaned.replace(/^not included unless specified\s*[:,-]?\s*/i, ""));
    } else if (/\bcustomer\b/i.test(cleaned) && /\b(provide|confirm|responsib|select|approve|access)\b/i.test(cleaned)) {
      customer.push(cleaned);
    } else {
      included.push(cleaned);
    }
  });

  const minIncluded = 5;
  const maxBullets = 12;
  const genericIncluded = [
    "Verify site conditions, measurements, access, and material requirements before work begins",
    "Coordinate agreed labor, materials, installation activities, and job sequencing",
    "Protect adjacent areas affected by the work and maintain a reasonably clean work area",
    "Complete the described installation, repair, replacement, or removal work for the project area",
    "Perform final cleanup and review completed work with the customer",
  ];
  genericIncluded.forEach((item) => {
    if (included.length < minIncluded && !included.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
      included.push(item);
    }
  });

  const cappedIncluded = included.slice(0, Math.max(minIncluded, maxBullets - exclusions.length - customer.length));
  const cappedExclusions = exclusions.slice(0, Math.max(0, maxBullets - cappedIncluded.length - customer.length));
  const cappedCustomer = customer.slice(0, Math.max(0, maxBullets - cappedIncluded.length - cappedExclusions.length));

  const sections = ["Included Work", ...cappedIncluded.map((item) => `- ${item}`)];
  if (cappedExclusions.length) {
    sections.push("", "Exclusions", ...cappedExclusions.map((item) => `- ${item}`));
  }
  if (cappedCustomer.length) {
    sections.push("", "Customer Responsibilities", ...cappedCustomer.map((item) => `- ${item}`));
  }
  return sections.join("\n").trim();
}
