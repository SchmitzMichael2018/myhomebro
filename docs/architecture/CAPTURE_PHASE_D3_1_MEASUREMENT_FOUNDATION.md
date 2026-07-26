# Capture Phase D.3.1: Measurement Foundation

## Decision

Measurement Capture owns a new `MeasurementSession` aggregate. The existing
`ProposalMeasurement` remains an estimate-workspace quantity/note record and is
not reused or updated. This prevents field evidence and verification history
from becoming pricing data implicitly.

Capture and Measurement Session lifecycles are separate. Capture continues to
own prepare, review, approve, apply, and receipt. A successfully applied Capture
creates one idempotent Measurement Session with normalized entries,
adjustments, deterministic results, attachments, annotations, and append-only
events.

## Trust and calculation contract

- Raw input and normalized Decimal values are both retained.
- US customary length, area, volume, and angle units are normalized without
  floating-point arithmetic.
- The server rejects unknown schema fields and always recomputes calculations.
- A result inherits the least-trusted critical input status.
- Tolerance, plausibility, repeated-reading, and orthogonal-closure findings
  are advisory warnings. They never alter a reading.
- Photo-reference readings remain estimated. Annotations do not perform image
  scaling or claim real-world dimensions.

## Security and rollout

The API enforces authentication, contractor ownership, project assignment, and
non-enumerating object access. Application remains idempotent through the
existing Capture adapter and receipt architecture. Both
`CAPTURE_MEASUREMENT_ENABLED` and `VITE_CAPTURE_MEASUREMENT_ENABLED` default to
false, allowing migration and deployment before controlled enablement.

## Explicit exclusions

This phase does not implement camera measurement, LiDAR, Bluetooth tools,
computer vision, takeoff/material quantities, pricing, purchasing, product
recommendations, estimate line creation, or estimate modification.
