import { describe, expect, it } from 'vitest';
import { customerPortalLoginDestination } from './universalRegistration.js';

describe('existing customer planning continuation', () => {
  it('keeps the reviewed plan destination through portal login', () => {
    const path = customerPortalLoginDestination(
      '/portal?workspace=diy-planner&action=create&planning_draft=1',
      'Owner@Example.com'
    );
    const url = new URL(path, 'https://www.myhomebro.com');
    expect(url.pathname).toBe('/portal');
    expect(url.searchParams.get('workspace')).toBe('diy-planner');
    expect(url.searchParams.get('planning_draft')).toBe('1');
    expect(url.searchParams.get('action')).toBe('create');
    expect(url.searchParams.get('email')).toBe('owner@example.com');
  });
  it('does not forward off-site or unrelated continuations', () => {
    expect(
      customerPortalLoginDestination(
        'https://evil.example/portal?workspace=diy-planner'
      )
    ).toBe('/portal');
    expect(customerPortalLoginDestination('/admin?workspace=diy-planner')).toBe(
      '/portal'
    );
    expect(
      customerPortalLoginDestination('/portal?next=https://evil.example')
    ).toBe('/portal');
  });
});
