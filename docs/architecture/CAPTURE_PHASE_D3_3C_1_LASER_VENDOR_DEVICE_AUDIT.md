# Capture Phase D.3.3C.1: Laser Vendor and Device Feasibility Audit

**Status:** Read-only feasibility decision
**Research date:** 2026-07-26
**Decision owner:** MyHomeBro product and engineering
**Scope:** Laser-distance-meter readings entering the existing Measurement
Foundation. This document does not authorize a production integration.

## Executive summary

MyHomeBro should not promise generic Bluetooth laser support. The audited
manufacturers commonly document Bluetooth connectivity to their own apps, but
none of the current exact candidates reviewed here publishes a sufficiently
clear, public, production-supported GATT contract for a browser integration.
Bluetooth presence therefore does not establish Web Bluetooth feasibility.

The safest first spike is the **STABILA LD 530 BT keyboard-transfer path on
Windows Chrome/Edge**, not custom GATT. STABILA officially documents Bluetooth
5.0, desktop transfer in keypad mode, and direct insertion into applications
such as Excel. The spike can determine whether a focused browser field receives
bounded, repeatable values and units without reverse engineering. It is a
technical-spike candidate, not yet a supported production device.

The backup candidate is **Leica DISTO X6**, whose official manual documents
Bluetooth 5.0, automatic send, keyboard-simulating transfer, DISTO Plan for iOS
and Android, and DISTO Transfer for Windows. The lower-cost **Leica DISTO D2**
is the preferred import/manual-reference candidate because it has broad app and
Windows-transfer support, but no public Web Bluetooth protocol was established.

Recommended release order:

1. Keep the existing manual laser entry as the universal path.
2. Run one time-boxed STABILA LD 530 BT keyboard-input spike.
3. If reliable, ship a post-launch Windows/desktop beta explicitly labeled for
   that device and mode.
4. Consider bounded vendor-app imports after real export samples are obtained.
5. Defer native BLE until MyHomeBro has a native-app decision and written vendor
   protocol/SDK licensing.

D.3.3C is a **post-launch beta**, not a launch dependency.

## Repository findings

### Files inspected

- `backend/projects/models_measurement.py`
- `backend/projects/serializers/measurement.py`
- `backend/projects/views/measurement.py`
- `backend/projects/views/capture.py`
- `backend/projects/models_capture.py`
- `backend/projects/services/capture_measurement.py`
- `backend/projects/services/capture_permissions.py`
- `backend/projects/views/takeoff.py`
- `backend/projects/models_takeoff.py`
- `backend/projects/serializers/takeoff.py`
- `backend/projects/tests_capture_measurement.py`
- `backend/projects/tests_measurement_calculations.py`
- `backend/projects/tests_takeoff_api.py`
- `frontend/src/components/capture/MeasurementCaptureForm.jsx`
- `frontend/src/pages/MeasurementSessionPage.jsx`
- `frontend/src/pages/TakeoffSessionPage.jsx`
- `frontend/src/api/captures.js`
- `frontend/src/serviceWorker.js`
- `frontend/src/swOFF.js`
- `frontend/vite.config.js`
- `frontend/package.json`
- `backend/core/settings.py`
- `docs/architecture/CAPTURE_PHASE_D3_1_MEASUREMENT_FOUNDATION.md`
- `docs/architecture/CAPTURE_PHASE_D3_2_INTELLIGENT_TAKEOFF.md`
- `docs/architecture/CAPTURE_PHASE_D3_3A_BLUEPRINT_PDF_TAKEOFF.md`
- `docs/architecture/CAPTURE_PHASE_D3_3B_PHOTO_ASSISTED_MEASUREMENT.md`
- `docs/design-system/MYHOMEBRO_DESIGN_SYSTEM.md`
- `docs/architecture/MYHOMEBRO_ENGINEERING_PRINCIPLES.md`

### Existing architecture

`MeasurementEntry` already has the necessary durable columns:

- `client_key` with a session-scoped uniqueness constraint
- `reading_group`
- raw and normalized Decimal values
- unit and dimension type
- source method and bounded tool description
- verification status and confidence
- bounded application-owned `source_metadata`
- selected/rejected calculation state
- actor and source/verification timestamps

`MeasurementEvent` supplies append-only audit history. `MeasurementSession`
remains authoritative. Takeoff already treats results outside `verified` or
`confirmed` as provisional, and Estimate preview does not receive silent
mutations.

Manual laser entry already exists as `laser_manual_entry`. The current UI also
supports repeat groups and optional reference photos.

### Can laser observations fit without a migration?

**For a spike: yes.** A spike needs no persistence. A production service can
also store a bounded laser envelope within existing `source_metadata`, raw
value, normalized value, reading group, actor, and timestamps.

**For a production direct/import source: probably one small choices-only
change.** Reusing `laser_manual_entry` for a direct device transmission would
misstate provenance. Adding `bluetooth_laser` or `vendor_app_import` to the
model choices can cause a Django state migration even though no database column
is required. No new model is justified unless retained import artifacts or
provider-specific receipts cannot be represented by existing Capture artifacts.

The frontend has React/Vite and Chromium Playwright, but no Bluetooth library or
native wrapper. `vite-plugin-pwa` is installed but not configured in
`vite.config.js`; service-worker code actively unregisters workers and clears
caches. MyHomeBro is therefore responsive web, not currently an offline-capable
installed PWA. No Capacitor code exists.

## Manufacturer and exact-device capability matrix

`Not documented` means the official material reviewed did not establish the
capability. It must not be interpreted as impossible.

| Manufacturer / exact model | Range / claimed accuracy | Connectivity and official software | Public GATT / SDK / cloud API | Export or handoff | Position | Classification / confidence |
|---|---|---|---|---|---|---|
| STABILA LD 530 BT | 200 m / accuracy not stated in reviewed press release | BLE 5.0; Measures II iOS/Android; keypad mode to desktop apps | Not documented / none found / none found | PDF/ZIP share through app; keypad transfer to Excel | Premium connected | **Technical-spike candidate — medium-high** |
| STABILA LD 250 BT | 50 m / ±2 mm | BLE Smart 4.0; Measures II iOS/Android | Not documented / none found / none found | App shares PDF/ZIP | Mid-price connected | Import/manual candidate — medium |
| Leica DISTO X6 | 250 m / ±1 mm favorable | BLE 5.0; DISTO Plan iOS/Android; DISTO Transfer Windows; keyboard simulation; USB-C reports | Public GATT not found; developer/partner terms unresolved | PDF/CAD reports; keyboard transfer; Windows transfer | High premium | **Backup spike — medium-high** |
| Leica DISTO D2 | 100 m / ±1.5 mm favorable | BLE Smart 4.0; DISTO Plan iOS/Android; DISTO Transfer Windows | Public GATT not found; SDK access/licensing not established | App reports and Windows transfer | Accessible professional | **Import-only candidate — medium-high** |
| Bosch GLM 50-27 CG | 50 m / ±1.5 mm typical | BLE 4.2 GATT-capable; Bosch MeasureOn iOS/Android | No public measurement GATT or public SDK established | MeasureOn documentation/report transfer; exact structured export unresolved | Mid-price rugged | Defer pending protocol — high |
| Hilti PD-I | 100 m / ±1.5 mm | Bluetooth; documented partner apps | No public GATT/SDK/API established | Partner-app handoff only in reviewed source | Premium; official US price observed $489 | Defer/partner opportunity — high |
| Hilti PD-C / PD-CS | Model manual: ±1 mm | Android-based meter; Bluetooth/WLAN/micro-USB file transfer | No public device SDK established | Projects PDF/CSV; JPG for picture results; USB; Apple Bluetooth file transfer explicitly unsupported | Legacy premium/documentation device | Import-only if still supported — medium |
| DeWalt DW0330SN | 100 m / accuracy not clearly stated on current page | Bluetooth Tool Connect hardware | No public GATT/SDK/API found | **Official page says app connectivity is no longer supported** | Legacy connected | **Not recommended — high** |
| DeWalt DW099S | 100 ft / not stated on current page | Bluetooth marking present | No public GATT/SDK/API found | Official product page does not establish a working app/export path | Entry connected/legacy | Manual-entry-only — medium |
| STANLEY TLM99s / TLM99si | Exact range/accuracy in manual; Bluetooth models | STANLEY Smart Connect iOS/Android | No public GATT/SDK/API found | Floor plan export PDF, DXF, JPG; email/print | Legacy connected | Import-only, verify app lifecycle — medium |
| Klein Tools 93LDM100C | 100 ft / ±1/16 in to ~33 ft, ±1/8 in thereafter | None documented | None | Manual display only | Budget, roughly $40–$60 official retailer links | Manual-entry-only — high |
| Makita LD080P | 262 ft / ±1/16 in | None documented | None | Manual display only | Professional manual | Manual-entry-only — high |
| Fluke 424D | 100 m / +1 mm claim | None documented | None | Manual display only | Premium manual; official observed price $643.99 | Manual-entry-only — high |
| Milwaukee 3701-21 | 2,000 ft diameter receiver range / 3/32 in at 100 ft | ONE-KEY is tool tracking/management, not distance-reading transfer | No reading API established | No distance-reading export | Rotary level, wrong product category | Not recommended — high |
| Huepar 603CG | 130 ft line-laser range | Bluetooth app controls laser lines; it is not a distance meter | No measurement-data interface established | None relevant | Line laser, wrong product category | Not recommended — high |

No current connected distance-meter candidate was found from Milwaukee, Huepar,
Klein, Makita, or Fluke with official evidence of transferable distance readings.
They remain useful manual tools, not integration candidates.

## Platform support matrix

| Platform | Web Bluetooth | Keyboard/file/import path | Native future path | Recommendation |
|---|---|---|---|---|
| Android Chrome | Supported subset for BLE in secure contexts, but only usable with documented GATT | Vendor app, Android share/clipboard/file where vendor exposes it | Android BLE with Nearby Devices permissions | Possible spike only after protocol authorization |
| Android installed PWA | Same browser engine/capabilities as Chrome; no added protocol access | Web Share/File APIs remain vendor/export dependent | None merely from installation | Do not market separately from Android Chrome |
| Windows Chrome | Chromium Web Bluetooth supported; adapter/OS/firmware dependent | Strongest keyboard and vendor desktop-transfer options | Desktop native app possible but out of scope | Preferred initial spike platform |
| Windows Edge | Chromium path comparable to Chrome; hardware testing required | Same strong keyboard/file options | Desktop native possible | Secondary spike browser |
| macOS Chrome | Chromium documents BLE support | Keyboard mode may work; vendor desktop support is weaker than Windows | Core Bluetooth native possible | Hardware-test only |
| macOS Safari | Web Bluetooth unavailable in reviewed compatibility material | Keyboard and file imports may work independently | Core Bluetooth in a native macOS app | No direct web device integration |
| iPhone Safari | Web Bluetooth unavailable | Vendor app share/file/clipboard only when explicitly exposed | Core Bluetooth native app | Manual/import only in web |
| iPhone installed web app | Does not gain Web Bluetooth unavailable to Safari | Same vendor handoff limitations | Not native without wrapper/App Store app | Manual/import only |
| iPad Safari / web app | Same as iPhone Safari | Vendor app documents/reports may be imported manually | Core Bluetooth native app | Manual/import only |
| Future Capacitor wrapper | Web view alone does not solve BLE; a maintained native plugin and protocol are required | Native share/file receive can be added | Android BLE/Core Bluetooth with App Store/Play distribution | Revisit only after native strategy |
| Firefox desktop/mobile | Web Bluetooth not a dependable supported production path | File/clipboard/manual only | N/A | Unsupported for direct connection |

## Web Bluetooth findings

Web Bluetooth is experimental and not Baseline. It is BLE/GATT only, requires
HTTPS, an explicit user gesture, transient activation, and a browser device
chooser. Previously granted devices can sometimes be enumerated with
`getDevices()`, but reconnect, permission persistence, OS pairing, adapter
behavior, and firmware must be tested.

A web app can subscribe to characteristic notifications or read/write
characteristics only after it knows the service and characteristic UUIDs and
the vendor's byte-level data contract. The Bluetooth logo, “Bluetooth Smart,”
or confirmation that a device uses GATT is not that contract.

For every candidate in this audit, a public, current, vendor-supported
measurement GATT contract was not established. Web Bluetooth must therefore
remain disabled outside an isolated experiment. No reverse-engineered UUIDs or
community libraries may be used as production evidence.

The user should connect explicitly, see the selected supported model, disconnect
explicitly, and receive “Enter reading manually” after chooser cancellation,
permission denial, disconnect, parse failure, or unsupported firmware.

## iOS and iPadOS

Safari and installed iOS/iPadOS web apps do not provide the required Web
Bluetooth path. Installing a PWA does not add Core Bluetooth.

Direct BLE on Apple platforms requires a native application using Core
Bluetooth, appropriate privacy descriptions, foreground-first interaction, and
App Store distribution. Background execution is constrained; declaring
`bluetooth-central` changes behavior but does not guarantee indefinite
background processing.

Leica and STABILA document iOS vendor apps. That establishes vendor-app
compatibility, not a share-sheet, deep-link, Shortcuts, or MyHomeBro SDK
contract. No official deep link or URL callback was found. DISTO X6 keyboard
simulation may type into an active field, but this must be physically tested and
does not prove trusted device provenance.

No vendor-specific Apple entitlement was identified for ordinary BLE. A vendor
SDK or proprietary accessory program could impose separate terms; those remain
unresolved.

## Android

Chrome supports a subset of Web Bluetooth on Android, and an installed PWA uses
the same browser capability. A documented GATT contract remains mandatory.

A future native wrapper targeting Android 12+ would request
`BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` as Nearby Devices runtime permissions.
Legacy Android versions can require location permission for scanning. MyHomeBro
should assert `neverForLocation` only if the implementation genuinely never
derives location.

Native background scanning and reconnection carry additional platform
restrictions and are unnecessary for a user-driven measurement workflow.
Connection should remain foreground and task scoped.

## Desktop

Windows has the best near-term value because STABILA and Leica officially
document keyboard or DISTO Transfer paths. Chrome and Edge can host a focused
input field without native packaging. Bluetooth adapters, OS pairing, locale,
unit formatting, decimal separators, and firmware remain test variables.

macOS Chrome supports Web Bluetooth at the browser layer, but the missing
vendor GATT contract still blocks a supported direct integration. Keyboard
simulation may be viable. Safari is not a Web Bluetooth path. USB should be
treated as a file-transfer option only where the manufacturer documents it.

## Vendor-app import findings

Ranked paths:

1. Documented direct device integration — no production-ready public protocol
   established during this audit.
2. Structured file import — strongest auditable fallback when an exact schema
   and sample are available.
3. Share-sheet import — useful in a future native wrapper, but no vendor-specific
   MyHomeBro handoff is documented.
4. Clipboard/keyboard import — low engineering cost, moderate ambiguity, weak
   provenance.
5. Manual entry — universal, already present, and mandatory.

Officially established examples:

- Hilti PD-C/PD-CS exports projects as PDF or CSV and picture results as JPG,
  and supports micro-USB transfer.
- Leica DISTO Plan reports can be exported as CAD-compatible files or PDF.
- Leica X6 supports keyboard-simulating transfer and Windows DISTO Transfer.
- STABILA Measures II shares projects/drawings, including PDF/ZIP, while the LD
  530 BT adds keypad-mode transfer.
- STANLEY TLM99s/TLM99si floor plans export as PDF, DXF, or JPG.
- DeWalt DW0330SN must not be targeted because its current official page says
  Tool Connect app connectivity is no longer supported.

PDF/JPG drawings are not structured readings. They are evidence artifacts and
must not be silently parsed into measurements.

## SDK and licensing findings

No candidate has a public SDK with sufficiently clear current supported-model
list, commercial-use license, distribution terms, maintenance commitment, and
sample application to approve production use.

Leica lists certified software partners and interoperable applications, which
signals a partner ecosystem but does not itself grant MyHomeBro protocol or SDK
rights. Bosch, Hilti, STABILA, DeWalt, and STANLEY reviewed materials document
apps rather than public developer contracts.

Before any native/direct commitment, obtain written answers for:

- protocol/SDK access and exact models/firmware
- commercial SaaS use and redistribution
- attribution and branding
- app-store distribution
- support/SLA and deprecation policy
- offline operation and telemetry
- device identifier access
- test-device/firmware availability

Unknown licensing is a no-go for production, even if a technical experiment
works.

## Weighted device selection

Weights: documented transferable behavior 25, cross-platform path 15, offline
operation 10, device reliability 10, availability/price 10, documentation 10,
licensing clarity 10, fallback/export 5, likely contractor usability 5.
Scores are directional evidence bands, not procurement precision.

| Candidate | Score / 100 | Evidence summary |
|---|---:|---|
| STABILA LD 530 BT | 72 | Official keypad transfer, desktop and mobile app paths, current product; protocol/licensing gap remains |
| Leica DISTO X6 | 70 | Strong documented keyboard/app/Windows behavior and excellent device capability; high price and partner terms unresolved |
| Leica DISTO D2 | 64 | Accessible, established mobile/Windows ecosystem; less explicit generic keyboard path and no public GATT |
| STABILA LD 250 BT | 57 | Affordable connected model and good app, but weaker desktop/direct handoff evidence |
| Bosch GLM 50-27 CG | 53 | Rugged and popular connected device; MeasureOn-only evidence and no public protocol |
| Hilti PD-I | 48 | Strong tool and partner-app support, but expensive with no public protocol/export contract |
| Hilti PD-C/PD-CS | 46 | Best CSV evidence, but older specialized hardware and uncertain current commercial fit |
| STANLEY TLM99s/TLM99si | 40 | Exportable plans, but lifecycle/protocol uncertainty |
| DeWalt DW0330SN | 20 | Current official discontinuation of app connectivity |

## Recommended first spike device

**Device:** STABILA LD 530 BT
**Hardware:** one retail US-market LD 530 BT and a Bluetooth-capable Windows
10/11 laptop
**Platform:** current stable Chrome first, Edge second
**Protocol/path:** manufacturer-documented Bluetooth 5.0 keypad mode
**Procurement ceiling:** **$450 USD before tax**; if unavailable below that
ceiling, do not substitute another model without reopening the decision
**Licensing:** ordinary keyboard input appears not to require an SDK, but written
vendor confirmation is required before production marketing
**Fallback:** manual laser entry with optional display photo

Expected flow: the user clicks “Receive reading,” focuses a single-purpose
field, activates keypad transfer on the device, sees raw characters captured,
reviews parsed value/unit/device selection, assigns the target, and explicitly
creates a Measurement proposal.

Success criteria:

- 50 consecutive readings received without lost or concatenated characters
- feet/inches and metric formats correctly identified or safely rejected
- duplicate send recognized without deleting either raw observation
- disconnect and reconnect detected or clearly recoverable
- no reading accepted when the capture field is not armed
- Chrome and Edge results documented
- browser works without network after the spike page is already loaded
- exact firmware recorded
- STABILA confirms commercial keyboard-mode use is permissible

Failure criteria:

- undocumented BLE access is required
- keyboard transfer cannot be reliably scoped to the armed field
- units are omitted or ambiguous
- firmware/locale changes make parsing unsafe
- duplicates cannot be distinguished
- vendor declines or does not clarify commercial support

## Backup and import-only candidates

**Backup technical spike:** Leica DISTO X6 keyboard-simulating Bluetooth on
Windows Chrome. It is more expensive, but its official manual is unusually
explicit about autosend, keyboard simulation, DISTO Plan, and DISTO Transfer.

**Import-only candidate:** Leica DISTO D2 via reviewed DISTO Plan/Transfer
exports. Require real exported samples before specifying a parser; PDF/CAD
reports may be attach-only evidence rather than row imports.

**Defer:** Bosch GLM family, Hilti PD-I, STABILA LD 250 BT direct GATT, STANLEY
TLM family, and every vendor-native SDK until documented protocol and licensing
exist. Do not target DeWalt DW0330SN. Treat Milwaukee/Huepar line or rotary
lasers and manual-only Klein/Makita/Fluke devices as outside direct integration.

## Bounded laser observation contract

```json
{
  "schema_version": "measurement-source.v1",
  "idempotency_key": "client-generated opaque UUID",
  "provider_key": "laser_keyboard",
  "provider_version": "stabila-ld530bt-keypad.v1",
  "vendor": "stabila",
  "device_model": "ld_530_bt",
  "device_identifier_suffix": "",
  "firmware_version": "",
  "raw_value": "12.438 m",
  "reported_unit": "meters",
  "normalized_value": "12.4380000000",
  "normalized_unit": "meters",
  "captured_at": null,
  "received_at": "server timestamp",
  "connection_method": "bluetooth_keyboard",
  "warnings": [],
  "evidence": {
    "transport_direct": true,
    "target_assigned_by_user": true,
    "supported_model_selected": true
  },
  "verification_status": "needs_verification",
  "artifact_ids": []
}
```

Required: schema and provider versions, idempotency key, allowlisted provider,
vendor/model, immutable raw value, reported and normalized unit/value,
server-received timestamp, connection method, user target assignment, actor,
contractor, and Measurement Session.

Optional: firmware, device-reported timestamp, last 4–6 serial characters,
bounded warnings/evidence, protected artifact IDs. Never accept arbitrary nested
vendor payloads, Bluetooth packet dumps, full serial by default, MAC address,
location, account tokens, or executable/import formulas.

Server rules:

- Normalize with Decimal and existing units.
- Reject NaN, infinity, non-positive/out-of-range distances, ambiguous mixed
  units, unknown fields, unsupported provider/model/firmware, and timestamps
  materially in the future.
- The server assigns `received_at`; device `captured_at` is evidence only.
- Hash the normalized contractor/session/provider/raw/timestamp bucket for
  duplicate warning; use the idempotency key for exact replay protection.
- A duplicate is shown and preserved or explicitly rejected; never averaged.
- Firmware changes cannot silently select a new provider parser version.
- Store only a truncated, user-visible serial suffix when needed to distinguish
  devices.

## User assignment workflow

1. Connect/import or choose manual entry.
2. Arm one reading field and display the supported model/source.
3. Receive and freeze the raw value.
4. Show parsed value and units for confirmation.
5. Select the existing project and Measurement Session.
6. Assign room/area, dimension type, label, category, and optional wall/opening/
   floor/linear-run context.
7. Compare prior readings in the same reading group.
8. Choose the preferred observation without deleting alternatives.
9. Confirm a `needs_verification` proposal.
10. Review it through the existing Measurement Session and downstream rules.

No numeric value may guess its target. Project Assistant may later suggest a
label, but never apply one silently.

## Repeated readings

Every device send is an immutable observation with its own client/idempotency
key, actor, receive time, raw value, unit, and parser version. `reading_group`
associates attempts.

The existing deterministic repeat service should calculate minimum, maximum,
mean, absolute spread, and relative spread. The UI identifies the preferred and
rejected attempts. Conflicting values are never silently averaged. Unit changes
must normalize compatibly or split the group with a warning.

Bluetooth provenance can strengthen evidence but does not verify device
placement, target assignment, beam path, reflectivity, calibration, or operator
technique.

## Confidence and verification recommendation

- Manual transcription: `needs_verification`; lowest provenance evidence.
- Clipboard/file from an unknown or unvalidated schema: estimated or
  `needs_verification`.
- Supported keyboard/direct model with valid parser, unit, in-range result, and
  target assignment: medium/high estimate evidence, still
  `needs_verification`.
- Repeated supported-device readings within an approved tolerance: stronger
  repeatability evidence, never independently sufficient for `verified`.
- `verified`: require an authorized person to review target assignment and
  context plus either an approved corroborating measurement, controlled
  supervisor verification, or an approved policy that explicitly treats a
  calibrated supported laser reading as the independent physical source.

Recommended initial policy: a contractor owner or supervisor with current
Measurement verification capability may verify after reviewing the target and
at least two agreeing readings. Field employees may record readings but may not
override verification safeguards.

## Manual fallback

Manual laser entry remains independent of every flag and platform. Extend its
future UX—not in this audit—with optional brand, model, serial suffix,
measurement time, repeat group, device-display photo, and notes.

A device-display photo should be **optional**, except when organizational policy
requires evidence for supervisor verification. Every error state must offer
“Enter reading manually.”

## File, clipboard, and share imports

Clipboard accepts one armed reading, preserves raw text, previews the parse, and
rejects multiple/ambiguous values. Pasted content is text only.

A future CSV contract should allow only:

`external_row_id, raw_value, unit, captured_at, device_model, label`

Limit bytes and rows, decode as text, reject formulas beginning with `=`, `+`,
`-`, or `@` on future export, preview every row, and require target assignment.
Unknown columns can be ignored only after an explicit warning; unknown units
fail the row. Retain the original file as a contractor-scoped Capture artifact
when it is audit evidence.

A future native share extension must use a short-lived, one-use server nonce.
Never put authentication tokens or readings in callback URLs. Source-app
identity is untrusted.

## Security and privacy

- Ask for Bluetooth/nearby-device permission only after a user action.
- Scope every observation, artifact, session, and proposal by contractor and
  project authorization.
- Do not retain MAC addresses or full serials by default.
- Do not log raw packets, clipboard contents, nearby-device lists, readings, or
  vendor account data.
- Use bounded allowlists for provider, model, firmware, units, metadata,
  warnings, evidence, and file columns.
- Normalize and recalculate server-side.
- Use client idempotency plus duplicate warnings against replay.
- Treat imported files, clipboard, deep links, and device metadata as untrusted.
- Do not require vendor-cloud login. If later considered, require a separate
  privacy, OAuth scope, retention, account-leakage, deletion, and availability
  review.
- Provide explicit disconnect and forget-device controls.

## Offline and PWA implications

Current MyHomeBro has no active service worker or offline mutation queue.
Responsive web can accept manual/keyboard readings only while the page and
session are available; saving requires network. An installed PWA would not add
iOS Web Bluetooth or background BLE.

Future offline work needs encrypted device-local pending proposals,
contractor/session binding, idempotency, expiration, logout deletion, conflict
resolution, and duplicate-safe sync. Direct BLE in a native wrapper can operate
without network, but server acceptance remains pending. No background sync or
connection is assumed.

## Feature-flag recommendation

Future flags, all default off:

- `MEASUREMENT_LASER_INTEGRATION_ENABLED`
- `MEASUREMENT_LASER_WEB_BLUETOOTH_ENABLED`
- `MEASUREMENT_LASER_IMPORT_ENABLED`
- `MEASUREMENT_LASER_NATIVE_ENABLED`
- frontend equivalents prefixed `VITE_`

Add an exact server allowlist such as
`MEASUREMENT_LASER_SUPPORTED_PROVIDERS=stabila_ld530bt_keypad_v1`; flags alone
must never imply platform/device support. Runtime capability detection and an
exact compatibility disclosure are mandatory. Manual laser entry remains
unflagged.

## Technical spike plan

Location: a gitignored or separately reviewed development harness under
`spikes/laser-keyboard/`, with no production route, API, database, or analytics.
It may be a static HTTPS page using only browser events.

Time-box: two engineering days after hardware arrival, plus vendor licensing
response time. Hardware: one STABILA LD 530 BT. Test Chrome/Edge on Windows,
then macOS Chrome opportunistically.

Test script:

1. Record model, region, firmware, OS, adapter, browser.
2. Pair exactly as the official manual specifies.
3. Test 25 metric and 25 US-unit readings.
4. Test rapid sequential sends, duplicate sends, focus loss, chooser/cancel,
   disconnect, power-off, reconnect, unit switch, decimal locale, and offline.
5. Confirm no characters enter unarmed fields.
6. Record screen capture with synthetic/non-customer measurements; do not log
   identifiers or customer interiors.
7. Ask STABILA for written commercial-use confirmation.
8. Produce a compatibility report with raw test cases, failures, firmware, and
   go/no-go recommendation.

Go only if all success criteria in the device recommendation pass. Otherwise
retain manual entry and evaluate Leica X6 once—do not pivot to reverse
engineering.

## Production implementation options

| Option | Reach/reliability | Complexity/support/licensing | Offline | Timing |
|---|---|---|---|---|
| A. Chromium Web Bluetooth | Android + Chromium desktop, excludes iOS/Safari/Firefox; currently blocked by protocol evidence | Medium-high support burden; vendor protocol required | Foreground possible | Do not schedule |
| B. Vendor SDK via Capacitor | Best BLE reach on Android/iOS if SDK exists | Highest complexity, App Store/Play, permissions and unknown licenses | Yes, with pending sync | After native strategy/vendor agreement |
| C. Structured file import | Broad platform reach; deterministic if schema is stable | Moderate parser/version/support burden | Select locally; save later | Best post-manual candidate |
| D. Native share sheet | Good mobile UX | Requires native distribution and secure handoff | Yes, pending sync | Native phase |
| E. Clipboard/keyboard | Broad, inexpensive, weak provenance and focus risk | Low-medium; strict arming/parser required | Page-local | First spike/beta |
| F. Manual only | Universal and already shipped | Lowest risk/support | Current save still online | Launch baseline |

Recommendation: launch with manual entry, run one keyboard spike, then choose
either a single-device desktop beta or structured import. Do not delay launch
for generic Bluetooth and do not build a native wrapper solely for lasers.

## Future test strategy

Unit: provider envelope, Decimal unit normalization, bounds, duplicate/replay,
timestamps, identifier minimization, clipboard/CSV parsing, formula injection,
confidence caps, and repeat statistics.

API: contractor/project scope, unsupported provider/model/firmware/unit,
forged metadata, idempotency, replay, stale session, target assignment,
proposal creation, and proof of no Takeoff/Estimate mutation.

Frontend: feature/capability detection, unsupported browser, chooser cancel,
permission denial, connect/disconnect/reconnect, armed-field behavior, reading
and duplicate receipt, manual fallback, assignment, repeats, and save errors.

Hardware: exact primary and backup devices, firmware variants, Windows
Chrome/Edge, Android Chrome only after a documented protocol, macOS Chrome
opportunistically, unit/locale changes, battery/power-off, and radio loss.

Physical validation: short/long walls, openings, heights, repeated readings,
low reflectivity, bright conditions, angled placement, wrong target assignment,
and independently recorded ground truth. Do not convert device accuracy claims
into MyHomeBro accuracy claims.

## Product positioning

Use: **“Import readings from supported laser devices (beta). Check your model
and platform before starting. You still assign and verify what was measured.”**

Setup pages must name exact model, firmware caveats, operating system/browser,
connection mode, manual fallback, and verification policy. Avoid “connect any
laser,” “automatically verified,” “all Bluetooth meters,” and accuracy
guarantees.

## Prelaunch recommendation

D.3.3C is a **post-launch beta**. Existing manual entry covers the essential
contract without platform fragmentation, hardware procurement, vendor licensing,
or support risk. A vendor partnership could materially improve confidence and
should be explored after the spike, but is not a launch blocker.

## Open product decisions and recommendations

| Decision | Recommendation |
|---|---|
| Preferred manufacturer | STABILA for first contact/spike; Leica as backup ecosystem |
| Exact first device | STABILA LD 530 BT |
| Maximum supported-device price | $450 USD pre-tax for the first strategy |
| Sell hardware? | No. Publish an exact compatibility list and independent retail links; avoid inventory/warranty obligations |
| Recommend hardware? | Only after spike and vendor confirmation; disclose no commercial endorsement unless contracted |
| Free or premium? | Manual entry free; device integration beta free initially, premium only after reliability/support value is proven |
| Require display photo? | Optional; configurable requirement for supervisor verification |
| Can direct Bluetooth be verified automatically? | No |
| Who confirms? | Contractor owner or supervisor/authorized estimator under existing Measurement permissions |
| Retain full serial? | No; optional last 4–6 characters only |
| Vendor cloud accounts acceptable? | No for initial integration; revisit through separate security/privacy review |
| App-store distribution acceptable? | Yes only as part of a broader native strategy, not solely for laser support |
| One-platform initial support? | Yes, if explicitly labeled Windows Chrome/Edge beta and manual entry remains universal |
| Release timing | Post-launch beta |

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Bluetooth logo mistaken for accessible readings | Exact allowlist and official protocol requirement |
| Keyboard input reaches wrong field | Explicit armed field, timeout, visible source, confirmation, and no background capture |
| Wrong target assignment | Mandatory user assignment and review |
| Duplicate or rapid readings | Idempotency keys, duplicate warning, immutable observations |
| Firmware/locale changes | Provider parser version and firmware/locale compatibility matrix |
| iOS exclusion | Manual entry and vendor-file fallback; no PWA overclaim |
| Vendor app/service retirement | Manual fallback; DeWalt precedent included in review |
| Licensing ambiguity | Written vendor authorization before production |
| Forged provider metadata | Server allowlist and confidence cap; do not treat transport as verification |
| Sensitive identifiers/location | Truncated identifiers, no MAC/location/raw-packet logs |
| Offline loss/conflict | No offline claim until encrypted, duplicate-safe queue exists |
| Support burden | One model/platform beta, telemetry-minimal compatibility reports |

## Official sources

All technical conclusions above use primary sources. Dates are included where
the source exposed them; otherwise the audit records the research date.

### Platform

- [Chrome: Communicating with Bluetooth devices over JavaScript](https://developer.chrome.com/docs/capabilities/bluetooth)
  — secure context, user gesture, chooser, BLE/GATT, notifications, disconnect,
  Android/macOS/Windows Chromium support.
- [MDN: Web Bluetooth API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
  — experimental/limited availability, security and Permissions Policy; updated
  2025-05-27.
- [Android Developers: Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)
  — Android 12+ Nearby Devices permissions and legacy location behavior.
- [Apple: About Core Bluetooth](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/AboutCoreBluetooth/Introduction.html)
  — native BLE roles and iOS background limitations.

### STABILA

- [LD 530 BT official announcement](https://www.stabila.com/en/service/press-releases/09-2025-ld-530-bt-laser-distance-measurer-from-stabila-high-performance-distance-measurement-indoors-and-outdoors.html)
  — Bluetooth 5.0, keypad mode, desktop/Excel, Measures II; 2025-09.
- [STABILA Measures II](https://www.stabila.com/en-US/products-553/details/stabila-measures-ii-measurement-app.html)
  — iOS/Android, compatible models, PDF/ZIP sharing and offline tutorials.
- [STABILA LD 250 BT](https://www.stabila.com/en/products/details/ld-250-bt-laser-distance-measurer-with-bluetooth-smart-4-0.html)
  — exact range, accuracy, BLE version, app.

### Leica Geosystems

- [Leica DISTO X6 product data sheet](https://shop.leica-geosystems.com/sites/default/files/2023-10/Leica%20DISTO%20X6%20data-sheet_2307_V1.0_EN.pdf)
  — range, accuracy, BLE 5.0, keyboard simulation, app/Windows software.
- [Leica DISTO X6 user manual](https://shop.leica-geosystems.com/sites/default/files/2025-03/979590_Leica_DISTO_X6_UM_1-2-0_en_small.pdf)
  — autosend, keyboard behavior, DISTO Plan, DISTO Transfer, USB-C.
- [Leica DISTO D2 data sheet](https://shop.leica-geosystems.com/sites/default/files/2022-01/Leica%20DISTO%20D2%20data-sheet_2201_V1.0_EN.pdf)
  — range, accuracy, BLE 4.0, apps and Windows transfer.
- [Leica DISTO product overview](https://shop.leica-geosystems.com/measurement-tools/disto/leica-disto-overview)
  — CAD/PDF report export.
- [Leica certified software partners](https://shop.leica-geosystems.com/measurement-tools/disto/blog/software-partners)
  — partner ecosystem; 2019-03-12.

### Bosch

- [Bosch GLM 50-27 CG product page](https://www.bosch-professional.com/gb/en/products/glm-50-27-cg-0601072U00)
  — range, typical accuracy, BLE 4.2, MeasureOn.
- [Bosch GLM 50-27 C/CG manual](https://www.bosch-professional.com/binary/manualsmedia/o454089v21_160992A8LH_202403.pdf)
  — exact technical data and GATT-capable BLE note; 2024-02-22.

### Hilti

- [Hilti PD-I](https://www.hilti.com/c/CLS_MEA_TOOL_INSERT_7127/CLS_LASER_METERS_7127/r9121031)
  — range, accuracy, Bluetooth, partner applications and current price.
- [Hilti PD-C/PD-CS manual](https://www.hilti.com/medias/sys_master/documents/hb6/hf4/10019037020190/Operating-Instruction-PD-C-PD-CS-01-ENEN-US-Operating-Instruction-PUB-5270043-000.pdf)
  — PDF/CSV/JPG export, Bluetooth/WLAN/USB and Apple transfer limitation.

### DeWalt, STANLEY, Klein, Makita, Fluke, Milwaukee, Huepar

- [DeWalt DW0330SN](https://www.dewalt.com/en-us/product/dw0330sn/330-ft-100m-bluetooth-laser-measure-tooldistance-meter)
  — current official warning that Tool Connect app connectivity is unsupported.
- [DeWalt DW099S](https://www.dewalt.com/en-us/product/dw099s/100-ft-laser-distance-measurer)
  — exact model/product capabilities.
- [STANLEY TLM99 family manual](https://support.stanleytools.com/hc/es/article_attachments/360018533193)
  — Bluetooth app workflow and PDF/DXF/JPG export.
- [Klein 93LDM100C](https://www.kleintools.com/catalog/laser-distance-measures/compact-laser-distance-measurer)
  — range, accuracy, units and manual-only capabilities.
- [Makita LD080P](https://makitatools.com/products/details/LD080P)
  — range and manual tool features.
- [Fluke 424D](https://www.fluke.com/en-us/product/building-infrastructure/laser-distance-meters/fluke-424d)
  — range, accuracy and current official price.
- [Milwaukee 3701-21](https://www.milwaukeetool.com/3701-21)
  — rotary-level capability and ONE-KEY tracking purpose.
- [Huepar 603CG](https://huepar.com/products/huepar-603lp)
  — app controls a line laser rather than transferring distance readings.

## Audit boundary confirmation

This audit added only this architecture document. It did not implement
Bluetooth, add dependencies, create migrations, add routes or UI, modify feature
flags, alter manual laser behavior, purchase hardware, reverse engineer a
protocol, or mutate Measurement, Capture, Takeoff, Estimate, PWA,
authentication, or project workflows.
