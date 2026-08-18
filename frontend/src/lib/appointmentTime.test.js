import { describe, expect, it } from "vitest";
import { appointmentTimeOptions, nextAppointmentIncrement, normalizeAppointmentWallTime, validateFutureAppointment, zonedParts, zonedWallTimeToIso } from "./appointmentTime.js";

describe("appointment time alignment", () => {
  it.each([["12:01", "12:15"], ["12:26", "12:30"], ["12:59", "13:00"]])("rounds %s forward to %s", (time, expected) => {
    expect(normalizeAppointmentWallTime({ date: "2026-08-18", time, incrementMinutes: 15 }).time).toBe(expected);
  });
  it("rolls the date at midnight", () => {
    expect(normalizeAppointmentWallTime({ date: "2026-08-18", time: "23:59", incrementMinutes: 15 })).toMatchObject({ date: "2026-08-19", time: "00:00" });
  });
  it.each(["12:00", "12:15", "12:30", "12:45"])("keeps aligned value %s", (time) => {
    expect(normalizeAppointmentWallTime({ date: "2026-08-18", time, incrementMinutes: 15 }).changed).toBe(false);
  });
  it("uses a configurable increment", () => {
    expect(normalizeAppointmentWallTime({ date: "2026-08-18", time: "12:11", incrementMinutes: 20 }).time).toBe("12:20");
  });
  it("moves an exact-boundary default to the next increment", () => {
    expect(nextAppointmentIncrement({ now: new Date("2026-08-18T17:15:00Z"), timeZone: "America/Chicago", incrementMinutes: 15 }).time).toBe("12:30");
  });
  it("rounds in the selected timezone", () => {
    const result = nextAppointmentIncrement({ now: new Date("2026-08-18T17:26:00Z"), timeZone: "America/Chicago", incrementMinutes: 15 });
    expect(result).toMatchObject({ date: "2026-08-18", time: "12:30" });
  });
  it("handles the spring DST gap without creating a false instant", () => {
    expect(() => zonedWallTimeToIso("2026-03-08", "02:15", "America/Chicago")).toThrow(/does not exist/);
    expect(zonedParts(new Date(zonedWallTimeToIso("2026-03-08", "03:15", "America/Chicago")), "America/Chicago").time).toBe("03:15");
  });
  it("uses a controlled clock and selected timezone to reject past wall times", () => {
    const now = new Date("2026-08-18T17:30:00Z");
    expect(validateFutureAppointment({ date: "2026-08-17", time: "12:30", timeZone: "America/Chicago", now }).valid).toBe(false);
    expect(validateFutureAppointment({ date: "2026-08-18", time: "12:15", timeZone: "America/Chicago", now }).valid).toBe(false);
    expect(validateFutureAppointment({ date: "2026-08-18", time: "12:45", timeZone: "America/Chicago", now }).valid).toBe(true);
  });
  it("applies minimum lead time and rounds across midnight", () => {
    const now = new Date("2026-08-19T04:50:00Z");
    expect(nextAppointmentIncrement({ now, timeZone: "America/Chicago", incrementMinutes: 15, minimumLeadMinutes: 20 })).toEqual({ date: "2026-08-19", time: "00:15" });
    expect(validateFutureAppointment({ date: "2026-08-19", time: "00:00", timeZone: "America/Chicago", now, minimumLeadMinutes: 20 }).valid).toBe(false);
  });
  it("does not use the browser timezone for appointment validation", () => {
    const now = new Date("2026-08-18T05:30:00Z");
    expect(validateFutureAppointment({ date: "2026-08-17", time: "23:45", timeZone: "America/Los_Angeles", now }).valid).toBe(true);
  });
  it("generates exactly one localized option per configured increment", () => {
    const options = appointmentTimeOptions({ date: "2026-08-19", timeZone: "America/Chicago", incrementMinutes: 15, now: new Date("2026-08-18T12:00:00Z") });
    expect(options).toHaveLength(96);
    expect(options.slice(0, 4).map(({ value, label }) => [value, label])).toEqual([["00:00", "12:00 AM"], ["00:15", "12:15 AM"], ["00:30", "12:30 AM"], ["00:45", "12:45 AM"]]);
    expect(options.every(({ value }) => Number(value.slice(3)) % 15 === 0)).toBe(true);
  });
  it("filters current-day past and lead-time options", () => {
    const options = appointmentTimeOptions({ date: "2026-08-18", timeZone: "America/Chicago", incrementMinutes: 15, minimumLeadMinutes: 20, now: new Date("2026-08-18T17:30:00Z") });
    expect(options[0].value).toBe("13:00");
    expect(options.some(({ value }) => value === "12:45")).toBe(false);
  });
  it("omits DST gaps and ambiguous folds", () => {
    const spring = appointmentTimeOptions({ date: "2026-03-08", timeZone: "America/Chicago", incrementMinutes: 15, now: new Date("2026-03-01T00:00:00Z") });
    expect(spring.some(({ value }) => value.startsWith("02:"))).toBe(false);
    const fall = appointmentTimeOptions({ date: "2026-11-01", timeZone: "America/Chicago", incrementMinutes: 15, now: new Date("2026-10-01T00:00:00Z") });
    expect(fall.some(({ value }) => value.startsWith("01:"))).toBe(false);
  });
});
