"""FastAPI Route Handlers for EVENTRA Real Browser Runtime."""

from typing import Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from app.services.browser_runtime_service import (
    BrowserRuntimeService,
    BrowserSessionResponse,
    get_browser_runtime_service,
)

router = APIRouter(
    prefix="/browser-runtime",
    tags=["Browser Runtime"],
)


class StartSessionPayload(BaseModel):
    session_id: Optional[str] = Field(None, description="Optional custom session identifier")
    initial_url: Optional[str] = Field(None, description="Optional initial URL to navigate upon launch")


class NavigatePayload(BaseModel):
    url: str = Field(..., description="Target HTTP/HTTPS URL to navigate to")
    tab_id: Optional[str] = Field(None, description="Target tab ID. Defaults to active tab if omitted.")
    timeout_ms: int = Field(30000, description="Navigation timeout in milliseconds", ge=1000, le=120000)


class CreateTabPayload(BaseModel):
    url: Optional[str] = Field(None, description="Optional URL to navigate the new tab to")
    timeout_ms: int = Field(30000, description="Navigation timeout in milliseconds", ge=1000, le=120000)


@router.get("/health", summary="Check browser runtime connectivity and display health")
async def health(service: BrowserRuntimeService = Depends(get_browser_runtime_service)):
    return await service.get_health()


@router.post("/sessions", response_model=BrowserSessionResponse, status_code=status.HTTP_201_CREATED, summary="Start a new browser session")
async def create_session(
    payload: StartSessionPayload = StartSessionPayload(),
    service: BrowserRuntimeService = Depends(get_browser_runtime_service),
):
    """Launches a real Chromium browser instance on the graphical display."""
    return await service.start_session(session_id=payload.session_id, initial_url=payload.initial_url)


@router.get("/sessions/{session_id}", response_model=BrowserSessionResponse, summary="Get session state and tabs")
async def get_session(
    session_id: str,
    service: BrowserRuntimeService = Depends(get_browser_runtime_service),
):
    """Returns the current state of the browser session including all tabs and active status."""
    return await service.get_session(session_id)


@router.post("/sessions/{session_id}/navigate", response_model=BrowserSessionResponse, summary="Navigate active or specified tab")
async def navigate(
    session_id: str,
    payload: NavigatePayload,
    service: BrowserRuntimeService = Depends(get_browser_runtime_service),
):
    """Navigates the specified tab to a validated URL."""
    return await service.navigate(
        session_id=session_id,
        url=payload.url,
        tab_id=payload.tab_id,
        timeout_ms=payload.timeout_ms,
    )


@router.post("/sessions/{session_id}/tabs", response_model=BrowserSessionResponse, status_code=status.HTTP_201_CREATED, summary="Open a new browser tab")
async def create_tab(
    session_id: str,
    payload: CreateTabPayload = CreateTabPayload(),
    service: BrowserRuntimeService = Depends(get_browser_runtime_service),
):
    """Creates a new browser tab in the active session."""
    return await service.create_tab(
        session_id=session_id,
        url=payload.url,
        timeout_ms=payload.timeout_ms,
    )


@router.post("/sessions/{session_id}/tabs/{tab_id}/activate", response_model=BrowserSessionResponse, summary="Switch active browser tab")
async def activate_tab(
    session_id: str,
    tab_id: str,
    service: BrowserRuntimeService = Depends(get_browser_runtime_service),
):
    """Switches focus to the specified browser tab and brings it to front in the viewer."""
    return await service.activate_tab(session_id=session_id, tab_id=tab_id)


@router.post("/sessions/{session_id}/stop", response_model=BrowserSessionResponse, summary="Stop browser session and clean up")
async def stop_session(
    session_id: str,
    service: BrowserRuntimeService = Depends(get_browser_runtime_service),
):
    """Closes all tabs, shuts down Chromium, and releases display/system resources."""
    return await service.stop_session(session_id=session_id)
