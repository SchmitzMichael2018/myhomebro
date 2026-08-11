import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import NotificationItem from "./NotificationItem.jsx";

describe("NotificationItem", () => {
  it("provides separate accessible open and mark-read actions without nested controls", () => {
    const html = renderToStaticMarkup(
      <NotificationItem
        notification={{ id: 7, title: "Changes requested", action_label: "Review Requested Changes" }}
        unread
        onOpen={() => {}}
        onMarkRead={() => {}}
        data-testid="notification-item-7"
      />
    );

    expect(html).toContain("Changes requested. Review Requested Changes");
    expect(html).toContain("Mark Changes requested as read");
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("</button><div");
  });

  it("does not render a mark-read action for archived history items", () => {
    const html = renderToStaticMarkup(
      <NotificationItem notification={{ id: 8, title: "Estimate viewed" }} onOpen={() => {}} />
    );
    expect(html).not.toContain("Mark Estimate viewed as read");
  });
});
