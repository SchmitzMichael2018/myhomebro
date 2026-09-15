# Payment Rail Ownership

MyHomeBro uses two deliberately separate Stripe payment rails. The selected agreement payment mode is the source of truth; payment code must not infer ownership from an invoice status or a Stripe identifier alone.

## Protected payments

Milestone funding, escrow-style funding holds, funded draws, contingency expenses, releases, and dispute allocations are platform charges. MyHomeBro controls the documented release workflow. Refunds and payment disputes debit the platform charge and must use the existing source-accounting, transfer-reversal, and audit-transaction services.

## Direct Pay

Direct Pay invoice and draw Checkout Sessions are created as direct charges on the contractor's connected Stripe account. The contractor is the seller and Stripe processing fees are charged to that connected account. MyHomeBro collects the disclosed application fee. Direct Pay does not include a MyHomeBro funding hold or milestone-release protection.

Direct Pay creation must fail closed unless Stripe reports all of the following:

- charges are enabled;
- `controller.losses.payments` is `stripe` (or the account is a legacy Standard account); and
- `controller.fees.payer` is `account` (or the account is a legacy Standard account).

Every Direct Pay source snapshots its charge type and connected account ID. Webhooks must include the matching Connect `event.account`, and refunds must be issued in that connected-account context. Records with no charge-type snapshot are treated as legacy platform destination charges so historical refunds remain possible.

## Connected-account onboarding

New contractor accounts use controller properties equivalent to contractor-owned Standard accounts: Stripe collects requirements, the contractor has the full Stripe Dashboard, the contractor pays Stripe processing fees, and Stripe owns unrecovered connected-account payment losses. Existing Custom or Express accounts are not silently treated as safe Direct Pay accounts; they must be replaced or migrated through an approved Stripe process.

## Release requirements

Before enabling live Direct Pay:

1. Configure a production Connect webhook endpoint to receive events from connected accounts and save its signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`. Keep the platform endpoint secret in `STRIPE_WEBHOOK_SECRET`.
2. Confirm the live account's controller properties and active `card_payments` capability.
3. Complete a sandbox card payment and asynchronous bank-payment test.
4. Verify application-fee reporting, connected-account payout, refund, dispute, webhook retry, and idempotency behavior.
5. Confirm protected-payment funding and release regression tests remain unchanged.
