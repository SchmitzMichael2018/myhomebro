import { describe, expect, it } from 'vitest';

import { registrationDestination } from '../lib/universalRegistration.js';

describe('universal registration routing', () => {
  it('routes each public role to its existing registration workflow', () => {
    expect(registrationDestination('customer')).toBe('/create-account?role=customer');
    expect(registrationDestination('property_manager')).toBe('/create-account?role=property_manager');
    expect(registrationDestination('contractor')).toBe('/signup');
  });

  it('preserves contractor referral attribution', () => {
    expect(registrationDestination('contractor', 'FOUNDING 100')).toBe('/signup?ref=FOUNDING%20100');
    expect(registrationDestination('customer', 'FOUNDING100')).toBe('/create-account?role=customer');
  });
});
