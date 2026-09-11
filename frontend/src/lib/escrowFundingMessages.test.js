import { describe, expect, it } from 'vitest';

import {
  ESCROW_ALREADY_FUNDED_MESSAGE,
  ESCROW_PAYMENT_PROCESSED_MESSAGE,
} from './escrowFundingMessages';

describe('escrow funding status messages', () => {
  it('confirms a newly processed escrow payment without implying it was a duplicate', () => {
    expect(ESCROW_PAYMENT_PROCESSED_MESSAGE).toBe(
      'This escrow payment has been processed.'
    );
    expect(ESCROW_PAYMENT_PROCESSED_MESSAGE).not.toContain('already');
  });

  it('stops a repeat payment with an explicit no-payment-required message', () => {
    expect(ESCROW_ALREADY_FUNDED_MESSAGE).toBe(
      'This escrow has already been funded. No payment is required at this time.'
    );
  });
});
