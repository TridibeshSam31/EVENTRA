"""Unit tests for Phase 12: Real-World Integrations layer."""
from datetime import datetime, timezone
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.integrations.base import IntegrationSource
from app.integrations.registry import registry
from app.integrations.maps.mock import MockMapsProvider
from app.integrations.maps.http_maps import HTTPMapsProvider
from app.integrations.venues.discovery import ExternalVenueAdapter
from app.integrations.communication.mock import MockCommunicationProvider
from app.integrations.whatsapp.client import WhatsAppAdapter
from app.integrations.notifications.providers import InAppNotificationProvider, MockNotificationProvider
from app.services.notification_service import NotificationService
from app.services.provider_communication_service import ProviderCommunicationService
from app.models.event import Event
from app.models.user import User
from app.models.notification import Notification
from app.models.audit import AuditRecord
from app.models.enums import EventLifecycleState, EventState


# ---------------------------------------------------------------------------
# 1. Configuration & Registry Secret Masking Tests
# ---------------------------------------------------------------------------

def test_integration_registry_status_masks_secrets():
    """Verify registry status returns configured adapters and strictly masks secrets."""
    status = registry.get_status()
    assert "maps" in status
    assert "notifications" in status
    assert "communication" in status
    assert "llm" in status
    assert "whatsapp_enabled" in status["communication"]

    # Ensure no raw secrets are present anywhere in the status dict
    status_str = str(status)
    if settings.MAPS_API_KEY:
        assert settings.MAPS_API_KEY not in status_str
    if settings.WHATSAPP_API_TOKEN:
        assert settings.WHATSAPP_API_TOKEN not in status_str
    if settings.LLM_API_KEY:
        assert settings.LLM_API_KEY not in status_str
    assert "is_configured" in status["maps"]
    assert "is_configured" in status["notifications"]
    assert "is_configured" in status["communication"]
    assert "is_configured" in status["llm"]


# ---------------------------------------------------------------------------
# 2. Maps Provider Tests
# ---------------------------------------------------------------------------

def test_mock_maps_provider_distance_and_route():
    """Verify MockMapsProvider returns deterministic distance, duration, and route summary."""
    provider = MockMapsProvider()
    origin = "100 N LaSalle St, Chicago, IL"
    destination = "200 E Randolph St, Chicago, IL"

    # Distance
    dist_res = provider.get_distance(origin, destination)
    assert dist_res.success is True
    assert dist_res.source == IntegrationSource.MOCK
    assert dist_res.data["distance_km"] > 0
    assert dist_res.data["duration_minutes"] > 0
    assert dist_res.data["origin"] == origin
    assert dist_res.data["destination"] == destination

    # Coordinate-based distance
    coord_res = provider.get_distance([41.8827, -87.6324], [41.8853, -87.6215])
    assert coord_res.success is True
    assert coord_res.data["distance_km"] > 0

    # Geocoding
    geo_res = provider.geocode(origin)
    assert geo_res.success is True
    assert geo_res.source == IntegrationSource.MOCK
    assert "latitude" in geo_res.data
    assert "longitude" in geo_res.data
    assert "Mock Geo" in geo_res.data["formatted_address"]

    # Route summary
    route_res = provider.get_route(origin, destination)
    assert route_res.success is True
    assert "route_summary" in route_res.data
    assert route_res.data["steps_count"] > 0


def test_http_maps_provider_fallback_to_mock():
    """Verify HTTPMapsProvider safely falls back to mock without raising unhandled errors."""
    provider = HTTPMapsProvider(api_key="dummy_key", timeout_seconds=1.0)
    res = provider.get_distance("Origin A", "Destination B")
    assert res.success is True
    assert res.data["distance_km"] >= 0
    assert res.data["duration_minutes"] >= 0


# ---------------------------------------------------------------------------
# 3. External Directory Adapters Tests
# ---------------------------------------------------------------------------

def test_external_venue_adapter_search_and_normalize():
    """Verify ExternalVenueAdapter searches and normalizes venue payloads into EVENTRA schema."""
    adapter = ExternalVenueAdapter()
    result = adapter.search_venues(query="Metropolitan", city="Chicago", min_capacity=300)
    assert result.success is True
    venues = result.data
    assert len(venues) > 0
    venue = venues[0]
    assert "name" in venue
    assert "capacity" in venue
    assert venue["capacity"] >= 300
    assert venue["city"] == "Chicago"
    assert "amenities" in venue
    assert venue.get("source") == "EXTERNAL_CATALOG"



# ---------------------------------------------------------------------------
# 4. Communication & WhatsApp Adapter Tests
# ---------------------------------------------------------------------------

def test_mock_communication_provider():
    """Verify MockCommunicationProvider send, get messages, and receive inbound."""
    provider = MockCommunicationProvider()
    event_id = "evt-test-123"
    provider_id = "vnd-test-456"
    recipient = "+13125550199"

    # Send message
    send_res = provider.send_message(
        event_id=event_id,
        provider_id=provider_id,
        message="Urgent: Please confirm catering dispatch",
        recipient_contact=recipient,
    )
    assert send_res.success is True
    assert send_res.source == IntegrationSource.MOCK
    assert send_res.data["recipient_contact"] == recipient
    assert send_res.data["status"] == "SENT"

    # Get conversation history
    msgs = provider.get_messages(event_id=event_id, provider_id=provider_id)
    assert len(msgs) == 1
    assert msgs[0]["message"] == "Urgent: Please confirm catering dispatch"

    # Inbound message
    inbound_res = provider.receive_inbound({
        "event_id": event_id,
        "provider_id": provider_id,
        "text": "Confirmed, team is en route",
        "id": "msg-inbound-01",
    })
    assert inbound_res.success is True
    assert inbound_res.data["message"] == "Confirmed, team is en route"

    # History should now include inbound message
    msgs_updated = provider.get_messages(event_id=event_id)
    assert len(msgs_updated) == 2


def test_whatsapp_adapter_webhook_verification_and_mock_fallback():
    """Verify WhatsAppAdapter webhook verification and safe mock fallback."""
    adapter = WhatsAppAdapter(
        phone_number_id="test_phone_id",
        api_token=None,  # Unset credentials trigger safe fallback
        verify_token="eventra_verify_secret",
    )

    # Valid challenge verification
    assert adapter.verify_webhook_token(
        mode="subscribe",
        token="eventra_verify_secret",
    ) is True

    # Invalid challenge verification
    assert adapter.verify_webhook_token(
        mode="subscribe",
        token="wrong_secret",
    ) is False

    # Normalizing inbound WhatsApp webhook payload
    meta_payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "messages": [
                                {
                                    "from": "+13125550199",
                                    "id": "wamid.HBgLMTE=",
                                    "text": {"body": "Driver will arrive in 20 minutes"},
                                }
                            ]
                        }
                    }
                ]
            }
        ]
    }
    inbound = adapter.receive_inbound(meta_payload)
    assert inbound.success is True
    assert inbound.data["sender"] == "+13125550199"
    assert inbound.data["message"] == "Driver will arrive in 20 minutes"

    # Send message (mock mode fallback)
    send_res = adapter.send_message("evt-123", "vnd-456", "Notification from EVENTRA", "+13125550199")
    assert send_res.success is True
    assert send_res.source == IntegrationSource.MOCK


# ---------------------------------------------------------------------------
# 5. Notification Service & Event Invariant Tests
# ---------------------------------------------------------------------------

def test_notification_service_dispatches_and_preserves_event_state(db_session: Session):
    """Verify NotificationService persists notifications, audits actions, and NEVER mutates event state."""
    # Setup test event
    user = User(name="Ops Lead", email="ops.lead@eventra.test")
    db_session.add(user)
    db_session.flush()

    event = Event(
        owner_id=user.id,
        name="Tech Innovation Expo",
        lifecycle_state=EventLifecycleState.LIVE.value,
        state=EventState.NORMAL.value,
        total_budget=Decimal("50000.00"),
    )
    db_session.add(event)
    db_session.commit()

    service = NotificationService(db_session)

    # Dispatch notification
    result = service.send_notification(
        event_id=event.id,
        notification_type="APPROVAL_REQUIRED",
        title="Action Approval Required",
        message="Please review candidate recovery plan for catering replacement.",
        channel="IN_APP",
        recipient=user.email,
        payload={"action_type": "REPLACE_VENDOR", "cost": 4500.0},
        actor_id=user.id,
    )
    assert result.success is True
    notif_id = result.data.get("id")
    assert notif_id is not None

    # CRITICAL INVARIANT: Event state and budget must remain unchanged!
    db_session.refresh(event)
    assert event.state == EventState.NORMAL.value
    assert event.lifecycle_state == EventLifecycleState.LIVE.value
    assert event.total_budget == Decimal("50000.00")

    # Verify notification persisted in database
    persisted = db_session.query(Notification).filter_by(event_id=event.id).all()
    assert len(persisted) == 1
    assert persisted[0].title == "Action Approval Required"

    # Verify audit record was created
    audits = db_session.query(AuditRecord).filter_by(event_id=event.id, action="NOTIFICATION_SENT").all()
    assert len(audits) == 1
    assert audits[0].target_id == notif_id


def test_provider_communication_service_records_audit(db_session: Session):
    """Verify ProviderCommunicationService records communication and audits without leaking keys."""
    user = User(name="Dispatcher", email="dispatcher@eventra.test")
    db_session.add(user)
    db_session.flush()

    event = Event(
        owner_id=user.id,
        name="Concert Summit",
        lifecycle_state=EventLifecycleState.LIVE.value,
        state=EventState.NORMAL.value,
        total_budget=Decimal("30000.00"),
    )
    db_session.add(event)
    db_session.commit()

    service = ProviderCommunicationService(db_session)

    result = service.send_message(
        event_id=event.id,
        provider_id="vendor-456",
        recipient_contact="+13125559876",
        message="Arrival check-in request for Stage 1",
        actor_id=user.id,
    )
    assert result.success is True
    assert result.data["recipient_contact"] == "+13125559876"

    # Audit record check
    audits = db_session.query(AuditRecord).filter_by(event_id=event.id, action="PROVIDER_MESSAGE_SENT").all()
    assert len(audits) == 1
    assert audits[0].target_id == "vendor-456"


# ---------------------------------------------------------------------------
# 6. REST API Endpoints Tests
# ---------------------------------------------------------------------------

def test_api_integration_status(client: TestClient):
    """Verify GET /api/integrations/status endpoint."""
    res = client.get("/api/integrations/status")
    assert res.status_code == 200
    data = res.json()
    assert "maps" in data
    assert "notifications" in data
    assert "communication" in data
    assert "llm" in data


def test_api_maps_distance_and_geocode(client: TestClient):
    """Verify POST /api/integrations/maps/distance and geocode endpoints."""
    # Distance
    res_dist = client.post(
        "/api/integrations/maps/distance",
        json={
            "origin": "100 N LaSalle St, Chicago, IL",
            "destination": "200 E Randolph St, Chicago, IL",
        },
    )
    assert res_dist.status_code == 200
    data = res_dist.json()
    assert data["success"] is True
    assert data["source"] in ("MOCK", "HTTP")
    assert data["data"]["distance_km"] >= 0

    # Geocode
    res_geo = client.post(
        "/api/integrations/maps/geocode",
        json={"address": "100 N LaSalle St, Chicago, IL"},
    )
    assert res_geo.status_code == 200
    data_geo = res_geo.json()
    assert data_geo["success"] is True
    assert "latitude" in data_geo["data"]
    assert "longitude" in data_geo["data"]


def test_api_whatsapp_webhook(client: TestClient):
    """Verify GET /api/integrations/whatsapp/webhook and POST receiving."""
    # Verification GET
    res = client.get(
        "/api/integrations/whatsapp/webhook",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "eventra_verify_secret",
            "hub.challenge": "987654321",
        },
    )
    assert res.status_code == 200
    assert res.text == "987654321"

    # Inbound message POST
    res_post = client.post(
        "/api/integrations/whatsapp/webhook",
        json={"entry": [{"changes": [{"value": {"messages": [{"from": "+13125550199", "text": {"body": "Here"}}]}}]}]},
    )
    assert res_post.status_code == 200
    data_post = res_post.json()
    assert data_post["status"] == "PROCESSED"
