import { chromium, Page } from 'playwright';
import { expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { exit } from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const browser = await chromium.connectOverCDP('http://localhost:9223');

const context = browser.contexts()[0]; // уже существующий
const page = context.pages()[0] || await context.newPage();

const saveDir = 'google-photos-anna';

// CDP: Page.setDownloadBehavior
const client = await context.newCDPSession(page);
// configure manually downloads dir, such as
// /Users/artem_farafonov/Projects/gphotos/playwright/google-photos
console.log(__dirname + '/google-photos-anna');
await client.send('Page.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: __dirname + '/google-photos-anna'
});

await page.goto('https://photos.google.com');

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

// Type for photo information
type PhotoInfo = {
  id: string | null;
  filename: string | null;
  free: boolean; // true if photo doesn't have file size
  notTakingSpace: boolean; // true if photo has "doesn't take up space" message
  fileSize: string | null; // file size if available (e.g., "443.6 KB")
  downloaded?: boolean;
  deleted?: boolean;
};

// Function to extract photo information from the Info panel
async function extractPhotoInfo(page: Page): Promise<PhotoInfo> {
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

  // Check if the item doesn't take up space
  const storageSpan = infoPanel.locator('span').filter({ 
    hasText: "This item doesn't take up space in your account storage." 
  });
  const notTakingSpace = await storageSpan.isVisible().catch(() => false);

  // Extract the filename from the Info panel
  const filenameDiv = infoPanel.locator('div.R9U8ab[aria-label^="Filename: "]');
  await expect(filenameDiv).toBeVisible();
  const filename = await filenameDiv.textContent();

  // Extract file size - look for "File size: X" or "Backed up (X)" pattern
  let fileSize: string | null = null;
  try {
    // Look for aria-label with "File size:"
    const fileSizeElement = infoPanel.locator('[aria-label^="File size:"]');
    const fileSizeExists = await fileSizeElement.isVisible().catch(() => false);
    
    if (fileSizeExists) {
      const ariaLabel = await fileSizeElement.getAttribute('aria-label');
      if (ariaLabel) {
        // Extract size from "File size: 443.6 KB"
        const sizeMatch = ariaLabel.match(/File size:\s*([\d.]+)\s*(KB|MB|GB|B)/i);
        if (sizeMatch) {
          fileSize = `${sizeMatch[1]} ${sizeMatch[2]}`;
        }
      }
    } else {
      // Try to find in "Backed up (X)" format
      const backedUpElement = infoPanel.locator('span').filter({ 
        hasText: /Backed up\s*\([\d.]+\s*(KB|MB|GB|B)\)/i 
      });
      const backedUpExists = await backedUpElement.isVisible().catch(() => false);
      if (backedUpExists) {
        const text = await backedUpElement.textContent();
        if (text) {
          const sizeMatch = text.match(/\(([\d.]+\s*(KB|MB|GB|B))\)/i);
          if (sizeMatch) {
            fileSize = sizeMatch[1];
          }
        }
      }
    }
  } catch (error) {
    console.log('Error extracting file size:', error);
  }

  // Photo is free if it doesn't have a file size
  const free = fileSize === null;

  return {
    id,
    filename: filename?.trim() || null,
    free,
    notTakingSpace,
    fileSize
  };
}

// Function to send Shift+D to download photo
async function sendShiftD(page: Page): Promise<void> {
  await page.keyboard.down('Shift');
  await page.keyboard.press('D');
  await page.keyboard.up('Shift');
}

// Function to download photo
async function downloadPhoto(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download", {
      timeout: 5 * 60 * 1000,
    }),
    sendShiftD(page),
  ]);

  // Wait for download to complete
  const downloadPath = await download.path();
  console.log("Downloaded to:", downloadPath);
  await page.waitForTimeout(1000);
  
  return downloadPath || '';
}

// Function to confirm move to trash
async function confirmMoveToTrash(page: Page): Promise<void> {
  const modalText = page.locator("text=Remove from your Google Account");
  await modalText.waitFor({ state: "visible" });

  const text = await modalText.innerText();
  try {
    const match = text.match(/recover\s+([\d.]+)\s*(KB|MB|GB)/i);
    if (!match) throw new Error("Could not parse recovered storage amount");
  
    console.log(`🗑️ Deleting photo, freeing ${match[1]} ${match[2]}`);  
  } catch (error) {
    console.log(text);
  }

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Move to trash" }).click();

  await page.waitForSelector("text=Moved to trash", { timeout: 5000 });
}

// Function to delete photo with retry logic
async function deletePhoto(page: Page): Promise<void> {
  const maxRetries = 2;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Retrying deletion (attempt ${attempt}/${maxRetries})...`);
        await page.waitForTimeout(1000); // Wait a bit before retry
      }
      
      await page.getByRole("button", { name: "Move to trash" }).click();
      await confirmMoveToTrash(page);
      
      // If we get here, deletion succeeded
      return;
    } catch (error) {
      lastError = error as Error;
      console.log(`Deletion attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        // Wait a bit and try to refresh the page state
        await page.waitForTimeout(1000);
        // Try to close any open dialogs or modals
        try {
          const closeButton = page.getByRole("button", { name: /close|cancel/i });
          if (await closeButton.isVisible().catch(() => false)) {
            await closeButton.click();
            await page.waitForTimeout(500);
          }
        } catch (e) {
          // Ignore errors when trying to close dialogs
        }
      }
    }
  }
  
  // If all retries failed, throw the last error
  throw lastError || new Error("Deletion failed after all retries");
}

// Function to log photo info to photolog.json (line by line, not valid JSON)
async function logPhotoInfo(photoInfo: PhotoInfo): Promise<void> {
  const logLine = JSON.stringify(photoInfo) + '\n';
  await writeFile(__dirname + '/photolog.json', logLine, { flag: 'a' });
}

// Function to restore state from photolog.json
async function restoreState(page: Page): Promise<PhotoInfo | null> {
  try {
    const logContent = await readFile(__dirname + '/photolog.json', 'utf8');
    const lines = logContent.trim().split('\n').filter(line => line.trim());
    
    let lastNonDeletedPhoto: PhotoInfo | null = null;
    
    // Find last photo that is not deleted
    for (const line of lines) {
      try {
        const photoInfo: PhotoInfo = JSON.parse(line);
        if (!photoInfo.deleted && photoInfo.id) {
          lastNonDeletedPhoto = photoInfo;
        }
      } catch (error) {
        console.error('Error parsing log line:', error, line);
      }
    }
    /*// override
    lastNonDeletedPhoto = {
        id: "AF1QipMlTkxrExt8j19ZtiFV74T5pxxiNx1dbFN9ZyI-",
        filename: "PXL_20251219_124221767.jpg",
        free: true,
        notTakingSpace: true,
        fileSize: null,
        downloaded: false,
        deleted: false
    };*/
    
    if (lastNonDeletedPhoto && lastNonDeletedPhoto.id) {
      console.log('Restoring state to last non-deleted photo:', lastNonDeletedPhoto.id);
      await page.goto(`https://photos.google.com/photo/${lastNonDeletedPhoto.id}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(1000);
      return lastNonDeletedPhoto;
    }
    
    console.log('No non-deleted photo found in log');
    return null;
  } catch (error) {
    console.log('No photolog.json found or error reading it:', error);
    return null;
  }
}

// Loop through photos
// After restoring, set previousPhotoInfo to null so we process the restored photo
let previousPhotoInfo: PhotoInfo | null = null;
let currentPhotoInfo: PhotoInfo | null = null;

while (true) {
  currentPhotoInfo = await extractPhotoInfo(page);
  console.log('Current photo info:', currentPhotoInfo);

  // If filename hasn't changed from previous photo, retry up to 2 more times
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

  // Initialize flags
  currentPhotoInfo.downloaded = false;
  currentPhotoInfo.deleted = false;

  // If photo is free, navigate to next photo with right arrow key
  if (currentPhotoInfo.free) {
    console.log('Photo is free, navigating to next photo...');
    await logPhotoInfo(currentPhotoInfo);
    await page.keyboard.press('ArrowRight');
    // Wait a bit for the next photo to load
    await page.waitForTimeout(500);
  } else {
    // Photo is not free, download and delete it
    console.log('Photo is not free, downloading and deleting...');
    try {
      await downloadPhoto(page);
      currentPhotoInfo.downloaded = true;
      console.log('Photo downloaded successfully');
      
      await deletePhoto(page);
      currentPhotoInfo.deleted = true;
      console.log('Photo deleted successfully');
    } catch (error) {
      console.error('Error processing photo:', error);
    }
    
    // Log the photo info
    await logPhotoInfo(currentPhotoInfo);
    
    // Only navigate to next photo if deletion failed (trashing automatically moves cursor)
    if (!currentPhotoInfo.deleted) {
      console.log('Navigating to next photo...');
      await page.keyboard.press('ArrowRight');
      // Wait a bit for the next photo to load
      await page.waitForTimeout(500);
    } else {
      // Wait a bit for the auto-navigation after trashing to complete
      console.log('Waiting for auto-navigation after trashing to complete...');
      await page.waitForTimeout(500);
      /*await page.keyboard.press('ArrowLeft');
      console.log('Navigated to previous photo for stability...');
      await page.waitForTimeout(500);*/
    }
  }

  // Update previous photo info for next iteration
  previousPhotoInfo = currentPhotoInfo;
}
