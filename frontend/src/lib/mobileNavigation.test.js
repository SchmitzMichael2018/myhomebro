import { describe, expect, it } from "vitest";

import { pageShellOwnsMobileNavigation } from "./mobileNavigation.js";

describe("authenticated mobile navigation ownership", () => {
  it("keeps the shell fallback when PageShell renders no header", () => {
    expect(pageShellOwnsMobileNavigation({ title: null, showLogo: false })).toBe(false);
  });

  it("does not let loading, role, or standalone state remove the fallback", () => {
    expect(pageShellOwnsMobileNavigation({
      title: null,
      showLogo: false,
      identityLoading: true,
      role: "contractor_owner",
      standalone: true,
    })).toBe(false);
  });

  it("lets a visible PageShell header own the mobile menu control", () => {
    expect(pageShellOwnsMobileNavigation({ title: "Dashboard", showLogo: false })).toBe(true);
    expect(pageShellOwnsMobileNavigation({ title: null, showLogo: true })).toBe(true);
  });
});
