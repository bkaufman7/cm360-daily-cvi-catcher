# CM360 Daily CVI Catcher

An automated Google Apps Script solution for monitoring Campaign Manager 360 (DCM) click-value integrity (CVI) reports.

## Overview

This script automatically processes DCM reports from Gmail attachments, identifies placements with suspicious click activity (click fees exceeding $100), and sends daily email summaries to stakeholders.

## Features

- **Automated Report Import**: Fetches DCM reports from Gmail with the "DCM Reports" label
- **CSV Processing**: Handles both direct CSV attachments and ZIP archives
- **Click Anomaly Detection**: Identifies placements where clicks significantly exceed impressions
- **Auto-Network Discovery**: Automatically adds new networks to the monitoring list when discovered in reports
- **Inherited Networks Source of Truth**: Refreshes the local `Networks` tab once daily from the external source spreadsheet's `Networks` tab (columns A:B)
- **Email-Based Network Removal**: Team members can remove networks by replying to daily reports with "REMOVE NETWORK [ID]"
- **Removed Networks Audit Trail**: Tracks all removed networks with removal date, requestor email, and network details
- **Smart Filtering**: Automatically excludes removed networks from all future processing
- **Shared Source Data Refresh**: Refreshes both the local `Networks` tab and the `Advertisers to Ignore` cache once daily from the source-of-truth spreadsheet so import and QA use the same daily snapshot
- **Inherited Advertiser Ignore List**: Syncs advertiser names from a separate spreadsheet once daily and excludes them from raw and downstream processing
- **Missing Report QA**: Daily emails explicitly list source-of-truth networks/advertisers with no report email found in Gmail that day
- **Email Notifications**: Sends formatted HTML email reports with:
  - Table of flagged placements
  - Network summary statistics (including networks with 0 placements)
  - Removal instructions for team members
  - CSV attachment for further analysis
- **Confirmation Emails**: Sends removal confirmations to admin (bkaufman@horizonmedia.com)
- **Custom Menu**: Easy-to-use spreadsheet menu for manual triggers

## Logic

The script flags placements that meet ALL of the following criteria:
- Click fees ≥ $12,500 (approximately 100+ clicks)
- Clicks > Impressions
- Impressions > 0
- Campaign name doesn't contain "DART Search"

## Setup

### Prerequisites

- Google Apps Script project
- Gmail labels configured for DCM reports
- Google Sheets with the following tabs:
  - `Data` - Raw imported data
  - `Output` - Filtered results
  - `Email List` - Recipients (Column A)
   - `Networks` - Network ID and Name mapping (auto-populated for new networks)
   - Synced daily from the external source spreadsheet `Networks` tab (columns A:B)
  - `Removed Networks` - Audit trail for removed networks (auto-created)
   - `Advertisers to Ignore` - Local cache of inherited advertiser names to exclude (auto-created and auto-synced daily)

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/bkaufman7/cm360-daily-cvi-catcher.git
   cd cm360-daily-cvi-catcher
   ```

2. Install clasp (if not already installed):
   ```bash
   npm install -g @google/clasp
   ```

3. Login to clasp:
   ```bash
   clasp login
   ```

4. Push to your Apps Script project:
   ```bash
   clasp push
   ```

## Usage

### Manual Execution
From the Google Sheets menu: 
- **DCM Reports** → **Import DCM Reports** (runs full workflow)
- **DCM Reports** → **Sync Network List** (manually refreshes both the local Networks tab and the Advertisers to Ignore cache if they have not synced yet today)
- **DCM Reports** → **Process Network Removal Requests** (manually process removal emails)

### Scheduled Execution
Set up a time-driven trigger in Apps Script to run `importDCMReports()` daily.

### Adding Networks to Monitoring

To add a new network report for monitoring:

1. **Step 1:** Place this exact string into the AI helper in DCM Reports:
   ```
   Advertiser ID, Advertiser, Campaign ID, campaign, Placement ID, Placement, impressions, clicks, Yesterday
   ```

2. **Step 2:** Set the report subject/label to exactly:
   ```
   BKCVI click and impression
   ```
   *(This auto-applies the DCM Reports Gmail label)*

3. **Step 3:** Set schedule with end date of **Jan 1, 2030**

4. **Step 4:** Ensure you CC this email exactly:
   ```
   platformsolutionsadopshorizon@gmail.com
   ```

Once the report is configured, it will be automatically imported daily and flagged placements will appear in the next day's CVI report.

### Removing Networks from Monitoring

Any email recipient can remove a network by **replying to the daily DCM CVI Report email** with:
```
REMOVE NETWORK [ID]
```

**Example:** To remove multiple networks in one email:
```
REMOVE NETWORK 12345
REMOVE NETWORK 67890
REMOVE NETWORK 99999
```

**Details:**
- Replace `[ID]` with the actual Network ID from the report
- Multiple networks can be removed in a single email
- Removal takes effect the next day before data processing
- Admin receives confirmation email listing all removals
- Removed networks are archived in the "Removed Networks" sheet for audit purposes
- Removed networks no longer appear in future CVI reports

## Workflow

1. Script searches Gmail for emails with "DCM Reports" label from today
2. **Processes removal requests** from email replies (from previous day)
3. **Refreshes both source-backed reference lists once per day** from the external spreadsheet:
   - `Networks` tab (A:B)
   - `Advertisers to Ignore` tab (column A)
4. Extracts and processes CSV files from attachments
5. **Auto-discovers and adds new networks** to the Networks sheet with "TO BE ADDED SOON" placeholder
6. **Filters out removed networks** from processing
7. **Filters out ignored advertisers** from raw imported rows before writing `Data`
8. Filters data based on CVI criteria
9. Generates HTML email with summary table and network statistics (showing all networks, including those with 0 placements)
10. **Lists any source-of-truth networks/advertisers that had no report email in Gmail that day**
11. Sends report to all addresses in the Email List tab
12. **Sends confirmation email** to admin for any network removals

## File Structure

- `Code.js` - Main script logic
- `appsscript.json` - Apps Script manifest
- `.clasp.json` - Clasp configuration (not tracked in git)

## Contributing

Created by BK for Platform Solutions Automation team.

## License

MIT
