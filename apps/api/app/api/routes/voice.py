"""Exotel Voice WebSocket Routes (Task 2).

Exposes WebSocket streaming endpoint for Exotel Connect Voice AI / AgentStream:
- /api/v1/voice/exotel/stream
- /voice/exotel/stream
"""
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.integrations.communication.exotel_gateway import voice_gateway
from app.integrations.communication.gemini_bridge import create_gemini_bridge_factory

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Voice"])

# Register default Gemini Live bridge listener factory
if not voice_gateway._listener_factory:
    voice_gateway.register_listener_factory(create_gemini_bridge_factory())


@router.websocket("/voice/exotel/stream")
@router.websocket("/api/v1/voice/exotel/stream")
async def exotel_voice_stream(websocket: WebSocket):
    """Bidirectional WebSocket endpoint for Exotel AgentStream audio streaming."""
    logger.info("Exotel voice stream WebSocket connection initiated.")
    try:
        await voice_gateway.handle_connection(websocket)
    except WebSocketDisconnect:
        logger.info("Exotel voice stream client disconnected normally.")
    except Exception as exc:
        logger.error("Unhandled error in Exotel voice stream endpoint: %s", exc)
