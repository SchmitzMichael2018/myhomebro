# Production Workflow QA Checklist

Last updated: September 4, 2026

This is the living checklist for authenticated production workflow validation. Do not use real charges, refunds, releases, messages, or customer data unless the tester has explicitly authorized that production mutation. Record defects without rewriting prior signed, funded, paid, or audited records.

## Agreement, Signature, Funding, and Milestone Baseline

The following results were reported as completed by the production QA tester:

- [x] Contractor-triggered amendment completed.
- [x] Contractor signing works.
- [x] Contractor unsigning works before the customer signs.
- [x] Milestone comments can be uploaded and displayed.
- [x] Milestone pictures can be uploaded and displayed.
- [x] Contractor can complete milestone work.
- [x] Customer receives the agreement by email.
- [x] Customer receives the agreement by text message.
- [x] Customer can agree to and sign the agreement.
- [x] Customer can fund escrow.
- [x] Customer portal is activated after the agreement workflow.
- [x] Customer is prompted to create a portal password.
- [x] Escrow release succeeds.

## Next Scenario: Team Member Mobile Completion and Lead Review

Test this sequence against an eligible incomplete milestone. Capture the agreement id, milestone id, assigned team member, device/browser, timestamps, and screenshots for any failure.

### Team setup and assignment

- [ ] Lead contractor adds a team member.
- [ ] Team member receives the intended invitation or activation instructions.
- [ ] Team member creates or accesses their account without receiving lead-contractor permissions.
- [ ] Lead contractor assigns the selected milestone to the team member.
- [ ] Assignment is visible to both the lead contractor and the assigned team member.
- [ ] An unrelated team member cannot access or submit the milestone.

### First mobile submission

- [ ] Team member signs in from a mobile device.
- [ ] Assigned milestone appears with the correct project, sequence, scope, amount, and status.
- [ ] Team member adds completion notes.
- [ ] Team member submits the milestone to the lead contractor for review without photos.
- [ ] Submission remains pending review and does not complete the customer-facing milestone or release funds.
- [ ] Lead contractor receives one review notification without duplicate dashboard priority spam.

### Lead rejection and photo request

- [ ] Lead contractor opens the submitted milestone.
- [ ] Lead contractor rejects the submission and requests completion photos.
- [ ] Rejection requires or records a clear reason.
- [ ] Team member sees the rejection and requested correction on mobile.
- [ ] The original notes, submission, reviewer, reason, and timestamps remain auditable.
- [ ] No invoice is approved and no escrow is released after rejection.

### Mobile photo resubmission

- [ ] Team member opens the phone camera/file picker from the milestone.
- [ ] Team member captures and uploads completion photos.
- [ ] Upload progress, success, and recoverable errors are understandable on mobile.
- [ ] Uploaded photos remain attached after refresh and are visible to the lead contractor.
- [ ] Team member resubmits the milestone for review.
- [ ] Resubmission preserves the prior rejection history and creates a new review event.
- [ ] Lead contractor receives one resubmission notification.

### Lead approval, invoice, and payment state

- [ ] Lead contractor reviews the new photos and completion notes.
- [ ] Lead contractor approves the completed milestone.
- [ ] Milestone status and progress update consistently across Dashboard, Milestones, Agreement Workspace, and Customer Portal.
- [ ] Lead contractor creates or approves the milestone invoice through the intended workflow.
- [ ] Invoice uses the correct milestone, amount, agreement, customer, and payment mode.
- [ ] Approval does not duplicate the invoice or release escrow twice.
- [ ] Customer sees the correct completed milestone and invoice state.

## Next Scenario: Customer Change Request

Requested scope: add wood paneling and paint it white.

- [ ] Customer opens the correct project in the Customer Portal.
- [ ] Customer starts a change request from the project or agreement workflow.
- [ ] Customer enters: `Add wood paneling and paint it white.`
- [ ] Customer can add supporting notes or photos if available.
- [ ] Customer reviews and submits the change request.
- [ ] Customer receives a clear submission confirmation.
- [ ] Lead contractor receives one actionable change-request notification.
- [ ] Request appears against the correct agreement and project.
- [ ] Existing signed scope, milestone history, invoices, payments, and released escrow remain unchanged.
- [ ] Lead contractor can clarify, price, schedule, accept, or decline the request through the amendment workflow.
- [ ] Accepted scope creates a traceable amendment and does not overwrite the original signed agreement.
- [ ] Any new or revised milestone explicitly identifies the wood paneling and white paint work.
- [ ] Customer reviews and signs the resulting amendment before changed work becomes authoritative.

## Evidence and Defect Log

For each failed step, record:

- Date and time with timezone
- Tester role and device/browser
- Agreement, project, milestone, invoice, or change-request identifier
- Expected result
- Actual result
- Screenshot or video path
- Relevant user-visible error
- Whether retrying caused a duplicate record, notification, invoice, or payment
- Severity: blocker, high, medium, or low

## Completion Rule

Do not mark either next scenario complete until the full cross-role sequence passes, audit history is preserved, notifications are not duplicated, mobile uploads survive refresh, and no unauthorized user can access or mutate the records.
