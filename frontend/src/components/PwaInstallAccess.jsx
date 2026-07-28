import React, { useEffect } from "react";
import { CheckCircle2, Download, ExternalLink, RefreshCw, Share2 } from "lucide-react";

import Modal from "./Modal.jsx";
import { Button } from "./ui";
import {
  closePwaInstallDialog,
  invokePwaInstallPrompt,
  openPwaInstallDialog,
  pwaInstallValueCopy,
  retryPwaInstallAvailability,
  trackPwaInstallEvent,
  usePwaInstall,
} from "../lib/pwaInstallStore.js";

export function PwaInstallButton({
  className = "",
  theme = "default",
  compact = false,
  iconOnly = false,
  hideWhenInstalled = false,
  installLabel = "Install App",
  installedLabel = "App Installed",
  audienceRole = null,
  testId = "pwa-install-button",
  ...props
}) {
  const install = usePwaInstall();

  useEffect(() => {
    if (install.enabled) trackPwaInstallEvent("install_cta_viewed");
  }, [install.enabled]);

  const installed = install.classification === "installed";
  if (!install.enabled || (installed && hideWhenInstalled)) return null;
  const accessibleLabel = installed ? "MyHomeBro is installed" : "Install MyHomeBro";
  return (
    <Button
      type="button"
      variant={iconOnly ? "icon" : installed ? "secondary" : "primary"}
      theme={theme}
      size={compact ? "sm" : "md"}
      icon={installed ? CheckCircle2 : Download}
      className={className}
      data-testid={testId}
      aria-label={accessibleLabel}
      title={iconOnly ? accessibleLabel : undefined}
      onClick={() => openPwaInstallDialog({ explicit: true, audienceRole })}
      {...props}
    >
      <span className={iconOnly ? "sr-only" : ""}>
        {installed ? installedLabel : installLabel}
      </span>
    </Button>
  );
}

export function PwaAppIcon({ className = "h-12 w-12", decorative = true }) {
  return (
    <img
      src="/favicon-192x192.png"
      alt={decorative ? "" : "MyHomeBro app icon"}
      aria-hidden={decorative ? "true" : undefined}
      className={`shrink-0 rounded-xl object-cover shadow-sm ${className}`}
      data-testid="pwa-app-icon"
    />
  );
}

function InstallGuidance({ install }) {
  if (install.classification === "installed") {
    return (
      <div className="space-y-3">
        <p>MyHomeBro is installed and running as an app.</p>
        <Button type="button" variant="secondary" onClick={closePwaInstallDialog}>
          Continue in MyHomeBro
        </Button>
      </div>
    );
  }
  if (install.classification === "temporarily_unavailable") {
    return (
      <div className="space-y-4">
        <p>App installation is temporarily unavailable. You can continue using MyHomeBro in this browser.</p>
        <Button type="button" variant="secondary" icon={RefreshCw} onClick={retryPwaInstallAvailability}>
          Retry installation check
        </Button>
      </div>
    );
  }
  if (install.classification === "ios_instructions") {
    return (
      <div className="space-y-4" data-testid="pwa-ios-instructions">
        <p>iPhone and iPad browsers do not provide the same automatic install prompt.</p>
        <ol className="list-decimal space-y-2 pl-6">
          <li>Tap <strong>Share</strong> <Share2 className="inline h-4 w-4" aria-hidden="true" />.</li>
          <li>Tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>.</li>
        </ol>
      </div>
    );
  }
  if (install.classification === "native_prompt") {
    return (
      <div className="space-y-4">
        <p>Install MyHomeBro for faster access from your home screen or desktop.</p>
        <Button
          type="button"
          icon={Download}
          loading={install.promptInFlight}
          loadingLabel="Opening install prompt..."
          onClick={invokePwaInstallPrompt}
        >
          Install app
        </Button>
      </div>
    );
  }

  const android = install.browser === "android_chromium";
  const unsupported = install.classification === "unsupported";
  return (
    <div className="space-y-4" data-testid="pwa-manual-instructions">
      <p>
        {unsupported
          ? "This browser does not currently expose MyHomeBro app installation."
          : "The browser install prompt is not available right now."}
      </p>
      <ol className="list-decimal space-y-2 pl-6">
        <li>Open your browser menu.</li>
        <li>
          {android
            ? "Choose Install app or Add to Home screen."
            : "Choose Install MyHomeBro, Install app, or Apps → Install this site as an app."}
        </li>
      </ol>
      <p className="text-sm text-slate-600">Browser labels vary by version.</p>
    </div>
  );
}

export function PwaInstallDialog() {
  const install = usePwaInstall();
  const valueCopy = pwaInstallValueCopy(install.audienceRole);

  useEffect(() => {
    if (install.dialogOpen && install.classification !== "native_prompt") {
      trackPwaInstallEvent("manual_instructions_opened");
    }
  }, [install.classification, install.dialogOpen]);

  if (!install.enabled) return null;
  return (
    <Modal
      visible={install.dialogOpen}
      title="Install MyHomeBro"
      onClose={closePwaInstallDialog}
      testId="pwa-install-dialog"
      containerClassName="mx-4 max-w-lg rounded-2xl"
    >
      <div className="space-y-4 text-slate-700">
        <div>
          <h4 className="text-lg font-bold text-slate-900">Take MyHomeBro with you</h4>
          <p className="mt-1 text-sm leading-6" data-testid="pwa-install-value-copy">
            {valueCopy} Install MyHomeBro for faster access from your phone or desktop.
          </p>
        </div>
        <InstallGuidance install={install} />
        {import.meta.env.DEV ? (
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" data-testid="pwa-install-diagnostics">
            <summary className="cursor-pointer font-bold">Install diagnostics</summary>
            <dl className="mt-2 grid grid-cols-2 gap-2">
              {[
                ["PWA flag", install.enabled],
                ["Worker supported", install.serviceWorkerSupported],
                ["Worker registered", install.serviceWorkerRegistered],
                ["Manifest available", install.manifestAvailable],
                ["Native prompt", install.promptAvailable],
                ["Standalone", install.standalone],
                ["State", install.classification],
              ].map(([label, value]) => (
                <React.Fragment key={label}>
                  <dt>{label}</dt><dd>{String(value)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        ) : null}
        <div className="flex justify-end">
          <Button type="button" variant="ghost" icon={ExternalLink} onClick={closePwaInstallDialog}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
