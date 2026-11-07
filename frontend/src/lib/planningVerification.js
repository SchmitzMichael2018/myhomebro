import { PUBLIC_PLANNING_CONTINUATION } from './publicPlanningDraft.js';

export function isPlanningContinuation(value) {
  try {
    const url = new URL(String(value || ''), 'https://www.myhomebro.com');
    return (
      url.origin === 'https://www.myhomebro.com' &&
      url.pathname === '/portal' &&
      url.searchParams.get('workspace') === 'diy-planner' &&
      url.searchParams.get('action') === 'create' &&
      url.searchParams.get('planning_draft') === '1'
    );
  } catch {
    return false;
  }
}

// A reviewed draft exists only after the visitor explicitly chose to save it.
// That current tab intent takes priority over an older registration destination.
export function verificationContinuation(
  stored,
  hasReviewedDraft,
  requested = ''
) {
  if (hasReviewedDraft || isPlanningContinuation(requested))
    return PUBLIC_PLANNING_CONTINUATION;
  return String(stored || '');
}

export function pendingCustomerVerification(
  error,
  hasReviewedDraft,
  search = ''
) {
  const data = error?.response?.data;
  if (
    error?.response?.status !== 403 ||
    !['email_verification_required', 'account_verification_required'].includes(
      data?.code
    ) ||
    typeof data?.verification_session !== 'string' ||
    !data.verification_session
  )
    return null;
  return {
    verificationSession: data.verification_session,
    emailVerified:
      data.email_verified === true ||
      data.code === 'account_verification_required',
    continuation: verificationContinuation(
      data.continuation,
      hasReviewedDraft,
      `/portal${search}`
    ),
  };
}

export function verificationResumeUrl(session, continuation = '') {
  const params = new URLSearchParams({ verification_session: session });
  if (isPlanningContinuation(continuation))
    params.set('next', PUBLIC_PLANNING_CONTINUATION);
  return `/verify-account?${params}`;
}
