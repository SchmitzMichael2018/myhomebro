import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { useLocation } from "react-router-dom";

import { Button, InlineAlert } from "./ui";
import { PWA_FLAGS } from "../lib/pwaFlags.js";
import {
  clearPwaCaches,
  disablePwa,
  PWA_VERSION,
  registerPwa,
} from "../lib/pwaLifecycle.js";
import {
  dismissPassivePwaInstall,
  markPwaRegistration,
  openPwaInstallDialog,
  passivePwaInstallAllowed,
  usePwaInstall,
} from "../lib/pwaInstallStore.js";
import { PwaAppIcon } from "./PwaInstallAccess.jsx";

const CRITICAL_ROUTE = /agreement|estimate|payment|invoice|capture|measurement|takeoff|warrant|change/i;
const SAFE_EMPLOYEE_ROUTE = /^\/app\/employee\/(?:dashboard|agreements|milestones|calendar|profile)\/?$/i;

export default function PwaStatus() {
  const location = useLocation();
  const updateRef = useRef(null);
  const restoredTimerRef = useRef(null);
  const install = usePwaInstall();
  const [connection, setConnection] = useState(navigator.onLine ? "online" : "offline");
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);

  const hasUnsavedWork = useMemo(
    () => Boolean(
      document.querySelector('[data-pwa-unsaved="true"]')
      || (CRITICAL_ROUTE.test(location.pathname) && !SAFE_EMPLOYEE_ROUTE.test(location.pathname))
    ),
    [location.pathname]
  );

  useEffect(() => {
    if (!PWA_FLAGS.enabled) {
      disablePwa().catch(() => {});
      return undefined;
    }
    updateRef.current = registerPwa({
      onNeedRefresh: () => setUpdateWaiting(true),
      onRegistered: () => markPwaRegistration({ registered: true }),
      onRegisterError: () => {
        setRegistrationFailed(true);
        markPwaRegistration({ failed: true });
      },
    });
    return undefined;
  }, []);

  useEffect(() => {
    if (!updateWaiting || hasUnsavedWork) return;
    updateRef.current?.(true);
  }, [hasUnsavedWork, updateWaiting]);

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

  function dismissInstall() {
    dismissPassivePwaInstall();
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
      {PWA_FLAGS.installPrompt
        && install.classification !== "installed"
        && install.classification !== "disabled"
        && passivePwaInstallAllowed()
        && !install.dialogOpen ? (
        <div className="pointer-events-auto fixed inset-x-3 top-[calc(76px+env(safe-area-inset-top))] mx-auto max-w-md rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card-elevated)] p-3 shadow-card-elevated sm:left-auto sm:right-4" role="dialog" aria-labelledby="pwa-install-title" data-testid="pwa-passive-install-banner">
          <div className="flex items-start gap-3">
            <PwaAppIcon className="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <strong id="pwa-install-title">Install MyHomeBro</strong>
              <p className="mt-0.5 text-sm leading-5 text-[var(--mhb-text-secondary)]">
                Add MyHomeBro to your home screen or desktop for faster access.
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-col-reverse gap-2 min-[375px]:flex-row min-[375px]:justify-end">
            <Button type="button" size="sm" variant="secondary" theme="operational" className="min-h-11" onClick={dismissInstall}>Not now</Button>
            <Button type="button" size="sm" theme="operational" className="min-h-11" icon={Download} onClick={() => openPwaInstallDialog({ explicit: false })}>Install</Button>
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
