# FUT.GG Player ID Extractor

A Chromium browser extension that turns a FUT.GG club gallery into a usable list of EA player IDs. It also helps transfer those IDs into FC Enhancer/FUT Enhancer and synchronize sell prices with the visible buy prices in its price table.

**Created by [Crushoverride007](https://github.com/Crushoverride007)**

> `khdam 3la wladk awled l9af`

## What it does

- Finds a FUT.GG gallery by team name instead of requiring a full URL.
- Extracts the players shown on the selected team gallery page.
- Uses the current EA/FC item ID from FUT.GG when a player URL contains both a base-player ID and a current item ID.
- Displays each player name and ID.
- Produces a comma-separated ID list for quick copying.
- Copies the complete ID list directly to the clipboard.
- Applies the IDs to the open FC Enhancer/FUT Enhancer **Buy players** field.
- Finds the visible FUT Enhancer price table.
- Copies each positive **Price** value into the matching **Sell price** field.
- Shows gallery grades and available summary information when FUT.GG exposes it.

## Where it works

The extension is designed for Chromium-based browsers, including:

- Google Chrome
- Brave
- Microsoft Edge
- Chromium-based browsers that support Manifest V3

It uses these sites:

- `fut.gg` for team galleries and player IDs
- `ea.com` / the EA SPORTS FC Web App for FC Enhancer/FUT Enhancer integration

The FC Enhancer/FUT Enhancer integration requires the relevant Buy players modal or price table to already be open in the EA FC Web App.

## Installation

### Install from source

1. Download or clone this repository.
2. Open the extensions page in your browser:
   - Chrome/Brave: `chrome://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder containing `manifest.json`.
6. Pin the extension if desired.

The ZIP archive is useful for distribution, but **Load unpacked** requires the extracted project folder.

## How to use it

### Extract a team

1. Open the extension popup.
2. Enter a team name, for example:

   ```text
   Frosinone
   ```

3. Click **Extract Players**.
4. If multiple teams match, choose the correct team.
5. Review the player names, IDs, grades, and gallery metrics.

The extension displays a comma-separated list similar to:

```text
239701, 228336, 70163, 74533, 74536
```

### Copy the IDs

Click **Copy IDs to Clipboard**. The complete comma-separated list is copied without manually selecting the text.

### Apply IDs to FC Enhancer/FUT Enhancer

1. Open the EA SPORTS FC Web App.
2. Open FC Enhancer/FUT Enhancer's **Buy players** modal.
3. Extract the team in this extension.
4. Click **Apply to FUT Enhancer**.
5. Review the inserted IDs in the player field.
6. Click **Continue** manually.

The extension does not click **Continue**, submit a purchase, or buy players automatically.

### Synchronize sell prices

1. Open the FC Enhancer/FUT Enhancer price table.
2. Make sure the table shows the **Price**, **Buy Prices**, and **Sell price** columns.
3. Click **Sync Sell Prices to Buy Prices**.
4. Review the updated values before submitting.

The extension maps the visible fields by row:

```text
Price: 650  ->  Sell price: 650
Price: 950  ->  Sell price: 950
Price: 450  ->  Sell price: 450
```

The extension scans the table viewport-by-viewport, including rows loaded by a virtualized scroll list, and traverses every available table page before restoring the original page and scroll position. It pairs visible fields by their actual row structure, re-queries rows after React re-renders, dispatches input/change events, and retries until each value is verified. Empty and zero-price rows are skipped. The extension does not submit listings automatically.

## Button order

1. **Extract Players**
2. **Copy IDs to Clipboard**
3. **Apply to FUT Enhancer**
4. **Sync Sell Prices to Buy Prices**

## Updating the extension

After installing a newer version:

1. Replace the old project folder with the new files.
2. Open the extensions page.
3. Click **Reload** on the extension.
4. Refresh the EA FC Web App so the updated content script is loaded.

## Permissions

The extension requests permissions for:

- Clipboard writing, to copy player IDs.
- Reading browser tabs, to locate the EA FC Web App.
- Script injection, to communicate with the visible FUT Enhancer fields.
- FUT.GG and EA/EA SPORTS FC page access.

No login credentials, API keys, or account passwords are collected by this project.

## Limitations

- FUT.GG page structure changes may require selector updates.
- FC Enhancer/FUT Enhancer must be open on the EA FC Web App for integration features to work.
- The extension cannot access a closed extension popup; it works with the fields rendered in the web page.
- The extension only updates visible fields and leaves final actions for the user to review.
- Team search depends on FUT.GG's publicly available gallery pages.

## Development

This is a plain Manifest V3 extension and does not require a build system or package manager. The main files are:

```text
manifest.json  Extension metadata and permissions
popup.html     Popup interface
popup.js       Team search, extraction, rendering, and actions
content.js     EA Web App field integration
```

Basic syntax checks:

```bash
python3 -m json.tool manifest.json
node --check popup.js
node --check content.js
```

## Disclaimer

This is an independent community tool and is not affiliated with EA, EA SPORTS, FUT.GG, or FC Enhancer/FUT Enhancer. Use it only with accounts and workflows you are authorized to use, and review all values before taking an action in the EA SPORTS FC Web App.
