// Pure functions. No LLM. Input: proposed dates + live schedule. Output: SchedulingFlag[]

function safeDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function datesOverlap(startA, endA, startB, endB) {
  const s1 = safeDate(startA);
  const s2 = safeDate(startB);
  if (!s1 || !s2) return false;
  // Default end = start + 7 days when missing
  const e1 = safeDate(endA) || new Date(s1.getTime() + 7 * 86400000);
  const e2 = safeDate(endB) || new Date(s2.getTime() + 7 * 86400000);
  return s1 <= e2 && s2 <= e1;
}

function formatDate(dateStr) {
  const d = safeDate(dateStr);
  if (!d) return "Unknown date";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * @param {object} opts
 * @param {string|null}  opts.proposedStartDate   - ISO date string
 * @param {string|null}  opts.proposedEndDate     - ISO date string (optional)
 * @param {object[]}     opts.activeAgreements    - agreements with status/start_date/end_date
 * @param {object[]}     opts.employees           - [{ id, name }]
 * @param {object[]}     opts.subcontractors      - [{ id, name }]
 * @returns {import('./schedulingConflict').SchedulingFlag[]}
 */
export function checkSchedulingConflicts({
  proposedStartDate = null,
  proposedEndDate = null,
  activeAgreements = [],
  employees = [],
  subcontractors = [],
} = {}) {
  const flags = [];
  if (!proposedStartDate) return flags;

  const active = activeAgreements.filter((a) =>
    ["signed", "active", "in_progress", "draft"].includes(
      String(a.status || "").toLowerCase()
    )
  );

  // Capacity stretch: 5+ active jobs overlap the proposed window
  const overlapping = active.filter((a) =>
    datesOverlap(proposedStartDate, proposedEndDate, a.start_date, a.end_date)
  );
  if (overlapping.length >= 5) {
    flags.push({
      type: "capacity_stretch",
      severity: "info",
      message: `You have ${overlapping.length} active jobs in this period — heads up on crew availability.`,
      actionLabel: "View calendar",
      actionRoute: "/app/calendar",
      skippable: true,
    });
  }

  // Employee conflicts
  for (const employee of employees) {
    const conflicting = active.find(
      (a) =>
        Array.isArray(a.assigned_employees) &&
        a.assigned_employees.some((id) => String(id) === String(employee.id)) &&
        datesOverlap(proposedStartDate, proposedEndDate, a.start_date, a.end_date)
    );
    if (conflicting) {
      flags.push({
        type: "employee_conflict",
        severity: "warning",
        message: `${employee.name || "An employee"} is already scheduled on "${
          conflicting.title || `Agreement #${conflicting.id}`
        }" (${formatDate(conflicting.start_date)}–${formatDate(
          conflicting.end_date
        )}). Want to adjust the start date or assign someone else?`,
        actionLabel: "View schedule",
        actionRoute: "/app/team-schedule",
        skippable: true,
      });
    }
  }

  // Sub conflicts
  for (const sub of subcontractors) {
    const conflicting = active.find(
      (a) =>
        Array.isArray(a.assigned_subcontractors) &&
        a.assigned_subcontractors.some((id) => String(id) === String(sub.id)) &&
        datesOverlap(proposedStartDate, proposedEndDate, a.start_date, a.end_date)
    );
    if (conflicting) {
      flags.push({
        type: "sub_conflict",
        severity: "info",
        message: `${sub.name || "A subcontractor"} is linked to "${
          conflicting.title || `Agreement #${conflicting.id}`
        }" through ${formatDate(conflicting.end_date)}. This job starts ${formatDate(
          proposedStartDate
        )}.`,
        actionLabel: "View agreement",
        actionRoute: `/app/agreements/${conflicting.id}`,
        skippable: true,
      });
    }
  }

  return flags;
}
