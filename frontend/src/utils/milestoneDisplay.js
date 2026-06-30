const pick = (...vals) =>
  vals.find((value) => value !== undefined && value !== null && value !== '') ??
  '';

const titleCase = (value) =>
  String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

const normalizeKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const nestedInvoice = (milestone) =>
  milestone?.invoice && typeof milestone.invoice === 'object'
    ? milestone.invoice
    : null;

const invoiceStatusKey = (milestone) => {
  const invoice = nestedInvoice(milestone);
  return normalizeKey(
    pick(
      milestone?.invoice_status,
      invoice?.status,
      invoice?.invoice_status,
      invoice?.state,
      ''
    )
  );
};

export const milestoneStatusKey = (milestone) =>
  normalizeKey(
    pick(
      milestone?.workflow_status,
      milestone?.lifecycle_state,
      milestone?.milestone_lifecycle_state,
      milestone?.status,
      milestone?.state
    ) || ''
  );

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
  const invoice = nestedInvoice(milestone);
  const paymentStatus = normalizeKey(
    pick(
      milestone?.payment_status,
      invoiceStatusKey(milestone),
      milestone?.payout_status,
      milestone?.release_status,
      milestone?.draw_status,
      ''
    )
  );
  return (
    ['paid', 'released', 'earned', 'approved'].includes(status) ||
    [
      'paid',
      'released',
      'earned',
      'settled',
      'approved',
      'complete',
      'completed',
      'payout_complete',
      'payout_completed',
      'invoice_paid',
      'invoiced_paid',
    ].includes(paymentStatus) ||
    !!milestone?.is_paid ||
    !!milestone?.invoice_paid ||
    !!milestone?.invoice_paid_at ||
    !!milestone?.escrow_released ||
    !!milestone?.escrow_released_at ||
    !!invoice?.escrow_released ||
    !!invoice?.escrow_released_at ||
    !!invoice?.direct_pay_paid_at ||
    !!invoice?.paid_at ||
    !!milestone?.is_released ||
    !!milestone?.release_at ||
    !!milestone?.paid_at ||
    !!milestone?.released_at ||
    !!milestone?.payment_released_at ||
    !!milestone?.payout_paid_at
  );
}

const isMilestoneInvoiced = (milestone) =>
  !!(
    milestone?.is_invoiced ||
    milestone?.invoice ||
    milestone?.invoice_id ||
    milestone?.invoice_count ||
    milestone?.draw_request_id ||
    milestone?.draw_count
  );

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

  const raw = normalizeKey(
    pick(
      milestone?.payment_status,
      invoiceStatusKey(milestone),
      milestone?.payout_status,
      milestone?.release_status,
      milestone?.draw_status,
      ''
    )
  );
  if (
    isMilestoneCompleted(milestone) &&
    ['pending', 'unpaid', 'payment_pending', 'invoice_pending'].includes(raw)
  ) {
    return 'Paid';
  }
  if (raw) {
    if (['pending', 'unpaid', 'payment_pending', 'invoice_pending'].includes(raw)) {
      return isMilestoneInvoiced(milestone) ? 'Pending Payment' : 'Not requested';
    }
    if (raw.includes('invoice') && raw.includes('paid')) return 'Paid';
    if (raw.includes('payout') && raw.includes('complete')) return 'Paid';
    return titleCase(raw);
  }

  if (isMilestoneInvoiced(milestone)) {
    return 'Pending Payment';
  }
  return 'Not requested';
}

export function milestoneDisplayPhaseLabel(milestone) {
  const paymentStatus = milestoneDisplayPaymentStatus(milestone);
  if (paymentStatus === 'Paid') return 'Paid';
  if (isMilestoneInvoiced(milestone)) {
    return 'Invoiced / Pending Payment';
  }
  if (isMilestoneCompleted(milestone)) return 'Completed (Not Invoiced)';
  return 'Incomplete';
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

const paymentTone = (label) => {
  const normalized = normalizeKey(label);
  if (normalized === 'paid') return 'success';
  if (normalized.includes('pending')) return 'warning';
  if (normalized.includes('not requested')) return 'muted';
  return 'neutral';
};

const statusTone = (label) => {
  const normalized = normalizeKey(label);
  if (normalized.includes('complete') || normalized.includes('paid')) return 'success';
  if (normalized.includes('active') || normalized.includes('progress')) return 'active';
  if (normalized.includes('pending') || normalized.includes('waiting')) return 'warning';
  return 'neutral';
};

const progressTone = (percent) => {
  if (percent >= 100) return 'success';
  if (percent > 0) return 'active';
  return 'muted';
};

const dueLabelFor = (milestone) =>
  pick(
    milestone?.due_date,
    milestone?.scheduled_for,
    milestone?.date_due,
    milestone?.date,
    milestone?.end_date,
    milestone?.completion_date,
    milestone?.endDate,
    ''
  ) || 'No due date';

const actionStateFor = (milestone, display) => {
  if (display.isCompleted) return 'Completed';
  const lifecycle = normalizeKey(
    pick(
      milestone?.milestone_lifecycle_state,
      milestone?.lifecycle_state,
      milestone?.workflow_status,
      milestone?.status,
      ''
    )
  );
  if (lifecycle.includes('active') || lifecycle.includes('progress')) {
    return 'Active';
  }
  if (lifecycle.includes('review') || milestone?.requires_review) {
    return 'Needs review';
  }
  if (lifecycle.includes('blocked') || milestone?.amendment_review_status === 'pending') {
    return 'Blocked';
  }
  return lifecycle ? titleCase(lifecycle) : 'Planned';
};

const actionToneFor = (label) => {
  const normalized = normalizeKey(label);
  if (normalized.includes('completed')) return 'success';
  if (normalized.includes('active')) return 'active';
  if (normalized.includes('blocked')) return 'danger';
  if (normalized.includes('review')) return 'warning';
  return 'neutral';
};

export function getMilestoneDisplay(milestone, options = {}) {
  const statusLabel = milestoneDisplayStatus(milestone);
  const progressPercent = milestoneDisplayProgressPercent(milestone);
  const paymentLabel = milestoneDisplayPaymentStatus(milestone);
  const isCompleted = isMilestoneCompleted(milestone);
  const isPaid = isMilestonePaid(milestone);
  const actionStateLabel = actionStateFor(milestone, { isCompleted, isPaid });
  const dueLabel = dueLabelFor(milestone);
  const agreementId =
    options.agreementId ||
    milestone?.agreement_id ||
    milestone?.agreement ||
    milestone?.agreement?.id ||
    '';
  const milestoneId = milestone?.id || options.milestoneId || '';
  const canComplete =
    !!milestoneId &&
    !isCompleted &&
    milestone?.amendment_review_status !== 'pending' &&
    !milestone?.locked &&
    !milestone?.agreement_is_completed;
  const primaryActionUrl =
    options.primaryActionUrl ||
    (agreementId
      ? `/app/milestones?agreement=${agreementId}${
          milestoneId ? `&milestone=${milestoneId}` : ''
        }`
      : milestoneId
        ? `/app/milestones/${milestoneId}`
        : '');
  return {
    isCompleted,
    isPaid,
    statusLabel,
    statusTone: statusTone(statusLabel),
    progressPercent,
    progressTone: progressTone(progressPercent),
    paymentLabel,
    paymentTone: paymentTone(paymentLabel),
    actionStateLabel,
    actionStateTone: actionToneFor(actionStateLabel),
    dueLabel,
    dueTone: dueLabel === 'No due date' ? 'muted' : 'neutral',
    primaryActionLabel: isCompleted
      ? 'View Milestone'
      : canComplete
        ? 'Complete Milestone'
        : 'View Milestone',
    primaryActionUrl,
    canComplete,
    canRefund:
      isPaid &&
      !!(
        milestone?.refund_url ||
        milestone?.refundUrl ||
        milestone?.can_refund ||
        milestone?.refundable
      ),
    canView: !!milestoneId || !!primaryActionUrl,
    displayStatus: statusLabel,
    displayProgressPercent: progressPercent,
    paymentStatus: paymentLabel,
    statusKey: milestoneStatusKey(milestone),
  };
}
