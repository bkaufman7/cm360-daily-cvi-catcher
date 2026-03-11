# ARCHITECTURE MAP

## 1. One-Page System Map
System purpose:
- Daily CM360/DCM click-integrity monitoring automation.
- Ingests report attachments from Gmail, detects high-risk click/impression anomalies, publishes spreadsheet outputs, and sends operator-facing report emails.

Main inputs:
- Gmail threads with label `DCM Reports` and dated query windows.
- CSV and ZIP attachments containing CSV report payloads.
- Spreadsheet tabs: `Networks`, `Email List`, `Removed Networks`.
- Reply email command text: `REMOVE NETWORK <id>`.

Main outputs:
- Spreadsheet tabs: `Data`, `Output`, `3K Output`, `Removed Networks`.
- Main daily alert email (12.5K threshold) with optional CSV attachment.
- Secondary daily alert email (3K threshold) with optional CSV attachment.
- Admin confirmation/error emails.

Core modules (logical, all in one file):
- Config and logging.
- Trigger/UI menu.
- Ingestion/parsing (Gmail + CSV/ZIP).
- Governance (removal command processing + audit).
- Rule filtering/transformation.
- Notification/report rendering.
- Network catalog maintenance.

Execution flow:
- Trigger/menu run -> import/removal/report function -> Gmail + Sheet reads -> parse + normalize -> rule filters -> sheet writes -> email sends -> logs.

Operator touchpoints:
- Spreadsheet custom menu `DCM Reports`.
- Daily report emails with removal instructions.
- Reply-based command channel for network deactivation.
- Spreadsheet tabs as operational control/config surface.

External dependencies:
- Google Apps Script runtime (V8).
- GmailApp, MailApp, SpreadsheetApp, Utilities, Session, Logger.
- CLASP deployment binding via `.clasp.json`.

## 2. File Responsibility Matrix
| File | Responsibility | Depends On | Used By | Notes |
|---|---|---|---|---|
| Code.js | Entire runtime logic: ingestion, rules, reporting, governance, UI menu | Apps Script services; sheet tab schema; Gmail query conventions | Trigger engine, spreadsheet UI menu actions, manual executions | Monolithic single-file implementation |
| appsscript.json | Runtime/manifest settings and advanced service flags | Apps Script platform | Apps Script runtime loader | Declares timezone, V8 runtime, Stackdriver logging, Gmail advanced service enabled |
| .clasp.json | Local project binding and push/pull extension mapping | CLASP CLI and target script project | Local dev/deploy workflow | Contains `scriptId`; not typically committed |
| README.md | Human operational/developer documentation | Current implementation details | Developers/operators | Describes setup, sheet model, trigger usage, command syntax |
| .gitignore | VCS hygiene rules | Git tooling | Repository maintenance | Excludes local artifacts, CLASP local file, IDE/OS/log files |
| PROJECT_DOSSIER_cm360-daily_cvi_catch.md | Deep architectural analysis artifact | Repository contents at generation time | Humans/AI for strategy context | Supplemental document; not runtime |

## 3. Entry Point Map
1. Entry point name: `onOpen`
Type: Trigger (spreadsheet open trigger)
First function called: `onOpen`
Downstream functions: menu builder chain via `SpreadsheetApp.getUi().createMenu(...).addItem(...)`
Final outputs: custom menu `DCM Reports` visible in spreadsheet UI

2. Entry point name: `importDCMReports`
Type: Manual run / UI action / scheduled trigger candidate
First function called: `importDCMReports`
Downstream functions: `processNetworkRemovalRequests` -> `getRemovedNetworks` -> `extractNetworkId` -> `processCSV` -> `autoAddNewNetworks`
Final outputs: refreshed `Data`, `Output`, `3K Output` tabs; logs; error mail on fatal failure

3. Entry point name: `sendMainReport`
Type: Manual run / UI action / callable automation step
First function called: `sendMainReport`
Downstream functions: `getRemovedNetworks`, internal HTML/CSV assembly
Final outputs: main report email to `Email List` column A; optional CSV attachment; error mail on failure

4. Entry point name: `send3KReport`
Type: Manual run / UI action / callable automation step
First function called: `send3KReport`
Downstream functions: `getRemovedNetworks`, internal HTML/CSV assembly
Final outputs: 3K report email to `Email List` column D; optional CSV attachment; error mail on failure

5. Entry point name: `sendAllReports`
Type: Manual run / UI action
First function called: `sendAllReports`
Downstream functions: `sendMainReport` -> `send3KReport`
Final outputs: both outbound report streams, logs, bubbled error if failure

6. Entry point name: `processNetworkRemovalRequests`
Type: Manual run / UI action / internal call in import flow
First function called: `processNetworkRemovalRequests`
Downstream functions: `ensureRemovedNetworksSheet` -> `getRemovedNetworks`
Final outputs: rows added to `Removed Networks`, rows deleted from `Networks`, admin confirmation/error emails

7. Entry point name: `backfillSourceEmailLinks`
Type: Manual run / UI action
First function called: `backfillSourceEmailLinks`
Downstream functions: Gmail search loop + per-row sheet updates
Final outputs: missing source Gmail URLs written into `Removed Networks` column E; error mail on failure

## 4. Runtime Flow Diagram
Primary import pipeline:
- Trigger (time/menu/manual)
  -> `importDCMReports`
  -> `processNetworkRemovalRequests` (pre-pass governance)
  -> load removed network set from sheet
  -> initialize/clear `Data`, `Output`, `3K Output`
  -> Gmail query by label/date
  -> per-thread -> per-message -> per-attachment
  -> branch A (CSV): `processCSV`
  -> branch B (ZIP): unzip -> per-file -> `processCSV`
  -> normalize rows + discard invalid/grand totals
  -> aggregate `extractedData`, `validNetworks`, `allNetworksChecked`
  -> `autoAddNewNetworks`
  -> write `Data`
  -> filter main threshold rules -> write `Output`
  -> filter 3K threshold rules -> write `3K Output`
  -> log completion / send critical error mail on failure

Report send pipeline (main/3K):
- Trigger (menu/manual)
  -> `sendMainReport` or `send3KReport`
  -> load output rows (if args omitted)
  -> load recipients from `Email List` (A or D)
  -> build network summary from `Networks` minus `Removed Networks`
  -> render HTML + optional CSV blob
  -> `MailApp.sendEmail` fan-out
  -> log completion / send error mail on failure

Removal governance pipeline:
- Trigger (menu/manual or called by import)
  -> `processNetworkRemovalRequests`
  -> Gmail search by report subjects + date window
  -> parse `REMOVE NETWORK <id>` commands
  -> dedupe by network ID (latest request)
  -> append audit row to `Removed Networks`
  -> delete matching row from `Networks`
  -> send admin confirmation

## 5. Dependency Graph
File-level:
- `Code.js` -> `appsscript.json` (runtime services/timezone/logging context)
- `Code.js` -> Spreadsheet tabs (`Data`, `Output`, `3K Output`, `Networks`, `Email List`, `Removed Networks`)
- `Code.js` -> Gmail mailbox label + subject conventions
- `README.md` -> documents behavior implemented in `Code.js`
- `.clasp.json` -> deploys `Code.js` and `appsscript.json` to bound script project

Module-level (logical, inside `Code.js`):
- Entry functions depend on CONFIG + helper utilities
- Ingestion depends on parsing utilities and network-ID validator
- Reporting depends on removed-network lookup and sheet snapshots
- Governance depends on Gmail parsing + sheet mutation

Config/source dependencies:
- In-code `CONFIG` constants drive thresholds, sheet names, label name, admin email, date formats
- `appsscript.json` controls timezone/runtime/advanced service declaration
- Spreadsheet content controls recipients, network roster, removal state

Google service dependencies:
- SpreadsheetApp: state store + operator interface substrate
- GmailApp: input stream + command channel
- MailApp: output/notification channel
- Utilities: parseCsv, unzip, formatting, throttling sleep
- Session: timezone source
- Logger: observability output

External APIs/UI components:
- No third-party APIs
- Spreadsheet custom menu only; no HtmlService UI components

## 6. Data Object Map
1. Object name: `CONFIG`
Created: top-level constant in `Code.js`
Fields: `GMAIL_LABEL`, `CLICK_THRESHOLD`, `CLICK_THRESHOLD_3K`, `ADMIN_EMAIL`, `SHEETS`, `DATE_FORMAT`
Transformations: none (read-only)
Used by: almost all entry and helper functions

2. Object name: `removedNetworks`
Created: `getRemovedNetworks`
Fields: `Set<string>` of network IDs
Transformations: sheet column values -> trimmed string set
Used by: import exclusion logic, report summaries, removal dedupe guard

3. Object name: `removalCommands`
Created: `processNetworkRemovalRequests`
Fields per item: `{ networkId, from, date, messageId }`
Transformations: parsed from regex matches across message bodies
Used by: dedupe map -> removal execution

4. Object name: `uniqueRemovals`
Created: `processNetworkRemovalRequests`
Fields: `Map<networkId, command>`
Transformations: latest-date win merge
Used by: removal execution loop

5. Object name: `extractedData`
Created: `importDCMReports`
Fields per row: `[Network ID, Advertiser ID, Advertiser, Campaign ID, Campaign, Placement ID, Placement, Impressions, Clicks]`
Transformations: CSV parse, header stripping, grand-total filtering, network prefixing
Used by: Data sheet write, main/3K rule filtering

6. Object name: `validNetworks`
Created: `importDCMReports` (and rebuilt in report send when needed)
Fields: `Map<networkId, placementCount>`
Transformations: increment per accepted parsed row
Used by: network summary table and no-data detection

7. Object name: `allNetworksChecked`
Created: `importDCMReports`
Fields: `Set<networkId>`
Transformations: populated from attachment-discovered valid IDs
Used by: auto-add new networks; no-data reporting

8. Object name: `mainOutputData` / `output3KData`
Created: `importDCMReports`
Fields per row: base row + `Difference %`
Transformations: threshold filter + campaign exclusion + percentage derivation
Used by: Output sheet writes and optional email attachment generation

## 7. Rule and Decision Map
1. Rule name: Valid numeric network ID
Location: `isValidNetworkId`, `extractNetworkId`, ingestion loops
Inputs: filename-derived ID string
Logic: `/^\d+$/`
Resulting action: accept or skip file/row; log invalid cases
Configurable: No

2. Rule name: CSV parse start anchor
Location: `processCSV`
Inputs: raw attachment text
Logic: first line starting with `Advertiser ID`
Resulting action: parse from anchor or return empty list
Configurable: No

3. Rule name: Ignore example removal IDs
Location: `processNetworkRemovalRequests`, `backfillSourceEmailLinks`
Inputs: parsed network ID
Logic: skip `12345`, `67890`, `99999`
Resulting action: prevent accidental sample-driven removal/backfill
Configurable: No

4. Rule name: Removal command extraction
Location: `processNetworkRemovalRequests`
Inputs: message body text
Logic: regex `REMOVE\s+NETWORK\s+(\d+)` case-insensitive
Resulting action: create removal command objects
Configurable: No

5. Rule name: Removal command dedupe by latest date
Location: `processNetworkRemovalRequests`
Inputs: command list with timestamps
Logic: Map replace when newer date
Resulting action: at most one action per network ID
Configurable: No

6. Rule name: Removed-network exclusion
Location: import + report summary loops
Inputs: network ID + removed set
Logic: membership test in `removedNetworks`
Resulting action: skip ingestion/reporting for removed entities
Configurable: Sheet-driven

7. Rule name: Main anomaly filter
Location: `importDCMReports` main output filter
Inputs: clicks, impressions, campaign name
Logic: clicks >= 12500 AND clicks > impressions AND campaign !contains `dart search` AND impressions > 0
Resulting action: include in `Output`
Configurable: Threshold in code constants only

8. Rule name: 3K anomaly filter
Location: `importDCMReports` 3K output filter
Inputs: clicks, impressions, campaign name
Logic: clicks >= 3000 AND clicks > impressions AND campaign !contains `dart search` AND impressions >= 0
Resulting action: include in `3K Output`
Configurable: Threshold in code constants only

9. Rule name: Auto-add new network
Location: `autoAddNewNetworks`
Inputs: discovered networks set + existing roster
Logic: valid ID not present and not `Unknown`
Resulting action: append `[id, TO BE ADDED SOON]` to `Networks`
Configurable: Placeholder not configurable

## 8. Configuration Surface Map
1. In-code constants (`CONFIG` in `Code.js`)
Controls:
- Gmail label query target
- Thresholds (12.5K, 3K)
- Admin notification address
- Sheet names
- Date format strings

2. Spreadsheet tab `Email List`
Controls:
- Main report recipients from column A
- 3K report recipients from column D

3. Spreadsheet tab `Networks`
Controls:
- Active monitored network roster and network names

4. Spreadsheet tab `Removed Networks`
Controls:
- Suppression list for future ingest/reporting
- Audit metadata and source-email links

5. Manifest `appsscript.json`
Controls:
- Timezone (`America/New_York`)
- Runtime (`V8`)
- Exception logging mode
- Advanced service declarations (Gmail v1)

6. CLASP config `.clasp.json`
Controls:
- Deployment target script project ID
- extension inclusion rules for push/pull

7. UI menu actions (`onOpen`)
Controls:
- Which manual operations operators can trigger from spreadsheet UI

8. Script properties / env controls
Controls:
- Not currently used

## 9. Failure Surface Map
1. Gmail ingestion search window mismatch
Likely symptom: no threads found, no data processed
Impact: missed daily monitoring, stale outputs

2. Attachment format drift (filename/header/content type)
Likely symptom: files skipped or parsed as empty
Impact: false negatives, incomplete network coverage

3. ZIP processing path issues
Likely symptom: nested CSVs ignored or partially processed
Impact: undercounted anomalies

4. Sheet schema/availability issues
Likely symptom: missing sheet errors, wrong recipient reads
Impact: run failures or misrouted/no notifications

5. Removal command parsing ambiguity
Likely symptom: valid requests not executed or unintended IDs parsed
Impact: governance mismatch, trust erosion

6. Unauthorized sender risk in removal flow
Likely symptom: unexpected network removals
Impact: data suppression and monitoring blind spots

7. High-volume quota/execution limits
Likely symptom: timeout/partial run
Impact: partial writes, inconsistent daily state

8. Email send failures (MailApp)
Likely symptom: outputs written but stakeholders not notified
Impact: operational blind spots despite computed results

9. Admin alert send failure inside catch blocks
Likely symptom: silent critical failure beyond logs
Impact: delayed incident response

10. Row deletion side effects in `Networks`
Likely symptom: ordering shifts, accidental row mismatch under concurrent edits
Impact: incorrect roster state

## 10. Shared Library Candidates
1. Gmail attachment ingest library
- Generic query -> thread/message/attachment walker with CSV+ZIP handlers and structured outputs.

2. Command parsing and governance library
- Reusable email-command parser, sender authorization, dedupe policy, and audit writer.

3. Report composition library
- Parameterized HTML table rendering, summary generation, and CSV attachment builder.

4. Sheet schema and repository helpers
- Sheet existence/assertion, bulk clear/write utilities, roster/suppression repository abstraction.

5. Rule engine module
- Config-driven threshold and predicate evaluation reusable across ad-monitoring automations.

6. Error and run telemetry module
- Standardized run IDs, structured logs, and admin notification wrappers.

## 11. FAST AI HANDOFF
What matters most:
- `Code.js` is the single source of runtime truth, especially `importDCMReports`, `processNetworkRemovalRequests`, and both send report functions.

What is fragile:
- Filename/header assumptions, hardcoded thresholds/config, recipient column coupling, and unguarded email-command authorization.

What is reusable:
- Gmail CSV/ZIP ingestion pattern, spreadsheet suppression-list governance, and HTML+CSV alerting pattern.

What another AI should examine first:
1. End-to-end path in `importDCMReports`.
2. Removal governance path in `processNetworkRemovalRequests`.
3. Duplicated logic across `sendMainReport` and `send3KReport` for extraction opportunities.

Future automation ideas suggested:
- Config-driven multi-threshold rule sets, sender allowlists, run observability dashboard, and pluggable anomaly workflows for additional ad platforms.
