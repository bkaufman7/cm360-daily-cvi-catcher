// Configuration Constants
const CONFIG = {
  GMAIL_LABEL: "DCM Reports",
  CLICK_THRESHOLD: 12500, // $100 in click fees at $0.008 CPC ($100 / $0.008 = 12,500 clicks)
  CLICK_THRESHOLD_3K: 3000, // 3K threshold for Jenny's report
  ADMIN_EMAIL: "bkaufman@horizonmedia.com",
  ADVERTISER_IGNORE_SOURCE: {
    SPREADSHEET_ID: "1BJpCPZaTEIa852vF5DiZvL9OpScKy0Awe-xXRikph2o",
    TAB_NAME: "Advertisers To Ignore",
    NAME_COLUMN: 1 // Column A in source
  },
  NETWORK_SOURCE: {
    SPREADSHEET_ID: "1BJpCPZaTEIa852vF5DiZvL9OpScKy0Awe-xXRikph2o",
    TAB_NAME: "Networks",
    START_COLUMN: 1,
    COLUMN_COUNT: 2,
    LAST_SYNC_CELL: "D1",
    SOURCE_LINK_CELL: "E1"
  },
  SHEETS: {
    DATA: "Data",
    OUTPUT: "Output",
    OUTPUT_3K: "3K Output",
    NETWORKS: "Networks",
    EMAIL_LIST: "Email List",
    REMOVED_NETWORKS: "Removed Networks",
    ADVERTISERS_TO_IGNORE: "Advertisers to Ignore"
  },
  DATE_FORMAT: {
    EMAIL: "MM.dd.yy",
    SEARCH: "yyyy/MM/dd",
    AUDIT: "MM/dd/yyyy HH:mm:ss",
    SYNC: "yyyy-MM-dd"
  }
};

// Logging Utilities
function logInfo(message) {
  Logger.log(`[INFO] ${new Date().toISOString()}: ${message}`);
}

function logError(message, error) {
  Logger.log(`[ERROR] ${new Date().toISOString()}: ${message}`);
  if (error) Logger.log(error);
}

function getTodaySyncKey() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), CONFIG.DATE_FORMAT.SYNC);
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("DCM Reports")
    .addItem("Import DCM Reports", "importDCMReports")
    .addItem("Sync Network List", "syncSourceData")
    .addItem("Send Main Report (12.5K)", "sendMainReport")
    .addItem("Send 3K Report", "send3KReport")
    .addItem("Send All Reports", "sendAllReports")
    .addSeparator()
    .addItem("Process Network Removal Requests", "processNetworkRemovalRequests")
    .addItem("Backfill Source Email Links", "backfillSourceEmailLinks")
    .addToUi();
}

function isValidNetworkId(networkId) {
  return /^\d+$/.test(String(networkId || "").trim());
}

function isNetworkReportFileName(fileName) {
  return /^\d+_/.test(String(fileName || "").trim());
}

/**
 * Extracts network ID from filename (format: NETWORKID_...)
 * @param {string} fileName - The name of the CSV file
 * @returns {string} Network ID or "Unknown" if not found
 */
function extractNetworkId(fileName) {
  const match = fileName.match(/^([^_]+)_/);
  const id = match ? String(match[1]).trim() : "Unknown";
  if (id === "Unknown" || !isValidNetworkId(id)) {
    logError(`Invalid network ID extracted from filename: ${fileName}`);
    return "Unknown";
  }
  return id;
}


/**
 * Processes CSV content and extracts placement data
 * @param {string} fileContent - Raw CSV file content
 * @param {string} networkId - Network identifier to prepend to each row
 * @returns {Array<Array>} Parsed rows with network ID prepended
 */
function processCSV(fileContent, networkId) {
  const allLines = fileContent.split("\n");

  // Find the data header row after DCM metadata rows
  let headerIndex = -1;
  for (let i = 0; i < allLines.length; i++) {
    const trimmedLine = allLines[i].trim();
    if (trimmedLine.toLowerCase().startsWith("advertiser id")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    logError(`No CSV header found in network ${networkId}`);
    return [];
  }

  try {
    const dataSection = allLines.slice(headerIndex).join("\n");
    let csvData = Utilities.parseCsv(dataSection);

    if (csvData.length > 0) {
      csvData.shift(); // Remove header row
    }

    csvData = csvData.filter(row => row && row.length >= 8 && row[0]);
    return csvData.map(row => [networkId, ...row]);
  } catch (error) {
    logError(`Failed to parse CSV for network ${networkId}`, error);
    return [];
  }
}

function getRemovedNetworks(ss) {
  const removedSheet = ss.getSheetByName("Removed Networks");
  const removedNetworks = new Set();
  
  if (removedSheet && removedSheet.getLastRow() > 1) {
    const data = removedSheet.getRange(2, 1, removedSheet.getLastRow() - 1, 1).getValues();
    data.forEach(row => {
      if (row[0]) removedNetworks.add(String(row[0]).trim());
    });
  }
  
  return removedNetworks;
}

function normalizeAdvertiserName(name) {
  return String(name || "").trim().toLowerCase();
}

function getContiguousSourceValues(sheet, startColumn, columnCount) {
  const lastRow = sheet.getLastRow();

  if (lastRow <= 0) {
    return [];
  }

  const rows = sheet.getRange(1, startColumn, lastRow, columnCount).getValues();
  const contiguousRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isBlankRow = row.every(cell => String(cell || "").trim() === "");

    if (isBlankRow) {
      break;
    }

    contiguousRows.push(row);
  }

  return contiguousRows;
}

function ensureAdvertisersToIgnoreSheet(ss) {
  let ignoreSheet = ss.getSheetByName(CONFIG.SHEETS.ADVERTISERS_TO_IGNORE);

  if (!ignoreSheet) {
    ignoreSheet = ss.insertSheet(CONFIG.SHEETS.ADVERTISERS_TO_IGNORE);
    const headers = ["Advertiser Name", "Last Synced", "Source"];
    ignoreSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    ignoreSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    logInfo(`Created ${CONFIG.SHEETS.ADVERTISERS_TO_IGNORE} sheet`);
  }

  return ignoreSheet;
}

function getIgnoredAdvertisers(ss) {
  const ignoreSheet = ensureAdvertisersToIgnoreSheet(ss);
  const ignoredAdvertisers = new Set();

  if (ignoreSheet.getLastRow() > 1) {
    const names = ignoreSheet.getRange(2, 1, ignoreSheet.getLastRow() - 1, 1).getValues();
    names.forEach(row => {
      const normalized = normalizeAdvertiserName(row[0]);
      if (normalized) {
        ignoredAdvertisers.add(normalized);
      }
    });
  }

  return ignoredAdvertisers;
}

function refreshAdvertiserIgnoreListIfNeeded(ss, todayKey) {
  const ignoreSheet = ensureAdvertisersToIgnoreSheet(ss);
  const syncKey = todayKey || getTodaySyncKey();
  const lastSynced = String(ignoreSheet.getRange(1, 2).getValue() || "").trim();

  if (lastSynced === syncKey) {
    logInfo("Advertiser ignore list already synced today");
    return;
  }

  try {
    const sourceSS = SpreadsheetApp.openById(CONFIG.ADVERTISER_IGNORE_SOURCE.SPREADSHEET_ID);
    const sourceSheet = sourceSS.getSheetByName(CONFIG.ADVERTISER_IGNORE_SOURCE.TAB_NAME);

    if (!sourceSheet) {
      throw new Error(`Source tab not found: ${CONFIG.ADVERTISER_IGNORE_SOURCE.TAB_NAME}`);
    }

    let sourceNames = [];

    const sourceRows = getContiguousSourceValues(
      sourceSheet,
      CONFIG.ADVERTISER_IGNORE_SOURCE.NAME_COLUMN,
      1
    );

    if (sourceRows.length > 0) {
      sourceNames = sourceRows
        .map(row => String(row[0] || "").trim())
        .filter(Boolean)
        .filter(name => {
          const normalized = normalizeAdvertiserName(name);
          return normalized !== "advertiser" && normalized !== "advertiser name";
        });
    }

    const uniqueNames = [...new Set(sourceNames)];

    if (ignoreSheet.getLastRow() > 1) {
      ignoreSheet.deleteRows(2, ignoreSheet.getLastRow() - 1);
    }

    if (uniqueNames.length > 0) {
      const rows = uniqueNames.map(name => [name]);
      ignoreSheet.getRange(2, 1, rows.length, 1).setValues(rows);
    }

    ignoreSheet.getRange(1, 2).setValue(syncKey);
    ignoreSheet.getRange(1, 3).setValue(
      `https://docs.google.com/spreadsheets/d/${CONFIG.ADVERTISER_IGNORE_SOURCE.SPREADSHEET_ID}`
    );

    logInfo(`Synced ${uniqueNames.length} advertiser names into ignore list cache`);
  } catch (error) {
    logError("Failed to sync advertiser ignore list; using cached list", error);
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: "WARNING: Advertiser Ignore Sync Failed",
        body: `The advertiser ignore list could not be refreshed today. The script continued using cached values in '${CONFIG.SHEETS.ADVERTISERS_TO_IGNORE}'.\n\nError:\n${error}`
      });
    } catch (emailError) {
      logError("Failed to send advertiser ignore sync warning", emailError);
    }
  }
}

function ensureNetworksSheet(ss) {
  let networksSheet = ss.getSheetByName(CONFIG.SHEETS.NETWORKS);

  if (!networksSheet) {
    networksSheet = ss.insertSheet(CONFIG.SHEETS.NETWORKS);
    const headers = ["Network ID", "Network Name"];
    networksSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    networksSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    logInfo(`Created ${CONFIG.SHEETS.NETWORKS} sheet`);
  }

  return networksSheet;
}

function refreshNetworksSheetIfNeeded(ss, todayKey) {
  const networksSheet = ensureNetworksSheet(ss);
  const syncKey = todayKey || getTodaySyncKey();
  const lastSynced = String(networksSheet.getRange(CONFIG.NETWORK_SOURCE.LAST_SYNC_CELL).getValue() || "").trim();

  if (lastSynced === syncKey) {
    logInfo("Networks sheet already synced today");
    return;
  }

  try {
    const sourceSS = SpreadsheetApp.openById(CONFIG.NETWORK_SOURCE.SPREADSHEET_ID);
    const sourceSheet = sourceSS.getSheetByName(CONFIG.NETWORK_SOURCE.TAB_NAME);

    if (!sourceSheet) {
      throw new Error(`Source tab not found: ${CONFIG.NETWORK_SOURCE.TAB_NAME}`);
    }

    const sourceRows = getContiguousSourceValues(
      sourceSheet,
      CONFIG.NETWORK_SOURCE.START_COLUMN,
      CONFIG.NETWORK_SOURCE.COLUMN_COUNT
    );

    if (networksSheet.getLastRow() > 0) {
      networksSheet.getRange(1, 1, networksSheet.getMaxRows(), CONFIG.NETWORK_SOURCE.COLUMN_COUNT).clearContent();
    }

    if (sourceRows.length > 0) {
      networksSheet.getRange(1, 1, sourceRows.length, CONFIG.NETWORK_SOURCE.COLUMN_COUNT).setValues(sourceRows);
      networksSheet.getRange(1, 1, 1, CONFIG.NETWORK_SOURCE.COLUMN_COUNT).setFontWeight("bold");
    }

    networksSheet.getRange(CONFIG.NETWORK_SOURCE.LAST_SYNC_CELL).setValue(syncKey);
    networksSheet.getRange(CONFIG.NETWORK_SOURCE.SOURCE_LINK_CELL).setValue(
      `https://docs.google.com/spreadsheets/d/${CONFIG.NETWORK_SOURCE.SPREADSHEET_ID}`
    );

    logInfo(`Synced ${sourceRows.length} rows into ${CONFIG.SHEETS.NETWORKS}`);
  } catch (error) {
    logError("Failed to sync Networks sheet; using cached values", error);
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: "WARNING: Networks Sheet Sync Failed",
        body: `The Networks sheet could not be refreshed today. The script continued using cached values in '${CONFIG.SHEETS.NETWORKS}'.\n\nError:\n${error}`
      });
    } catch (emailError) {
      logError("Failed to send Networks sync warning", emailError);
    }
  }
}

function syncSourceData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const todayKey = getTodaySyncKey();
  refreshNetworksSheetIfNeeded(ss, todayKey);
  refreshAdvertiserIgnoreListIfNeeded(ss, todayKey);
}

function syncNetworksFromSource() {
  syncSourceData();
}

function getExpectedNetworkRows(networksSheet, removedNetworkIds) {
  if (!networksSheet || networksSheet.getLastRow() < 2) {
    return [];
  }

  return networksSheet.getRange(2, 1, networksSheet.getLastRow() - 1, 2).getValues().filter(([id]) => {
    if (!id || !isValidNetworkId(id)) {
      return false;
    }

    return !removedNetworkIds.has(String(id).trim());
  });
}

function getMissingNetworkReports(expectedNetworkRows, allNetworksChecked) {
  if (!expectedNetworkRows || expectedNetworkRows.length === 0) {
    return [];
  }

  return expectedNetworkRows
    .filter(([id]) => !allNetworksChecked.has(String(id).trim()))
    .map(([id, name]) => `${id} - ${name}`);
}

function filterIgnoredAdvertisers(rows, ignoredAdvertisers) {
  if (!ignoredAdvertisers || ignoredAdvertisers.size === 0) {
    return rows;
  }

  return rows.filter(row => {
    const advertiserName = normalizeAdvertiserName(row[2]);
    return advertiserName && !ignoredAdvertisers.has(advertiserName);
  });
}

/**
 * Ensures the Removed Networks audit sheet exists
 * @param {SpreadsheetApp.Spreadsheet} ss - The active spreadsheet
 * @returns {SpreadsheetApp.Sheet} The Removed Networks sheet
 */
function ensureRemovedNetworksSheet(ss) {
  try {
    let removedSheet = ss.getSheetByName(CONFIG.SHEETS.REMOVED_NETWORKS);
    
    if (!removedSheet) {
      removedSheet = ss.insertSheet(CONFIG.SHEETS.REMOVED_NETWORKS);
      const headers = ["Network ID", "Network Name", "Removed By", "Date Removed", "Source Email"];
      removedSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      removedSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      logInfo(`Created ${CONFIG.SHEETS.REMOVED_NETWORKS} sheet`);
    }
    
    return removedSheet;
  } catch (error) {
    logError("Failed to create Removed Networks sheet", error);
    throw error;
  }
}

/**
 * Processes network removal requests from email replies
 * @returns {Array<Object>} Array of successfully removed networks
 */
function processNetworkRemovalRequests() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const networksSheet = ss.getSheetByName(CONFIG.SHEETS.NETWORKS);
    const removedSheet = ensureRemovedNetworksSheet(ss);
    
    if (!networksSheet) {
      logError("Networks sheet not found");
      return [];
    }
    
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const formattedYesterday = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), CONFIG.DATE_FORMAT.SEARCH);
    
    // Search for replies to both Main and 3K CVI Report emails
    const threads = GmailApp.search(`in:inbox (subject:"DCM CVI Report" OR subject:"DCM 3K CVI Report") after:${formattedYesterday}`);
    const removalCommands = [];
    const regex = /REMOVE\s+NETWORK\s+(\d+)/gi;
    const exampleNetworkIds = new Set(["12345", "67890", "99999"]); // Skip example IDs from email instructions
  
  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const body = message.getPlainBody();
      const from = message.getFrom();
      const messageId = message.getId();
      let match;
      
      while ((match = regex.exec(body)) !== null) {
        const networkId = match[1];
        
        // Skip example network IDs used in email instructions
        if (exampleNetworkIds.has(networkId)) continue;
        
        removalCommands.push({
          networkId: networkId,
          from: from,
          date: message.getDate(),
          messageId: messageId
        });
      }
    });
  });
  
  if (removalCommands.length === 0) {
    Logger.log("No removal requests found.");
    return [];
  }
  
  // Deduplicate by network ID (keep latest request)
  const uniqueRemovals = new Map();
  removalCommands.forEach(cmd => {
    if (!uniqueRemovals.has(cmd.networkId) || uniqueRemovals.get(cmd.networkId).date < cmd.date) {
      uniqueRemovals.set(cmd.networkId, cmd);
    }
  });
  
  // Get existing removed networks to avoid duplicates
  const alreadyRemoved = getRemovedNetworks(ss);
  const successfulRemovals = [];
  
  uniqueRemovals.forEach((cmd, networkId) => {
    if (alreadyRemoved.has(networkId)) {
      Logger.log(`Network ${networkId} already removed. Skipping.`);
      return;
    }
    
    // Find network in Networks sheet
    const networksData = networksSheet.getDataRange().getValues();
    let networkName = "Unknown";
    let rowToDelete = -1;
    
    for (let i = 1; i < networksData.length; i++) {
      if (String(networksData[i][0]).trim() === networkId) {
        networkName = networksData[i][1] || "Unknown";
        rowToDelete = i + 1;
        break;
      }
    }
    
    // Add to Removed Networks sheet with Gmail source link
    const gmailLink = `https://mail.google.com/mail/u/0/#all/${cmd.messageId}`;
    const newRow = [networkId, networkName, cmd.from, Utilities.formatDate(cmd.date, Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss"), gmailLink];
    removedSheet.appendRow(newRow);
    
    // Delete from Networks sheet if found
    if (rowToDelete > 0) {
      networksSheet.deleteRow(rowToDelete);
    }
    
    successfulRemovals.push({ networkId, networkName, from: cmd.from });
  });
  
  // Send confirmation email to bkaufman@horizonmedia.com
  if (successfulRemovals.length > 0) {
    let confirmBody = "<p>The following networks were removed from the DCM CVI monitoring:</p>";
    confirmBody += "<table border='1' cellpadding='5' cellspacing='0' style='border-collapse: collapse;'>";
    confirmBody += "<tr style='background-color: #f2f2f2; font-weight: bold;'><th>Network ID</th><th>Network Name</th><th>Requested By</th></tr>";
    
    successfulRemovals.forEach(removal => {
      confirmBody += `<tr><td>${removal.networkId}</td><td>${removal.networkName}</td><td>${removal.from}</td></tr>`;
    });
    
    confirmBody += "</table>";
    
    MailApp.sendEmail({
      to: CONFIG.ADMIN_EMAIL,
      subject: "DCM Networks Removed - Confirmation",
      htmlBody: confirmBody
    });
    logInfo(`Sent removal confirmation for ${successfulRemovals.length} networks`);
  }
  
  return successfulRemovals;
  } catch (error) {
    logError("Failed to process network removal requests", error);
    // Send error notification to admin
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: "ERROR: DCM Network Removal Failed",
        body: `An error occurred while processing network removal requests:\n\n${error}`
      });
    } catch (emailError) {
      logError("Failed to send error notification email", emailError);
    }
    return [];
  }
}

/**
 * Backfills missing Source Email links in the Removed Networks sheet
 * Searches Gmail for the original removal request emails and adds links to column E
 */
function backfillSourceEmailLinks() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const removedSheet = ss.getSheetByName(CONFIG.SHEETS.REMOVED_NETWORKS);
    
    if (!removedSheet || removedSheet.getLastRow() < 2) {
      logInfo("No removed networks to backfill");
      return 0;
    }
    
    const lastRow = removedSheet.getLastRow();
    const data = removedSheet.getRange(2, 1, lastRow - 1, 5).getValues(); // Get all columns A-E
    let updatedCount = 0;
    const exampleNetworkIds = new Set(["12345", "67890", "99999"]);
    
    for (let i = 0; i < data.length; i++) {
      const networkId = String(data[i][0]).trim();
      const sourceEmail = data[i][4]; // Column E (index 4)
      
      // Skip if already has a link or is an example ID
      if (sourceEmail || !networkId || exampleNetworkIds.has(networkId)) {
        continue;
      }
      
      // Search Gmail for this network ID removal request
      try {
        const threads = GmailApp.search(`(subject:"DCM CVI Report" OR subject:"DCM 3K CVI Report") "REMOVE NETWORK ${networkId}"`);
        
        if (threads.length > 0) {
          // Find the message with the removal command
          let foundMessageId = null;
          const regex = new RegExp(`REMOVE\\s+NETWORK\\s+${networkId}`, "i");
          
          for (let thread of threads) {
            const messages = thread.getMessages();
            for (let message of messages) {
              if (regex.test(message.getPlainBody())) {
                foundMessageId = message.getId();
                break;
              }
            }
            if (foundMessageId) break;
          }
          
          if (foundMessageId) {
            const gmailLink = `https://mail.google.com/mail/u/0/#all/${foundMessageId}`;
            removedSheet.getRange(i + 2, 5).setValue(gmailLink); // Row i+2, Column E
            updatedCount++;
            logInfo(`Added source email link for network ${networkId}`);
          } else {
            logInfo(`Could not find removal message for network ${networkId}`);
          }
        }
      } catch (searchError) {
        logError(`Failed to search for network ${networkId}`, searchError);
      }
      
      // Add a small delay to avoid quota issues
      if (updatedCount > 0 && updatedCount % 10 === 0) {
        Utilities.sleep(1000);
      }
    }
    
    logInfo(`Backfill complete: Updated ${updatedCount} source email links`);
    return updatedCount;
    
  } catch (error) {
    logError("Failed to backfill source email links", error);
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: "ERROR: Backfill Source Email Links Failed",
        body: `An error occurred while backfilling source email links:\n\n${error}`
      });
    } catch (emailError) {
      logError("Failed to send error notification", emailError);
    }
    return 0;
  }
}

/**
 * Automatically adds newly discovered networks to the Networks sheet
 * @param {SpreadsheetApp.Spreadsheet} ss - The active spreadsheet
 * @param {Set<string>} allNetworksChecked - Set of all network IDs found in reports
 */
function autoAddNewNetworks(ss, allNetworksChecked) {
  try {
    const networksSheet = ss.getSheetByName(CONFIG.SHEETS.NETWORKS);
    if (!networksSheet) {
      logError("Networks sheet not found");
      return;
    }
  
  const existingNetworks = new Set();
  const data = networksSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existingNetworks.add(String(data[i][0]).trim());
  }
  
  const newNetworks = [];
  allNetworksChecked.forEach(networkId => {
    if (!existingNetworks.has(networkId) && networkId !== "Unknown" && isValidNetworkId(networkId)) {
      newNetworks.push([networkId, "TO BE ADDED SOON"]);
    }
  });
  
    if (newNetworks.length > 0) {
      networksSheet.getRange(networksSheet.getLastRow() + 1, 1, newNetworks.length, 2).setValues(newNetworks);
      logInfo(`Auto-added ${newNetworks.length} new networks`);
    }
  } catch (error) {
    logError("Failed to auto-add new networks", error);
  }
}

/**
 * Builds a set of network IDs that had at least one report attachment today.
 * Used to distinguish "no report" from "report present with zero placements" in summaries.
 * @returns {Set<string>} Set of network IDs found in today's labeled Gmail reports
 */
function getNetworksCheckedToday() {
  const checkedNetworks = new Set();

  try {
    const today = new Date();
    const formattedToday = Utilities.formatDate(today, Session.getScriptTimeZone(), CONFIG.DATE_FORMAT.SEARCH);
    const threads = GmailApp.search(`label:${CONFIG.GMAIL_LABEL} after:${formattedToday}`);

    threads.forEach(thread => {
      thread.getMessages().forEach(message => {
        message.getAttachments().forEach(attachment => {
          const attachmentName = attachment.getName();

          // Ignore outbound report CSVs and other non-network attachments
          if (!isNetworkReportFileName(attachmentName)) {
            return;
          }

          const networkId = extractNetworkId(attachmentName);

          if (isValidNetworkId(networkId)) {
            checkedNetworks.add(String(networkId));
          }

          if (attachment.getContentType() === "application/zip") {
            const unzippedFiles = Utilities.unzip(attachment.copyBlob());
            unzippedFiles.forEach(file => {
              if (!isNetworkReportFileName(file.getName())) {
                return;
              }

              const nestedId = extractNetworkId(file.getName());
              if (isValidNetworkId(nestedId)) {
                checkedNetworks.add(String(nestedId));
              }
            });
          }
        });
      });
    });
  } catch (error) {
    logError("Failed to build today's checked network set", error);
  }

  return checkedNetworks;
}

/**
 * Returns display text for summary count, clarifying why a network is at zero.
 * @param {number|undefined} rowCount - Imported placement count for the network
 * @param {boolean} reportPresent - Whether a report file was found for the network today
 * @returns {string} Summary cell text
 */
function getPlacementStatusText(rowCount, reportPresent) {
  if (rowCount && rowCount > 0) {
    return String(rowCount);
  }

  return reportPresent ? "0 - report present" : "0 - no report present today";
}



/**
 * Sends Main Report (12.5K threshold) to Column A recipients
 * @param {Array<Array>} outputData - Filtered placement data to report (optional - reads from Output sheet if not provided)
 * @param {Map<string, number>} validNetworks - Map of network IDs to placement counts (optional)
 * @param {Set<string>} allNetworksChecked - Set of all networks processed (optional)
 */
function sendMainReport(outputData, validNetworks, allNetworksChecked) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet();
    const outputSheet = sheet.getSheetByName(CONFIG.SHEETS.OUTPUT);
    const emailSheet = sheet.getSheetByName(CONFIG.SHEETS.EMAIL_LIST);
    const networksSheet = sheet.getSheetByName(CONFIG.SHEETS.NETWORKS);

    // If called from menu without parameters, read data from sheets
    if (!outputData) {
      if (outputSheet.getLastRow() > 1) {
        outputData = outputSheet.getRange(2, 1, outputSheet.getLastRow() - 1, outputSheet.getLastColumn()).getValues();
      } else {
        outputData = [];
      }
    }
    
    if (!validNetworks) {
      validNetworks = new Map();
      // Build validNetworks from the data in Data sheet
      const dataSheet = sheet.getSheetByName(CONFIG.SHEETS.DATA);
      if (dataSheet && dataSheet.getLastRow() > 1) {
        const dataRows = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 1).getValues();
        dataRows.forEach(row => {
          const netId = String(row[0]);
          validNetworks.set(netId, (validNetworks.get(netId) || 0) + 1);
        });
      }
    }
    
    if (!allNetworksChecked) {
      allNetworksChecked = getNetworksCheckedToday();
    }

    const emails = emailSheet.getRange("A2:A").getValues().flat().filter(email => email);
    if (emails.length === 0) {
      logError("No email recipients found in Email List sheet");
      return;
    }

    const today = new Date();
    const formattedDate = Utilities.formatDate(today, Session.getScriptTimeZone(), CONFIG.DATE_FORMAT.EMAIL);
    let subject = `DCM CVI Report - ${formattedDate}`;
  let body = "";

  // 📊 Main CVI Table
  if (outputData.length > 0) {
    body += `<p>DAILY DCM CVI Report (placements that accrued +$100 in click fees yesterday):</p>`;
    body += "<table border='1' cellpadding='3' cellspacing='0' style='border-collapse: collapse; font-size: 12px; text-align: left; width: 100%;'>";
    const headers = ["Network ID", "Advertiser ID", "Advertiser Name", "Campaign ID", "Campaign Name", "Placement ID", "Placement Name", "Impressions", "Clicks", "Difference %"];
    body += "<tr style='background-color: #f2f2f2; font-weight: bold;'>";
    headers.forEach(header => body += `<th style='padding: 8px;'>${header}</th>`);
    body += "</tr>";
    outputData.forEach(row => {
      body += "<tr>";
      row.forEach((cell, index) => {
        let cellContent = index === 6 && cell.length > 30 ? cell.substring(0, 30) + "..." : cell;
        body += `<td style='padding: 5px; max-width: 30px;'>${cellContent}</td>`;
      });
      body += "</tr>";
    });
    body += "</table><br/>";
  } else {
    body += "<p>No placements accrued +$100 in click fees yesterday.</p><br/>";
  }

  // 🧾 Network Summary
  const removedNetworkIds = getRemovedNetworks(sheet); // Get list of removed network IDs
  const crossRef = getExpectedNetworkRows(networksSheet, removedNetworkIds);
  const missingNetworkReports = getMissingNetworkReports(crossRef, allNetworksChecked);
  let summaryTableRows = [];
  let noDataNetworks = [];

  crossRef.forEach(([id, name]) => {
    const networkId = String(id);
    const rowCount = validNetworks.get(networkId);
    const placementStatus = getPlacementStatusText(rowCount, allNetworksChecked.has(networkId));
    summaryTableRows.push(`<tr><td>${id}</td><td>${name}</td><td>${placementStatus}</td></tr>`);
    
    if (allNetworksChecked.has(networkId) && !validNetworks.has(networkId)) {
      noDataNetworks.push(`${id} - ${name}`);
    }
  });

  body += `<p>The following networks were checked:</p>`;
  body += "<table border='1' cellpadding='4' cellspacing='0' style='border-collapse: collapse; font-size: 10px;'>";
  body += "<tr style='background-color: #f2f2f2; font-weight: bold;'><th>Network ID</th><th>Network Name</th><th># of Placements Imported</th></tr>";
  body += summaryTableRows.join("");
  body += "</table><br/>";

  if (noDataNetworks.length > 0) {
    body += `<p>⚠️ The following networks had files received but <strong>no valid CSV data</strong> was found:</p>`;
    body += `<ul>${noDataNetworks.map(n => `<li>${n}</li>`).join("")}</ul>`;
  }

  if (missingNetworkReports.length > 0) {
    body += `<p>⚠️ No report email was found today for the following source-of-truth networks/advertisers:</p>`;
    body += `<ul>${missingNetworkReports.map(n => `<li>${n}</li>`).join("")}</ul>`;
  }

  body += "<p><small>📧 <strong>To remove a network from monitoring:</strong> Reply to this email with \"REMOVE NETWORK [ID]\" in the body.<br/>";
  body += "Example (for multiple networks):<br/>";
  body += "REMOVE NETWORK 12345<br/>";
  body += "REMOVE NETWORK 67890<br/>";
  body += "REMOVE NETWORK 99999</small></p>";
  body += "<hr style='border: 1px solid #ddd; margin: 20px 0;'/>";
  body += "<p><strong>📋 How to Add a New Network Report:</strong></p>";
  body += "<ol style='line-height: 1.8;'>";
  body += "<li><strong>Step 1:</strong> Place this exact string into the AI helper in DCM Reports:<br/><code style='background: #f4f4f4; padding: 2px 6px;'>Advertiser ID, Advertiser, Campaign ID, campaign, Placement ID, Placement, impressions, clicks, Yesterday</code></li>";
  body += "<li><strong>Step 2:</strong> Set the report subject/label to exactly: <code style='background: #f4f4f4; padding: 2px 6px;'>BKCVI click and impression</code> (this auto-applies the DCM Reports Gmail label)</li>";
  body += "<li><strong>Step 3:</strong> Set schedule with end date of <strong>Jan 1, 2030</strong></li>";
  body += "<li><strong>Step 4:</strong> Ensure you CC this email exactly: <code style='background: #f4f4f4; padding: 2px 6px;'>platformsolutionsadopshorizon@gmail.com</code></li>";
  body += "</ol>";
  body += "<p>Brought to you by the Platform Solutions Automation. (Made by: BK).</p>";

    const csvHeaders = ["Network ID", "Advertiser ID", "Advertiser Name", "Campaign ID", "Campaign Name", "Placement ID", "Placement Name", "Impressions", "Clicks", "Difference %"];
    const csvContent = [csvHeaders, ...outputData].map(row => row.join(",")).join("\n");
    const csvBlob = Utilities.newBlob(csvContent, "text/csv", `DCM_CVI_Report_${formattedDate}.csv`);
    emails.forEach(email => {
      MailApp.sendEmail({ to: email, subject: subject, htmlBody: body, attachments: outputData.length > 0 ? [csvBlob] : [] });
    });
    logInfo(`Sent Main Report (12.5K) to ${emails.length} recipients with ${outputData.length} placements`);
  } catch (error) {
    logError("Failed to send main report", error);
    // Attempt to notify admin of failure
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: "ERROR: DCM CVI Report Failed to Send",
        body: `An error occurred while sending the daily CVI report:\n\n${error}`
      });
    } catch (emailError) {
      logError("Failed to send error notification", emailError);
    }
  }
}

/**
 * Sends 3K Report (3,000 click threshold) to Column D recipients
 * @param {Array<Array>} outputData - Filtered placement data to report (optional - reads from 3K Output sheet if not provided)
 * @param {Map<string, number>} validNetworks - Map of network IDs to placement counts (optional)
 * @param {Set<string>} allNetworksChecked - Set of all networks processed (optional)
 */
function send3KReport(outputData, validNetworks, allNetworksChecked) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet();
    const output3KSheet = sheet.getSheetByName(CONFIG.SHEETS.OUTPUT_3K);
    const emailSheet = sheet.getSheetByName(CONFIG.SHEETS.EMAIL_LIST);
    const networksSheet = sheet.getSheetByName(CONFIG.SHEETS.NETWORKS);

    // If called from menu without parameters, read data from sheets
    if (!outputData) {
      if (output3KSheet && output3KSheet.getLastRow() > 1) {
        outputData = output3KSheet.getRange(2, 1, output3KSheet.getLastRow() - 1, output3KSheet.getLastColumn()).getValues();
      } else {
        outputData = [];
      }
    }
    
    if (!validNetworks) {
      validNetworks = new Map();
      // Build validNetworks from the data in Data sheet
      const dataSheet = sheet.getSheetByName(CONFIG.SHEETS.DATA);
      if (dataSheet && dataSheet.getLastRow() > 1) {
        const dataRows = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 1).getValues();
        dataRows.forEach(row => {
          const netId = String(row[0]);
          validNetworks.set(netId, (validNetworks.get(netId) || 0) + 1);
        });
      }
    }
    
    if (!allNetworksChecked) {
      allNetworksChecked = getNetworksCheckedToday();
    }

    const emails = emailSheet.getRange("D2:D").getValues().flat().filter(email => email);
    if (emails.length === 0) {
      logError("No 3K report recipients found in Email List Column D");
      return;
    }

    const today = new Date();
    const formattedDate = Utilities.formatDate(today, Session.getScriptTimeZone(), CONFIG.DATE_FORMAT.EMAIL);
    let subject = `DCM 3K CVI Report - ${formattedDate}`;
    let body = "";

    // 📊 3K CVI Table
    if (outputData.length > 0) {
      body += `<p>DAILY DCM 3K CVI Report (placements with 3,000+ clicks and clicks > impressions):</p>`;
      body += "<table border='1' cellpadding='3' cellspacing='0' style='border-collapse: collapse; font-size: 12px; text-align: left; width: 100%;'>";
      const headers = ["Network ID", "Advertiser ID", "Advertiser Name", "Campaign ID", "Campaign Name", "Placement ID", "Placement Name", "Impressions", "Clicks", "Difference %"];
      body += "<tr style='background-color: #f2f2f2; font-weight: bold;'>";
      headers.forEach(header => body += `<th style='padding: 8px;'>${header}</th>`);
      body += "</tr>";
      outputData.forEach(row => {
        body += "<tr>";
        row.forEach((cell, index) => {
          let cellContent = index === 6 && cell.length > 30 ? cell.substring(0, 30) + "..." : cell;
          body += `<td style='padding: 5px; max-width: 30px;'>${cellContent}</td>`;
        });
        body += "</tr>";
      });
      body += "</table><br/>";
    } else {
      body += "<p>No placements met the 3K threshold criteria yesterday.</p><br/>";
    }

    // 🧾 Network Summary
    const removedNetworkIds = getRemovedNetworks(sheet); // Get list of removed network IDs
    const crossRef = getExpectedNetworkRows(networksSheet, removedNetworkIds);
    const missingNetworkReports = getMissingNetworkReports(crossRef, allNetworksChecked);
    let summaryTableRows = [];
    let noDataNetworks = [];

    crossRef.forEach(([id, name]) => {
      const networkId = String(id);
      const rowCount = validNetworks.get(networkId);
      const placementStatus = getPlacementStatusText(rowCount, allNetworksChecked.has(networkId));
      summaryTableRows.push(`<tr><td>${id}</td><td>${name}</td><td>${placementStatus}</td></tr>`);
      
      if (allNetworksChecked.has(networkId) && !validNetworks.has(networkId)) {
        noDataNetworks.push(`${id} - ${name}`);
      }
    });

    body += `<p>The following networks were checked:</p>`;
    body += "<table border='1' cellpadding='4' cellspacing='0' style='border-collapse: collapse; font-size: 10px;'>";
    body += "<tr style='background-color: #f2f2f2; font-weight: bold;'><th>Network ID</th><th>Network Name</th><th># of Placements Imported</th></tr>";
    body += summaryTableRows.join("");
    body += "</table><br/>";

    if (noDataNetworks.length > 0) {
      body += `<p>⚠️ The following networks had files received but <strong>no valid CSV data</strong> was found:</p>`;
      body += `<ul>${noDataNetworks.map(n => `<li>${n}</li>`).join("")}</ul>`;
    }

    if (missingNetworkReports.length > 0) {
      body += `<p>⚠️ No report email was found today for the following source-of-truth networks/advertisers:</p>`;
      body += `<ul>${missingNetworkReports.map(n => `<li>${n}</li>`).join("")}</ul>`;
    }

    body += "<p><small>📧 <strong>To remove a network from monitoring:</strong> Reply to this email with \"REMOVE NETWORK [ID]\" in the body.<br/>";
    body += "Example (for multiple networks):<br/>";
    body += "REMOVE NETWORK 12345<br/>";
    body += "REMOVE NETWORK 67890<br/>";
    body += "REMOVE NETWORK 99999</small></p>";
    body += "<hr style='border: 1px solid #ddd; margin: 20px 0;'/>";
    body += "<p><strong>📋 How to Add a New Network Report:</strong></p>";
    body += "<ol style='line-height: 1.8;'>";
    body += "<li><strong>Step 1:</strong> Place this exact string into the AI helper in DCM Reports:<br/><code style='background: #f4f4f4; padding: 2px 6px;'>Advertiser ID, Advertiser, Campaign ID, campaign, Placement ID, Placement, impressions, clicks, Yesterday</code></li>";
    body += "<li><strong>Step 2:</strong> Set the report subject/label to exactly: <code style='background: #f4f4f4; padding: 2px 6px;'>BKCVI click and impression</code> (this auto-applies the DCM Reports Gmail label)</li>";
    body += "<li><strong>Step 3:</strong> Set schedule with end date of <strong>Jan 1, 2030</strong></li>";
    body += "<li><strong>Step 4:</strong> Ensure you CC this email exactly: <code style='background: #f4f4f4; padding: 2px 6px;'>platformsolutionsadopshorizon@gmail.com</code></li>";
    body += "</ol>";
    body += "<p>Brought to you by the Platform Solutions Automation. (Made by: BK).</p>";

    const csvHeaders = ["Network ID", "Advertiser ID", "Advertiser Name", "Campaign ID", "Campaign Name", "Placement ID", "Placement Name", "Impressions", "Clicks", "Difference %"];
    const csvContent = [csvHeaders, ...outputData].map(row => row.join(",")).join("\n");
    const csvBlob = Utilities.newBlob(csvContent, "text/csv", `DCM_3K_CVI_Report_${formattedDate}.csv`);
    emails.forEach(email => {
      MailApp.sendEmail({ to: email, subject: subject, htmlBody: body, attachments: outputData.length > 0 ? [csvBlob] : [] });
    });
    logInfo(`Sent 3K Report to ${emails.length} recipients with ${outputData.length} placements`);
  } catch (error) {
    logError("Failed to send 3K report", error);
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: "ERROR: DCM 3K CVI Report Failed to Send",
        body: `An error occurred while sending the 3K CVI report:\n\n${error}`
      });
    } catch (emailError) {
      logError("Failed to send error notification", emailError);
    }
  }
}

/**
 * Sends both Main (12.5K) and 3K reports - for automation
 */
function sendAllReports() {
  try {
    logInfo("Importing fresh data and sending all reports");
    importDCMReports();
    sendMainReport();
    send3KReport();
    logInfo("All reports sent successfully");
  } catch (error) {
    logError("Failed to send all reports", error);
    throw error;
  }
}

/**
 * Main function: Imports DCM reports and processes data for BOTH outputs
 * Does NOT send emails - use sendMainReport(), send3KReport(), or sendAllReports() separately
 * Workflow:
 * 1. Process network removal requests
 * 2. Import CSV data from Gmail attachments
 * 3. Filter for CVI violations (clicks >= $100, clicks > impressions)
 * 4. Auto-add new networks
 * 5. Send email reports
 */
function importDCMReports() {
  try {
    logInfo("Starting DCM report import");
    const sheet = SpreadsheetApp.getActiveSpreadsheet();

    syncSourceData();
    
    // Process network removal requests FIRST (before importing data)
    processNetworkRemovalRequests();
    
    // Get list of removed networks to filter out
    const removedNetworks = getRemovedNetworks(sheet);

    const ignoredAdvertisers = getIgnoredAdvertisers(sheet);

    const dataSheet = sheet.getSheetByName(CONFIG.SHEETS.DATA) || sheet.insertSheet(CONFIG.SHEETS.DATA);
    const outputSheet = sheet.getSheetByName(CONFIG.SHEETS.OUTPUT) || sheet.insertSheet(CONFIG.SHEETS.OUTPUT);
    const output3KSheet = sheet.getSheetByName(CONFIG.SHEETS.OUTPUT_3K) || sheet.insertSheet(CONFIG.SHEETS.OUTPUT_3K);
    const today = new Date();
    const formattedToday = Utilities.formatDate(today, Session.getScriptTimeZone(), CONFIG.DATE_FORMAT.SEARCH);

  const dataHeaders = ["Network ID", "Advertiser ID", "Advertiser", "Campaign ID", "Campaign", "Placement ID", "Placement", "Impressions", "Clicks"];
  const outputHeaders = [...dataHeaders, "Difference %"];

    // Clear only data rows (keep headers), more efficient than clearContents()
    if (dataSheet.getLastRow() > 1) {
      dataSheet.deleteRows(2, dataSheet.getLastRow() - 1);
    }
    if (outputSheet.getLastRow() > 1) {
      outputSheet.deleteRows(2, outputSheet.getLastRow() - 1);
    }
    if (output3KSheet.getLastRow() > 1) {
      output3KSheet.deleteRows(2, output3KSheet.getLastRow() - 1);
    }
    
    // Set headers if sheets are empty
    if (dataSheet.getLastRow() === 0) {
      dataSheet.getRange(1, 1, 1, dataHeaders.length).setValues([dataHeaders]);
    }
    if (outputSheet.getLastRow() === 0) {
      outputSheet.getRange(1, 1, 1, outputHeaders.length).setValues([outputHeaders]);
    }
    if (output3KSheet.getLastRow() === 0) {
      output3KSheet.getRange(1, 1, 1, outputHeaders.length).setValues([outputHeaders]);
    }

    const threads = GmailApp.search(`label:${CONFIG.GMAIL_LABEL} after:${formattedToday}`);
    let extractedData = [];
    let allNetworksChecked = new Set();
    let validNetworks = new Map(); // Map<networkId, numberOfPlacements>
    let ignoredNonNetworkAttachments = 0;

    if (threads.length === 0) {
      logInfo(`Ignored non-network attachments: ${ignoredNonNetworkAttachments}`);
      logInfo("No emails found with today's reports");
      return;
    }

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const attachments = message.getAttachments();
      attachments.forEach(attachment => {
        const name = attachment.getName();

        // Ignore outbound report CSVs and any other non-network attachments
        if (!isNetworkReportFileName(name)) {
          ignoredNonNetworkAttachments++;
          return;
        }

        const networkId = extractNetworkId(name);

        // Skip invalid/non-numeric network IDs
        if (!isValidNetworkId(networkId)) {
          Logger.log(`Skipping invalid network ID from attachment: ${name}`);
          return;
        }
        
        // Skip if network is in the removed list
        if (removedNetworks.has(networkId)) {
          Logger.log(`Skipping removed network: ${networkId}`);
          return;
        }
        
        allNetworksChecked.add(networkId);

        if (attachment.getContentType() === "text/csv" || name.endsWith(".csv")) {
          const rawRows = processCSV(attachment.getDataAsString(), networkId);
          const filteredRows = filterIgnoredAdvertisers(
            rawRows.filter(r => r[1] !== "Grand Total:"),
            ignoredAdvertisers
          );
          validNetworks.set(networkId, (validNetworks.get(networkId) || 0) + filteredRows.length);
          if (filteredRows.length > 0) {
            extractedData = extractedData.concat(filteredRows);
          }
        } else if (attachment.getContentType() === "application/zip") {
          const unzippedFiles = Utilities.unzip(attachment.copyBlob());
          unzippedFiles.forEach(file => {
            if (!isNetworkReportFileName(file.getName())) {
              ignoredNonNetworkAttachments++;
              return;
            }

            const nestedId = extractNetworkId(file.getName());

            // Skip invalid/non-numeric network IDs
            if (!isValidNetworkId(nestedId)) {
              Logger.log(`Skipping invalid network ID from zip file: ${file.getName()}`);
              return;
            }
            
            // Skip if network is in the removed list
            if (removedNetworks.has(nestedId)) {
              Logger.log(`Skipping removed network: ${nestedId}`);
              return;
            }
            
            allNetworksChecked.add(nestedId);
            if (file.getContentType() === "text/csv" || file.getName().endsWith(".csv")) {
              const rawRows = processCSV(file.getDataAsString(), nestedId);
              const filteredRows = filterIgnoredAdvertisers(
                rawRows.filter(r => r[1] !== "Grand Total:"),
                ignoredAdvertisers
              );
              validNetworks.set(nestedId, (validNetworks.get(nestedId) || 0) + filteredRows.length);
              if (filteredRows.length > 0) {
                extractedData = extractedData.concat(filteredRows);
              }
            }
          });
        }
      });
    });
  });
  
  // Auto-add any new networks discovered
  autoAddNewNetworks(sheet, allNetworksChecked);

  if (extractedData.length > 0) {
    dataSheet.getRange(2, 1, extractedData.length, dataHeaders.length).setValues(extractedData);
  }

    // Filter placements for Main Report (12.5K threshold)
    // Criteria: Clicks >= 12,500, Clicks > Impressions, No DART Search, Impressions > 0
    let mainOutputData = extractedData
      .filter(row => parseInt(row[8], 10) >= CONFIG.CLICK_THRESHOLD &&
                     parseInt(row[8], 10) > parseInt(row[7], 10) &&
                     !String(row[4]).toLowerCase().includes("dart search") &&
                     parseInt(row[7], 10) > 0)
      .map(row => {
        let impressions = parseInt(row[7], 10) || 0;
        let clicks = parseInt(row[8], 10) || 0;
        let diffPercentage = impressions === 0 ? "Infinity%" : ((clicks - impressions) / impressions * 100).toFixed(2) + "%";
        return [...row, diffPercentage];
      });

    // Filter placements for 3K Report
    // Criteria: Clicks >= 3,000, Clicks > Impressions, No DART Search, Impressions >= 0
    let output3KData = extractedData
      .filter(row => parseInt(row[8], 10) >= CONFIG.CLICK_THRESHOLD_3K &&
                     parseInt(row[8], 10) > parseInt(row[7], 10) &&
                     !String(row[4]).toLowerCase().includes("dart search") &&
                     parseInt(row[7], 10) >= 0)
      .map(row => {
        let impressions = parseInt(row[7], 10) || 0;
        let clicks = parseInt(row[8], 10) || 0;
        let diffPercentage = impressions === 0 ? "Infinity%" : ((clicks - impressions) / impressions * 100).toFixed(2) + "%";
        return [...row, diffPercentage];
      });

    if (mainOutputData.length > 0) {
      outputSheet.getRange(2, 1, mainOutputData.length, outputHeaders.length).setValues(mainOutputData);
    }

    if (output3KData.length > 0) {
      output3KSheet.getRange(2, 1, output3KData.length, outputHeaders.length).setValues(output3KData);
    }

    logInfo(`Ignored non-network attachments: ${ignoredNonNetworkAttachments}`);
    logInfo(`Import completed: ${extractedData.length} total rows, ${mainOutputData.length} main placements, ${output3KData.length} 3K placements`);
  } catch (error) {
    logError("Fatal error in importDCMReports", error);
    // Notify admin of catastrophic failure
    try {
      MailApp.sendEmail({
        to: CONFIG.ADMIN_EMAIL,
        subject: "CRITICAL ERROR: DCM Report Import Failed",
        body: `A critical error occurred during the DCM report import process:\n\n${error}\n\nStack trace:\n${error.stack || 'N/A'}`
      });
    } catch (emailError) {
      logError("Failed to send critical error notification", emailError);
    }
    throw error; // Re-throw to ensure Apps Script logs the failure
  }
}