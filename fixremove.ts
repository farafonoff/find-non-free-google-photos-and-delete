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

await page.goto('https://photos.google.com');

// Type for photo information (same as index.ts)
type PhotoInfo = {
  id: string | null;
  filename: string | null;
  free: boolean; // true if photo doesn't have file size
  notTakingSpace: boolean; // true if photo has "doesn't take up space" message
  fileSize: string | null; // file size if available (e.g., "443.6 KB")
  downloaded?: boolean;
  deleted?: boolean;
};

// Function to confirm move to trash (same as index.ts)
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

// Function to delete photo with retry logic (same as index.ts)
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

// Function to update photolog.json - mark photo as deleted
async function updatePhotoLog(photoId: string, deleted: boolean): Promise<void> {
  try {
    const logContent = await readFile(__dirname + '/photolog.json', 'utf8');
    const lines = logContent.trim().split('\n').filter(line => line.trim());
    
    const updatedLines = lines.map(line => {
      try {
        const photoInfo: PhotoInfo = JSON.parse(line);
        if (photoInfo.id === photoId) {
          photoInfo.deleted = deleted;
          return JSON.stringify(photoInfo);
        }
        return line;
      } catch (error) {
        return line; // Keep original line if parsing fails
      }
    });
    
    await writeFile(__dirname + '/photolog.json', updatedLines.join('\n') + '\n', 'utf8');
  } catch (error) {
    console.error('Error updating photolog.json:', error);
  }
}

// Function to read photolog.json and find downloaded but not deleted photos
async function findDownloadedButNotDeleted(): Promise<PhotoInfo[]> {
  try {
    const logContent = await readFile(__dirname + '/photolog.json', 'utf8');
    const lines = logContent.trim().split('\n').filter(line => line.trim());
    
    const photosToDelete: PhotoInfo[] = [];
    
    for (const line of lines) {
      try {
        const photoInfo: PhotoInfo = JSON.parse(line);
        // Find photos that are downloaded but not deleted
        if (photoInfo.downloaded === true && photoInfo.deleted !== true && photoInfo.id) {
          photosToDelete.push(photoInfo);
        }
      } catch (error) {
        console.error('Error parsing log line:', error, line);
      }
    }
    
    return photosToDelete;
  } catch (error) {
    console.log('Error reading photolog.json:', error);
    return [];
  }
}

// Main execution
console.log('Scanning photolog.json for downloaded but not deleted photos...');
const photosToDelete = await findDownloadedButNotDeleted();

console.log(`Found ${photosToDelete.length} photos to delete:`);
photosToDelete.forEach(photo => {
  console.log(`  - ${photo.filename} (ID: ${photo.id})`);
});

if (photosToDelete.length === 0) {
  console.log('No photos to delete. Exiting.');
  process.exit(0);
}

// Process each photo
for (const photoInfo of photosToDelete) {
  if (!photoInfo.id) {
    console.log(`Skipping photo without ID: ${photoInfo.filename}`);
    continue;
  }
  
  console.log(`\nProcessing: ${photoInfo.filename} (ID: ${photoInfo.id})`);
  
  try {
    // Navigate to the photo
    await page.goto(`https://photos.google.com/photo/${photoInfo.id}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1000);
    
    // Try to delete the photo
    await deletePhoto(page);
    console.log(`✅ Successfully deleted: ${photoInfo.filename}`);
    
    // Update photolog.json to mark as deleted
    await updatePhotoLog(photoInfo.id, true);
    
    // Wait a bit before processing next photo
    await page.waitForTimeout(500);
  } catch (error) {
    console.error(`❌ Error deleting ${photoInfo.filename}:`, error);
    // Update photolog.json to mark as not deleted (explicitly set to false)
    await updatePhotoLog(photoInfo.id, false);
    // Continue with next photo even if this one fails
  }
}

console.log('\n✅ Finished processing all photos.');
