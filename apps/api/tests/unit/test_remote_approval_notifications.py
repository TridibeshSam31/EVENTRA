"""Comprehensive Test Suite for Remote Approval Notifications (Tasks 1 - 7)."""
import os
import json
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from app.models.event import Event
from app.models.user import User
from app.models.event_member import EventMember
from app.models.approval import Approval
from app.models.notification import Notification
from app.models.push_subscription import PushSubscription
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.schemas.approval import ApprovalRequestCreate
from app.engines.auth.policy import ApprovalPolicy
from app.engines.auth.snapshot import compute_event_state_snapshot
from app.services.approval_service import ApprovalService
from app.services.approval_notification_dispatcher import ApprovalNotificationDispatcher
from app.services.approval_escalation_service import ApprovalEscalationService
from app.services.organizer_phone_service import resolve_user_by_phone, normalize_phone_e164
from app.integrations.whatsapp.parser import parse_inbound_reply
from app.integrations.whatsapp.templates import (
    format_whatsapp_approval_request,
    format_approval_confirmed,
    format_rejection_confirmed,
    format_stale_warning,
    format_expired_notice,
)
from app.core.tokens import generate_approval_view_token, verify_approval_view_token


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_test_event_and_organizer(db: Session, phone: str = "+919876543210"):
    """Helper to set up an event with an organizer and members."""
    owner = User(
        name="Main Organizer",
        email="organizer@eventra.local",
        phone_e164=phone,
    )
    requester = User(
        name="Lead Collaborator",
        email="collaborator@eventra.local",
        phone_e164="+919876543211",
    )
    viewer = User(
        name="ReadOnly Viewer",
        email="viewer@eventra.local",
        phone_e164="+919876543212",
    )
    db.add_all([owner, requester, viewer])
    db.flush()

    event = Event(
        name="Annual Gala 2026",
        description="Flagship annual gala",
        owner_id=owner.id,
        event_type="CONFERENCE",
        state="LIVE",
        start_datetime=utc_now(),
        end_datetime=utc_now() + timedelta(days=2),
    )
    db.add(event)
    db.flush()

    mem_req = EventMember(event_id=event.id, user_id=requester.id, role="COLLABORATOR")
    mem_view = EventMember(event_id=event.id, user_id=viewer.id, role="VIEWER")
    db.add_all([mem_req, mem_view])
    db.commit()

    return event, owner, requester, viewer


# =============================================================================
# 1. Reply Parsing Tests (English + Hindi/Hinglish)
# =============================================================================
def test_reply_parsing_english_and_hinglish():
    # English tests
    dec, code = parse_inbound_reply("YES A4B2")
    assert dec == "APPROVE"
    assert code == "A4B2"

    dec, code = parse_inbound_reply("NO X99")
    assert dec == "REJECT"
    assert code == "X99"

    dec, code = parse_inbound_reply("approve")
    assert dec == "APPROVE"
    assert code is None

    dec, code = parse_inbound_reply("reject code123")
    assert dec == "REJECT"
    assert code == "CODE123"

    # Hindi / Hinglish approval tests
    dec, code = parse_inbound_reply("haan B77")
    assert dec == "APPROVE"
    assert code == "B77"

    dec, code = parse_inbound_reply("theek hai C33")
    assert dec == "APPROVE"
    assert code == "C33"

    dec, code = parse_inbound_reply("sahi hai")
    assert dec == "APPROVE"

    dec, code = parse_inbound_reply("krdo K9")
    assert dec == "APPROVE"
    assert code == "K9"

    # Hindi / Hinglish rejection tests
    dec, code = parse_inbound_reply("nahi R4")
    assert dec == "REJECT"
    assert code == "R4"

    dec, code = parse_inbound_reply("mat karo")
    assert dec == "REJECT"

    dec, code = parse_inbound_reply("radd Z1")
    assert dec == "REJECT"
    assert code == "Z1"

    # Non-decision message
    dec, code = parse_inbound_reply("What is the current status of caterer?")
    assert dec is None
    assert code is None


# =============================================================================
# 2. Organizer Phone Resolution Tests
# =============================================================================
def test_organizer_phone_resolution(db_session: Session):
    event, owner, _, _ = create_test_event_and_organizer(db_session, "+919876543210")

    # Match exact E.164
    user = resolve_user_by_phone(db_session, "+919876543210")
    assert user is not None
    assert user.id == owner.id

    # Match OpenWA format (919876543210@c.us)
    user = resolve_user_by_phone(db_session, "919876543210@c.us")
    assert user is not None
    assert user.id == owner.id

    # Match 10-digit format (9876543210)
    user = resolve_user_by_phone(db_session, "9876543210")
    assert user is not None
    assert user.id == owner.id

    # Unmapped number
    user = resolve_user_by_phone(db_session, "+19998887777")
    assert user is None


# =============================================================================
# 3. Signed Deep Link Tests
# =============================================================================
def test_signed_deep_link_tokens():
    event_id = "event-123"
    approval_id = "appr-456"

    # Valid token
    token = generate_approval_view_token(event_id, approval_id)
    assert verify_approval_view_token(token, event_id, approval_id) is True

    # Wrong approval or event
    assert verify_approval_view_token(token, "wrong-event", approval_id) is False
    assert verify_approval_view_token(token, event_id, "wrong-approval") is False

    # Tampered token
    tampered = token[:-4] + "fake"
    assert verify_approval_view_token(tampered, event_id, approval_id) is False

    # Expired token
    expired_token = generate_approval_view_token(
        event_id, approval_id, expires_at=utc_now() - timedelta(minutes=5)
    )
    assert verify_approval_view_token(expired_token, event_id, approval_id) is False


# =============================================================================
# 4. Dispatcher Fan-Out with Independent Channel Fault Isolation
# =============================================================================
def test_dispatcher_fanout_channel_isolation(db_session: Session):
    event, owner, requester, _ = create_test_event_and_organizer(db_session)

    # Register a push subscription for the owner
    sub = PushSubscription(
        user_id=owner.id,
        endpoint="https://fcm.googleapis.com/fcm/send/test-sub-1",
        p256dh="mock-p256dh",
        auth="mock-auth",
        created_at=utc_now(),
    )
    db_session.add(sub)
    db_session.commit()

    service = ApprovalService(db_session)
    create_data = ApprovalRequestCreate(
        action_type="TASK_MUTATION",
        target_type="TASK",
        target_id=None,
        impact_level="MAJOR",
        requested_action={"description": "Replace stage lights", "cost_delta": 2500},
        notes="High-impact change",
    )
    approval = service.create_request(event.id, requester.id, create_data)

    assert approval.id is not None
    assert approval.reply_code is not None

    # Check notification delivery records
    notifs = db_session.query(Notification).filter(Notification.event_id == event.id).all()
    channels = {n.channel for n in notifs}

    # Must contain IN_APP and WHATSAPP and WEB_PUSH
    assert "IN_APP" in channels
    assert "WHATSAPP" in channels
    assert "WEB_PUSH" in channels

    # Verify requester was NOT notified (separation of duties)
    recipients = {n.recipient for n in notifs}
    assert requester.id not in recipients
    assert requester.phone_e164 not in recipients


# =============================================================================
# 5. Low-Risk Pre-Authorized Policy Suppression
# =============================================================================
def test_low_risk_policy_notification_suppression(db_session: Session):
    # Pre-authorized or MINOR under threshold should suppress external notifications
    assert ApprovalPolicy.should_notify("MINOR", payload={"cost_delta": 500}) is False
    assert ApprovalPolicy.should_notify("MINOR", payload={"pre_authorized": True}) is False

    # CRITICAL and MAJOR must always notify
    assert ApprovalPolicy.should_notify("CRITICAL", payload={"cost_delta": 500}) is True
    assert ApprovalPolicy.should_notify("MAJOR", payload={"cost_delta": 500}) is True


# =============================================================================
# 6. Webhook Remote Approval (WhatsApp) Path vs Vendor Path
# =============================================================================
def test_webhook_organizer_approval_flow(test_client: TestClient, db_session: Session):
    event, owner, requester, _ = create_test_event_and_organizer(db_session, "+919876543210")

    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="VENDOR_DISMISSAL",
            target_type="VENDOR",
            target_id=None,
            impact_level="MAJOR",
            requested_action={"title": "Photographer no-show replacement", "cost_delta": 2000},
        ),
    )
    assert approval.status == "PENDING"
    reply_code = approval.reply_code

import hmac
import hashlib
from app.core.config import settings


def send_openwa_webhook(test_client: TestClient, payload: dict):
    """Sends webhook with exact raw byte payload matching the X-OpenWA-Signature HMAC."""
    raw_body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if settings.OPENWA_WEBHOOK_SECRET:
        sig = hmac.new(
            settings.OPENWA_WEBHOOK_SECRET.encode("utf-8"),
            raw_body,
            hashlib.sha256,
        ).hexdigest()
        headers["X-OpenWA-Signature"] = sig
    return test_client.post("/webhooks/openwa", content=raw_body, headers=headers)


# =============================================================================
# 6. Webhook Remote Approval (WhatsApp) Path vs Vendor Path
# =============================================================================
def test_webhook_hmac_enforcement(test_client: TestClient):
    """Verifies that missing or invalid HMAC signature is rejected."""
    if not settings.OPENWA_WEBHOOK_SECRET:
        settings.OPENWA_WEBHOOK_SECRET = "test-secret-123"

    payload = {"from": "919876543210@c.us", "body": "YES", "id": "hmac-test"}
    raw_body = json.dumps(payload).encode("utf-8")

    # 1. Missing signature header => 401
    res = test_client.post(
        "/webhooks/openwa",
        content=raw_body,
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 401

    # 2. Invalid signature header => 403
    res_bad = test_client.post(
        "/webhooks/openwa",
        content=raw_body,
        headers={
            "Content-Type": "application/json",
            "X-OpenWA-Signature": "invalid-signature-hex",
        },
    )
    assert res_bad.status_code == 403


def test_webhook_organizer_approval_flow(test_client: TestClient, db_session: Session):
    from app.models.budget import BudgetItem
    event, owner, requester, _ = create_test_event_and_organizer(db_session, "+919876543210")

    budget_item = BudgetItem(
        event_id=event.id,
        name="Photography",
        category="Photography",
        estimated_amount=5000,
        actual_amount=3000,
        status="COMMITTED",
    )
    db_session.add(budget_item)
    db_session.commit()

    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="ADJUST_BUDGET",
            target_type="BUDGET",
            target_id=budget_item.id,
            impact_level="MAJOR",
            requested_action={"budget_item_id": budget_item.id, "actual_amount": 4000},
        ),
    )
    assert approval.status == "PENDING"
    reply_code = approval.reply_code

    # 1. Organizer replies YES <CODE> via OpenWA webhook
    webhook_payload = {
        "from": "919876543210@c.us",
        "body": f"YES {reply_code}",
        "id": "msg-001",
    }
    response = send_openwa_webhook(test_client, webhook_payload)
    assert response.status_code == 200
    res_data = response.json()
    assert res_data.get("status") == "APPROVED"
    assert res_data.get("approval_id") == approval.id

    # Verify DB status updated to APPROVED by owner.id
    db_session.expire_all()
    updated = db_session.query(Approval).filter(Approval.id == approval.id).first()
    assert updated.status == "APPROVED"
    assert updated.approver_id == owner.id


def test_webhook_idempotency(test_client: TestClient, db_session: Session):
    from app.models.budget import BudgetItem
    event, owner, requester, _ = create_test_event_and_organizer(db_session, "+919876543210")

    budget_item = BudgetItem(
        event_id=event.id,
        name="Catering",
        category="Catering",
        estimated_amount=8000,
        actual_amount=5000,
        status="COMMITTED",
    )
    db_session.add(budget_item)
    db_session.commit()

    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="ADJUST_BUDGET",
            target_type="BUDGET",
            target_id=budget_item.id,
            impact_level="MAJOR",
            requested_action={"budget_item_id": budget_item.id, "actual_amount": 6500},
        ),
    )

    webhook_payload = {
        "from": "919876543210@c.us",
        "body": f"YES {approval.reply_code}",
        "id": "msg-unique-idem-1",
    }
    # First send
    res1 = send_openwa_webhook(test_client, webhook_payload)
    assert res1.status_code == 200
    assert res1.json().get("status") == "APPROVED"

    # Second send with same message ID (duplicate delivery)
    res2 = send_openwa_webhook(test_client, webhook_payload)
    assert res2.status_code == 200
    assert res2.json().get("status") == "APPROVED"


def test_webhook_non_eligible_user_cannot_approve(test_client: TestClient, db_session: Session):
    event, _, requester, viewer = create_test_event_and_organizer(db_session)
    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="TASK_MUTATION",
            target_type="TASK",
            impact_level="CRITICAL",
            requested_action={"cost_delta": 10000},
        ),
    )

    # Viewer tries to approve via WhatsApp
    webhook_payload = {
        "from": viewer.phone_e164,
        "body": f"YES {approval.reply_code}",
        "id": "msg-viewer-01",
    }
    res = send_openwa_webhook(test_client, webhook_payload)
    assert res.status_code == 200
    assert res.json().get("status") in ("CODE_NOT_FOUND", "NO_PENDING_APPROVALS")

    # Requester also cannot approve their own request
    req_payload = {
        "from": requester.phone_e164,
        "body": f"YES {approval.reply_code}",
        "id": "msg-req-01",
    }
    res = send_openwa_webhook(test_client, req_payload)
    assert res.status_code == 200
    assert res.json().get("status") in ("CODE_NOT_FOUND", "NO_PENDING_APPROVALS")


def test_webhook_stale_reply(test_client: TestClient, db_session: Session):
    """Verifies that an approval is marked STALE if event state changed before organizer reply."""
    from app.models.task import Task
    event, owner, requester, _ = create_test_event_and_organizer(db_session, "+919876543210")
    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="TASK_MUTATION",
            target_type="TASK",
            impact_level="MAJOR",
            requested_action={"cost_delta": 2000},
        ),
    )

    # Invalidate snapshot by adding a new Task to the event
    task = Task(
        event_id=event.id,
        name="Stage Setup",
        status="PENDING",
    )
    db_session.add(task)
    db_session.commit()

    webhook_payload = {
        "from": "919876543210@c.us",
        "body": f"YES {approval.reply_code}",
        "id": "msg-stale-01",
    }
    res = send_openwa_webhook(test_client, webhook_payload)
    assert res.status_code == 200
    assert res.json().get("status") == "STALE"

    db_session.refresh(approval)
    assert approval.status == "STALE"


def test_webhook_vendor_fallback(test_client: TestClient, db_session: Session):
    """Verifies that unknown numbers fall through to vendor resolution unchanged."""
    webhook_payload = {
        "from": "+918888888888",
        "body": "Hello, we are checking delivery status.",
        "id": "msg-vendor-01",
    }
    res = send_openwa_webhook(test_client, webhook_payload)
    assert res.status_code == 200
    assert res.json().get("status") in ("UNMAPPED_PROVIDER", "PROCESSED")


# =============================================================================
# 7. Expiry & STALE Rejection Tests
# =============================================================================
def test_approval_expiry_enforcement(db_session: Session):
    event, owner, requester, _ = create_test_event_and_organizer(db_session)
    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="TASK_MUTATION",
            target_type="TASK",
            impact_level="MAJOR",
            requested_action={"cost_delta": 1000},
        ),
    )

    # Force expiration in past
    approval.expires_at = utc_now() - timedelta(minutes=10)
    db_session.commit()

    # Attempting to approve must fail and mark status EXPIRED
    from app.core.exceptions import BadRequestException
    with pytest.raises(BadRequestException) as excinfo:
        service.approve(event.id, approval.id, approver_id=owner.id)
    assert "expired" in str(excinfo.value).lower()

    db_session.refresh(approval)
    assert approval.status == "EXPIRED"


def test_approval_escalation_sweeper(db_session: Session):
    event, owner, requester, _ = create_test_event_and_organizer(db_session)
    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="TASK_MUTATION",
            target_type="TASK",
            impact_level="CRITICAL",
            requested_action={"cost_delta": 5000},
        ),
    )
    # Set created 20 minutes ago and expired 2 minutes ago
    approval.created_at = utc_now() - timedelta(minutes=20)
    approval.expires_at = utc_now() - timedelta(minutes=2)
    db_session.commit()

    sweeper = ApprovalEscalationService(db_session)
    counts = sweeper.sweep_pending_approvals()

    assert counts["expired"] >= 1
    db_session.refresh(approval)
    assert approval.status == "EXPIRED"


# =============================================================================
# 8. Web Push Subscribe & Unsubscribe Endpoints
# =============================================================================
def test_web_push_endpoints(test_client: TestClient, db_session: Session):
    # VAPID public key endpoint
    res = test_client.get("/api/notifications/push/vapid-public-key")
    assert res.status_code == 200
    assert "public_key" in res.json()

    # Subscribe endpoint
    sub_payload = {
        "endpoint": "https://push.example.com/sub/user-999",
        "keys": {
            "p256dh": "dummy-p256dh-key",
            "auth": "dummy-auth-key",
        },
        "user_agent": "Mozilla/5.0 Test",
    }
    sub_res = test_client.post(
        "/api/notifications/push/subscribe",
        json=sub_payload,
        headers={"x-user-id": "test_organizer"},
    )
    assert sub_res.status_code == 201
    assert sub_res.json()["endpoint"] == sub_payload["endpoint"]

    # Verify stored in DB
    sub = db_session.query(PushSubscription).filter(PushSubscription.endpoint == sub_payload["endpoint"]).first()
    assert sub is not None

    # Unsubscribe endpoint
    unsub_res = test_client.post(
        "/api/notifications/push/unsubscribe",
        json={"endpoint": sub_payload["endpoint"]},
        headers={"x-user-id": "test_organizer"},
    )
    assert unsub_res.status_code == 200
    assert unsub_res.json()["status"] == "UNSUBSCRIBED"

    sub_after = db_session.query(PushSubscription).filter(PushSubscription.endpoint == sub_payload["endpoint"]).first()
    assert sub_after is None


# =============================================================================
# 9. Review Fixes: Tokens, Webhook Edge Cases, Multi-Tier Escalation, Collisions
# =============================================================================
from unittest.mock import patch
from app.core.tokens import _get_signing_key
from app.services.approval_notification_dispatcher import generate_unique_reply_code


def test_tokens_environment_enforcement_and_scoping():
    """Verifies that missing DEEP_LINK_SECRET raises in non-dev, works in dev/test,
    and tokens are scoped to a specific approval and expire properly."""
    orig_env = settings.ENVIRONMENT
    orig_secret = settings.DEEP_LINK_SECRET
    try:
        # 1. In non-dev, missing DEEP_LINK_SECRET must raise RuntimeError
        settings.ENVIRONMENT = "production"
        settings.DEEP_LINK_SECRET = None
        with pytest.raises(RuntimeError) as excinfo:
            _get_signing_key()
        assert "DEEP_LINK_SECRET must be configured" in str(excinfo.value)

        # 2. In test/dev, missing DEEP_LINK_SECRET falls back to SECRET_KEY / dev default
        settings.ENVIRONMENT = "test"
        key = _get_signing_key()
        assert isinstance(key, bytes)
        assert len(key) > 0

        # When DEEP_LINK_SECRET is present, it is always used
        settings.DEEP_LINK_SECRET = "custom-deep-link-secret-test"
        assert _get_signing_key() == b"custom-deep-link-secret-test"

        # 3. Scoping: Token for approval A does not open approval B
        tok_a = generate_approval_view_token("ev-100", "appr-A")
        assert verify_approval_view_token(tok_a, "ev-100", "appr-A") is True
        assert verify_approval_view_token(tok_a, "ev-100", "appr-B") is False
        assert verify_approval_view_token(tok_a, "ev-200", "appr-A") is False

        # 4. Expired token is rejected
        expired_tok = generate_approval_view_token(
            "ev-100", "appr-A", expires_at=utc_now() - timedelta(seconds=1)
        )
        assert verify_approval_view_token(expired_tok, "ev-100", "appr-A") is False

    finally:
        settings.ENVIRONMENT = orig_env
        settings.DEEP_LINK_SECRET = orig_secret


def test_webhook_edge_cases_and_hinglish_decisions(test_client: TestClient, db_session: Session):
    """Verifies non-organizer rejection, duplicate message idempotency, expired/stale replies,
    and Hinglish responses ('haan', 'nahi')."""
    from app.models.budget import BudgetItem
    event, owner, requester, _ = create_test_event_and_organizer(db_session, "+919876543210")
    service = ApprovalService(db_session)

    b_item = BudgetItem(
        event_id=event.id,
        name="Sound & AV",
        category="AV",
        estimated_amount=10000,
        actual_amount=5000,
        status="COMMITTED",
    )
    db_session.add(b_item)
    db_session.commit()

    # 1. Non-organizer phone never approves
    appr1 = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="ADJUST_BUDGET",
            target_type="BUDGET",
            target_id=b_item.id,
            impact_level="MAJOR",
            requested_action={"budget_item_id": b_item.id, "actual_amount": 5500},
        ),
    )
    unauthorized_payload = {
        "from": "+910000000000",
        "body": f"YES {appr1.reply_code}",
        "id": "unauth-msg-1",
    }
    res = send_openwa_webhook(test_client, unauthorized_payload)
    assert res.status_code == 200
    assert res.json().get("status") in ("UNMAPPED_PROVIDER", "NO_PENDING_APPROVALS", "CODE_NOT_FOUND")
    db_session.refresh(appr1)
    assert appr1.status == "PENDING"  # Did NOT approve!

    # 2. Duplicate webhook message ID does not double-approve
    dup_msg_id = "idem-msg-test-999"
    webhook_dup = {
        "from": "919876543210@c.us",
        "body": f"YES {appr1.reply_code}",
        "id": dup_msg_id,
    }
    r1 = send_openwa_webhook(test_client, webhook_dup)
    assert r1.status_code == 200
    assert r1.json().get("status") == "APPROVED"

    r2 = send_openwa_webhook(test_client, webhook_dup)
    assert r2.status_code == 200
    assert r2.json().get("status") == "APPROVED"
    db_session.refresh(appr1)
    assert appr1.status == "APPROVED"

    # 3. Expired approval replies correctly
    appr_exp = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="ADJUST_BUDGET",
            target_type="BUDGET",
            target_id=b_item.id,
            impact_level="MAJOR",
            requested_action={"budget_item_id": b_item.id, "actual_amount": 5600},
        ),
    )
    appr_exp.expires_at = utc_now() - timedelta(minutes=5)
    db_session.commit()

    exp_webhook = {
        "from": "919876543210@c.us",
        "body": f"YES {appr_exp.reply_code}",
        "id": "exp-msg-01",
    }
    res_exp = send_openwa_webhook(test_client, exp_webhook)
    assert res_exp.status_code == 200
    assert res_exp.json().get("status") == "EXPIRED"
    db_session.refresh(appr_exp)
    assert appr_exp.status == "EXPIRED"

    # 4. STALE approval replies correctly
    from app.models.task import Task
    appr_stale = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="ADJUST_BUDGET",
            target_type="BUDGET",
            target_id=b_item.id,
            impact_level="MAJOR",
            requested_action={"budget_item_id": b_item.id, "actual_amount": 5700},
        ),
    )
    # Mutate event state to invalidate snapshot
    extra_task = Task(event_id=event.id, name="Decor Cleanup", status="PENDING")
    db_session.add(extra_task)
    db_session.commit()

    stale_webhook = {
        "from": "919876543210@c.us",
        "body": f"YES {appr_stale.reply_code}",
        "id": "stale-msg-01",
    }
    res_stale = send_openwa_webhook(test_client, stale_webhook)
    assert res_stale.status_code == 200
    assert res_stale.json().get("status") == "STALE"
    db_session.refresh(appr_stale)
    assert appr_stale.status == "STALE"

    # 5. Hinglish replies work: "haan" approves, "nahi" rejects
    appr_h1 = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="ADJUST_BUDGET",
            target_type="BUDGET",
            target_id=b_item.id,
            impact_level="MAJOR",
            requested_action={"budget_item_id": b_item.id, "actual_amount": 5800},
        ),
    )
    h1_webhook = {
        "from": "919876543210@c.us",
        "body": f"haan {appr_h1.reply_code}",
        "id": "hinglish-haan-01",
    }
    res_h1 = send_openwa_webhook(test_client, h1_webhook)
    assert res_h1.status_code == 200
    assert res_h1.json().get("status") == "APPROVED"
    db_session.refresh(appr_h1)
    assert appr_h1.status == "APPROVED"

    appr_h2 = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="ADJUST_BUDGET",
            target_type="BUDGET",
            target_id=b_item.id,
            impact_level="MAJOR",
            requested_action={"budget_item_id": b_item.id, "actual_amount": 5900},
        ),
    )
    h2_webhook = {
        "from": "919876543210@c.us",
        "body": f"nahi {appr_h2.reply_code}",
        "id": "hinglish-nahi-01",
    }
    res_h2 = send_openwa_webhook(test_client, h2_webhook)
    assert res_h2.status_code == 200
    assert res_h2.json().get("status") == "REJECTED"
    db_session.refresh(appr_h2)
    assert appr_h2.status == "REJECTED"


def test_escalation_recipients_filtering_and_repeated_sweeps(db_session: Session):
    """Verifies that escalation recipients exclude requester and already-notified users,
    falls back to owner when none eligible, and repeated sweeps fire reminder/escalation exactly once."""
    event, owner, requester, _ = create_test_event_and_organizer(db_session)

    # Add Manager 1 before request creation
    manager1 = User(name="Manager 1", email="m1@eventra.local", phone_e164="+919876543001")
    db_session.add(manager1)
    db_session.flush()

    mem_m1 = EventMember(event_id=event.id, user_id=manager1.id, role="EVENT_MANAGER")
    db_session.add(mem_m1)
    db_session.commit()

    service = ApprovalService(db_session)
    approval = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="TASK_MUTATION",
            target_type="TASK",
            impact_level="MAJOR",
            requested_action={"cost_delta": 2500},
        ),
    )

    # Add Manager 2 after request creation (manager2 has not yet been notified for this approval)
    manager2 = User(name="Manager 2", email="m2@eventra.local", phone_e164="+919876543002")
    db_session.add(manager2)
    db_session.flush()

    mem_m2 = EventMember(event_id=event.id, user_id=manager2.id, role="EVENT_MANAGER")
    db_session.add(mem_m2)
    db_session.commit()

    sweeper = ApprovalEscalationService(db_session)

    # 1. Verify exclusion: requester is excluded, and already-notified users (owner, manager1) are excluded
    next_recipients = sweeper._resolve_escalation_recipients(approval)
    recipient_ids = [u.id for u in next_recipients]
    # requester must NOT be included
    assert requester.id not in recipient_ids
    # already notified users must NOT be included
    assert manager1.id not in recipient_ids
    # manager2 is eligible and unnotified
    assert manager2.id in recipient_ids

    # 2. When ALL eligible users (manager1, manager2) have been notified, falls back to owner
    approval.requested_action = {"notified_to": [owner.id, manager1.id, manager2.id]}
    db_session.commit()

    fallback_recipients = sweeper._resolve_escalation_recipients(approval)
    fallback_ids = [u.id for u in fallback_recipients]
    assert fallback_ids == [owner.id]

    # 3. Sweeper safety: running sweep_pending_approvals() twice sends exactly one reminder and one escalation
    approval.created_at = utc_now() - timedelta(minutes=30)
    approval.expires_at = utc_now() + timedelta(minutes=30)
    approval.requested_action = {}
    db_session.commit()

    first_sweep = sweeper.sweep_pending_approvals()
    assert first_sweep["reminded"] == 1
    assert first_sweep["escalated"] == 1

    db_session.refresh(approval)
    req_act = approval.requested_action
    assert req_act.get("reminder_sent") is True
    assert req_act.get("escalated") is True
    assert "escalated_to" in req_act

    # Second sweep immediately after must NOT fire again (atomic claims persisted)
    second_sweep = sweeper.sweep_pending_approvals()
    assert second_sweep["reminded"] == 0
    assert second_sweep["escalated"] == 0


def test_reply_code_collision_retry(db_session: Session):
    """Verifies that generate_unique_reply_code checks ALL approvals (including resolved ones)
    and successfully retries on collision."""
    event, owner, requester, _ = create_test_event_and_organizer(db_session)
    service = ApprovalService(db_session)

    existing_appr = service.create_request(
        event.id,
        requester.id,
        ApprovalRequestCreate(
            action_type="TASK_MUTATION",
            target_type="TASK",
            impact_level="MAJOR",
            requested_action={"cost_delta": 500},
        ),
    )
    # Manually set a known reply code and mark it APPROVED (historical non-pending approval)
    colliding_code = "ABCDEF"
    existing_appr.reply_code = colliding_code
    existing_appr.status = "APPROVED"
    db_session.commit()

    # Verify colliding_code exists in DB
    assert db_session.query(Approval).filter(Approval.reply_code == colliding_code).first() is not None

    # Patch secrets.choice so first 6 choices build colliding_code, then second 6 build XYZ789
    sequence_to_yield = list("ABCDEF") + list("XYZ789")
    seq_iter = iter(sequence_to_yield)

    with patch("secrets.choice", side_effect=lambda seq: next(seq_iter)):
        new_code = generate_unique_reply_code(db_session, length=6)

    # Must have bypassed ABCDEF because it exists in DB, and returned XYZ789
    assert new_code == "XYZ789"
    assert new_code != colliding_code

    # Verify no ambiguous characters (0, O, 1, I)
    for bad_char in ["0", "O", "1", "I"]:
        assert bad_char not in new_code
