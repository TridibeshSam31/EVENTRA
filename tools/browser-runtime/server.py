"""EVENTRA Browser Runtime Service.

Manages headed Chromium browser sessions running on virtual display (Xvfb)
accessible via noVNC live viewing.
"""

import asyncio
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("browser_runtime")


# --- Pydantic Models ---


class TabInfo(BaseModel):
    tab_id: str
    url: str
    title: str
    is_active: bool


class SessionState(BaseModel):
    session_id: str
    status: str  # "running", "stopped", "failed"
    active_tab_id: Optional[str] = None
    tabs: List[TabInfo] = Field(default_factory=list)
    viewer_url: str
    error: Optional[str] = None


class StartSessionRequest(BaseModel):
    session_id: Optional[str] = None
    initial_url: Optional[str] = None
    force: bool = False


class NavigateRequest(BaseModel):
    url: str
    tab_id: Optional[str] = None
    timeout_ms: int = 30000


class CreateTabRequest(BaseModel):
    url: Optional[str] = None
    timeout_ms: int = 30000


class SearchGoogleMapsRequest(BaseModel):
    query: str
    max_results: int = 5
    category: Optional[str] = None
    inspect_details: bool = True
    timeout_ms: int = 30000


class InspectUrlRequest(BaseModel):
    url: str
    timeout_ms: int = 20000


# --- Security: URL Validation ---

ALLOWED_SCHEMES = {"http", "https"}
DISALLOWED_HOSTS = {
    "169.254.169.254",  # Cloud metadata service
    "metadata.google.internal",
}


def validate_target_url(raw_url: str, allow_blank: bool = False) -> str:
    """Validate target URL ensuring safe schemes and disallowing dangerous targets."""
    trimmed = raw_url.strip()
    if not trimmed:
        raise ValueError("URL cannot be empty.")

    if allow_blank and trimmed == "about:blank":
        return trimmed

    parsed = urlparse(trimmed)
    scheme = parsed.scheme.lower()

    if scheme not in ALLOWED_SCHEMES:
        raise ValueError(f"Unsupported URL scheme '{scheme}'. Only HTTP and HTTPS are permitted.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("URL must have a valid hostname.")

    if hostname in DISALLOWED_HOSTS:
        raise ValueError(f"Navigation to restricted target '{hostname}' is forbidden.")

    return trimmed


# --- Active Session Container ---


class BrowserSessionManager:
    """Manages a single headed Chromium browser session on the X11 display."""

    def __init__(self):
        self._lock = asyncio.Lock()
        self.playwright: Any = None
        self.browser: Any = None
        self.context: Any = None
        self.session_id: Optional[str] = None
        self.tabs: Dict[str, Any] = {}  # tab_id -> Page
        self.active_tab_id: Optional[str] = None
        self.is_running: bool = False
        self.display: str = os.getenv("DISPLAY", ":99")
        self.viewer_host: str = os.getenv("VIEWER_PUBLIC_URL", "http://localhost:6080")

    @property
    def viewer_url(self) -> str:
        return f"{self.viewer_host}/vnc.html?autoconnect=true&resize=scale"

    async def start(self, session_id: Optional[str] = None, initial_url: Optional[str] = None, force: bool = False) -> SessionState:
        async with self._lock:
            # If a session is already running with the same session_id, return it safely (idempotent)
            if self.is_running and self.session_id:
                if session_id is None or session_id == self.session_id:
                    return await self.get_state_unlocked()
                if force:
                    logger.info("Force flag set: terminating prior session '%s' for new session '%s'", self.session_id, session_id)
                    await self._cleanup_unlocked()
                else:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Another browser session ({self.session_id}) is currently active. Stop it first.",
                    )

            # Clean any stale resources
            await self._cleanup_unlocked()

            sid = session_id or str(uuid.uuid4())
            logger.info("Starting real Chromium browser session '%s' on DISPLAY=%s", sid, self.display)

            try:
                from playwright.async_api import async_playwright

                self.playwright = await async_playwright().start()

                # Launch real headed Chromium on virtual display
                self.browser = await self.playwright.chromium.launch(
                    headless=False,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--start-maximized",
                        "--window-size=1280,800",
                        "--window-position=0,0",
                        "--disable-infobars",
                        "--no-first-run",
                        "--no-default-browser-check",
                    ],
                )

                # Context with 1280x800 viewport
                self.context = await self.browser.new_context(
                    viewport={"width": 1260, "height": 720},
                    user_agent=(
                        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                    ),
                )

                # Create initial tab
                page = await self.context.new_page()
                tab_id = str(uuid.uuid4())[:8]
                self.tabs[tab_id] = page
                self.active_tab_id = tab_id
                self.session_id = sid
                self.is_running = True

                # Navigate if initial_url specified
                target_url = initial_url or "about:blank"
                if initial_url:
                    validated = validate_target_url(initial_url)
                    logger.info("Navigating initial tab %s to %s", tab_id, validated)
                    await page.goto(validated, timeout=30000, wait_until="domcontentloaded")
                else:
                    # Provide an aesthetically pleasing starting canvas on the browser display
                    await page.set_content(
                        """<!DOCTYPE html>
<html>
<head>
  <title>EVENTRA Live Browser Runtime</title>
  <style>
    body {
      margin: 0; padding: 40px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh;
    }
    .badge { background: #3b82f6; color: white; padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    h1 { font-size: 32px; margin: 18px 0 8px; color: #f1f5f9; }
    p { font-size: 16px; color: #94a3b8; max-width: 520px; text-align: center; line-height: 1.6; }
    .status-box { margin-top: 24px; padding: 12px 20px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; font-family: monospace; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="badge">EVENTRA Live Runtime</div>
  <h1>Real Browser Desktop Active</h1>
  <p>Playwright is controlling real Chromium on virtual X11 display. Awaiting navigation commands from EVENTRA API.</p>
  <div class="status-box">Status: Ready &bull; Display: :99 &bull; Live Stream Active</div>
</body>
</html>"""
                    )

                logger.info("Session '%s' initialized with tab '%s'", sid, tab_id)
                return await self.get_state_unlocked()

            except Exception as e:
                logger.error("Failed to start browser session: %s", e, exc_info=True)
                await self._cleanup_unlocked()
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Browser startup failed: {str(e)}",
                )

    async def get_state_unlocked(self) -> SessionState:
        if not self.is_running or not self.session_id:
            return SessionState(
                session_id="",
                status="stopped",
                viewer_url=self.viewer_url,
                tabs=[],
            )

        tab_infos: List[TabInfo] = []
        for tid, page in list(self.tabs.items()):
            try:
                current_url = page.url or "about:blank"
                title = await page.title()
            except Exception:
                current_url = "unavailable"
                title = "closed"
            tab_infos.append(
                TabInfo(
                    tab_id=tid,
                    url=current_url,
                    title=title or "Untitled",
                    is_active=(tid == self.active_tab_id),
                )
            )

        return SessionState(
            session_id=self.session_id,
            status="running",
            active_tab_id=self.active_tab_id,
            tabs=tab_infos,
            viewer_url=self.viewer_url,
        )

    async def get_state(self, session_id: str) -> SessionState:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session '{session_id}' not found or not currently running.",
                )
            return await self.get_state_unlocked()

    async def navigate(self, session_id: str, url: str, tab_id: Optional[str] = None, timeout_ms: int = 30000) -> SessionState:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session '{session_id}' not found or not active.",
                )

            validated_url = validate_target_url(url, allow_blank=True)
            target_tid = tab_id or self.active_tab_id
            if not target_tid or target_tid not in self.tabs:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Tab '{target_tid}' not found in session '{session_id}'.",
                )

            page = self.tabs[target_tid]
            logger.info("Session '%s': Navigating tab '%s' to '%s'", session_id, target_tid, validated_url)

            try:
                # Bring to front so user sees navigation in viewer
                await page.bring_to_front()
                self.active_tab_id = target_tid

                # Perform navigation
                await page.goto(validated_url, timeout=timeout_ms, wait_until="domcontentloaded")
            except Exception as e:
                logger.error("Navigation error on tab '%s': %s", target_tid, e)
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Failed to navigate to '{validated_url}': {str(e)}",
                )

            return await self.get_state_unlocked()

    async def create_tab(self, session_id: str, url: Optional[str] = None, timeout_ms: int = 30000) -> SessionState:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session '{session_id}' not found or not active.",
                )

            if not self.context:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Browser context is missing.",
                )

            target_url = validate_target_url(url, allow_blank=True) if url else "about:blank"
            logger.info("Session '%s': Opening new tab for URL '%s'", session_id, target_url)

            try:
                page = await self.context.new_page()
                new_tab_id = str(uuid.uuid4())[:8]
                self.tabs[new_tab_id] = page
                self.active_tab_id = new_tab_id
                await page.bring_to_front()

                if url:
                    await page.goto(target_url, timeout=timeout_ms, wait_until="domcontentloaded")
                else:
                    await page.set_content(
                        f"""<!DOCTYPE html>
<html>
<head>
  <title>Tab {new_tab_id} - EVENTRA</title>
  <style>
    body {{
      margin: 0; padding: 40px; font-family: sans-serif; background: #1e1b4b; color: #e0e7ff;
      display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh;
    }}
    h1 {{ font-size: 28px; margin-bottom: 8px; }}
    p {{ color: #a5b4fc; font-size: 16px; }}
  </style>
</head>
<body>
  <h1>New Tab: {new_tab_id}</h1>
  <p>Ready for navigation.</p>
</body>
</html>"""
                    )
            except Exception as e:
                logger.error("Failed to create new tab: %s", e)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to open new tab: {str(e)}",
                )

            return await self.get_state_unlocked()

    async def activate_tab(self, session_id: str, tab_id: str) -> SessionState:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session '{session_id}' not found or not active.",
                )

            if tab_id not in self.tabs:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Tab '{tab_id}' does not exist in session '{session_id}'.",
                )

            page = self.tabs[tab_id]
            try:
                await page.bring_to_front()
                self.active_tab_id = tab_id
                logger.info("Session '%s': Activated tab '%s'", session_id, tab_id)
            except Exception as e:
                logger.error("Failed to activate tab '%s': %s", tab_id, e)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Could not activate tab '{tab_id}': {str(e)}",
                )

            return await self.get_state_unlocked()

    async def stop(self, session_id: str) -> SessionState:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session '{session_id}' not found or already stopped.",
                )

            logger.info("Stopping browser session '%s' and cleaning up resources", session_id)
            await self._cleanup_unlocked()
            return SessionState(
                session_id=session_id,
                status="stopped",
                viewer_url=self.viewer_url,
                tabs=[],
            )

    async def search_google_maps(
        self,
        session_id: str,
        query: str,
        max_results: int = 5,
        category: Optional[str] = None,
        inspect_details: bool = True,
        timeout_ms: int = 30000,
    ) -> Dict[str, Any]:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session '{session_id}' not found or not active.",
                )

            target_tid = self.active_tab_id
            if not target_tid or target_tid not in self.tabs:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No active tab available for search.",
                )

            page = self.tabs[target_tid]
            import urllib.parse
            import re

            search_url = f"https://www.google.com/maps/search/{urllib.parse.quote_plus(query)}?hl=en"
            logger.info("Session '%s': Navigating to Google Maps search '%s'", session_id, search_url)

            try:
                await page.bring_to_front()
                await page.goto(search_url, timeout=timeout_ms, wait_until="domcontentloaded")
            except Exception as e:
                logger.error("Failed to load Google Maps: %s", e)
                return {
                    "status": "error",
                    "error": f"Failed to load search page: {str(e)}",
                    "results": [],
                }

            # Check for consent modal
            try:
                consent_btn = await page.query_selector('button:has-text("Accept all"), button:has-text("I agree"), form[action*="consent"] button')
                if consent_btn:
                    logger.info("Found consent button on Google Maps, accepting...")
                    await consent_btn.click()
                    await page.wait_for_timeout(2000)
            except Exception:
                pass

            # Check if blocked / captcha
            current_url = page.url or ""
            try:
                page_text = (await page.inner_text("body") or "").lower()
            except Exception:
                page_text = ""

            if "sorry/index" in current_url or "recaptcha" in page_text or "unusual traffic" in page_text:
                logger.warning("Google Maps challenged automation (CAPTCHA / unusual traffic)")
                return {
                    "status": "blocked",
                    "reason": "Google Maps CAPTCHA / bot challenge encountered on live browser.",
                    "results": [],
                    "current_url": current_url,
                }

            # Wait for search feed / place links
            try:
                await page.wait_for_selector('a[href*="/maps/place/"], div[role="feed"]', timeout=12000)
            except Exception:
                logger.info("Feed selector not immediately found, scanning visible DOM...")

            # Extract place links
            place_elements = await page.query_selector_all('a[href*="/maps/place/"]')
            logger.info("Found %d place links in Maps feed", len(place_elements))

            extracted = []
            seen_names = set()

            for elem in place_elements:
                if len(extracted) >= max_results:
                    break
                try:
                    aria_name = await elem.get_attribute("aria-label")
                    href = await elem.get_attribute("href")
                    if not aria_name or aria_name.strip() in seen_names:
                        continue

                    name_clean = aria_name.strip()
                    seen_names.add(name_clean)

                    lat, lon = None, None
                    if href:
                        coord_match = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", href)
                        if coord_match:
                            lat = float(coord_match.group(1))
                            lon = float(coord_match.group(2))

                    item = {
                        "name": name_clean,
                        "maps_url": href,
                        "latitude": lat,
                        "longitude": lon,
                        "rating": None,
                        "review_count": None,
                        "website": None,
                        "phone": None,
                        "address": None,
                        "raw_category": category,
                        "source": "BROWSER_AGENT",
                    }

                    # Check parent/sibling elements for rating and reviews
                    try:
                        parent = await elem.evaluate_handle("el => el.closest('[role=\"article\"]') || el.parentElement")
                        if parent:
                            rating_span = await parent.query_selector('span[aria-label*="stars"]')
                            if rating_span:
                                r_label = await rating_span.get_attribute("aria-label")
                                r_match = re.search(r"(\d+(\.\d+)?)", r_label or "")
                                if r_match:
                                    item["rating"] = float(r_match.group(1))

                            rev_span = await parent.query_selector('span[aria-label*="reviews"]')
                            if rev_span:
                                rev_label = await rev_span.get_attribute("aria-label")
                                rev_match = re.search(r"([\d,]+)", rev_label or "")
                                if rev_match:
                                    item["review_count"] = int(rev_match.group(1).replace(",", ""))

                            web_link = await parent.query_selector('a[aria-label*="website" i]')
                            if web_link:
                                item["website"] = await web_link.get_attribute("href")
                    except Exception:
                        pass

                    # If inspect_details, click on item to bring up detail card in noVNC live viewer
                    if inspect_details:
                        try:
                            logger.info("Inspecting place listing '%s' on browser display...", name_clean)
                            await elem.click()
                            await page.wait_for_timeout(2000)

                            addr_btn = await page.query_selector('button[data-item-id*="address"], [aria-label*="Address:"]')
                            if addr_btn:
                                a_text = await addr_btn.inner_text()
                                if a_text:
                                    item["address"] = a_text.replace("\n", " ").strip()

                            phone_btn = await page.query_selector('button[data-item-id*="phone"], [aria-label*="Phone:"]')
                            if phone_btn:
                                p_text = await phone_btn.inner_text()
                                if p_text:
                                    item["phone"] = p_text.strip()

                            if not item["website"]:
                                web_btn = await page.query_selector('a[data-item-id="authority"], [aria-label*="Website:"]')
                                if web_btn:
                                    item["website"] = await web_btn.get_attribute("href")

                            if not item["rating"]:
                                rate_btn = await page.query_selector('div.F7nice span[aria-hidden="true"], span.ceNzKf')
                                if rate_btn:
                                    r_text = await rate_btn.inner_text()
                                    try:
                                        item["rating"] = float(r_text.strip())
                                    except Exception:
                                        pass
                        except Exception as click_err:
                            logger.debug("Could not inspect detail pane for %s: %s", name_clean, click_err)

                    extracted.append(item)
                except Exception as ex:
                    logger.debug("Error extracting item from place element: %s", ex)

            return {
                "status": "success",
                "current_url": page.url,
                "current_title": await page.title(),
                "count": len(extracted),
                "results": extracted,
            }

    async def inspect_url(
        self,
        session_id: str,
        url: str,
        timeout_ms: int = 20000,
    ) -> Dict[str, Any]:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Session '{session_id}' not found or not active.",
                )

            validated_url = validate_target_url(url)
            target_tid = self.active_tab_id
            page = self.tabs.get(target_tid)
            if not page:
                raise HTTPException(status_code=404, detail="No active tab available.")

            try:
                await page.bring_to_front()
                await page.goto(validated_url, timeout=timeout_ms, wait_until="domcontentloaded")
                title = await page.title()
                meta_desc = await page.query_selector('meta[name="description"]')
                desc = await meta_desc.get_attribute("content") if meta_desc else ""
                body_text = await page.inner_text("body")
                import re
                phone_match = re.search(r"(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}", body_text or "")
                email_match = re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", body_text or "")

                return {
                    "url": page.url,
                    "title": title,
                    "description": desc or (body_text[:200] if body_text else ""),
                    "detected_phone": phone_match.group(0) if phone_match else None,
                    "detected_email": email_match.group(0) if email_match else None,
                }
            except Exception as e:
                return {
                    "url": validated_url,
                    "error": str(e),
                }

    async def get_page_content(self, session_id: str) -> Dict[str, Any]:
        async with self._lock:
            if not self.is_running or self.session_id != session_id:
                raise HTTPException(status_code=404, detail="Session not running.")
            page = self.tabs.get(self.active_tab_id)
            if not page:
                raise HTTPException(status_code=404, detail="No active tab.")
            return {
                "url": page.url,
                "title": await page.title(),
                "content": await page.content(),
            }

    async def _cleanup_unlocked(self):
        """Release all Playwright pages, context, browser and runner."""
        for tid, page in list(self.tabs.items()):
            try:
                await page.close()
            except Exception:
                pass
        self.tabs.clear()
        self.active_tab_id = None

        if self.context:
            try:
                await self.context.close()
            except Exception:
                pass
            self.context = None

        if self.browser:
            try:
                await self.browser.close()
            except Exception:
                pass
            self.browser = None

        if self.playwright:
            try:
                await self.playwright.stop()
            except Exception:
                pass
            self.playwright = None

        self.session_id = None
        self.is_running = False


manager = BrowserSessionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Browser Runtime Service started on port 9223.")
    yield
    logger.info("Shutting down Browser Runtime Service...")
    await manager._cleanup_unlocked()


app = FastAPI(
    title="EVENTRA Browser Runtime Service",
    description="Dedicated headed Chromium runtime daemon with noVNC visual live display.",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "display": manager.display,
        "is_running": manager.is_running,
        "active_session": manager.session_id,
        "viewer_url": manager.viewer_url,
    }


@app.post("/sessions", response_model=SessionState)
async def start_session(req: StartSessionRequest = StartSessionRequest()):
    return await manager.start(session_id=req.session_id, initial_url=req.initial_url, force=req.force)


@app.get("/sessions/{session_id}", response_model=SessionState)
async def get_session(session_id: str):
    return await manager.get_state(session_id)


@app.post("/sessions/{session_id}/navigate", response_model=SessionState)
async def navigate(session_id: str, req: NavigateRequest):
    return await manager.navigate(
        session_id=session_id,
        url=req.url,
        tab_id=req.tab_id,
        timeout_ms=req.timeout_ms,
    )


@app.post("/sessions/{session_id}/tabs", response_model=SessionState)
async def create_tab(session_id: str, req: CreateTabRequest = CreateTabRequest()):
    return await manager.create_tab(
        session_id=session_id,
        url=req.url,
        timeout_ms=req.timeout_ms,
    )


@app.post("/sessions/{session_id}/tabs/{tab_id}/activate", response_model=SessionState)
async def activate_tab(session_id: str, tab_id: str):
    return await manager.activate_tab(session_id=session_id, tab_id=tab_id)


@app.post("/sessions/{session_id}/stop", response_model=SessionState)
async def stop_session(session_id: str):
    return await manager.stop(session_id=session_id)


@app.post("/sessions/{session_id}/search_discovery")
async def search_discovery(session_id: str, req: SearchGoogleMapsRequest):
    return await manager.search_google_maps(
        session_id=session_id,
        query=req.query,
        max_results=req.max_results,
        category=req.category,
        inspect_details=req.inspect_details,
        timeout_ms=req.timeout_ms,
    )


@app.post("/sessions/{session_id}/inspect_url")
async def inspect_url(session_id: str, req: InspectUrlRequest):
    return await manager.inspect_url(
        session_id=session_id,
        url=req.url,
        timeout_ms=req.timeout_ms,
    )


@app.get("/sessions/{session_id}/content")
async def get_page_content(session_id: str):
    return await manager.get_page_content(session_id=session_id)
