import { expect, test } from "@playwright/test";

const requestId = "marketplace-request-501";
const comparisonKey = "golden-marketplace-request";
const winningBidId = "lead-golden-1";
const competingBidId = "lead-golden-2";
const agreementToken = "golden-agreement-token";

function bidRows({ awarded = false } = {}) {
  const winningBid = {
    id: winningBidId,
    bid_id: 1001,
    project_title: "Luxury Vinyl Plank Flooring",
    contractor_name: "Flooring Pro Austin",
    contractor_business_name: "Flooring Pro Austin",
    contractor_contact_name: "Jordan Floors",
    contractor_verified: true,
    contractor_preferred: true,
    service_area: "Austin, TX",
    project_class_label: "Residential",
    bid_amount: "8800.00",
    bid_amount_label: "$8,800.00",
    submitted_at: "2026-06-01T15:00:00Z",
    status: awarded ? "awarded" : "submitted",
    status_label: awarded ? "Awarded" : "Submitted",
    status_group: awarded ? "awarded" : "open",
    next_action: { label: awarded ? "Open Agreement" : "Review Bid" },
    comparison_key: comparisonKey,
    request_title: "Luxury Vinyl Plank Flooring",
    request_address: "123 Main St, Austin, TX 78701",
    timeline: "2 weeks",
    proposal_summary:
      "Install luxury vinyl plank flooring in the kitchen and hallway with substrate preparation, transitions, cleanup, and walkthrough.",
    payment_structure_summary: "Milestone-based installation plan.",
    milestone_preview: ["Prep & Materials", "Surface Preparation", "Flooring Installation", "Trim & Cleanup"],
    milestone_count: 4,
    warranty_summary: "One-year workmanship warranty.",
    can_accept: !awarded,
    is_awarded: awarded,
    linked_agreement_id: awarded ? 9001 : null,
    linked_agreement_token: awarded ? agreementToken : "",
  };

  const competingBid = {
    id: competingBidId,
    bid_id: 1002,
    project_title: "Luxury Vinyl Plank Flooring",
    contractor_name: "Partner Floor Works",
    contractor_business_name: "Partner Floor Works",
    contractor_contact_name: "Alex Partner",
    contractor_verified: false,
    contractor_preferred: false,
    service_area: "Austin, TX",
    project_class_label: "Residential",
    bid_amount: "9400.00",
    bid_amount_label: "$9,400.00",
    submitted_at: "2026-06-01T15:10:00Z",
    status: awarded ? "expired" : "submitted",
    status_label: awarded ? "Not Selected" : "Submitted",
    status_group: awarded ? "declined_expired" : "open",
    next_action: { label: "Review Bid" },
    comparison_key: comparisonKey,
    request_title: "Luxury Vinyl Plank Flooring",
    request_address: "123 Main St, Austin, TX 78701",
    timeline: "3 weeks",
    proposal_summary: "Install flooring with a three-phase plan and final walkthrough.",
    payment_structure_summary: "Milestone-based installation plan.",
    milestone_preview: ["Materials", "Install", "Walkthrough"],
    milestone_count: 3,
    warranty_summary: "Six-month workmanship warranty.",
    can_accept: !awarded,
    is_awarded: false,
  };

  return [winningBid, competingBid];
}

function portalPayload({ awarded = false } = {}) {
  const bids = bidRows({ awarded });
  return {
    customer: {
      name: "Pat Customer",
      email: "customer@example.com",
    },
    account: {
      email: "customer@example.com",
      has_user: true,
      has_usable_password: true,
      portal_token: "golden-token",
    },
    summary: {
      active_requests: 1,
      active_projects: awarded ? 1 : 0,
      bids_received: 2,
      active_agreements: awarded ? 1 : 0,
      payments: 0,
      documents: 0,
      maintenance_work_orders: 0,
    },
    property_profile: {
      id: 1,
      display_name: "Austin Home",
      address_line1: "123 Main St",
      city: "Austin",
      state: "TX",
      postal_code: "78701",
      is_primary: true,
      documents: [],
      photos: [],
    },
    property_profiles: [
      {
        id: 1,
        display_name: "Austin Home",
        address_line1: "123 Main St",
        city: "Austin",
        state: "TX",
        postal_code: "78701",
        is_primary: true,
        documents: [],
        photos: [],
      },
    ],
    requests: [
      {
        id: requestId,
        source_kind: "customer_request",
        project_title: "Luxury Vinyl Plank Flooring",
        project_class_label: "Residential",
        latest_activity: "2026-06-01T14:00:00Z",
        bids_count: 2,
        status: awarded ? "awarded" : "submitted",
        status_label: awarded ? "Awarded" : "Submitted",
        action_label: "Compare Bids",
        comparison_key: comparisonKey,
        notes: "Install luxury vinyl plank flooring in kitchen and hallway.",
      },
    ],
    bid_comparisons: [
      {
        comparison_key: comparisonKey,
        request_title: "Luxury Vinyl Plank Flooring",
        bids_count: 2,
        awarded_bid_id: awarded ? 1001 : null,
        awarded_contractor: awarded ? "Flooring Pro Austin" : "",
      },
    ],
    bids,
    projects: awarded
      ? [
          {
            id: 9001,
            project_number: "PRJ-GOLDEN-001",
            title: "Luxury Vinyl Plank Flooring",
            status: "draft",
            status_label: "Draft",
            contractor_name: "Flooring Pro Austin",
            agreement_id: 9001,
            agreement_token: agreementToken,
            agreement_url: `/agreements/magic/${agreementToken}`,
            total_cost: "8800.00",
            milestones: [],
          },
        ]
      : [],
    agreements: awarded
      ? [
          {
            id: 9001,
            project_title: "Luxury Vinyl Plank Flooring",
            status: "draft",
            status_label: "Draft",
            contractor_name: "Flooring Pro Austin",
            agreement_token: agreementToken,
            agreement_url: `/agreements/magic/${agreementToken}`,
          },
        ]
      : [],
    payments: [],
    documents: [],
    notifications: [],
    maintenance_work_orders: [],
  };
}

const agreementDraft = {
  id: 9001,
  agreement_id: 9001,
  project_title: "Luxury Vinyl Plank Flooring",
  title: "Luxury Vinyl Plank Flooring",
  description:
    "Agreement draft created from awarded marketplace bid. Install luxury vinyl plank flooring in the kitchen and hallway.",
  status: "draft",
  project_type: "Flooring",
  project_subtype: "Luxury Vinyl Plank",
  contractor_name: "Flooring Pro Austin",
  contractor: { business_name: "Flooring Pro Austin" },
  homeowner_name: "Pat Customer",
  homeowner_email: "customer@example.com",
  total_cost: "8800.00",
  payment_mode: "escrow",
  payment_structure: "milestone",
  signature_is_satisfied: false,
  milestones: [
    { id: 1, title: "Prep & Materials", status: "draft", amount: "1760.00" },
    { id: 2, title: "Surface Preparation", status: "draft", amount: "1760.00" },
    { id: 3, title: "Flooring Installation", status: "draft", amount: "4400.00" },
    { id: 4, title: "Trim & Cleanup", status: "draft", amount: "880.00" },
  ],
  source: "marketplace_awarded_bid",
  marketplace_banner: "Agreement draft created from awarded marketplace bid.",
};

async function installGoldenMarketplaceMocks(page) {
  let awarded = false;
  const acceptPayloads = [];

  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (method === "GET" && url.includes("/customer-portal/golden-token/")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(portalPayload({ awarded })),
      });
      return;
    }

    if (url.includes("/customer-portal/golden-token/bids/") && url.endsWith("/accept/") && method === "POST") {
      acceptPayloads.push({
        url,
        body: route.request().postDataJSON?.() || null,
      });
      awarded = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          created: true,
          agreement_id: 9001,
          detail_url: `/agreements/magic/${agreementToken}`,
          wizard_url: "/app/agreements/9001/wizard?step=1",
          banner: "Agreement draft created from awarded marketplace bid.",
          portal: portalPayload({ awarded: true }),
        }),
      });
      return;
    }

    await route.fallback();
  });

  await page.route(`**/api/agreements/access/${agreementToken}/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(agreementDraft),
    });
  });

  return { acceptPayloads };
}

test("golden path marketplace request converts awarded bid into an agreement draft", async ({ page }) => {
  const mocks = await installGoldenMarketplaceMocks(page);

  await page.goto("/portal/golden-token", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("customer-portal-summary")).toBeVisible();
  await page.getByTestId("customer-dashboard-tab-requests").click();

  await expect(page.getByTestId("customer-portal-requests")).toContainText("Luxury Vinyl Plank Flooring");
  await expect(page.getByTestId(`customer-portal-request-compare-${requestId}`)).toContainText("Compare Bids");

  await page.getByTestId(`customer-portal-request-compare-${requestId}`).click();
  await expect(page.getByTestId("customer-bid-comparison")).toContainText("Bid Comparison");
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText("Flooring Pro Austin");
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText("$8,800.00");
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText("2 weeks");
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText(
    "Install luxury vinyl plank flooring"
  );
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText(
    "One-year workmanship warranty."
  );
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText("Profile reviewed");
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText(
    "Preferred status reviewed"
  );
  await expect(page.getByTestId("customer-bid-comparison")).toContainText("Compare up to 5 contractor bids");
  await expect(page.getByTestId("customer-bid-comparison")).not.toContainText("vetted contractors");
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText("Lowest price");
  await expect(page.getByTestId(`customer-bid-comparison-card-${winningBidId}`)).toContainText("Shortest timeline");
  await expect(page.getByTestId(`customer-bid-comparison-award-${winningBidId}`)).toContainText("Award Contractor");

  await page.getByTestId(`customer-bid-comparison-award-${winningBidId}`).click();
  await expect(page.getByTestId("customer-portal-bid-award-modal")).toContainText(
    "Selecting this contractor will create a project agreement draft."
  );
  await page.getByTestId("customer-portal-bid-award-confirm").click();

  await expect.poll(() => mocks.acceptPayloads.length).toBe(1);
  await expect(page.getByTestId("customer-bid-comparison")).toContainText("Awarded Contractor");
  await expect(page.getByTestId(`customer-bid-comparison-card-${competingBidId}`)).toContainText("Not Selected");
  await expect(page.getByTestId(`customer-bid-comparison-open-${winningBidId}`)).toContainText("Open Agreement Draft");
  await expect(page.getByTestId(`customer-portal-bid-open-${winningBidId}`)).toContainText("Open agreement");

  await page.getByTestId(`customer-bid-comparison-open-${winningBidId}`).click();
  await expect(page).toHaveURL(new RegExp(`/agreements/magic/${agreementToken}$`));
  await expect(page.getByText("Agreement Workspace").first()).toBeVisible();
  await expect(page.getByText("Continue Draft").first()).toBeVisible();
  await expect(page.getByText("This agreement is still being drafted.")).toBeVisible();
  await expect(page.getByText("Luxury Vinyl Plank Flooring").first()).toBeVisible();
});
