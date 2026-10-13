/**
 * EVENTRA Windows Browser Companion (Option A)
 * 
 * Runs locally on the operator's Windows desktop.
 * Launches a genuine, visible Microsoft Edge or Chromium browser window via Playwright.
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
let tabCounter = 0;

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
 * Validates and sanitizes a destination URL for safe browsing.
 */
function validateDestination(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Target URL is required.");
  }
  const trimmed = rawUrl.trim();
  if (trimmed === "about:blank") return trimmed;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL format: '${trimmed}'`);
  }

  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new Error(`Forbidden protocol '${scheme}://'. Only HTTP and HTTPS are permitted.`);
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host === "instance-data"
  ) {
    throw new Error(`Navigation to restricted metadata host '${host}' is blocked.`);
  }

  return parsed.toString();
}

/**
 * 1. Authenticate / Pair with EVENTRA API
 */
async function getAuthToken() {
  // If pairing code provided via CLI, exchange it immediately
  if (pairingCode) {
    log("PAIRING", `Exchanging pairing code '${pairingCode}' with EVENTRA API at ${apiBaseUrl}...`, colors.yellow);
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
 * Helper to build synchronized list of tabs in the current browser context.
 */
async function getTabList(activePage = null) {
  if (!browserContext) return [];
  const pages = browserContext.pages();
  const tabs = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (p.isClosed()) continue;

    if (!p._tabId) {
      p._tabId = `tab_${++tabCounter}`;
    }

    let pageTitle = "";
    try {
      pageTitle = await p.title();
    } catch {}

    const isActive = activePage ? p === activePage : (mainPage ? p === mainPage : i === pages.length - 1);

    tabs.push({
      tab_id: p._tabId,
      url: p.url(),
      title: pageTitle || "Untitled Tab",
      is_active: isActive,
    });
  }

  return tabs;
}

/**
 * 2. Ensure visible browser window is open on Windows desktop
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

  // Launch Edge first (built into Windows), fall back to Chromium or Chrome
  try {
    browser = await chromium.launch({ ...launchOptions, channel: "msedge" });
    log("BROWSER", "Launched Microsoft Edge in visible window.", colors.green);
  } catch (edgeErr) {
    try {
      browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
      log("BROWSER", "Launched Google Chrome in visible window.", colors.green);
    } catch (chromeErr) {
      log("BROWSER", "Falling back to Playwright bundled Chromium...", colors.yellow);
      browser = await chromium.launch(launchOptions);
      log("BROWSER", "Launched Playwright Chromium in visible window.", colors.green);
    }
  }

  browserContext = await browser.newContext({
    viewport: null, // Let window fill screen naturally
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  mainPage = await browserContext.newPage();
  mainPage._tabId = `tab_${++tabCounter}`;
  await mainPage.bringToFront();

  // Handle browser or page closure cleanly
  mainPage.on("close", () => {
    log("BROWSER", "Main browser page was closed by operator.", colors.yellow);
    mainPage = null;
  });

  browser.on("disconnected", () => {
    log("BROWSER", "Browser process exited cleanly.", colors.yellow);
    browser = null;
    browserContext = null;
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
 * Dismisses Google Maps / Search cookie or consent prompts if present.
 */
async function dismissPopups(page) {
  try {
    const consentSelectors = [
      'button[aria-label*="Accept all"]',
      'button:has-text("Accept all")',
      'form:has-text("Accept all") button',
      'button:has-text("Agree")',
      'button:has-text("I agree")',
      'button[aria-label*="Agree"]',
    ];
    for (const sel of consentSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1000);
        break;
      }
    }
  } catch {}
}

/**
 * 4. Execute Real Google Maps Search & Discovery
 */
async function executeDiscovery(payload, correlationId) {
  const { query, max_results = 5, category = "VENUE", city = "Delhi" } = payload;
  isCancelled = false;
  const results = [];

  log("DISCOVERY", `Starting real browser discovery on Windows: query='${query}', max=${max_results}`, colors.bold);

  const { mainPage: page } = await ensureBrowser();

  try {
    sendEvent("page_opened", `Opening Google Maps for query: '${query}'`, { url: "https://www.google.com/maps" });

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForTimeout(2500);

    await dismissPopups(page);

    sendEvent("search_started", `Google Maps search results loaded for '${query}'`, {
      url: page.url(),
      title: await page.title(),
    });

    // Wait for the feed or listings container
    await page.waitForSelector('div[role="feed"], div[role="article"], a[href*="/maps/place/"]', { timeout: 15000 }).catch(() => {});

    // Scroll feed down once or twice if needed to load more results
    try {
      const feed = await page.$('div[role="feed"]');
      if (feed && max_results > 3) {
        await page.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        }, feed);
        await page.waitForTimeout(1500);
      }
    } catch {}

    // Collect candidate listing links and place names from Maps results
    const placeLinks = await page.evaluate(() => {
      const items = [];
      const seen = new Set();

      // Selector strategy 1: links with /maps/place/
      const links = document.querySelectorAll('a[href*="/maps/place/"]');
      for (const a of links) {
        const href = a.href;
        if (!seen.has(href)) {
          seen.add(href);
          const name = (a.getAttribute("aria-label") || a.innerText || "").split("\n")[0].trim();
          if (name) {
            items.push({ name, href });
          }
        }
      }

      // Selector strategy 2: cards with div.Nv2PK
      if (items.length === 0) {
        const cards = document.querySelectorAll('div.Nv2PK');
        for (const card of cards) {
          const a = card.querySelector('a.hfpxzc, a[href*="/maps/"]');
          if (a && !seen.has(a.href)) {
            seen.add(a.href);
            const name = (a.getAttribute("aria-label") || card.querySelector('div.qBF1Pd')?.innerText || "").trim();
            if (name) {
              items.push({ name, href: a.href });
            }
          }
        }
      }

      return items;
    });

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
        // Navigate to listing details
        await page.goto(item.href, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(1800);

        // Extract listing details from the place card
        const details = await page.evaluate(() => {
          const nameEl = document.querySelector('h1.DUwDvf, h1');
          const name = nameEl ? nameEl.innerText.trim() : "";

          // Rating and review count
          const ratingEl = document.querySelector('span.MW4etd, span.ceNzKf, div.F7nice span[aria-hidden="true"]');
          const ratingText = ratingEl ? ratingEl.innerText.replace(",", ".").trim() : null;
          const rating = ratingText && !isNaN(parseFloat(ratingText)) ? parseFloat(ratingText) : null;

          const reviewsEl = document.querySelector('span.UY7F9, span[aria-label*="reviews"], div.F7nice span:last-child');
          const reviewCount = reviewsEl ? parseInt(reviewsEl.innerText.replace(/\D/g, ""), 10) || null : null;

          // Address, Phone, Website
          let address = null;
          let phone = null;
          let website = null;

          const addressBtns = document.querySelectorAll('button[data-item-id*="address"], button[aria-label*="Address"]');
          if (addressBtns.length > 0) address = addressBtns[0].innerText.replace(/^Address:\s*/i, "").trim();

          const phoneBtns = document.querySelectorAll('button[data-item-id*="phone"], button[aria-label*="Phone"]');
          if (phoneBtns.length > 0) phone = phoneBtns[0].innerText.replace(/^Phone:\s*/i, "").trim();

          const webBtns = document.querySelectorAll('a[data-item-id*="authority"], a[aria-label*="Website"]');
          if (webBtns.length > 0) website = webBtns[0].href;

          return { name, rating, reviewCount, address, phone, website };
        });

        const candidateName = details.name || item.name;
        let verifiedPhone = details.phone;

        // If candidate has an official website, open it visibly in a real tab to verify it!
        if (details.website && !isCancelled) {
          try {
            log("TAB", `Opening verified website in tab: ${details.website}`, colors.magenta);
            const websitePage = await browserContext.newPage();
            websitePage._tabId = `tab_${++tabCounter}`;

            sendEvent("page_opened", `Inspecting candidate website in active tab: ${details.website}`, {
              url: details.website,
              candidate: candidateName,
            });

            await websitePage.goto(details.website, { waitUntil: "domcontentloaded", timeout: 15000 });
            await websitePage.bringToFront();

            // If phone was missing on Maps, search visible website text for contact phone
            if (!verifiedPhone) {
              const sitePhone = await websitePage.evaluate(() => {
                const text = document.body.innerText || "";
                // Match international or standard local phone numbers
                const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
                return phoneMatch ? phoneMatch[0].trim() : null;
              }).catch(() => null);

              if (sitePhone) {
                verifiedPhone = sitePhone;
                log("VERIFY", `Found contact phone from official website: ${sitePhone}`, colors.green);
              }
            }

            // Keep tab open for 1.5 seconds so the operator visibly sees it
            await websitePage.waitForTimeout(1500);
            await websitePage.close();
            await page.bringToFront();
          } catch (webErr) {
            log("TAB", `Could not load website ${details.website}: ${webErr.message}`, colors.yellow);
          }
        }

        const candidateData = {
          name: candidateName,
          category: category,
          raw_category: category,
          address: details.address || `${city}`,
          city: city,
          phone: verifiedPhone,
          website: details.website,
          maps_url: page.url(),
          rating: details.rating,
          review_count: details.reviewCount,
          source: "WINDOWS_BROWSER_COMPANION",
        };

        results.push(candidateData);
        sendEvent("candidate_found", `Discovered candidate on Google Maps: '${candidateName}'`, candidateData);

      } catch (itemErr) {
        log("ERROR", `Failed to inspect listing ${item.name}: ${itemErr.message}`, colors.yellow);
      }
    }

    log("DISCOVERY", `Completed discovery. Extracted ${results.length} valid candidates.`, colors.green);

    const tabs = await getTabList(page);

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
        tabs,
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
  const { command, correlation_id, execution_id, payload = {} } = msg;
  currentExecutionId = execution_id;

  log("COMMAND", `Received ${command} (cid=${correlation_id})`, colors.bold);

  // --- START_DISCOVERY ---
  if (command === "START_DISCOVERY") {
    const result = await executeDiscovery(payload, correlation_id);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(result));
    }
    return;
  }

  // --- CANCEL ---
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

  // --- NAVIGATE ---
  if (command === "NAVIGATE") {
    try {
      const { mainPage: page } = await ensureBrowser();
      const targetUrl = validateDestination(payload.url || "https://www.google.com");

      // Find specific tab if tab_id provided
      let targetPage = page;
      if (payload.tab_id && browserContext) {
        const found = browserContext.pages().find((p) => p._tabId === payload.tab_id && !p.isClosed());
        if (found) targetPage = found;
      }

      await targetPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: payload.timeout_ms || 30000 });
      await targetPage.bringToFront();

      const tabs = await getTabList(targetPage);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: true,
          results: [],
          metadata: {
            current_url: targetPage.url(),
            current_title: await targetPage.title(),
            active_tab_id: targetPage._tabId,
            tabs,
          },
        }));
      }
    } catch (err) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: false,
          error: err.message,
        }));
      }
    }
    return;
  }

  // --- OPEN_TAB ---
  if (command === "OPEN_TAB") {
    try {
      await ensureBrowser();
      const newPage = await browserContext.newPage();
      newPage._tabId = `tab_${++tabCounter}`;

      if (payload.url) {
        const targetUrl = validateDestination(payload.url);
        await newPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: payload.timeout_ms || 30000 });
      }

      await newPage.bringToFront();
      const tabs = await getTabList(newPage);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: true,
          results: [],
          metadata: {
            active_tab_id: newPage._tabId,
            current_url: newPage.url(),
            current_title: await newPage.title(),
            tabs,
          },
        }));
      }
    } catch (err) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: false,
          error: err.message,
        }));
      }
    }
    return;
  }

  // --- SWITCH_TAB ---
  if (command === "SWITCH_TAB") {
    try {
      await ensureBrowser();
      const targetId = payload.tab_id;
      let activePage = mainPage;

      if (targetId && browserContext) {
        const found = browserContext.pages().find((p) => p._tabId === targetId && !p.isClosed());
        if (found) {
          activePage = found;
          await activePage.bringToFront();
        }
      }

      const tabs = await getTabList(activePage);

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: true,
          results: [],
          metadata: {
            active_tab_id: activePage._tabId,
            current_url: activePage.url(),
            current_title: await activePage.title(),
            tabs,
          },
        }));
      }
    } catch (err) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: false,
          error: err.message,
        }));
      }
    }
    return;
  }

  // --- INSPECT_URL ---
  if (command === "INSPECT_URL") {
    try {
      const { mainPage: page } = await ensureBrowser();
      const targetUrl = validateDestination(payload.url);
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: payload.timeout_ms || 25000 });

      const content = await page.evaluate(() => {
        const title = document.title || "";
        const metaDesc = document.querySelector('meta[name="description"]')?.content || "";
        const text = (document.body.innerText || "").slice(0, 5000);
        const phoneMatch = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
        return {
          title,
          description: metaDesc,
          phone: phoneMatch ? phoneMatch[0].trim() : null,
          textSample: text.slice(0, 500),
        };
      });

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: true,
          results: [content],
          metadata: { current_url: page.url(), current_title: await page.title() },
        }));
      }
    } catch (err) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "RESULT",
          correlation_id,
          execution_id,
          success: false,
          error: err.message,
        }));
      }
    }
    return;
  }

  // --- STOP_SESSION ---
  if (command === "STOP_SESSION") {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      browserContext = null;
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

  // --- PING ---
  if (command === "PING") {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "PONG",
        correlation_id,
        execution_id,
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
    log("DISCONNECTED", `WebSocket connection closed (code: ${event.code}). Reconnecting in 4s...`, colors.yellow);
    ws = null;
    setTimeout(startCompanion, 4000);
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

// Clean shutdown on Ctrl+C or process exit
process.on("SIGINT", async () => {
  log("SHUTDOWN", "Shutting down companion...", colors.yellow);
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(0);
});

// Start the companion
startCompanion();
