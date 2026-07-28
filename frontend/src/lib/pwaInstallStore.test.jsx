import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

class InstallWindow extends EventTarget {
  constructor() {
    super();
    this.navigator = null;
  }
}

async function loadStore({ userAgent = "Chrome", standalone = false } = {}) {
  vi.resetModules();
  const windowTarget = new InstallWindow();
  windowTarget.matchMedia = vi.fn(() => ({ matches: standalone }));
  const values = new Map();
  const localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const navigator = {
    userAgent,
    platform: /iPhone|iPad/.test(userAgent) ? "iPhone" : "Win32",
    maxTouchPoints: /iPhone|iPad/.test(userAgent) ? 5 : 0,
    standalone,
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({ scope: "/" }),
    },
  };
  windowTarget.navigator = navigator;
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("navigator", navigator);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => "application/manifest+json" },
  }));
  const store = await import("./pwaInstallStore.js");
  store.setPwaInstallStateForTest({ enabled: true });
  return { store, windowTarget };
}

beforeEach(() => {
  vi.stubGlobal("CustomEvent", class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("shared PWA install store", () => {
  it("captures beforeinstallprompt and invokes an accepted native prompt", async () => {
    const { store, windowTarget } = await loadStore();
    const prompt = vi.fn();
    const event = new Event("beforeinstallprompt", { cancelable: true });
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    windowTarget.dispatchEvent(event);

    expect(store.getPwaInstallSnapshot().classification).toBe("native_prompt");
    await expect(store.invokePwaInstallPrompt()).resolves.toEqual({ outcome: "accepted" });
    expect(prompt).toHaveBeenCalledOnce();
    expect(store.getPwaInstallSnapshot().promptOutcome).toBe("accepted");
  });

  it("records dismissed native prompts and clears stale events", async () => {
    const { store } = await loadStore();
    const prompt = vi.fn();
    store.setPwaInstallStateForTest(
      { promptAvailable: true },
      { prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) }
    );
    await store.invokePwaInstallPrompt();
    expect(store.getPwaInstallSnapshot().promptOutcome).toBe("dismissed");
    await expect(store.invokePwaInstallPrompt()).resolves.toEqual({ outcome: "unavailable" });
  });

  it("keeps explicit install access during passive dismissal cooldown", async () => {
    const { store } = await loadStore();
    store.dismissPassivePwaInstall();
    expect(store.passivePwaInstallAllowed()).toBe(false);
    store.openPwaInstallDialog({ explicit: true });
    expect(store.getPwaInstallSnapshot().dialogOpen).toBe(true);
  });

  it("classifies iOS, unsupported, unavailable, and installed modes", async () => {
    const { store } = await loadStore({ userAgent: "iPhone Safari" });
    expect(store.getPwaInstallSnapshot().classification).toBe("ios_instructions");
    store.setPwaInstallStateForTest({ ios: false, manifestAvailable: false });
    expect(store.getPwaInstallSnapshot().classification).toBe("temporarily_unavailable");
    store.setPwaInstallStateForTest({
      browser: "firefox",
      manifestAvailable: null,
      serviceWorkerSupported: false,
    });
    expect(store.getPwaInstallSnapshot().classification).toBe("unsupported");
    store.setPwaInstallStateForTest({ standalone: true });
    expect(store.getPwaInstallSnapshot().classification).toBe("installed");
  });

  it("uses one dialog state and transitions on appinstalled", async () => {
    const { store, windowTarget } = await loadStore();
    store.openPwaInstallDialog();
    store.openPwaInstallDialog();
    expect(store.getPwaInstallSnapshot().dialogOpen).toBe(true);
    windowTarget.dispatchEvent(new Event("appinstalled"));
    expect(store.getPwaInstallSnapshot()).toMatchObject({
      appInstalled: true,
      standalone: true,
      dialogOpen: false,
      classification: "installed",
    });
  });

  it("shows persistent access when enabled and hides it when disabled", async () => {
    const { store } = await loadStore();
    const { PwaInstallButton } = await import("../components/PwaInstallAccess.jsx");
    expect(renderToStaticMarkup(<PwaInstallButton />)).toContain("Install MyHomeBro");
    const iconOnly = renderToStaticMarkup(<PwaInstallButton iconOnly />);
    expect(iconOnly).toContain('aria-label="Install MyHomeBro"');
    expect(iconOnly).toContain('title="Install MyHomeBro"');
    expect(store.pwaInstallValueCopy("contractor_owner")).toContain("Manage customers");
    expect(store.pwaInstallValueCopy("homeowner")).toContain("Follow project progress");
    expect(store.pwaInstallValueCopy("property_manager")).toContain("Manage units");
    expect(store.pwaInstallValueCopy()).toContain("Keep projects");
    store.setPwaInstallStateForTest({ enabled: false });
    expect(renderToStaticMarkup(<PwaInstallButton />)).toBe("");
  });
});
