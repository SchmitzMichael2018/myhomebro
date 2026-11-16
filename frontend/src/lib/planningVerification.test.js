import { describe, expect, it } from 'vitest';
import { PUBLIC_PLANNING_CONTINUATION } from './publicPlanningDraft.js';
import {
  customerContinuationDestination,
  customerPortalLoginDestination,
} from './universalRegistration.js';
import {
  isPlanningContinuation,
  pendingCustomerVerification,
  verificationContinuation,
  verificationResumeUrl,
} from './planningVerification.js';

describe('existing account verification during plan save', () => {
  it.each(['', '/portal', '/onboarding'])(
    'current reviewed plan overrides old registration %s',
    (stored) => {
      const continuation = verificationContinuation(stored, true);
      expect(continuation).toBe(PUBLIC_PLANNING_CONTINUATION);
      expect(customerContinuationDestination(continuation, 'test-portal')).toBe(
        '/portal/test-portal?workspace=diy-planner&action=create&planning_draft=1'
      );
      expect(customerPortalLoginDestination(continuation)).toBe(
        PUBLIC_PLANNING_CONTINUATION
      );
    }
  );
  it('retains explicit planning intent without a draft so another tab can show recovery', () => {
    expect(
      verificationContinuation('', false, PUBLIC_PLANNING_CONTINUATION)
    ).toBe(PUBLIC_PLANNING_CONTINUATION);
  });
  it('keeps unrelated account setup unchanged without a reviewed plan', () => {
    expect(verificationContinuation('/onboarding', false)).toBe('/onboarding');
    expect(verificationContinuation('', false)).toBe('');
    expect(
      verificationContinuation(
        '/portal',
        false,
        'https://evil.example/portal?workspace=diy-planner&action=create&planning_draft=1'
      )
    ).toBe('/portal');
  });
  it.each(['email_verification_required', 'account_verification_required'])(
    'offers resume for %s and preserves the current plan',
    (code) => {
      const result = pendingCustomerVerification(
        {
          response: {
            status: 403,
            data: {
              code,
              verification_session: 'session&value',
              continuation: '',
            },
          },
        },
        true
      );
      expect(result.continuation).toBe(PUBLIC_PLANNING_CONTINUATION);
      expect(result.emailVerified).toBe(
        code === 'account_verification_required'
      );
      const url = new URL(
        verificationResumeUrl(result.verificationSession, result.continuation),
        'https://www.myhomebro.com'
      );
      expect(url.searchParams.get('verification_session')).toBe(
        'session&value'
      );
      expect(url.searchParams.get('next')).toBe(PUBLIC_PLANNING_CONTINUATION);
    }
  );
  it('retains portal query intent when verification opens without local storage', () => {
    const result = pendingCustomerVerification(
      {
        response: {
          status: 403,
          data: {
            code: 'account_verification_required',
            verification_session: 'session',
          },
        },
      },
      false,
      '?workspace=diy-planner&action=create&planning_draft=1'
    );
    expect(result.continuation).toBe(PUBLIC_PLANNING_CONTINUATION);
  });
  it('does not treat unrelated login errors or missing verification sessions as resumable', () => {
    expect(
      pendingCustomerVerification(
        {
          response: {
            status: 403,
            data: { code: 'disabled', verification_session: 'x' },
          },
        },
        true
      )
    ).toBeNull();
    expect(
      pendingCustomerVerification(
        {
          response: {
            status: 403,
            data: { code: 'account_verification_required' },
          },
        },
        true
      )
    ).toBeNull();
  });
  it('only recognizes a same-origin complete planning continuation', () => {
    expect(isPlanningContinuation(PUBLIC_PLANNING_CONTINUATION)).toBe(true);
    expect(
      isPlanningContinuation(
        '//evil.example/portal?workspace=diy-planner&action=create&planning_draft=1'
      )
    ).toBe(false);
    expect(isPlanningContinuation('/portal?planning_draft=1')).toBe(false);
    expect(verificationResumeUrl('session', 'https://evil.example')).toBe(
      '/verify-account?verification_session=session'
    );
  });
});
