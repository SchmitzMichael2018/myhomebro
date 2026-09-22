# Phase 2C Admin Request Management Audit

## Pre-implementation findings

### WORKING

- `ProjectIntake` is the canonical public/request intake record and keeps workflow status independent from the Phase 2B `traffic_classification` field.
- Existing relations cover homeowners, contractors, agreements, discovery invites, opportunities, public leads, and Phase 1B account attribution.
- Phase 2B provides canonical account verification and trust states and existing Admin Console role checks.

### PARTIAL

- Django admin offered Real, Test, Spam/Fraud, and Archive classification, but had no Suspicious or Restore action and no durable classification history.
- The Admin marketplace screen exposed a request list, but capped an unpaginated payload and was not a general operational workspace.
- Attribution and verification were available, but were not composed into a request-management query.

### MISSING

- Server-side pagination, composable search/filter/sort, workflow views, summary counts, compact responsive presentation, current-page bulk selection, reversible archive state, and request-level classification audit events.

### DUPLICATED

- No new lifecycle or account-trust system is warranted. Phase 2C maps its views onto existing intake status, routing relations, Phase 1B attribution, and Phase 2B trust fields.

### UNSAFE / AMBIGUOUS

- The prior archive action could not restore the preceding classification.
- Django admin classification updates did not leave a request-level event trail.
- Marketplace reporting and referral qualification did not consistently exclude request-level Test/Spam classifications.
- Permanent deletion could risk related operational or financial history, so it is deliberately not exposed.

### RECOMMENDED / IMPLEMENTED

- Use `ProjectIntake.traffic_classification` as the single administrative classification and add only the missing `suspicious` choice.
- Preserve `classification_before_archive` solely to make archive reversible.
- Record every effective classification transition in `ProjectIntakeClassificationEvent`.
- Keep existing data unchanged; migration `0323` contains schema operations only and performs no classification or deletion.
- Provide `/api/projects/admin/requests/` as the canonical paginated workspace endpoint and `/app/admin/requests` as its responsive UI.

## Conceptual view mappings

- Active: not Test, Spam/Fraud, or Archived, and not converted.
- Needs Review: request Suspicious, Phase 2B account Suspicious, or an authoritative pending/suspicious/disabled verification state.
- Customer Pending: active Draft/Submitted intake without a linked homeowner.
- Contractor Pending: active single-contractor intake without a linked contractor.
- Ready to Route: active Submitted/Analyzed marketplace intake with no invite or opportunity.
- Routed: at least one discovery invite or contractor opportunity.
- Converted / Closed: converted workflow status or linked agreement.
- Test / Spam and Archived: direct administrative-classification views.

These labels are query views only; they do not add or mutate lifecycle states.

## Safety and reporting

- Test, Spam/Fraud, and Archived requests are absent from the default workspace and marketplace operational metrics. Test and Spam/Fraud are excluded from attribution conversion snapshots and referral qualification while source records remain intact.
- Request classification does not mutate account verification/trust or attribution snapshots.
- Bulk mutations require the canonical Django change permission (or superuser), affect at most 100 explicitly supplied current-page records, and require confirmation for Spam/Fraud and Archive.
- There is no API or UI permanent-delete operation.

## Deployment notes

Apply migration `projects.0323_admin_request_management` before deploying backend/frontend code. No production data cleanup occurs during migration or release. An authorized administrator must classify known historical test records manually after deployment.
