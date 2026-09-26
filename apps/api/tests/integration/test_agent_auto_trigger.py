"""Integration Test: Autonomous Agent Execution Triggers.

Verifies:
1. Creating an incident auto-triggers EventOperationsAgent.run via background tasks.
2. Enabling manual_mode on an event suppresses automatic agent invocation.
3. Granting an approval auto-resumes the agent with approval_id.
4. Resuming a paused event auto-triggers operational evaluation.
"""
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User
from app.models.event import Event
from app.models.enums import EventState, EventLifecycleState, EventExecutionState, RoleType
from app.models.approval import Approval
from app.models.event_member import EventMember
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.agent.agent import EventOperationsAgent
from app.engines.auth.snapshot import compute_event_state_snapshot


@pytest.fixture
def test_setup(db_session: Session):
    """Sets up an event owner and live event."""
    user = User(name="Ops Lead", email="opslead@eventra.local")
    db_session.add(user)
    db_session.commit()

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = Event(
        owner_id=user.id,
        name="TechCon 2026",
        location="Delhi",
        lifecycle_state=EventLifecycleState.LIVE.value,
        execution_state=EventExecutionState.RUNNING.value,
        state=EventState.NORMAL.value,
        manual_mode=False,
        start_datetime=now + timedelta(hours=2),
        end_datetime=now + timedelta(hours=8),
        total_budget=50000.0,
    )
    db_session.add(event)
    db_session.commit()
    return user, event


def test_incident_creation_auto_triggers_agent(test_client: TestClient, test_setup, db_session: Session, monkeypatch):
    """Creating an incident dispatches EventOperationsAgent.run with event context."""
    user, event = test_setup
    monkeypatch.setattr("app.agent.triggers.SessionLocal", lambda: db_session)

    with patch.object(EventOperationsAgent, "run") as mock_agent_run:
        mock_agent_run.return_value = {
            "run_id": "RUN-TEST",
            "event_id": event.id,
            "status": "COMPLETED",
            "current_phase": "OBSERVE",
        }

        resp = test_client.post(
            f"/api/events/{event.id}/incidents",
            json={
                "title": "Vendor Late Arrival",
                "description": "Catering van delayed by 45 minutes.",
                "incident_type": "VENDOR_DELAY",
                "severity": "MEDIUM",
            },
            headers={"X-User-Id": user.id},
        )

        assert resp.status_code == 201
        assert mock_agent_run.called
        call_kwargs = mock_agent_run.call_args.kwargs
        assert call_kwargs["event_id"] == event.id
        assert "Vendor Late Arrival" in call_kwargs["message"]


def test_manual_mode_suppresses_agent_auto_trigger(test_client: TestClient, test_setup, db_session: Session, monkeypatch):
    """When event.manual_mode is True, incident creation does NOT trigger agent run."""
    user, event = test_setup
    event.manual_mode = True
    db_session.commit()
    monkeypatch.setattr("app.agent.triggers.SessionLocal", lambda: db_session)

    with patch.object(EventOperationsAgent, "run") as mock_agent_run:
        resp = test_client.post(
            f"/api/events/{event.id}/incidents",
            json={
                "title": "Stage Lighting Glitch",
                "description": "Dimmer module non-responsive.",
                "incident_type": "EQUIPMENT_FAILURE",
                "severity": "LOW",
            },
            headers={"X-User-Id": user.id},
        )

        assert resp.status_code == 201
        # Mock agent run must NOT have been called
        assert not mock_agent_run.called


def test_approval_granting_auto_resumes_agent(test_client: TestClient, test_setup, db_session: Session, monkeypatch):
    """Approving an operational request auto-resumes agent into ACT phase with approval_id."""
    user, event = test_setup
    monkeypatch.setattr("app.agent.triggers.SessionLocal", lambda: db_session)

    # Create another user as approver (separation of duties)
    approver = User(name="Manager Approver", email="approver@eventra.local")
    db_session.add(approver)
    db_session.commit()

    # Add approver as MAIN_ORGANIZER to event
    member = EventMember(event_id=event.id, user_id=approver.id, role=RoleType.MAIN_ORGANIZER.value)
    db_session.add(member)

    # Create a vendor and assignment target
    vendor = Vendor(name="Test Caterer", category="catering", city="Delhi", contact_phone="+919999999999")
    db_session.add(vendor)
    db_session.commit()

    assignment = VendorAssignment(
        event_id=event.id,
        vendor_id=vendor.id,
        category="catering",
        status="PENDING",
    )
    db_session.add(assignment)
    db_session.commit()

    # Create a pending approval request
    approval = Approval(
        event_id=event.id,
        requester_id=user.id,
        action_type="PROVIDER_ENGAGEMENT",
        target_type="VENDOR_ASSIGNMENT",
        target_id=assignment.id,
        impact_level="CRITICAL",
        requested_action={"assignment_id": assignment.id},
        status="PENDING",
        state_snapshot=compute_event_state_snapshot(db_session, event.id),
    )
    db_session.add(approval)
    db_session.commit()

    with patch.object(EventOperationsAgent, "run") as mock_agent_run:
        mock_agent_run.return_value = {
            "run_id": "RUN-RESUME",
            "event_id": event.id,
            "status": "COMPLETED",
            "current_phase": "ACT",
        }

        resp = test_client.post(
            f"/api/events/{event.id}/approvals/{approval.id}/approve",
            json={"decision_notes": "Deposit approved for backup caterer"},
            headers={"X-User-Id": approver.id},
        )

        assert resp.status_code == 200
        assert mock_agent_run.called
        call_kwargs = mock_agent_run.call_args.kwargs
        assert call_kwargs["event_id"] == event.id
        assert call_kwargs["approval_id"] == approval.id


def test_resume_event_auto_triggers_agent(test_client: TestClient, test_setup, db_session: Session, monkeypatch):
    """Resuming a paused event auto-triggers operational evaluation."""
    user, event = test_setup
    event.execution_state = EventExecutionState.PAUSED.value
    db_session.commit()
    monkeypatch.setattr("app.agent.triggers.SessionLocal", lambda: db_session)

    with patch.object(EventOperationsAgent, "run") as mock_agent_run:
        mock_agent_run.return_value = {
            "run_id": "RUN-RESUME-EVAL",
            "event_id": event.id,
            "status": "COMPLETED",
            "current_phase": "OBSERVE",
        }

        resp = test_client.post(
            f"/api/events/{event.id}/resume",
            json={"reason": "Operational pause lifted."},
            headers={"X-User-Id": user.id},
        )

        assert resp.status_code == 200
        assert mock_agent_run.called
        call_kwargs = mock_agent_run.call_args.kwargs
        assert call_kwargs["event_id"] == event.id
        assert "Operational execution resumed" in call_kwargs["message"]
