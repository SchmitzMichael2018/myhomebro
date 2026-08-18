export const FALLBACK_APPOINTMENT_INCREMENT_MINUTES = 15;

const pad = (value) => String(value).padStart(2, "0");

function dateFromParts(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function zonedParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: dateFromParts(parts.year, parts.month, parts.day), time: `${parts.hour}:${parts.minute}`, second: Number(parts.second) };
}

function addWallMinutes(date, time, minutes) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes));
  return { date: dateFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()), time: `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}` };
}

export function normalizeAppointmentWallTime({ date, time, incrementMinutes }) {
  const increment = Number(incrementMinutes) || FALLBACK_APPOINTMENT_INCREMENT_MINUTES;
  const [, minuteText] = String(time || "").split(":");
  const minute = Number(minuteText);
  if (!date || !/^\d{2}:\d{2}$/.test(time || "") || !Number.isFinite(minute)) return { date, time, changed: false, valid: false };
  const remainder = minute % increment;
  if (!remainder) return { date, time, changed: false, valid: true };
  return { ...addWallMinutes(date, time, increment - remainder), changed: true, valid: true };
}

export function nextAppointmentIncrement({ now = new Date(), timeZone, incrementMinutes, minimumLeadMinutes = 0 }) {
  const increment = Number(incrementMinutes) || FALLBACK_APPOINTMENT_INCREMENT_MINUTES;
  const threshold = new Date(now.getTime() + Number(minimumLeadMinutes || 0) * 60000);
  const current = zonedParts(threshold, timeZone);
  const minute = Number(current.time.slice(3));
  const remainder = minute % increment;
  const advance = remainder === 0 && current.second === 0 ? increment : increment - remainder;
  return addWallMinutes(current.date, current.time, advance);
}

export function validateFutureAppointment({ date, time, timeZone, now = new Date(), minimumLeadMinutes = 0 }) {
  try {
    const iso = zonedWallTimeToIso(date, time, timeZone);
    const earliest = now.getTime() + Number(minimumLeadMinutes || 0) * 60000;
    return { valid: new Date(iso).getTime() > earliest, iso };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export function zonedWallTimeToIso(date, time, timeZone) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(wanted);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shown = zonedParts(candidate, timeZone);
    const [shownYear, shownMonth, shownDay] = shown.date.split("-").map(Number);
    const [shownHour, shownMinute] = shown.time.split(":").map(Number);
    const difference = wanted - Date.UTC(shownYear, shownMonth - 1, shownDay, shownHour, shownMinute);
    if (!difference) {
      for (let offset = -180; offset <= 180; offset += 30) {
        if (!offset) continue;
        const alternate = new Date(candidate.getTime() + offset * 60000);
        const alternateParts = zonedParts(alternate, timeZone);
        if (alternateParts.date === date && alternateParts.time === time) {
          throw new Error("That local time is ambiguous in the selected time zone. Choose another time.");
        }
      }
      return candidate.toISOString();
    }
    candidate = new Date(candidate.getTime() + difference);
  }
  throw new Error("That local time does not exist in the selected time zone. Choose another time.");
}

export function formatAppointmentTime(time, locale = "en-US") {
  const [hour, minute] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

export function appointmentTimeOptions({ date, timeZone, incrementMinutes, minimumLeadMinutes = 0, now = new Date(), locale = "en-US" }) {
  const increment = Number(incrementMinutes) || FALLBACK_APPOINTMENT_INCREMENT_MINUTES;
  const earliest = now.getTime() + Number(minimumLeadMinutes || 0) * 60000;
  const options = [];
  for (let minute = 0; minute < 24 * 60; minute += increment) {
    const value = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    try {
      const iso = zonedWallTimeToIso(date, value, timeZone);
      if (new Date(iso).getTime() <= earliest) continue;
      options.push({ value, label: formatAppointmentTime(value, locale), iso });
    } catch {
      // Nonexistent and ambiguous DST wall times cannot be selected safely.
    }
  }
  return options;
}

export function friendlyTimeZone(timeZone) {
  const common = {
    "America/Chicago": "Central Time", "America/New_York": "Eastern Time",
    "America/Denver": "Mountain Time", "America/Los_Angeles": "Pacific Time",
  };
  return `${common[timeZone] || timeZone} (${timeZone})`;
}
