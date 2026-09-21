import { describe, expect, it } from 'vitest';

import {
  customerContinuationDestination,
  registrationDestination,
} from '../lib/universalRegistration.js';

describe('universal registration routing', () => {
  it('routes each public role to its existing registration workflow', () => {
    expect(registrationDestination('customer')).toBe(
      '/create-account?role=customer'
    );
    expect(registrationDestination('property_manager')).toBe(
      '/create-account?role=property_manager'
    );
    expect(registrationDestination('contractor')).toBe('/signup');
  });

  it('preserves referral attribution for every public role', () => {
    expect(registrationDestination('contractor', 'FOUNDING 100')).toBe(
      '/signup?ref=FOUNDING+100'
    );
    expect(registrationDestination('customer', 'FOUNDING100')).toBe(
      '/create-account?role=customer&ref=FOUNDING100'
    );
    expect(registrationDestination('property_manager', 'FOUNDING100')).toBe(
      '/create-account?role=property_manager&ref=FOUNDING100'
    );
  });

  it('preserves an improvement continuation through role selection', () => {
    expect(
      registrationDestination('customer', '', {
        intent: 'diy',
        template_id: '42',
        next: '/portal?intent=diy&template_id=42',
      })
    ).toBe(
      '/create-account?role=customer&intent=diy&template_id=42&next=%2Fportal%3Fintent%3Ddiy%26template_id%3D42'
    );
  });

  it('only resumes safe internal destinations and adds the portal token', () => {
    expect(
      customerContinuationDestination(
        '/portal?workspace=diy-planner&template_id=42',
        'safe token'
      )
    ).toBe('/portal/safe%20token?workspace=diy-planner&template_id=42');
    expect(
      customerContinuationDestination('https://evil.example', 'token')
    ).toBe('');
    expect(customerContinuationDestination('//evil.example', 'token')).toBe('');
  });
});
