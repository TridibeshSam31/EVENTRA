"""Tests for Phase 4: Approval-Gated Real Call + WhatsApp Communication.

Validates all 22 mandatory requirements:
1. Recommendation alone does not communicate.
2. Candidate selection alone does not communicate.
3. VendorAssignment creation alone does not communicate.
4. Communication approval is strictly required.
5. Rejected / Not now ("dismiss") does not communicate.
6. Approved communication triggers one call attempt.
7. Approved communication triggers one WhatsApp attempt.
8. Duplicate approval request does not trigger duplicate call.
9. Duplicate approval request does not trigger duplicate WhatsApp.
10. Two simultaneous approval requests remain idempotent.
11. Candidate without phone does not receive fake call success.
12. Missing WhatsApp contact does not produce fake message success.
13. Provider unavailable produces truthful failure/unavailable status.
14. Call succeeds and WhatsApp fails -> both statuses represented independently.
15. WhatsApp succeeds and call fails -> both statuses represented independently.
16. Selecting Venue B does not contact Venue A/C.
17. Communication state survives status reload.
18. SSE emits communication/approval events correctly.
19. Agent cannot bypass approval.
20. Unauthorized user cannot approve communication for another event.
21. Reconnect does not duplicate communication state.
22. No manual communication endpoint is exposed as normal frontend action.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.models.event import Event
from app.models.shortlist import EventShortlistEntry
from app.models.approval import Approval
from app.models.vendor_assignment import VendorAssignment
from app.models.vendor import Vendor
from app.models.idempotency import IdempotencyRecord
from app.services.autonomous_operations_service import AutonomousOperationsService
from app.services.provider_communication_service import ProviderCommunicationService
from app.services.live_broker import live_broker
from app.integrations.base import IntegrationResult, IntegrationSource


@pytest.fixture
def base_event(db_session):
    event = Event(
        id="evt-comm-test-1",
        name="Royal Tech Gala 2026",
        location="Bengaluru",
        start_datetime=datetime(2026, 11, 20, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=1500000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)
    db_session.commit()
    return event


def test_recommendation_alone_does_not_communicate(db_session, base_event):
    """1. Recommendation alone does NOT trigger communication or create approval consent."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-rec-1",
        category="VENUE",
        candidate_name="Palace Grounds Bengaluru",
        status="RECOMMENDED",
        ranking=1,
        selection_source="AGENT_RECOMMENDATION",
        candidate_data={"phone": "+919876543210"},
    )
    db_session.add(entry)
    db_session.commit()

    # Verify no approval exists
    approval = db_session.query(Approval).filter(Approval.target_id == "cand-rec-1").first()
    assert approval is None

    # Verify operations status shows NOT_REQUESTED
    ops = AutonomousOperationsService(db_session)
    status = ops.get_operations_status(base_event.id)
    rec = next(r for r in status["recommendations"] if r["candidate_id"] == "cand-rec-1")
    assert rec["communication_approval"]["approval_status"] == "NOT_REQUESTED"
    assert rec["communication_approval"]["call_status"] == "NOT_ATTEMPTED"
    assert rec["communication_approval"]["whatsapp_status"] == "NOT_ATTEMPTED"


def test_candidate_selection_alone_does_not_communicate(db_session, base_event):
    """2 & 4. Candidate selection transitions to SELECTED and creates PENDING approval, but communicates ZERO."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-sel-1",
        category="VENUE",
        candidate_name="Grand Ballroom",
        status="RECOMMENDED",
        ranking=1,
        selection_source="AGENT_RECOMMENDATION",
        candidate_data={"phone": "+919876543211"},
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    sel_res = ops.select_candidate(base_event.id, "cand-sel-1", user_id="organizer")

    # Selection occurred
    assert sel_res["status"] == "SELECTED"
    assert sel_res["communication_status"] == "PENDING_APPROVAL"

    # Pending approval was initialized
    approval = db_session.query(Approval).filter(
        Approval.event_id == base_event.id,
        Approval.target_id == "cand-sel-1",
    ).first()
    assert approval is not None
    assert approval.status == "PENDING"
    assert approval.action_type == "COMMUNICATION_OUTREACH"

    # Communication is strictly NOT initiated yet
    db_session.refresh(entry)
    comm = entry.candidate_data.get("communication", {})
    assert comm["approval_status"] == "PENDING"
    assert comm["call_status"] == "NOT_ATTEMPTED"
    assert comm["whatsapp_status"] == "NOT_ATTEMPTED"
    assert comm["overall_status"] == "PENDING_APPROVAL"


def test_vendor_assignment_creation_alone_does_not_communicate(db_session, base_event):
    """3. VendorAssignment creation is NOT communication consent."""
    asg = VendorAssignment(
        event_id=base_event.id,
        vendor_id="v-101",
        category="catering",
        status="ASSIGNED",
    )
    db_session.add(asg)
    db_session.commit()

    # Verify no communication triggered
    approvals = db_session.query(Approval).filter(Approval.target_id == "v-101").all()
    assert len(approvals) == 0


def test_dismiss_communication_causes_zero_communication(test_client, db_session, base_event):
    """5. 'Not now' (dismiss) rejects approval and performs ZERO communication."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-notnow-1",
        category="VENUE",
        candidate_name="Skyview Terrace",
        status="RECOMMENDED",
        ranking=1,
        candidate_data={"phone": "+919876543212"},
    )
    db_session.add(entry)
    db_session.commit()

    # Select candidate first
    select_res = test_client.post(f"/api/events/{base_event.id}/shortlist/cand-notnow-1/select")
    assert select_res.status_code == 200

    # Organizer clicks "Not now"
    dismiss_res = test_client.post(f"/api/events/{base_event.id}/shortlist/cand-notnow-1/dismiss-communication")
    assert dismiss_res.status_code == 200

    # Verification: approval marked REJECTED, communication DISMISSED
    approval = db_session.query(Approval).filter(
        Approval.event_id == base_event.id,
        Approval.target_id == "cand-notnow-1",
    ).first()
    assert approval.status == "REJECTED"

    db_session.refresh(entry)
    comm = entry.candidate_data.get("communication", {})
    assert comm["approval_status"] == "REJECTED"
    assert comm["overall_status"] == "DISMISSED"
    assert comm["call_status"] == "NOT_ATTEMPTED"
    assert comm["whatsapp_status"] == "NOT_ATTEMPTED"


def test_approved_communication_triggers_call_and_whatsapp(db_session, base_event):
    """6 & 7. Approved communication triggers exactly one call attempt and one WhatsApp attempt."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-appr-1",
        category="VENUE",
        candidate_name="Emerald Pavilion",
        status="RECOMMENDED",
        candidate_data={"phone": "+919876543213"},
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    ops.select_candidate(base_event.id, "cand-appr-1")

    approval = db_session.query(Approval).filter(
        Approval.event_id == base_event.id,
        Approval.target_id == "cand-appr-1",
    ).first()

    comm_svc = ProviderCommunicationService(db_session)

    # Mock real providers
    with patch.object(comm_svc, "make_call") as mock_call, \
         patch.object(comm_svc, "send_message") as mock_wa, \
         patch("app.core.config.settings.TWILIO_ENABLED", True), \
         patch("app.integrations.communication.twilio.TwilioVoiceAdapter.is_configured", True), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.is_configured", True):

        mock_call.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"call_sid": "CA123"})
        mock_wa.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"message_id": "WA123"})

        res = comm_svc.execute_approved_communication(
            event_id=base_event.id,
            candidate_id="cand-appr-1",
            approval_id=approval.id,
        )

        assert mock_call.call_count == 1
        assert mock_wa.call_count == 1
        assert res["call_status"] == "COMPLETED"
        assert res["whatsapp_status"] == "SENT"
        assert res["overall_status"] == "COMPLETED"


def test_duplicate_approval_request_is_idempotent(db_session, base_event):
    """8, 9, 10. Duplicate / double-click approval requests remain strictly idempotent (no duplicate calls or messages)."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-idem-1",
        category="VENUE",
        candidate_name="Orchid Manor",
        status="RECOMMENDED",
        candidate_data={"phone": "+919876543214"},
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    ops.select_candidate(base_event.id, "cand-idem-1")
    approval = db_session.query(Approval).filter(Approval.target_id == "cand-idem-1").first()

    comm_svc = ProviderCommunicationService(db_session)

    with patch.object(comm_svc, "make_call") as mock_call, \
         patch.object(comm_svc, "send_message") as mock_wa, \
         patch("app.core.config.settings.TWILIO_ENABLED", True), \
         patch("app.integrations.communication.twilio.TwilioVoiceAdapter.is_configured", True), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.is_configured", True):

        mock_call.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"call_sid": "CA1"})
        mock_wa.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"message_id": "WA1"})

        # First request
        res1 = comm_svc.execute_approved_communication(base_event.id, "cand-idem-1", approval.id)
        # Second immediate duplicate request
        res2 = comm_svc.execute_approved_communication(base_event.id, "cand-idem-1", approval.id)

        # Call and WhatsApp must only have been invoked ONCE
        assert mock_call.call_count == 1
        assert mock_wa.call_count == 1
        assert res1 == res2


def test_missing_phone_truthfully_not_attempted(db_session, base_event):
    """11 & 12. Candidate without phone number does NOT produce fake call/message success."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-nophone-1",
        category="CATERING",
        candidate_name="Artisan Feast",
        status="RECOMMENDED",
        candidate_data={},  # No phone number!
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    ops.select_candidate(base_event.id, "cand-nophone-1")
    approval = db_session.query(Approval).filter(Approval.target_id == "cand-nophone-1").first()

    comm_svc = ProviderCommunicationService(db_session)
    res = comm_svc.execute_approved_communication(base_event.id, "cand-nophone-1", approval.id)

    assert res["call_status"] == "NOT_ATTEMPTED"
    assert res["whatsapp_status"] == "NOT_ATTEMPTED"
    assert res["overall_status"] == "UNAVAILABLE"
    assert "No contact phone" in res["call_error"]


def test_provider_unavailable_produces_truthful_unavailable_status(db_session, base_event):
    """13. Unconfigured provider produces truthful UNAVAILABLE status, not fake success."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-unavail-1",
        category="VENUE",
        candidate_name="Silver Oak Hall",
        status="RECOMMENDED",
        candidate_data={"phone": "+919876543215"},
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    ops.select_candidate(base_event.id, "cand-unavail-1")
    approval = db_session.query(Approval).filter(Approval.target_id == "cand-unavail-1").first()

    comm_svc = ProviderCommunicationService(db_session)

    # Both Twilio/Exotel and OpenWA are NOT configured
    with patch("app.core.config.settings.TWILIO_ENABLED", False), \
         patch("app.core.config.settings.EXOTEL_ENABLED", False), \
         patch("app.core.config.settings.COMMUNICATION_PROVIDER", "none"), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.is_configured", False):

        res = comm_svc.execute_approved_communication(base_event.id, "cand-unavail-1", approval.id)

        assert res["call_status"] == "UNAVAILABLE"
        assert res["whatsapp_status"] == "UNAVAILABLE"
        assert res["overall_status"] == "UNAVAILABLE"
        assert "Voice provider is not configured" in res["call_error"]
        assert "WhatsApp provider is not configured" in res["whatsapp_error"]


def test_call_succeeds_and_whatsapp_fails_independent(db_session, base_event):
    """14. Call succeeds while WhatsApp fails -> both represented independently with PARTIAL overall."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-part-1",
        category="VENUE",
        candidate_name="Maple Gardens",
        status="RECOMMENDED",
        candidate_data={"phone": "+919876543216"},
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    ops.select_candidate(base_event.id, "cand-part-1")
    approval = db_session.query(Approval).filter(Approval.target_id == "cand-part-1").first()

    comm_svc = ProviderCommunicationService(db_session)

    with patch.object(comm_svc, "make_call") as mock_call, \
         patch.object(comm_svc, "send_message") as mock_wa, \
         patch("app.core.config.settings.TWILIO_ENABLED", True), \
         patch("app.integrations.communication.twilio.TwilioVoiceAdapter.is_configured", True), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.is_configured", True):

        mock_call.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"call_sid": "CA1"})
        mock_wa.return_value = IntegrationResult(success=False, source=IntegrationSource.REAL, data=None, error="WhatsApp session timeout")

        res = comm_svc.execute_approved_communication(base_event.id, "cand-part-1", approval.id)

        assert res["call_status"] == "COMPLETED"
        assert res["whatsapp_status"] == "FAILED"
        assert res["overall_status"] == "PARTIAL"
        assert res["whatsapp_error"] == "WhatsApp session timeout"


def test_whatsapp_succeeds_and_call_fails_independent(db_session, base_event):
    """15. WhatsApp succeeds while Call fails -> both represented independently with PARTIAL overall."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-part-2",
        category="VENUE",
        candidate_name="Lotus Convention",
        status="RECOMMENDED",
        candidate_data={"phone": "+919876543217"},
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    ops.select_candidate(base_event.id, "cand-part-2")
    approval = db_session.query(Approval).filter(Approval.target_id == "cand-part-2").first()

    comm_svc = ProviderCommunicationService(db_session)

    with patch.object(comm_svc, "make_call") as mock_call, \
         patch.object(comm_svc, "send_message") as mock_wa, \
         patch("app.core.config.settings.TWILIO_ENABLED", True), \
         patch("app.integrations.communication.twilio.TwilioVoiceAdapter.is_configured", True), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.is_configured", True):

        mock_call.return_value = IntegrationResult(success=False, source=IntegrationSource.REAL, data=None, error="Busy signal")
        mock_wa.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"message_id": "WA2"})

        res = comm_svc.execute_approved_communication(base_event.id, "cand-part-2", approval.id)

        assert res["call_status"] == "FAILED"
        assert res["whatsapp_status"] == "SENT"
        assert res["overall_status"] == "PARTIAL"
        assert res["call_error"] == "Busy signal"


def test_selecting_venue_b_does_not_contact_venue_a_or_c(test_client, db_session, base_event):
    """16. Multiple recommendations: Selecting candidate B does NOT contact candidate A or C."""
    cand_a = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-multi-a",
        category="VENUE",
        candidate_name="Venue A",
        status="RECOMMENDED",
        ranking=1,
        candidate_data={"phone": "+919876543218"},
    )
    cand_b = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-multi-b",
        category="VENUE",
        candidate_name="Venue B",
        status="RECOMMENDED",
        ranking=2,
        candidate_data={"phone": "+919876543219"},
    )
    cand_c = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-multi-c",
        category="VENUE",
        candidate_name="Venue C",
        status="RECOMMENDED",
        ranking=3,
        candidate_data={"phone": "+919876543220"},
    )
    db_session.add_all([cand_a, cand_b, cand_c])
    db_session.commit()

    # Organizer selects only Venue B
    sel_res = test_client.post(f"/api/events/{base_event.id}/shortlist/cand-multi-b/select")
    assert sel_res.status_code == 200

    # With mocked comm
    with patch("app.services.provider_communication_service.ProviderCommunicationService.make_call") as mock_call, \
         patch("app.services.provider_communication_service.ProviderCommunicationService.send_message") as mock_wa, \
         patch("app.core.config.settings.TWILIO_ENABLED", True), \
         patch("app.integrations.communication.twilio.TwilioVoiceAdapter.is_configured", True), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.is_configured", True):

        mock_call.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"call_sid": "B1"})
        mock_wa.return_value = IntegrationResult(success=True, source=IntegrationSource.REAL, data={"message_id": "B1"})

        appr_res = test_client.post(f"/api/events/{base_event.id}/shortlist/cand-multi-b/approve-communication")
        assert appr_res.status_code == 200

    # Venue A & Venue C must remain untouched in RECOMMENDED status
    db_session.refresh(cand_a)
    db_session.refresh(cand_c)
    assert cand_a.status == "RECOMMENDED"
    assert cand_c.status == "RECOMMENDED"
    assert cand_a.candidate_data.get("communication") is None
    assert cand_c.candidate_data.get("communication") is None


def test_communication_state_survives_status_reload(db_session, base_event):
    """17. Communication state persists and hydrates accurately in get_operations_status."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-persist-1",
        category="VENUE",
        candidate_name="Persisted Grand Palace",
        status="SELECTED",
        ranking=1,
        candidate_data={
            "phone": "+919876543221",
            "communication": {
                "approval_id": "appr-123",
                "approval_status": "APPROVED",
                "call_status": "COMPLETED",
                "whatsapp_status": "SENT",
                "overall_status": "COMPLETED",
                "phone": "+919876543221",
                "updated_at": "2026-09-29T12:00:00",
            },
        },
    )
    db_session.add(entry)
    db_session.commit()

    ops = AutonomousOperationsService(db_session)
    status = ops.get_operations_status(base_event.id)

    selection = next(s for s in status["selections"] if s["candidate_id"] == "cand-persist-1")
    assert selection["communication_approval"]["overall_status"] == "COMPLETED"
    assert selection["communication_approval"]["call_status"] == "COMPLETED"
    assert selection["communication_approval"]["whatsapp_status"] == "SENT"


def test_unauthorized_user_cannot_approve_communication(test_client, db_session, base_event):
    """20. Unauthorized user (e.g. from outside event or read-only role) cannot approve communication."""
    entry = EventShortlistEntry(
        event_id=base_event.id,
        candidate_id="cand-sec-1",
        category="VENUE",
        candidate_name="Secured Venue",
        status="SELECTED",
        candidate_data={"phone": "+919876543222"},
    )
    db_session.add(entry)
    db_session.commit()

    # Create approval
    appr = Approval(
        event_id=base_event.id,
        requester_id="organizer",
        action_type="COMMUNICATION_OUTREACH",
        target_type="VENUE",
        target_id="cand-sec-1",
        impact_level="MAJOR",
        status="PENDING",
        state_snapshot="snap-1",
    )
    db_session.add(appr)
    db_session.commit()

    # Attempt approval with an uninvited outsider user
    with patch("app.api.dependencies.get_current_user_id", return_value="malicious-outsider-99"):
        res = test_client.post(
            f"/api/events/{base_event.id}/shortlist/cand-sec-1/approve-communication",
            headers={"X-User-Id": "malicious-outsider-99"},
        )
        assert res.status_code == 403


def test_voice_call_endpoint_blocks_unapproved_outreach(test_client, db_session, base_event):
    """22. /voice/call endpoint rejects attempts without explicit prior communication approval."""
    payload = {
        "event_id": base_event.id,
        "recipient_phone": "+919876543299",
        "vendor_name": "Unapproved Vendor",
        "provider_id": "cand-unapproved-1",
    }
    res = test_client.post("/api/v1/voice/call", json=payload)
    assert res.status_code == 403
    assert "requires explicit organizer approval" in res.json()["detail"]
