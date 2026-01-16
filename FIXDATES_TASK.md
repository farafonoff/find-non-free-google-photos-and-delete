# Fix Dates Task

## Overview
Created utility `fixdates.ts` to extract and log date information from Google Photos metadata and filenames.

## Implementation Details

### File: `fixdates.ts`
- Based on the rightArrow pressing code from `index.ts`
- Uses journal file `datelog.json` (instead of `photolog.json`)
- Extracts date information from photo metadata and filenames
- Logs data in ISO format

### Date Extraction

#### Metadata Date Extraction
Extracts date from photo metadata HTML:
- Looks for element with `aria-label="Date taken: ..."`
- Extracts date text (e.g., "Aug 26, 2024" or "Jan 14")
- Extracts time from `aria-label="Time taken: ..."` (e.g., "Mon, 8:38 PM" or "Today, 1:02 PM")
- Extracts timezone from `aria-label="GMT+03:00"`
- Parses and converts to ISO format

#### Filename Date Extraction
Parses filename for date/time in format `YYYYMMDD_HHMMSSsss`:
- Pattern: `(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(\d{3})`
- Example: `PXL_20260114_100210191.jpg` → `2026-01-14T10:02:10.191Z`
- Also supports format without milliseconds: `YYYYMMDD_HHMMSS`

### Log Format
Each line in `datelog.json` contains:
```json
{
  "id": "photo_id",
  "filename": "filename.jpg",
  "metadataDate": "2024-08-26T20:38:00.000Z",  // ISO format from metadata
  "filenameDate": "2026-01-14T10:02:10.191Z"   // ISO format from filename
}
```

### Features
- Restores state from `datelog.json` on startup
- Navigates through photos using ArrowRight key
- Handles retries when filename doesn't change
- Logs each photo's date information

## Usage
Run the script to process photos and extract date information:
```bash
tsx fixdates.ts
```

## Status
✅ Created `fixdates.ts` utility
✅ Implemented metadata date extraction
✅ Implemented filename date parsing
✅ Created `datelog.json` journal
✅ Created task tracking MD file
