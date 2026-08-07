function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveDuration(value) {
  const n = safeNumber(value, 0);
  return n > 0 ? Math.round(n) : 1;
}

function hasManualOffsets(milestones = []) {
  return milestones.some((row) => {
    const offset = row?.start_offset;
    if (offset == null || offset === "") return false;
    const n = Number(offset);
    return Number.isFinite(n) && n > 0;
  });
}

export function offsetToProjectDay(offset) {
  if (offset === "" || offset == null) return null;
  const value = Number(offset);
  if (!Number.isInteger(value) || value < 0) return null;
  return value + 1;
}

export function projectDayToOffset(day) {
  if (day === "" || day == null) return null;
  const value = Number(day);
  if (!Number.isInteger(value) || value < 1) return null;
  return value - 1;
}

export function estimateTemplateTimelineDays(milestones = []) {
  const rows = Array.isArray(milestones) ? milestones : [];
  return rows.reduce((latestDay, row) => {
    const offset = projectDayToOffset(offsetToProjectDay(row?.start_offset));
    const duration = Number(row?.duration_days ?? row?.recommended_duration_days);
    if (offset == null || !Number.isInteger(duration) || duration < 1) return latestDay;
    return Math.max(latestDay, offset + duration);
  }, 0);
}

export function computeSequentialOffsets(milestones = []) {
  const rows = Array.isArray(milestones) ? milestones : [];
  let currentOffset = 0;

  return rows.map((row, idx) => {
    const durationDays = toPositiveDuration(
      row?.duration_days ?? row?.recommended_duration_days ?? row?.duration ?? 1
    );

    const next = {
      ...row,
      sort_order: Number(row?.sort_order || idx + 1) || idx + 1,
      start_offset: currentOffset,
      duration_days: durationDays,
      recommended_days_from_start: currentOffset + 1,
      recommended_duration_days: durationDays,
    };

    currentOffset += durationDays;
    return next;
  });
}

export function needsSequentialOffsets(milestones = []) {
  const rows = Array.isArray(milestones) ? milestones : [];
  if (rows.length <= 1) return false;
  if (hasManualOffsets(rows)) return false;
  return rows.some((row) => row?.start_offset == null || row?.start_offset === "" || Number(row.start_offset) === 0);
}
