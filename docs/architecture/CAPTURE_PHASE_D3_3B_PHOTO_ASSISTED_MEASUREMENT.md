# Capture Phase D.3.3B: Calibrated Photo-Assisted Measurement

## Purpose and boundaries

This phase derives reviewable estimates from a photograph containing a
user-confirmed known reference. It extends Capture artifacts, Measurement
Sessions, Measurement Entries/Results, and Intelligent Takeoff. It does not
provide reference-free measurement, computer-vision interpretation, or
fabrication-grade accuracy.

```text
Photo CaptureArtifact -> normalized private preview -> known-reference
calibration -> line/polyline/polygon annotation -> Measurement proposal ->
existing verification -> existing Takeoff -> existing Estimate preview
```

## Image normalization and privacy

JPEG, PNG, and WebP are supported. The original artifact remains immutable.
Pillow verifies the source, enforces byte/dimension/pixel limits, applies EXIF
orientation, and emits a private derived preview without EXIF. GPS metadata is
therefore removed. Original and normalized dimensions, EXIF orientation,
transform name, and original SHA-256 checksum remain as bounded provenance.
Neither image bytes nor EXIF/device identifiers are written to telemetry.

## Coordinates, calibration, and calculations

Geometry uses normalized coordinates against the normalized image. It is
independent of CSS sizing, zoom, DPR, and mobile orientation. Pointer
coordinates are converted in one frontend utility; the server converts them
back to normalized-image pixels.

The required calibration is a two-point known reference. The user enters its
actual length and explicitly attests that the reference and intended target are
on the same physical plane. The attestation is evidence, not verification.
Automatic marker detection and assumed object sizes are prohibited. The model
reserves a bounded marker-version field for future manual marker work.

The server recalculates Euclidean line/polyline length and polygon shoelace area
and perimeter using Decimal arithmetic and `photo_geometry.v1`. Geometry,
self-intersection, range, unit, checksum, version, calibration, and ownership
checks are authoritative on the server.

## Confidence, perspective, and verification

Photo results use low, medium, high-estimate, and verified vocabulary, but a
photo alone never becomes verified. Initial deterministic evidence covers
known-reference validity, orientation normalization, same-plane attestation,
and server recalculation. Warnings cover small references, image edges,
reference/target distance, perspective, and field verification.

Low-confidence results cannot create an eligible proposal. Medium and
high-estimate results enter Measurement as `needs_verification`. Physical tape
or laser evidence and existing authorized verification remain downstream
requirements. The photo estimate is never overwritten by a later verified
observation.

## Repeated measurements

Annotations can share a repeat group. The server exposes minimum, maximum,
mean, absolute spread, and relative spread. It never averages conflicting
attempts silently. Relative spread above
`MEASUREMENT_PHOTO_REPEAT_VARIANCE_THRESHOLD` produces an audit event, warning,
and low-confidence cap. The threshold is configurable and provisional pending
an empirical accuracy study.

## Permissions, security, and APIs

Existing project/Capture capabilities govern every operation. Files are served
only through authenticated, contractor-scoped endpoints. Cross-contractor and
forged artifact access fails with a non-enumerating response.

```text
GET/POST /api/projects/measurement-photo-documents/
GET      /api/projects/measurement-photo-documents/:id/
GET      /api/projects/measurement-photo-documents/:id/image/
POST     /api/projects/measurement-photo-documents/:id/calibrations/
POST     /api/projects/measurement-photo-documents/:id/annotations/
POST     /api/projects/measurement-photo-annotations/:id/repeat/
POST     /api/projects/measurement-photo-annotations/:id/archive/
POST     /api/projects/measurement-photo-annotations/:id/create-proposal/
```

Backend and frontend flags are respectively
`MEASUREMENT_PHOTO_ASSISTED_ENABLED` and
`VITE_MEASUREMENT_PHOTO_ASSISTED_ENABLED`; both default off.

## Camera, responsive behavior, and accessibility

The first release uses explicit HTML file inputs. `capture="environment"`
offers the platform camera without maintaining a live stream, while ordinary
upload remains universal. Existing eligible Capture images may also be
selected.

The workspace presents a full-width bounded image, mode-explicit scrollable
tool tray, and review surface that stacks on narrow screens. Controls have
keyboard behavior, explicit labels, large touch targets, textual warnings, an
annotation list, and live status announcements.

## Accuracy fixture process

Development validation should record: fixture name, ground truth, estimate,
absolute/relative error, device, resolution, reference type and pixel span,
lighting, user, warnings, and completion time. Required fixtures include a wall
rectangle, door opening, floor rectangle, long run, angled perspective, low
light, edge reference, distant target, repeated placement, and multiple camera
resolutions. Store generated/test fixtures outside production customer data.
Unit tests establish deterministic behavior, not public accuracy claims.

## Known limitations and deferred work

- A single photograph cannot prove scale or coplanarity.
- Perspective, lens distortion, curved surfaces, and depth-varying targets are
  not corrected.
- No automatic endpoints, objects, rooms, walls, markers, or QR scale.
- No AI geometry/arithmetic, Bluetooth, LiDAR, AR, native wrapper, or offline
  synchronization.
- No automatic materials, labor, Takeoff, Estimate, pricing, purchasing, or
  inventory actions.
- Physical device and deployed authenticated browser validation remain release
  preflight work.

## Rollback

Disable both feature flags. APIs fail closed and entry points/routes disappear;
existing photo upload, Measurement, PDF measurement, Takeoff, and Estimate
preview behavior remains available. The additive migration may remain deployed
while disabled.
