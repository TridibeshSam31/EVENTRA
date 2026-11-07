"""Vendor message -> operational signal -> incident detection/correlation."""
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.models.event import Event
from app.models.incident import Incident
from app.models.task import Task
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.services.vendor_signal_service import VendorSignalService, interpret_vendor_message

OWNER = "owner-signal"


@pytest.mark.parametrize(
    "text,outcome,minutes",
    [
        ("Sorry, we have to cancel tomorrow's booking", "CANCELLED", None),
        ("Bhaiya hum nahi aa payenge kal", "CANCELLED", None),
        ("Running late by 30 minutes due to traffic", "DELAY_REPORTED", 30),
        ("1 ghante der ho jayegi", "DELAY_REPORTED", 60),
        ("We are running late", "DELAY_REPORTED", None),
        ("We will reach in 20 min", "ETA_UPDATED", 20),
        ("Reached the venue, setting up", "ARRIVED", None),
        ("hmm ok let me see", "UNCLASSIFIED", None),
        ("What time should we come?", "NEEDS_INFO", None),
    ],
)
def test_interpretation(text, outcome, minutes):
    signal = interpret_vendor_message(text)
    assert signal.outcome == outcome
    if outcome == "DELAY_REPORTED":
        assert signal.delay_minutes == minutes
        assert signal.certain is (minutes is not None)
    if outcome == "ETA_UPDATED":
        assert signal.eta_minutes == minutes
    if outcome == "UNCLASSIFIED":
        assert signal.certain is False


def test_quote_and_availability_come_from_extracted_facts():
    assert interpret_vendor_message("can do it", {"available": True}).outcome == "AVAILABILITY_CONFIRMED"
    quote = interpret_vendor_message("8000 rupees", {"quote": 8000})
    assert quote.outcome == "QUOTE_RECEIVED" and quote.quoted_price == 8000


@pytest.fixture
def world(db_session):
    db_session.add(User(id=OWNER, name="Owner", email="owner-signal@example.com"))
    event = Event(id="evt-signal-1", owner_id=OWNER, name="Signal Test", location="Delhi",
                  start_datetime=datetime(2026, 10, 30, 18, 0))
    vendor = Vendor(id="vendor-signal-1", name="Sharma Caterers", category="CATERING", city="Delhi",
                    contact_phone="9000000002")
    db_session.add_all([event, vendor])
    db_session.flush()
    task = Task(id="task-signal-1", event_id=event.id, name="Food service", status="ASSIGNED",
                provider_id=vendor.id, is_critical_path=True, slack_minutes=15)
    assignment = VendorAssignment(id="asg-signal-1", event_id=event.id, vendor_id=vendor.id,
                                  category="CATERING", status="CONFIRMED")
    db_session.add_all([task, assignment])
    db_session.commit()
    return SimpleNamespace(event=event, vendor=vendor, task=task, assignment=assignment)


def _process(db, world, text, message_id=None):
    return VendorSignalService(db).process(
        event_id=world.event.id, vendor=world.vendor, assignment=world.assignment,
        text=text, extracted_facts={}, provider_message_id=message_id,
    )


def _incidents(db, world):
    return db.query(Incident).filter(Incident.event_id == world.event.id).all()


def test_cancellation_raises_one_incident_and_repeats_correlate(db_session, world):
    first = _process(db_session, world, "Sorry, we have to cancel")
    assert first["incident"]["action"] == "CREATED"
    assert first["linked_task_id"] == world.task.id

    second = _process(db_session, world, "Confirming again, we cancel the order")
    assert second["incident"]["action"] == "UPDATED"
    assert second["incident"]["id"] == first["incident"]["id"]

    incidents = _incidents(db_session, world)
    assert len(incidents) == 1
    inc = incidents[0]
    assert inc.incident_type == "VENDOR_CANCELLATION"
    assert inc.related_task_id == world.task.id
    assert len(inc.evidence_metadata["signals"]) == 2


def test_delay_within_slack_is_a_warning_not_an_incident(db_session, world):
    result = _process(db_session, world, "Running late by 10 minutes")
    assert result["incident"] is None
    assert "slack" in result["assessment"]
    assert _incidents(db_session, world) == []


def test_delay_beyond_slack_raises_delay_incident(db_session, world):
    result = _process(db_session, world, "Running late by 45 minutes")
    assert result["incident"]["action"] == "CREATED"
    assert _incidents(db_session, world)[0].incident_type == "VENDOR_DELAY"


def test_delay_without_duration_never_guesses(db_session, world):
    result = _process(db_session, world, "we are running late")
    assert result["incident"] is None
    assert result["signal"]["certain"] is False


def test_decline_before_commitment_without_task_is_not_an_incident(db_session, world):
    world.assignment.status = "REQUESTED"
    world.task.provider_id = None
    db_session.commit()
    result = _process(db_session, world, "Sorry, not available on that date")
    assert result["signal"]["outcome"] == "DECLINED"
    assert result["incident"] is None


def test_duplicate_provider_message_is_claimed_once(db_session):
    service = VendorSignalService(db_session)
    payload = {"sender": "919000000002@c.us", "text": "cancel"}
    assert service.claim_message("wamid-1", payload) is True
    service.complete_message("wamid-1", {"status": "PROCESSED"})
    assert service.claim_message("wamid-1", payload) is False
    assert service.claim_message(None, payload) is True  # no id: cannot dedupe, process


def test_webhook_retry_does_not_duplicate_incident(test_client, db_session, world, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "OPENWA_WEBHOOK_SECRET", None, raising=False)
    monkeypatch.setattr(settings, "ENVIRONMENT", "development", raising=False)
    payload = {
        "event": "onMessage",
        "data": {"id": "false_919000000002@c.us_RETRY1", "from": "919000000002@c.us", "body": "Sorry, we have to cancel"},
    }
    first = test_client.post("/api/webhooks/openwa", json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "PROCESSED", first.json()
    assert first.json()["operational_signal"]["incident"]["action"] == "CREATED"

    retry = test_client.post("/api/webhooks/openwa", json=payload)
    assert retry.status_code == 200
    assert retry.json()["status"] == "DUPLICATE"
    assert len(_incidents(db_session, world)) == 1


def test_operational_summary_reflects_incident_and_keeps_states_apart(test_client, db_session, world):
    headers = {"x-user-id": OWNER}
    base = f"/api/events/{world.event.id}/operations/summary"

    calm = test_client.get(base, headers=headers)
    assert calm.status_code == 200, calm.text
    body = calm.json()
    assert body["status"] == "ON_TRACK"
    assert body["issues"] == []
    vendor = next(v for v in body["vendors"] if v["vendor_id"] == world.vendor.id)
    # Commitment comes from the assignment record; communication was never attempted.
    assert vendor["commitment"] == "CONFIRMED"
    assert vendor["whatsapp"] == "NOT_ATTEMPTED"

    _process(db_session, world, "Sorry, we have to cancel")
    hot = test_client.get(base, headers=headers).json()
    assert hot["status"] in ("CRITICAL", "AT_RISK")
    assert hot["status_reasons"]
    incident_issues = [i for i in hot["issues"] if i["kind"] == "INCIDENT"]
    assert len(incident_issues) == 1
    # The task covered by the incident is not listed again as a separate issue.
    assert not [i for i in hot["issues"] if i["kind"] == "TASK" and i["task_id"] == world.task.id]
    assert hot["next_action"]["href"].endswith(f"incidentId={incident_issues[0]['id']}")


def test_operational_summary_is_event_scoped(test_client, db_session, world):
    db_session.add(User(id="stranger-1", name="Stranger", email="stranger-1@example.com"))
    db_session.commit()
    res = test_client.get(f"/api/events/{world.event.id}/operations/summary", headers={"x-user-id": "stranger-1"})
    assert res.status_code == 403
