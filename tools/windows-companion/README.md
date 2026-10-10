# EVENTRA Windows Browser Companion (Option A)

This is the locally running Windows companion for **EVENTRA Option A: Windows-Visible Local Browser Agent**.

When you trigger a venue or vendor discovery run in EVENTRA, this companion launches a **real, visible Microsoft Edge or Chromium window** directly on your Windows desktop and controls it via Playwright.

---

## Prerequisites
- Windows 10/11
- Node.js (v18 or higher) — already installed on your system
- Microsoft Edge (pre-installed on Windows) or Google Chrome

---

## Quick Start (PowerShell)

1. Generate a pairing code in EVENTRA (e.g., click **Pair Desktop Companion** or **Browser Autonomous Agent** on your event page).
2. Open Windows PowerShell:

```powershell
cd tools\windows-companion
.\run-companion.ps1 -Code "YOUR_6_CHAR_CODE"
```

The companion will:
- Authenticate with the EVENTRA API backend.
- Connect to the secure outbound WebSocket hub.
- Report status as **Connected**.

---

## What Happens When You Launch Browser Agent
1. An actual Chrome or Edge window appears on your desktop.
2. You can visibly watch it navigate to Google Maps and Google Search.
3. It opens real tabs for vendor websites, extracts details and contact info, and streams progress live back to the EVENTRA dashboard.
4. When finished or cancelled, it closes tabs and reports the verified candidates.
