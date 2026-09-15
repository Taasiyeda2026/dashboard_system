# Taasiyeda Proposal PDF extension

Internal Chrome / Microsoft Edge extension for the Taasiyeda dashboard.

## What it does

When the extension is installed, the dashboard's **הדפסה / PDF** action can ask Chromium to create the proposal with the browser's own Print-to-PDF engine. The dashboard then uploads that exact PDF through its existing authenticated Supabase API and opens the same file for the user.

The extension does **not** contain Supabase credentials and does not upload files itself. It is only the bridge to Chromium's `Page.printToPDF` command.

## Scope and permissions

- Manifest V3.
- `debugger` permission is required for Chromium `Page.printToPDF`.
- Runs only on `https://taasiyeda2026.github.io/dashboard_system/*`.
- No access is requested for other websites.

Chrome/Edge will show a debugger permission warning because the extension temporarily attaches to the active dashboard tab while creating the PDF. It detaches immediately after the PDF bytes are returned.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension/proposal-pdf` folder.
5. Open/reload the Taasiyeda dashboard.

## Install in Microsoft Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension/proposal-pdf` folder.
5. Open/reload the Taasiyeda dashboard.

## Expected proposal flow

1. Open a proposal preview.
2. Click **הדפסה / PDF**.
3. The dashboard activates its existing print-only layout.
4. The extension asks Chromium for an A4 PDF with backgrounds and CSS page sizing enabled.
5. The returned file is verified to start with `%PDF-`.
6. The dashboard uploads the file to the existing proposal PDF storage flow.
7. Only after storage succeeds, the same generated file is opened for the user.

If the extension is not installed, the existing browser print dialog remains available as the fallback and nothing is automatically uploaded by this extension path.
