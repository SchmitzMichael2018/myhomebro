import React, { useEffect, useRef, useState } from 'react';
import {
  TURNSTILE_DIAGNOSTIC_SCRIPT_URL,
  TURNSTILE_DIAGNOSTIC_SITE_KEY,
} from './turnstileDiagnosticConfig.js';

// Temporary diagnostic infrastructure. Remove after production Turnstile diagnosis.
const SCRIPT_ID = 'turnstile-diagnostic-script';

const StatusRow = ({ label, value, testId }) => (
  <div className="flex items-center justify-between gap-6 border-b border-white/10 py-3 last:border-0">
    <dt className="font-medium text-sky-100/75">{label}</dt>
    <dd data-testid={testId} className="text-right font-semibold text-white">{value}</dd>
  </div>
);

export default function TurnstileDiagnosticPage() {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [scriptStatus, setScriptStatus] = useState('SCRIPT REQUESTED');
  const [runtimeStatus, setRuntimeStatus] = useState('WINDOW.TURNSTILE UNAVAILABLE');
  const [widgetStatus, setWidgetStatus] = useState('WIDGET NOT RENDERED');
  const [challengeStatus, setChallengeStatus] = useState('CHALLENGE NOT VERIFIED');

  useEffect(() => {
    let cancelled = false;
    let script = document.getElementById(SCRIPT_ID);

    const renderWidget = () => {
      if (cancelled || !containerRef.current) return;
      if (!window.turnstile?.render) {
        setRuntimeStatus('WINDOW.TURNSTILE UNAVAILABLE');
        return;
      }
      setRuntimeStatus('WINDOW.TURNSTILE AVAILABLE');
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_DIAGNOSTIC_SITE_KEY,
          callback: () => setChallengeStatus('CHALLENGE VERIFIED'),
          'expired-callback': () => setChallengeStatus('CHALLENGE NOT VERIFIED'),
          'error-callback': () => {
            setWidgetStatus('WIDGET FAILED');
            setChallengeStatus('CHALLENGE NOT VERIFIED');
          },
        });
        setWidgetStatus('WIDGET RENDERED');
      } catch {
        setWidgetStatus('WIDGET FAILED');
      }
    };
    const loaded = () => {
      if (cancelled) return;
      setScriptStatus('SCRIPT LOADED');
      renderWidget();
    };
    const failed = () => {
      if (cancelled) return;
      setScriptStatus('SCRIPT FAILED');
      setRuntimeStatus('WINDOW.TURNSTILE UNAVAILABLE');
      setWidgetStatus('WIDGET FAILED');
    };

    if (window.turnstile?.render) {
      setScriptStatus('SCRIPT LOADED');
      renderWidget();
    } else {
      script?.remove();
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = TURNSTILE_DIAGNOSTIC_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      script?.removeEventListener('load', loaded);
      script?.removeEventListener('error', failed);
      if (widgetIdRef.current !== null && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Diagnostic cleanup must remain safe if the provider already removed it.
        }
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-white" data-testid="turnstile-diagnostic">
      <section className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Temporary diagnostic</p>
        <h1 className="mt-2 text-3xl font-bold">MyHomeBro Turnstile Diagnostic</h1>
        <p className="mt-3 text-sm leading-6 text-sky-100/70">
          This page checks only whether the browser can load and render Cloudflare Turnstile. It does not create or modify MyHomeBro data.
        </p>
        <dl className="mt-6 rounded-xl border border-white/10 px-4" role="status" aria-live="polite">
          <StatusRow label="Cloudflare script" value={scriptStatus} testId="diagnostic-script-status" />
          <StatusRow label="Runtime" value={runtimeStatus} testId="diagnostic-runtime-status" />
          <StatusRow label="Widget" value={widgetStatus} testId="diagnostic-widget-status" />
          <StatusRow label="Challenge" value={challengeStatus} testId="diagnostic-challenge-status" />
        </dl>
        {scriptStatus === 'SCRIPT FAILED' ? (
          <p className="mt-4 rounded-xl border border-rose-300/25 bg-rose-500/10 p-3 text-sm text-rose-100" role="alert">
            Cloudflare Turnstile script could not load. Check Browser DevTools for the authoritative network error.
          </p>
        ) : null}
        <div ref={containerRef} className="mt-6 min-h-16" data-testid="diagnostic-widget" />
      </section>
    </main>
  );
}
