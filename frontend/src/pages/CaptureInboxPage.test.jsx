import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CaptureInboxFeatureGate,
} from "./CaptureInboxPage.jsx";

describe("Capture Inbox foundation", () => {
  it("does not render Inbox content while either feature flag is disabled", () => {
    const foundationOff = renderToStaticMarkup(
      <CaptureInboxFeatureGate flags={{ foundation: false, inbox: true }}>
        <div>Capture Inbox content</div>
      </CaptureInboxFeatureGate>
    );
    const inboxOff = renderToStaticMarkup(
      <CaptureInboxFeatureGate flags={{ foundation: true, inbox: false }}>
        <div>Capture Inbox content</div>
      </CaptureInboxFeatureGate>
    );

    expect(foundationOff).toBe("");
    expect(inboxOff).toBe("");
  });

  it("renders gated content only when both flags are enabled", () => {
    const html = renderToStaticMarkup(
      <CaptureInboxFeatureGate flags={{ foundation: true, inbox: true }}>
        <div data-testid="capture-inbox">Capture Inbox content</div>
      </CaptureInboxFeatureGate>
    );

    expect(html).toContain('data-testid="capture-inbox"');
    expect(html).toContain("Capture Inbox content");
  });

});
