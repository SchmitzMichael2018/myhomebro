# Capture Phase D.3.2: Intelligent Takeoff

## Repository audit

MyHomeBro had no contractor product or material catalog. `Expense` records
historical agreement costs and is not a reusable pricing source. Templates
describe repeatable scope, but do not own product packaging or current price
facts. `ProposalLineItem` is the authoritative Estimate pricing row and
calculates `quantity × unit_price`; it must remain the only Estimate engine.

This phase therefore introduces a contractor-scoped `MaterialLibraryItem`.
Takeoff never writes `ProposalLineItem`. The estimate-preview endpoint maps the
current Takeoff revision into the existing line-item contract without mutation,
allowing a later explicitly authorized handoff to reuse Proposal validation and
activity logging rather than duplicating them.

## Domain boundary

A `TakeoffSession` links one project and Measurement Session, with an optional
Proposal context. `TakeoffItem` versions preserve measurement-result lineage,
theoretical quantity, waste, required quantity, purchasing-unit rounding,
excess, costs, warnings, and a complete product/price snapshot.

Confirmed history is not rewritten. Recalculation increments the session
version and creates a new item revision. Prior item revisions and append-only
events remain available for audit.

Reusable material assemblies are explicit collections of independently
calculated Material Library items. Accessories are never hidden inside an
opaque primary-material quantity.

## Deterministic calculation contract

`takeoff_calculations.py` uses Decimal arithmetic and server-owned profile,
coverage, waste, rounding, tax, and markup rules. Packaged products retain both
theoretical and upward-rounded purchase quantities. Direct price bases retain
exact required quantity. Product snapshots include price source and effective
date; stale prices produce a visible warning.

Initial supported profiles are flooring, paint, tile, drywall, linear material,
and concrete. Roofing is deferred because the Measurement Foundation does not
yet provide sufficiently bounded roof-plane geometry. Fabrication-level
fencing is deferred; generic linear material remains available without
inventing corner, terrain, post, or gate assumptions.

## Eligibility and permissions

Verified or confirmed measurement results can produce confirmable Takeoffs.
Estimated results require explicit acknowledgement, remain provisional, and
cannot be confirmed or previewed for Estimate handoff.

Capability evaluation separates viewing, provisional creation, pricing
management, confirmation, and estimate handoff. Owner and supervisor accounts
can manage pricing. Assigned field employees may be recognized for provisional
project access but cannot manipulate pricing or confirm by default. Contractor
pricing is never exposed through customer or public APIs.

## Rollout and exclusions

`TAKEOFF_ENABLED` and `VITE_TAKEOFF_ENABLED` default to false.
`TAKEOFF_ESTIMATE_HANDOFF_ENABLED` and its frontend counterpart reserve a later
explicit insertion workflow; this phase is preview-only.

There is no supplier API, scraping, inventory claim, purchase, checkout,
automatic labor, AI arithmetic, camera measurement, LiDAR, Bluetooth tool
integration, or automatic Estimate mutation.
