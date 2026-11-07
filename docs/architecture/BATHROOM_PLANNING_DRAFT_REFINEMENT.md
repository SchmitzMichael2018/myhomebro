# Bathroom planning draft refinement

## Scope and publication boundary

Migration `0334_refine_bathroom_planning_draft` prepares corrections to the original Bathroom Remodel Planning draft. It does not record human review or publish a guide. It updates only the canonical system template when it is still an unreviewed draft or ready-for-review record and its protected content and all seven milestone texts match the original seed. It skips staff-edited, reviewed, published, archived, or noncanonical records. Skipped records need a human comparison with the proposed text in the migration.

Template and milestone IDs, milestone count/order/types, pricing, operational duration defaults, relationships, and publication/review state are preserved. Public duration fields become empty; the contractor-facing operational `estimated_days` value is deliberately unchanged. Rollback does not undo content or overwrite subsequent editorial work.

## Corrections

- Separate applicable inspections and tests before concealment from final inspection and closeout. Keep the requirements conditional on actual project scope, selected products, and local requirements.
- Replace the unsupported public 7–21 day range with nonnumeric scheduling guidance, separating planning/purchasing, active work, and elapsed bathroom downtime.
- Explain that Advanced describes remodel execution, while non-invasive homeowner planning can be DIY.
- Add recognizable pre-disturbance hazard cues, water/power isolation boundaries, occupant protection, and qualified-help guidance.
- Add a ready-to-start checklist, explicit change approval, completion evidence, and records to keep.
- Add San Antonio jurisdiction verification and descriptive links to official inspection and EPA safety sources. Article sections support secure explicit links without rendering arbitrary Markdown or HTML.

## Sources checked November 7, 2026

- [City of San Antonio residential inspections](https://www.sa.gov/Directory/Departments/DSD/Constructing/Residential/Inspections).
- [IB 130: required residential inspection stages](https://docsonline.sanantonio.gov/FileUploads/DSD/IB130.pdf), revised October 2026. Its staged inspection process supports conditional pre-cover checkpoints. The guide does not imply every listed inspection applies to every bathroom project.
- [EPA lead-safe renovations for DIYers](https://www.epa.gov/lead/lead-safe-renovations-diyers).
- [EPA remodeling and indoor-air guidance](https://www.epa.gov/indoor-air-quality-iaq/best-practices-indoor-air-quality-when-remodeling-your-home).

These sources do not establish site-specific code compliance, trade eligibility, or safe execution. A human reviewer must verify the final draft and the project's jurisdiction before publication. The public planner must retain appropriate reviewed safeguards without expanding the homeowner's requested work.

## Validation scope

Focused migration tests cover content refinement, preserved review/publication state and identities, retained pricing, idempotency, skipped staff edits and milestones, and protected reviewed/published/archived records. The migration-backed bathroom suite verifies the actual seeded draft after the full chain. Source-link rendering tests cover HTTPS links, plain-text preservation, rejected schemes and credentials, and HTML escaping. Desktop/mobile browser cases check links, absent numeric duration, and overflow with mocked public content; these do not publish or exercise live editorial records.
