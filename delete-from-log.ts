/**
 * Script 2: Read non-free-photos.log and delete each photo from Google Photos.
 * Run with Chrome already open and remote debugging (e.g. run.sh).
 * Updates the log to set deleted: true for each successfully deleted entry.
 */
import { chromium, Page } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, 'non-free-photos.log');

const browser = await chromium.connectOverCDP('http://localhost:9223');
const context = browser.contexts()[0];
const page = context.pages()[0] || await context.newPage();

await page.goto('https://photos.google.com');

type LogEntry = {
  id: string | null;
  filename: string | null;
  free?: boolean;
  notTakingSpace?: boolean;
  fileSize?: string | null;
  downloaded?: boolean;
  deleted?: boolean;
};

async function confirmMoveToTrash(page: Page): Promise<void> {
  const modalText = page.locator('text=Remove from your Google Account');
  await modalText.waitFor({ state: 'visible' });
  const text = await modalText.innerText();
  try {
    const match = text.match(/recover\s+([\d.]+)\s*(KB|MB|GB)/i);
    if (match) console.log(`🗑️ Deleting, freeing ${match[1]} ${match[2]}`);
  } catch {
    console.log(text);
  }
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Move to trash' }).click();
  await page.waitForSelector('text=Moved to trash', { timeout: 5000 });
}

async function deletePhoto(page: Page): Promise<void> {
  const maxRetries = 2;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`Retry ${attempt}/${maxRetries}...`);
        await page.waitForTimeout(1000);
      }
      await page.getByRole('button', { name: 'Move to trash' }).click();
      await confirmMoveToTrash(page);
      return;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        await page.waitForTimeout(1000);
        const closeBtn = page.getByRole('button', { name: /close|cancel/i });
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click();
          await page.waitForTimeout(500);
        }
      }
    }
  }
  throw lastError || new Error('Deletion failed');
}

async function readLog(): Promise<LogEntry[]> {
  const content = await readFile(LOG_FILE, 'utf8');
  const lines = content.trim().split('\n').filter((l) => l.trim());
  const entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as LogEntry);
    } catch (e) {
      console.error('Parse error:', line, e);
    }
  }
  return entries;
}

async function writeLog(entries: LogEntry[]): Promise<void> {
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(LOG_FILE, content, 'utf8');
}

const entries = await readLog();
const toDelete = entries.filter((e) => e.id && e.deleted !== true && e.downloaded === true);

console.log(`Log has ${entries.length} entries; ${toDelete.length} non-free (downloaded) not yet deleted.`);
if (toDelete.length === 0) {
  console.log('Nothing to delete.');
  process.exit(0);
}

for (let i = 0; i < entries.length; i++) {
  const entry = entries[i];
  if (!entry.id || entry.deleted === true || entry.downloaded !== true) continue;

  console.log(`\n[${i + 1}/${entries.length}] ${entry.filename} (${entry.id})`);
  try {
    await page.goto(`https://photos.google.com/photo/${entry.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await deletePhoto(page);
    entries[i] = { ...entry, deleted: true };
    await writeLog(entries);
    console.log('✅ Deleted');
  } catch (err) {
    console.error('❌', err);
  }
  await page.waitForTimeout(500);
}

console.log('\n✅ Done.');
