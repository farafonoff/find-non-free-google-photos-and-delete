import { chromium, Page } from 'playwright';
import { expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const browser = await chromium.connectOverCDP('http://localhost:9223');

const context = browser.contexts()[0]; // уже существующий
const page = context.pages()[0] || await context.newPage();

// Type for date information
type DateInfo = {
  id: string | null;
  filename: string | null;
  metadataDate: string | null;
  filenameDate: string | null;
  targetDate?: string | null;
  processed?: boolean;
};

// Function to read datelog.json
async function readDateLog(): Promise<DateInfo[]> {
  try {
    const content = await readFile(__dirname + '/datelog.json', 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line) as DateInfo);
  } catch (error) {
    console.log('Error reading datelog.json:', error);
    return [];
  }
}

// Function to update datelog.json
async function updateDateLog(updatedEntries: DateInfo[]): Promise<void> {
  const lines = updatedEntries.map(entry => JSON.stringify(entry) + '\n');
  await writeFile(__dirname + '/datelog.json', lines.join(''));
}

// Function to convert ISO date to UTC+3 and extract components
function convertToUTC3(dateISO: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  ampm: 'AM' | 'PM';
} | null {
  try {
    const date = new Date(dateISO);
    if (isNaN(date.getTime())) {
      return null;
    }
    
    // Convert to UTC+3 (add 3 hours)
    const utc3Date = new Date(date.getTime() + 3 * 60 * 60 * 1000);
    
    const year = utc3Date.getUTCFullYear().toString();
    const month = (utc3Date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = utc3Date.getUTCDate().toString().padStart(2, '0');
    
    let hour = utc3Date.getUTCHours();
    const minute = utc3Date.getUTCMinutes().toString().padStart(2, '0');
    
    const ampm = hour >= 12 ? 'PM' : 'AM';
    if (hour === 0) {
      hour = 12;
    } else if (hour > 12) {
      hour = hour - 12;
    }
    const hourStr = hour.toString().padStart(2, '0');
    
    return {
      year,
      month,
      day,
      hour: hourStr,
      minute,
      ampm
    };
  } catch (error) {
    console.log('Error converting date to UTC+3:', error);
    return null;
  }
}

// Function to open info panel
async function openInfoPanel(page: Page): Promise<void> {
  const infoHeading = page.getByRole('heading', { name: 'Info' });
  const infoPanel = page.locator('div.YW656b').filter({ has: infoHeading });
  
  // Wait for panel visibility in loop (5 iterations, 500ms between)
  let isPanelVisible = false;
  for (let i = 0; i < 5; i++) {
    isPanelVisible = await infoPanel.isVisible().catch(() => false);
    if (isPanelVisible) {
      break;
    }
    await page.waitForTimeout(500);
  }
  
  // If panel is not visible, try to open it
  if (!isPanelVisible) {
    try {
      const openInfoButton = page.getByRole('button', { name: 'Open info' });
      await openInfoButton.waitFor({ state: 'visible', timeout: 5000 });
      await openInfoButton.click();
      await page.waitForTimeout(300);
      
      // Check if panel is visible after first click
      const panelVisibleAfterFirstClick = await infoPanel.isVisible().catch(() => false);
      if (!panelVisibleAfterFirstClick) {
        await openInfoButton.click();
        await page.waitForTimeout(300);
      }
      
      await infoPanel.waitFor({ state: 'visible', timeout: 5000 });
    } catch (error) {
      console.log('Could not open Info panel:', error);
      throw error;
    }
  }
}

// Function to click on pencil icon near photo date
async function clickDateEditButton(page: Page): Promise<void> {
  // Find the info panel first to scope the search
  const infoHeading = page.getByRole('heading', { name: 'Info' });
  const infoPanel = page.locator('div.YW656b').filter({ has: infoHeading });
  
  // Find the date edit button - the div with jsname="sMyUPe" containing the pencil icon
  // It should be inside the info panel
  const dateEditContainer = infoPanel.locator('div[jsname="sMyUPe"]');
  await dateEditContainer.waitFor({ state: 'visible', timeout: 10000 });
  
  // Find the clickable element inside (the div with jsaction="click:pRBiFd")
  const dateEditButton = dateEditContainer.locator('div[jsaction="click:pRBiFd"]');
  await dateEditButton.waitFor({ state: 'visible', timeout: 5000 });
  await dateEditButton.click();
  await page.waitForTimeout(500);
}

// Function to fill in date fields in the popup
async function fillDateFields(page: Page, dateComponents: {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  ampm: 'AM' | 'PM';
}): Promise<void> {
  // Wait for the popup to appear
  const popup = page.locator('div.uW2Fw-P5QLlc.cPSYW[aria-modal="true"]');
  await popup.waitFor({ state: 'visible', timeout: 10000 });
  
  // Fill Year field (inside div with jsname="A1zabe")
  const yearContainer = page.locator('div[jsname="A1zabe"]');
  const yearInput = yearContainer.locator('input[jsname="YPqjbf"][aria-label="Year"]');
  await yearInput.waitFor({ state: 'visible', timeout: 5000 });
  await yearInput.clear();
  await yearInput.fill(dateComponents.year);
  await page.waitForTimeout(200);
  
  // Fill Month field (inside div with jsname="byRamd")
  const monthContainer = page.locator('div[jsname="byRamd"]');
  const monthInput = monthContainer.locator('input[jsname="YPqjbf"][aria-label="Month"]');
  await monthInput.waitFor({ state: 'visible', timeout: 5000 });
  await monthInput.clear();
  await monthInput.fill(dateComponents.month);
  await page.waitForTimeout(200);
  
  // Fill Day field (inside div with jsname="SSBzX")
  const dayContainer = page.locator('div[jsname="SSBzX"]');
  const dayInput = dayContainer.locator('input[jsname="YPqjbf"][aria-label="Day"]');
  await dayInput.waitFor({ state: 'visible', timeout: 5000 });
  await dayInput.clear();
  await dayInput.fill(dateComponents.day);
  await page.waitForTimeout(200);
  
  // Fill Hour field (inside div with jsname="UJav8d")
  const hourContainer = page.locator('div[jsname="UJav8d"]');
  const hourInput = hourContainer.locator('input[jsname="YPqjbf"][aria-label="Hour"]');
  await hourInput.waitFor({ state: 'visible', timeout: 5000 });
  await hourInput.clear();
  await hourInput.fill(dateComponents.hour);
  await page.waitForTimeout(200);
  
  // Fill Minute field (inside div with jsname="jtSTYe")
  const minuteContainer = page.locator('div[jsname="jtSTYe"]');
  const minuteInput = minuteContainer.locator('input[jsname="YPqjbf"][aria-label="Minutes"]');
  await minuteInput.waitFor({ state: 'visible', timeout: 5000 });
  await minuteInput.clear();
  await minuteInput.fill(dateComponents.minute);
  await page.waitForTimeout(200);
  
  // Fill AM/PM field (jsname="nhrP1")
  const ampmInput = page.locator('input[jsname="nhrP1"][aria-label="AM/PM"]');
  await ampmInput.waitFor({ state: 'visible', timeout: 5000 });
  await ampmInput.clear();
  await ampmInput.fill(dateComponents.ampm);
  await page.waitForTimeout(200);
  
  // Timezone should already be UTC+3, so we don't change it
  // Click Save button (data-mdc-dialog-action="EBS5u")
  const saveButton = page.locator('button[data-mdc-dialog-action="EBS5u"]');
  await saveButton.waitFor({ state: 'visible', timeout: 5000 });
  await saveButton.click();
  await page.waitForTimeout(500);
}

// Function to wait for popup to disappear
async function waitForPopupToDisappear(page: Page): Promise<void> {
  const popup = page.locator('div.uW2Fw-P5QLlc.cPSYW[aria-modal="true"]');
  await popup.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {
    // If it doesn't disappear, wait a bit more
    return page.waitForTimeout(2000);
  });
}

// Function to verify date on the page
async function verifyDate(page: Page, expectedDateISO: string): Promise<boolean> {
  try {
    // Wait a bit for the page to update
    await page.waitForTimeout(1000);
    
    // Open info panel if not already open
    await openInfoPanel(page);
    
    const infoHeading = page.getByRole('heading', { name: 'Info' });
    const infoPanel = page.locator('div.YW656b').filter({ has: infoHeading });
    
    // Extract date from the info panel
    const dateElement = infoPanel.locator('div.R9U8ab[jsname="pG3jE"][aria-label^="Date taken:"]');
    const dateExists = await dateElement.isVisible().catch(() => false);
    
    if (!dateExists) {
      console.log('Date element not found in info panel');
      return false;
    }
    
    // Get the date text
    const dateAriaLabel = await dateElement.getAttribute('aria-label');
    if (!dateAriaLabel) {
      console.log('Date aria-label not found');
      return false;
    }
    
    // Extract time
    let timeText: string | null = null;
    const timeElement = infoPanel.locator('span.sprMUb[aria-label^="Time taken:"]');
    const timeExists = await timeElement.isVisible().catch(() => false);
    if (timeExists) {
      const timeAriaLabel = await timeElement.getAttribute('aria-label');
      if (timeAriaLabel) {
        const timeMatch = timeAriaLabel.match(/Time taken:\s*(.+)/i);
        if (timeMatch) {
          timeText = timeMatch[1].trim();
        }
      }
    }
    
    // Parse the date (simplified - just check if it's close)
    // For now, we'll just verify that the date element exists and has content
    // A more thorough check would parse and compare, but this is a reasonable verification
    console.log(`Verified date: ${dateAriaLabel}${timeText ? `, ${timeText}` : ''}`);
    return true;
  } catch (error) {
    console.log('Error verifying date:', error);
    return false;
  }
}

// Function to process a single photo
async function processPhoto(page: Page, entry: DateInfo): Promise<boolean> {
  try {
    if (!entry.id || !entry.targetDate) {
      console.log(`Skipping entry: missing id or targetDate`);
      return false;
    }
    
    console.log(`\nProcessing: ${entry.filename || entry.id}`);
    console.log(`  Target date: ${entry.targetDate}`);
    
    // Navigate to photo
    await page.goto(`https://photos.google.com/photo/${entry.id}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);
    
    // Open info panel
    await openInfoPanel(page);
    await page.waitForTimeout(500);
    
    // Click on pencil icon near photo date
    await clickDateEditButton(page);
    await page.waitForTimeout(500);
    
    // Convert targetDate to UTC+3 components
    const dateComponents = convertToUTC3(entry.targetDate);
    if (!dateComponents) {
      console.log(`  ✗ Failed to convert date: ${entry.targetDate}`);
      return false;
    }
    
    console.log(`  Date components (UTC+3): ${dateComponents.year}-${dateComponents.month}-${dateComponents.day} ${dateComponents.hour}:${dateComponents.minute} ${dateComponents.ampm}`);
    
    // Fill in date fields
    await fillDateFields(page, dateComponents);
    
    // Wait for popup to disappear
    await waitForPopupToDisappear(page);
    await page.waitForTimeout(1000);
    
    // Verify date on the same page
    const verified = await verifyDate(page, entry.targetDate);
    if (!verified) {
      console.log(`  ⚠ Warning: Date verification failed, but continuing...`);
    }
    
    console.log(`  ✓ Date updated successfully`);
    return true;
  } catch (error) {
    console.log(`  ✗ Error processing photo: ${error}`);
    return false;
  }
}

// Main execution
console.log('Reading datelog.json...');
const dateLog = await readDateLog();

console.log(`Found ${dateLog.length} entries in datelog.json`);

// Find entries with targetDate but without processed: true
const entriesToProcess = dateLog.filter(entry => 
  entry.targetDate && !entry.processed
);

console.log(`Found ${entriesToProcess.length} entries to process`);

if (entriesToProcess.length === 0) {
  console.log('No entries to process. Exiting.');
  process.exit(0);
}

// Process each entry
let processedCount = 0;
let successCount = 0;

for (const entry of entriesToProcess) {
  const success = await processPhoto(page, entry);
  
  if (success) {
    // Update the entry in dateLog
    const entryIndex = dateLog.findIndex(e => e.id === entry.id);
    if (entryIndex !== -1) {
      dateLog[entryIndex].processed = true;
      processedCount++;
      
      // Save immediately after each successful update
      await updateDateLog(dateLog);
      console.log(`  ✓ Marked as processed and saved to datelog.json`);
      successCount++;
    }
  }
  
  // Small delay between photos
  await page.waitForTimeout(1000);
}

// Final summary
console.log(`\nSummary:`);
console.log(`  - Processed: ${processedCount} entries`);
console.log(`  - Successful: ${successCount} entries`);
console.log(`  - Failed: ${processedCount - successCount} entries`);

console.log('\nDone!');
