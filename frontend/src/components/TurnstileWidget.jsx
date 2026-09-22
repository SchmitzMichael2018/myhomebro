import React, { useEffect, useRef } from 'react';

const SCRIPT_ID = 'cloudflare-turnstile-script';

export default function TurnstileWidget({ onToken }) {
  const ref = useRef(null);
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
  useEffect(() => {
    if (!siteKey) return undefined;
    const render = () => window.turnstile?.render(ref.current, { sitekey: siteKey, callback: onToken, 'expired-callback': () => onToken('') });
    if (window.turnstile) { render(); return undefined; }
    let script = document.getElementById(SCRIPT_ID);
    if (!script) { script = document.createElement('script'); script.id = SCRIPT_ID; script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true; document.head.appendChild(script); }
    script.addEventListener('load', render);
    return () => script?.removeEventListener('load', render);
  }, [onToken, siteKey]);
  if (!siteKey) return null;
  return <div ref={ref} data-testid="turnstile-widget" />;
}
