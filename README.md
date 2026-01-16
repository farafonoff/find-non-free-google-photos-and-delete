# Google Photos Playwright Automation

This project connects to an existing Chrome browser instance via CDP (Chrome DevTools Protocol) and automates Google Photos.

## Prerequisites

1. Start Chrome with remote debugging enabled:
   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   ```

   Or on Linux:
   ```bash
   google-chrome --remote-debugging-port=9222
   ```

## Setup

```bash
npm install
```

## Usage

Run the script:
```bash
npm run dev
```

Or build and run:
```bash
npm run build
npm start
```

## Available Scripts

- **`npm run dev`** - Run the main automation script in development mode using tsx
- **`npm start`** - Run the compiled JavaScript directly
- **`npm run restart`** - Continuously restart the script with 2-second delays if it fails
- **`npm run fixremove`** - Execute the fixremove script for cleanup operations
- **`npm run scandates`** - Scan and fix photo dates (runs fixdates.ts)
- **`npm run verifydates`** - Verify that photo dates are correct
- **`npm run fillindates`** - Fill in missing or incomplete photo dates
- **`npm run build`** - Compile TypeScript to JavaScript
- **`npm run type-check`** - Check TypeScript types without emitting files

## Notes

- Make sure Chrome is running with `--remote-debugging-port=9222` before running the script

## TODO

- **2-Phase Solution**: Implement a better approach with two phases:
  1. **Phase 1**: Log all possible metadata for photos while navigating right/left through the gallery
  2. **Phase 2**: Process photos by ID using the collected metadata
- The script connects to an existing browser context and navigates to Google Photos
