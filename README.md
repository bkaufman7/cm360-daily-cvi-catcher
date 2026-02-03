# CM360 Daily CVI Catcher

An automated Google Apps Script solution for monitoring Campaign Manager 360 (DCM) click-value integrity (CVI) reports.

## Overview

This script automatically processes DCM reports from Gmail attachments, identifies placements with suspicious click activity (click fees exceeding $100), and sends daily email summaries to stakeholders.

## Features

- **Automated Report Import**: Fetches DCM reports from Gmail with the "DCM Reports" label
- **CSV Processing**: Handles both direct CSV attachments and ZIP archives
- **Click Anomaly Detection**: Identifies placements where clicks significantly exceed impressions
- **Auto-Network Discovery**: Automatically adds new networks to the monitoring list when discovered in reports
- **Email-Based Network Removal**: Team members can remove networks by replying to daily reports with "REMOVE NETWORK [ID]"
- **Removed Networks Audit Trail**: Tracks all removed networks with removal date, requestor email, and network details
- **Smart Filtering**: Automatically excludes removed networks from all future processing
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
  - `Removed Networks` - Audit trail for removed networks (auto-created)

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
- **DCM Reports** → **Process Network Removal Requests** (manually process removal emails)

### Scheduled Execution
Set up a time-driven trigger in Apps Script to run `importDCMReports()` daily.

### Removing Networks from Monitoring
Any email recipient can remove a network by **replying to the daily DCM CVI Report email** with:
```
REMOVE NETWORK 12345
```
(Replace 12345 with the actual Network ID)

- Multiple networks can be removed in one email
- Removal takes effect the next day before data processing
- Admin receives confirmation email for all removals
- Removed networks are archived in the "Removed Networks" sheet

## Workflow

1. Script searches Gmail for emails with "DCM Reports" label from today
2. **Processes removal requests** from email replies (from previous day)
3. Extracts and processes CSV files from attachments
4. **Auto-discovers and adds new networks** to the Networks sheet with "TO BE ADDED SOON" placeholder
5. **Filters out removed networks** from processing
6. Filters data based on CVI criteria
7. Generates HTML email with summary table and network statistics (showing all networks, including those with 0 placements)
8. Sends report to all addresses in the Email List tab
9. **Sends confirmation email** to admin for any network removals

## File Structure

- `Code.js` - Main script logic
- `appsscript.json` - Apps Script manifest
- `.clasp.json` - Clasp configuration (not tracked in git)

## Contributing

Created by BK for Platform Solutions Automation team.

## License

MIT
