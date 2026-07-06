# QA Seed Environment

Command:

```powershell
python backend\manage.py seed_qa_environment
```

This command creates deterministic local QA accounts and realistic sample data for authenticated MyHomeBro testing. It is idempotent: running it repeatedly updates the same seed records instead of duplicating users, customers, agreements, opportunities, or property-management examples.

## Safety

The command refuses to run unless it detects a local/test environment:

- `DEBUG=True`, or
- a SQLite database located inside this repo or Django `BASE_DIR`, or
- explicit `--force`.

Do not use `--force` against production or any database containing real customer data.

The seed does not send real email, SMS, or Stripe payments. Stripe/payment identifiers use local stub values such as `acct_qa_stub_myhomebro` and `pi_qa_stub_funded`.

## Credentials

Local-only password for all seeded accounts:

```text
MyHomeBroQA!2026
```

Seeded accounts:

| Role | Email |
| --- | --- |
| Contractor | `info+contractor@myhomebro.com` |
| Customer/Homeowner | `info+customer@myhomebro.com` |
| Property Manager | `info+propertymanager@myhomebro.com` |
| Employee | `info+employee@myhomebro.com` |
| Subcontractor | `info+subcontractor@myhomebro.com` |

## Seeded Objects

Contractor:

- Company: `MyHomeBro QA Remodeling`
- Public profile slug: `qa-remodeling`
- Stub Stripe Connect state marked complete locally
- Skills: carpentry, tile, project supervision
- Estimate availability: weekdays, 9:00 AM to 3:00 PM, in-person, 90 minutes

Employee:

- `Jamie QA Foreman`
- Supervisor role
- Hourly labor cost: `$42.50`
- Capabilities: carpentry lead, tile skilled, project supervision expert

Customer/Homeowner:

- `Casey QA Homeowner`
- Property: `QA Home - Oak Lane`
- Customer communication note
- Property document placeholder

Property Manager:

- `Morgan QA Property Manager`
- Company: `QA Property Management Co`
- Property: `QA Duplex - Cedar`
- Units: `Unit A`, `Unit B`
- Tenant: `Taylor Tenant`
- Tenant maintenance request: kitchen sink leak
- Property work order assigned to preferred plumbing vendor

Opportunity and Estimate:

- Website/public-intake style project intake
- Accepted contractor opportunity
- Confirmed estimate appointment
- Proposal/estimate workspace with checklist, measurements, line items, photo placeholder, and activity entry

Agreements:

- `QA Draft Kitchen Refresh`
- `QA Sent Bathroom Update`
- `QA Signed Deck Repair`
- `QA Funded Rental Turn`

Each agreement has:

- Three milestones
- Planning assumptions and planning validation examples
- Incidentals reserve
- Agreement attachment placeholder
- Agreement PDF version placeholder
- Expense request
- Invoice/payment-state examples where appropriate

Subcontractor:

- Accepted subcontractor invitation for the funded rental turn
- Quote request response for seeded milestone work

## Playwright

`frontend/tests/local-integrated/auth.setup.js` now defaults to the QA contractor account:

```text
PLAYWRIGHT_CONTRACTOR_EMAIL=info+contractor@myhomebro.com
PLAYWRIGHT_CONTRACTOR_PASSWORD=MyHomeBroQA!2026
```

You can still override these with environment variables.

## Local Caveats

On a fresh local database, model saves may attempt to enqueue PDF/invoice background jobs. In this environment, Redis/Celery is not running, so earlier seed runs logged local dispatch errors. No external email, SMS, or Stripe payment was sent.

If the seed command fails with missing columns, run:

```powershell
python backend\manage.py migrate
```

Then rerun:

```powershell
python backend\manage.py seed_qa_environment
```
