# MyHomeBro Design System Foundation

This document describes the shared UI foundation for gradual workspace modernization. It is governed by [MyHomeBro Engineering Principles](../architecture/MYHOMEBRO_ENGINEERING_PRINCIPLES.md).

The foundation standardizes behavior, semantics, spacing, typography, accessibility, status language, loading, empty states, Project Assistant presentation, and authenticated operational appearance. Operational workspaces support dark and light through shared semantics; Marketing remains a curated-light exception.

## Authenticated Appearance

`AppearanceProvider` is mounted once in `AuthenticatedLayout` and exposes:

```jsx
const { appearance, resolvedTheme, setAppearance } = useAppearance();
```

Canonical saved values are `system`, `light`, and `dark`. Dark is the default for missing or invalid values. The preference is stored in frontend local storage under `myhomebro.appearance.v1`; there is no compatible profile preference field yet. `system` subscribes to `(prefers-color-scheme: dark)` and keeps `system` stored while `resolvedTheme` changes.

`main.jsx` applies the saved/default value before rendering authenticated `/app` routes to avoid a light-theme flash. The DOM contract is:

```html
<html data-mhb-appearance="dark" data-mhb-theme="dark" data-mhb-surface="operational">
```

The authenticated layout uses `data-mhb-surface="curated-light"` for Marketing. This keeps Marketing visually unchanged while preserving the operational preference for Dashboard, Insights, Project Assistant, and other authenticated operational surfaces. Public websites, public intake, customer-facing pages, PDFs, and email templates are not themed by this system.

Do not create page-specific providers, local-storage reads, theme toggles, or hard-coded chart theme branches. Use the shared provider and semantic tokens. New operational components must render in both resolved themes and set native `color-scheme` correctly.

### Semantic appearance tokens

The token foundation includes:

- surfaces: app, header, sidebar, card, elevated, subtle, inset, overlay;
- text: primary, secondary, muted, inverse, link;
- borders: default, strong, divider, selected, focus;
- interactions: primary, primary hover, secondary, ghost hover, disabled;
- statuses: Complete, Recommended, Required, Blocked, Pending, Draft, Published;
- charts: background, grid, text, tooltip, positive, negative, neutral.

Insights is part of the operational system. Recharts axes, grid lines, series, legends, and tooltips must derive their colors from these tokens rather than fixed light values.

## Operational Theme Philosophy

Operational Dark is the canonical contractor workspace appearance. It is a durable product surface for concentrated business work, not a transitional treatment or a derivative of Marketing. Operational Light uses the same hierarchy and semantics, while Marketing remains its own curated-light workspace.

The interface should feel like a calm business operating system. Visual depth comes from small differences in surfaces, borders, and elevation—not saturated backgrounds, glass effects, or decorative hero treatments.

### Surface hierarchy

Use the narrowest semantic layer that describes the content:

1. `surface-app` is the authenticated application background.
2. `surface-workspace` contains a page or major workspace region.
3. `surface-workspace-elevated` separates high-level workspace panels.
4. `surface-card` contains ordinary grouped content.
5. `surface-card-elevated` supports menus, dialogs, and priority panels.
6. `surface-interactive` and `surface-interactive-hover` are for clickable cards and rows.
7. `surface-selected` identifies selected navigation, tabs, or rows with a border or state marker.

Cards use `shadow-card`; menus, dialogs, and priority panels use `shadow-card-elevated`. Interactive elevation is reserved for hoverable surfaces and must not make static cards appear clickable.

### Background treatment

The operational application background may use one very subtle radial illumination and a very-low-opacity engineering grid or contour treatment. Texture must remain fixed, non-animated, subordinate to content, and imperceptible behind dense text. It must never be applied to Marketing, public websites, customer pages, PDFs, or email output.

Do not use large gradients, bright blue page backgrounds, glassmorphism, particles, animation, heavy textures, or marketing-style hero backgrounds. Workspace and card surfaces remain predominantly solid so tables, forms, and charts retain clear contrast.

Chart canvases use the chart background token. Tooltips use elevated surfaces; axes, legends, and grid lines use chart semantic tokens. Bright white chart canvases are not permitted in Operational Dark.

### Operational Light

Operational Light is a first-class contractor appearance, not an inversion of Dark and not a copy of Marketing. It keeps the dark navy sidebar as the application anchor, then moves through a cool gray-blue application background, a lighter workspace, clean neutral cards, elevated menus and dialogs, and clearly bordered interactive surfaces.

- Cards and pipeline rows remain neutral. Domain color belongs in badges, compact icon containers, left rails, and small borders—not full-card pastel fills.
- Primary actions use controlled MyHomeBro blue. Secondary and ghost actions use neutral surfaces with visible boundaries. Project Assistant actions use the shared AI semantic tokens without introducing a second product identity.
- Forms use a white control surface, visible blue-gray borders, dark text, readable placeholders, and an explicit focus ring.
- Tables use a neutral card surface, a distinct inset header, visible dividers, and semantic hover/selection surfaces without default zebra striping.
- Light chart canvases use a connected near-white surface, blue-gray grid lines, dark labels, and a bordered elevated tooltip.
- Empty states use neutral inset surfaces. Loading skeletons use the dedicated skeleton token so they remain visible against white cards.
- Routine activity history remains neutral; success, warning, and critical colors are compact signals rather than alert-sized fills.
- Today’s Priorities must retain exactly one attached accent rail: Critical rose, Today blue, Soon amber, and Growth green.

Light backgrounds may use extremely soft radial illumination, but not the Dark engineering grid at visible strength. Depth must primarily come from semantic surfaces, borders, restrained shadows, and spacing.

Every Operational Light change requires a Dark regression check. Light compatibility selectors must be scoped to `data-mhb-theme="light"` and `data-mhb-surface="operational"` and must not override semantic rails, chart series, statuses, or Marketing’s curated-light boundary.

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

Shared visual primitives accept `theme="operational"` where an operational surface requires theme-aware text, borders, focus rings, statuses, and loading geometry. This changes presentation only; component semantics and behavior remain identical.

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

The token names are semantic and are resolved by the authenticated Appearance system for System, Light, and Dark. Operational components must consume these contracts rather than introducing page-specific theme state or hard-coded dark/light branches.

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

## Controlled Workspace Migration Notes

The remaining-workspace migration established several implementation rules:

- Use `ContractorPageSurface` as the authenticated operational boundary. Its header reserves room for global Project Assistant and Appearance controls at narrow desktop widths.
- Pass `theme="operational"` to shared cards, metrics, alerts, loading states, settings sections, navigation, toolbars, and menus inside the authenticated console. These components resolve Dark, Light, and System through semantic tokens.
- Preserve domain labels and workflow states. Shared status styling must not collapse states such as Funded, Awaiting Review, Payment Pending, Disputed, or Resolved.
- Keep workflow-heavy surfaces specialized when their behavior warrants it. Agreement Wizard, resolution evidence, expense reserves, customer portal, public intake, and admin operations should adopt shared boundaries and controls without being rebuilt as generic cards or forms.
- Customer-facing and public surfaces retain their distinct density and visual identity. Reuse accessibility and interaction primitives without applying contractor-console information density.
- Extend primitives backward-compatibly. The operational variants on `InlineAlert`, `SettingsSection`, `WorkspacePageHeader`, `FilterToolbar`, `WorkspaceStepNavigation`, and `ActionMenu` leave existing default consumers unchanged.
- Prefer role- or heading-based test selectors with exact names when a shared global surface can legitimately repeat visible terminology.
