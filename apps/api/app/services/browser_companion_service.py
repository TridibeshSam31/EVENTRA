"""Service Foundation for EVENTRA Windows Browser Companion (Option A).

Coordinates secure pairing, authenticated WebSocket sessions, command dispatch,
and event forwarding for the locally running Windows Chromium/Chrome browser.
"""

import asyncio
import json
import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional

from fastapi import HTTPException, WebSocket, status

from app.schemas.browser_companion import (
    CompanionCommandMessage,
    CompanionCommandType,
    CompanionEventMessage,
    CompanionMessageType,
    CompanionResultMessage,
    CompanionStatusResponse,
    PairCompanionRequest,
    PairCompanionResponse,
    PairingCodeResponse,
)

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PairingRecord:
    def __init__(self, code: str, user_id: str, expires_at: datetime):
        self.code = code
        self.user_id = user_id
        self.expires_at = expires_at
        self.is_used = False


class CompanionSession:
    def __init__(
        self,
        token: str,
        user_id: str,
        device_name: str,
        companion_version: str,
        browser_type: str,
    ):
        self.token = token
        self.user_id = user_id
        self.device_name = device_name
        self.companion_version = companion_version
        self.browser_type = browser_type
        self.created_at = utc_now()
        self.websocket: Optional[WebSocket] = None
        self.connected_at: Optional[datetime] = None
        self.last_heartbeat_at: Optional[datetime] = None
        self.active_execution_id: Optional[str] = None


class BrowserCompanionService:
    """Manages pairing, connections, and command routing for Windows Browser Companions."""

    _instance: Optional["BrowserCompanionService"] = None

    def __init__(self):
        # Pairing codes: code -> PairingRecord
        self._pairing_codes: Dict[str, PairingRecord] = {}
        # Active companion tokens: token -> CompanionSession
        self._tokens: Dict[str, CompanionSession] = {}
        # Active sessions by user: user_id -> CompanionSession
        self._user_sessions: Dict[str, CompanionSession] = {}
        # Pending correlation requests: correlation_id -> asyncio.Future
        self._pending_commands: Dict[str, asyncio.Future] = {}
        # Registered event listeners: correlation_id -> callback(event_message)
        self._event_listeners: Dict[str, Callable[[CompanionEventMessage], None]] = {}

    @classmethod
    def get_instance(cls) -> "BrowserCompanionService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    # -------------------------------------------------------------------------
    # Pairing Lifecycle
    # -------------------------------------------------------------------------

    def create_pairing_code(self, user_id: str, lifetime_seconds: int = 600) -> PairingCodeResponse:
        """Generates a secure, short-lived 6-character pairing code for an authenticated user."""
        # Clean expired codes
        now = utc_now()
        self._pairing_codes = {k: v for k, v in self._pairing_codes.items() if v.expires_at > now and not v.is_used}

        # Generate readable 6-character alphanumeric code avoiding ambiguous chars (0, O, 1, I)
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        code = "".join(secrets.choice(alphabet) for _ in range(6))

        expires_at = now + timedelta(seconds=lifetime_seconds)
        record = PairingRecord(code=code, user_id=user_id, expires_at=expires_at)
        self._pairing_codes[code] = record

        logger.info("Generated companion pairing code '%s' for user '%s' (expires in %ds)", code, user_id, lifetime_seconds)

        return PairingCodeResponse(
            pairing_code=code,
            user_id=user_id,
            expires_at=expires_at,
            expires_in_seconds=lifetime_seconds,
        )

    def pair_companion(self, request: PairCompanionRequest) -> PairCompanionResponse:
        """Validates pairing code sent by the local companion and returns a scoped session token."""
        code = request.pairing_code.strip().upper()
        record = self._pairing_codes.get(code)
        now = utc_now()

        if not record or record.is_used or record.expires_at <= now:
            logger.warning("Invalid or expired pairing code attempted: '%s'", code)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired pairing code. Please generate a new code in the EVENTRA dashboard.",
            )

        # Mark code as consumed
        record.is_used = True

        # Generate cryptographically secure token
        token = f"comp_{secrets.token_urlsafe(32)}"
        session = CompanionSession(
            token=token,
            user_id=record.user_id,
            device_name=request.device_name or "Windows Desktop Companion",
            companion_version=request.companion_version or "1.0.0",
            browser_type=request.browser_type or "chromium",
        )

        self._tokens[token] = session
        self._user_sessions[record.user_id] = session

        logger.info(
            "Companion paired successfully for user '%s' on device '%s'",
            record.user_id,
            session.device_name,
        )

        return PairCompanionResponse(
            token=token,
            user_id=record.user_id,
            ws_url="/api/browser-companion/ws",
            expires_at=now + timedelta(days=7),
        )

    def verify_token(self, token: str) -> Optional[CompanionSession]:
        """Validates companion session token."""
        return self._tokens.get(token)

    # -------------------------------------------------------------------------
    # WebSocket Connection Management
    # -------------------------------------------------------------------------

    async def register_connection(self, session: CompanionSession, websocket: WebSocket) -> None:
        """Binds an active WebSocket to the companion session."""
        session.websocket = websocket
        session.connected_at = utc_now()
        session.last_heartbeat_at = utc_now()
        self._user_sessions[session.user_id] = session
        logger.info(
            "Windows Browser Companion connected via WebSocket for user '%s' (%s)",
            session.user_id,
            session.device_name,
        )

    async def unregister_connection(self, session: CompanionSession) -> None:
        """Cleans up a disconnected companion session."""
        if session.websocket:
            session.websocket = None
        session.active_execution_id = None
        logger.info("Windows Browser Companion disconnected for user '%s'", session.user_id)

    def is_companion_connected(self, user_id: str) -> bool:
        """Checks if the user has an active, connected local Windows companion."""
        session = self._user_sessions.get(user_id)
        return bool(session and session.websocket is not None)

    def get_companion_status(self, user_id: str) -> CompanionStatusResponse:
        """Returns the current connection state of the user's Windows Companion."""
        session = self._user_sessions.get(user_id)
        if not session or not session.websocket:
            return CompanionStatusResponse(
                is_connected=False,
                user_id=user_id,
                browser_visible=True,
            )

        return CompanionStatusResponse(
            is_connected=True,
            user_id=user_id,
            device_name=session.device_name,
            companion_version=session.companion_version,
            connected_at=session.connected_at,
            last_heartbeat_at=session.last_heartbeat_at,
            browser_visible=True,
            active_execution_id=session.active_execution_id,
        )

    # -------------------------------------------------------------------------
    # Inbound Message Processing
    # -------------------------------------------------------------------------

    async def handle_companion_message(self, session: CompanionSession, message_text: str) -> None:
        """Processes an incoming JSON message from the Windows Companion."""
        try:
            data = json.loads(message_text)
        except Exception as e:
            logger.warning("Unparseable message from companion for user %s: %s", session.user_id, e)
            return

        msg_type = data.get("type")
        correlation_id = data.get("correlation_id")

        if msg_type == CompanionMessageType.PONG.value:
            session.last_heartbeat_at = utc_now()
            return

        if msg_type == CompanionMessageType.EVENT.value:
            # Forward event to registered listener if one exists
            event_msg = CompanionEventMessage(**data)
            if correlation_id and correlation_id in self._event_listeners:
                try:
                    self._event_listeners[correlation_id](event_msg)
                except Exception as e:
                    logger.debug("Error in event listener callback: %s", e)
            return

        if msg_type in (CompanionMessageType.RESULT.value, CompanionMessageType.ERROR.value):
            if correlation_id and correlation_id in self._pending_commands:
                future = self._pending_commands[correlation_id]
                if not future.done():
                    future.set_result(data)
            return

    # -------------------------------------------------------------------------
    # Command Dispatch & Control
    # -------------------------------------------------------------------------

    async def send_command(
        self,
        user_id: str,
        command: CompanionCommandType,
        payload: Optional[Dict[str, Any]] = None,
        execution_id: Optional[str] = None,
        event_callback: Optional[Callable[[CompanionEventMessage], None]] = None,
        timeout_seconds: float = 60.0,
    ) -> Dict[str, Any]:
        """Dispatches a schema-validated browser command to the user's Windows Companion."""
        session = self._user_sessions.get(user_id)
        if not session or not session.websocket:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Windows Browser Companion is not connected. Please start the companion to run desktop browser tasks.",
            )

        correlation_id = f"cmd_{secrets.token_hex(8)}"
        cmd_msg = CompanionCommandMessage(
            command=command,
            correlation_id=correlation_id,
            execution_id=execution_id,
            payload=payload or {},
        )

        future = asyncio.get_running_loop().create_future()
        self._pending_commands[correlation_id] = future

        if event_callback:
            self._event_listeners[correlation_id] = event_callback

        session.active_execution_id = execution_id

        try:
            await session.websocket.send_text(cmd_msg.model_dump_json())
            logger.info("Sent %s command to companion for user '%s' (cid=%s)", command.value, user_id, correlation_id)
            result = await asyncio.wait_for(future, timeout=timeout_seconds)
            return result
        except asyncio.TimeoutError:
            logger.error("Companion timed out responding to command %s (cid=%s)", command.value, correlation_id)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"Windows Browser Companion timed out executing {command.value}.",
            )
        finally:
            self._pending_commands.pop(correlation_id, None)
            self._event_listeners.pop(correlation_id, None)
            if session.active_execution_id == execution_id:
                session.active_execution_id = None

    async def cancel_execution(self, user_id: str, execution_id: str) -> None:
        """Sends a cancellation signal to the user's companion to immediately abort actions."""
        session = self._user_sessions.get(user_id)
        if session and session.websocket:
            try:
                cmd_msg = CompanionCommandMessage(
                    command=CompanionCommandType.CANCEL,
                    correlation_id=f"cancel_{secrets.token_hex(4)}",
                    execution_id=execution_id,
                    payload={"reason": "User cancelled execution"},
                )
                await session.websocket.send_text(cmd_msg.model_dump_json())
                logger.info("Dispatched CANCEL to companion for execution %s", execution_id)
            except Exception as e:
                logger.warning("Failed to dispatch cancel to companion: %s", e)


browser_companion_service = BrowserCompanionService.get_instance()


def get_browser_companion_service() -> BrowserCompanionService:
    return browser_companion_service
