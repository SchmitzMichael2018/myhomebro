export const APPOINTMENT_SECONDARY_LABELS = Object.freeze({
  schedule: 'Cancel',
  propose: 'Cancel',
  confirm: 'Cancel',
  reschedule: 'Keep current appointment',
  cancel: 'Keep appointment',
  decline: 'Keep appointment',
  complete: 'Go back',
  no_show: 'Go back',
});

export function appointmentSecondaryLabel(action) {
  return APPOINTMENT_SECONDARY_LABELS[action] || 'Cancel';
}
