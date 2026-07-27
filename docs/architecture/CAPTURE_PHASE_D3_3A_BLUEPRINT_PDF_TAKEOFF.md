# Capture Phase D.3.3A: Blueprint and PDF Takeoff

## Product purpose

Phase D.3.3A lets an authorized contractor derive reviewable measurement
proposals from a PDF plan. It is an extension of the Measurement Foundation,
not a plan-specific estimating domain. It does not insert Estimate rows,
interpret drawings with AI, infer scale, or claim fabrication-grade accuracy.

The supported path is:

```text
CaptureArtifact (PDF)
  -> PlanMeasurementDocument
  -> PlanMeasurementCalibration
  -> PlanMeasurementAnnotation
  -> MeasurementEntry or MeasurementCalculatedResult proposal
  -> existing Measurement review and verification
  -> existing Intelligent Takeoff
  -> existing Estimate preview
```

## Architecture and existing-domain relationship

`MeasurementSession` remains the lifecycle and authorization anchor.
`PlanMeasurementDocument`, `PlanMeasurementCalibration`, and
`PlanMeasurementAnnotation` are bounded source/provenance records. Server-owned
proposal creation writes only to the existing Measurement models. Intelligent
Takeoff continues to consume existing confirmed or explicitly provisional
Measurement results and retains the `pdf_plan` lineage.

Plan upload reuses the Measurement Session's Capture and its protected
`CaptureArtifact` storage. Plan files are served only through an authenticated,
contractor-scoped endpoint. Raw storage paths are never returned.

## Feature flags

- Backend: `MEASUREMENT_PDF_ENABLED`, disabled by default
- Frontend: `VITE_MEASUREMENT_PDF_ENABLED`, disabled by default

The backend flag fails closed with the standard non-exposing 404 response. The
frontend flag removes the entry point and direct application route. These flags
are independent from photo, Bluetooth, LiDAR, PWA, and Takeoff flags.

## PDF coordinate model

Geometry is stored as normalized coordinates inside the rendered PDF crop box:
`x` and `y` are bounded Decimals from zero through one. Display transforms
convert between canonical and viewport coordinates for rotations of 0, 90, 180,
and 270 degrees. CSS dimensions, zoom, canvas scale, and device pixel ratio are
never persisted as source geometry.

Each calibration preserves the page rotation and page-box origin, width, and
height used for calculation. The server converts normalized deltas into
canonical PDF-coordinate distances. The browser calculation is only a preview.

## Calibration

A calibration is page-wide or region-bounded and contains a user-drawn
reference line plus a positive known real-world length. Printed scales and OCR
are not trusted. Multiple calibrations may exist; the user explicitly selects
the calibration used for an annotation.

Calibrations preserve document checksum, source dimension label, scale per PDF
point, warnings, creator, version, invalidation, and supersession lineage.
Calibrations used by a saved proposal cannot be destructively invalidated.

Scanned plans can contain perspective, stretch, warp, or nonuniform distortion
that a single linear calibration cannot correct. The interface communicates
this limitation and requires field verification for tolerance-sensitive work.

## Annotation types and calculations

- Line: calibrated Euclidean length
- Polyline: sum of calibrated segment lengths
- Polygon: shoelace area plus closed perimeter
- Count marker: one reviewed occurrence

The backend validates bounded geometry, rejects malformed points and
self-intersecting polygons, applies configured vertex and annotation limits,
and recalculates all values using Decimal arithmetic. Calculation version
`pdf_geometry.v1` is persisted. Client-submitted totals are not accepted.

## Confidence and verification

Plan calculations are created as `high_estimate` when a valid known-dimension
calibration is present. They are not automatically verified. Proposal records
enter Measurement with `needs_verification`; existing verification and Takeoff
eligibility rules remain authoritative. The UI shows evidence and warnings
instead of an unsupported percentage.

Required guidance identifies cabinetry, countertops, glazing, finish carpentry,
structural fabrication, and custom metalwork as requiring field verification.

## Permissions and security

Every endpoint is authenticated and checks existing project/contractor
capability rules. Cross-contractor requests return non-enumerating 404
responses. Artifact IDs, document IDs, calibration IDs, page numbers, versions,
and geometry are treated as untrusted.

Upload safeguards include:

- MIME and `%PDF-` signature validation
- Configurable byte and page-count limits
- PDF parser validation
- Password/encryption rejection
- Capture ownership validation
- Protected file streaming
- Immutable checksum provenance

PDF.js is configured with a dedicated worker, `isEvalSupported: false`, no
external action UI, one-page rendering, stale-task cancellation, and bounded
device-pixel ratio/render dimensions. CSP must continue to permit the
same-origin emitted worker asset; no global policy relaxation is required.

## API

```text
GET/POST /api/projects/measurement-plan-documents/
GET      /api/projects/measurement-plan-documents/:id/
GET      /api/projects/measurement-plan-documents/:id/file/
POST     /api/projects/measurement-plan-documents/:id/calibrations/
POST     /api/projects/measurement-plan-calibrations/:id/invalidate/
POST     /api/projects/measurement-plan-documents/:id/annotations/
POST     /api/projects/measurement-plan-annotations/:id/archive/
POST     /api/projects/measurement-plan-annotations/:id/revise/
POST     /api/projects/measurement-plan-annotations/:id/create-proposal/
```

Document and annotation mutations use optimistic versions. Conflicts return a
stable `version_conflict` code. Proposal creation is repeat-safe for an
annotation and never mutates an Estimate.

## Responsive workspace and accessibility

The workspace uses one primary rendered page, a mode-explicit tool tray, plan
canvas, and review panel. At narrow widths these become a vertically ordered
canvas, horizontally scrollable tool tray, and full-width review surface rather
than a cramped three-column layout.

Controls have accessible labels and minimum touch heights. Tool selection,
page navigation, zoom, undo, cancel, and save are keyboard-accessible. A live
status region announces page rendering and saves. Warnings and confidence use
text rather than color alone. The annotation list is the non-canvas review path.

## Performance and browser expectations

The feature targets current desktop Chromium, Firefox, Safari, Android Chrome,
and iOS Safari within PDF.js support, subject to device memory. It renders only
the active page, caps device-pixel ratio at two, caps a rendered dimension at
4096 pixels, cancels obsolete tasks, and does not preload the full document.
Large PDFs remain subject to the configured byte/page limits.

## Testing

Backend coverage includes the disabled state, upload, parser validation,
calibration, server-owned polygon calculation, stale versions,
self-intersection rejection, cross-contractor denial, proposal lineage,
immutability, and no Estimate mutation.

Frontend coverage includes all supported rotations, responsive-coordinate and
high-DPI independence, malformed coordinates, production bundling, and the
separately emitted PDF worker. Authenticated deployed browser and physical
mobile validation remain release preflight requirements.

## Known limitations

- No OCR scale inference
- No automatic room/wall recognition
- No correction for warped raster scans
- No arbitrary-angle page rotation
- No offline save or PWA synchronization
- No customer/public plan access
- No fabrication-grade accuracy claim
- Region-calibration authoring is supported by the backend contract but the
  initial workspace creates page-wide calibrations
- Annotation point dragging and numeric coordinate editing are not included in
  the initial workspace

## Deferred capabilities

Photo calibration, Bluetooth devices, LiDAR, ARKit, ARCore, WebXR, native
wrappers, OCR assistance, automatic material/labor selection, supplier pricing,
purchasing, checkout, inventory, and public/customer access are out of scope.

## Rollback

Disable both feature flags to remove all entry points and make APIs unavailable.
Existing Measurement, Takeoff, Capture, and Estimate workflows continue without
the feature. The additive migration may remain deployed while disabled. If a
schema rollback is required, first retain/export provenance records, confirm no
Takeoff rows reference derived Measurement results, and then reverse migration
0269 under a controlled maintenance plan.
