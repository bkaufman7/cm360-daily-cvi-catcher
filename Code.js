// Configuration Constants
const CONFIG = {
  GMAIL_LABEL: "DCM Reports",
  CLICK_THRESHOLD: 12500, // $100 in click fees at $0.008 CPC ($100 / $0.008 = 12,500 clicks)
  CLICK_THRESHOLD_3K: 3000, // 3K threshold for Jenny's report
  ADMIN_EMAIL: "bkaufman@horizonmedia.com",
  SHEETS: {
    DATA: "Data",
    OUTPUT: "Output",
    OUTPUT_3K: "3K Output",
    NETWORKS: "Networks",
    EMAIL_LIST: "Email List",
    REMOVED_NETWORKS: "Removed Networks"
  },
  DATE_FORMAT: {
    EMAIL: "MM.dd.yy",
    SEARCH: "yyyy/MM/dd",
    AUDIT: "MM/dd/yyyy HH:mm:ss"
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

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("DCM Reports")
    .addItem("Import DCM Reports", "importDCMReports")
    .addItem("Send Main Report (12.5K)", "sendMainReport")
    .addItem("Send 3K Report", "send3KReport")
    .addItem("Send All Reports", "sendAllReports")
    .addSeparator()
    .addItem("Process Network Removal Requests", "processNetworkRemovalRequests")
    .addToUi();
}

/**
 * Extracts network ID from filename (format: NETWORKID_...)
 * @param {string} fileName - The name of the CSV file
 * @returns {string} Network ID or "Unknown" if not found
 */
function extractNetworkId(fileName) {
  const match = fileName.match(/^([^_]+)_/);
  const id = match ? String(match[1]).trim() : "Unknown";
  if (id === "Unknown") {
    logError(`Could not extract network ID from filename: ${fileName}`);
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
  let lines = fileContent.split("\n").map(line => line.trim()).filter(line => line);
  let startIndex = lines.findIndex(line => line.startsWith("Advertiser ID"));
  if (startIndex === -1) return [];

  let csvData = Utilities.parseCsv(lines.slice(startIndex).join("\n"));
  csvData.shift(); // Remove headers
  return csvData.map(row => [networkId, ...row]);
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
      const headers = ["Network ID", "Network Name", "Removed By", "Date Removed"];
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
    const threads = GmailApp.search(`(subject:"DCM CVI Report" OR subject:"DCM 3K CVI Report") after:${formattedYesterday}`);
    const removalCommands = [];
    const regex = /REMOVE\s+NETWORK\s+(\d+)/gi;
  
  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const body = message.getPlainBody();
      const from = message.getFrom();
      let match;
      
      while ((match = regex.exec(body)) !== null) {
        const networkId = match[1];
        removalCommands.push({
          networkId: networkId,
          from: from,
          date: message.getDate()
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
    
    // Add to Removed Networks sheet
    const newRow = [networkId, networkName, cmd.from, Utilities.formatDate(cmd.date, Session.getScriptTimeZone(), "MM/dd/yyyy HH:mm:ss")];
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
    if (!existingNetworks.has(networkId) && networkId !== "Unknown") {
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
      allNetworksChecked = new Set(validNetworks.keys());
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
  const crossRef = networksSheet.getRange(2, 1, networksSheet.getLastRow() - 1, 2).getValues(); // [ [id, name], ... ]
  let summaryTableRows = [];
  let noDataNetworks = [];

  crossRef.forEach(([id, name]) => {
    // Skip empty rows
    if (!id || String(id).trim() === "") return;
    
    const rowCount = validNetworks.get(String(id));
    // Show all networks in the Networks sheet, with 0 if no data
    summaryTableRows.push(`<tr><td>${id}</td><td>${name}</td><td>${rowCount ?? 0}</td></tr>`);
    
    if (allNetworksChecked.has(String(id)) && !validNetworks.has(String(id))) {
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

    const csvBlob = Utilities.newBlob(outputData.map(row => row.join(",")).join("\n"), "text/csv", `DCM_CVI_Report_${formattedDate}.csv`);
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
      allNetworksChecked = new Set(validNetworks.keys());
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
    const crossRef = networksSheet.getRange(2, 1, networksSheet.getLastRow() - 1, 2).getValues();
    let summaryTableRows = [];
    let noDataNetworks = [];

    crossRef.forEach(([id, name]) => {
      if (!id || String(id).trim() === "") return;
      
      const rowCount = validNetworks.get(String(id));
      summaryTableRows.push(`<tr><td>${id}</td><td>${name}</td><td>${rowCount ?? 0}</td></tr>`);
      
      if (allNetworksChecked.has(String(id)) && !validNetworks.has(String(id))) {
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

    const csvBlob = Utilities.newBlob(outputData.map(row => row.join(",")).join("\n"), "text/csv", `DCM_3K_CVI_Report_${formattedDate}.csv`);
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
    logInfo("Sending all reports");
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
    
    // Process network removal requests FIRST (before importing data)
    processNetworkRemovalRequests();
    
    // Get list of removed networks to filter out
    const removedNetworks = getRemovedNetworks(sheet);
    
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

    if (threads.length === 0) {
      logInfo("No emails found with today's reports");
      return;
    }

  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      const attachments = message.getAttachments();
      attachments.forEach(attachment => {
        const name = attachment.getName();
        const networkId = extractNetworkId(name);
        
        // Skip if network is in the removed list
        if (removedNetworks.has(networkId)) {
          Logger.log(`Skipping removed network: ${networkId}`);
          return;
        }
        
        allNetworksChecked.add(networkId);

        if (attachment.getContentType() === "text/csv" || name.endsWith(".csv")) {
          const rawRows = processCSV(attachment.getDataAsString(), networkId);
          const filteredRows = rawRows.filter(r => r[1] !== "Grand Total:");
          validNetworks.set(networkId, (validNetworks.get(networkId) || 0) + filteredRows.length);
          if (filteredRows.length > 0) {
            extractedData = extractedData.concat(filteredRows);
          }
        } else if (attachment.getContentType() === "application/zip") {
          const unzippedFiles = Utilities.unzip(attachment.copyBlob());
          unzippedFiles.forEach(file => {
            const nestedId = extractNetworkId(file.getName());
            
            // Skip if network is in the removed list
            if (removedNetworks.has(nestedId)) {
              Logger.log(`Skipping removed network: ${nestedId}`);
              return;
            }
            
            allNetworksChecked.add(nestedId);
            if (file.getContentType() === "text/csv" || file.getName().endsWith(".csv")) {
              const rawRows = processCSV(file.getDataAsString(), nestedId);
              const filteredRows = rawRows.filter(r => r[1] !== "Grand Total:");
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