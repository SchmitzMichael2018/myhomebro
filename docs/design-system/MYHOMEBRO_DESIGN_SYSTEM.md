# MyHomeBro Design System Foundation

This document describes the shared UI foundation for gradual workspace modernization. It is governed by [MyHomeBro Engineering Principles](../architecture/MYHOMEBRO_ENGINEERING_PRINCIPLES.md).

The foundation standardizes behavior, semantics, spacing, typography, accessibility, status language, loading, empty states, and Project Assistant presentation. It does not impose one color palette across the platform. Operational workspaces remain intentionally dark; Marketing may remain lighter.

## Importing Components

Import public primitives from the stable barrel:

```jsx
import {
  Button,
  Card,
  StatusBadge,
  WorkspacePageHeader,
} from "@/components/ui";
```

Design tokens are loaded once by `main.jsx` from `styles/design-tokens.css`. Components use semantic Tailwind classes today while the variables establish a future theme boundary. New theme work should change semantic tokens rather than fork component behavior.

## Existing Components Formalized

### Modal

Purpose: accessible, portal-based modal behavior with focus trapping, Escape handling, overlay dismissal, and scroll locking.

Use for: blocking dialogs and focused review workflows.

Do not use for: ordinary page sections, lightweight tooltips, or navigation.

Migration guidance: replace local modal shells only after verifying sizing, focus return, nested overlays, and mobile behavior.

### ToggleSwitch

Purpose: an accessible `role="switch"` control with label, description, checked state, disabled state, and keyboard-compatible button behavior.

Use for: immediate binary settings.

Do not use for: multi-option choices, irreversible actions, or settings that require a separate save without clearly communicating that behavior.

### Project Assistant presentation

The existing `ProjectAssistantExperience` components remain valid for current consumers. The new AI primitives complement them with a standard mutation lifecycle and must not change Project Assistant behavior.

## Foundation Primitives

### WorkspacePageHeader

Purpose: consistent workspace title hierarchy with subtitle, status, breadcrumbs, summary, primary and secondary actions, and an optional Project Assistant entry.

```jsx
<WorkspacePageHeader
  title="Agreements"
  subtitle="Create, review, and manage customer agreements."
  status="draft"
  breadcrumbs={[{ label: "Dashboard", href: "/app/dashboard" }, { label: "Agreements" }]}
  primaryAction={<Button>New agreement</Button>}
  onOpenProjectAssistant={openAssistant}
/>
```

Do not use inside cards or as a replacement for compact section headings.

### Button

Purpose: one interaction contract for primary, secondary, ghost, danger, icon, and AI actions.

Supports: `sm`, `md`, and `lg` sizes; start/end icons; disabled, loading, hover, and visible focus states.

```jsx
<Button variant="primary">Save changes</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="danger">Delete draft</Button>
<Button variant="icon" aria-label="More actions"><MoreHorizontal /></Button>
```

Use one primary button per decision point. Icon buttons require an accessible name. Do not use danger styling for ordinary cancellation.

### Card

Purpose: neutral content surface with consistent border, radius, padding, and elevation.

Supports: `none`, `sm`, `md`, and `lg` padding plus opt-in interactive treatment.

Do not make a Card interactive unless the entire surface has one clear action and correct keyboard semantics.

### MetricCard

Purpose: compact metric presentation with label, value, optional icon, context, trend, and canonical status.

Do not use for long explanations, unrelated actions, or values that are not meaningful without a table.

### StatusBadge

Purpose: one canonical status vocabulary:

- Complete
- Recommended
- Required
- Blocked
- Pending
- Draft
- Published

Use `status` for semantics and `label` only when a domain needs clearer user-facing wording. Do not infer business state from color alone.

### FilterToolbar

Purpose: predictable placement for search, filters, active-filter chips, and table-level actions.

Do not put record-level actions or unrelated page navigation in the toolbar.

### EmptyState

Purpose: intentional no-data guidance with title, description, icon, one primary action, optional secondary action, and concise tips.

```jsx
<EmptyState
  title="No agreements yet"
  description="Create the first agreement when the project scope is ready."
  primaryAction={<Button>New agreement</Button>}
  tips={["Confirm the customer", "Review the project scope"]}
/>
```

Do not use an empty state while content is loading or when an error prevented loading.

### LoadingSkeleton

Purpose: stable loading geometry for cards, metrics, forms, lists, tables, and workspaces.

Use an accurate preset and accessible loading label. Do not show empty-state copy until loading has completed.

### InlineAlert

Purpose: contextual information, success, warning, or error feedback with optional actions.

Danger alerts use `role="alert"`; other tones use `role="status"`. Do not expose raw provider or server errors.

### FormSection

Purpose: group related form controls under one heading, description, and optional section action.

Do not split every field into its own section or hide domain validation inside the visual wrapper.

### FormField

Purpose: associate a label, required indicator, helper text, validation message, and accessible control attributes.

```jsx
<FormField label="Business name" required helperText="Shown to customers.">
  {(fieldProps) => <input {...fieldProps} className="..." />}
</FormField>
```

Use the render function when the field needs generated `id`, `required`, `aria-invalid`, and `aria-describedby` attributes. Server validation remains authoritative.

### ActionMenu

Purpose: accessible overflow menu for low-frequency record actions.

Supports controlled and uncontrolled open state, disabled items, icons, and danger text. Do not hide the primary record action in an overflow menu.

### WorkspaceStepNavigation

Purpose: consistent horizontal workflow progress with active, complete, available, and disabled steps.

Use for real workflow stages. Do not use as decorative tabs or allow navigation to bypass required validation.

### DataTable

Purpose: reusable responsive table foundation.

Supports:

- Toolbars and filters
- Controlled sorting
- Row selection and bulk actions
- Row overflow menus
- Pagination
- Status badge cells
- Loading skeletons
- Empty states
- Accessible captions and checkbox labels

```jsx
<DataTable
  caption="Current agreements"
  columns={[
    { key: "title", header: "Agreement", sortable: true },
    { key: "status", header: "Status", status: true },
  ]}
  rows={agreements}
  sort={sort}
  onSortChange={setSort}
  pagination={pagination}
/>
```

Keep sorting, filtering, authorization, and business rules in the owning page or service. Do not force card-like mobile layouts into this foundation until a workspace migration defines that contract.

### SettingsSection

Purpose: consistent settings grouping with heading, description, section actions, and content.

Do not use for general dashboard cards or unrelated settings bundled for visual convenience.

## Project Assistant and AI Primitives

Project Assistant remains the only AI product identity.

### AIActionButton

Purpose: identify an action that opens or requests Project Assistant work. It preserves standard button loading, disabled, focus, and sizing behavior.

Do not use AI styling for deterministic actions merely to make them prominent.

### AISuggestionCard

Purpose: present an advisory suggestion with context, confidence text, review, and dismissal.

Do not apply the suggestion automatically from this card.

### AIReviewCard

Purpose: show the shared lifecycle—Prepare, Preview, Validate, Confirm, Apply, Receipt—and provide explicit review and confirmation controls.

The owning workflow supplies preview data, validation, permission checks, apply behavior, and receipt persistence.

### AIUnavailableState

Purpose: contractor-friendly degradation when Project Assistant is unavailable while preserving manual workflow guidance.

### AIErrorState

Purpose: safe error feedback with an optional retry. Pass a curated user-facing message, never a raw provider error.

### AIActionReceipt

Purpose: confirm what was applied and provide a reference for auditability.

Do not use a receipt before a mutation has actually succeeded.

### AIValidationSummary

Purpose: show whether a prepared change passed workflow validation before confirmation.

## Design Tokens

`design-tokens.css` defines:

- Spacing and component rhythm
- Typography size, line-height, and weight
- Border radii and elevation
- Motion duration, easing, and transitions
- Focus and semantic interaction colors
- Canonical status colors
- Button heights
- Form and card spacing

The token names are semantic and theme-ready. This task does not implement an Appearance system. A future system should map Follow System, Light, and Dark themes onto these contracts.

## Migration Guidance

Migrate one workspace at a time:

1. Inventory local buttons, cards, forms, tables, statuses, empty/loading states, and Project Assistant surfaces.
2. Map behavior to a shared primitive before changing markup.
3. Add missing tests for the current workflow.
4. Migrate structure without changing business logic, routing, API behavior, or theme intent.
5. Validate desktop, mobile, keyboard, loading, empty, error, and permission states.
6. Check all consumers before extending a shared primitive.
7. Remove local duplication only after the migrated workflow passes regression tests.

## Recommended Migration Order

1. Dashboard
2. Opportunities
3. Customers
4. Agreements
5. Agreement Wizard
6. Templates
7. Projects
8. Teams
9. Assignments
10. Business Dashboard
11. Payments
12. Customer Portal
13. Admin

This order establishes high-frequency operational patterns first, then applies them to increasingly specialized and permission-sensitive surfaces.
