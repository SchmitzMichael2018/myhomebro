import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { useLocation } from "react-router-dom";

import { Button, InlineAlert } from "./ui";
import { PWA_FLAGS } from "../lib/pwaFlags.js";
import {
  clearPwaCaches,
  disablePwa,
  isStandalonePwa,
  PWA_VERSION,
  registerPwa,
} from "../lib/pwaLifecycle.js";

const DISMISS_KEY = "mhb.pwa.install-dismissed.v1";
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
const CRITICAL_ROUTE = /agreement|estimate|payment|invoice|capture|measurement|takeoff|warrant|change/i;

export default function PwaStatus() {
  const location = useLocation();
  const updateRef = useRef(null);
  const installEventRef = useRef(null);
  const restoredTimerRef = useRef(null);
  const [connection, setConnection] = useState(navigator.onLine ? "online" : "offline");
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const [installable, setInstallable] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [standalone, setStandalone] = useState(isStandalonePwa());
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  const hasUnsavedWork = useMemo(
    () => Boolean(
      document.querySelector('[data-pwa-unsaved="true"]')
      || CRITICAL_ROUTE.test(location.pathname)
    ),
    [location.pathname, updateWaiting]
  );

  useEffect(() => {
    if (!PWA_FLAGS.enabled) {
      disablePwa().catch(() => {});
      return undefined;
    }
    updateRef.current = registerPwa({
      onNeedRefresh: () => setUpdateWaiting(true),
      onRegisterError: () => setRegistrationFailed(true),
    });
    return undefined;
  }, []);

  useEffect(() => {
    function offline() {
      setConnection("offline");
    }
    async function online() {
      setConnection("reconnecting");
      try {
        const response = await fetch("/healthz", { cache: "no-store", credentials: "same-origin" });
        if (!response.ok) throw new Error("health unavailable");
        setConnection("restored");
        clearTimeout(restoredTimerRef.current);
        restoredTimerRef.current = setTimeout(() => setConnection("online"), 4000);
      } catch {
        setConnection("server_unavailable");
      }
    }
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      clearTimeout(restoredTimerRef.current);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  useEffect(() => {
    if (!PWA_FLAGS.enabled || !PWA_FLAGS.installPrompt || standalone) return undefined;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - dismissedAt < DISMISS_MS) setInstallDismissed(true);
    if (isIos) setInstallable(true);
    function beforeInstall(event) {
      event.preventDefault();
      installEventRef.current = event;
      setInstallable(true);
    }
    function installed() {
      installEventRef.current = null;
      setInstallable(false);
      setStandalone(true);
    }
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, [standalone]);

  async function install() {
    if (!installEventRef.current) return;
    await installEventRef.current.prompt();
    await installEventRef.current.userChoice;
    installEventRef.current = null;
    setInstallable(false);
  }

  function dismissInstall() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setInstallDismissed(true);
  }

  async function recover() {
    await clearPwaCaches({ includeStatic: true });
    window.location.reload();
  }

  if (!PWA_FLAGS.enabled) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-[70] mx-auto grid max-w-xl gap-2"
      data-testid="pwa-status"
      data-pwa-version={PWA_VERSION}
    >
      <div className="sr-only" aria-live="polite">
        {connection === "offline" ? "MyHomeBro is offline." : null}
        {connection === "restored" ? "Connection restored." : null}
      </div>
      {connection !== "online" ? (
        <div className="pointer-events-auto">
          <InlineAlert theme="operational" tone={connection === "restored" ? "success" : "warning"}>
            <span className="flex items-center gap-2">
              <WifiOff className="h-4 w-4" aria-hidden="true" />
              {connection === "offline" && "You’re offline. Server data and submissions are unavailable."}
              {connection === "reconnecting" && "Reconnecting to MyHomeBro…"}
              {connection === "restored" && "Connection restored. Review your work before submitting."}
              {connection === "server_unavailable" && "The server is unavailable. Your browser may still be online."}
            </span>
          </InlineAlert>
        </div>
      ) : null}
      {updateWaiting ? (
        <div className="pointer-events-auto rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card-elevated)] p-3 shadow-card-elevated" role="dialog" aria-labelledby="pwa-update-title">
          <strong id="pwa-update-title">Update available</strong>
          <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">
            {hasUnsavedWork
              ? "Finish or save this work before updating MyHomeBro."
              : "Update the app shell now, or continue and update later."}
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" theme="operational" onClick={() => setUpdateWaiting(false)}>Later</Button>
            <Button type="button" size="sm" theme="operational" icon={RefreshCw} disabled={hasUnsavedWork} onClick={() => updateRef.current?.(true)}>Update now</Button>
          </div>
        </div>
      ) : null}
      {installable && !installDismissed ? (
        <div className="pointer-events-auto rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card-elevated)] p-3 shadow-card-elevated" role="dialog" aria-labelledby="pwa-install-title">
          <strong id="pwa-install-title">Install MyHomeBro</strong>
          <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">
            {isIos
              ? "In Safari, tap Share, then Add to Home Screen. Internet is still required for current business data."
              : "Open MyHomeBro in its own app window. Internet is still required for current business data."}
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" theme="operational" onClick={dismissInstall}>Not now</Button>
            {!isIos ? <Button type="button" size="sm" theme="operational" icon={Download} onClick={install}>Install</Button> : null}
          </div>
        </div>
      ) : null}
      {registrationFailed ? (
        <div className="pointer-events-auto">
          <InlineAlert theme="operational" tone="warning">
            App installation is unavailable. Continue in the browser or{" "}
            <button type="button" className="underline" onClick={recover}>clear cached app files</button>.
          </InlineAlert>
        </div>
      ) : null}
    </div>
  );
}
