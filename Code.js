function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("DCM Reports")
    .addItem("Import DCM Reports", "importDCMReports")
    .addItem("Send Output Emails", "sendOutputEmails")
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
    if (validNetworks.has(String(id))) {
      summaryTableRows.push(`<tr><td>${id}</td><td>${name}</td><td>${rowCount ?? 0}</td></tr>`);
    }
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

  body += "<p>Brought to you by the Platform Solutions Automation. (Made by: BK).</p>";

  const csvBlob = Utilities.newBlob(outputData.map(row => row.join(",")).join("\n"), "text/csv", `DCM_CVI_Report_${formattedDate}.csv`);
  emails.forEach(email => {
    MailApp.sendEmail({ to: email, subject: subject, htmlBody: body, attachments: outputData.length > 0 ? [csvBlob] : [] });
  });
}

function importDCMReports() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet();
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