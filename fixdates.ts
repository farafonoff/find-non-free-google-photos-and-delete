import { chromium, Page } from 'playwright';
import { expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { exit } from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const browser = await chromium.connectOverCDP('http://localhost:9223');

const context = browser.contexts()[0]; // уже существующий
const page = context.pages()[0] || await context.newPage();

await page.goto('https://photos.google.com');

// Type for date information
type DateInfo = {
  id: string | null;
  filename: string | null;
  metadataDate: string | null; // ISO format date from metadata
  filenameDate: string | null; // ISO format date from filename
};

// Function to extract photo information including dates
async function extractPhotoInfo(page: Page): Promise<DateInfo> {
  // Wait for the photo view to load
  await page.waitForTimeout(500);

  // Get the photo ID from the URL
  const url = page.url();
  const urlMatch = url.match(/\/photo\/([A-Za-z0-9_-]+)/);
  const id = urlMatch ? urlMatch[1] : null;

  // Find the Info panel by its heading
  const infoHeading = page.getByRole('heading', { name: 'Info' });
  // Get the panel container that contains this heading
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

  // Only after waiting failed, continue with click magic
  if (!isPanelVisible) {
    // Click the button to open the Info panel
    // The button has aria-label="Open info"
    const openInfoButton = page.getByRole('button', { name: 'Open info' });
    await openInfoButton.waitFor({ state: 'visible', timeout: 5000 });
    
    // Click the button
    await openInfoButton.click();
    await page.waitForTimeout(300);
    
    // Check if panel is visible after first click
    const panelVisibleAfterFirstClick = await infoPanel.isVisible().catch(() => false);
    
    // If panel is still not visible, click again (sometimes first click hides it)
    if (!panelVisibleAfterFirstClick) {
      console.log('Panel not visible after first click, clicking again...');
      await openInfoButton.click();
      await page.waitForTimeout(300);
    }
    
    // Wait for the panel to appear
    await infoPanel.waitFor({ state: 'visible', timeout: 5000 });
  }

  // Verify the Info panel is now visible
  await expect(infoPanel).toBeVisible();

  // Extract the filename from the Info panel
  const filenameDiv = infoPanel.locator('div.R9U8ab[aria-label^="Filename: "]');
  await expect(filenameDiv).toBeVisible();
  const filename = await filenameDiv.textContent();

  // Extract date metadata from the Info panel
  // Look for the date element with aria-label="Date taken: ..."
  let metadataDate: string | null = null;
  try {
    const dateElement = infoPanel.locator('div.R9U8ab[jsname="pG3jE"][aria-label^="Date taken:"]');
    const dateExists = await dateElement.isVisible().catch(() => false);
    
    if (dateExists) {
      const dateAriaLabel = await dateElement.getAttribute('aria-label');
      if (dateAriaLabel) {
        // Extract date from "Date taken: Aug 26, 2024" or "Date taken: Jan 14"
        const dateMatch = dateAriaLabel.match(/Date taken:\s*(.+)/i);
        if (dateMatch) {
          const dateText = dateMatch[1].trim();
          
          // Extract time from the time element
          let timeText: string | null = null;
          try {
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
          } catch (error) {
            console.log('Error extracting time:', error);
          }
          
          // Extract timezone
          let timezone: string | null = null;
          try {
            const timezoneElement = infoPanel.locator('span.sprMUb[aria-label^="GMT"]');
            const timezoneExists = await timezoneElement.isVisible().catch(() => false);
            if (timezoneExists) {
              const timezoneAriaLabel = await timezoneElement.getAttribute('aria-label');
              if (timezoneAriaLabel) {
                timezone = timezoneAriaLabel.trim();
              }
            }
          } catch (error) {
            console.log('Error extracting timezone:', error);
          }
          
          // Parse date and time to ISO format
          metadataDate = parseMetadataDate(dateText, timeText, timezone);
        }
      }
    }
  } catch (error) {
    console.log('Error extracting metadata date:', error);
  }

  // Parse filename for date/time
  let filenameDate: string | null = null;
  if (filename) {
    filenameDate = parseFilenameDate(filename.trim());
  }

  return {
    id,
    filename: filename?.trim() || null,
    metadataDate,
    filenameDate
  };
}

// Function to parse metadata date to ISO format
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

// Function to parse filename date to ISO format
// Format: YYYYMMDD_HHMMSSsss (e.g., PXL_20260114_100210191.jpg)
function parseFilenameDate(filename: string): string | null {
  try {
    // Match pattern: YYYYMMDD_HHMMSSsss (with optional prefix/suffix)
    const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(\d{3})/);
    if (match) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]) - 1; // Month is 0-indexed
      const day = parseInt(match[3]);
      const hours = parseInt(match[4]);
      const minutes = parseInt(match[5]);
      const seconds = parseInt(match[6]);
      const milliseconds = parseInt(match[7]);
      
      const date = new Date(year, month, day, hours, minutes, seconds, milliseconds);
      
      if (isNaN(date.getTime())) {
        console.log(`Invalid date from filename: ${filename}`);
        return null;
      }
      
      return date.toISOString();
    }
    
    // Try alternative format without milliseconds: YYYYMMDD_HHMMSS
    const match2 = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
    if (match2) {
      const year = parseInt(match2[1]);
      const month = parseInt(match2[2]) - 1;
      const day = parseInt(match2[3]);
      const hours = parseInt(match2[4]);
      const minutes = parseInt(match2[5]);
      const seconds = parseInt(match2[6]);
      
      const date = new Date(year, month, day, hours, minutes, seconds);
      
      if (isNaN(date.getTime())) {
        console.log(`Invalid date from filename: ${filename}`);
        return null;
      }
      
      return date.toISOString();
    }
    
    return null;
  } catch (error) {
    console.log(`Error parsing filename date: ${filename}`, error);
    return null;
  }
}

// Function to log date info to datelog.json (line by line, not valid JSON)
async function logDateInfo(dateInfo: DateInfo): Promise<void> {
  const logLine = JSON.stringify(dateInfo) + '\n';
  await writeFile(__dirname + '/datelog.json', logLine, { flag: 'a' });
}

// Function to restore state from datelog.json
async function restoreState(page: Page): Promise<DateInfo | null> {
  try {
    const logContent = await readFile(__dirname + '/datelog.json', 'utf8');
    const lines = logContent.trim().split('\n').filter(line => line.trim());
    
    let lastPhoto: DateInfo | null = null;
    
    // Find last photo
    for (const line of lines) {
      try {
        const dateInfo: DateInfo = JSON.parse(line);
        if (dateInfo.id) {
          lastPhoto = dateInfo;
        }
      } catch (error) {
        console.error('Error parsing log line:', error, line);
      }
    }
    
    if (lastPhoto && lastPhoto.id) {
      console.log('Restoring state to last photo:', lastPhoto.id);
      await page.goto(`https://photos.google.com/photo/${lastPhoto.id}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1000);
      return lastPhoto;
    }
    
    console.log('No photo found in log');
    return null;
  } catch (error) {
    console.log('No datelog.json found or error reading it:', error);
    return null;
  }
}

// Try to restore state from previous run
const restoredPhotoInfo = await restoreState(page);
let restored = false;

if (restoredPhotoInfo) {
  console.log('Restored to photo:', restoredPhotoInfo);
  restored = true;
} else {
  // If no restore, start from first photo in grid
  const grid = page.locator('div[jsname="ni8Knc"]');
  await grid.waitFor({ state: "visible" });

  await expect(
    grid.getByRole("link", { name: /^Photo -/ }).first()
  ).toBeVisible();

  await grid
    .getByRole("link", { name: /^Photo -/ })
    .first()
    .click();
}

// Loop through photos
let previousPhotoInfo: DateInfo | null = null;
let currentPhotoInfo: DateInfo | null = null;

while (true) {
  currentPhotoInfo = await extractPhotoInfo(page);
  console.log('Current photo info:', currentPhotoInfo);

  // If filename hasn't changed from previous photo, retry up to 5 more times
  if (previousPhotoInfo && previousPhotoInfo.filename === currentPhotoInfo.filename) {
    let retryCount = 0;
    const maxRetries = 5;
    
    while (retryCount < maxRetries && previousPhotoInfo.filename === currentPhotoInfo.filename) {
      retryCount++;
      if (retryCount > 1) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(5000);
      }
      console.log(`Filename unchanged, retrying (${retryCount}/${maxRetries}), waiting 5 seconds...`);
      await page.waitForTimeout(5000);
      // Re-extract photo info after waiting
      currentPhotoInfo = await extractPhotoInfo(page);
    }
    
    // If filename still hasn't changed after all retries, exit to restart script
    if (previousPhotoInfo.filename === currentPhotoInfo.filename) {
      console.log('Filename still unchanged after all retries, exiting to restart script...');
      console.log('Last processed photo:', previousPhotoInfo);
      exit(1); // Exit with code 1 to indicate restart needed
    }
  }

  // Log the date info
  await logDateInfo(currentPhotoInfo);
  
  // Navigate to next photo with right arrow key
  console.log('Navigating to next photo...');
  await page.keyboard.press('ArrowRight');
  // Wait a bit for the next photo to load
  await page.waitForTimeout(500);

  // Update previous photo info for next iteration
  previousPhotoInfo = currentPhotoInfo;
}
