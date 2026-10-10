"""Schemas for EVENTRA Windows Browser Companion (Option A).

Defines secure pairing, authentication tokens, command-control messages,
and runtime status contracts between EVENTRA and the local Windows Companion.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class CompanionCommandType(str, Enum):
    START_DISCOVERY = "START_DISCOVERY"
    NAVIGATE = "NAVIGATE"
    OPEN_TAB = "OPEN_TAB"
    SWITCH_TAB = "SWITCH_TAB"
    INSPECT_URL = "INSPECT_URL"
    STOP_SESSION = "STOP_SESSION"
    CANCEL = "CANCEL"
    PING = "PING"


class CompanionMessageType(str, Enum):
    COMMAND = "COMMAND"
    EVENT = "EVENT"
    RESULT = "RESULT"
    ERROR = "ERROR"
    PONG = "PONG"
    STATUS = "STATUS"


class PairingCodeRequest(BaseModel):
    """Request to generate a short-lived pairing code for the authenticated user."""
    label: Optional[str] = Field(default="Windows Desktop", description="Device label")


class PairingCodeResponse(BaseModel):
    """Short-lived pairing code returned to the authenticated web user."""
    pairing_code: str = Field(..., description="6-character alphanumeric pairing code")
    user_id: str
    expires_at: datetime
    expires_in_seconds: int = 600
    instructions: str = "Run 'tools\\windows-companion\\run-companion.ps1' on your Windows machine with this code."


class PairCompanionRequest(BaseModel):
    """Request sent by the local Windows Companion to pair with EVENTRA."""
    pairing_code: str = Field(..., description="Pairing code entered by the operator")
    device_name: Optional[str] = Field(default="Windows Desktop Companion")
    companion_version: Optional[str] = Field(default="1.0.0")
    browser_type: Optional[str] = Field(default="chromium")


class PairCompanionResponse(BaseModel):
    """Response returned upon successful pairing containing a scoped auth token."""
    token: str = Field(..., description="Scoped companion authentication token")
    user_id: str
    ws_url: str = Field(..., description="WebSocket URL for outbound connection")
    expires_at: datetime


class CompanionStatusResponse(BaseModel):
    """Current connection state of the Windows Browser Companion."""
    is_connected: bool
    user_id: str
    device_name: Optional[str] = None
    companion_version: Optional[str] = None
    connected_at: Optional[datetime] = None
    last_heartbeat_at: Optional[datetime] = None
    browser_visible: bool = True
    active_execution_id: Optional[str] = None


class CompanionCommandMessage(BaseModel):
    """Message sent from EVENTRA backend to the local Windows Companion."""
    type: CompanionMessageType = CompanionMessageType.COMMAND
    command: CompanionCommandType
    correlation_id: str
    execution_id: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=utc_now)


class CompanionEventMessage(BaseModel):
    """Message sent from Windows Companion to EVENTRA reporting live activity."""
    type: CompanionMessageType = CompanionMessageType.EVENT
    correlation_id: Optional[str] = None
    execution_id: Optional[str] = None
    event_type: str
    message: str
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=utc_now)


class CompanionResultMessage(BaseModel):
    """Message sent from Windows Companion with execution output."""
    type: CompanionMessageType = CompanionMessageType.RESULT
    correlation_id: str
    execution_id: Optional[str] = None
    success: bool = True
    results: List[Dict[str, Any]] = Field(default_factory=list)
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=utc_now)
