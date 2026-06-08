import { expect, test } from "@playwright/test";

const AGREEMENT_ID = 7001;
const AGREEMENT_TOKEN = "contractor-agreement-token";
const PORTAL_TOKEN = "contractor-customer-token";
const OTHER_PORTAL_TOKEN = "other-customer-token";

const milestones = [
  {
    id: 301,
    agreement: AGREEMENT_ID,
    order: 1,
    title: "Material Prep",
    description: "Confirm luxury vinyl plank materials, protect work areas, and prepare the kitchen and hallway.",
    amount: "1800.00",
    status: "planned",
    start_date: "2026-05-04",
    due_date: "2026-05-05",
  },
  {
    id: 302,
    agreement: AGREEMENT_ID,
    order: 2,
    title: "Flooring Installation",
    description: "Install LVP flooring, transitions, trim, and complete final cleanup.",
    amount: "4200.00",
    status: "planned",
    start_date: "2026-05-06",
    due_date: "2026-05-08",
  },
];

function makeAgreement(overrides = {}) {
  return {
    id: AGREEMENT_ID,
    agreement_id: AGREEMENT_ID,
    title: "Kitchen & Hall LVP Installation",
    project_title: "Kitchen & Hall LVP Installation",
    description:
      "Included Work\n- Prepare kitchen and hallway subfloor.\n- Install luxury vinyl plank flooring.\n- Install transitions and trim.\n- Clean work areas and complete final walkthrough.",
    project_class: "residential",
    project_type: "Flooring",
    project_subtype: "Luxury Vinyl Plank",
    homeowner: 501,
    homeowner_name: "Pat Customer",
    homeowner_email: "pat.customer@example.com",
    homeowner_phone: "555-0101",
    address: "123 Portal Lane, Austin, TX 78701",
    payment_mode: "escrow",
    payment_structure: "simple",
    total_cost: "6000.00",
    status: "draft",
    workflow_status: "draft",
    pdf_version: 1,
    pdf_viewed: true,
    has_previewed: true,
    previewed: true,
    contractor_previewed: true,
    signed_by_contractor: true,
    contractor_signed: true,
    contractor_signature_name: "Casey Contractor",
    contractor_signed_at: "2026-05-01T15:00:00Z",
    signed_by_homeowner: false,
    homeowner_signed: false,
    signature_is_satisfied: false,
    is_fully_signed: false,
    signature_request_sent: false,
    require_contractor_signature: true,
    require_customer_signature: true,
    warranty_type: "default",
    warranty_text: "One-year workmanship warranty on flooring installation labor.",
    warranty_text_snapshot: "One-year workmanship warranty on flooring installation labor.",
    milestones,
    payment_protection: {
      label: "Escrow Preferred",
      reason: "Customer funds are held until milestone review and approval.",
    },
    ...overrides,
  };
}

function makePortalPayload({ includeProject = true } = {}) {
  const project = {
    id: "project-lvp-1",
    project_number: "PRJ-20260501-001",
    title: "Kitchen & Hall LVP Installation",
    description: "Track the flooring agreement, milestone plan, and customer next actions.",
    status: "pending_signature",
    status_label: "Awaiting Signature",
    address: "123 Portal Lane, Austin, TX 78701",
    contractor_name: "Casey Contractor",
    agreement_id: AGREEMENT_ID,
    agreement_token: AGREEMENT_TOKEN,
    agreement_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
    total_cost: "6000.00",
    milestones,
    updates: [
      {
        id: "portal-update-1",
        title: "Agreement ready for review",
        message: "Casey Contractor sent the agreement for review and signature.",
        action_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
        created_at: "2026-05-01T15:10:00Z",
      },
    ],
  };

  return {
    customer: {
      name: "Pat Customer",
      email: "pat.customer@example.com",
    },
    account: {
      email: "pat.customer@example.com",
      has_user: true,
      has_usable_password: true,
      portal_token: PORTAL_TOKEN,
    },
    summary: {
      active_requests: 0,
      active_projects: includeProject ? 1 : 0,
      bids_received: 0,
      active_agreements: includeProject ? 1 : 0,
      payments: 0,
      documents: 1,
    },
    property_profile: {
      id: 17,
      customer_email: "pat.customer@example.com",
      display_name: "Portal Lane Home",
      property_type_label: "Single Family",
      address_line1: "123 Portal Lane",
      city: "Austin",
      state: "TX",
      postal_code: "78701",
      documents: [],
      photos: [],
    },
    property_profiles: [],
    projects: includeProject ? [project] : [],
    requests: [],
    bids: [],
    agreements: includeProject
      ? [
          {
            id: AGREEMENT_ID,
            title: "Kitchen & Hall LVP Installation",
            project_title: "Kitchen & Hall LVP Installation",
            status: "sent",
            status_label: "Awaiting Signature",
            payment_mode: "Escrow (Milestone Hold)",
            agreement_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
            linked_agreement_token: AGREEMENT_TOKEN,
            warranty_text: "One-year workmanship warranty on flooring installation labor.",
          },
        ]
      : [],
    payments: [],
    documents: includeProject
      ? [
          {
            id: "agreement-doc-1",
            title: "Agreement draft",
            type_label: "Agreement",
            filename: "kitchen-hall-lvp-agreement.pdf",
            url: `/agreements/magic/${AGREEMENT_TOKEN}`,
            agreement_id: AGREEMENT_ID,
          },
        ]
      : [],
    notifications: includeProject
      ? [
          {
            id: "notice-1",
            title: "Agreement ready for review",
            message: "Review and sign your Kitchen & Hall LVP Installation agreement.",
            is_read: false,
            action_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
            created_at: "2026-05-01T15:10:00Z",
          },
        ]
      : [],
  };
}

async function installGoldenPathRoutes(page) {
  let agreement = makeAgreement();
  const events = {
    sendCalls: [],
    patchPayloads: [],
    agreementGetCalls: [],
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("access", "playwright-access-token");
  });

  await page.route("**/api/projects/whoami/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 900,
        type: "contractor",
        role: "contractor_owner",
        email: "casey.contractor@example.com",
      }),
    });
  });

  await page.route("**/api/payments/onboarding/status/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        onboarding_status: "complete",
        connected: true,
        charges_enabled: true,
        payouts_enabled: true,
      }),
    });
  });

  await page.route("**/api/projects/contractors/me/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 77,
        business_name: "Casey Contractor",
        ai: { access: "included", enabled: true, unlimited: true },
      }),
    });
  });

  await page.route("**/api/projects/homeowners/501/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: 501,
        full_name: "Pat Customer",
        email: "pat.customer@example.com",
        phone_number: "555-0101",
      }),
    });
  });

  await page.route("**/api/projects/homeowners**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            id: 501,
            full_name: "Pat Customer",
            email: "pat.customer@example.com",
          },
        ],
      }),
    });
  });

  await page.route("**/api/projects/project-types/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ id: 1, value: "Flooring", label: "Flooring", owner_type: "system" }],
      }),
    });
  });

  await page.route("**/api/projects/project-subtypes/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{ id: 11, value: "Luxury Vinyl Plank", label: "Luxury Vinyl Plank", parent: 1 }],
      }),
    });
  });

  await page.route("**/api/projects/templates/recommend/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ confidence: "none", tier: "no_useful_match", candidates: [] }),
    });
  });

  await page.route("**/api/projects/templates/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/?(\\?.*)?$`),
    async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        events.agreementGetCalls.push(request.url());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(agreement),
        });
        return;
      }

      if (request.method() === "PATCH") {
        const payload = { ...request.postDataJSON() };
        events.patchPayloads.push(payload);
        for (const key of ["project_title", "title", "project_type", "project_subtype", "description"]) {
          if (
            payload[key] == null ||
            payload[key] === "" ||
            payload[key] === "Untitled Project" ||
            payload[key] === "Draft Agreement"
          ) {
            delete payload[key];
          }
        }
        agreement = { ...agreement, ...payload };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(agreement),
        });
        return;
      }

      await route.fallback();
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/send_signature_request/?(\\?.*)?$`),
    async (route) => {
      if (route.request().method() === "POST") {
        events.sendCalls.push(route.request().url());
        agreement = makeAgreement({
          status: "sent",
          workflow_status: "sent",
          signature_request_sent: true,
          signature_request_sent_at: "2026-05-01T15:10:00Z",
          agreement_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
          public_access_token: AGREEMENT_TOKEN,
        });
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          agreement,
          sign_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/funding_preview/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          project_amount: 6000,
          homeowner_escrow: 6000,
          contractor_payout: 5700,
          platform_fee: 300,
          escrow_funded: false,
          rate: 0.05,
          flat_fee: 1,
          fee_cap: 750,
        }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/preview_link/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: `/api/projects/agreements/${AGREEMENT_ID}/preview_pdf/?stream=1` }),
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/preview_pdf/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF",
      });
    }
  );

  await page.route(
    new RegExp(`/api/projects/agreements/${AGREEMENT_ID}/mark_previewed/?(\\?.*)?$`),
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, agreement }),
      });
    }
  );

  await page.route(/\/api\/projects\/milestones\/?(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: milestones }),
    });
  });

  await page.route("**/api/projects/subaccounts/", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route("**/api/projects/warranties/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: [] }),
    });
  });

  await page.route(`**/api/agreements/access/${AGREEMENT_TOKEN}/`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        makeAgreement({
          status: "sent",
          workflow_status: "sent",
          signature_request_sent: true,
          signature_request_sent_at: "2026-05-01T15:10:00Z",
          signed_by_homeowner: false,
          homeowner_signed: false,
          signature_is_satisfied: false,
          is_fully_signed: false,
          agreement_url: `/agreements/magic/${AGREEMENT_TOKEN}`,
        })
      ),
    });
  });

  await page.route("**/api/projects/customer-portal/**", async (route) => {
    const requestUrl = route.request().url();
    const method = route.request().method();

    if (method === "GET" && requestUrl.includes(`/customer-portal/${PORTAL_TOKEN}/`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makePortalPayload({ includeProject: true })),
      });
      return;
    }

    if (method === "GET" && requestUrl.includes(`/customer-portal/${OTHER_PORTAL_TOKEN}/`)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(makePortalPayload({ includeProject: false })),
      });
      return;
    }

    await route.fallback();
  });

  return events;
}

async function clickStableButton(page, name) {
  const button = page.getByRole("button", { name });
  await expect(button.first()).toBeVisible();
  await expect(button.first()).toBeEnabled();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await button.first().click({ timeout: 3000 });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await page.waitForTimeout(300);
    }
  }
}

test("contractor agreement golden path reaches homeowner review and portal next action", async ({ page }) => {
  const events = await installGoldenPathRoutes(page);

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=1`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("agreement-wizard-heading")).toBeVisible();
  await expect.poll(() => events.agreementGetCalls.length).toBeGreaterThan(0);
  await expect(page.getByText("Kitchen & Hall LVP Installation").first()).toBeVisible();
  await expect(page.getByText("Flooring").first()).toBeVisible();
  await expect(page.getByText("Luxury Vinyl Plank").first()).toBeVisible();

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=2`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("step2-milestone-card-list")).toBeVisible();
  await expect(page.getByTestId("step2-milestone-card-list")).toContainText("Material Prep");
  await expect(page.getByTestId("step2-milestone-card-list")).toContainText("Flooring Installation");

  await page.goto(`/app/agreements/${AGREEMENT_ID}/wizard?step=4`, { waitUntil: "domcontentloaded" });
  if ((await page.getByTestId("step4-summary-agreement").count()) === 0) {
    await page.getByRole("button", { name: "Step 4 Finalize" }).click();
  }
  await expect(page.getByTestId("step4-summary-agreement")).toBeVisible();
  await clickStableButton(page, "Send to Customer");
  await expect.poll(() => events.sendCalls.length).toBe(1);
  await expect(page.getByTestId("step4-customer-send-success")).toBeVisible();
  await expect(page.getByTestId("step4-copy-customer-link-button")).toBeEnabled();

  await page.evaluate(() => {
    window.localStorage.removeItem("access");
    window.localStorage.removeItem("refresh");
  });

  await page.goto(`/agreements/magic/${AGREEMENT_TOKEN}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Kitchen & Hall LVP Installation" })).toBeVisible();
  await expect(page.getByText("Payment Mode")).toBeVisible();
  await expect(page.getByText("Escrow (Milestone Hold)")).toBeVisible();
  await expect(page.getByText("Protected", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign", exact: true })).toBeVisible();

  await page.goto(`/portal/${PORTAL_TOKEN}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-portal-summary")).toBeVisible();
  await expect(page.getByTestId("customer-portal-summary-agreements")).toContainText("1");
  await page.getByTestId("customer-dashboard-tab-projects").click();
  await expect(page.getByTestId("customer-projects-navigation")).toContainText("Kitchen & Hall LVP Installation");
  await expect(page.getByTestId("customer-rich-project-workspace")).toContainText("Awaiting Signature");
  await expect(page.getByTestId("customer-rich-project-workspace")).toContainText("Agreement ready for review");
  await expect(page.getByRole("link", { name: /Open Agreement/i }).first()).toHaveAttribute(
    "href",
    `/agreements/magic/${AGREEMENT_TOKEN}`
  );

  await page.goto(`/portal/${OTHER_PORTAL_TOKEN}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("customer-portal-summary-agreements")).toContainText("0");
  await expect(page.getByText("Kitchen & Hall LVP Installation")).toHaveCount(0);
});
