const pick = (...vals) =>
  vals.find((value) => value !== undefined && value !== null && value !== '') ??
  '';

const titleCase = (value) =>
  String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

export const milestoneStatusKey = (milestone) =>
  String(
    pick(
      milestone?.workflow_status,
      milestone?.lifecycle_state,
      milestone?.milestone_lifecycle_state,
      milestone?.status,
      milestone?.state
    ) || ''
  )
    .trim()
    .toLowerCase();

export function isMilestoneCompleted(milestone) {
  const status = milestoneStatusKey(milestone);
  if (
    [
      'completed',
      'complete',
      'approved',
      'paid',
      'earned',
      'released',
      'cancelled',
      'archived',
    ].includes(status)
  ) {
    return true;
  }
  return (
    !!milestone?.approved ||
    !!milestone?.is_complete ||
    !!milestone?.is_completed ||
    !!milestone?.completed ||
    !!(
      milestone?.completed_at ||
      milestone?.completed_on ||
      milestone?.completed_date
    )
  );
}

export function isMilestonePaid(milestone) {
  const status = milestoneStatusKey(milestone);
  const paymentStatus = String(
    pick(
      milestone?.payment_status,
      milestone?.invoice_status,
      milestone?.payout_status,
      milestone?.draw_status,
      ''
    )
  )
    .trim()
    .toLowerCase();
  return (
    ['paid', 'released', 'earned'].includes(status) ||
    ['paid', 'released', 'earned', 'settled'].includes(paymentStatus) ||
    !!milestone?.is_paid ||
    !!milestone?.paid_at ||
    !!milestone?.released_at ||
    !!milestone?.payment_released_at ||
    !!milestone?.payout_paid_at
  );
}

export function milestoneDisplayProgressPercent(milestone) {
  if (isMilestoneCompleted(milestone) || isMilestonePaid(milestone)) {
    return 100;
  }

  const explicit = Number(
    pick(
      milestone?.percent_complete,
      milestone?.progress_percent,
      milestone?.completion_percent,
      ''
    )
  );
  if (Number.isFinite(explicit) && explicit >= 0) {
    return Math.max(0, Math.min(100, Math.round(explicit)));
  }

  const status = milestoneStatusKey(milestone);
  if (
    status.includes('active') ||
    status.includes('progress') ||
    status.includes('started') ||
    status.includes('submitted') ||
    status.includes('review')
  ) {
    return 50;
  }
  return 0;
}

export function milestoneDisplayPaymentStatus(milestone) {
  if (isMilestonePaid(milestone)) return 'Paid';

  const raw = String(
    pick(
      milestone?.payment_status,
      milestone?.invoice_status,
      milestone?.payout_status,
      milestone?.draw_status,
      ''
    )
  )
    .trim()
    .toLowerCase();
  if (raw) return titleCase(raw);

  if (
    milestone?.is_invoiced ||
    milestone?.invoice ||
    milestone?.invoice_id ||
    milestone?.draw_request_id
  ) {
    return 'Pending';
  }
  return 'Not requested';
}

export function milestoneDisplayStatus(milestone) {
  if (isMilestoneCompleted(milestone) || isMilestonePaid(milestone)) {
    return 'Completed';
  }

  const raw = String(pick(milestone?.status, milestone?.state) || '').trim();
  if (raw) return titleCase(raw);
  if (milestone?.is_invoiced) return 'Invoiced';
  return 'Incomplete';
}

export function milestoneStatusTone(label) {
  const normalized = String(label || '').toLowerCase();
  if (normalized.includes('complete') || normalized.includes('paid')) {
    return 'border-emerald-300/50 bg-emerald-400/15 text-emerald-100';
  }
  if (
    normalized.includes('active') ||
    normalized.includes('progress') ||
    normalized.includes('signed') ||
    normalized.includes('funded')
  ) {
    return 'border-blue-300/50 bg-blue-400/15 text-blue-100';
  }
  if (
    normalized.includes('pending') ||
    normalized.includes('waiting') ||
    normalized.includes('unpaid')
  ) {
    return 'border-amber-300/50 bg-amber-400/15 text-amber-100';
  }
  return 'border-white/15 bg-white/10 text-sky-100';
}

export function getMilestoneDisplay(milestone) {
  const displayStatus = milestoneDisplayStatus(milestone);
  const displayProgressPercent = milestoneDisplayProgressPercent(milestone);
  const paymentStatus = milestoneDisplayPaymentStatus(milestone);
  return {
    displayStatus,
    displayProgressPercent,
    paymentStatus,
    isCompleted: isMilestoneCompleted(milestone),
    isPaid: isMilestonePaid(milestone),
    statusKey: milestoneStatusKey(milestone),
  };
}
