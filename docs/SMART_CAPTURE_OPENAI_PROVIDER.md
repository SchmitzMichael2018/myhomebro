# Smart Capture OpenAI Provider

Date: July 11, 2026

Smart Capture supports two extraction providers:

- `SMART_CAPTURE_PROVIDER=deterministic`
- `SMART_CAPTURE_PROVIDER=openai`

Deterministic extraction remains the local/test default. OpenAI extraction is backend-only and is enabled by configuration; no OpenAI API key is exposed to React.

## Required Production Variables

```bash
OPENAI_API_KEY=...
SMART_CAPTURE_PROVIDER=openai
SMART_CAPTURE_OPENAI_ENABLED=true
OPENAI_SMART_CAPTURE_MODEL=gpt-4.1-mini
```

Production activation should require setting the provider/enabled variables and reloading the backend.

## Optional Variables

```bash
SMART_CAPTURE_TIMEOUT_SECONDS=30
SMART_CAPTURE_MAX_IMAGE_SIZE_MB=10
SMART_CAPTURE_LOG_USAGE=true
SMART_CAPTURE_RECEIPT_PRICE=0.05
SMART_CAPTURE_EQUIPMENT_PRICE=0.05
SMART_CAPTURE_PRODUCT_LABEL_PRICE=0.05
```

The fixed prices are stored on successful OpenAI usage-ledger rows as future billing metadata. This phase does not charge Stripe, create invoices, approve reimbursements, release funds, or create records before human approval.

## Rollback

To disable OpenAI extraction quickly:

```bash
SMART_CAPTURE_PROVIDER=deterministic
```

Or:

```bash
SMART_CAPTURE_OPENAI_ENABLED=false
```

When OpenAI is disabled or misconfigured, uploads are preserved and the session can be retried or completed manually.

## Live Verification

Run a no-mutation extraction check:

```bash
python backend/manage.py test_smart_capture_openai --file C:\path\to\receipt.jpg --type receipt
python backend/manage.py test_smart_capture_openai --file C:\path\to\label.jpg --type equipment_label
```

The command prints normalized extraction, provider, model, request ID, usage metadata, warnings, and created-record IDs. Created-record IDs should remain empty because the command does not approve the capture.

## Usage Logs

OpenAI extraction attempts write `AIUsageLedger` rows for Smart Capture. Review:

- `provider`
- `model`
- `feature`
- `capture_session`
- `input_units`
- `output_units`
- `billable_amount`
- `billing_status`
- `success`
- `failure_code`
- `provider_request_id`
- `metadata`

Deterministic extraction is not billable. Cache hits do not create duplicate usage rows.

## Security Notes

- API keys are read only by Django.
- Source files remain private media records.
- Ordinary logs should not include image contents or API keys.
- Receipt card details are masked; full card numbers and CVV are not stored.
- OpenAI receives only the uploaded source image and extraction instructions, not unrelated customer/project/financial context.

## Current Limits

- OpenAI PDF extraction is not enabled in this Smart Capture workflow. Upload an image or continue manually.
- The frontend still uses the existing review/edit/approve flow.
- Human approval remains required before creating expenses, assets, or property records.
