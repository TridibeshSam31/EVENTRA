"""FastAPI Route Handlers for EVENTRA Browser Agent Control Layer (Phase 2)."""

import asyncio
from typing import List, Optional

from fastapi import (
    APIRouter,
    Depends,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_current_user_id, get_db_session
from sqlalchemy.orm import Session
from app.schemas.browser_agent import (
    CreateExecutionRequest,
    CreateExecutionTabRequest,
    ExecutionResponse,
    NavigateExecutionRequest,
    StopExecutionRequest,
)
from app.schemas.browser_discovery import (
    BrowserDiscoveryRequest,
    BrowserDiscoveryResponse,
    DiscoveredCandidate,
)
from app.services.browser_agent_service import (
    BrowserAgentService,
    get_browser_agent_service,
)
from app.services.browser_discovery_service import (
    BrowserDiscoveryService,
    get_browser_discovery_service,
)

router = APIRouter(
    prefix="/browser-agent",
    tags=["Browser Agent"],
)


@router.post(
    "/executions",
    response_model=ExecutionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create and start a Browser Agent execution",
)
async def create_execution(
    payload: CreateExecutionRequest = CreateExecutionRequest(),
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Initializes a new Browser Agent execution and binds it to a real browser session."""
    return await service.create_execution(
        execution_id=payload.execution_id,
        event_id=payload.event_id,
        initial_url=payload.initial_url,
        user_id=current_user_id,
    )


@router.get(
    "/executions",
    response_model=List[ExecutionResponse],
    summary="List Browser Agent executions",
)
async def list_executions(
    event_id: Optional[str] = Query(None, description="Filter by EVENTRA event ID"),
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Returns active and historical Browser Agent executions."""
    return await service.list_executions(event_id=event_id, user_id=current_user_id)


@router.get(
    "/executions/{execution_id}",
    response_model=ExecutionResponse,
    summary="Get current Browser Agent execution status snapshot",
)
async def get_execution(
    execution_id: str,
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Returns full execution snapshot including URL, page title, tabs, and status."""
    return await service.get_execution(execution_id=execution_id, user_id=current_user_id)


@router.post(
    "/executions/{execution_id}/navigate",
    response_model=ExecutionResponse,
    summary="Navigate execution active or specified tab",
)
async def navigate_execution(
    execution_id: str,
    payload: NavigateExecutionRequest,
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Instructs the Browser Agent to navigate to a validated URL."""
    return await service.navigate(
        execution_id=execution_id,
        url=payload.url,
        tab_id=payload.tab_id,
        timeout_ms=payload.timeout_ms,
        user_id=current_user_id,
    )


@router.post(
    "/executions/{execution_id}/tabs",
    response_model=ExecutionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Open a new tab in the execution",
)
async def create_tab(
    execution_id: str,
    payload: CreateExecutionTabRequest = CreateExecutionTabRequest(),
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Opens a new tab in the running execution browser."""
    return await service.create_tab(
        execution_id=execution_id,
        url=payload.url,
        timeout_ms=payload.timeout_ms,
        user_id=current_user_id,
    )


@router.post(
    "/executions/{execution_id}/tabs/{tab_id}/activate",
    response_model=ExecutionResponse,
    summary="Switch active tab in the execution",
)
async def activate_tab(
    execution_id: str,
    tab_id: str,
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Focuses the specified tab and brings it forward in the live viewer."""
    return await service.activate_tab(
        execution_id=execution_id,
        tab_id=tab_id,
        user_id=current_user_id,
    )


@router.post(
    "/executions/{execution_id}/stop",
    response_model=ExecutionResponse,
    summary="Stop execution and release browser session",
)
async def stop_execution(
    execution_id: str,
    payload: StopExecutionRequest = StopExecutionRequest(),
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Idempotently halts execution and terminates the browser session cleanly."""
    return await service.stop_execution(
        execution_id=execution_id,
        reason=payload.reason,
        user_id=current_user_id,
    )


# --- Phase 3: Real Venue & Vendor Discovery Endpoints ---


@router.post(
    "/executions/{execution_id}/discover",
    response_model=BrowserDiscoveryResponse,
    summary="Run browser discovery for event venue or vendors",
)
async def discover_candidates(
    execution_id: str,
    payload: BrowserDiscoveryRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db_session),
    discovery_service: BrowserDiscoveryService = Depends(get_browser_discovery_service),
):
    """Executes real browser search and inspection of Google Maps/Search, extracting evidence-backed candidates."""
    return await discovery_service.discover(
        execution_id=execution_id,
        request=payload,
        db=db,
        user_id=current_user_id,
    )


@router.get(
    "/executions/{execution_id}/candidates",
    response_model=List[DiscoveredCandidate],
    summary="Get discovered candidates for an execution",
)
def get_discovered_candidates(
    execution_id: str,
    current_user_id: str = Depends(get_current_user_id),
    agent_service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Returns the evidence-backed candidates discovered during the browser execution."""
    return agent_service.get_candidates(execution_id=execution_id, user_id=current_user_id)


@router.post(
    "/discover",
    response_model=BrowserDiscoveryResponse,
    summary="Start an execution and run venue/vendor discovery in one shot",
)
async def discover_oneshot(
    payload: BrowserDiscoveryRequest,
    current_user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db_session),
    agent_service: BrowserAgentService = Depends(get_browser_agent_service),
    discovery_service: BrowserDiscoveryService = Depends(get_browser_discovery_service),
):
    """Convenience endpoint that starts a browser execution and runs discovery."""
    exec_resp = await agent_service.create_execution(
        event_id=payload.event_id,
        initial_url="https://www.google.com/maps",
        user_id=current_user_id,
    )
    return await discovery_service.discover(
        execution_id=exec_resp.execution_id,
        request=payload,
        db=db,
        user_id=current_user_id,
    )


# --- Live Activity Event Stream (WebSocket & SSE) ---


@router.websocket("/executions/{execution_id}/events")
async def websocket_events(
    websocket: WebSocket,
    execution_id: str,
    last_seq: Optional[int] = Query(None),
    user_id: str = Query("anonymous_operator"),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """WebSocket stream transmitting live execution lifecycle and browser telemetry events."""
    await websocket.accept()

    try:
        async for event in service.subscribe_events(
            execution_id=execution_id,
            user_id=user_id,
            last_seq=last_seq,
        ):
            await websocket.send_text(event.model_dump_json())
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception:
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass


@router.get("/executions/{execution_id}/events/stream", summary="SSE stream of execution events")
async def sse_events(
    execution_id: str,
    last_seq: Optional[int] = Query(None),
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserAgentService = Depends(get_browser_agent_service),
):
    """Server-Sent Events fallback endpoint for browser activity streaming."""
    async def event_generator():
        try:
            async for event in service.subscribe_events(
                execution_id=execution_id,
                user_id=current_user_id,
                last_seq=last_seq,
            ):
                payload = event.model_dump_json()
                yield f"event: {event.event_type}\ndata: {payload}\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
