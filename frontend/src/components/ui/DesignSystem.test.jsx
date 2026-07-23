import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AIActionButton,
  AIActionReceipt,
  AIErrorState,
  AIReviewCard,
  AIUnavailableState,
  Button,
  canonicalStatuses,
  DataTable,
  EmptyState,
  FormField,
  InlineAlert,
  LoadingSkeleton,
  SettingsSection,
  StatusBadge,
  WorkspacePageHeader,
  WorkspaceStepNavigation,
} from "./index.js";

function markup(element) {
  return renderToStaticMarkup(element);
}

describe("MyHomeBro design-system foundation", () => {
  it("renders every canonical status with accessible text", () => {
    canonicalStatuses.forEach((status) => {
      const html = markup(<StatusBadge status={status} />);
      expect(html).toContain(status[0].toUpperCase() + status.slice(1));
      expect(html).toContain("rounded-full");
    });
  });

  it("standardizes button variants, focus, disabled, and loading states", () => {
    const primary = markup(<Button variant="primary">Save</Button>);
    const disabled = markup(<Button disabled>Save</Button>);
    const loading = markup(<Button loading loadingLabel="Saving...">Save</Button>);
    const ai = markup(<AIActionButton>Review with Project Assistant</AIActionButton>);

    expect(primary).toContain("focus-visible:ring-2");
    expect(primary).toContain("bg-blue-600");
    expect(disabled).toContain("disabled");
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Saving...");
    expect(ai).toContain("bg-indigo-600");
  });

  it("supports the operational theme without changing component semantics", () => {
    const button = markup(<Button theme="operational">Open</Button>);
    const badge = markup(<StatusBadge theme="operational" status="pending" />);
    const empty = markup(<EmptyState theme="operational" title="All caught up" />);
    const loading = markup(<LoadingSkeleton theme="operational" label="Loading dashboard" />);
    const header = markup(<WorkspacePageHeader theme="operational" title="Dashboard" />);

    expect(button).toContain("bg-[var(--mhb-interactive-primary)]");
    expect(button).toContain("focus-visible:ring-[var(--mhb-border-focus)]");
    expect(badge).toContain("Pending");
    expect(badge).toContain("bg-[var(--mhb-status-pending-bg)]");
    expect(empty).toContain("bg-[var(--mhb-surface-card)]");
    expect(loading).toContain("bg-[var(--mhb-skeleton)]");
    expect(header).toContain("text-[var(--mhb-text-primary)]");
  });

  it("renders intentional loading and empty states", () => {
    const loading = markup(<LoadingSkeleton variant="table" label="Loading agreements" />);
    const empty = markup(<EmptyState title="No agreements" description="Create the first agreement." tips={["Confirm the customer"]} />);

    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-label="Loading agreements"');
    expect(empty).toContain("No agreements");
    expect(empty).toContain("Confirm the customer");
  });

  it("connects form labels, required state, helper text, and errors", () => {
    const helper = markup(
      <FormField label="Business name" htmlFor="business-name" required helperText="Shown to customers.">
        {(fieldProps) => <input {...fieldProps} />}
      </FormField>
    );
    const error = markup(
      <FormField label="Business name" htmlFor="business-name" error="Enter a business name.">
        {(fieldProps) => <input {...fieldProps} />}
      </FormField>
    );

    expect(helper).toContain('for="business-name"');
    expect(helper).toContain('required=""');
    expect(helper).toContain('aria-describedby="business-name-help"');
    expect(error).toContain('aria-invalid="true"');
    expect(error).toContain('role="alert"');
  });

  it("renders workspace headers and step navigation with semantic landmarks", () => {
    const header = markup(
      <WorkspacePageHeader
        title="Agreements"
        breadcrumbs={[{ label: "Dashboard", href: "/app/dashboard" }, { label: "Agreements" }]}
        status="draft"
        onOpenProjectAssistant={() => {}}
      />
    );
    const steps = markup(
      <WorkspaceStepNavigation
        activeStep="details"
        steps={[
          { id: "details", label: "Details" },
          { id: "review", label: "Review", complete: true },
        ]}
      />
    );

    expect(header).toContain('aria-label="Breadcrumb"');
    expect(header).toContain("<h1");
    expect(header).toContain("Project Assistant");
    expect(steps).toContain('aria-current="step"');
    expect(steps).toContain('aria-label="Workspace progress"');
  });

  it("renders table captions, sorting, selection, statuses, pagination, loading, and empty states", () => {
    const table = markup(
      <DataTable
        caption="Current agreements"
        selectable
        selectedKeys={[1]}
        columns={[
          { key: "title", header: "Agreement", sortable: true },
          { key: "status", header: "Status", status: true },
        ]}
        rows={[{ id: 1, title: "Kitchen Remodel", status: "pending" }]}
        pagination={{ page: 1, hasPrevious: false, hasNext: true }}
      />
    );
    const loading = markup(<DataTable loading loadingLabel="Loading agreements" />);
    const empty = markup(<DataTable />);
    const operational = markup(
      <DataTable
        theme="operational"
        columns={[{ key: "name", header: "Customer" }]}
        rows={[{ id: 1, name: "Taylor Home" }]}
      />
    );

    expect(table).toContain("<caption");
    expect(table).toContain("Current agreements");
    expect(table).toContain('aria-label="Select all rows"');
    expect(table).toContain("Pending");
    expect(table).toContain("Previous");
    expect(loading).toContain("Loading agreements");
    expect(empty).toContain("No records found");
    expect(operational).toContain("bg-[var(--mhb-surface-card)]");
    expect(operational).toContain("bg-[var(--mhb-surface-inset)]");
    expect(operational).toContain("hover:bg-[var(--mhb-table-row-hover)]");
  });

  it("uses safe alert semantics and AI lifecycle presentation", () => {
    const danger = markup(<InlineAlert tone="danger" title="Could not save">Your work was not changed.</InlineAlert>);
    const operationalWarning = markup(<InlineAlert theme="operational" tone="warning">Review this record.</InlineAlert>);
    const operationalSettings = markup(<SettingsSection theme="operational" title="Preferences">Settings</SettingsSection>);
    const unavailable = markup(<AIUnavailableState />);
    const error = markup(<AIErrorState />);
    const review = markup(<AIReviewCard stage="confirm" preview={<p>Prepared change</p>} onConfirm={() => {}} />);
    const receipt = markup(<AIActionReceipt reference="PA-123" details={["Updated draft"]} />);

    expect(danger).toContain('role="alert"');
    expect(operationalWarning).toContain("--mhb-status-pending-bg");
    expect(operationalSettings).toContain("--mhb-border-divider");
    expect(unavailable).toContain("Project Assistant is unavailable");
    expect(error).toContain("Your work was not changed");
    expect(review).toContain('aria-label="AI action lifecycle"');
    expect(review).toContain('aria-current="step"');
    expect(review).toContain("Confirm and apply");
    expect(receipt).toContain("Receipt: PA-123");
  });
});
