import { describe, expect, it } from "vitest";
import { buildObservationEnvelope, classifyDuplicate, parseLaserReading, repeatStatistics, sanitizeRawText } from "./laserSpike.js";

const at = "2026-07-26T12:00:00.000Z";

describe("STABILA spike parser", () => {
  it("parses period and comma decimals only with an explicit locale", () => {
    expect(parseLaserReading("12.345 m", { decimalSeparator: "period" }).normalized_value).toBe("12.3450000000");
    expect(parseLaserReading("12,345 m", { decimalSeparator: "comma" }).normalized_value).toBe("12.3450000000");
    expect(parseLaserReading("12,345", { decimalSeparator: "auto" }).parse_status).toBe("ambiguous");
  });

  it.each([
    ["3.45 ft", "feet", "3.4500000000"],
    ["41.5 in", "inches", "41.5000000000"],
    [`3' 5 1/2"`, "inches", "41.5000000000"],
  ])("supports bounded unit fixture %s", (raw, unit, value) => {
    const parsed = parseLaserReading(raw, { decimalSeparator: "period" });
    expect(parsed).toMatchObject({ parse_status: "valid", reported_unit: unit, normalized_value: value });
  });

  it("rejects malformed, multiple, signed, and oversized input", () => {
    expect(parseLaserReading("12 m 13 m", { decimalSeparator: "period" }).parse_status).toBe("ambiguous");
    expect(parseLaserReading("12 m alert(1)", { decimalSeparator: "period" }).parse_status).toBe("invalid");
    expect(parseLaserReading("-1.2 m", { decimalSeparator: "period" }).parse_status).toBe("invalid");
    expect(parseLaserReading("1".repeat(81), { decimalSeparator: "period" }).parse_status).toBe("invalid");
  });

  it("strips control characters without executing or interpreting text", () => {
    expect(sanitizeRawText("\u0000\u000712.3 m\r\n")).toBe("12.3 m");
  });
});

describe("spike-only analysis", () => {
  const reading = (raw, time) => ({
    ...parseLaserReading(raw, { decimalSeparator: "period", capturedAt: time }),
    capture_session_id: "session-a",
  });

  it("classifies exact, likely, distinct, and ambiguous duplicates", () => {
    const first = reading("12.0 m", at);
    expect(classifyDuplicate(reading("12.0 m", "2026-07-26T12:00:01.000Z"), [first])).toBe("exact duplicate");
    expect(classifyDuplicate(reading("12.00 m", "2026-07-26T12:00:04.000Z"), [first])).toBe("likely repeated intentional reading");
    expect(classifyDuplicate(reading("13.0 m", "2026-07-26T12:00:01.000Z"), [first])).toBe("distinct reading");
    expect(classifyDuplicate(parseLaserReading("bad"), [first])).toBe("ambiguous duplicate");
  });

  it("calculates Decimal-safe repeat statistics", () => {
    expect(repeatStatistics([reading("10.0 m", at), reading("10.2 m", at)])).toEqual({
      count: 2,
      minimum: "10.0000000000",
      maximum: "10.2000000000",
      mean: "10.1000000000",
      absolute_spread: "0.2000000000",
      relative_spread: "0.0198019801",
    });
  });

  it("shapes a bounded non-persistent observation envelope", () => {
    const envelope = buildObservationEnvelope(reading("3.45 ft", at), {
      idempotencyKey: "synthetic-id", receivedAt: at,
    });
    expect(envelope).toMatchObject({
      provider_key: "laser_keyboard_stabila",
      device_model: "LD 530 BT",
      normalized_value: "3.4500000000",
      verification_status: "needs_verification",
    });
    expect(envelope.evidence.hardware_validated).toBe(false);
    expect(envelope).not.toHaveProperty("serial_number");
    expect(envelope).not.toHaveProperty("mac_address");
  });
});

