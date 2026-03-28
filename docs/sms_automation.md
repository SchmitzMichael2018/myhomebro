# SMS Automation

MyHomeBro SMS automation is a transactional and customer-care decision layer that sits between activity events and the compliant Twilio send wrapper.

## Flow

1. A workflow emits a `ContractorActivityEvent`.
2. The activity feed service calls `evaluate_sms_automation(...)`.
3. The automation layer checks:
   - consent state
   - recent SMS automation decisions
   - cooldown and dedupe rules
   - quiet hours
   - message template mapping
4. The system either:
   - sends immediately through `send_compliant_sms(...)`
   - defers to `DeferredSMSAutomation`
   - suppresses the message
   - keeps the update dashboard-only
5. Every decision is stored in `SMSAutomationDecision`.

## Consent Gating

- No consent: suppressed
- Opted out: suppressed
- STOP / START / HELP logic remains in the inbound webhook layer
- All actual sends still go through the compliant wrapper and Twilio Messaging Service SID only

## Cooldown And Dedupe

- Same phone + same template inside cooldown window: suppressed
- Same agreement or milestone event inside cooldown window: suppressed
- Lower-value events can be suppressed when a higher-value related event was already sent

## Quiet Hours

- Default quiet hours: 9 PM to 8 AM
- Medium and low priority SMS can defer into the next allowed send window
- High-priority transactional updates can bypass quiet hours when configured

## Template Registry

Templates live in `backend/projects/services/sms_templates.py`.

Each template defines:
- template key
- audience
- intent key
- intent summary
- priority
- body builder

## Preview Mode

Staff preview endpoint:

`GET /api/projects/sms/automation/preview/?event_type=payment_released&agreement_id=123`

This runs the same decision engine in simulate mode and returns deterministic output without sending.

## Testing

Targeted tests cover:
- immediate send for high-value events with consent
- suppression on missing consent or opt-out
- cooldown suppression
- related-event suppression
- quiet-hours deferral
- dashboard and agreement payload summaries

## Future Extension Points

- recommendation scoring on top of deterministic rules
- AI-suggested draft copy without replacing hard compliance gates
- richer per-audience quiet hours and timezone support
- more advanced deferred send processing

