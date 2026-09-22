import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TURNSTILE_CONFIGURED, TURNSTILE_STATE } from './turnstileState.js';

const SCRIPT_ID = 'cloudflare-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const POLL_INTERVAL_MS = 100;
const MAX_POLLS = 50;

export default function TurnstileWidget({ onToken, onStateChange }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(
    TURNSTILE_CONFIGURED ? TURNSTILE_STATE.LOADING : TURNSTILE_STATE.DISABLED
  );
  const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

  const publishState = useCallback((nextState) => {
    setState(nextState);
    onStateChange?.(nextState);
  }, [onStateChange]);

  useEffect(() => {
    if (!siteKey) {
      onToken('');
      publishState(TURNSTILE_STATE.DISABLED);
      return undefined;
    }

    let cancelled = false;
    let pollTimer = null;
    let pollCount = 0;
    let recovered = false;
    let activeScript = null;

    const clearPolling = () => {
      if (pollTimer) window.clearTimeout(pollTimer);
      pollTimer = null;
    };
    const setError = () => {
      if (cancelled) return;
      clearPolling();
      onToken('');
      publishState(TURNSTILE_STATE.ERROR);
    };
    const renderWidget = () => {
      if (cancelled || widgetIdRef.current !== null || !containerRef.current) return;
      if (!window.turnstile?.render) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => {
            if (cancelled) return;
            const safeToken = String(token || '').trim();
            onToken(safeToken);
            publishState(safeToken ? TURNSTILE_STATE.VERIFIED : TURNSTILE_STATE.ERROR);
          },
          'expired-callback': () => {
            if (cancelled) return;
            onToken('');
            publishState(TURNSTILE_STATE.EXPIRED);
          },
          'error-callback': () => {
            if (cancelled) return;
            onToken('');
            publishState(TURNSTILE_STATE.ERROR);
          },
        });
        publishState(TURNSTILE_STATE.READY);
      } catch {
        setError();
      }
    };
    const waitForRuntime = () => {
      if (cancelled) return;
      if (window.turnstile?.render) {
        clearPolling();
        renderWidget();
        return;
      }
      pollCount += 1;
      if (pollCount < MAX_POLLS) {
        pollTimer = window.setTimeout(waitForRuntime, POLL_INTERVAL_MS);
        return;
      }
      if (!recovered) {
        recovered = true;
        pollCount = 0;
        activeScript?.removeEventListener('load', waitForRuntime);
        activeScript?.removeEventListener('error', setError);
        activeScript?.remove();
        activeScript = null;
        addScript();
        return;
      }
      setError();
    };
    const watchScript = (script) => {
      activeScript = script;
      script.addEventListener('load', waitForRuntime, { once: true });
      script.addEventListener('error', setError, { once: true });
      waitForRuntime();
    };
    function addScript() {
      if (cancelled) return;
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      watchScript(script);
      document.head.appendChild(script);
    }

    onToken('');
    publishState(TURNSTILE_STATE.LOADING);
    if (window.turnstile?.render) renderWidget();
    else {
      const existingScript = document.getElementById(SCRIPT_ID);
      if (existingScript) watchScript(existingScript);
      else addScript();
    }

    return () => {
      cancelled = true;
      clearPolling();
      activeScript?.removeEventListener('load', waitForRuntime);
      activeScript?.removeEventListener('error', setError);
      if (widgetIdRef.current !== null && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // The provider may already have removed the widget during navigation.
        }
      }
      widgetIdRef.current = null;
    };
  }, [attempt, onToken, publishState, siteKey]);

  if (!siteKey) return null;

  const retry = () => {
    onToken('');
    publishState(TURNSTILE_STATE.LOADING);
    if (!window.turnstile) document.getElementById(SCRIPT_ID)?.remove();
    setAttempt((current) => current + 1);
  };

  return (
    <div className="space-y-2" data-testid="turnstile-security-check">
      <div ref={containerRef} data-testid="turnstile-widget" />
      <div role="status" aria-live="polite" className="text-sm opacity-75" data-testid="turnstile-status">
        {state === TURNSTILE_STATE.LOADING ? 'Loading security check…' : null}
        {state === TURNSTILE_STATE.READY ? 'Complete the security check to continue.' : null}
        {state === TURNSTILE_STATE.VERIFIED ? 'Security check complete.' : null}
        {state === TURNSTILE_STATE.EXPIRED ? 'Security check expired. Try again.' : null}
        {state === TURNSTILE_STATE.ERROR ? <>
          We couldn&apos;t load the security check.{' '}
          <button type="button" onClick={retry} className="font-semibold underline">Try again</button>
        </> : null}
      </div>
    </div>
  );
}
