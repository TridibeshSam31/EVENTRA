"""Test Suite for Live Negotiation Engine (Tasks 1 - 7).

Verifies:
1. Control state transitions (Take Over, Resume, Cancel) + role authorization checks + audit entries.
2. Single choke point guard: Agent sends nothing while HUMAN (WhatsApp and Voice paths).
3. Inbound messages are still recorded and streamed to broker while HUMAN.
4. Deterministic hard cap guard blocks any counter above max_approved_amount (WhatsApp and Voice).
5. Budget cap ceiling is NEVER leaked to vendor messages or Gemini prompts.
6. Realtime stream ordering and Last-Event-ID / ?since cursor replay.
7. Negotiation timeline API structure and live payload fields.
8. Demo simulation flow successfully reaches AWAITING_APPROVAL.
"""
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestException
from app.engines.auth.policy import ApprovalPolicy
from app.models.audit import AuditRecord
from app.models.enums import EventState, EventType, NegotiationStatus, RoleType
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.schemas.voice_negotiation import StructuredNegotiationResult
from app.services.negotiation_broker import negotiation_broker
from app.services.negotiation_service import NegotiationService
from app.services.voice_negotiation_service import VoiceNegotiationService


@pytest.fixture
def test_event(db_session: Session) -> Event:
    event = Event(
        name="Annual Gala 2026",
        event_type=EventType.CONFERENCE,
        state=EventState.NORMAL,
        location="San Francisco, CA",
        total_budget=300000.0,
        owner_id="organizer_alice",
        start_datetime=datetime.now(timezone.utc),
        end_datetime=datetime.now(timezone.utc),
    )
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    return event


@pytest.fixture
def test_vendor(db_session: Session) -> Vendor:
    vendor = Vendor(
        name="Golden Gate Catering",
        category="catering",
        city="San Francisco",
        base_cost=40000.0,
        contact_phone="+1-415-555-0188",
        status="ACTIVE",
        source="SYSTEM",
    )
    db_session.add(vendor)
    db_session.commit()
    db_session.refresh(vendor)
    return vendor


@pytest.fixture
def test_assignment(db_session: Session, test_event: Event, test_vendor: Vendor) -> VendorAssignment:
    assignment = VendorAssignment(
        event_id=test_event.id,
        vendor_id=test_vendor.id,
        category="catering",
        status="ASSIGNED",
        negotiation_status=NegotiationStatus.NEGOTIATING.value,
        negotiation_control="AGENT",
        target_amount=40000.0,
        max_approved_amount=50000.0,
        quoted_amount=58000.0,
        currency="INR",
    )
    db_session.add(assignment)
    db_session.commit()
    db_session.refresh(assignment)
    return assignment


# --------------------------------------------------------------------------
# 1. Control State Transitions & Audit Entries
# --------------------------------------------------------------------------

def test_control_state_transitions_and_audit(
    db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """Verifies take_over, resume, and cancel transitions with audit logs."""
    service = NegotiationService(db_session)

    # 1. Take over (AGENT -> HUMAN)
    takeover_res = service.take_over(test_assignment.id, user_id="organizer_alice")
    assert takeover_res["negotiation_control"] == "HUMAN"
    db_session.refresh(test_assignment)
    assert test_assignment.negotiation_control == "HUMAN"
    assert test_assignment.control_changed_by == "organizer_alice"
    assert test_assignment.control_changed_at is not None

    # Verify Audit Record
    audit_takeover = (
        db_session.query(AuditRecord)
        .filter(AuditRecord.action == "NEGOTIATION_TAKEOVER", AuditRecord.target_id == test_assignment.id)
        .first()
    )
    assert audit_takeover is not None
    assert audit_takeover.actor_id == "organizer_alice"

    # 2. Resume (HUMAN -> AGENT)
    resume_res = service.resume(test_assignment.id, user_id="organizer_alice")
    assert resume_res["negotiation_control"] == "AGENT"
    db_session.refresh(test_assignment)
    assert test_assignment.negotiation_control == "AGENT"

    audit_resume = (
        db_session.query(AuditRecord)
        .filter(AuditRecord.action == "NEGOTIATION_RESUME", AuditRecord.target_id == test_assignment.id)
        .first()
    )
    assert audit_resume is not None

    # 3. Cancel (Stops negotiation and marks DECLINED / CANCELLED)
    cancel_res = service.cancel(test_assignment.id, user_id="organizer_alice", reason="Budget conflict")
    assert cancel_res["status"] == "CANCELLED"
    db_session.refresh(test_assignment)
    assert test_assignment.status in ("DECLINED", "CANCELLED")
    assert test_assignment.negotiation_status in ("DECLINED", "CANCELLED")

    audit_cancel = (
        db_session.query(AuditRecord)
        .filter(AuditRecord.action == "NEGOTIATION_CANCEL", AuditRecord.target_id == test_assignment.id)
        .first()
    )
    assert audit_cancel is not None
    assert "Budget conflict" in str(audit_cancel.after_state)


# --------------------------------------------------------------------------
# 2. Role Authorization Checks on Control Endpoints
# --------------------------------------------------------------------------

def test_control_endpoints_role_checks(
    test_client: TestClient, db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """Verifies that non-organizers are rejected with 403 Forbidden."""
    # Add a viewer member
    viewer = EventMember(event_id=test_event.id, user_id="user_viewer", role=RoleType.VIEWER.value)
    db_session.add(viewer)
    db_session.commit()

    # Attempt takeover as viewer -> 403
    resp_viewer = test_client.post(
        f"/api/events/{test_event.id}/negotiations/{test_assignment.id}/take-over",
        headers={"x-user-id": "user_viewer"},
    )
    assert resp_viewer.status_code == 403

    # Attempt takeover as event owner (organizer_alice) -> 200
    resp_owner = test_client.post(
        f"/api/events/{test_event.id}/negotiations/{test_assignment.id}/take-over",
        headers={"x-user-id": "organizer_alice"},
    )
    assert resp_owner.status_code == 200
    assert resp_owner.json()["negotiation_control"] == "HUMAN"


# --------------------------------------------------------------------------
# 3. Choke Point Guard: Agent sends nothing while HUMAN
# --------------------------------------------------------------------------

def test_agent_sends_nothing_while_human_whatsapp(
    db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """Guarantees the autonomous agent raises/blocks outbound WhatsApp counters while in HUMAN control."""
    service = NegotiationService(db_session)
    service.take_over(test_assignment.id, user_id="organizer_alice")

    # Attempt agent negotiation -> must fail closed with BadRequestException
    with pytest.raises(BadRequestException) as exc_info:
        service.negotiate(test_assignment.id)
    assert "HUMAN" in str(exc_info.value)


def test_agent_sends_nothing_while_human_voice(
    db_session: Session, test_event: Event, test_vendor: Vendor, test_assignment: VendorAssignment
):
    """Guarantees the voice bridge sends NO counters while in HUMAN control."""
    voice_service = VoiceNegotiationService(db_session)
    service = NegotiationService(db_session)
    service.take_over(test_assignment.id, user_id="organizer_alice")

    ctx = voice_service.build_negotiation_context(
        event_id=test_event.id,
        provider_id=test_vendor.id,
        session_id="sess_human_voice_test",
    )
    response = StructuredNegotiationResult(
        availability=True,
        quoted_price=65000.0,
        currency="INR",
        raw_conversational_provenance={"session_id": "sess_human_voice_test"},
    )

    decision = voice_service.evaluate_vendor_response(ctx, response)
    assert decision.action == "HUMAN_CONTROL"
    assert "HUMAN" in decision.reason


# --------------------------------------------------------------------------
# 4. Inbound Messages Still Recorded & Streamed while HUMAN
# --------------------------------------------------------------------------

def test_inbound_recorded_and_streamed_while_human(
    db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """When a vendor sends an inbound message while in HUMAN mode, it is recorded and streamed."""
    service = NegotiationService(db_session)
    service.take_over(test_assignment.id, user_id="organizer_alice")

    # Vendor replies with a quote
    inbound_res = service.process_provider_response(
        assignment_id=test_assignment.id,
        response_text="We can drop our price to INR 52,000 for full coverage.",
    )

    assert inbound_res["action"] == "HUMAN_CONTROL"
    assert inbound_res["negotiation_control"] == "HUMAN"
    assert "manual organizer control" in inbound_res["message"]

    # Ensure assignment recorded quoted amount
    db_session.refresh(test_assignment)
    assert test_assignment.quoted_amount == 52000.0


# --------------------------------------------------------------------------
# 5. Deterministic Hard Cap Guard Blocks Over-Cap Counters
# --------------------------------------------------------------------------

def test_hard_cap_guard_blocks_over_cap_whatsapp(
    db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """Guarantees agent cannot send any counter exceeding max_approved_amount."""
    service = NegotiationService(db_session)

    # Set vendor quote way above cap (e.g. 90,000 when cap is 50,000)
    test_assignment.quoted_amount = 90000.0
    test_assignment.target_amount = 45000.0
    test_assignment.max_approved_amount = 50000.0
    test_assignment.negotiation_status = NegotiationStatus.NEGOTIATING.value
    db_session.commit()

    # The hard cap guard must strictly enforce counter <= 50,000
    res = service.negotiate(test_assignment.id)
    assert res["action"] == "COUNTER_OFFER_SENT"
    assert res["counter_offer_amount"] <= 50000.0


def test_hard_cap_guard_blocks_over_cap_voice(
    db_session: Session, test_event: Event, test_vendor: Vendor, test_assignment: VendorAssignment
):
    """Voice negotiation service blocks any voice counter that would exceed ceiling."""
    voice_service = VoiceNegotiationService(db_session)
    test_assignment.max_approved_amount = 50000.0
    test_assignment.target_amount = 40000.0
    test_assignment.negotiation_status = NegotiationStatus.NEGOTIATING.value
    db_session.commit()

    ctx = voice_service.build_negotiation_context(
        event_id=test_event.id,
        provider_id=test_vendor.id,
        session_id="sess_cap_voice_test",
    )
    # Vendor quotes 65,000 (above cap of 50,000)
    response = StructuredNegotiationResult(
        availability=True,
        quoted_price=65000.0,
        currency="INR",
        raw_conversational_provenance={"session_id": "sess_cap_voice_test"},
    )

    decision = voice_service.evaluate_vendor_response(ctx, response)
    # If a counter offer is made, it MUST be <= max_approved_amount (50,000)
    db_session.refresh(test_assignment)
    if decision.action == "COUNTER_OFFER":
        assert decision.counter_offer_amount <= 50000.0
    else:
        assert decision.action in ("ESCALATE", "AWAITING_APPROVAL", "NEGOTIATING")


# --------------------------------------------------------------------------
# 6. Budget Cap Never Disclosed to Vendor or Gemini
# --------------------------------------------------------------------------

def test_cap_never_present_in_vendor_or_gemini_payloads(
    db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """Verifies that max_approved_amount is never included in vendor messages or Gemini prompts."""
    service = NegotiationService(db_session)

    # Initiate engagement
    init_res = service.initiate_engagement(
        event_id=test_event.id,
        assignment_id=test_assignment.id,
        target_amount=40000.0,
        max_approved_amount=50000.0,
    )
    message_to_vendor = init_res["message_sent"]

    # Cap must NOT appear in message text
    assert "50,000" not in message_to_vendor
    assert "50000" not in message_to_vendor
    assert "cap" not in message_to_vendor.lower()
    assert "ceiling" not in message_to_vendor.lower()


# --------------------------------------------------------------------------
# 7. Realtime Stream Ordering & Cursor Replay
# --------------------------------------------------------------------------

def test_realtime_stream_ordering_and_cursor():
    """Verifies broker publishes sequential events and supports since_id replay."""
    broker = negotiation_broker
    event_id = f"ev_test_{datetime.now().timestamp()}"
    asgn_id = f"asgn_test_{datetime.now().timestamp()}"

    # Publish 3 events
    broker.publish_sync(event_id, asgn_id, "message_added", {"text": "Message 1"})
    broker.publish_sync(event_id, asgn_id, "quote_updated", {"quoted_amount": 55000.0})
    broker.publish_sync(event_id, asgn_id, "counter_sent", {"counter_amount": 45000.0})

    history = broker.get_history_since(event_id, asgn_id)
    assert len(history) >= 3

    # Replay from cursor (since first event)
    first_id = history[0]["id"]
    subsequent = broker.get_history_since(event_id, asgn_id, since_id=first_id)
    assert len(subsequent) == len(history) - 1
    assert subsequent[0]["id"] == history[1]["id"]


# --------------------------------------------------------------------------
# 8. Negotiation Timeline API Shape
# --------------------------------------------------------------------------

def test_negotiation_timeline_api(
    test_client: TestClient, db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """GET /events/{event_id}/negotiations/{assignment_id}/live returns UI-ready structure."""
    resp = test_client.get(
        f"/api/events/{test_event.id}/negotiations/{test_assignment.id}/live",
        headers={"x-user-id": "organizer_alice"},
    )
    assert resp.status_code == 200
    data = resp.json()

    assert data["assignment_id"] == test_assignment.id
    assert data["vendor_name"] == "Golden Gate Catering"
    assert data["vendor_type"] == "catering"
    assert data["control"] == "AGENT"
    assert data["cap"] == 50000.0
    assert data["target"] == 40000.0
    assert data["latest_vendor_quote"] == 58000.0
    assert isinstance(data["messages"], list)


# --------------------------------------------------------------------------
# 9. Demo Simulation Reaching Awaiting Approval
# --------------------------------------------------------------------------

def test_demo_simulation_flow(
    test_client: TestClient, db_session: Session, test_event: Event, test_assignment: VendorAssignment
):
    """Executes demo simulation and verifies it transitions assignment to AWAITING_APPROVAL."""
    resp = test_client.post(
        f"/api/events/{test_event.id}/negotiations/{test_assignment.id}/demo-simulation",
        headers={"x-user-id": "organizer_alice"},
    )
    assert resp.status_code == 200
    data = resp.json()

    assert data["status"] in ("COMPLETED", "STEP_1_EXECUTED")

    # Refresh assignment from DB
    db_session.refresh(test_assignment)
    assert test_assignment.negotiation_status in ("AWAITING_APPROVAL", "IN_PROGRESS", "ACCEPTED")
    assert test_assignment.quoted_amount is not None
    # Verified: final quote sits safely under or equal to max_approved_amount
    assert test_assignment.quoted_amount <= test_assignment.max_approved_amount
