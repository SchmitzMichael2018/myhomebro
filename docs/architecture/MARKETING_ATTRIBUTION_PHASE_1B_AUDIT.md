# Marketing Attribution Phase 1B Audit and Architecture

## Pre-implementation audit

### Working

- Phase 1A had one stable `ReferralParticipant`, locked referral ownership, `ReferralVisit`, `/refer/<code>`, QR generation, and immutable reward/receipt ledgers.
- Registration carried a Phase 1A referral through the Django session and associated its visit with the new user.
- Projects, proposals/estimates, contractor invitations, agreements, funding state, receipts, platform fees, project completion, referral earnings, payouts, and credits already had authoritative backend records.
- Insights services and Django admin already provided domain reporting surfaces.

### Partial

- `ReferralVisit` captured only referral traffic and used a session key rather than a public-safe visitor token.
- First-touch referral data existed, but general UTM, referrer, campaign, content, last-attributable-touch, and multi-role history did not.
- Frontend onboarding analytics was local/session-oriented and was not an authoritative acquisition ledger.
- QR and short-link patterns existed, but physical marketing destinations were not data-configurable.

### Missing

- No unified campaign, account acquisition, meaningful event, project attribution, two-sided attribution, or revenue-attribution record existed.
- No central source classifier, UTM normalizer, bot/test exclusion rule, acquisition funnel, or source/campaign/content reporting foundation existed.
- Direct revisits had no explicit non-overwrite rule.

### Duplicated

- Several domain activity models describe their own workflows. They remain authoritative for those workflows; Phase 1B adds only attribution facts and references their IDs rather than replacing or replaying them.

### Unsafe or ambiguous

- Arbitrary redirect destinations could create an open redirect if not constrained.
- Raw UTMs could create unbounded or unsafe reporting dimensions.
- Recomputing revenue or referral rewards from current terms would corrupt historical economics.
- Browser fingerprinting, raw IP storage, or trusting client-submitted user IDs would create unnecessary privacy/security risk.
- “Activated account” and every possible property-manager operational activation do not yet have one universal domain transition. Phase 1B records `profile_completed` where an authoritative profile exists and leaves further activation definitions for a future explicit business rule.

### Recommended and implemented

- Generalize `ReferralVisit`; do not create a parallel anonymous identity.
- Keep referral ownership separate from first/last marketing touches.
- Record authoritative backend transitions idempotently.
- Snapshot both project parties and receipt economics.
- Seed editable campaigns and expose reporting via admin plus a staff-only API rather than a large BI UI.

## Architecture

`ReferralVisit` is the privacy-safe anonymous acquisition anchor. It now has a random UUID visitor token, immutable first touch, meaningful last touch, optional campaign and referral references, roles, and reporting exclusions. It does not use fingerprinting or store IP addresses.

`MarketingCampaign` provides stable public codes, editable destinations, source/medium/campaign/content, partner-safe codes, scheduling, and active state. Initial codes are `/go/card`, `/go/car`, `/go/hoodie`, `/go/realtor`, and `/go/contractor`. Destinations accept root-relative URLs or approved HTTPS MyHomeBro hosts only.

`AccountAcquisition` binds the visit to a server-authenticated account, retains immutable first touch, current meaningful last touch, a locked Phase 1A referral, multi-role history, and conversion timestamps. Existing accounts without evidence migrate as `unknown / legacy`; they are never fabricated as direct.

`AttributionEvent` is the meaningful event ledger. Financial/business events use stable object-based idempotency keys. Client calls are restricted to the documented public intent/content subset; clients cannot name users.

`ProjectAttributionSnapshot` freezes customer/property-manager and contractor acquisition separately. `RevenueAttributionSnapshot` uses `Receipt.platform_fee_cents` through the existing eligible-fee service and existing `ReferralEarning` rows. It preserves eligible fee, maximum pool, side rewards, total rewards, and retained fee without historical recalculation.

## Touch and classification rules

- First touch is written once and is normally immutable.
- Last touch changes only for a meaningful non-direct source. A direct revisit does not erase Google, Facebook, a campaign, or an external referral.
- Normalized UTM fields are bounded and stripped to a conservative character set.
- One service classifies Google/Bing organic, Google paid search, Facebook/Instagram organic and paid social, campaign/QR sources, direct, and external referral domains.
- Phase 1A referral ownership stays locked even when later marketing touches change.

## Event and funnel foundation

The permitted taxonomy covers the requested acquisition/content, intent, conversion, and value events. Current authoritative hooks record account/profile, project, invitation, estimate, agreement/signature/funding, receipt/platform fee, project completion, referral reward generation, and reward redemption. Public route tracking records landing, guide/template, signup, role selection, and contractor-profile intent without blocking the user experience.

The staff report groups included visitors by source/medium, accounts by role set, campaign/content visits, funnel event totals, and authoritative platform-fee/reward/retained-revenue totals. Django admin supports campaign management and immutable attribution inspection.

## Privacy and traffic quality

- No fingerprinting, session recording, keystroke capture, cross-site profiling, or precise location is implemented.
- Stored referrers are bounded; production policy should disclose campaign parameters, first-party session identifiers, referral attribution, retention, and opt-out/contact practices.
- Obvious bots, declared test traffic (`X-MyHomeBro-Test-Traffic`), and development/test hosts are flagged and excluded from visitor reporting. Production teams should configure QA traffic to send the header and document internal campaign practices.
- Attribution is first-party operational analytics. Any future third-party analytics or advertising pixels require a fresh privacy/consent review.

## Deployment and known limitations

Apply migrations `0315` and `0316` before serving the code. Migration `0316` seeds the five initial campaigns, preserves known referral visits, and marks otherwise unattributed existing users `unknown / legacy`. Optional throttle settings are `PUBLIC_CAMPAIGN_LINK_RATE` and `PUBLIC_ATTRIBUTION_EVENT_RATE`.

No deployment is performed by this phase. No new secret is required. JavaScript-disabled visits that do not enter through `/go` or `/refer` are not captured. Cross-device identity is intentionally not inferred. A future business decision is still needed for a single universal “activated account” definition and for deeper property-manager unit/work-order funnel hooks. Campaign destinations and partner codes are managed in Django admin.
