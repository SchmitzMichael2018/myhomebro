function toDateOnly(value) {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(isoDate, days) {
  const base = toDateOnly(isoDate);
  if (!base) return "";
  const [year, month, day] = base.split("-").map(Number);
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return "";
  dt.setDate(dt.getDate() + Number(days || 0));
  const nextYear = dt.getFullYear();
  const nextMonth = String(dt.getMonth() + 1).padStart(2, "0");
  const nextDay = String(dt.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

function getMilestoneDurationDays(row) {
  const candidates = [
    row?.estimated_days,
    row?.duration_days,
    row?.recommended_duration_days,
    row?.duration,
  ];
  for (const candidate of candidates) {
    const next = Number(candidate);
    if (Number.isFinite(next) && next > 0) return Math.max(1, Math.round(next));
  }
  const existingStart = toDateOnly(row?.start_date || row?.start);
  const existingCompletion = toDateOnly(row?.completion_date || row?.end_date || row?.end);
  if (existingStart && existingCompletion) {
    const startDate = new Date(existingStart);
    const endDate = new Date(existingCompletion);
    if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      const diffMs = endDate.getTime() - startDate.getTime();
      const diffDays = Math.round(diffMs / 86400000) + 1;
      if (diffDays > 0) return diffDays;
    }
  }
  return 1;
}

function hasAnyScheduledMilestones(milestones) {
  return Array.isArray(milestones)
    ? milestones.some((row) =>
        Boolean(
          toDateOnly(row?.start_date || row?.start || row?.completion_date || row?.end_date || row?.end)
        )
      )
    : false;
}

export function shouldPromptForDateReschedule(previousStartDate, nextStartDate, milestones) {
  const previous = toDateOnly(previousStartDate);
  const next = toDateOnly(nextStartDate);
  if (!next || previous === next) return false;
  return hasAnyScheduledMilestones(milestones);
}

export function rescheduleMilestonesFromStartDate(milestones, projectStartDate) {
  const nextStart = toDateOnly(projectStartDate);
  const rows = Array.isArray(milestones) ? milestones.filter(Boolean) : [];
  if (!rows.length) return [];
  if (!nextStart) {
    return rows.map((row, idx) => ({
      ...row,
      order: row?.order != null ? row.order : idx + 1,
    }));
  }

  let cursor = nextStart;
  return rows.map((row, idx) => {
    const durationDays = getMilestoneDurationDays(row);
    const startDate = cursor;
    const completionDate = addDays(startDate, durationDays - 1);
    cursor = addDays(completionDate, 1);
    return {
      ...row,
      order: row?.order != null ? row.order : idx + 1,
      start_date: startDate,
      completion_date: completionDate,
      due_date: completionDate,
    };
  });
}
