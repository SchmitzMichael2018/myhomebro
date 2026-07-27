# Manual Measurement and Calculation Workflow Refinement

## Purpose and positioning

Phase D.3.1R makes manual field dimensions the universal, primary Measurement path:

`manual dimensions → server calculation → review/verification → Intelligent Takeoff → Estimate preview`

The launch action is **Enter Measurements** and an existing Measurement Session offers **Add Measurement**. Plan and photo measurement remain secondary evidence sources. Automatic camera measurement, LiDAR, AR, Bluetooth, external measurement-app imports, AI arithmetic, material selection, and Estimate mutation are outside this phase.

## Repository audit and reused architecture

The implementation reuses `MeasurementSession`, `MeasurementEntry`, `MeasurementAdjustment`, `MeasurementCalculatedResult`, `MeasurementAttachment`, and `MeasurementEvent`; Capture review/application; contractor/project permission checks; private Capture artifacts; and the existing Measurement-to-Takeoff handoff. No new Measurement domain or database migration is introduced.

Before this refinement, the backend already provided Decimal-based US-customary parsing, raw-value preservation, rectangle/wall/opening/volume/linear formulas, repeated-reading warnings, immutable result revisions, photo/PDF provenance, and Takeoff-based waste and Estimate preview. Practical structures for deductions and section adjustments existed in the backend but were poorly exposed. Metric parsing, deduction quantities, negative-net rejection, authoritative pre-save preview, and session append UX were missing. The generic form exposed every dimension instead of guiding a practical calculation.

Waste was not found in Measurement calculation persistence. It remains in Takeoff; historical records are not reinterpreted.

## Supported profiles

- `linear_measurement`: one length; normalized and total linear length.
- `rectangle`: length × width; gross/net area and perimeter.
- `wall_with_deductions`: wall length × height; bounded door, window, opening, cabinet, or custom deductions with width, height, and integer quantity; gross, excluded, and net area.
- `multi_section_area`: 1–24 stable, unique section keys; explicit add/subtract; per-section length × width; positive area, excluded area, and net area.
- Existing rectangular room, wall, opening, linear run, rectangular volume, and repeated-reading behavior remain compatible.

The first section of a multi-section area must add area. There are at most 24 sections and 24 wall deductions. Labels and keys are bounded. Zero dimensions and negative net area are rejected. Reordering does not affect aggregation.

## Dimension parsing and calculation ownership

Raw input remains on each `MeasurementEntry`. The server parses feet, inches, construction fractions, decimal feet/inches, meters, centimeters, and millimeters into Decimal inches. Examples include `12`, `12 ft`, `12'`, `12 ft 6 in`, `12 1/2 ft`, `150 in`, and `3.81 m`. Malformed, negative, zero, unsupported-fraction, and excessive deduction inputs fail validation.

The browser requests a debounced preview, clears stale results when input changes, and announces recalculation through an `aria-live` region. That response is authoritative before save. The calculation version is `2`; stored normalized values retain precision while display quantities use existing two-decimal conventions. AI does not participate in arithmetic.

## Source and verification

The bounded UI contract maps product labels onto existing provenance fields:

| Product label | Existing source | Verification |
|---|---|---|
| Field verified | manual entry | verified |
| Approximate | manual entry | estimated |
| Manual laser reading | laser manual entry | verified |
| From plan | existing plan | needs verification |
| Photo estimate | photo reference | estimated |

This avoids a second confidence system. Verified entries record the acting user and timestamp. Plan/photo restrictions and source provenance remain intact.

## API and revisions

`POST /api/projects/measurements/manual-preview/` validates project scope and returns normalized entries, adjustments, calculations, warnings, and Takeoff eligibility without persistence.

`POST /api/projects/measurements/{session_id}/` requires the current `version`, repeats server validation/calculation, and appends entries, adjustments, results, and an audit event as the next revision. A stale version returns `409 version_conflict`. Existing results are not updated or deleted, including confirmed or downstream-used revisions. No Takeoff or Estimate is mutated by either endpoint.

The original Capture workflow consumes the same preview-generated canonical entries and adjustments, then repeats validation during Capture processing. Supporting image/PDF artifacts remain private and project-scoped through Capture.

## Measured quantity, Takeoff, and Estimate boundary

Measurement stores physical evidence and deterministic measured quantity only. Waste, coverage, package rounding, product selection, pricing, markup, tax, and estimate quantity remain Takeoff responsibilities. The session displays **Create Takeoff** only through the existing Takeoff flag and workflow. Estimate preview remains reviewable and does not directly insert or update Estimate records.

## UX, responsive behavior, and accessibility

The manual form progressively reveals fields for the selected profile. At narrow widths, all dimension, deduction, and section controls stack; inputs use large touch targets and numeric keyboards, and save actions remain visible. It has no table or drag dependency and retains React state across responsive changes.

Every input has an explicit programmatic label, add/remove actions are keyboard operable, populated section/deduction removal asks for confirmation, add/subtract is textual, verification is not color-only, and server calculation updates are announced. The layout is designed for 320 px, 375 px, tablet, and desktop.

## Permissions, flags, and rollback

Both endpoints reuse `can_create_project_capture`, enforcing authenticated contractor/project scope server-side. Manual entry remains under `CAPTURE_MEASUREMENT_ENABLED`; it does not depend on PDF, photo, Takeoff, Bluetooth, or automatic-measurement flags.

Rollback consists of reverting the UI/editor, URL/view additions, manual service, and calculation-version/parser changes. There is no schema rollback. Appended versioned evidence remains readable by the pre-refinement serializers.

## Tests and known limitations

Focused tests cover customary and metric parsing, fraction/decimal safety, linear and rectangle calculations, wall deduction quantity, excessive deductions, mixed multi-section aggregation, calculation version, raw evidence behavior, immutable session append, stale-version rejection, and absence of Estimate writes. Existing Measurement, PDF/photo, Capture, Takeoff, and Estimate-preview suites provide regression coverage.

This phase does not provide direct editing/removal of prior session evidence; corrections append a revision. Existing Capture artifacts can support the initial manual Capture, while adding a new artifact directly inside the session append modal remains deferred to a dedicated artifact-association endpoint. Specialized volume/opening workflows remain available through existing paths rather than the primary four-profile form.

Automatic/reference-free camera measurement, room recognition, LiDAR/AR/WebXR, Bluetooth/native integrations, external-app imports, fabrication guarantees, purchasing, inventory, labor calculation, and direct Estimate insertion are deliberately deferred.
