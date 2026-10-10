"""Targeted Tests for EVENTRA Windows Browser Companion (Option A).

Tests secure pairing lifecycle, token verification, WebSocket authentication,
command dispatch, live event forwarding, and discovery orchestration routing.
"""

import asyncio
import json
import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from fastapi import WebSocketDisconnect

from app.main import app
from app.schemas.browser_companion import (
    CompanionCommandType,
    CompanionEventMessage,
    CompanionMessageType,
    CompanionResultMessage,
    PairCompanionRequest,
)
from app.services.browser_companion_service import (
    BrowserCompanionService,
    browser_companion_service,
)
from app.services.browser_discovery_service import BrowserDiscoveryService
from app.schemas.browser_discovery import BrowserDiscoveryRequest


@pytest.fixture
def companion_service():
    """Provides a fresh isolated BrowserCompanionService instance."""
    svc = BrowserCompanionService()
    return svc


def test_pairing_code_generation_and_expiration(companion_service):
    """Test generating a short-lived 6-character pairing code."""
    user_id = "test_operator_123"
    resp = companion_service.create_pairing_code(user_id=user_id, lifetime_seconds=300)

    assert len(resp.pairing_code) == 6
    assert resp.pairing_code.isalnum()
    assert resp.user_id == user_id
    assert resp.expires_in_seconds == 300
    assert resp.expires_at > datetime.now(timezone.utc)


def test_pairing_invalid_code_rejected(companion_service):
    """Test pairing with an invalid or non-existent code raises 401."""
    req = PairCompanionRequest(
        pairing_code="INVALID",
        device_name="Test PC",
    )
    with pytest.raises(Exception) as exc_info:
        companion_service.pair_companion(req)
    assert "401" in str(exc_info.value) or "Invalid or expired" in str(exc_info.value)


def test_pairing_successful_consumption(companion_service):
    """Test successful pairing consumes the code and issues a secure session token."""
    user_id = "test_operator_456"
    code_resp = companion_service.create_pairing_code(user_id=user_id, lifetime_seconds=600)

    req = PairCompanionRequest(
        pairing_code=code_resp.pairing_code,
        device_name="Operator Surface Book",
        companion_version="1.0.0",
        browser_type="msedge",
    )

    pair_resp = companion_service.pair_companion(req)
    assert pair_resp.token.startswith("comp_")
    assert pair_resp.user_id == user_id
    assert pair_resp.ws_url == "/api/browser-companion/ws"

    # Verify code cannot be reused (single-use constraint)
    with pytest.raises(Exception):
        companion_service.pair_companion(req)


def test_verify_token(companion_service):
    """Test token verification returns valid session metadata."""
    code_resp = companion_service.create_pairing_code("user_789")
    pair_resp = companion_service.pair_companion(
        PairCompanionRequest(pairing_code=code_resp.pairing_code, device_name="Workstation-A")
    )

    session = companion_service.verify_token(pair_resp.token)
    assert session is not None
    assert session.user_id == "user_789"
    assert session.device_name == "Workstation-A"

    # Non-existent token returns None
    assert companion_service.verify_token("non_existent_token") is None


def test_companion_status_when_disconnected(companion_service):
    """Test companion status returns is_connected=False when no WebSocket is active."""
    status = companion_service.get_companion_status("user_unconnected")
    assert status.is_connected is False
    assert status.user_id == "user_unconnected"
    assert status.browser_visible is True


@pytest.mark.asyncio
async def test_websocket_pairing_and_command_dispatch(companion_service):
    """Simulate companion WebSocket connection and test command dispatch with correlated result."""
    user_id = "user_simulated"
    code_resp = companion_service.create_pairing_code(user_id)
    pair_resp = companion_service.pair_companion(
        PairCompanionRequest(pairing_code=code_resp.pairing_code, device_name="Simulated-Desktop")
    )
    session = companion_service.verify_token(pair_resp.token)

    # Mock WebSocket connection
    class MockWebSocket:
        def __init__(self):
            self.sent_messages = []
            self.closed = False

        async def send_text(self, text: str):
            self.sent_messages.append(json.loads(text))

        async def close(self, code: int = 1000):
            self.closed = True

    mock_ws = MockWebSocket()
    await companion_service.register_connection(session, mock_ws)

    assert companion_service.is_companion_connected(user_id) is True
    status = companion_service.get_companion_status(user_id)
    assert status.is_connected is True
    assert status.device_name == "Simulated-Desktop"

    # Test sending command to companion
    events_received = []

    def on_event(evt: CompanionEventMessage):
        events_received.append(evt)

    dispatch_task = asyncio.create_task(
        companion_service.send_command(
            user_id=user_id,
            command=CompanionCommandType.START_DISCOVERY,
            payload={"query": "catering in Boston"},
            execution_id="exec_test_1",
            event_callback=on_event,
            timeout_seconds=5.0,
        )
    )

    # Allow dispatch message to send
    await asyncio.sleep(0.05)
    assert len(mock_ws.sent_messages) == 1
    sent_cmd = mock_ws.sent_messages[0]
    assert sent_cmd["command"] == "START_DISCOVERY"
    assert sent_cmd["payload"]["query"] == "catering in Boston"
    correlation_id = sent_cmd["correlation_id"]

    # Companion sends live event
    event_payload = {
        "type": "EVENT",
        "correlation_id": correlation_id,
        "execution_id": "exec_test_1",
        "event_type": "page_opened",
        "message": "Opened Google Maps",
        "data": {"url": "https://www.google.com/maps"},
    }
    await companion_service.handle_companion_message(session, json.dumps(event_payload))
    assert len(events_received) == 1
    assert events_received[0].event_type == "page_opened"

    # Companion sends result message
    result_payload = {
        "type": "RESULT",
        "correlation_id": correlation_id,
        "execution_id": "exec_test_1",
        "success": True,
        "results": [
            {
                "name": "Beacon Hill Catering",
                "address": "123 Charles St, Boston, MA",
                "phone": "+1 617-555-0199",
                "website": "https://beaconhillcatering.example.com",
                "rating": 4.9,
                "review_count": 88,
                "source": "WINDOWS_BROWSER_COMPANION",
            }
        ],
        "metadata": {"current_url": "https://www.google.com/maps"},
    }
    await companion_service.handle_companion_message(session, json.dumps(result_payload))

    result = await dispatch_task
    assert result["success"] is True
    assert len(result["results"]) == 1
    assert result["results"][0]["name"] == "Beacon Hill Catering"

    # Clean up
    await companion_service.unregister_connection(session)
    assert companion_service.is_companion_connected(user_id) is False


@pytest.mark.asyncio
async def test_discovery_service_routes_to_windows_companion():
    """Verify BrowserDiscoveryService uses the Windows Companion when connected."""
    mock_companion_svc = BrowserCompanionService()
    user_id = "test_discovery_user"

    # Pair and connect mock companion
    code_resp = mock_companion_svc.create_pairing_code(user_id)
    pair_resp = mock_companion_svc.pair_companion(
        PairCompanionRequest(pairing_code=code_resp.pairing_code, device_name="Test-Companion")
    )
    session = mock_companion_svc.verify_token(pair_resp.token)

    class AutoRespondingWebSocket:
        def __init__(self, comp_svc, sess):
            self.comp_svc = comp_svc
            self.sess = sess

        async def send_text(self, text: str):
            data = json.loads(text)
            cid = data.get("correlation_id")
            if data.get("command") == "START_DISCOVERY":
                # Send candidate event
                evt = {
                    "type": "EVENT",
                    "correlation_id": cid,
                    "event_type": "candidate_found",
                    "message": "Found venue",
                    "data": {"name": "The Great Boston Hall"},
                }
                asyncio.create_task(self.comp_svc.handle_companion_message(self.sess, json.dumps(evt)))

                # Send result
                res = {
                    "type": "RESULT",
                    "correlation_id": cid,
                    "success": True,
                    "results": [
                        {
                            "name": "The Great Boston Hall",
                            "address": "400 Commonwealth Ave, Boston, MA",
                            "phone": "+1 617-555-0144",
                            "website": "https://greatbostonhall.example.com",
                            "rating": 4.8,
                            "review_count": 120,
                            "source": "WINDOWS_BROWSER_COMPANION",
                        }
                    ],
                    "metadata": {"current_url": "https://www.google.com/maps/place/Great+Hall"},
                }
                asyncio.create_task(self.comp_svc.handle_companion_message(self.sess, json.dumps(res)))

    mock_ws = AutoRespondingWebSocket(mock_companion_svc, session)
    await mock_companion_svc.register_connection(session, mock_ws)

    # Initialize discovery service with companion
    disc_svc = BrowserDiscoveryService(companion_service=mock_companion_svc)

    # Create execution record
    exec_record = await disc_svc.agent_service.create_execution(
        user_id=user_id,
        event_id="college_fest_demo",
        initial_url="https://www.google.com/maps",
    )

    req = BrowserDiscoveryRequest(
        event_id="college_fest_demo",
        category="VENUE",
        max_results=3,
        persist_to_db=False,
    )

    resp = await disc_svc.discover(
        execution_id=exec_record.execution_id,
        request=req,
        user_id=user_id,
    )

    assert resp.total_found >= 1
    assert resp.candidates[0].name == "The Great Boston Hall"
    assert resp.provenance["source"] == "WINDOWS_BROWSER_COMPANION"
    assert resp.provenance["runner"] == "windows_companion"
    assert resp.provenance["browser_visible_on_desktop"] is True

    # Clean up
    await disc_svc.agent_service.stop_execution(exec_record.execution_id, user_id=user_id)
    await mock_companion_svc.unregister_connection(session)
