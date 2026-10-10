"""Browser Runtime Service for EVENTRA.

Handles communication with the live browser runtime container and enforces
security boundaries such as URL scheme validation and SSRF mitigation.
"""

import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)

ALLOWED_SCHEMES = {"http", "https"}
DISALLOWED_HOSTS = {
    "169.254.169.254",  # AWS/GCP instance metadata
    "metadata.google.internal",
    "instance-data",
}


def validate_browser_url(raw_url: str, allow_blank: bool = False) -> str:
    """Validates that a URL is safe for the browser runtime to open.

    Rejects non-HTTP(S) schemes (e.g. file:, javascript:, data:) and
    known sensitive internal infrastructure targets.
    """
    trimmed = (raw_url or "").strip()
    if not trimmed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="URL parameter cannot be empty.",
        )

    if allow_blank and trimmed == "about:blank":
        return trimmed

    parsed = urlparse(trimmed)
    scheme = parsed.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid URL scheme '{scheme}'. Only HTTP and HTTPS are permitted.",
        )

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL must contain a valid hostname.",
        )

    if hostname in DISALLOWED_HOSTS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Navigation to restricted infrastructure target '{hostname}' is blocked.",
        )

    return trimmed


class TabInfo(BaseModel):
    tab_id: str
    url: str
    title: str
    is_active: bool


class BrowserSessionResponse(BaseModel):
    session_id: str
    status: str
    active_tab_id: Optional[str] = None
    tabs: List[TabInfo] = Field(default_factory=list)
    viewer_url: str
    error: Optional[str] = None


class BrowserRuntimeService:
    """Client for controlling the live browser runtime."""

    def __init__(self, base_url: Optional[str] = None, timeout_seconds: Optional[int] = None):
        self.base_url = (base_url or settings.BROWSER_RUNTIME_URL).rstrip("/")
        self.timeout = timeout_seconds or settings.BROWSER_RUNTIME_TIMEOUT_SECONDS

    async def _request(self, method: str, path: str, json_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(method, url, json=json_data)
                if response.status_code >= 400:
                    try:
                        err_detail = response.json().get("detail", response.text)
                    except Exception:
                        err_detail = response.text or f"HTTP {response.status_code}"
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=err_detail,
                    )
                return response.json()
        except httpx.ConnectError:
            logger.error("Failed to connect to browser runtime daemon at %s", self.base_url)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Browser runtime service is not reachable at {self.base_url}. Ensure the browser-runtime service is running.",
            )
        except httpx.TimeoutException:
            logger.error("Browser runtime request to %s timed out after %ds", url, self.timeout)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"Browser runtime request to {path} timed out.",
            )

    async def get_health(self) -> Dict[str, Any]:
        return await self._request("GET", "/health")

    async def start_session(
        self,
        session_id: Optional[str] = None,
        initial_url: Optional[str] = None,
        force: bool = False,
    ) -> BrowserSessionResponse:
        if initial_url:
            initial_url = validate_browser_url(initial_url, allow_blank=True)
        data = await self._request(
            "POST",
            "/sessions",
            {"session_id": session_id, "initial_url": initial_url, "force": force},
        )
        return BrowserSessionResponse(**data)

    async def get_session(self, session_id: str) -> BrowserSessionResponse:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        data = await self._request("GET", f"/sessions/{session_id.strip()}")
        return BrowserSessionResponse(**data)

    async def navigate(self, session_id: str, url: str, tab_id: Optional[str] = None, timeout_ms: int = 30000) -> BrowserSessionResponse:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        validated_url = validate_browser_url(url, allow_blank=True)
        data = await self._request(
            "POST",
            f"/sessions/{session_id.strip()}/navigate",
            {"url": validated_url, "tab_id": tab_id, "timeout_ms": timeout_ms},
        )
        return BrowserSessionResponse(**data)

    async def create_tab(self, session_id: str, url: Optional[str] = None, timeout_ms: int = 30000) -> BrowserSessionResponse:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        validated_url = validate_browser_url(url, allow_blank=True) if url else None
        data = await self._request(
            "POST",
            f"/sessions/{session_id.strip()}/tabs",
            {"url": validated_url, "timeout_ms": timeout_ms},
        )
        return BrowserSessionResponse(**data)

    async def activate_tab(self, session_id: str, tab_id: str) -> BrowserSessionResponse:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        if not tab_id or not tab_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tab ID is required.")
        data = await self._request(
            "POST",
            f"/sessions/{session_id.strip()}/tabs/{tab_id.strip()}/activate",
        )
        return BrowserSessionResponse(**data)

    async def stop_session(self, session_id: str) -> BrowserSessionResponse:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        data = await self._request(
            "POST",
            f"/sessions/{session_id.strip()}/stop",
        )
        return BrowserSessionResponse(**data)

    async def search_discovery(
        self,
        session_id: str,
        query: str,
        max_results: int = 5,
        category: Optional[str] = None,
        inspect_details: bool = True,
        timeout_ms: int = 30000,
    ) -> Dict[str, Any]:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        return await self._request(
            "POST",
            f"/sessions/{session_id.strip()}/search_discovery",
            {
                "query": query,
                "max_results": max_results,
                "category": category,
                "inspect_details": inspect_details,
                "timeout_ms": timeout_ms,
            },
        )

    async def inspect_url(
        self,
        session_id: str,
        url: str,
        timeout_ms: int = 20000,
    ) -> Dict[str, Any]:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        validated_url = validate_browser_url(url)
        return await self._request(
            "POST",
            f"/sessions/{session_id.strip()}/inspect_url",
            {"url": validated_url, "timeout_ms": timeout_ms},
        )

    async def get_page_content(self, session_id: str) -> Dict[str, Any]:
        if not session_id or not session_id.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session ID is required.")
        return await self._request("GET", f"/sessions/{session_id.strip()}/content")


browser_runtime_service = BrowserRuntimeService()


def get_browser_runtime_service() -> BrowserRuntimeService:
    """Dependency provider for browser runtime service."""
    return browser_runtime_service
