import { describe, expect, it } from 'vitest';
import { appointmentSecondaryLabel } from './appointmentDialogCopy.js';

describe('appointment dialog secondary copy', () => {
  it.each([
    ['schedule', 'Cancel'], ['propose', 'Cancel'], ['confirm', 'Cancel'],
    ['reschedule', 'Keep current appointment'], ['cancel', 'Keep appointment'],
    ['decline', 'Keep appointment'], ['complete', 'Go back'], ['no_show', 'Go back'],
  ])('maps %s to %s', (action, expected) => {
    expect(appointmentSecondaryLabel(action)).toBe(expected);
  });
});
