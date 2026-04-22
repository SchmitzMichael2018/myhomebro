import { expect, test } from "@playwright/test";

const AGREEMENT_TOKEN = "public-sign-token-123";
const PORTAL_TOKEN = "portal-token-123";
const PROJECT_ID = 321;

function dashboardPayload(state = "draft", photos = []) {
  const nextActionByState = {
    draft: {
      title: "Review and sign your agreement",
      body: "Please review the agreement, then sign to keep the project moving.",
      label: "Accept & Sign",
      tone: "amber",
      url: `/agreements/magic/${AGREEMENT_TOKEN}`,
    },
    signed: {
      title: "Fund the deposit",
      body: "Your project is ready for escrow funding so work can begin.",
      label: "Fund Deposit",
      tone: "blue",
      url: `http://localhost/public-fund/funding-token-123`,
    },
    direct: {
      title: "Pay Invoice",
      body: "An approved invoice is ready for payment.",
      label: "Pay Invoice",
      tone: "blue",
      url: `/invoice/invoice-token-123`,
    },
  };

  const paymentsByState = {
    draft: {
      summary: {
        payment_mode: "escrow",
        payment_mode_label: "Escrow",
        agreement_total: "12000.00",
        agreement_total_label: "$12,000.00",
        escrow_funded: false,
        escrow_funded_label: "Waiting for funding",
        remaining_to_fund: "12000.00",
        remaining_to_fund_label: "$12,000.00",
        invoice_count: 0,
        draw_count: 0,
      },
      invoice_rows: [],
      draw_rows: [],
    },
    signed: {
      summary: {
        payment_mode: "escrow",
        payment_mode_label: "Escrow",
        agreement_total: "12000.00",
        agreement_total_label: "$12,000.00",
        escrow_funded: false,
        escrow_funded_label: "Waiting for funding",
        remaining_to_fund: "12000.00",
        remaining_to_fund_label: "$12,000.00",
        invoice_count: 0,
        draw_count: 1,
      },
      invoice_rows: [],
      draw_rows: [
        {
          id: 1,
          type: "draw",
          label: "Draw 1",
          amount: "6000.00",
          amount_label: "$6,000.00",
          status: "submitted",
          status_label: "Submitted",
          date: "2026-04-20T12:00:00Z",
          link: `/draws/magic/draw-token-123`,
          notes: "Awaiting release",
        },
      ],
    },
    direct: {
      summary: {
        payment_mode: "direct",
        payment_mode_label: "Direct Pay",
        agreement_total: "12000.00",
        agreement_total_label: "$12,000.00",
        escrow_funded: false,
        escrow_funded_label: "Not used",
        remaining_to_fund: "6000.00",
        remaining_to_fund_label: "$6,000.00",
        invoice_count: 1,
        draw_count: 0,
      },
      invoice_rows: [
        {
          id: 11,
          type: "invoice",
          label: "Invoice INV-20260422-0001",
          amount: "6000.00",
          amount_label: "$6,000.00",
          status: "approved",
          status_label: "Approved",
          date: "2026-04-20T12:00:00Z",
          link: `/invoice/invoice-token-123`,
          notes: "",
        },
      ],
      draw_rows: [],
    },
  };

  return {
    project: {
      id: PROJECT_ID,
      number: "PRJ-20260422-0001",
      title: "Kitchen Remodel",
      description: "Refresh the kitchen with new cabinets, counters, and a cleaner layout.",
      status: state === "draft" ? "draft" : state === "signed" ? "signed" : "funded",
      status_label: state === "draft" ? "Draft" : state === "signed" ? "Signed" : "Funded",
      address: "123 Main St, Austin, TX",
    },
    hero: {
      project_title: "Kitchen Remodel",
      project_number: "PRJ-20260422-0001",
      contractor_name: "Bright Build Co",
      contractor_email: "hello@brightbuild.co",
      contractor_rating: {
        average_rating: 4.87,
        review_count: 12,
        display_label: "4.87 average rating",
      },
      status_label: state === "draft" ? "Draft" : state === "signed" ? "Signed" : "Funded",
      payment_mode_label: state === "direct" ? "Direct Pay" : "Escrow",
      summary: "Refresh the kitchen with new cabinets, counters, and a cleaner layout.",
      agreement_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
      funding_url: state === "draft" || state === "signed" ? `http://localhost/public-fund/funding-token-123` : "",
      public_profile_url: "http://localhost/contractors/bright-build-co",
    },
    next_action: nextActionByState[state] || nextActionByState.draft,
    timeline: [
      {
        id: 1,
        order: 1,
        title: "Demo and Prep",
        description: "Remove existing finishes and prep the site.",
        amount: "4000.00",
        amount_label: "$4,000.00",
        status: state === "signed" ? "awaiting_review" : "in_progress",
        status_label: state === "signed" ? "Awaiting Review" : "In Progress",
        completed: false,
        is_invoiced: false,
        completion_date: "2026-04-30",
      },
      {
        id: 2,
        order: 2,
        title: "Cabinets and Surfaces",
        description: "Install cabinets and countertops.",
        amount: "8000.00",
        amount_label: "$8,000.00",
        status: "in_progress",
        status_label: "In Progress",
        completed: false,
        is_invoiced: false,
        completion_date: "2026-05-15",
      },
    ],
    payments: paymentsByState[state] || paymentsByState.draft,
    messages: {
      items: [
        {
          id: 1,
          milestone_title: "Demo and Prep",
          author: "Bright Build Co",
          body: "We are ready to start prep work.",
          created_at: "2026-04-20T12:00:00Z",
        },
      ],
      latest: [
        {
          id: 1,
          milestone_title: "Demo and Prep",
          author: "Bright Build Co",
          body: "We are ready to start prep work.",
          created_at: "2026-04-20T12:00:00Z",
        },
      ],
    },
    photos,
    agreement: {
      id: 111,
      title: "Kitchen Remodel Agreement",
      status: state === "draft" ? "Draft" : state === "signed" ? "Signed" : "Funded",
      status_key: state,
      project_class_label: "Residential",
      payment_mode_label: state === "direct" ? "Direct Pay" : "Escrow",
      payment_structure_label: "Simple",
      total_cost_label: "$12,000.00",
      agreement_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
      pdf_url: `/api/projects/agreements/public_pdf/?token=${AGREEMENT_TOKEN}&stream=1&preview=1`,
      funding_url: state === "draft" || state === "signed" ? `http://localhost/public-fund/funding-token-123` : "",
    },
    notifications: [
      {
        id: 1,
        category: "agreement_signed",
        title: "Agreement signed",
        body: "Your agreement is signed and ready for the next project step.",
        tone: "emerald",
        created_at: "2026-04-20T12:00:00Z",
        link: `/agreements/magic/${AGREEMENT_TOKEN}`,
      },
    ],
    review: {
      eligible: state === "direct",
      message: "Leave a review when the work is complete.",
      url: "http://localhost/contractors/bright-build-co?review=1",
    },
  };
}

async function installRoutes(page) {
  const state = { value: "draft" };
  const photos = [
    {
      id: 1,
      title: "Kitchen photo",
      category: "EXHIBIT",
      url: "https://example.com/kitchen-photo.jpg",
      uploaded_at: "2026-04-18T12:00:00Z",
    },
  ];

  await page.route(/\/api\/projects\/agreements\/public_sign\/?(\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...dashboardPayload(state.value, photos),
          project_dashboard_url: `/app/project/${PROJECT_ID}?token=${PORTAL_TOKEN}`,
        }),
      });
      return;
    }

    state.value = "signed";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        funding_link_sent: true,
        funding_token: "funding-token-123",
        public_fund_url: "http://localhost/public-fund/funding-token-123",
      }),
    });
  });

  await page.route(/\/api\/projects\/customer-portal\/project\/321\/?(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") {
      photos.push({
        id: photos.length + 1,
        title: "Exterior photo",
        category: "OTHER",
        url: "https://example.com/exterior-photo.jpg",
        uploaded_at: "2026-04-22T12:00:00Z",
      });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(dashboardPayload(state.value, photos)),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(dashboardPayload(state.value, photos)),
    });
  });

  return state;
}

test("customer project dashboard opens from the agreement link and updates next action by state", async ({ page }) => {
  const state = await installRoutes(page);

  await page.goto(`/public-sign/${AGREEMENT_TOKEN}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-agreement-open-project-dashboard")).toBeVisible();
  await page.getByTestId("public-agreement-open-project-dashboard").click();

  await expect(page).toHaveURL(new RegExp(`/app/project/${PROJECT_ID}\\?token=${PORTAL_TOKEN}`));
  await expect(page.getByTestId("project-hero-status")).toContainText("Kitchen Remodel");
  await expect(page.getByTestId("project-next-action")).toContainText("Accept & Sign");
  await expect(page.getByTestId("project-payments")).toContainText("Waiting for funding");
  await expect(page.getByTestId("project-messages")).toContainText("We are ready to start prep work.");

  await page.setInputFiles('[data-testid="project-photo-upload-input"]', {
    name: "exterior.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("photo"),
  });
  await expect(page.getByTestId("project-photos")).toContainText("Exterior photo");

  state.value = "signed";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("project-next-action")).toContainText("Fund Deposit");

  state.value = "direct";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("project-next-action")).toContainText("Pay Invoice");
  await expect(page.getByTestId("project-notifications")).toContainText("Agreement signed");
  await expect(page.getByTestId("project-review")).toContainText("Leave a review");
});
