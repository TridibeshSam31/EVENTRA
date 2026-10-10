"""Tests for EVENTRA Browser Agent Control Layer (Phase 2)."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.browser_agent import (
    AgentEventType,
    ExecutionStatus,
)
from app.services.browser_agent_service import (
    BrowserAgentService,
    get_browser_agent_service,
)
from app.services.browser_runtime_service import (
    BrowserRuntimeService,
    get_browser_runtime_service,
)
from tests.test_browser_runtime import MockBrowserRuntimeService


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_agent_service():
    mock_runtime = MockBrowserRuntimeService()
    agent_svc = BrowserAgentService(runtime_service=mock_runtime)

    app.dependency_overrides[get_browser_agent_service] = lambda: agent_svc
    app.dependency_overrides[get_browser_runtime_service] = lambda: mock_runtime
    yield agent_svc, mock_runtime
    app.dependency_overrides.pop(get_browser_agent_service, None)
    app.dependency_overrides.pop(get_browser_runtime_service, None)


# --- 1. Execution Lifecycle Tests ---


def test_create_and_get_execution(client, mock_agent_service):
    resp = client.post(
        "/api/browser-agent/executions",
        json={"initial_url": "https://example.com", "event_id": "event-101"},
        headers={"x-user-id": "operator-1"},
    )
    assert resp.status_code == 201
    data = resp.json()
    exec_id = data["execution_id"]
    assert exec_id.startswith("exec_")
    assert data["status"] == "running"
    assert data["event_id"] == "event-101"
    assert data["user_id"] == "operator-1"
    assert len(data["tabs"]) == 1
    assert data["current_url"] == "https://example.com"

    # Fetch status snapshot
    resp2 = client.get(
        f"/api/browser-agent/executions/{exec_id}",
        headers={"x-user-id": "operator-1"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["execution_id"] == exec_id
    assert resp2.json()["status"] == "running"


def test_duplicate_start_idempotency(client, mock_agent_service):
    agent_svc, _ = mock_agent_service
    resp1 = client.post(
        "/api/browser-agent/executions",
        json={"execution_id": "exec-fixed-1", "initial_url": "https://example.com"},
        headers={"x-user-id": "operator-1"},
    )
    assert resp1.status_code == 201
    assert resp1.json()["execution_id"] == "exec-fixed-1"

    # Retry same start request returns existing running execution safely
    resp2 = client.post(
        "/api/browser-agent/executions",
        json={"execution_id": "exec-fixed-1", "initial_url": "https://example.com"},
        headers={"x-user-id": "operator-1"},
    )
    assert resp2.status_code == 201
    assert resp2.json()["execution_id"] == "exec-fixed-1"
    assert resp2.json()["status"] == "running"


def test_invalid_execution_id_returns_404(client, mock_agent_service):
    resp = client.get("/api/browser-agent/executions/nonexistent-exec-id")
    assert resp.status_code == 404

    resp_nav = client.post(
        "/api/browser-agent/executions/nonexistent-exec-id/navigate",
        json={"url": "https://example.com"},
    )
    assert resp_nav.status_code == 404

    resp_stop = client.post(
        "/api/browser-agent/executions/nonexistent-exec-id/stop",
        json={"reason": "test"},
    )
    assert resp_stop.status_code == 404


def test_unauthorized_cross_user_access_blocked(client, mock_agent_service):
    # Operator 1 creates execution
    resp = client.post(
        "/api/browser-agent/executions",
        json={"initial_url": "https://example.com"},
        headers={"x-user-id": "operator-alice"},
    )
    exec_id = resp.json()["execution_id"]

    # Operator 2 attempts to navigate it
    resp_tamper = client.post(
        f"/api/browser-agent/executions/{exec_id}/navigate",
        json={"url": "https://hacker.com"},
        headers={"x-user-id": "operator-bob"},
    )
    assert resp_tamper.status_code == 403
    assert "Access denied" in resp_tamper.json()["detail"]


def test_navigation_and_tab_operations_with_events(client, mock_agent_service):
    agent_svc, _ = mock_agent_service

    # Create execution
    resp = client.post(
        "/api/browser-agent/executions",
        json={"initial_url": "https://example.com"},
        headers={"x-user-id": "test-user"},
    )
    exec_id = resp.json()["execution_id"]

    # 1. Navigate active tab
    nav_resp = client.post(
        f"/api/browser-agent/executions/{exec_id}/navigate",
        json={"url": "https://news.ycombinator.com"},
        headers={"x-user-id": "test-user"},
    )
    assert nav_resp.status_code == 200
    assert nav_resp.json()["current_url"] == "https://news.ycombinator.com"

    # Verify event emission in history
    record = agent_svc._executions[exec_id]
    event_types = [e.event_type for e in record.event_history]
    assert AgentEventType.BROWSER_NAVIGATING.value in event_types
    assert AgentEventType.BROWSER_NAVIGATION_COMPLETED.value in event_types

    # 2. Open new tab
    tab_resp = client.post(
        f"/api/browser-agent/executions/{exec_id}/tabs",
        json={"url": "https://github.com"},
        headers={"x-user-id": "test-user"},
    )
    assert tab_resp.status_code == 201
    assert len(tab_resp.json()["tabs"]) == 2
    event_types = [e.event_type for e in record.event_history]
    assert AgentEventType.BROWSER_TAB_OPENED.value in event_types

    # 3. Activate first tab
    act_resp = client.post(
        f"/api/browser-agent/executions/{exec_id}/tabs/tab-1/activate",
        headers={"x-user-id": "test-user"},
    )
    assert act_resp.status_code == 200
    assert act_resp.json()["active_tab_id"] == "tab-1"
    event_types = [e.event_type for e in record.event_history]
    assert AgentEventType.BROWSER_TAB_ACTIVATED.value in event_types


def test_stop_execution_is_clean_and_idempotent(client, mock_agent_service):
    agent_svc, mock_runtime = mock_agent_service

    # Start
    resp = client.post("/api/browser-agent/executions")
    exec_id = resp.json()["execution_id"]
    assert mock_runtime.session_active is True

    # Stop execution
    stop_resp = client.post(
        f"/api/browser-agent/executions/{exec_id}/stop",
        json={"reason": "Task finished"},
    )
    assert stop_resp.status_code == 200
    assert stop_resp.json()["status"] == "cancelled"
    assert mock_runtime.session_active is False

    # Second stop call is idempotent
    stop_resp2 = client.post(
        f"/api/browser-agent/executions/{exec_id}/stop",
        json={"reason": "Already stopped"},
    )
    assert stop_resp2.status_code == 200
    assert stop_resp2.json()["status"] == "cancelled"


def test_invalid_lifecycle_transition_rejected(client, mock_agent_service):
    agent_svc, _ = mock_agent_service

    resp = client.post("/api/browser-agent/executions")
    exec_id = resp.json()["execution_id"]
    record = agent_svc._executions[exec_id]

    # Stop it so it enters terminal CANCELLED state
    client.post(f"/api/browser-agent/executions/{exec_id}/stop")
    assert record.status == ExecutionStatus.CANCELLED

    # Attempting to transition from CANCELLED to RUNNING must fail with 409
    with pytest.raises(HTTPException) as exc_info:
        record.transition_status(ExecutionStatus.RUNNING)
    assert exc_info.value.status_code == 409


def test_websocket_event_streaming_and_reconnection(client, mock_agent_service):
    agent_svc, _ = mock_agent_service

    # 1. Create execution
    resp = client.post("/api/browser-agent/executions")
    exec_id = resp.json()["execution_id"]

    # 2. Connect WebSocket
    with client.websocket_connect(f"/api/browser-agent/executions/{exec_id}/events") as ws:
        # Initial snapshot received immediately on connection
        snapshot = ws.receive_json()
        assert snapshot["event_type"] == AgentEventType.BROWSER_STATE_UPDATED.value
        assert snapshot["execution_id"] == exec_id

        # Perform action via REST while websocket is connected
        client.post(
            f"/api/browser-agent/executions/{exec_id}/navigate",
            json={"url": "https://example.com/live"},
        )

        # Receive navigating and navigation_completed events
        event1 = ws.receive_json()
        assert event1["event_type"] == AgentEventType.BROWSER_NAVIGATING.value

        event2 = ws.receive_json()
        assert event2["event_type"] == AgentEventType.BROWSER_NAVIGATION_COMPLETED.value
        assert event2["seq"] > event1["seq"]

    # 3. Test reconnection with last_seq query param
    with client.websocket_connect(f"/api/browser-agent/executions/{exec_id}/events?last_seq={event1['seq']}") as ws2:
        snapshot = ws2.receive_json()
        assert snapshot["event_type"] == AgentEventType.BROWSER_STATE_UPDATED.value

        # Replayed event following last_seq
        replayed = ws2.receive_json()
        assert replayed["seq"] == event2["seq"]
        assert replayed["event_type"] == AgentEventType.BROWSER_NAVIGATION_COMPLETED.value


def test_runtime_failure_handling(client, mock_agent_service):
    agent_svc, mock_runtime = mock_agent_service

    # Mock runtime start failure
    async def fail_start(*args, **kwargs):
        raise HTTPException(status_code=503, detail="Daemon crashed")

    mock_runtime.start_session = fail_start

    resp = client.post("/api/browser-agent/executions")
    assert resp.status_code == 503
    assert "Daemon crashed" in resp.json()["detail"]


# --- 3. Real Live Container Integration Test ---


def is_live_daemon_reachable() -> bool:
    import httpx

    try:
        with httpx.Client(timeout=1.5) as c:
            r = c.get("http://localhost:9223/health")
            return r.status_code == 200
    except Exception:
        return False


@pytest.mark.skipif(not is_live_daemon_reachable(), reason="Live browser-runtime daemon is not running on localhost:9223")
def test_real_browser_runtime_integration(client):
    """Executes a real end-to-end integration test against the running Chromium container."""
    # 1. Create real execution
    resp = client.post(
        "/api/browser-agent/executions",
        json={"initial_url": "https://example.com", "event_id": "evt-integration-real"},
        headers={"x-user-id": "real-tester"},
    )
    assert resp.status_code == 201
    data = resp.json()
    exec_id = data["execution_id"]
    assert data["status"] == "running"
    assert "example.com" in data["current_url"]

    # 2. Navigate real browser
    nav_resp = client.post(
        f"/api/browser-agent/executions/{exec_id}/navigate",
        json={"url": "https://news.ycombinator.com"},
        headers={"x-user-id": "real-tester"},
    )
    assert nav_resp.status_code == 200
    assert "news.ycombinator.com" in nav_resp.json()["current_url"]
    assert nav_resp.json()["current_title"] == "Hacker News"

    # 3. Open second tab
    tab_resp = client.post(
        f"/api/browser-agent/executions/{exec_id}/tabs",
        json={"url": "https://httpbin.org/html"},
        headers={"x-user-id": "real-tester"},
    )
    assert tab_resp.status_code == 201
    assert len(tab_resp.json()["tabs"]) == 2

    # 4. Stop execution
    stop_resp = client.post(
        f"/api/browser-agent/executions/{exec_id}/stop",
        json={"reason": "Integration test completed"},
        headers={"x-user-id": "real-tester"},
    )
    assert stop_resp.status_code == 200
    assert stop_resp.json()["status"] == "cancelled"
