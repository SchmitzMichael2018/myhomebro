# Account Verification and Anti-Abuse — Phase 2B

## Pre-implementation audit

| Area | Finding | Phase 2B disposition |
|---|---|---|
| User and activation | PARTIAL — unique email, `is_active`, and a legacy email-verification boolean existed, but no authoritative two-factor ownership state or timestamps. | Added explicit verification/trust states and timestamps. Existing rows retain access as `LEGACY_UNVERIFIED`. |
| Registration and login | PARTIAL / SECURITY CONCERN — registration could create inactive accounts, contractor email delivery was inconsistent, and inactive login looked like an email-only problem. | Both public registration paths require email then mobile verification; pending login returns resumable setup state without JWTs. |
| Email | WORKING / DUPLICATED — Django mail and password-reset templates existed; an older default-token email flow also existed. | Reused Django email delivery. A signed, expiring, single-purpose account-verification token is authoritative; the old link remains compatible but no longer activates a new account after email alone. |
| SMS | WORKING / PARTIAL — Twilio and E.164 normalization existed for transactional product messages, with separate consent records. There was no ownership OTP workflow. | Reused Twilio credentials and normalization behind a verification-specific adapter. OTP messages are transactional security messages and do not alter marketing or contractor-message consent. |
| Password reset | WORKING, with pending accounts previously omitted from reset requests. | Pending users may reset passwords, but reset never changes activation or verification state. Disabled accounts remain excluded. |
| Referrals | WORKING — attribution and economic qualification already existed. | Attribution survives verification. New non-legacy accounts must also be fully verified before reward activation; existing economic rules remain authoritative. |
| Acquisition attribution | WORKING, but no account trust exclusion. | Raw records remain stored; normal reports exclude Test and Spam/Fraud accounts. Suspicious accounts remain reviewable. |
| Public intake | WORKING — low-friction drafts and submissions existed. | Flow is preserved. Admin can classify requests as Real, Test, Spam/Fraud, or Archived without deletion. |
| CAPTCHA and throttling | MISSING / PARTIAL — DRF throttling existed elsewhere; registration had no Turnstile integration. | Added server-side Turnstile verification, explicit development bypass, registration/email/SMS throttles, a hidden accessible-safe honeypot, and OTP cost controls. |
| Admin abuse controls | MISSING for accounts and intake classification. | Added filters, masked phone display, verification evidence, risk flags, audited account actions, and intake classification actions. |

## Architecture and behavior

`User.verification_state` is the account-access authority for new registrations: `PENDING_EMAIL → PENDING_PHONE → VERIFIED`. `email_verified_at` and `phone_verified_at` are independent evidence. New users stay inactive and receive no JWT until both timestamps exist. Existing records receive the migration default `LEGACY_UNVERIFIED`; their prior `is_active` value is untouched and no historical evidence is fabricated.

Email links use Django timestamp signing with a dedicated purpose and salt. Resends are generic, account-cooled, and IP-throttled. Mobile codes use cryptographically secure six-digit randomness, Django password hashing, configurable expiry, single use, limited attempts, a temporary lock, cooldowns, and hourly account/phone/IP/session limits. Security events record outcomes and scopes, never OTPs or tokens.

Phone comparisons use E.164 normalization. Reuse of an already verified phone flags all matching accounts for review but does not automatically ban them. A configurable comma-separated disposable-domain set can flag new accounts as Suspicious without blocking uncommon domains by default.

Changing a verified non-legacy email makes the account `PENDING_EMAIL`; changing its phone makes it `PENDING_PHONE`. The corresponding timestamp is cleared and re-verification is required. Legacy accounts remain active during a change, preserving the phase requirement not to impose progressive verification yet.

Continuation is stored on the account and returned throughout verification. This preserves Improvement Library DIY, contractor-help, referral, and universal-registration intent. Referral ownership is not regenerated during verification.

## Configuration gate

Production requires:

- `TURNSTILE_REQUIRED=true`
- `TURNSTILE_SITE_KEY` (frontend also exposes the equivalent `VITE_TURNSTILE_SITE_KEY` at build time)
- `TURNSTILE_SECRET_KEY`
- `ACCOUNT_VERIFICATION_SMS_BACKEND=twilio`
- valid existing `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` or a Twilio sender number

Optional controls include `ACCOUNT_REGISTRATION_RATE`, `ACCOUNT_VERIFICATION_EMAIL_RATE`, `ACCOUNT_VERIFICATION_SMS_RATE`, `ACCOUNT_VERIFICATION_TOKEN_MAX_AGE`, `ACCOUNT_EMAIL_RESEND_COOLDOWN_SECONDS`, `ACCOUNT_OTP_TTL_SECONDS`, `ACCOUNT_OTP_RESEND_COOLDOWN_SECONDS`, `ACCOUNT_OTP_MAX_SENDS_PER_HOUR`, `ACCOUNT_OTP_MAX_SENDS_PER_PHONE_HOUR`, `ACCOUNT_OTP_MAX_SENDS_PER_IP_HOUR`, `ACCOUNT_OTP_MAX_SENDS_PER_SESSION_HOUR`, `ACCOUNT_OTP_MAX_ATTEMPTS`, and `ACCOUNT_DISPOSABLE_EMAIL_DOMAINS`.

The `test` SMS backend and `TURNSTILE_TEST_BYPASS` work only with `DEBUG=true`. Production defaults fail closed: absent Turnstile validation blocks registration and an unconfigured SMS backend never reports a successful send.

## Legal and consent review

The canonical Privacy Policy now discloses ownership-verification evidence, transactional verification messages, anti-fraud classification, and duplicate verified-mobile detection. Generated HTML, text, Markdown, and PDFs were rebuilt through `build_legal_documents`. Verification SMS remains separate from promotional or contractor-message consent and does not enroll the recipient in marketing.

## Known limitations and deployment order

- Real production SMS delivery and Turnstile cannot be claimed until credentials, sender authorization, hostname configuration, and a non-destructive production smoke test are completed.
- Phone type (mobile versus VoIP/landline) is not carrier-looked-up in this phase; ownership of the reachable number is what is established.
- Suspicious activity is surfaced for human review; automated permanent bans are intentionally out of scope.
- Public intake remains low-friction. Classification exclusions should be applied by each future marketplace metric as it is introduced; raw intake records are intentionally retained.

Deploy application code and frontend assets, apply `accounts.0005` and `projects.0322`, verify environment gates, then smoke-test registration with approved test destinations. No Phase 2B implementation command deploys the application.
