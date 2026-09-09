import { describe, expect, it } from 'vitest';

import { milestoneDisplayPaymentStatus } from './milestoneDisplay';

describe('milestoneDisplayPaymentStatus', () => {
  it('keeps a completed milestone pending until its invoice is paid or released', () => {
    expect(
      milestoneDisplayPaymentStatus({
        status: 'completed',
        invoice_id: 23,
        invoice_status: 'pending',
        invoice_paid: false,
        escrow_released: false,
      })
    ).toBe('Pending Payment');
  });

  it('shows paid when the linked invoice has been released from escrow', () => {
    expect(
      milestoneDisplayPaymentStatus({
        status: 'completed',
        invoice_id: 17,
        invoice_status: 'paid',
        escrow_released: true,
      })
    ).toBe('Paid');
  });
});
