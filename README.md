# CM360 Daily CVI Catcher

An automated Google Apps Script solution for monitoring Campaign Manager 360 (DCM) click-value integrity (CVI) reports.

## Overview

This script automatically processes DCM reports from Gmail attachments, identifies placements with suspicious click activity (click fees exceeding $100), and sends daily email summaries to stakeholders.

## Features

- **Automated Report Import**: Fetches DCM reports from Gmail with the "DCM Reports" label
- **CSV Processing**: Handles both direct CSV attachments and ZIP archives
- **Click Anomaly Detection**: Identifies placements where clicks significantly exceed impressions
- **Email Notifications**: Sends formatted HTML email reports with:
  - Table of flagged placements
  - Network summary statistics
  - CSV attachment for further analysis
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
  - `Networks` - Network ID and Name mapping

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
From the Google Sheets menu: **DCM Reports** → **Import DCM Reports**

### Scheduled Execution
Set up a time-driven trigger in Apps Script to run `importDCMReports()` daily.

## Workflow

1. Script searches Gmail for emails with "DCM Reports" label from today
2. Extracts and processes CSV files from attachments
3. Filters data based on CVI criteria
4. Generates HTML email with summary table and network statistics
5. Sends report to all addresses in the Email List tab

## File Structure

- `Code.js` - Main script logic
- `appsscript.json` - Apps Script manifest
- `.clasp.json` - Clasp configuration (not tracked in git)

## Contributing

Created by BK for Platform Solutions Automation team.

## License

MIT
