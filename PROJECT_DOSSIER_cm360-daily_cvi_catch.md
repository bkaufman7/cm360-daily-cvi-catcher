# PROJECT INTELLIGENCE DOSSIER

## 1. Executive Overview
This system is a Google Apps Script automation that monitors Campaign Manager 360 (DCM/CM360) report outputs for click-volume integrity anomalies and distributes daily operational alerts.

Primary purpose:
- Detect placements where click behavior appears suspicious, especially cases where clicks exceed impressions at high click volumes.
- Convert raw inbound report files (from Gmail) into curated alert datasets and daily email summaries.
- Maintain an operator-managed monitoring scope via a network catalog and email-driven opt-out workflow.

Operational problem solved:
- Manual triage of high-volume click anomalies across many network reports is slow, inconsistent, and error-prone.
- Teams need a repeatable daily process that imports report attachments, applies consistent filtering logic, summarizes findings, and distributes actionable alerts to stakeholder lists.

Automated workflows:
- Daily ingestion of CSV/ZIP report attachments from Gmail label-based mailbox flow.
- Normalization and parsing of CSV content into spreadsheet-backed data tables.
- Rule-based filtering into two output tiers:
  - Main threshold report (12,500+ clicks, plus additional constraints).
  - Secondary 3K threshold report (3,000+ clicks, plus additional constraints).
- Automated notification emails to separate recipient lists.
- Email-command-driven governance flow for removing networks from monitoring.
- Audit trail maintenance for network removals with source-email provenance links.
- Auto-discovery and registration of newly observed network IDs.

Likely users/operators:
- Ad operations / platform operations analysts.
- Automation owner/administrator (admin email configured in constants).
- Stakeholders who receive daily reports and may request monitoring changes by replying with command text.

Input types processed:
- Gmail threads/messages with specific labels and subject patterns.
- CSV attachments and ZIP archives containing CSV files.
- Spreadsheet table data from tabs: Data, Output, 3K Output, Networks, Email List, Removed Networks.
- Email body commands in natural text pattern: REMOVE NETWORK <id>.

Outputs generated:
- Populated spreadsheet tabs for raw and filtered datasets.
- HTML email summaries with anomaly tables and monitoring summaries.
- CSV attachments for downstream analysis.
- Confirmation and failure-notification emails.
- Removed network audit rows with timestamps and source Gmail links.

Likely place in broader workflow:
- This script functions as a control layer between CM360 report distribution (upstream) and anomaly triage / stakeholder decisioning (downstream).
- It likely feeds daily monitoring operations, investigation queues, and network governance decisions.

## 2. Repository File Inventory
| File | Type | Purpose | Key Functions or Components | Importance Level |
|---|---|---|---|---|
| .clasp.json | JSON config | CLASP local-to-Apps Script project binding and file-extension rules | scriptId, extension mappings, rootDir, push behavior | High |
| .gitignore | Text config | Prevents local/dependency/editor artifacts from being committed | ignore rules for clasp file, node_modules, IDE/OS/log files | Medium |
| appsscript.json | Apps Script manifest (JSON) | Runtime/service configuration for deployment in Google Apps Script | timezone, V8 runtime, Gmail advanced service enablement, logging mode | High |
| Code.js | JavaScript (Apps Script) | Core application logic for ingestion, filtering, reporting, and governance | all operational functions/triggers/menu/actions and business rules | Critical |
| README.md | Markdown documentation | Human-readable setup, usage, and workflow guidance | overview, setup steps, sheet schema, trigger expectations, command syntax | High |

How files interact:
- .clasp.json binds local files to a remote Apps Script project ID; this is how Code.js and appsscript.json are pushed/pulled via CLASP.
- appsscript.json defines runtime behavior for the deployed script, including timezone and service availability consumed by Code.js.
- Code.js implements every runtime path documented in README.md.
- README.md describes expected spreadsheet tabs and operator procedures that Code.js assumes exist or creates on demand.
- .gitignore enforces clean repository hygiene so only source/config/docs are versioned.

## 3. Development and Deployment Workflow
Local development workflow (inferred):
- Edit Code.js, appsscript.json, and README.md locally.
- Use CLASP authentication and project binding from .clasp.json.
- Push local changes to Apps Script project using clasp push.
- Run manually in Apps Script editor or via spreadsheet custom menu for validation.

Version control usage:
- Git used for source tracking.
- .gitignore excludes local CLASP credentials/project binding file and local tooling noise.
- Workflow likely uses GitHub for collaboration/history, while deployment target is Google Apps Script.

CLASP usage:
- .clasp.json includes scriptId and extension mapping, confirming CLASP-managed project sync.
- rootDir set to empty string means repository root maps directly to Apps Script root.

Deployment process:
- Deploy by pushing source files to bound Apps Script project.
- Script executes in spreadsheet-bound context (onOpen menu indicates spreadsheet UI integration).
- Time-driven trigger expected for daily import function importDCMReports.

Testing workflow (current state):
- No automated tests in repository.
- Validation appears to be operational/manual:
  - Run menu actions.
  - Verify sheet outputs.
  - Confirm emails received.
  - Inspect logs.

Potential workflow risks:
- No pre-deploy test gate or linting pipeline.
- Config values hardcoded in source (email addresses, thresholds, sheet names).
- Behavior depends heavily on Gmail query semantics and spreadsheet tab structure.
- Command parsing in email body is pattern-based and may miss malformed requests.

## 4. System Architecture
Architecture style:
- Single-file, service-integrated Apps Script monolith with functional subdomains.
- No separate modules/classes; cohesion is achieved via function groups and shared CONFIG object.

Core subsystems:
- Trigger/UI subsystem: onOpen menu commands for operator actions.
- Ingestion subsystem: Gmail search, attachment processing, CSV parsing.
- Governance subsystem: email-command network removals and audit trail.
- Processing/rules subsystem: threshold filters and anomaly scoring output.
- Notification subsystem: HTML report composition + CSV attachment distribution.
- Catalog subsystem: network master list maintenance and auto-discovery.

Runtime flow (primary):
- Time/menu trigger -> importDCMReports -> processNetworkRemovalRequests -> Gmail attachment ingest -> parse/normalize -> filter main + 3K -> write Output sheets -> optional sendMainReport/send3KReport/sendAllReports.

Execution pattern:
- Mostly synchronous, batch-in-memory arrays with occasional per-row appends/updates.
- Uses Google services directly (SpreadsheetApp, GmailApp, MailApp, Utilities, Session, Logger).

## 5. Entry Points and Triggers
All observable entry points:
- onOpen()
  - Trigger type: Spreadsheet open simple trigger.
  - Initiates: custom menu registration for operator-executable actions.
- importDCMReports()
  - Trigger type: expected manual menu run and/or time-driven trigger.
  - Initiates: full ingestion and processing workflow (including removal processing first).
- sendMainReport()
  - Trigger type: menu/manual/automation call.
  - Initiates: main-threshold email report generation and dispatch.
- send3KReport()
  - Trigger type: menu/manual/automation call.
  - Initiates: 3K-threshold email report generation and dispatch.
- sendAllReports()
  - Trigger type: menu/manual/automation call.
  - Initiates: sequential main then 3K report sending.
- processNetworkRemovalRequests()
  - Trigger type: menu/manual and called inside import path.
  - Initiates: parse reply emails for remove commands, update networks/audit sheet.
- backfillSourceEmailLinks()
  - Trigger type: menu/manual.
  - Initiates: retroactive linking of removed-network rows to source Gmail messages.

## 6. Data Flow
Normal flow:
1. Gmail input selection
- Query: label:DCM Reports after:<today>
- Reads matching threads/messages and their attachments.

2. Attachment extraction and parse
- For CSV: parse directly.
- For ZIP: unzip then parse nested CSVs.
- Network ID inferred from filename prefix before underscore.
- CSV parsing starts from header line beginning with Advertiser ID.

3. Normalization
- Every parsed row is prefixed with network ID.
- Grand Total rows are discarded.
- Invalid/non-numeric network IDs are rejected.
- Removed networks set is applied as exclusion gate.

4. Storage and processing
- Raw normalized rows written to Data sheet.
- Rule filters generate:
  - Output sheet (main threshold).
  - 3K Output sheet (lower threshold variant).
- Difference percentage calculated per row:
  - (clicks - impressions) / impressions * 100
  - Infinity% when impressions == 0.

5. Reporting
- Email recipients loaded from Email List:
  - Column A for main report.
  - Column D for 3K report.
- HTML report body includes anomaly table + network summary table + instructions.
- CSV blob generated from output rows and attached if non-empty.

Alternate/branch flows:
- No matching Gmail threads -> import exits early.
- No output rows -> sends informational report body with no table rows.
- Removal commands absent -> removal routine returns with no changes.
- Errors -> log + admin alert emails (best effort).

## 7. Business Logic and Rules
Rule 1: Network ID validity gate
- Check: network ID must be digits only (regex ^\d+$).
- Why it matters: avoids polluting datasets with malformed identifiers.
- Implementation: isValidNetworkId, extractNetworkId fallback to Unknown, repeated checks for attachments and zip members.
- Configurable: no (hardcoded regex).
- Edge cases: filenames without underscore or with alphanumeric prefixes are dropped.

Rule 2: CSV start-line detection
- Check: parse begins at first line starting with Advertiser ID.
- Why: strips email/report wrapper text above true CSV header.
- Implementation: processCSV finds start index; returns [] if absent.
- Configurable: no.
- Edge cases: header text drift/case mismatch causes full-file skip.

Rule 3: Removal command parsing
- Check: regex REMOVE\s+NETWORK\s+(\d+) across reply bodies.
- Why: enables operator self-service network governance.
- Implementation: scans messages in relevant subject threads from previous day onward.
- Configurable: no.
- Edge cases: command typo/case variants mostly tolerated (global case-insensitive), but non-numeric IDs ignored.

Rule 4: Deduplicate removal requests by network ID
- Check: keep latest request by message date.
- Why: prevents duplicate removals and resolves conflicting repeated commands.
- Implementation: Map keyed by network ID.
- Configurable: no.
- Edge cases: same timestamp collisions rely on traversal order.

Rule 5: Ignore instructional example IDs
- Check: skip 12345, 67890, 99999 in removal command and backfill contexts.
- Why: avoids accidental removal from instructional samples included in report body.
- Implementation: hardcoded Set.
- Configurable: no.
- Edge cases: if real production network equals one of these IDs, it cannot be removed via command path.

Rule 6: Main report anomaly criteria
- Check all:
  - clicks >= 12,500
  - clicks > impressions
  - campaign name does not include dart search
  - impressions > 0
- Why: isolate severe click/impression mismatch with minimum volume and campaign exclusion.
- Implementation: filter in importDCMReports.
- Configurable: partially (threshold constant in source).
- Edge cases: parseInt coercion may treat malformed numeric strings unexpectedly.

Rule 7: 3K report anomaly criteria
- Check all:
  - clicks >= 3,000
  - clicks > impressions
  - campaign name does not include dart search
  - impressions >= 0
- Why: lower sensitivity channel for earlier signal.
- Implementation: separate filter in importDCMReports.
- Configurable: threshold constant in source.
- Edge cases: impressions == 0 allowed, producing Infinity% diff values.

Rule 8: Auto-network discovery
- Check: any observed network not already in Networks sheet and valid numeric.
- Why: reduces manual catalog maintenance and surfaces new feeds.
- Implementation: appends [networkId, TO BE ADDED SOON].
- Configurable: placeholder text hardcoded.
- Edge cases: duplicate discovery during race conditions in concurrent runs.

Rule 9: Removed network exclusion from processing and summaries
- Check: network IDs in Removed Networks sheet are excluded.
- Why: enforces governance decisions consistently.
- Implementation: getRemovedNetworks used during ingestion and summary rendering.
- Configurable: sheet-driven.
- Edge cases: whitespace/formatting normalized via string trim.

## 8. Configuration Model
Configuration loci:
- In-code constant object CONFIG:
  - Gmail label
  - thresholds
  - admin email
  - sheet names
  - date formats
- Manifest config in appsscript.json:
  - timezone
  - runtime version
  - enabled services
- CLASP config in .clasp.json:
  - script binding, extension behavior.

Flexibility profile:
- Moderate flexibility for operators via spreadsheet tab content and email recipients.
- Low flexibility for runtime constants because edits require code change + deployment.

Risks:
- Hardcoded business parameters increase change friction and error risk.
- No properties-based environment separation (dev/stage/prod).
- Potential drift between README rules and code constants over time.

## 9. External Integrations
Google services used:
- GmailApp:
  - Search inbox by label/subject/date.
  - Read thread/message bodies and attachments.
- MailApp:
  - Send report, confirmation, and error notification emails.
- SpreadsheetApp:
  - Read/write operational datasets and config-like tables.
- Utilities:
  - parseCsv, unzip, sleep, date formatting.
- Session:
  - script timezone usage.
- Logger:
  - runtime logging.

Manifest-declared advanced service:
- Gmail advanced service (Gmail v1) is enabled but not explicitly called via Gmail.* namespace in Code.js.

Request-flow visibility:
- External non-Google APIs are not present.
- Integration pattern is eventless pull from Gmail plus push notifications via MailApp.

## 10. Spreadsheet and Data Storage Usage
Primary storage medium:
- Google Sheets tabs within active spreadsheet.

Tab-level structure (inferred):
- Data: normalized imported rows.
- Output: main-threshold anomalies with Difference %.
- 3K Output: lower-threshold anomalies with Difference %.
- Networks: [Network ID, Network Name] catalog.
- Email List: recipients (A for main, D for 3K).
- Removed Networks: audit ledger [ID, name, removed by, date removed, source email URL].

Read/write patterns:
- Bulk writes for main import datasets via setValues (good).
- Row-by-row append for removed network audit entries.
- Occasional per-cell setValue during backfill.
- Full data-range reads for networks and removed sets.

Lookup behavior:
- In-memory Set/Map for dedupe and membership checks.
- Linear scan for finding network row to delete in Networks sheet.

Performance implications:
- Bulk ingest path generally efficient.
- Backfill and removal loops can become expensive at scale due to repeated Gmail searches and row deletion operations.
- deleteRows for clearing data can be costly for large sheets and may affect formulas/formatting consistency.

## 11. UI and Operator Experience
UI surface:
- Spreadsheet custom menu named DCM Reports.

Operator actions available:
- Import DCM Reports.
- Send Main Report (12.5K).
- Send 3K Report.
- Send All Reports.
- Process Network Removal Requests.
- Backfill Source Email Links.

UX model:
- No HTML dialogs/sidebar UI; interaction is menu-driven and email-driven.
- Operator receives actionable instructions embedded in report emails for adding/removing networks.

Backend interaction:
- Menu actions directly invoke backend functions in Code.js.
- Email replies act as asynchronous command input channel.

## 12. Utilities and Shared Logic
Reusable helper logic present:
- logInfo/logError for structured timestamped logging.
- isValidNetworkId for identifier hygiene.
- extractNetworkId for filename-to-network mapping.
- processCSV for CSV normalization.
- getRemovedNetworks for governance state retrieval.
- ensureRemovedNetworksSheet for lazy schema setup.

Duplication hotspots:
- sendMainReport and send3KReport duplicate large HTML construction and summary logic with minor differences.
- Error notification patterns repeated in multiple functions.

Shared-library candidates:
- Generic report renderer (input: threshold config + recipient column + template fragments).
- Gmail command parser utility.
- Sheet repository helpers (clear/write/read patterns with schema assertions).

## 13. Error Handling and Resilience
Current mechanisms:
- Extensive try/catch around major workflows.
- Fallback admin notification emails on failures.
- Logging with timestamps and contextual messages.
- Defensive checks for missing sheets and empty recipient lists.

Validation coverage:
- ID format validation.
- Attachment type gating.
- CSV header detection.
- Dedupe for removal operations.

Weaknesses:
- No centralized error taxonomy or structured run status object.
- No retry logic for transient Gmail/Sheets service errors.
- Some operations continue silently after partial failures (e.g., per-network backfill search exceptions).
- No dead-letter mechanism for unprocessable attachments.

## 14. Performance and Scalability
Apps Script constraint considerations:
- Execution time limits can be pressured by:
  - large Gmail thread scans,
  - nested attachment loops,
  - repeated sheet operations,
  - per-network Gmail searches in backfill.

Positive performance patterns:
- Batch writes for major datasets.
- Set/Map usage for O(1)-style membership checks.

Potential bottlenecks:
- Networks sheet full scan for each removal request.
- Row deletion operations inside loops.
- Repeated Gmail search queries in backfill per row.
- HTML assembly with string concatenation for very large reports.

Scalability risks:
- Growth in monitored networks and attachment volume may exceed daily trigger window.
- No sharding/partitioning by date/network beyond Gmail search query boundaries.

## 15. Security and Access Considerations
Potential risks:
- Hardcoded admin and operational email addresses in source.
- Any reply containing removal command in matching subject threads can affect monitoring scope.
- No sender allowlist/authorization check for removal command execution.
- Source email links stored in sheet may expose message IDs to spreadsheet viewers.

Permissions model implications:
- Script likely runs with owner/deployer authority, so write and email actions are high-privilege.
- Spreadsheet sharing controls become de facto access control for operational state.

Governance recommendations:
- Add sender-domain allowlist for removal commands.
- Move sensitive constants to Script Properties.
- Add role-specific sheet protections.

## 16. Code Quality and Maintainability
Strengths:
- Clear function names and meaningful inline comments.
- Centralized CONFIG constant improves discoverability of key settings.
- Defensive error handling across major flows.
- README documentation is substantial and operationally oriented.

Maintainability limitations:
- Single large Code.js file with mixed concerns.
- Duplicate report generation paths increase change surface and drift risk.
- Limited abstraction for email templating and sheet I/O contracts.
- Lack of automated tests and static checks.

## 17. Technical Debt and Fragility
Key fragile areas:
- Monolithic file architecture:
  - Changes in one area risk side effects across ingestion/reporting/governance.
- Hardcoded assumptions:
  - Subject text patterns, label names, instructional example IDs, and column locations.
- Parsing brittleness:
  - Filename format dependence for network extraction.
  - CSV header exact-text dependence.
- Implicit schema dependencies:
  - Email List column A and D semantics are hardcoded.
- Potential docs/code mismatch:
  - README wording around click fee/click relationship may be interpreted inconsistently with actual threshold constants.

Why this matters:
- Small upstream format changes can break ingestion silently.
- Operational teams may make spreadsheet edits that invalidate assumptions.
- Scaling and feature extension become harder without modular boundaries.

## 18. Missing Capabilities
High-value missing capabilities:
- Automated test harness for parsing and filter rules.
- Structured run history table with status, counts, duration, and error summaries.
- Retry/backoff wrappers for Gmail and Sheets operations.
- Sender authorization and command validation framework.
- Idempotency keys / duplicate-run guards.
- Config UI or property-driven configuration management.
- Monitoring dashboard for trends and anomaly counts over time.

## 19. Expansion Opportunities
Potential evolution directions:
- Multi-threshold rule engine configurable by spreadsheet/JSON rather than constants.
- Alert routing by network/advertiser ownership.
- Integration with ticketing/case systems for automated investigation workflows.
- Daily/weekly trend analytics and anomaly drift visualizations.
- Automated quarantine or confidence scoring for suspicious networks.
- Enrichment layer pulling additional campaign metadata before sending reports.

## 20. Reusable Components
Strong reusable candidates across projects:
- Gmail attachment ingestion + ZIP/CSV extraction pipeline.
- Email command parser pattern for lightweight workflow control.
- Spreadsheet-based governance ledger pattern (active list + removed/audit list).
- Report email composer with table summaries and CSV export attachment.
- Network/entity auto-discovery mechanism for onboarding unknown IDs.

Why reusable:
- These patterns are generic for many operations automations that rely on mailbox ingestion and spreadsheet orchestration.

## 21. Cross-Project Ecosystem Potential
Ecosystem integration potential:
- Shared anomaly-detection platform across multiple ad channels (CM360, DV360, search, social) using common ingestion and reporting abstractions.
- Centralized governance service for network/entity inclusion/exclusion lists reused across scripts.
- Unified ops telemetry sink (BigQuery/Looker Studio) for execution metrics and anomalies.
- Common command grammar for operator email actions across automations.

## 22. Strategic Summary
System strengths:
- Practical end-to-end automation from ingestion to stakeholder distribution.
- Clear operational utility with actionable report outputs.
- Built-in governance loop (remove network by email reply) with audit support.
- Strong enough guardrails for common malformed-input cases.

System weaknesses:
- Monolithic code organization and duplicate reporting code.
- Hardcoded config and weak authorization around command channel.
- No automated testing, observability framework, or robust retries.

Highest-impact refactoring opportunities:
- Extract reusable modules: ingest, rules, reporting, governance, storage adapters.
- Replace hardcoded config with properties + validated config loader.
- Build unified report-template function to eliminate duplicated HTML logic.
- Add structured run logging sheet and explicit run IDs.

Future development potential:
- Can evolve into a generalized ad-ops anomaly platform with pluggable rules and multi-source ingestion while preserving current operator workflows.

## 23. Appendix: Function and Component Index
Configuration and constants:
- CONFIG object

Logging:
- logInfo(message)
- logError(message, error)

Triggers and operator actions:
- onOpen()
- importDCMReports()
- sendMainReport(outputData, validNetworks, allNetworksChecked)
- send3KReport(outputData, validNetworks, allNetworksChecked)
- sendAllReports()
- processNetworkRemovalRequests()
- backfillSourceEmailLinks()

Ingestion and parsing:
- extractNetworkId(fileName)
- processCSV(fileContent, networkId)
- isValidNetworkId(networkId)

Governance and catalog:
- getRemovedNetworks(ss)
- ensureRemovedNetworksSheet(ss)
- autoAddNewNetworks(ss, allNetworksChecked)

Rules and transformations:
- Main threshold filtering logic inside importDCMReports
- 3K threshold filtering logic inside importDCMReports
- Difference percentage computation inside both output pipelines

Reporting composition:
- HTML table and summary assembly inside sendMainReport/send3KReport
- CSV attachment creation in report send functions

---

## AI HANDOFF NOTES
Most important assets to analyze first:
- Code.js: all behavioral truth is here; it contains trigger paths, business rules, and integration contracts.
- appsscript.json: confirms runtime assumptions and service availability.
- README.md: captures operator intent and expected spreadsheet schema.

Where hidden complexity exists:
- Gmail query semantics and date windows.
- Filename/header assumptions in CSV parsing.
- Governance side effects when removing networks (both audit append and active list deletion).
- Duplicated report generation logic that can drift.

What another AI should analyze first for safe changes:
1. Build a precise test matrix for parsing and threshold filters using representative CSV samples.
2. Map all spreadsheet column dependencies and enforce schema validation before run.
3. Validate security posture of removal command channel by simulating unauthorized sender scenarios.
4. Confirm behavior under high-volume Gmail/thread conditions against Apps Script limits.

Opportunities for future tooling:
- Rule simulation CLI/test harness for local validation.
- Config linter for sheet/tab/column contracts and missing recipients.
- Automated run telemetry exporter and dashboard generator.
- Shared Apps Script library extraction for Gmail ingest + report templating + governance patterns.
