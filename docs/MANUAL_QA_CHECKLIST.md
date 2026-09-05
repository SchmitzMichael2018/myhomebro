# MyHomeBro Manual QA Checklist

Use this checklist for the current end-to-end production QA pass. Record defects with the agreement, milestone, invoice, and user role involved.

## Completed and passing

- [x] Contractor login.
- [x] Customer creation.
- [x] Estimate workflow.
- [x] Customer email delivery.
- [x] Customer text-message delivery.
- [x] Contractor-triggered amendment request.
- [x] Amendment identifies its milestone placement, amount, and proposed date.
- [x] Contractor signs the amendment.
- [x] Contractor can remove and replace their signature before customer execution.
- [x] Contractor uploads milestone comments and completion photos.
- [x] Contractor marks milestone work complete.
- [x] Customer receives amendment email and text notifications.
- [x] Customer reviews and accepts the amendment.
- [x] Customer signs the amendment.
- [x] Customer funds the additional amendment amount.
- [x] Customer portal activation routes the customer to create a password.
- [x] Escrow release completes successfully.

## Next scenario: team member completes work from mobile

### Team setup and assignment

- [ ] Lead contractor adds a team member.
- [ ] Team member receives the invitation and activates their account.
- [ ] Lead contractor assigns a specific incomplete milestone to the team member.
- [ ] Verify the team member sees only the work and controls permitted by their role.
- [ ] Verify the assigned milestone appears correctly on a mobile viewport or phone.

### First mobile submission

- [ ] Team member opens the assigned milestone on a phone.
- [ ] Team member adds completion comments.
- [ ] Team member submits the milestone to the lead contractor without completion photos.
- [ ] Verify the milestone changes to an awaiting-review state and is not invoiced yet.
- [ ] Verify the lead contractor receives the review notification and can open the correct milestone.

### Rejection and requested correction

- [ ] Lead contractor rejects the first submission.
- [ ] Lead contractor enters a clear correction request requiring completion photos.
- [ ] Verify rejection does not mark the milestone complete or create/send an invoice.
- [ ] Verify the team member receives the rejection reason and a resubmission action.

### Mobile photo resubmission

- [ ] Team member opens the rejected milestone on a phone.
- [ ] Team member uses the phone camera or photo picker to attach completion photos.
- [ ] Team member can preview or identify the selected photos before submitting.
- [ ] Team member adds a follow-up comment and resubmits the milestone.
- [ ] Verify the lead contractor can open the new submission, comments, and photos.
- [ ] Verify the activity history preserves both the rejected attempt and resubmission.

### Lead approval and invoice

- [ ] Lead contractor approves the resubmitted milestone.
- [ ] Verify approval marks the milestone complete.
- [ ] Verify the invoice is created for the correct milestone and amount.
- [ ] Verify the lead contractor can review the invoice and its attached completion evidence.
- [ ] Verify the invoice can be sent to the customer by email and permitted text notification.
- [ ] Verify the customer can review, approve, and pay or release escrow using the correct payment mode.

## Next scenario: customer requests wood paneling change

### Customer request

- [ ] Customer opens the active project in the customer portal.
- [ ] Customer selects **Request Change**.
- [ ] Customer requests: **Add wood paneling and paint it white**.
- [ ] Customer selects or confirms the intended milestone placement.
- [ ] Customer enters or proposes a milestone date if the customer workflow permits scheduling input.
- [ ] Customer attaches an inspiration photo or supporting document if desired.
- [ ] Customer submits the request.

### Contractor review and amendment preparation

- [ ] Lead contractor receives email/in-app notification for the customer change request.
- [ ] Lead contractor can open the request directly from the notification and agreement overview.
- [ ] Verify the request clearly separates requested work from the reason for the change.
- [ ] Lead contractor reviews or enters the price adjustment, milestone placement, date, scope, and completion criteria.
- [ ] Lead contractor prepares the amendment and sends it for customer signature.
- [ ] Verify the original signed agreement remains preserved and the amendment has its own history/version.

### Customer approval, signature, and funding

- [ ] Customer receives the amendment signature request.
- [ ] Customer reviews the new wood-paneling milestone, price, placement, and date.
- [ ] Customer signs the amendment.
- [ ] Contractor completes any required countersignature.
- [ ] Customer receives the request for additional escrow funding.
- [ ] Customer funds the additional amount.
- [ ] Verify the wood-paneling milestone is inserted only after the amendment is signed and funded.
- [ ] Verify later milestone numbers and dates remain understandable after insertion.
- [ ] Verify the new funding and milestone appear in the agreement workspace, customer portal, Money view, timeline, and audit history.

## Result labels

- **PASS** — completed with the expected state, notification, permissions, and records.
- **FAIL** — behavior is incorrect or the workflow cannot continue.
- **BLOCKED** — an external dependency, account, consent, or environment prevents testing.
- **NEEDS REFINEMENT** — workflow completes, but wording, layout, or next-action guidance is unclear.
