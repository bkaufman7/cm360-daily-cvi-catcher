function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("DCM Reports")
    .addItem("Import DCM Reports", "importDCMReports")
    .addItem("Send Output Emails", "sendOutputEmails")
    .addItem("Process Network Removal Requests", "processNetworkRemovalRequests")
    .addToUi();
}

function extractNetworkId(fileName) {
  const match = fileName.match(/^([^_]+)_/);
  return match ? String(match[1]) : "Unknown";
}


function processCSV(fileContent, networkId) {
  let lines = fileContent.split("\n").map(line => line.trim()).filter(line => line);
  let startIndex = lines.findIndex(line => line.startsWith("Advertiser ID"));
  if (startIndex === -1) return [];

  let csvData = Utilities.parseCsv(lines.slice(startIndex).join("\n"));
  csvData.shift(); // Remove headers
  return csvData.map(row => [networkId, ...row]);
}

function getAdvertisersFromRawData(ss) {
  const advertiserSet = new Set();
  const raw = ss.getSheetByName("Raw Data");

  if (raw) {
    const data = raw.getDataRange().getValues();
    const m = getHeaderMap(data[0]);

    data.slice(1).forEach(r => {
      const adv = r[m["Advertiser"]];
      if (adv) advertiserSet.add(adv.toString().trim().toLowerCase());
    });
  }

  return advertiserSet;
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

function ensureRemovedNetworksSheet(ss) {
  let removedSheet = ss.getSheetByName("Removed Networks");
  
  if (!removedSheet) {
    removedSheet = ss.insertSheet("Removed Networks");
    const headers = ["Network ID", "Network Name", "Removed By", "Date Removed"];
    removedSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    removedSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  }
  
  return removedSheet;
}

function processNetworkRemovalRequests() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const networksSheet = ss.getSheetByName("Networks");
  const removedSheet = ensureRemovedNetworksSheet(ss);
  
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const formattedYesterday = Utilities.formatDate(yesterday, Session.getScriptTimeZone(), "yyyy/MM/dd");
  
  // Search for replies to DCM CVI Report emails
  const threads = GmailApp.search(`subject:"DCM CVI Report" after:${formattedYesterday}`);
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
      to: "bkaufman@horizonmedia.com",
      subject: "DCM Networks Removed - Confirmation",
      htmlBody: confirmBody
    });
  }
  
  return successfulRemovals;
}

function autoAddNewNetworks(ss, allNetworksChecked) {
  const networksSheet = ss.getSheetByName("Networks");
  if (!networksSheet) return;
  
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
  }
}



function sendOutputEmails(outputData, validNetworks, allNetworksChecked) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  const outputSheet = sheet.getSheetByName("Output");
  const emailSheet = sheet.getSheetByName("Email List");
  const networksSheet = sheet.getSheetByName("Networks");

  const emails = emailSheet.getRange("A2:A").getValues().flat().filter(email => email);
  if (emails.length === 0) return;

  const today = new Date();
  const formattedDate = Utilities.formatDate(today, Session.getScriptTimeZone(), "MM.dd.yy");
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

  body += "<p><small>📧 <strong>To remove a network from monitoring:</strong> Reply to this email with \"REMOVE NETWORK [ID]\" in the body (e.g., \"REMOVE NETWORK 12345\").</small></p>";
  body += "<p>Brought to you by the Platform Solutions Automation. (Made by: BK).</p>";

  const csvBlob = Utilities.newBlob(outputData.map(row => row.join(",")).join("\n"), "text/csv", `DCM_CVI_Report_${formattedDate}.csv`);
  emails.forEach(email => {
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: body, attachments: outputData.length > 0 ? [csvBlob] : [] });
  });
}

function importDCMReports() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
  
  // Process network removal requests FIRST (before importing data)
  processNetworkRemovalRequests();
  
  // Get list of removed networks to filter out
  const removedNetworks = getRemovedNetworks(sheet);
  
  const dataSheet = sheet.getSheetByName("Data") || sheet.insertSheet("Data");
  const outputSheet = sheet.getSheetByName("Output") || sheet.insertSheet("Output");
  const label = "DCM Reports";
  const today = new Date();
  const formattedToday = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy/MM/dd");

  const dataHeaders = ["Network ID", "Advertiser ID", "Advertiser", "Campaign ID", "Campaign", "Placement ID", "Placement", "Impressions", "Clicks"];
  const outputHeaders = [...dataHeaders, "Difference %"];

  dataSheet.clearContents(); 
  outputSheet.clearContents();
  dataSheet.getRange(1, 1, 1, dataHeaders.length).setValues([dataHeaders]);
  outputSheet.getRange(1, 1, 1, outputHeaders.length).setValues([outputHeaders]);

  const threads = GmailApp.search(`label:${label} after:${formattedToday}`);
  let extractedData = [];
  let allNetworksChecked = new Set();
  let validNetworks = new Map(); // Map<networkId, numberOfPlacements>

  if (threads.length === 0) {
    Logger.log("⚠️ No emails found with today's reports.");
    sendOutputEmails([], validNetworks, allNetworksChecked);
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

  // Load ignored advertisers from "Advertisers to ignore" tab

let outputData = extractedData
  .filter(row => parseInt(row[8], 10) >= 12500 &&
                 parseInt(row[8], 10) > parseInt(row[7], 10) &&
                 !String(row[4]).toLowerCase().includes("dart search") &&
                 parseInt(row[7], 10) > 0)
  .map(row => {
    let impressions = parseInt(row[7], 10) || 0;
    let clicks = parseInt(row[8], 10) || 0;
    let diffPercentage = impressions === 0 ? "Infinity%" : ((clicks - impressions) / impressions * 100).toFixed(2) + "%";
    return [...row, diffPercentage];
  });


  if (outputData.length > 0) {
    outputSheet.getRange(2, 1, outputData.length, outputHeaders.length).setValues(outputData);
  }

  sendOutputEmails(outputData, validNetworks, allNetworksChecked);
}