"""FastAPI Route Handlers for EVENTRA Windows Browser Companion (Option A).

Provides pairing endpoints and the authenticated WebSocket hub for the
local companion running on the operator's Windows desktop.
"""

import asyncio
import logging
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)

from app.api.dependencies import get_current_user_id
from app.schemas.browser_companion import (
    CompanionStatusResponse,
    PairCompanionRequest,
    PairCompanionResponse,
    PairingCodeRequest,
    PairingCodeResponse,
)
from app.services.browser_companion_service import (
    BrowserCompanionService,
    get_browser_companion_service,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/browser-companion",
    tags=["Browser Companion (Option A)"],
)


@router.post(
    "/pairing-code",
    response_model=PairingCodeResponse,
    summary="Generate a short-lived pairing code for Windows Browser Companion",
)
def generate_pairing_code(
    payload: PairingCodeRequest = PairingCodeRequest(),
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserCompanionService = Depends(get_browser_companion_service),
):
    """Generates a secure 6-character code used by the local Windows companion to pair."""
    return service.create_pairing_code(user_id=current_user_id)


@router.post(
    "/pair",
    response_model=PairCompanionResponse,
    summary="Exchange pairing code for a scoped companion session token",
)
def pair_companion(
    payload: PairCompanionRequest,
    service: BrowserCompanionService = Depends(get_browser_companion_service),
):
    """Endpoint invoked by the local Windows companion during enrollment."""
    return service.pair_companion(payload)


@router.get(
    "/status",
    response_model=CompanionStatusResponse,
    summary="Check connection status of the user's Windows Browser Companion",
)
def get_companion_status(
    current_user_id: str = Depends(get_current_user_id),
    service: BrowserCompanionService = Depends(get_browser_companion_service),
):
    """Returns whether the local Windows companion is connected and ready."""
    return service.get_companion_status(user_id=current_user_id)


@router.websocket("/ws")
async def companion_websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(default=None),
    service: BrowserCompanionService = Depends(get_browser_companion_service),
):
    """WebSocket connection hub for the Windows Browser Companion."""
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    session = service.verify_token(token)
    if not session:
        logger.warning("Rejected companion WebSocket connection with invalid token")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()
    await service.register_connection(session, websocket)

    try:
        while True:
            # Receive inbound messages from companion (heartbeats, events, results)
            message_text = await websocket.receive_text()
            await service.handle_companion_message(session, message_text)
    except WebSocketDisconnect:
        logger.info("Companion WebSocket disconnected for user %s", session.user_id)
    except Exception as e:
        logger.warning("Error in companion WebSocket loop for user %s: %s", session.user_id, e)
    finally:
        await service.unregister_connection(session)
