# Referral Rewards Phase 1A Audit

## Existing implementation

### Working before Phase 1A

- `ReferralParticipant` supplied one stable, unique code per Django user.
- Contractor registration accepted a referral code and locked the first valid attribution.
- Self-referrals were rejected.
- Contractor referrals snapshotted Founding (50% / 6 months) or Standard (25% / 3 months) terms.
- Contractor earning periods began with the first verified qualifying receipt, subject to a 180-day activation deadline.
- Receipt creation generated an idempotent reward from `Receipt.platform_fee_cents`.
- Rewards had a 30-day hold and remained pending during refunds or disputes.
- Reviewed contractor payouts used Stripe Connect transfers with idempotency keys.
- Contractor and customer portal surfaces exposed a stable code, link, QR, balances, and referral activity.
- Django admin exposed participants, Founding awards, referrals, earnings, payouts, and invitations.

### Partial or contractor-specific behavior

- `ContractorReferral` required a contractor and could not represent a referred homeowner or property manager.
- `FoundingContractorAward` had one global 100-slot contractor pool.
- Customer users could refer contractors, but customer/property-manager registration did not capture referral codes.
- Customer cash payouts were described as planning only; payout readiness was not modeled independently of earnings.
- QR codes embedded `/signup?ref=...`, coupling physical QR codes to one role-specific signup page.
- Attribution recorded the referral code but not first touch, medium, landing page, or role snapshots.
- Reward summaries did not separate cash paid from project-credit redemption.

### Missing or unsafe behavior

- `ReferralEarning.receipt` was one-to-one, so a single platform fee could not safely reward both eligible sides.
- No aggregate maximum-pool guard prevented future multi-side logic from exceeding 50% of the eligible fee.
- No consumer Founding pool existed.
- No project-credit ledger or double-spend reservation existed.
- No role-neutral payout-readiness abstraction existed.
- Successful refunds/disputed invoices did not directly reverse pending/available referral earnings.
- No stable role-neutral public referral route existed (`/r/<code>` was already reserved for proposal review links).
- Admin could not reconcile role, side allocation, acquisition touch, or project-credit records.

## Phase 1A architecture

The existing system is generalized in place. No parallel referral system is introduced.

- `ReferralParticipant` remains the one-per-user referral identity and gains primary-role and payout-readiness fields.
- The existing `ContractorReferral` table remains for migration compatibility but now represents a role-neutral referred account through `referred_user`, role snapshots, optional contractor/homeowner links, and acquisition fields.
- `FoundingContractorAward` remains for backward compatibility and gains a participant plus independent `contractor` and `consumer` pools.
- `ReferralEarning` becomes many-per-receipt with a unique `(referral, receipt)` constraint and per-fee maximum-pool snapshot.
- A locked receipt transaction allocates at most 50% of the authoritative eligible platform fee across all eligible referred sides.
- `ReferralVisit` records anonymous first-touch referral attribution. `/refer/<code>` preserves existing `/r/<code>` proposal links and redirects to role selection.
- `ReferralProjectCredit` reserves immutable available earning entries and gates real payment funding until verified integration exists.
- Contractor Stripe payouts are preserved. Homeowner/property-manager earnings remain independent of payout onboarding and use explicit payout-readiness state; unsupported money movement is not simulated.
- Both the authenticated dashboard and customer/property-manager portal expose cash-out and invoice-linked project-credit choices. Cash-out requests without a verified payout identity stop in `needs_onboarding`; project credits stop in `pending_integration` until production funding is verified.
- Active payout requests and project-credit reservations are mutually exclusive consumers of available earning rows, preventing cross-path double redemption.

## Compatibility and migration

Migration `0314` backfills existing contractor referral rows with referred users, contractor roles, locked timestamps, Founding pool/participant identity, payout readiness, and 50% maximum-pool snapshots. Existing codes, relationships, earning clocks, earnings, payout history, Stripe references, and timestamps remain intact.

Deployment must apply Django migrations before serving the new application code. The release does not require new secrets, but `PUBLIC_REFERRAL_LINK_RATE` may be configured to override the default `120/hour` public short-link throttle. No deployment was performed as part of Phase 1A.

## Verification coverage

- Stable identities and short-link behavior for all three roles, including invalid and disabled links.
- All nine referrer/referred role combinations and locked attribution.
- Independent contractor and combined consumer Founding pools, including slots 1–100 and rejection of 101.
- Founding privilege expiry, snapshotted terms, the 180-day deadline, individual earning clocks, multi-project/property earnings, and Standard fallback.
- One-sided, two-sided, and mixed-rate reward allocation with an aggregate 50% ceiling.
- Thirty-day holds, refunds/disputes, reversals, idempotent receipt processing, contractor Stripe payout, non-contractor payout readiness, invoice credit reservation, and cross-path double-spend prevention.

## External verification still required

- Stripe connected-account configuration and compliance requirements for homeowner/property-manager cash payouts.
- Legal, tax, unclaimed-property, promotion, and consumer-disclosure review for cash and project-credit rewards.
- Production payment integration for actually applying a reserved reward credit to a Stripe-funded project transaction. Phase 1A records and locks the credit but deliberately does not claim the contractor was funded until that integration is verified.
