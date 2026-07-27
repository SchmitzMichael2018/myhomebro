const MAX_RAW_LENGTH = 80;
const SCALE_DIGITS = 10;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const UNIT_ALIASES = new Map([
  ["m", "meters"], ["meter", "meters"], ["meters", "meters"],
  ["ft", "feet"], ["foot", "feet"], ["feet", "feet"],
  ["in", "inches"], ["inch", "inches"], ["inches", "inches"],
]);

function result(rawText, status, extra = {}) {
  return {
    raw_text: rawText,
    normalized_value: "",
    reported_unit: "",
    parse_status: status,
    warnings: [],
    locale_assumption: "",
    captured_at: "",
    ...extra,
  };
}

export function sanitizeRawText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function normalizeDecimal(integer, fraction = "") {
  const sign = integer.startsWith("-") ? "-" : "";
  const whole = integer.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "") || "0";
  const padded = `${fraction}0000000000`.slice(0, SCALE_DIGITS);
  return `${sign}${whole}.${padded}`;
}

function decimalToScaled(value) {
  const match = String(value).match(/^(-?)(\d+)\.(\d{10})$/);
  if (!match) throw new Error("Value is not a canonical decimal.");
  const scaled = BigInt(match[2]) * SCALE + BigInt(match[3]);
  return match[1] ? -scaled : scaled;
}

function scaledToDecimal(value) {
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  return `${sign}${magnitude / SCALE}.${String(magnitude % SCALE).padStart(SCALE_DIGITS, "0")}`;
}

function parseFeetInches(rawText, capturedAt) {
  const match = rawText.match(/^(\d+)\s*'\s*(\d+)(?:\s+(\d+)\/(\d+))?\s*"$/);
  if (!match) return null;
  const denominator = match[4] ? BigInt(match[4]) : 1n;
  if (denominator === 0n) return result(rawText, "invalid", { warnings: ["Fraction denominator must be greater than zero."], captured_at: capturedAt });
  const numerator = match[3] ? BigInt(match[3]) : 0n;
  const totalScaled = (BigInt(match[1]) * 12n + BigInt(match[2])) * SCALE + (numerator * SCALE) / denominator;
  return result(rawText, "valid", {
    normalized_value: scaledToDecimal(totalScaled),
    reported_unit: "inches",
    locale_assumption: "feet-inches notation",
    captured_at: capturedAt,
  });
}

export function parseLaserReading(input, { decimalSeparator = "auto", capturedAt = "" } = {}) {
  const rawText = sanitizeRawText(input);
  if (!rawText) return result(rawText, "invalid", { warnings: ["Enter one reading."], captured_at: capturedAt });
  if (rawText.length > MAX_RAW_LENGTH) return result(rawText, "invalid", { warnings: [`Reading exceeds ${MAX_RAW_LENGTH} characters.`], captured_at: capturedAt });

  const feetInches = parseFeetInches(rawText, capturedAt);
  if (feetInches) return feetInches;

  const match = rawText.match(/^([+-]?\d+)([.,]\d+)?(?:\s*(m|meters?|ft|feet|foot|in|inches?|inch))?$/i);
  if (!match) {
    const numberCount = (rawText.match(/[+-]?\d+(?:[.,]\d+)?/g) || []).length;
    const multipleReadings = /^[\d.,+\-/'"\s]+(?:m|meters?|ft|feet|foot|in|inches?|inch)\s+[\d.,+\-/'"\s]+(?:m|meters?|ft|feet|foot|in|inches?|inch)$/i.test(rawText);
    return result(rawText, multipleReadings ? "ambiguous" : "invalid", {
      warnings: [multipleReadings ? "Multiple numeric values are not supported." : "Reading contains an unsupported format or unit."],
      captured_at: capturedAt,
    });
  }

  const separator = match[2]?.[0] || "";
  const selectedSeparator = decimalSeparator === "period" ? "." : decimalSeparator === "comma" ? "," : "";
  if (separator && decimalSeparator === "auto") {
    return result(rawText, "ambiguous", {
      warnings: ["Choose the expected decimal separator before accepting this reading."],
      captured_at: capturedAt,
    });
  }
  if (separator && separator !== selectedSeparator) {
    return result(rawText, "ambiguous", {
      warnings: [`The reading uses "${separator}" but the selected decimal separator is "${decimalSeparator === "comma" ? "," : "."}".`],
      captured_at: capturedAt,
    });
  }
  if (match[1].startsWith("-") || match[1].startsWith("+")) {
    return result(rawText, "invalid", { warnings: ["Signed distances are not supported."], captured_at: capturedAt });
  }

  const unit = match[3] ? UNIT_ALIASES.get(match[3].toLowerCase()) : "";
  const warnings = unit ? [] : ["The device format did not include a unit; user confirmation is required."];
  return result(rawText, "valid", {
    normalized_value: normalizeDecimal(match[1], match[2]?.slice(1) || ""),
    reported_unit: unit,
    warnings,
    locale_assumption: separator ? `${decimalSeparator} decimal separator` : "integer value; no decimal separator",
    captured_at: capturedAt,
  });
}

export function classifyDuplicate(current, prior, { windowMs = 2500 } = {}) {
  if (!current || current.parse_status !== "valid") return "ambiguous duplicate";
  const sameSession = prior.filter((row) => row.capture_session_id === current.capture_session_id);
  if (!sameSession.length) return "distinct reading";
  const sameValue = sameSession.filter((row) =>
    row.normalized_value === current.normalized_value && row.reported_unit === current.reported_unit
  );
  if (!sameValue.length) return "distinct reading";
  const latest = sameValue.at(-1);
  const elapsed = new Date(current.captured_at).getTime() - new Date(latest.captured_at).getTime();
  if (current.raw_text === latest.raw_text && elapsed >= 0 && elapsed <= windowMs) return "exact duplicate";
  if (elapsed >= 0 && elapsed <= windowMs * 4) return "likely repeated intentional reading";
  return "ambiguous duplicate";
}

export function repeatStatistics(rows) {
  const valid = rows.filter((row) => row.parse_status === "valid").map((row) => decimalToScaled(row.normalized_value));
  if (!valid.length) return null;
  const minimum = valid.reduce((a, b) => a < b ? a : b);
  const maximum = valid.reduce((a, b) => a > b ? a : b);
  const sum = valid.reduce((a, b) => a + b, 0n);
  const mean = sum / BigInt(valid.length);
  const spread = maximum - minimum;
  const relative = mean === 0n ? null : (spread * SCALE) / (mean < 0n ? -mean : mean);
  return {
    count: valid.length,
    minimum: scaledToDecimal(minimum),
    maximum: scaledToDecimal(maximum),
    mean: scaledToDecimal(mean),
    absolute_spread: scaledToDecimal(spread),
    relative_spread: relative === null ? null : scaledToDecimal(relative),
  };
}

export function buildObservationEnvelope(reading, { firmwareVersion = "", receivedAt = "", idempotencyKey = "" } = {}) {
  if (!reading || reading.parse_status !== "valid") throw new Error("Only a valid parsed reading can shape an observation preview.");
  return {
    schema_version: "measurement-source.v1",
    idempotency_key: idempotencyKey,
    provider_key: "laser_keyboard_stabila",
    provider_version: "spike-1",
    vendor: "STABILA",
    device_model: "LD 530 BT",
    firmware_version: firmwareVersion,
    raw_value: reading.raw_text,
    reported_unit: reading.reported_unit,
    normalized_value: reading.normalized_value,
    captured_at: reading.captured_at,
    received_at: receivedAt,
    connection_method: "bluetooth_keypad",
    warnings: [...reading.warnings],
    evidence: {
      explicit_arm_capture: true,
      parser_status: reading.parse_status,
      target_assignment_required: true,
      hardware_validated: false,
    },
    verification_status: "needs_verification",
  };
}
