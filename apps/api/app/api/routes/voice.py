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


from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from app.integrations.communication.exotel import ExotelVoiceAdapter
from app.core.config import settings

class InitiateCallRequest(BaseModel):
    recipient_phone: str
    vendor_name: Optional[str] = "Vendor"
    event_id: Optional[str] = "default-event"
    task_id: Optional[str] = None
    provider_id: Optional[str] = None


@router.post("/voice/call")
@router.post("/api/v1/voice/call")
def initiate_voice_call(payload: InitiateCallRequest):
    """Initiates an outbound telephony call to a phone number via Exotel."""
    adapter = ExotelVoiceAdapter()
    result = adapter.make_call(
        event_id=payload.event_id or "default-event",
        provider_id=payload.provider_id or payload.vendor_name or "vendor-1",
        recipient_phone=payload.recipient_phone,
        task_id=payload.task_id or "task-briefing",
    )
    return {
        "success": result.success,
        "source": result.source.value,
        "data": result.data,
        "error": result.error,
    }


class VoiceInteractRequest(BaseModel):
    vendor_name: str
    vendor_service: Optional[str] = "Vendor Service"
    message: str
    history: Optional[List[Dict[str, str]]] = []


@router.post("/voice/interact")
@router.post("/api/v1/voice/interact")
def voice_interact(payload: VoiceInteractRequest):
    """Real-time Gemini voice AI interaction endpoint for live speech & audio transcription."""
    api_key = settings.GEMINI_API_KEY or settings.LLM_API_KEY
    if not api_key:
        return {
            "reply": "Gemini API key is not configured. Please set GEMINI_API_KEY in .env.",
            "success": False
        }
    
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)
        sys_prompt = (
            f"You are the EVENTRA Operations Voice AI calling vendor {payload.vendor_name} ({payload.vendor_service}). "
            "Keep your responses concise (1 to 2 sentences max), highly professional, courteous, in natural telephony spoken style. "
            "Inquire about their arrival ETA, equipment setup status, and check if they need anything at the venue."
        )
        res = client.models.generate_content(
            model=settings.LLM_MODEL or "gemini-3-flash-preview",
            contents=payload.message,
            config=types.GenerateContentConfig(system_instruction=sys_prompt)
        )
        return {
            "reply": res.text.strip(),
            "success": True
        }
    except Exception as e:
        logger.error("Error in voice_interact: %s", e)
        return {
            "reply": f"Acknowledged. We have logged your response: \"{payload.message}\" into the operational event log.",
            "success": False,
            "error": str(e)
        }

