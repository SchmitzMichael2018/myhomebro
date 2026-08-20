import { expect, test } from "@playwright/test";

const proposed = {
  id: 81, status: "proposed", display_status: "Awaiting customer confirmation",
  local_date: "2026-08-21", local_time: "2:00 PM", timezone: "America/Chicago",
  timezone_label: "CDT (America/Chicago)", appointment_type_label: "In-Person Estimate",
  contractor_name: "Safe Builder", location: "123 Main St", confirmed: false,
};

async function installRoutes(page) {
  let state = { ...proposed };
  const actions = [];
  await page.route("**/api/projects/public/estimate-appointments/test-token/", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ appointment: state }) });
    const body = route.request().postDataJSON();
    actions.push(body.action);
    if (body.action === "confirm") state = { ...state, status: "confirmed", display_status: "Confirmed", confirmed: true, google_calendar_url: "https://calendar.google.com/calendar/render?action=TEMPLATE", ics_url: "/api/projects/public/estimate-appointments/test-token/calendar.ics", calendar_export_note: "Calendar export is one-way." };
    if (body.action === "decline") state = { ...state, status: "declined", display_status: "Declined" };
    const message = body.action === "confirm" ? "Your appointment is confirmed." : body.action === "decline" ? "The appointment was declined." : "Your request was sent to the contractor.";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ appointment: state, message }) });
  });
  return actions;
}

test("customer confirms an appointment and receives one-way calendar exports", async ({ page }) => {
  const actions = await installRoutes(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/appointment-confirmation/test-token");
  const surface = page.getByTestId("public-appointment-confirmation");
  await expect(surface).toContainText("Awaiting customer confirmation");
  await expect(surface.getByRole("button", { name: "Confirm appointment" })).toBeVisible();
  await surface.getByRole("button", { name: "Confirm appointment" }).click();
  await expect(surface.getByRole("status")).toContainText("confirmed");
  await expect(surface.getByRole("link", { name: "Add to Google Calendar" })).toHaveAttribute("target", "_blank");
  await expect(surface.getByRole("link", { name: "Add to Google Calendar" })).toHaveAttribute("rel", /noopener/);
  await expect(surface.getByRole("link", { name: "Add to Apple/Outlook Calendar" })).toHaveAttribute("href", /calendar\.ics/);
  expect(actions).toEqual(["confirm"]);
  await page.screenshot({ path: "test-results/appointment-confirmation-desktop.png", fullPage: true });
});

test("customer can request another time on 390px mobile without overflow", async ({ page }) => {
  const actions = await installRoutes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/appointment-confirmation/test-token");
  await page.getByLabel("Message to contractor (optional)").fill("Please offer an afternoon time.");
  await page.getByRole("button", { name: "Request another time" }).click();
  await expect(page.getByRole("status")).toContainText("request was sent");
  expect(actions).toEqual(["request_another_time"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/appointment-confirmation-mobile.png", fullPage: true });
});

test("customer can decline the tentative appointment", async ({ page }) => {
  const actions = await installRoutes(page);
  await page.goto("/appointment-confirmation/test-token");
  await page.getByRole("button", { name: "Decline appointment" }).click();
  await expect(page.getByRole("status")).toContainText("declined");
  await expect(page.getByRole("button", { name: "Confirm appointment" })).toHaveCount(0);
  expect(actions).toEqual(["decline"]);
});
