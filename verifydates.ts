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
  metadataDate: string | null; // ISO format date from metadata
  filenameDate: string | null; // ISO format date from filename
  targetDate?: string | null; // ISO format date from trash (when dates differ > 8 hours)
  processed?: boolean;
};

// Type for photo log entry
type PhotoLogEntry = {
  id: string;
  filename: string;
  free?: boolean;
  downloaded?: boolean;
  deleted?: boolean;
};

// Function to parse metadata date to ISO format (reused from fixdates.ts)
function parseMetadataDate(dateText: string, timeText: string | null, timezone: string | null): string | null {
  try {
    const now = new Date();
    let date: Date;
    
    // Check if timeText indicates "Today" - if so, use current date
    const isToday = timeText && timeText.toLowerCase().includes('today');
    
    if (dateText.toLowerCase().includes('today') || isToday) {
      date = new Date(now);
    } else if (dateText.toLowerCase().includes('yesterday')) {
      date = new Date(now);
      date.setDate(date.getDate() - 1);
    } else {
      // Check if dateText contains a 4-digit year (1900-2100 range)
      const yearMatch = dateText.match(/\b(19|20)\d{2}\b/);
      const hasYear = yearMatch !== null;
      
      // If no year found, add current year
      let dateToParse = dateText;
      if (!hasYear) {
        // Try format "Month Day, Year" first
        if (dateText.includes(',')) {
          dateToParse = `${dateText}, ${now.getFullYear()}`;
        } else {
          // Try format "Month Day Year"
          dateToParse = `${dateText} ${now.getFullYear()}`;
        }
      }
      
      // Parse the date
      let parsedDate = new Date(dateToParse);
      
      // If parsing failed, try alternative formats
      if (isNaN(parsedDate.getTime())) {
        if (!hasYear) {
          // Try with comma format if we didn't already
          if (!dateText.includes(',')) {
            parsedDate = new Date(`${dateText}, ${now.getFullYear()}`);
          } else {
            parsedDate = new Date(`${dateText} ${now.getFullYear()}`);
          }
        }
      }
      
      // Validate the parsed date
      if (isNaN(parsedDate.getTime()) || parsedDate.getFullYear() < 1900) {
        console.log(`Failed to parse date: ${dateText}`);
        return null;
      }
      
      date = parsedDate;
    }
    
    // Parse time if available
    if (timeText) {
      // Handle "Today, 1:02 PM" or "Mon, 8:38 PM"
      const timeMatch = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (timeMatch) {
        let hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        const ampm = timeMatch[3].toUpperCase();
        
        if (ampm === 'PM' && hours !== 12) {
          hours += 12;
        } else if (ampm === 'AM' && hours === 12) {
          hours = 0;
        }
        
        date.setHours(hours, minutes, 0, 0);
      }
    }
    
    // Convert to ISO string
    return date.toISOString();
  } catch (error) {
    console.log(`Error parsing metadata date: ${dateText}, ${timeText}`, error);
    return null;
  }
}

// Function to extract date from trash view
async function extractDateFromTrash(page: Page, photoId: string): Promise<string | null> {
  try {
    // Navigate to trash view
    await page.goto(`https://photos.google.com/trash/${photoId}`, {
      waitUntil: "domcontentloaded",
    });
    
    await page.waitForTimeout(1000);
    
    // Find the Info panel by its heading (similar to fixdates.ts)
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
        console.log('Could not open Info panel in trash view:', error);
      }
    }
    
    // Try to find date information in the Info panel
    let dateText: string | null = null;
    let timeText: string | null = null;
    let timezone: string | null = null;
    
    try {
      // Look for date element in Info panel
      const dateElement = infoPanel.locator('div.R9U8ab[jsname="pG3jE"][aria-label^="Date taken:"]');
      const dateExists = await dateElement.isVisible().catch(() => false);
      
      if (dateExists) {
        const dateAriaLabel = await dateElement.getAttribute('aria-label');
        if (dateAriaLabel) {
          const dateMatch = dateAriaLabel.match(/Date taken:\s*(.+)/i);
          if (dateMatch) {
            dateText = dateMatch[1].trim();
          }
        }
      }
      
      // Look for time element
      if (dateText) {
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
        
        // Look for timezone
        const timezoneElement = infoPanel.locator('span.sprMUb[aria-label^="GMT"]');
        const timezoneExists = await timezoneElement.isVisible().catch(() => false);
        if (timezoneExists) {
          const timezoneAriaLabel = await timezoneElement.getAttribute('aria-label');
          if (timezoneAriaLabel) {
            timezone = timezoneAriaLabel.trim();
          }
        }
      }
    } catch (error) {
      console.log('Error extracting date from trash view:', error);
    }
    
    if (dateText) {
      return parseMetadataDate(dateText, timeText, timezone);
    }
    
    return null;
  } catch (error) {
    console.log(`Error extracting date from trash for photo ${photoId}:`, error);
    return null;
  }
}

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

// Function to read photolog.json
async function readPhotoLog(): Promise<PhotoLogEntry[]> {
  try {
    const content = await readFile(__dirname + '/photolog.json', 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    return lines.map(line => JSON.parse(line) as PhotoLogEntry);
  } catch (error) {
    console.log('Error reading photolog.json:', error);
    return [];
  }
}

// Function to update datelog.json
async function updateDateLog(updatedEntries: DateInfo[]): Promise<void> {
  const lines = updatedEntries.map(entry => JSON.stringify(entry) + '\n');
  await writeFile(__dirname + '/datelog.json', lines.join(''));
}

// Function to find old id in photolog.json by filename
function findOldId(photoLog: PhotoLogEntry[], filename: string): string | null {
  const entry = photoLog.find(e => e.filename === filename);
  return entry ? entry.id : null;
}

// Function to parse filename date with pattern YYYYMMDD-HHMMSS (e.g., Screenshot_20260114-153434.png)
function parseFilenameDateWithDash(filename: string): string | null {
  try {
    // Match pattern: YYYYMMDD-HHMMSS (with optional prefix/suffix)
    const match = filename.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
    if (match) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]) - 1; // Month is 0-indexed
      const day = parseInt(match[3]);
      const hours = parseInt(match[4]);
      const minutes = parseInt(match[5]);
      const seconds = parseInt(match[6]);
      
      const date = new Date(year, month, day, hours, minutes, seconds);
      
      if (isNaN(date.getTime())) {
        return null;
      }
      
      return date.toISOString();
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Function to calculate time difference in hours between two ISO date strings
function getTimeDifferenceHours(date1: string | null, date2: string | null): number | null {
  if (!date1 || !date2) {
    return null;
  }
  
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return null;
    }
    
    const diffMs = Math.abs(d1.getTime() - d2.getTime());
    const diffHours = diffMs / (1000 * 60 * 60);
    
    return diffHours;
  } catch (error) {
    return null;
  }
}

// Function to output red text
function redText(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

// Main execution
console.log('Reading datelog.json and photolog.json...');
const dateLog = await readDateLog();
const photoLog = await readPhotoLog();

console.log(`Found ${dateLog.length} entries in datelog.json`);
console.log(`Found ${photoLog.length} entries in photolog.json`);

// First pass: try to parse filename dates with the new pattern for ALL entries where filenameDate is null
let filenameDateUpdatedCount = 0;
for (const entry of dateLog) {
  if (entry.filename && !entry.filenameDate) {
    const parsedDate = parseFilenameDateWithDash(entry.filename);
    if (parsedDate) {
      entry.filenameDate = parsedDate;
      filenameDateUpdatedCount++;
    }
  }
}

if (filenameDateUpdatedCount > 0) {
  console.log(`Updated ${filenameDateUpdatedCount} entries with filenameDate using dash pattern`);
}

// Second pass: find entries to process from ALL entries in datelog.json
// Processing criteria:
// 1. Skip files starting with BEST_OF_MONTH or RECAP
// 2. Skip if targetDate already exists
// 3. Process if filenameDate is null OR differs from metadataDate by 8+ hours
const entriesToProcess: DateInfo[] = [];
for (const entry of dateLog) {
  if (entry.processed) {
    console.log(`Skipping ${entry.filename}: already processed`);
    continue;
  }
  // Skip if filename starts with BEST_OF_MONTH or RECAP
  if (entry.filename && (
    entry.filename.startsWith('BEST_OF_MONTH') || 
    entry.filename.startsWith('RECAP')
  )) {
    continue;
  }
  
  // Skip if targetDate already exists
  if (entry.targetDate) {
    continue;
  }
  
  // Process if filenameDate is null
  if (!entry.filenameDate) {
    entriesToProcess.push(entry);
    continue;
  }
  
  // Process if filenameDate and metadataDate differ by 8+ hours
  if (entry.metadataDate) {
    const diffHours = getTimeDifferenceHours(entry.filenameDate, entry.metadataDate);
    if (diffHours !== null && diffHours >= 8) {
      entriesToProcess.push(entry);
    }
  }
}

console.log(`Found ${entriesToProcess.length} entries to process`);

// Process each entry
let updatedCount = 0;
for (const dateEntry of entriesToProcess) {
  // Skip if targetDate already exists (double-check)
  if (dateEntry.targetDate) {
    console.log(`Skipping ${dateEntry.filename}: targetDate already exists`);
    continue;
  }
  
  if (!dateEntry.filename) {
    console.log(`Skipping entry without filename: ${dateEntry.id}`);
    continue;
  }
  
  // Find old id in photolog.json
  const oldId = findOldId(photoLog, dateEntry.filename);
  if (!oldId) {
    console.log(`Could not find old id for filename: ${dateEntry.filename}`);
    continue;
  }
  
  const diffHours = dateEntry.filenameDate && dateEntry.metadataDate 
    ? getTimeDifferenceHours(dateEntry.filenameDate, dateEntry.metadataDate)
    : null;
  const diffHoursFormatted = diffHours !== null ? diffHours.toFixed(2) : 'N/A';
  
  console.log(`\nProcessing: ${dateEntry.filename}`);
  console.log(`  Current ID: ${dateEntry.id}`);
  console.log(`  Old ID: ${oldId}`);
  console.log(`  Metadata date: ${dateEntry.metadataDate}`);
  console.log(`  Filename date: ${dateEntry.filenameDate || 'null'}`);
  if (diffHours !== null) {
    console.log(redText(`  Date difference: ${diffHoursFormatted} hours`));
  }
  
  // Extract date from trash view
  const trashDate = await extractDateFromTrash(page, oldId);
  console.log(`  Trash date (targetDate): ${trashDate}`);
  
  // Add targetDate field if we got a date from trash
  if (trashDate !== null && dateEntry.id) {
    const entryIndex = dateLog.findIndex(e => e.id === dateEntry.id);
    if (entryIndex !== -1) {
      dateLog[entryIndex].targetDate = trashDate;
      updatedCount++;
      console.log(`  ✓ Added targetDate: ${trashDate}`);
      
      // Update datelog.json after each photo (inexpensive relative to browser operations)
      await updateDateLog(dateLog);
      console.log(`  ✓ Updated datelog.json`);
    }
  }
  
  // Small delay between requests
  await page.waitForTimeout(1000);
}

// Final summary
if (filenameDateUpdatedCount > 0 || updatedCount > 0) {
  console.log(`\nSummary:`);
  if (filenameDateUpdatedCount > 0) {
    console.log(`  - Updated ${filenameDateUpdatedCount} entries with filenameDate`);
  }
  if (updatedCount > 0) {
    console.log(`  - Added targetDate to ${updatedCount} entries`);
  }
  console.log(`  - All updates saved to datelog.json`);
} else {
  console.log('\nNo updates needed');
}

console.log('\nDone!');
