"""Tests for EVENTRA Browser Runtime Service and API Routes."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.services.browser_runtime_service import (
    BrowserRuntimeService,
    BrowserSessionResponse,
    TabInfo,
    validate_browser_url,
)


@pytest.fixture
def client():
    return TestClient(app)


# --- 1. URL Validation Security Tests ---


def test_url_validation_valid_http_and_https():
    assert validate_browser_url("https://example.com") == "https://example.com"
    assert validate_browser_url("http://example.com/sub/path?q=test") == "http://example.com/sub/path?q=test"
    assert validate_browser_url("  https://eventra.local  ") == "https://eventra.local"


def test_url_validation_about_blank():
    assert validate_browser_url("about:blank", allow_blank=True) == "about:blank"
    with pytest.raises(HTTPException) as exc_info:
        validate_browser_url("about:blank", allow_blank=False)
    assert exc_info.value.status_code == 400


def test_url_validation_rejects_empty():
    with pytest.raises(HTTPException) as exc_info:
        validate_browser_url("")
    assert exc_info.value.status_code == 422

    with pytest.raises(HTTPException) as exc_info:
        validate_browser_url("   ")
    assert exc_info.value.status_code == 422


def test_url_validation_rejects_unsafe_schemes():
    unsafe_urls = [
        "file:///etc/passwd",
        "javascript:alert(document.cookie)",
        "data:text/html,<h1>PWNED</h1>",
        "ftp://files.example.com",
        "chrome://settings",
    ]
    for url in unsafe_urls:
        with pytest.raises(HTTPException) as exc_info:
            validate_browser_url(url)
        assert exc_info.value.status_code == 400, f"Expected 400 for {url}"


def test_url_validation_rejects_cloud_metadata_ssrf():
    metadata_urls = [
        "http://169.254.169.254/latest/meta-data/",
        "http://metadata.google.internal/computeMetadata/v1/",
    ]
    for url in metadata_urls:
        with pytest.raises(HTTPException) as exc_info:
            validate_browser_url(url)
        assert exc_info.value.status_code == 403, f"Expected 403 for {url}"


# --- 2. Mocked Browser Runtime Daemon Client Lifecycle Tests ---


class MockBrowserRuntimeService(BrowserRuntimeService):
    """Simulates the containerized browser daemon for predictable test execution."""

    def __init__(self):
        super().__init__(base_url="http://mock-daemon:9223")
        self.session_active = False
        self.session_id = None
        self.tabs = {}
        self.active_tab_id = None

    async def get_health(self):
        return {
            "status": "ok",
            "display": ":99",
            "is_running": self.session_active,
            "active_session": self.session_id,
            "viewer_url": "http://localhost:6080/vnc.html?autoconnect=true&resize=scale",
        }

    async def start_session(self, session_id=None, initial_url=None, force=False, **kwargs):
        sid = session_id or "test-session-123"
        if self.session_active:
            if self.session_id == sid:
                return await self.get_session(sid)
            if force:
                self.session_active = False
                self.tabs = {}
            else:
                raise HTTPException(status_code=409, detail="Another session is active.")

        self.session_active = True
        self.session_id = sid
        target_url = validate_browser_url(initial_url, allow_blank=True) if initial_url else "about:blank"
        self.tabs = {
            "tab-1": {
                "tab_id": "tab-1",
                "url": target_url,
                "title": "Initial Tab" if initial_url else "Blank",
                "is_active": True,
            }
        }
        self.active_tab_id = "tab-1"
        return await self.get_session(sid)

    async def get_session(self, session_id):
        if not self.session_active or self.session_id != session_id:
            raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
        tab_list = [
            TabInfo(
                tab_id=t["tab_id"],
                url=t["url"],
                title=t["title"],
                is_active=(t["tab_id"] == self.active_tab_id),
            )
            for t in self.tabs.values()
        ]
        return BrowserSessionResponse(
            session_id=self.session_id,
            status="running",
            active_tab_id=self.active_tab_id,
            tabs=tab_list,
            viewer_url="http://localhost:6080/vnc.html?autoconnect=true&resize=scale",
        )

    async def navigate(self, session_id, url, tab_id=None, timeout_ms=30000):
        if not self.session_active or self.session_id != session_id:
            raise HTTPException(status_code=404, detail="Session not found.")
        validated = validate_browser_url(url, allow_blank=True)
        tid = tab_id or self.active_tab_id
        if tid not in self.tabs:
            raise HTTPException(status_code=404, detail="Tab not found.")
        self.tabs[tid]["url"] = validated
        self.tabs[tid]["title"] = f"Page for {validated}"
        self.active_tab_id = tid
        return await self.get_session(session_id)

    async def create_tab(self, session_id, url=None, timeout_ms=30000):
        if not self.session_active or self.session_id != session_id:
            raise HTTPException(status_code=404, detail="Session not found.")
        validated = validate_browser_url(url, allow_blank=True) if url else "about:blank"
        new_tid = f"tab-{len(self.tabs) + 1}"
        self.tabs[new_tid] = {
            "tab_id": new_tid,
            "url": validated,
            "title": f"New Tab {new_tid}",
            "is_active": True,
        }
        self.active_tab_id = new_tid
        return await self.get_session(session_id)

    async def activate_tab(self, session_id, tab_id):
        if not self.session_active or self.session_id != session_id:
            raise HTTPException(status_code=404, detail="Session not found.")
        if tab_id not in self.tabs:
            raise HTTPException(status_code=404, detail=f"Tab '{tab_id}' not found.")
        self.active_tab_id = tab_id
        return await self.get_session(session_id)

    async def stop_session(self, session_id):
        if not self.session_active or self.session_id != session_id:
            raise HTTPException(status_code=404, detail="Session not found.")
        self.session_active = False
        self.session_id = None
        self.tabs.clear()
        self.active_tab_id = None
        return BrowserSessionResponse(
            session_id=session_id,
            status="stopped",
            tabs=[],
            viewer_url="http://localhost:6080/vnc.html?autoconnect=true&resize=scale",
        )


@pytest.fixture
def mock_runtime():
    service = MockBrowserRuntimeService()
    from app.services.browser_runtime_service import get_browser_runtime_service

    app.dependency_overrides[get_browser_runtime_service] = lambda: service
    yield service
    app.dependency_overrides.pop(get_browser_runtime_service, None)


def test_full_browser_session_lifecycle(client, mock_runtime):
    # 1. Start session
    resp = client.post("/api/browser-runtime/sessions", json={"initial_url": "https://example.com"})
    assert resp.status_code == 201
    data = resp.json()
    sid = data["session_id"]
    assert sid is not None
    assert data["status"] == "running"
    assert len(data["tabs"]) == 1
    assert data["tabs"][0]["url"] == "https://example.com"
    assert "vnc.html" in data["viewer_url"]

    # 2. Get session
    resp = client.get(f"/api/browser-runtime/sessions/{sid}")
    assert resp.status_code == 200
    assert resp.json()["session_id"] == sid

    # 3. Navigate active tab
    resp = client.post(
        f"/api/browser-runtime/sessions/{sid}/navigate",
        json={"url": "https://news.ycombinator.com"},
    )
    assert resp.status_code == 200
    active_tab = [t for t in resp.json()["tabs"] if t["is_active"]][0]
    assert active_tab["url"] == "https://news.ycombinator.com"

    # 4. Open second tab
    resp = client.post(
        f"/api/browser-runtime/sessions/{sid}/tabs",
        json={"url": "https://github.com"},
    )
    assert resp.status_code == 201
    tabs = resp.json()["tabs"]
    assert len(tabs) == 2
    assert resp.json()["active_tab_id"] == "tab-2"

    # 5. Switch active tab back to tab-1
    resp = client.post(f"/api/browser-runtime/sessions/{sid}/tabs/tab-1/activate")
    assert resp.status_code == 200
    assert resp.json()["active_tab_id"] == "tab-1"

    # 6. Stop session
    resp = client.post(f"/api/browser-runtime/sessions/{sid}/stop")
    assert resp.status_code == 200
    assert resp.json()["status"] == "stopped"

    # 7. Accessing stopped session returns 404
    resp = client.get(f"/api/browser-runtime/sessions/{sid}")
    assert resp.status_code == 404


def test_invalid_session_id_returns_404(client, mock_runtime):
    resp = client.get("/api/browser-runtime/sessions/nonexistent-session")
    assert resp.status_code == 404

    resp = client.post("/api/browser-runtime/sessions/nonexistent-session/navigate", json={"url": "https://example.com"})
    assert resp.status_code == 404

    resp = client.post("/api/browser-runtime/sessions/nonexistent-session/stop")
    assert resp.status_code == 404


def test_navigate_rejects_malicious_urls(client, mock_runtime):
    # Start session
    resp = client.post("/api/browser-runtime/sessions")
    sid = resp.json()["session_id"]

    # Reject javascript scheme
    resp = client.post(
        f"/api/browser-runtime/sessions/{sid}/navigate",
        json={"url": "javascript:alert(1)"},
    )
    assert resp.status_code == 400

    # Reject file scheme
    resp = client.post(
        f"/api/browser-runtime/sessions/{sid}/navigate",
        json={"url": "file:///etc/hosts"},
    )
    assert resp.status_code == 400

    # Reject cloud metadata
    resp = client.post(
        f"/api/browser-runtime/sessions/{sid}/navigate",
        json={"url": "http://169.254.169.254/latest"},
    )
    assert resp.status_code == 403


def test_duplicate_session_conflict(client, mock_runtime):
    resp = client.post("/api/browser-runtime/sessions", json={"session_id": "session-A"})
    assert resp.status_code == 201

    # Starting a different session while session-A is active returns 409 Conflict
    resp2 = client.post("/api/browser-runtime/sessions", json={"session_id": "session-B"})
    assert resp2.status_code == 409
