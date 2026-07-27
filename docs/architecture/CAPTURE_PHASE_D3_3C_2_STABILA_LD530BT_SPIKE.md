# Capture Phase D.3.3C.2: STABILA LD 530 BT Technical Spike

> **HARNESS COMPLETE — HARDWARE VALIDATION BLOCKED**

## Purpose

This spike evaluates whether a STABILA LD 530 BT can transfer complete,
deterministically parseable readings into a deliberately armed browser field
using the manufacturer's documented Bluetooth keypad mode.

The harness demonstrates a possible boundary with the existing Measurement
Foundation. It does not establish device compatibility, accuracy, firmware
support, browser reliability, vendor authorization, or production readiness.

## Scope and production boundary

The implementation is isolated under:

`frontend/src/spikes/laser-stabila/`

It is not imported by the production application, is absent from protected or
public routes, has no navigation entry point, makes no HTTP/API calls, and
persists nothing. Its module throws if built or evaluated in production mode.

The spike does not use Web Bluetooth/GATT. It expects keypad mode to behave as a
keyboard and captures only within a dedicated input after an explicit
**Arm Capture** action. It does not install global keyboard listeners.

No production Measurement, Capture, Takeoff, Estimate, Project, Customer,
Material, feature-flag, model, migration, API, or routing code changed.

## Exact target hardware

- Manufacturer: STABILA
- Model: LD 530 BT
- Connection behavior under test: Bluetooth 5.0 keypad mode
- Exact hardware availability: **unavailable**
- Firmware: **not observed**
- Serial or MAC address: must not be recorded

No physical device behavior is reported in this document.

## Exact target environments

Required but not yet executed:

| Field | Required target | Observed |
|---|---|---|
| Operating system | Windows 11, exact build recorded | Blocked |
| Chrome | Current stable, exact version recorded | Blocked |
| Edge | Current stable, exact version recorded | Blocked |
| Bluetooth adapter | Manufacturer/chipset where visible | Blocked |
| Device firmware | Exact displayed/reported version | Blocked |
| Windows locale | Record exact locale | Blocked |
| Browser locale | Record exact locale | Blocked |
| Keyboard layout | Record exact layout | Blocked |
| Device unit mode | Record per test case | Blocked |

## Running the local harness

From `frontend`:

```text
npm run dev
```

Open:

```text
http://localhost:5173/src/spikes/laser-stabila/index.html
```

This URL is a development-server asset, not a React production route. The
ordinary Vite production entry does not import it.

## Harness architecture

Files:

- `index.html` — isolated development entry
- `main.jsx` — local React harness and in-memory workflow
- `laserSpike.js` — bounded parsing, duplicate analysis, Decimal-safe repeat
  statistics, and observation-envelope shaping
- `laserSpike.test.js` — isolated Vitest coverage
- `spike.css` — self-contained responsive styles
- `fixtures/synthetic-readings.json` — explicitly synthetic parser fixtures
- `fixtures/hardware-test-readings.csv` — empty 50-reading evidence sheet

React state exists only in the current page. Refresh/reset discards all
observations and assignments.

## Input-capture method

The harness provides:

- Explicit arm and disarm
- Dedicated visible input
- Armed/disarmed, browser-focus, tab-visibility, and online/offline status
- Enter, Tab, or bounded timeout terminators
- Raw input, bounded key sequence, browser timestamp, capture-session UUID,
  user-entered session label, and terminator
- Manual synthetic entry fallback
- Clear/reset that replaces the capture-session UUID

Only keys received by the dedicated armed input are recorded. Losing focus
produces a warning. The harness intentionally does not intercept input sent to
another browser field or application; that remains a central physical-test
risk.

## Parser contract

Parser output:

```json
{
  "raw_text": "12.345 m",
  "normalized_value": "12.3450000000",
  "reported_unit": "meters",
  "parse_status": "valid",
  "warnings": [],
  "locale_assumption": "period decimal separator",
  "captured_at": "browser ISO timestamp"
}
```

Rules:

- Maximum sanitized raw length: 80 characters
- Control characters removed; Enter/Tab are handled as terminators
- Exact, anchored format matching
- Allowed units: meters, feet, and inches with bounded aliases
- Decimal separator must be explicitly selected when a decimal is present
- Unitless values remain valid only with a missing-unit warning
- Feet/inches fractions normalize exactly with `BigInt` fixed-point arithmetic
- Multiple readings are ambiguous and are not split automatically
- Signed, unknown-unit, arbitrary-text, malformed, and oversized input fails
- Raw text is preserved in the in-memory observation
- No floating-point arithmetic, evaluation, HTML interpretation, or execution

Synthetic fixture formats:

- `12.345`
- `12,345`
- `12.345 m`
- `12,345 m`
- `3.45 ft`
- `3' 5 1/2"`
- `41.5 in`

These formats are parser fixtures only. None is claimed as actual LD 530 BT
output.

## Duplicate behavior

Duplicate classification uses the capture-session UUID, normalized value,
reported unit, raw text, and capture-time window:

- **exact duplicate** — same raw/value/unit within 2.5 seconds
- **likely repeated intentional reading** — same normalized value/unit within
  10 seconds but not an exact duplicate
- **distinct reading** — no recent same value/unit
- **ambiguous duplicate** — invalid input or same observation outside the
  bounded interpretation

Every observation remains visible. Nothing is silently dropped.

## Focus behavior

The harness reports whether the browser is focused, visible without focus, or
in an inactive tab. An armed input `blur` displays a warning.

Hardware validation must determine what the device does when:

- The dedicated field is focused
- Another harness field is focused
- No browser field is focused
- The tab is inactive
- A native/other-application field is focused
- Text is selected elsewhere
- A modal owns focus
- The page is scrolled

Keypad mode may type into the operating system's current focus target. The
harness cannot prevent input from reaching another application. A production
go requires evidence that the controlled workflow makes this risk understandable
and acceptably rare; otherwise the result is no-go.

## Observation-envelope preview

A valid fixture can shape this local-only contract:

```json
{
  "schema_version": "measurement-source.v1",
  "idempotency_key": "ephemeral observation UUID",
  "provider_key": "laser_keyboard_stabila",
  "provider_version": "spike-1",
  "vendor": "STABILA",
  "device_model": "LD 530 BT",
  "firmware_version": "",
  "raw_value": "",
  "reported_unit": "",
  "normalized_value": "",
  "captured_at": "",
  "received_at": "",
  "connection_method": "bluetooth_keypad",
  "warnings": [],
  "evidence": {
    "explicit_arm_capture": true,
    "parser_status": "valid",
    "target_assignment_required": true,
    "hardware_validated": false
  },
  "verification_status": "needs_verification"
}
```

There is no API submission, database storage, full serial, MAC address,
Bluetooth packet, unrestricted metadata, or automatic verification.

## Target-assignment mock

The in-memory assignment form contains only user-entered labels:

- Project
- Measurement Session
- Room/area
- Measurement type
- Dimension type
- Label
- Category
- Repeat group
- Notes

It loads no production data and guesses no target. The demonstrated flow is:

```text
Reading received
    ↓
User assigns what was measured
    ↓
Observation preview
    ↓
Would create Measurement proposal
```

## Repeat analysis

Valid fixture observations can be grouped locally. `BigInt` fixed-point
arithmetic calculates count, minimum, maximum, mean, absolute spread, and
relative spread. The user can mark a preferred reading. Disagreement is shown
and all observations remain present.

No value is silently averaged into an authoritative result, and every preview
remains `needs_verification`.

## Fifty-reading hardware test procedure

Use `fixtures/hardware-test-readings.csv`. Do not place customer data in it.

Required distribution:

- 10 short indoor readings
- 10 medium indoor readings
- 10 long indoor readings
- 5 repeated identical-target readings
- 5 rapid sequential readings
- 5 unit-switch readings
- 5 disconnect/reconnect readings

For every row record expected physical value, device unit mode, transferred raw
text, parsed value/unit/status, focus state, duplicate state, exact browser,
elapsed transfer time, pass/fail, and notes.

### Environment and pairing checklist

1. Record Windows build, Chrome/Edge versions, Bluetooth adapter, device
   firmware, locales, and keyboard layout.
2. Follow the current official LD 530 BT manual to pair the exact device. Record
   the steps actually used; do not infer steps from another model.
3. Follow the current official manual to enable keypad transfer. Record whether
   paired-device selection, keypad mode, autosend, or device confirmation is
   required.
4. Start the local harness, label the test session, enter firmware, and select
   the expected decimal separator.
5. Arm immediately before each intended transmission.
6. Record digits, separator, unit, Enter, Tab, and other keys actually observed.
7. Repeat the matrix in Chrome and Edge.
8. Test period/comma locales, metric, decimal feet, and feet/inches only when
   the exact device supports them.
9. Test duplicate send, rapid send, focus loss, inactive tab, page refresh,
   browser restart, device power cycle, disconnect/reconnect, and unit switch.
10. Pair/load while online, then use browser offline mode and repeat transfers.
11. Preserve screenshots or screen recordings only with synthetic measurements
    and without device identifiers or unrelated keystrokes.

## Success criteria

A go requires:

- At least 49 of 50 intentionally captured readings arrive complete
- No silent corruption
- Deterministic decimal and unit parsing
- Understandable duplicate behavior
- Recoverable disconnect/reconnect
- Documented Chrome and Edge results
- Offline transfer after pairing/load, if supported
- Obvious armed state and manual fallback
- No unpredictable unrelated-field input during the controlled workflow
- Written vendor commercial-use confirmation or a documented, owned escalation
  still explicitly blocking production release

These are transport-workflow criteria, not an accuracy guarantee.

## No-go criteria

Recommend no-go if formatting, units, locale, focus, duplicates, reconnect,
browser behavior, firmware compatibility, or licensing remains unsafe or
unresolved, or if success requires global keyboard interception.

The fallback order is structured file import, vendor-app export, manual entry,
and later native SDK only with documented vendor support. Reverse engineering is
not an option.

## Security boundaries

- Explicitly armed dedicated input only
- No document/window keyboard listener
- No background capture
- No clipboard monitoring
- No network/API/cloud/telemetry
- No vendor credentials
- No full serial, MAC address, or raw Bluetooth packet
- No persistence
- Bounded input and metadata
- Visible reset/disarm

## Automated test results

At implementation time:

- Parser/analysis/envelope Vitest: **9 passed**
- Isolated local Chromium workflow tests: **2 passed**
- Hardware tests: **BLOCKED**
- Chrome device workflow: **BLOCKED**
- Edge device workflow: **BLOCKED**
- Reconnect/offline/focus physical behavior: **BLOCKED**

Automated tests cover explicit period/comma handling, unit allowlisting,
feet/inches fractions, malformed/multiple/signed/oversized values, control
characters, duplicate classes, Decimal-safe statistics, and bounded envelope
shaping. The local workflow tests cover arm/disarm, Enter termination, valid and
ambiguous previews, mock assignment, reset, and dedicated-input focus loss.

## Results and browser comparison

| Finding | Chrome | Edge |
|---|---|---|
| Pairing reliability | Blocked | Blocked |
| Keypad reading received | Blocked | Blocked |
| Raw format | Not observed | Not observed |
| Unit transmitted | Not observed | Not observed |
| Terminator | Not observed | Not observed |
| Locale behavior | Not observed | Not observed |
| Rapid readings | Blocked | Blocked |
| Focus loss | Blocked | Blocked |
| Disconnect/reconnect | Blocked | Blocked |
| Offline transfer | Blocked | Blocked |

## Firmware, locale, unit, and offline findings

- Firmware: not observed
- Windows/browser locale: not recorded because no hardware session occurred
- Actual units transmitted: unknown
- Decimal separator behavior: unknown
- Offline device transfer: unknown
- Browser restart and pairing persistence: unknown

The parser's accepted formats do not answer these hardware questions.

## Licensing status

STABILA's public material documents keypad-mode transfer into applications, but
written confirmation for MyHomeBro commercial support has not been obtained.

Escalation questions:

1. Is commercial browser capture of LD 530 BT keypad output permitted?
2. May MyHomeBro identify the exact model as supported after testing?
3. Are there trademark/setup-guide requirements?
4. Is keypad output stable across firmware, region, locale, and unit modes?
5. What is the deprecation/support policy?

Licensing/support remains a production blocker.

## Go/no-go decision

**NO DECISION — HARDWARE VALIDATION BLOCKED.**

The harness is ready for the prescribed physical test. It cannot support a go
recommendation without the exact device, recorded firmware/environment, 50-row
evidence, Chrome/Edge comparison, focus/reconnect/offline results, and vendor
commercial-use clarification.

## Production recommendation

Do not add a production route, connection control, API, model, or feature flag.
Continue using manual laser entry universally.

After hardware becomes available, execute this procedure without changing the
success threshold. If it passes, propose a separate production design for one
exact Windows/model/firmware beta. If it fails, move to structured vendor export
or manual entry—not GATT reverse engineering.

## Known limitations

- Synthetic parser fixtures do not represent observed device output.
- The harness cannot control which operating-system application receives
  keyboard-emulated input when browser focus is elsewhere.
- Browser timestamps are not device timestamps.
- Keyboard transport cannot independently prove device identity.
- In-memory UUIDs and duplicate windows are spike behavior only.
- No physical accuracy or latency was evaluated.
- No automated component/browser test simulates real HID input.

## Next step

Acquire or borrow exactly one STABILA LD 530 BT within the approved procurement
process, record its firmware and environment, complete all 50 fixture rows, and
obtain written vendor clarification. Update only the results sections and
evidence fixtures unless the harness itself proves defective.
