/**
 * EVENTRA Windows Browser Companion (Option A)
 * 
 * Runs locally on the operator's Windows desktop.
 * Launches a genuine, visible Chromium or Edge browser window via Playwright.
 * Connects securely to the EVENTRA API backend via outbound authenticated WebSocket.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Configuration defaults
const DEFAULT_API_BASE = process.env.EVENTRA_API_URL || "http://localhost:8000/api";
const DEFAULT_WS_BASE = process.env.EVENTRA_WS_URL || "ws://localhost:8000/api/browser-companion/ws";
const SESSION_FILE = path.resolve(process.cwd(), ".companion_session.json");

// CLI arguments parsing
const args = process.argv.slice(2);
let pairingCode = null;
let apiBaseUrl = DEFAULT_API_BASE;
let wsBaseUrl = DEFAULT_WS_BASE;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--code" || args[i] === "-c") {
    pairingCode = args[i + 1]?.toUpperCase();
    i++;
  } else if (args[i] === "--api") {
    apiBaseUrl = args[i + 1];
    i++;
  } else if (args[i] === "--ws") {
    wsBaseUrl = args[i + 1];
    i++;
  }
}

// Global Browser State
let browser = null;
let browserContext = null;
let mainPage = null;
let currentExecutionId = null;
let isCancelled = false;
let ws = null;

// Color helpers for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

function log(prefix, msg, color = colors.cyan) {
  const ts = new Date().toLocaleTimeString();
  console.log(`${color}[${ts}] [${prefix}]${colors.reset} ${msg}`);
}

/**
 * 1. Authenticate / Pair with EVENTRA API
 */
async function getAuthToken() {
  // If pairing code provided via CLI, exchange it immediately
  if (pairingCode) {
    log("PAIRING", `Exchanging pairing code '${pairingCode}' with EVENTRA API...`, colors.yellow);
    try {
      const resp = await fetch(`${apiBaseUrl}/browser-companion/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairing_code: pairingCode,
          device_name: `Windows Desktop (${process.env.COMPUTERNAME || "PC"})`,
          companion_version: "1.0.0",
          browser_type: "msedge_or_chromium",
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || `HTTP ${resp.status} ${resp.statusText}`);
      }

      const pairData = await resp.json();
      log("PAIRING", `Pairing successful! Token granted for user: ${pairData.user_id}`, colors.green);
      fs.writeFileSync(SESSION_FILE, JSON.stringify(pairData, null, 2), "utf8");
      return pairData.token;
    } catch (err) {
      log("ERROR", `Pairing failed: ${err.message}`, colors.red);
      process.exit(1);
    }
  }

  // Otherwise check saved session file
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      if (saved.token && new Date(saved.expires_at) > new Date()) {
        log("AUTH", `Loaded saved companion token for user: ${saved.user_id}`, colors.green);
        return saved.token;
      }
    } catch {}
  }

  log("ERROR", "No pairing code provided and no active session found.", colors.red);
  console.log(`\n${colors.yellow}Usage:${colors.reset} node companion.mjs --code <PAIRING_CODE>`);
  console.log(`Or generate a code in the EVENTRA dashboard and run: .\\run-companion.ps1 -Code <CODE>\n`);
  process.exit(1);
}

/**
 * 2. Ensure visible browser window is open
 */
async function ensureBrowser() {
  if (browser && mainPage && !mainPage.isClosed()) {
    return { browser, browserContext, mainPage };
  }

  log("BROWSER", "Launching genuine visible browser window on Windows desktop...", colors.magenta);

  const launchOptions = {
    headless: false,
    args: [
      "--start-maximized",
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  };

  // Try launching system Microsoft Edge first (pre-installed on Windows), then Chromium
  try {
    browser = await chromium.launch({ ...launchOptions, channel: "msedge" });
    log("BROWSER", "Launched Microsoft Edge (Chromium) in visible window.", colors.green);
  } catch (edgeErr) {
    log("BROWSER", "System Edge launch failed, falling back to Playwright Chromium...", colors.yellow);
    browser = await chromium.launch(launchOptions);
    log("BROWSER", "Launched Playwright Chromium in visible window.", colors.green);
  }

  browserContext = await browser.newContext({
    viewport: null, // Let window fill screen or use natural maximized dimensions
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  });

  mainPage = await browserContext.newPage();
  await mainPage.bringToFront();

  // Watch for manual user close
  mainPage.on("close", () => {
    log("BROWSER", "Browser window was closed by operator.", colors.yellow);
    mainPage = null;
  });

  return { browser, browserContext, mainPage };
}

/**
 * 3. Send progress event to EVENTRA backend
 */
function sendEvent(eventType, message, data = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg = {
    type: "EVENT",
    execution_id: currentExecutionId,
    event_type: eventType,
    message,
    data,
    timestamp: new Date().toISOString(),
  };
  ws.send(JSON.stringify(msg));
  log("EVENT", `${eventType}: ${message}`, colors.cyan);
}

/**
 * 4. Execute Real Google Maps Search & Discovery
 */
async function executeDiscovery(payload, correlationId) {
  const { query, max_results = 5, category = "VENUE", city = "San Francisco" } = payload;
  isCancelled = false;
  const results = [];

  log("DISCOVERY", `Starting real browser discovery: query='${query}', max=${max_results}`, colors.bold);

  const { mainPage: page } = await ensureBrowser();

  try {
    sendEvent("page_opened", `Opening Google Maps for query: '${query}'`, { url: "https://www.google.com/maps" });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2500);

    // Dismiss Google consent popup if visible
    try {
      const consentBtn = await page.$('button[aria-label*="Accept all"], button:has-text("Accept all"), form:has-text("Accept all") button');
      if (consentBtn) {
        await consentBtn.click();
        await page.waitForTimeout(1500);
      }
    } catch {}

    sendEvent("search_started", `Google Maps search results loaded for '${query}'`, {
      url: page.url(),
      title: await page.title(),
    });

    // Locate listing items in Google Maps feed
    await page.waitForSelector('div[role="feed"], div[role="article"], a[href*="/maps/place/"]', { timeout: 15000 }).catch(() => {});

    // Collect candidate listing links
    const placeLinks = await page.$$eval('a[href*="/maps/place/"]', (links) => {
      const unique = [];
      const seen = new Set();
      for (const a of links) {
        const text = a.ariaLabel || a.innerText || "";
        const href = a.href;
        if (text && !seen.has(href)) {
          seen.add(href);
          unique.push({ name: text.split("\n")[0].trim(), href });
        }
      }
      return unique;
    }).catch(() => []);

    log("DISCOVERY", `Found ${placeLinks.length} listings in search results.`, colors.green);

    const itemsToInspect = placeLinks.slice(0, max_results);

    for (let i = 0; i < itemsToInspect.length; i++) {
      if (isCancelled) {
        log("CANCEL", "Discovery loop cancelled by user request.", colors.yellow);
        break;
      }

      const item = itemsToInspect[i];
      log("INSPECT", `[${i + 1}/${itemsToInspect.length}] Inspecting listing: '${item.name}'...`, colors.cyan);

      try {
        // Navigate or click to open listing details
        await page.goto(item.href, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1800);

        // Extract listing attributes from Google Maps place card
        const details = await page.evaluate(() => {
          const nameEl = document.querySelector('h1.DUwDvf, h1');
          const name = nameEl ? nameEl.innerText.trim() : "";

          // Rating and reviews
          const ratingEl = document.querySelector('span.ceNzKf, div.F7nice span[aria-hidden="true"]');
          const ratingText = ratingEl ? ratingEl.innerText.replace(",", ".").trim() : null;
          const rating = ratingText && !isNaN(parseFloat(ratingText)) ? parseFloat(ratingText) : null;

          const reviewsEl = document.querySelector('span[aria-label*="reviews"], div.F7nice span:last-child');
          const reviewCount = reviewsEl ? parseInt(reviewsEl.innerText.replace(/\D/g, "")) || null : null;

          // Address, Phone, Website
          let address = null;
          let phone = null;
          let website = null;

          const buttons = document.querySelectorAll('button[data-item-id*="address"], button[aria-label*="Address"]');
          if (buttons.length > 0) address = buttons[0].innerText.replace(/^Address:\s*/i, "").trim();

          const phoneBtn = document.querySelectorAll('button[data-item-id*="phone"], button[aria-label*="Phone"]');
          if (phoneBtn.length > 0) phone = phoneBtn[0].innerText.replace(/^Phone:\s*/i, "").trim();

          const webBtn = document.querySelectorAll('a[data-item-id*="authority"], a[aria-label*="Website"]');
          if (webBtn.length > 0) website = webBtn[0].href;

          return { name, rating, reviewCount, address, phone, website };
        });

        const candidateName = details.name || item.name;
        const candidateData = {
          name: candidateName,
          category: category,
          raw_category: category,
          address: details.address || `${city}`,
          city: city,
          phone: details.phone,
          website: details.website,
          maps_url: page.url(),
          rating: details.rating,
          review_count: details.reviewCount,
          source: "WINDOWS_BROWSER_COMPANION",
        };

        results.push(candidateData);

        sendEvent("candidate_found", `Discovered candidate on Google Maps: '${candidateName}'`, candidateData);

        // If candidate has an official website, open it in a real tab to visually verify it!
        if (details.website && !isCancelled) {
          try {
            log("TAB", `Opening candidate website in new tab: ${details.website}`, colors.magenta);
            const websitePage = await browserContext.newPage();
            sendEvent("page_opened", `Inspecting candidate website in active tab: ${details.website}`, { url: details.website });
            await websitePage.goto(details.website, { waitUntil: "domcontentloaded", timeout: 15000 });
            await websitePage.bringToFront();
            await websitePage.waitForTimeout(2000); // Allow user to see the website visibly!
            await websitePage.close();
            await page.bringToFront();
          } catch (webErr) {
            log("TAB", `Could not load website ${details.website}: ${webErr.message}`, colors.yellow);
          }
        }
      } catch (itemErr) {
        log("ERROR", `Failed to inspect listing ${item.name}: ${itemErr.message}`, colors.yellow);
      }
    }

    log("DISCOVERY", `Completed discovery. Extracted ${results.length} valid candidates.`, colors.green);

    return {
      type: "RESULT",
      correlation_id: correlationId,
      execution_id: currentExecutionId,
      success: true,
      results,
      metadata: {
        current_url: page.url(),
        current_title: await page.title(),
        total_extracted: results.length,
      },
    };
  } catch (err) {
    log("ERROR", `Discovery workflow error: ${err.message}`, colors.red);
    return {
      type: "RESULT",
      correlation_id: correlationId,
      execution_id: currentExecutionId,
      success: false,
      error: err.message,
      results,
    };
  }
}

/**
 * 5. Handle Inbound Commands from EVENTRA Backend
 */
async function handleCommand(msg) {
  const { command, correlation_id, execution_id, payload } = msg;
  currentExecutionId = execution_id;

  log("COMMAND", `Received ${command} (cid=${correlation_id})`, colors.bold);

  if (command === "START_DISCOVERY") {
    const result = await executeDiscovery(payload, correlation_id);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(result));
    }
    return;
  }

  if (command === "CANCEL") {
    isCancelled = true;
    log("CANCEL", "Cancellation requested from backend.", colors.yellow);
    sendEvent("cancelled", "Execution cancelled by operator.");
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "RESULT",
        correlation_id,
        execution_id,
        success: true,
        results: [],
        metadata: { cancelled: true },
      }));
    }
    return;
  }

  if (command === "NAVIGATE") {
    const { mainPage: page } = await ensureBrowser();
    const url = payload.url || "https://www.google.com";
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "RESULT",
        correlation_id,
        execution_id,
        success: true,
        results: [],
        metadata: { current_url: page.url(), current_title: await page.title() },
      }));
    }
    return;
  }

  if (command === "STOP_SESSION") {
    if (browser) {
      await browser.close();
      browser = null;
      mainPage = null;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "RESULT",
        correlation_id,
        execution_id,
        success: true,
      }));
    }
    return;
  }

  // Fallback for unhandled command
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "RESULT",
      correlation_id,
      execution_id,
      success: false,
      error: `Unsupported command: ${command}`,
    }));
  }
}

/**
 * 6. Main WebSocket Connection Loop
 */
async function startCompanion() {
  const token = await getAuthToken();
  const wsUrl = `${wsBaseUrl}?token=${encodeURIComponent(token)}`;

  log("CONNECT", `Connecting to EVENTRA WebSocket hub at ${wsUrl}...`, colors.cyan);

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    log("CONNECTED", `Successfully connected to EVENTRA backend! Ready for browser tasks.`, colors.green);
    console.log(`\n${colors.bold}${colors.green}● Windows Browser Companion is ACTIVE${colors.reset}`);
    console.log(`  Visible Chromium/Edge will open automatically when you launch a browser task in EVENTRA.\n`);
  };

  ws.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "COMMAND") {
        await handleCommand(msg);
      }
    } catch (e) {
      log("ERROR", `Error handling inbound message: ${e.message}`, colors.red);
    }
  };

  ws.onclose = (event) => {
    log("DISCONNECTED", `WebSocket connection closed (code: ${event.code}). Reconnecting in 5s...`, colors.yellow);
    ws = null;
    setTimeout(startCompanion, 5000);
  };

  ws.onerror = (err) => {
    log("ERROR", `WebSocket connection error: ${err.message}`, colors.red);
  };

  // Heartbeat ping every 15 seconds
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "PONG" }));
    }
  }, 15000);
}

// Clean shutdown on Ctrl+C
process.on("SIGINT", async () => {
  log("SHUTDOWN", "Shutting down companion...", colors.yellow);
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(0);
});

// Start the companion
startCompanion();
