# MyHomeBro Dispute Resolution Policy

## Product Rule

AI advises.
Humans decide.
Financial actions remain explicit.

No automated dispute outcome releases, refunds, splits, or transfers money without a separate authorized financial action.

## Resolution Types

| Resolution type | Definition | Status | Financial disposition |
| --- | --- | --- | --- |
| Contractor Prevails | Disputed work/materials are accepted and the contractor position is accepted. | `resolved_contractor` | `eligible_for_release` |
| Customer Prevails | Disputed work/materials are rejected and the customer position is accepted. | `resolved_homeowner` | `eligible_for_refund` |
| Partial Resolution | Only part of the disputed amount is approved. | `resolved_partial` | `partial_manual_review` |
| Rework Required | Work must be corrected before final disposition. | `under_review` | `manual_review_required` |
| Administrative Closure | Resolved externally, abandoned, duplicate, or invalid. | `canceled` | `no_financial_action` |

## Escrow Rules

When a dispute is active, escrow release, reimbursement release, and payment release must remain blocked.

When a dispute resolves, the dispute records a financial disposition only. It does not release funds, refund funds, split funds, or trigger Stripe movement.

Rework Required keeps `escrow_frozen=true` and remains tied to a rework work order or linked milestone until an explicit later review/release/refund action occurs.

## AI Advisory Boundaries

AI may:

- summarize timeline, evidence, agreement scope, milestone history, reimbursement history, and messages
- identify missing evidence and unanswered claims
- compare provided evidence to agreement terms
- generate neutral review summaries and possible resolution options

AI must not:

- determine fault, liability, negligence, fraud, legal responsibility, or who wins
- decide a binding outcome
- release, refund, split, or transfer funds
- present legal advice as authoritative

Required AI output framing:

- Suggested Review Summary
- Evidence Provided
- Evidence Missing
- Open Questions
- Possible Resolution Options

