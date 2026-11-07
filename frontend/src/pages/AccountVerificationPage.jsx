import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { setTokens } from '../api';
import logo from '../assets/myhomebro_logo.png';
import {
  verificationContinuation,
  isPlanningContinuation,
} from '../lib/planningVerification.js';
import { readPublicPlanningDraft } from '../lib/publicPlanningDraft.js';
import {
  customerContinuationDestination,
  customerPortalLoginDestination,
} from '../lib/universalRegistration.js';

export default function AccountVerificationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const session =
    params.get('verification_session') ||
    sessionStorage.getItem('mhb-verification-session') ||
    '';
  const [state, setState] = useState(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const reviewedDraft = readPublicPlanningDraft();
  const continuation = verificationContinuation(
    state?.continuation,
    Boolean(reviewedDraft),
    params.get('next')
  );
  const missingPlanningDraft =
    isPlanningContinuation(continuation) && !reviewedDraft;

  const load = async () => {
    if (!session) return;
    sessionStorage.setItem('mhb-verification-session', session);
    const { data } = await api.post('/accounts/auth/verification/status/', {
      verification_session: session,
    });
    setState(data);
  };
  useEffect(() => {
    load().catch(() =>
      setMessage('This verification session expired. Sign in to resume setup.')
    );
  }, [session]);

  const requestCode = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { data } = await api.post(
        '/accounts/auth/verification/request-phone/',
        { verification_session: session }
      );
      setMessage(`${data.detail} ${data.masked_phone}`);
    } catch (error) {
      setMessage(error?.response?.data?.detail || 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const { data } = await api.post(
        '/accounts/auth/verification/confirm-phone/',
        { verification_session: session, code }
      );
      if (data.access) setTokens(data.access, data.refresh || null, true);
      sessionStorage.removeItem('mhb-verification-session');
      setState(data);
      const draft = readPublicPlanningDraft();
      const next = verificationContinuation(
        data.continuation,
        Boolean(draft),
        params.get('next')
      );
      if (isPlanningContinuation(next) && !draft) {
        setMessage(
          'Your account is verified. Return to the original tab where you prepared your plan, then continue verification there to sign in and save it. Your private preview is kept in that tab.'
        );
        return;
      }
      if (data.role === 'contractor' && !isPlanningContinuation(next))
        return navigate(data.continuation || '/onboarding');
      const portal = await api.get('/projects/customer-portal/account/');
      const token = portal.data?.account?.portal_token || '';
      return navigate(
        customerContinuationDestination(next, token) ||
          `/portal/${encodeURIComponent(token)}`
      );
    } catch (error) {
      setMessage(
        error?.response?.data?.detail || 'Could not verify that code.'
      );
    } finally {
      setBusy(false);
    }
  };
  const resendEmail = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(
        '/accounts/auth/verification/resend-email/',
        { verification_session: session }
      );
      setMessage(data.detail);
    } catch {
      setMessage('Could not resend the email yet.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-white">
      <section
        className="w-full max-w-lg rounded-3xl border border-white/15 bg-slate-900 p-7 shadow-2xl"
        data-testid="account-verification-page"
      >
        <Link to="/" className="flex items-center gap-3">
          <img src={logo} alt="MyHomeBro" className="h-11 w-11 rounded-xl" />
          <strong>MyHomeBro</strong>
        </Link>
        <h1 className="mt-7 text-3xl font-bold">
          Finish setting up your account
        </h1>
        <div className="mt-6 space-y-3 rounded-2xl bg-slate-950/60 p-5">
          <p>
            Email:{' '}
            <strong>
              {state?.email_verified ? 'Verified' : 'Not verified'}
            </strong>
          </p>
          <p>
            Mobile:{' '}
            <strong>
              {state?.phone_verified
                ? 'Verified'
                : `Not verified — ${state?.masked_phone || ''}`}
            </strong>
          </p>
        </div>
        {!state?.email_verified ? (
          <button
            disabled={busy || !session}
            onClick={resendEmail}
            className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-bold"
          >
            Resend verification email
          </button>
        ) : null}
        {state?.email_verified && !state?.phone_verified ? (
          <>
            <button
              disabled={busy}
              onClick={requestCode}
              className="mt-5 w-full rounded-xl border border-sky-300/40 px-4 py-3 font-bold"
            >
              Send verification code
            </button>
            <form onSubmit={confirm} className="mt-4 space-y-3">
              <label className="block text-sm font-semibold">
                Six-digit code
                <input
                  data-testid="phone-verification-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ''))
                  }
                  className="mt-2 w-full rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 text-white"
                  required
                />
              </label>
              <button
                disabled={busy || code.length !== 6}
                className="w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-slate-950"
              >
                Verify mobile and continue
              </button>
            </form>
          </>
        ) : null}
        {state?.email_verified && state?.phone_verified ? (
          <div className="mt-5 space-y-3">
            {missingPlanningDraft ? (
              <p
                role="status"
                data-testid="planning-return-original-tab"
                className="rounded-xl border border-amber-300/40 p-4 text-sm text-amber-100"
              >
                Your account is verified. Return to the original planning tab
                and continue verification there to sign in and save your plan.
                Your private preview is kept in that tab. If you closed it,
                prepare a new preview from the guide.
              </p>
            ) : null}
            <Link
              data-testid="verification-resume"
              to={
                state.role === 'contractor' &&
                !isPlanningContinuation(continuation)
                  ? '/login'
                  : customerPortalLoginDestination(
                      missingPlanningDraft ? '' : continuation
                    )
              }
              className="block rounded-xl bg-amber-400 px-4 py-3 text-center font-bold text-slate-950"
            >
              {reviewedDraft
                ? 'Sign in and save your plan'
                : 'Continue to your account'}
            </Link>
          </div>
        ) : null}
        {message ? (
          <p className="mt-4 text-sm text-sky-100" role="status">
            {message}
          </p>
        ) : null}
        {!session ? (
          <Link to="/login" className="mt-5 block text-center text-amber-300">
            Sign in to resume verification
          </Link>
        ) : null}
      </section>
    </main>
  );
}
