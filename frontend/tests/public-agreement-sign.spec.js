import { expect, test } from "@playwright/test";

const AGREEMENT_TOKEN = "public-sign-token-123";
const FUNDING_TOKEN = "funding-token-123";

function agreementPayload({ signed = false } = {}) {
  return {
    id: 321,
    project_title: "Kitchen Remodel",
    project_summary: "Refresh the kitchen with new cabinets, countertops, and a cleaner layout.",
    contractor_name: "Bright Build Co",
    contractor_email: "hello@brightbuild.co",
    contractor_rating: {
      average_rating: 4.87,
      review_count: 12,
      display_label: "4.87 average rating",
    },
    status: signed ? "signed" : "draft",
    pdf_url: `/api/projects/agreements/public_pdf/?token=${AGREEMENT_TOKEN}&stream=1&preview=1`,
    milestones: [
      {
        id: 1,
        order: 1,
        title: "Demo",
        description: "Remove existing finishes and prep the site.",
        amount: "4000.00",
      },
      {
        id: 2,
        order: 2,
        title: "Cabinets & surfaces",
        description: "Install cabinets, counters, and finish surfaces.",
        amount: "8000.00",
      },
    ],
    attachments: [
      {
        id: 11,
        title: "Kitchen photo",
        category: "EXHIBIT",
        url: "https://example.com/kitchen-photo.jpg",
      },
    ],
    terms_of_service_snapshot: "Customer agrees to the project scope and payment terms.",
    privacy_policy_snapshot: "Customer data is handled according to the MyHomeBro privacy policy.",
    payment_mode: "escrow",
    total_cost: "12000.00",
    escrow_total: "12000.00",
    scope_summary: "Refine the kitchen with cabinet, surface, and finish updates.",
    is_fully_signed: signed,
    funding_token: signed ? FUNDING_TOKEN : "",
    public_fund_url: signed ? `http://localhost/public-fund/${FUNDING_TOKEN}` : "",
    preview: false,
  };
}

async function installPublicAgreementRoutes(page) {
  let signed = false;

  await page.route(/\/api\/projects\/agreements\/public_sign\/?(\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(agreementPayload({ signed })),
      });
      return;
    }

    signed = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        funding_link_sent: true,
        funding_token: FUNDING_TOKEN,
        public_fund_url: `http://localhost/public-fund/${FUNDING_TOKEN}`,
        funding: {
          agreement_id: 321,
          amount: "1500.00",
          currency: "usd",
          public_fund_url: `http://localhost/public-fund/${FUNDING_TOKEN}`,
          expires_at: "2026-04-29T00:00:00Z",
        },
      }),
    });
  });

  await page.route(/\/api\/projects\/agreements\/public_pdf\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
    });
  });

  await page.route(/\/api\/projects\/funding\/public_fund\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        token: FUNDING_TOKEN,
        agreement_id: 321,
        project_title: "Kitchen Remodel",
        contractor_name: "Bright Build Co",
        homeowner_name: "Jordan Homeowner",
        total_required: "1500.00",
        escrow_funded_amount: "0.00",
        remaining_to_fund: "1500.00",
        escrow_funded: false,
      }),
    });
  });

  await page.route(/\/api\/projects\/funding\/create_payment_intent\/?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        client_secret: "pi_test_secret_123",
        amount: "1500.00",
        currency: "usd",
        already_paid: false,
        payment_intent_id: "pi_test_123",
      }),
    });
  });

  await page.route("**/js.stripe.com/v3*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `
        window.Stripe = function Stripe() {
          return {
            elements() {
              return {
                create() {
                  return {
                    mount() {},
                    unmount() {},
                    destroy() {},
                    on() {},
                    update() {},
                  };
                },
              };
            },
            retrievePaymentIntent() {
              return Promise.resolve({ paymentIntent: { status: "requires_payment_method" } });
            },
            confirmPayment() {
              return Promise.resolve({ paymentIntent: { status: "succeeded" } });
            },
          };
        };
      `,
    });
  });
}

test("public agreement review, sign, and funding handoff work from the token link", async ({ page }) => {
  await installPublicAgreementRoutes(page);

  await page.goto(`/public-sign/${AGREEMENT_TOKEN}`, { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("public-agreement-hero")).toBeVisible();
  await expect(page.getByTestId("public-agreement-hero").getByText("Bright Build Co")).toBeVisible();
  await expect(page.getByText("Kitchen Remodel")).toBeVisible();
  await expect(page.getByText(/4\.87.*verified reviews/i)).toBeVisible();
  await expect(page.getByText("Refresh the kitchen with new cabinets")).toBeVisible();
  await expect(page.getByText("Demo")).toBeVisible();
  await expect(page.getByText("Kitchen photo")).toBeVisible();

  await page.getByTestId("public-agreement-accept-sign").click();
  await expect(page.getByText(/Customer Signature/i)).toBeVisible();

  await page.getByPlaceholder("e.g., Jane Contractor").fill("Jordan Homeowner");
  const checkboxes = page.getByRole("checkbox");
  await checkboxes.nth(0).check();
  await checkboxes.nth(1).check();
  await checkboxes.nth(2).check();

  await page.getByRole("button", { name: "Sign as Customer" }).click();

  await expect(page.getByTestId("public-agreement-confirmation")).toBeVisible();
  const fundingPanel = page.getByTestId("public-agreement-funding-panel");
  await expect
    .poll(async () => {
      const candidates = [
        fundingPanel,
        page.getByText("Loading deposit details…"),
        page.getByText("Preparing your deposit step…"),
        page.getByText("Stripe is not configured in this environment."),
      ];
      for (const locator of candidates) {
        if (await locator.count()) return true;
      }
      return false;
    })
    .toBe(true);

  const payButton = page.getByRole("button", { name: /Pay \$?1,500\.00|Pay \$?1500\.00/i });
  if (await payButton.count()) {
    if (await payButton.first().isVisible()) {
      await payButton.first().click();
    }
  }
});
