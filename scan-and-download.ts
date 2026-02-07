/**
 * Script 1: Scan all photos (ArrowRight), download non-free photos, write log.
 * Run with Chrome already open on Google Photos and remote debugging (e.g. run.sh).
 * Log: non-free-photos.log (one JSON object per line; free and non-free for checkpoint).
 *
 * Optional: start from a specific photo id (restart checkpoint or manual start).
 *   START_ID=AF1Qip... npm run scan
 *   npm run scan -- AF1Qip...
 */
import { chromium, Page } from 'playwright';
import { expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { exit } from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, 'non-free-photos.log');
const DOWNLOAD_DIR = path.join(__dirname, 'google-photos-downloads');

const START_ID = process.env.START_ID || process.argv[2] || null;
if (START_ID) console.log('Starting from photo id:', START_ID);

const browser = await chromium.connectOverCDP('http://localhost:9223');
const context = browser.contexts()[0];
const page = context.pages()[0] || await context.newPage();

await mkdir(DOWNLOAD_DIR, { recursive: true });
const client = await context.newCDPSession(page);
await client.send('Page.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DOWNLOAD_DIR,
});
console.log('Downloads to:', DOWNLOAD_DIR);

await page.goto('https://photos.google.com');

export type PhotoInfo = {
  id: string | null;
  filename: string | null;
  free: boolean;
  notTakingSpace: boolean;
  fileSize: string | null;
  dateTaken: string | null;
  dimensions: string | null;
  downloaded?: boolean;
};

/** True if we consider prev and current to be the same photo (navigation did not change). */
function samePhoto(prev: PhotoInfo, curr: PhotoInfo): boolean {
  if (prev.id != null && curr.id != null && prev.id === curr.id) return true;
  const fp = (a: PhotoInfo) =>
    [a.filename ?? '', a.fileSize ?? '', a.dateTaken ?? '', a.dimensions ?? ''].join('|');
  return fp(prev) === fp(curr);
}

async function extractPhotoInfo(page: Page): Promise<PhotoInfo> {
  await page.waitForTimeout(500);

  const url = page.url();
  const urlMatch = url.match(/\/photo\/([A-Za-z0-9_-]+)/);
  const id = urlMatch ? urlMatch[1] : null;

  const infoHeading = page.getByRole('heading', { name: 'Info' });
  const infoPanel = page.locator('div.YW656b').filter({ has: infoHeading });

  let isPanelVisible = false;
  for (let i = 0; i < 5; i++) {
    isPanelVisible = await infoPanel.isVisible().catch(() => false);
    if (isPanelVisible) break;
    await page.waitForTimeout(500);
  }

  if (!isPanelVisible) {
    const openInfoButton = page.getByRole('button', { name: 'Open info' });
    await openInfoButton.waitFor({ state: 'visible', timeout: 5000 });
    await openInfoButton.click();
    await page.waitForTimeout(300);
    const panelVisibleAfterFirstClick = await infoPanel.isVisible().catch(() => false);
    if (!panelVisibleAfterFirstClick) {
      await openInfoButton.click();
      await page.waitForTimeout(300);
    }
    await infoPanel.waitFor({ state: 'visible', timeout: 5000 });
  }

  await expect(infoPanel).toBeVisible();

  const storageSpan = infoPanel.locator('span').filter({
    hasText: "This item doesn't take up space in your account storage.",
  });
  const notTakingSpace = await storageSpan.isVisible().catch(() => false);

  const filenameDiv = infoPanel.locator('div.R9U8ab[aria-label^="Filename: "]');
  await expect(filenameDiv).toBeVisible();
  const filename = await filenameDiv.textContent();

  let fileSize: string | null = null;
  try {
    const fileSizeElement = infoPanel.locator('[aria-label^="File size:"]');
    const fileSizeExists = await fileSizeElement.isVisible().catch(() => false);
    if (fileSizeExists) {
      const ariaLabel = await fileSizeElement.getAttribute('aria-label');
      if (ariaLabel) {
        const sizeMatch = ariaLabel.match(/File size:\s*([\d.]+)\s*(KB|MB|GB|B)/i);
        if (sizeMatch) fileSize = `${sizeMatch[1]} ${sizeMatch[2]}`;
      }
    } else {
      const backedUpElement = infoPanel.locator('span').filter({
        hasText: /Backed up\s*\([\d.]+\s*(KB|MB|GB|B)\)/i,
      });
      const backedUpExists = await backedUpElement.isVisible().catch(() => false);
      if (backedUpExists) {
        const text = await backedUpElement.textContent();
        if (text) {
          const sizeMatch = text.match(/\(([\d.]+\s*(KB|MB|GB|B))\)/i);
          if (sizeMatch) fileSize = sizeMatch[1];
        }
      }
    }
  } catch {
    // ignore
  }

  let dateTaken: string | null = null;
  try {
    const dateElement = infoPanel.locator('div.R9U8ab[jsname="pG3jE"][aria-label^="Date taken:"]');
    if (await dateElement.isVisible().catch(() => false)) {
      const dateAria = await dateElement.getAttribute('aria-label');
      if (dateAria) {
        const m = dateAria.match(/Date taken:\s*(.+)/i);
        if (m) dateTaken = m[1].trim();
      }
      const timeElement = infoPanel.locator('span.sprMUb[aria-label^="Time taken:"]');
      if (await timeElement.isVisible().catch(() => false)) {
        const timeAria = await timeElement.getAttribute('aria-label');
        if (timeAria) {
          const tm = timeAria.match(/Time taken:\s*(.+)/i);
          if (tm) dateTaken = (dateTaken ?? '') + ' ' + tm[1].trim();
        }
      }
      const tzElement = infoPanel.locator('span.sprMUb[aria-label^="GMT"]');
      if (await tzElement.isVisible().catch(() => false)) {
        const tzAria = await tzElement.getAttribute('aria-label');
        if (tzAria) dateTaken = (dateTaken ?? '') + ' ' + tzAria.trim();
      }
    }
  } catch {
    // ignore
  }

  let dimensions: string | null = null;
  try {
    const dimEl = infoPanel.locator('[aria-label*="dimension" i], [aria-label*="×" i], [aria-label*=" x " i]');
    if (await dimEl.first().isVisible().catch(() => false)) {
      const label = await dimEl.first().getAttribute('aria-label');
      if (label) dimensions = label.replace(/\s+/g, ' ').trim();
    }
    if (!dimensions) {
      const sizeLike = infoPanel.locator('div.R9U8ab[aria-label*="0"]');
      for (const node of await sizeLike.all()) {
        const aria = await node.getAttribute('aria-label');
        if (aria && /^\d+\s*[×x]\s*\d+/.test(aria)) {
          dimensions = aria.trim();
          break;
        }
      }
    }
  } catch {
    // ignore
  }

  const free = fileSize === null;

  return {
    id,
    filename: filename?.trim() || null,
    free,
    notTakingSpace,
    fileSize,
    dateTaken: dateTaken || null,
    dimensions,
  };
}

async function sendShiftD(page: Page): Promise<void> {
  await page.keyboard.down('Shift');
  await page.keyboard.press('D');
  await page.keyboard.up('Shift');
}

async function downloadPhoto(page: Page): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5 * 60 * 1000 }),
    sendShiftD(page),
  ]);
  const downloadPath = await download.path();
  console.log('Downloaded to:', downloadPath);
  await page.waitForTimeout(1000);
  return downloadPath || '';
}

async function appendToLog(entry: PhotoInfo & { downloaded?: boolean }): Promise<void> {
  const line = JSON.stringify(entry) + '\n';
  await writeFile(LOG_FILE, line, { flag: 'a' });
}

async function getLastLoggedId(): Promise<string | null> {
  try {
    const content = await readFile(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter((l: string) => l.trim());
    if (lines.length === 0) return null;
    const last = JSON.parse(lines[lines.length - 1]) as PhotoInfo;
    return last?.id ?? null;
  } catch {
    return null;
  }
}

async function gotoPhotoThenNext(page: Page, photoId: string): Promise<void> {
  await page.goto(`https://photos.google.com/photo/${photoId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
}

const restored = await (async (): Promise<boolean> => {
  if (START_ID) {
    console.log('Using START_ID as starting point');
    await gotoPhotoThenNext(page, START_ID);
    return true;
  }
  const lastId = await getLastLoggedId();
  if (lastId) {
    console.log('Resuming from last logged photo:', lastId);
    await gotoPhotoThenNext(page, lastId);
    return true;
  }
  return false;
})();

if (!restored) {
  const grid = page.locator('div[jsname="ni8Knc"]');
  await grid.waitFor({ state: 'visible' });
  await expect(grid.getByRole('link', { name: /^Photo -/ }).first()).toBeVisible();
  await grid.getByRole('link', { name: /^Photo -/ }).first().click();
}

let previousPhotoInfo: PhotoInfo | null = null;

while (true) {
  let currentPhotoInfo = await extractPhotoInfo(page);
  const meta = [currentPhotoInfo.filename, currentPhotoInfo.dateTaken ?? '', currentPhotoInfo.fileSize ?? ''].filter(Boolean).join(' · ');
  console.log('Current:', meta, currentPhotoInfo.free ? '(free)' : `(${currentPhotoInfo.fileSize})`);

  if (previousPhotoInfo && samePhoto(previousPhotoInfo, currentPhotoInfo)) {
    let retryCount = 0;
    const maxRetries = 5;
    while (retryCount < maxRetries && samePhoto(previousPhotoInfo, currentPhotoInfo)) {
      retryCount++;
      if (retryCount > 1) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(5000);
      }
      console.log(`Navigation unchanged (id/metadata same), retry ${retryCount}/${maxRetries}...`);
      await page.waitForTimeout(5000);
      currentPhotoInfo = await extractPhotoInfo(page);
    }
    if (samePhoto(previousPhotoInfo, currentPhotoInfo)) {
      console.log('Stuck after retries; exit to restart. Last:', previousPhotoInfo.id ?? previousPhotoInfo.filename);
      exit(1);
    }
  }

  if (currentPhotoInfo.free) {
    await appendToLog(currentPhotoInfo);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
  } else {
    try {
      await downloadPhoto(page);
      await appendToLog({ ...currentPhotoInfo, downloaded: true });
      console.log('Logged non-free:', currentPhotoInfo.filename);
    } catch (err) {
      console.error('Download error:', err);
      await appendToLog(currentPhotoInfo);
    }
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
  }

  previousPhotoInfo = currentPhotoInfo;
}
