"""Tests for real vendor outreach (WhatsApp via OpenWA + AI call via Twilio).

Every provider interaction is mocked: these tests never send a WhatsApp
message or place a phone call.
"""
import base64
import hashlib
import hmac
from datetime import datetime
from types import SimpleNamespace
import asyncio
from unittest.mock import MagicMock, patch
from urllib.parse import urlencode

import httpx
import pytest

from app.core.config import settings
from app.core.phone import InvalidPhoneNumber, mask_phone, normalize_phone_e164, scrub_phone_numbers
from app.integrations.base import IntegrationResult, IntegrationSource
from app.integrations.communication.twilio import (
    TwilioVoiceAdapter,
    build_stream_twiml,
    sign_stream_session,
    verify_stream_token,
)
from app.integrations.whatsapp.client import OpenWACommunicationAdapter, OpenWAError
from app.models.communication_attempt import CommunicationAttempt
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.shortlist import EventShortlistEntry
from app.models.user import User
from app.models.vendor import Vendor
from app.services.vendor_outreach_service import VendorOutreachService, build_whatsapp_message

OWNER = "owner-outreach"
HEADERS = {"X-User-Id": OWNER}
TEST_PHONE = "+919000000001"  # synthetic test number
CALLBACK_URL = "https://tunnel.example.test/api/v1/voice/twilio/status"


def _wa_ok(message_id="true_919000000001@c.us_3EB0TEST"):
    return IntegrationResult(success=True, source=IntegrationSource.REAL, data={"message_id": message_id})


def _call_ok(call_sid="CA0000000000000000000000000000test"):
    return IntegrationResult(success=True, source=IntegrationSource.REAL, data={"call_sid": call_sid, "status": "queued"})


def _fail(reason, code="X"):
    return IntegrationResult(success=False, source=IntegrationSource.REAL, data={"error_code": code}, error=reason)


@pytest.fixture
def providers():
    with patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.send_text_strict") as wa, \
         patch("app.integrations.communication.twilio.TwilioVoiceAdapter.place_outbound_call") as call, \
         patch.object(settings, "TWILIO_ENABLED", True):
        wa.return_value = _wa_ok()
        call.return_value = _call_ok()
        yield SimpleNamespace(wa=wa, call=call)


@pytest.fixture
def setup(db_session):
    db_session.add(User(id=OWNER, name="Owner", email="owner-outreach@example.com"))
    db_session.add(User(id="collab-1", name="Collaborator", email="collab-1@example.com"))
    event = Event(
        id="evt-outreach-1",
        owner_id=OWNER,
        name="Delhi Product Launch",
        location="Delhi",
        start_datetime=datetime(2026, 10, 30, 18, 0),
    )
    vendor = Vendor(
        id="vendor-outreach-1",
        name="Test Contact (EVENTRA test contact)",
        category="PHOTOGRAPHY",
        city="Delhi",
        contact_name="Test Contact",
        contact_phone="9000000001",
    )
    db_session.add_all([event, vendor])
    db_session.add(EventMember(event_id=event.id, user_id="collab-1", role="COLLABORATOR"))
    entry = EventShortlistEntry(
        event_id=event.id,
        candidate_id="vendor-outreach-1",
        provider_id=vendor.id,
        category="PHOTOGRAPHY",
        candidate_name=vendor.name,
        status="RECOMMENDED",
        candidate_data={},
    )
    db_session.add(entry)
    db_session.commit()
    return SimpleNamespace(event=event, vendor=vendor, entry=entry)


def _select_and_approve(client, setup, headers=HEADERS):
    base = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}"
    assert client.post(f"{base}/select", headers=headers).status_code == 200
    return client.post(f"{base}/approve-communication", headers=headers)


def _attempt(db, entry, channel):
    return (
        db.query(CommunicationAttempt)
        .filter(CommunicationAttempt.shortlist_entry_id == entry.id, CommunicationAttempt.channel == channel)
        .one()
    )


def _twilio_signature(url, params, token):
    payload = url + "".join(f"{k}{params[k]}" for k in sorted(params))
    return base64.b64encode(hmac.new(token.encode(), payload.encode(), hashlib.sha1).digest()).decode()


# ---------------------------------------------------------------------------
# 1. Contact resolution & phone normalization
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "raw",
    ["9000000001", "09000000001", "+91 90000 00001", "91-9000000001", "0091 9000000001", "+919000000001"],
)
def test_indian_numbers_normalize_to_e164(raw):
    assert normalize_phone_e164(raw) == TEST_PHONE


@pytest.mark.parametrize("raw", [None, "", "abc", "12345", "+91 1234567890", "5000000001"])
def test_invalid_numbers_are_rejected(raw):
    with pytest.raises(InvalidPhoneNumber):
        normalize_phone_e164(raw)


def test_phone_masking_and_error_scrubbing():
    assert mask_phone(TEST_PHONE) == "+91******0001"
    assert "9000000001" not in scrub_phone_numbers("Number +919000000001 is unverified")


def test_contact_resolves_from_vendor_record(db_session, setup):
    name, phone, vendor_id, error = VendorOutreachService(db_session).resolve_contact(setup.entry)
    assert (name, phone, vendor_id, error) == ("Test Contact", TEST_PHONE, setup.vendor.id, None)


# ---------------------------------------------------------------------------
# 2. WhatsApp payload construction & OpenWA failure handling
# ---------------------------------------------------------------------------

def test_whatsapp_message_uses_real_event_details(setup):
    text = build_whatsapp_message("Test Contact", setup.event, "PHOTOGRAPHY")
    assert text == (
        "Hello Test Contact, I am contacting you on behalf of the organizer of Delhi Product Launch. "
        "We are looking for photography services for an event in Delhi on 30 October 2026. "
        "Could you please confirm your availability and share your estimated pricing? Thank you."
    )
    assert "[" not in text and "]" not in text


def test_whatsapp_message_omits_missing_details(setup):
    setup.event.location = None
    setup.event.start_datetime = None
    text = build_whatsapp_message("Test Contact", setup.event, "OTHER")
    assert "for event services for an event. Could you" in text


@pytest.fixture
def openwa_enabled():
    with patch.object(settings, "OPENWA_ENABLED", True), patch.object(settings, "OPENWA_SESSION_ID", "eventra_ops"):
        yield OpenWACommunicationAdapter()


def test_openwa_send_returns_message_id(openwa_enabled):
    calls = []

    def fake(method, args, timeout=None):
        calls.append((method, args))
        return {
            "getConnectionState": "CONNECTED",
            "checkNumberStatus": {"numberExists": True, "canReceiveMessage": True},
            "sendText": "true_919000000001@c.us_3EB0TEST",
        }[method]

    with patch.object(openwa_enabled, "_easy_api_call", side_effect=fake):
        result = openwa_enabled.send_text_strict(TEST_PHONE, "hello")
    assert result.success and result.data["message_id"] == "true_919000000001@c.us_3EB0TEST"
    assert calls[-1] == ("sendText", {"to": "919000000001@c.us", "content": "hello"})


def test_openwa_disconnected_session_fails_without_sending(openwa_enabled):
    with patch.object(openwa_enabled, "_easy_api_call", return_value="UNPAIRED") as api:
        result = openwa_enabled.send_text_strict(TEST_PHONE, "hello")
    assert not result.success
    assert result.data["error_code"] == "OPENWA_SESSION_DISCONNECTED"
    assert [c.args[0] for c in api.call_args_list] == ["getConnectionState"]


def test_openwa_unregistered_number_fails(openwa_enabled):
    responses = {"getConnectionState": "CONNECTED", "checkNumberStatus": {"numberExists": False}}
    with patch.object(openwa_enabled, "_easy_api_call", side_effect=lambda m, a, timeout=None: responses[m]):
        result = openwa_enabled.send_text_strict(TEST_PHONE, "hello")
    assert result.data["error_code"] == "WHATSAPP_INVALID_NUMBER"


def test_openwa_timeout_is_a_failure_not_a_mock_success(openwa_enabled):
    with patch.object(openwa_enabled, "_easy_api_call", side_effect=OpenWAError("OPENWA_TIMEOUT", "timed out")):
        result = openwa_enabled.send_text_strict(TEST_PHONE, "hello")
    assert not result.success and result.source == IntegrationSource.REAL
    assert result.data["error_code"] == "OPENWA_TIMEOUT"


def test_openwa_rejected_send_is_a_failure(openwa_enabled):
    responses = {"getConnectionState": "CONNECTED", "checkNumberStatus": {}, "sendText": False}
    with patch.object(openwa_enabled, "_easy_api_call", side_effect=lambda m, a, timeout=None: responses[m]):
        result = openwa_enabled.send_text_strict(TEST_PHONE, "hello")
    assert result.data["error_code"] == "OPENWA_NOT_ACCEPTED"


def test_openwa_not_enabled_is_actionable():
    with patch.object(settings, "OPENWA_ENABLED", False):
        result = OpenWACommunicationAdapter().send_text_strict(TEST_PHONE, "hello")
    assert result.data["error_code"] == "OPENWA_NOT_CONFIGURED"
    assert "OPENWA_ENABLED=true" in result.error


# ---------------------------------------------------------------------------
# 3. Outbound call initiation & failure handling
# ---------------------------------------------------------------------------

class _FakeHttpClient:
    def __init__(self, response=None, exc=None):
        self.response, self.exc, self.requests = response, exc, []

    def __call__(self, *args, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def post(self, url, data=None, auth=None):
        self.requests.append({"url": url, "data": data})
        if self.exc:
            raise self.exc
        return self.response


def _adapter(**overrides):
    kwargs = dict(
        account_sid="ACtest",
        auth_token="secret-token",
        caller_number="+15550000000",
        stream_url="wss://tunnel.example.test/voice/twilio/stream",
        callback_url=CALLBACK_URL,
    )
    kwargs.update(overrides)
    return TwilioVoiceAdapter(**kwargs)


from app.integrations.communication.twilio import public_endpoint_error as _real_public_endpoint_error


@pytest.fixture(autouse=True)
def _tunnel_up():
    """Adapter tests never reach the network; the tunnel preflight is tested separately."""
    with patch("app.integrations.communication.twilio.public_endpoint_error", return_value=None) as pre:
        yield pre


def test_call_is_not_placed_when_tunnel_is_down(_tunnel_up):
    _tunnel_up.return_value = "The public tunnel returned HTTP 502 instead of reaching this API"
    fake = _FakeHttpClient(httpx.Response(201, json={"sid": "CAabc", "status": "queued"}))
    with patch("app.integrations.communication.twilio.httpx.Client", fake):
        result = _adapter().place_outbound_call(TEST_PHONE, {"session_id": "s"})
    assert not result.success and result.data["error_code"] == "TWILIO_TUNNEL_UNREACHABLE"
    assert not fake.requests  # Twilio was never asked to place the call


@pytest.mark.parametrize(
    "response, expected",
    [
        (httpx.Response(200, json={"status": "healthy"}), None),
        (httpx.Response(502), "HTTP 502"),
        (httpx.ConnectError("dns"), "not reachable"),
    ],
)
def test_tunnel_preflight_checks_health_through_public_url(response, expected):
    def fake_get(url, timeout):
        assert url == "https://tunnel.example.test/health"
        if isinstance(response, Exception):
            raise response
        return response

    with patch("app.integrations.communication.twilio.httpx.get", fake_get):
        error = _real_public_endpoint_error(CALLBACK_URL)
    assert error is None if expected is None else expected in error


def test_stale_queued_call_is_refreshed_from_twilio(db_session, setup, providers):
    setup.entry.status = "SELECTED"
    db_session.commit()
    service = VendorOutreachService(db_session)
    service.start_outreach(setup.event, setup.entry, actor_id=OWNER)
    with patch(
        "app.integrations.communication.twilio.TwilioVoiceAdapter.fetch_call",
        return_value={"status": "completed", "duration": "9", "answered_by": None},
    ):
        service.refresh_call_status(setup.entry)
    call = service.summary(setup.entry)["call"]
    # The stream never ran (no transcript), so a completed call is not reported as a conversation.
    assert call["status"] == "NO_CONVERSATION"
    assert call["duration_seconds"] == 9


def test_call_placed_with_stream_and_status_callback():
    fake = _FakeHttpClient(httpx.Response(201, json={"sid": "CAabc", "status": "queued"}))
    with patch("app.integrations.communication.twilio.httpx.Client", fake):
        result = _adapter().place_outbound_call(TEST_PHONE, {"session_id": "att-1:1", "event_name": 'A & "B"'})
    assert result.success and result.data["call_sid"] == "CAabc"
    form = fake.requests[0]["data"]
    assert form["To"] == TEST_PHONE and form["StatusCallback"] == CALLBACK_URL
    assert form["StatusCallbackEvent"] == ["initiated", "ringing", "answered", "completed"]
    assert 'value="A &amp; &quot;B&quot;"' in form["Twiml"]
    assert f'value="{sign_stream_session("att-1:1")}"' in form["Twiml"]


def test_call_request_is_encoded_by_real_httpx():
    """Uses httpx's real request encoding (only the network is mocked) so form encoding bugs surface."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        from urllib.parse import parse_qs
        seen["form"] = parse_qs(request.content.decode())
        seen["auth"] = request.headers.get("authorization", "")
        return httpx.Response(201, json={"sid": "CAreal", "status": "queued"})

    real_client = httpx.Client
    with patch(
        "app.integrations.communication.twilio.httpx.Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    ):
        result = _adapter().place_outbound_call(TEST_PHONE, {"session_id": "att-1:1"})
    assert result.success and result.data["call_sid"] == "CAreal"
    assert seen["form"]["StatusCallbackEvent"] == ["initiated", "ringing", "answered", "completed"]
    assert seen["form"]["To"] == [TEST_PHONE]
    assert seen["auth"].startswith("Basic ")


def test_unexpected_dispatch_error_marks_channel_failed_and_other_channel_still_sends(db_session, setup, providers):
    providers.call.side_effect = RuntimeError("boom")
    setup.entry.status = "SELECTED"
    db_session.commit()
    summary = VendorOutreachService(db_session).start_outreach(setup.event, setup.entry, actor_id=OWNER)
    assert summary["call"]["status"] == "FAILED" and summary["call"]["retryable"] is True
    assert "Unexpected error" in summary["call"]["error"]
    assert summary["whatsapp"]["status"] == "ACCEPTED"


def test_trial_account_rejection_is_explained_and_scrubbed():
    body = {"code": 21219, "message": "The number +919000000001 is unverified."}
    with patch("app.integrations.communication.twilio.httpx.Client", _FakeHttpClient(httpx.Response(400, json=body))):
        result = _adapter().place_outbound_call(TEST_PHONE, {"session_id": "s"})
    assert not result.success and result.data["error_code"] == "TWILIO_21219"
    assert "Verified Caller IDs" in result.error
    assert "9000000001" not in result.error


def test_call_timeout_is_not_retried_automatically():
    fake = _FakeHttpClient(exc=httpx.ReadTimeout("slow"))
    with patch("app.integrations.communication.twilio.httpx.Client", fake):
        result = _adapter().place_outbound_call(TEST_PHONE, {"session_id": "s"})
    assert result.data["error_code"] == "TWILIO_TIMEOUT" and len(fake.requests) == 1


@pytest.mark.parametrize(
    "overrides, code",
    [
        ({"auth_token": None}, "TWILIO_NOT_CONFIGURED"),
        ({"stream_url": None}, "TWILIO_STREAM_URL_INVALID"),
        ({"stream_url": "ws://localhost:8000/voice/twilio/stream"}, "TWILIO_STREAM_URL_INVALID"),
        ({"callback_url": None}, "TWILIO_CALLBACK_URL_INVALID"),
    ],
)
def test_call_configuration_errors_are_actionable(overrides, code):
    fake = _FakeHttpClient()
    with patch("app.integrations.communication.twilio.httpx.Client", fake):
        result = _adapter(**overrides).place_outbound_call(TEST_PHONE, {"session_id": "s"})
    assert result.data["error_code"] == code and not fake.requests


def test_stream_token_verification():
    token = sign_stream_session("att-1:1")
    assert verify_stream_token("att-1:1", token)
    assert not verify_stream_token("att-1:2", token)
    assert not verify_stream_token("att-1:1", None)
    assert "<Stream url=" in build_stream_twiml("wss://x", {"a": "1"})


# ---------------------------------------------------------------------------
# 4-6. Independent statuses, duplicate protection, partial success & retry
# ---------------------------------------------------------------------------

def test_approve_sends_each_channel_once_and_persists_ids(test_client, db_session, setup, providers):
    res = _select_and_approve(test_client, setup)
    assert res.status_code == 200
    comm = res.json()["candidate_data"]["communication"]
    assert comm["whatsapp_status"] == "ACCEPTED" and comm["call_status"] == "QUEUED"
    assert comm["contact_name"] == "Test Contact" and comm["phone"] == "+91******0001"

    providers.wa.assert_called_once()
    to, message = providers.wa.call_args.args
    assert to == TEST_PHONE and message.startswith("Hello Test Contact, I am contacting you on behalf of the organizer of Delhi Product Launch.")
    call_to, params = providers.call.call_args.args
    assert call_to == TEST_PHONE and params["event_name"] == "Delhi Product Launch" and params["vendor_name"] == "Test Contact"

    assert _attempt(db_session, setup.entry, "WHATSAPP").provider_ref == "true_919000000001@c.us_3EB0TEST"
    assert _attempt(db_session, setup.entry, "CALL").provider_ref.startswith("CA")

    # Double-click / repeated request: nothing is re-sent.
    again = test_client.post(
        f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/approve-communication", headers=HEADERS
    )
    assert again.status_code == 200
    assert providers.wa.call_count == 1 and providers.call.call_count == 1


def test_in_flight_channel_is_not_claimed_twice(db_session, setup, providers):
    service = VendorOutreachService(db_session)
    setup.entry.status = "SELECTED"
    db_session.add(CommunicationAttempt(
        event_id=setup.event.id, shortlist_entry_id=setup.entry.id, channel="WHATSAPP",
        status="SENDING", attempt_count=1, last_attempt_at=datetime.now(), details={},
    ))
    db_session.commit()
    service.start_outreach(setup.event, setup.entry, actor_id=OWNER, channels=["WHATSAPP"])
    assert providers.wa.call_count == 0


def test_partial_success_retry_only_resends_failed_channel(test_client, db_session, setup, providers):
    providers.call.return_value = _fail("Twilio rejected the call: unverified", "TWILIO_21219")
    comm = _select_and_approve(test_client, setup).json()["candidate_data"]["communication"]
    assert comm["whatsapp_status"] == "ACCEPTED" and comm["call_status"] == "FAILED"
    assert comm["overall_status"] == "PARTIAL"
    assert comm["channels"]["call"]["retryable"] is True
    assert comm["channels"]["whatsapp"]["retryable"] is False

    base = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication"
    # The successful WhatsApp cannot be retried.
    assert test_client.post(f"{base}/whatsapp/retry", headers=HEADERS).status_code == 409

    providers.call.return_value = _call_ok("CAretry")
    retried = test_client.post(f"{base}/call/retry", headers=HEADERS)
    assert retried.status_code == 200
    assert retried.json()["candidate_data"]["communication"]["call_status"] == "QUEUED"
    assert providers.wa.call_count == 1 and providers.call.call_count == 2
    assert _attempt(db_session, setup.entry, "CALL").attempt_count == 2


def test_retry_rejects_unknown_channel(test_client, setup, providers):
    _select_and_approve(test_client, setup)
    res = test_client.post(
        f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication/sms/retry", headers=HEADERS
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# 7-8. Authentication and approval enforcement
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("user", ["anonymous_operator", "system", "agent-planner", "stranger-1", "collab-1"])
def test_only_identified_organizers_can_trigger_outreach(test_client, setup, providers, user):
    base = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}"
    test_client.post(f"{base}/select", headers=HEADERS)
    res = test_client.post(f"{base}/approve-communication", headers={"X-User-Id": user})
    assert res.status_code == 403
    assert providers.wa.call_count == 0 and providers.call.call_count == 0


def test_retry_requires_prior_approval(test_client, setup, providers):
    base = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}"
    test_client.post(f"{base}/select", headers=HEADERS)
    res = test_client.post(f"{base}/communication/call/retry", headers=HEADERS)
    assert res.status_code == 409
    assert providers.call.call_count == 0


def test_unselected_candidate_cannot_be_contacted(test_client, setup, providers):
    res = test_client.post(
        f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/approve-communication", headers=HEADERS
    )
    assert res.status_code == 400
    assert providers.wa.call_count == 0


# ---------------------------------------------------------------------------
# 9. Webhook signature verification & duplicate callbacks
# ---------------------------------------------------------------------------

@pytest.fixture
def twilio_env():
    with patch.object(settings, "TWILIO_AUTH_TOKEN", "secret-token"), \
         patch.object(settings, "TWILIO_ACCOUNT_SID", "ACtest"), \
         patch.object(settings, "TWILIO_CALLER_NUMBER", "+15550000000"), \
         patch.object(settings, "TWILIO_CALLBACK_URL", CALLBACK_URL):
        yield


def _post_status(client, call_sid, status, extra=None, signature=None):
    params = {"CallSid": call_sid, "CallStatus": status, **(extra or {})}
    sig = signature or _twilio_signature(CALLBACK_URL, params, "secret-token")
    return client.post(
        "/api/v1/voice/twilio/status",
        content=urlencode(params),
        headers={"Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig},
    )


def test_call_status_callbacks_advance_and_ignore_duplicates(test_client, db_session, setup, providers, twilio_env):
    _select_and_approve(test_client, setup)
    sid = _attempt(db_session, setup.entry, "CALL").provider_ref

    assert _post_status(test_client, sid, "ringing").status_code == 204
    assert _post_status(test_client, sid, "in-progress").status_code == 204
    assert _post_status(test_client, sid, "ringing").status_code == 204  # late/out-of-order
    db_session.expire_all()
    assert _attempt(db_session, setup.entry, "CALL").status == "IN_PROGRESS"

    VendorOutreachService(db_session).record_call_conversation(
        _attempt(db_session, setup.entry, "CALL").id,
        transcript=[{"speaker": "AGENT", "text": "Hello, I am an AI assistant."}],
        outcome=None, duration_seconds=30, error=None,
    )
    _post_status(test_client, sid, "completed", {"CallDuration": "42"})
    _post_status(test_client, sid, "completed", {"CallDuration": "42"})  # duplicate
    _post_status(test_client, sid, "failed")  # after a terminal state
    db_session.expire_all()
    attempt = _attempt(db_session, setup.entry, "CALL")
    assert attempt.status == "COMPLETED" and attempt.details["duration_seconds"] == 42


def test_call_that_ends_before_ai_speaks_is_reported_and_retryable(test_client, db_session, setup, providers, twilio_env):
    _select_and_approve(test_client, setup)
    sid = _attempt(db_session, setup.entry, "CALL").provider_ref
    _post_status(test_client, sid, "completed", {"CallDuration": "13"})
    call = test_client.get(f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication").json()["call"]
    assert call["status"] == "NO_CONVERSATION" and call["retryable"] is True
    assert "no key was pressed" in call["error"] and "tunnel" in call["error"]

    # Retrying starts a clean attempt: nothing from the previous call carries over.
    providers.call.return_value = _call_ok("CAsecond")
    res = test_client.post(
        f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication/call/retry", headers=HEADERS
    )
    assert res.status_code == 200
    db_session.expire_all()
    attempt = _attempt(db_session, setup.entry, "CALL")
    assert attempt.provider_ref == "CAsecond" and "duration_seconds" not in attempt.details


def test_transcript_arriving_after_completed_callback_marks_call_completed(test_client, db_session, setup, providers, twilio_env):
    _select_and_approve(test_client, setup)
    attempt = _attempt(db_session, setup.entry, "CALL")
    _post_status(test_client, attempt.provider_ref, "completed", {"CallDuration": "40"})
    VendorOutreachService(db_session).record_call_conversation(
        attempt.id, transcript=[{"speaker": "VENDOR", "text": "Yes"}], outcome=None, duration_seconds=35, error=None,
    )
    db_session.expire_all()
    attempt = _attempt(db_session, setup.entry, "CALL")
    assert attempt.status == "COMPLETED" and attempt.error is None


def test_call_no_answer_is_retryable(test_client, db_session, setup, providers, twilio_env):
    _select_and_approve(test_client, setup)
    sid = _attempt(db_session, setup.entry, "CALL").provider_ref
    _post_status(test_client, sid, "no-answer")
    summary = test_client.get(
        f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication"
    ).json()
    assert summary["call"]["status"] == "NO_ANSWER" and summary["call"]["retryable"] is True
    assert summary["whatsapp"]["status"] == "ACCEPTED"


def test_call_status_callback_rejects_bad_signature(test_client, db_session, setup, providers, twilio_env):
    _select_and_approve(test_client, setup)
    sid = _attempt(db_session, setup.entry, "CALL").provider_ref
    res = _post_status(test_client, sid, "completed", signature="forged")
    assert res.status_code == 403
    db_session.expire_all()
    assert _attempt(db_session, setup.entry, "CALL").status == "QUEUED"


def test_whatsapp_acks_move_forward_only(test_client, db_session, setup, providers):
    _select_and_approve(test_client, setup)
    msg_id = _attempt(db_session, setup.entry, "WHATSAPP").provider_ref
    with patch.object(settings, "OPENWA_WEBHOOK_SECRET", "hook-secret"):
        def ack(value, token="hook-secret"):
            return test_client.post(
                f"/api/webhooks/openwa?token={token}",
                json={"event": "onAck", "data": {"id": msg_id, "ack": value}},
            )
        assert ack(2).json()["matched"] is True
        assert ack(1).status_code == 200  # stale ack after DELIVERED
        assert ack(3, token="wrong").status_code == 403
    db_session.expire_all()
    assert _attempt(db_session, setup.entry, "WHATSAPP").status == "DELIVERED"


def test_whatsapp_ack_refresh_via_status_endpoint(test_client, db_session, setup, providers):
    _select_and_approve(test_client, setup)
    with patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.get_message_ack", return_value=3):
        summary = test_client.get(
            f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication?refresh=true"
        ).json()
    assert summary["whatsapp"]["status"] == "READ"


# ---------------------------------------------------------------------------
# 10. Persistence & state restoration
# ---------------------------------------------------------------------------

def test_status_survives_reload_via_operations_snapshot(test_client, db_session, setup, providers):
    from app.services.autonomous_operations_service import AutonomousOperationsService

    _select_and_approve(test_client, setup)
    snapshot = AutonomousOperationsService(db_session).get_operations_status(setup.event.id)
    rec = next(r for r in snapshot["recommendations"] if r["candidate_id"] == setup.entry.candidate_id)
    channels = rec["communication_approval"]["channels"]
    assert channels["whatsapp"]["status"] == "ACCEPTED" and channels["call"]["status"] == "QUEUED"
    assert "message_text" in channels["whatsapp"]


def test_ai_call_transcript_and_outcome_are_persisted(test_client, db_session, setup, providers):
    _select_and_approve(test_client, setup)
    attempt = _attempt(db_session, setup.entry, "CALL")
    VendorOutreachService(db_session).record_call_conversation(
        attempt.id,
        transcript=[{"speaker": "AGENT", "text": "Hi, I am an AI assistant."}, {"speaker": "VENDOR", "text": "Yes, available."}],
        outcome={"outcome": "AVAILABLE", "estimated_price": "25000 INR"},
        duration_seconds=61.2,
        error=None,
    )
    call = test_client.get(
        f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication"
    ).json()["call"]
    assert call["conversation_outcome"]["estimated_price"] == "25000 INR"
    assert call["transcript"][0]["text"].startswith("Hi, I am an AI assistant")
    # Contacting a vendor is never treated as a booking.
    db_session.refresh(setup.entry)
    assert setup.entry.status == "SELECTED"


# ---------------------------------------------------------------------------
# Regression: selecting a non-vendor candidate must not violate vendor FKs
# ---------------------------------------------------------------------------

def test_selecting_venue_candidate_does_not_create_vendor_assignment(test_client, db_session, setup):
    from app.models.vendor_assignment import VendorAssignment

    entry = EventShortlistEntry(
        event_id=setup.event.id, candidate_id="venue-x", provider_id="not-a-vendor-id",
        category="VENUE", candidate_name="Some Venue", status="RECOMMENDED", candidate_data={},
    )
    db_session.add(entry)
    db_session.commit()
    res = test_client.post(f"/api/events/{setup.event.id}/shortlist/venue-x/select", headers=HEADERS)
    assert res.status_code == 200
    assert db_session.query(VendorAssignment).filter(VendorAssignment.vendor_id == "not-a-vendor-id").count() == 0


# ---------------------------------------------------------------------------
# Negotiation within budget (limits stay server-side) & multilingual prompt
# ---------------------------------------------------------------------------

from app.services.vendor_outreach_service import evaluate_vendor_price, negotiation_limits  # noqa: E402


def test_limits_come_from_category_budget_line(db_session, setup):
    from app.models.budget import BudgetItem

    db_session.add(BudgetItem(event_id=setup.event.id, name="Photography Budget", category="PHOTOGRAPHY",
                              estimated_amount=30000, actual_amount=5000, currency="INR"))
    db_session.commit()
    limits = negotiation_limits(db_session, setup.event, setup.vendor.id, "PHOTOGRAPHY")
    assert limits == {"target": 20000, "max": 25000, "currency": "INR", "source": "CATEGORY_BUDGET"}


def test_organizer_limits_on_assignment_take_priority(db_session, setup):
    from app.models.budget import BudgetItem
    from app.models.vendor_assignment import VendorAssignment

    db_session.add(BudgetItem(event_id=setup.event.id, name="Music", category="MUSIC", estimated_amount=9000, currency="INR"))
    db_session.add(VendorAssignment(event_id=setup.event.id, vendor_id=setup.vendor.id, category="dj_music",
                                    target_amount=12000, max_approved_amount=15000, currency="INR"))
    db_session.commit()
    limits = negotiation_limits(db_session, setup.event, setup.vendor.id, "DJ_MUSIC")
    assert limits["source"] == "ORGANIZER_LIMIT" and limits["max"] == 15000 and limits["target"] == 12000
    # Without the assignment, DJ_MUSIC maps to the MUSIC budget line.
    assert negotiation_limits(db_session, setup.event, None, "DJ_MUSIC")["max"] == 9000


def test_no_budget_means_inquiry_only(db_session, setup):
    assert negotiation_limits(db_session, setup.event, setup.vendor.id, "PHOTOGRAPHY") is None


def test_price_evaluation_counters_up_to_but_never_above_the_ceiling():
    limits = {"target": 20000, "max": 25000, "currency": "INR"}
    assert evaluate_vendor_price(limits, 24000, 0)["decision"] == "WITHIN_BUDGET"
    offers = [evaluate_vendor_price(limits, 40000, n) for n in range(3)]
    assert [o["counter_offer"] for o in offers] == [20000, 22500, 25000]
    assert offers[-1]["is_final_offer"] is True
    assert evaluate_vendor_price(limits, 40000, 3)["decision"] == "ABOVE_BUDGET"
    for o in offers:
        assert "budget" not in o["instruction"].split("Never mention")[0].lower()


def test_counter_rounding_never_exceeds_ceiling():
    limits = {"target": 920, "max": 1150, "currency": "INR"}
    offers = [evaluate_vendor_price(limits, 2000, n)["counter_offer"] for n in range(3)]
    assert max(offers) <= 1150
    far = [evaluate_vendor_price(limits, 5000, n).get("counter_offer") for n in range(3)]
    assert far[0] <= 1150 and far[1:] == [None, None]
    limits = {"target": 9200, "max": 11550, "currency": "INR"}
    assert all(evaluate_vendor_price(limits, 20000, n)["counter_offer"] <= 11550 for n in range(3))


def test_prompt_is_multilingual_and_carries_no_price_limits():
    from app.integrations.communication.gemini_bridge import build_vendor_system_prompt
    from app.integrations.communication.voice_context_builder import SanitizedVoiceContext

    ctx = SanitizedVoiceContext(session_id="s", event_name="Launch", vendor_name="Test Contact", service_category="photography")
    prompt = build_vendor_system_prompt(ctx, price_tool=True)
    assert "same language" in prompt and "Hinglish" in prompt
    assert "evaluate_vendor_price" in prompt
    # The builder never receives the limits; the prompt only carries the rule not to mention one.
    assert "Never mention a budget, maximum, limit or ceiling" in prompt
    assert "target rate" not in prompt


def test_bridge_price_tool_uses_server_limits_and_logs_rounds():
    from app.integrations.communication.gemini_bridge import GeminiLiveBridge
    from app.integrations.communication.exotel_gateway import ExotelVoiceSession

    bridge = GeminiLiveBridge(session=ExotelVoiceSession(websocket=MagicMock()))
    bridge.negotiation_limits = {"target": 20000, "max": 25000, "currency": "INR", "source": "CATEGORY_BUDGET"}
    first = bridge._evaluate_price({"price": 40000})
    second = bridge._evaluate_price({"price": 30000})
    third = bridge._evaluate_price({"price": 25000})
    assert first["counter_offer"] == 20000 and second["counter_offer"] == 22500
    assert third["decision"] == "WITHIN_BUDGET"
    assert [r["decision"] for r in bridge.negotiation_log] == ["COUNTER", "COUNTER", "WITHIN_BUDGET"]
    assert bridge._evaluate_price({"price": "twenty"})["decision"] == "UNCLEAR"


def test_call_dispatch_stores_limits_server_side_only(test_client, db_session, setup, providers):
    from app.models.budget import BudgetItem

    db_session.add(BudgetItem(event_id=setup.event.id, name="Photography Budget", category="PHOTOGRAPHY",
                              estimated_amount=30000, currency="INR"))
    db_session.commit()
    _select_and_approve(test_client, setup)
    _, params = providers.call.call_args.args
    assert not any(k for k in params if "max" in k or "budget" in k or "negotiation" in k)
    assert "30000" not in str(params.values()) and "24000" not in str(params.values())
    assert _attempt(db_session, setup.entry, "CALL").details["negotiation_limits"]["max"] == 30000


def test_quote_far_above_ceiling_gets_one_final_offer_then_polite_close():
    # Live call: vendor quoted 50,000 against a ~1,125 ceiling; tiny step-ups would waste the call.
    limits = {"target": 900, "max": 1125, "currency": "INR"}
    first = evaluate_vendor_price(limits, 50000, 0)
    assert first["decision"] == "COUNTER" and first["is_final_offer"] is True
    assert first["counter_offer"] <= 1125
    closing = evaluate_vendor_price(limits, 50000, 1)
    assert closing["decision"] == "ABOVE_BUDGET" and "end_call" in closing["instruction"]
    assert "50000" in closing["instruction"]


def test_vendor_refusal_without_new_price_advances_negotiation():
    """Regression: 'itne mein nahi hoga' with no number left the agent with no next step."""
    from app.integrations.communication.gemini_bridge import GeminiLiveBridge
    from app.integrations.communication.exotel_gateway import ExotelVoiceSession

    bridge = GeminiLiveBridge(session=ExotelVoiceSession(websocket=MagicMock()))
    bridge.negotiation_limits = {"target": 20000, "max": 25000, "currency": "INR", "source": "CATEGORY_BUDGET"}
    assert bridge._evaluate_price({"price": 40000})["counter_offer"] == 20000
    refused = bridge._evaluate_price({"vendor_refused": True})
    assert refused["decision"] == "COUNTER" and refused["counter_offer"] == 22500
    assert bridge.negotiation_log[-1]["vendor_price"] == 40000 and bridge.negotiation_log[-1]["vendor_refused"]
    bridge._evaluate_price({"vendor_refused": True})
    assert bridge._evaluate_price({"vendor_refused": True})["decision"] == "ABOVE_BUDGET"
    # A refusal before any quote asks for the price instead of stalling.
    fresh = GeminiLiveBridge(session=ExotelVoiceSession(websocket=MagicMock()))
    fresh.negotiation_limits = bridge.negotiation_limits
    assert fresh._evaluate_price({"vendor_refused": True})["decision"] == "UNCLEAR"


def test_prompt_tells_agent_how_to_handle_refusals_and_never_go_silent():
    from app.integrations.communication.gemini_bridge import build_vendor_system_prompt
    from app.integrations.communication.voice_context_builder import SanitizedVoiceContext

    prompt = build_vendor_system_prompt(SanitizedVoiceContext(session_id="s", vendor_name="X"), price_tool=True)
    assert "vendor_refused=true" in prompt and "Never stay silent" in prompt


@pytest.mark.asyncio
async def test_silence_watchdog_nudges_model_when_vendor_is_left_waiting():
    import time as _time
    from app.integrations.communication import gemini_bridge as gb
    from app.integrations.communication.exotel_gateway import ExotelVoiceSession

    bridge = gb.GeminiLiveBridge(session=ExotelVoiceSession(websocket=MagicMock()))
    bridge._is_running = True
    session = MagicMock()
    sent = []

    async def send_client_content(turns=None, turn_complete=True):
        sent.append(turns)
        if len(sent) >= gb.SILENCE_MAX_NUDGES:
            bridge._is_running = False

    session.send_client_content = send_client_content
    # Agent spoke, then the vendor spoke and the agent never answered.
    bridge._last_agent_activity_at = _time.monotonic() - 10
    bridge._last_vendor_speech_at = _time.monotonic() - 5
    with patch.object(gb, "SILENCE_CHECK_INTERVAL", 0.01), patch.object(gb.settings, "VOICE_SILENCE_NUDGE_SECONDS", 0.05):
        await asyncio.wait_for(bridge._silence_watchdog(session), timeout=2)
    assert len(sent) == gb.SILENCE_MAX_NUDGES
    assert "vendor_refused=true" in sent[0].parts[0].text


def test_silence_watchdog_stays_quiet_while_agent_is_answering():
    import time as _time
    from app.integrations.communication.gemini_bridge import GeminiLiveBridge
    from app.integrations.communication.exotel_gateway import ExotelVoiceSession

    bridge = GeminiLiveBridge(session=ExotelVoiceSession(websocket=MagicMock()))
    now = _time.monotonic()
    bridge._last_vendor_speech_at = now - 10
    bridge._last_agent_activity_at = now - 1  # agent replied after the vendor
    assert not bridge._agent_owes_reply(now)
    bridge._last_vendor_speech_at = now - 1  # vendor still talking / just finished
    bridge._last_agent_activity_at = now - 10
    assert not bridge._agent_owes_reply(now)


# ---------------------------------------------------------------------------
# Call verdicts, calling again, and understanding vendor replies
# ---------------------------------------------------------------------------

from app.services.vendor_outreach_service import call_verdict  # noqa: E402
from app.services import vendor_reply_analysis as vra  # noqa: E402


def _neg(decision, rounds):
    return {"negotiation": {"final_decision": decision, "rounds": rounds}}


def test_finished_call_never_stays_counter_offer_pending():
    """Live call: vendor quoted 50,000, refused the 900 counter and the call ended."""
    v = call_verdict("COMPLETED", _neg("COUNTER", [{"vendor_price": 50000, "counter_offer": 900, "decision": "COUNTER"}]))
    assert v["code"] == "NO_AGREEMENT" and "50,000" in v["detail"] and "900" in v["detail"]
    assert call_verdict("COMPLETED", _neg("WITHIN_BUDGET", [{"vendor_price": 22500}]))["code"] == "AGREED"
    over = call_verdict("COMPLETED", _neg("ABOVE_BUDGET", [{"vendor_price": 50000, "counter_offer": 1100}, {"vendor_price": 50000}]))
    assert over["code"] == "OVER_BUDGET" and "1,100" in over["detail"]
    assert call_verdict("RINGING", {}) is None
    assert call_verdict("COMPLETED", {"transcript_analysis": {"decision": "NO", "summary": "Busy that day"}})["code"] == "DECLINED"


def test_completed_call_can_be_called_again_and_keeps_history(test_client, db_session, setup, providers, twilio_env):
    _select_and_approve(test_client, setup)
    attempt = _attempt(db_session, setup.entry, "CALL")
    VendorOutreachService(db_session).record_call_conversation(
        attempt.id, transcript=[{"speaker": "VENDOR", "text": "50 hazaar"}], outcome=None, duration_seconds=60, error=None,
        negotiation={"final_decision": "COUNTER", "rounds": [{"vendor_price": 50000, "counter_offer": 900, "decision": "COUNTER"}]},
    )
    _post_status(test_client, attempt.provider_ref, "completed", {"CallDuration": "70"})
    url = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication"
    call = test_client.get(url).json()["call"]
    assert call["status"] == "COMPLETED" and call["can_call_again"] is True
    assert call["verdict"]["code"] == "NO_AGREEMENT"

    providers.call.return_value = _call_ok("CAagain")
    assert test_client.post(f"{url}/call/retry", headers=HEADERS).status_code == 200
    assert providers.call.call_count == 2
    call = test_client.get(url).json()["call"]
    # The new call starts clean; the previous result is kept in history.
    assert call["provider_ref"] == "CAagain" and call["transcript"] == [] and call["negotiation"] is None
    assert len(call["history"]) == 1 and call["history"][0]["verdict"]["code"] == "NO_AGREEMENT"
    assert call["history"][0]["transcript"][0]["text"] == "50 hazaar"


def test_whatsapp_reply_is_read_and_understood(test_client, db_session, setup, providers):
    _select_and_approve(test_client, setup)
    url = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication"
    replies = [{"id": "r1", "text": "Haan ji available hoon, 30 hazaar lagega", "t": 2}]
    llm = {"decision": "YES", "available": True, "quoted_price": 30000, "summary": "Available, asks 30,000", "language": "Hinglish", "method": "AI"}
    with patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.get_replies_after", return_value=replies), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.get_message_ack", return_value=2), \
         patch.object(vra, "_llm_analysis", return_value=llm):
        wa = test_client.get(url, params={"refresh": True}).json()["whatsapp"]
    assert wa["status"] == "REPLIED"
    assert wa["replies"][0]["text"].startswith("Haan ji")
    assert wa["reply_analysis"]["decision"] == "YES" and wa["reply_analysis"]["quoted_price"] == 30000
    assert providers.wa.call_count == 1  # reading a reply never sends anything


def test_reply_price_is_checked_against_server_limits():
    limits = {"target": 20000, "max": 25000, "currency": "INR"}
    with patch.object(vra, "_llm_analysis", return_value=None):
        high = vra.analyze_vendor_reply("Haan available, 40 hazaar lagega", limits=limits)
        no = vra.analyze_vendor_reply("Nahi bhai, us din booked hoon")
    assert high["decision"] == "YES" and high["quoted_price"] == 40000
    assert high["price_check"] == "COUNTER" and high["suggested_counter"] == 20000
    assert no["decision"] == "NO" and "another vendor" in no["next_step"]
    assert vra._keyword_analysis("₹900 में तो नहीं हो पाएगा")["decision"] == "NO"


def test_keyword_fallback_ignores_years_and_reads_only_vendor_lines():
    assert vra._keyword_analysis("Available on 30 October 2026")["quoted_price"] is None
    assert vra._keyword_analysis("Rs 2026 only")["quoted_price"] == 2026
    transcript = [
        {"speaker": "AGENT", "text": "Are you available on 30 October 2026? We can offer 900."},
        {"speaker": "VENDOR", "text": "Price about 50,000"},
        {"speaker": "VENDOR", "text": "₹900 में तो नहीं हो पाएगा भाई।"},
    ]
    with patch.object(vra, "_llm_analysis", return_value=None):
        result = vra.analyze_vendor_reply(
            vra.transcript_text(transcript), vendor_only_text=vra.transcript_text(transcript, speaker="VENDOR")
        )
    assert result["decision"] == "NO" and result["quoted_price"] == 50000


def test_followup_draft_is_never_sent_and_send_requires_explicit_request(test_client, db_session, setup, providers):
    from app.models.budget import BudgetItem

    db_session.add(BudgetItem(event_id=setup.event.id, name="Photography", category=setup.entry.category,
                              estimated_amount=25000, currency="INR"))
    db_session.commit()
    _select_and_approve(test_client, setup)
    base = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication/whatsapp"
    replies = [{"id": "r1", "text": "yes available, 40 hazaar", "t": 5}]
    llm = {"decision": "YES", "available": True, "quoted_price": 40000, "summary": "", "language": "Hinglish", "method": "AI"}
    with patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.get_replies_after", return_value=replies), \
         patch("app.integrations.whatsapp.client.OpenWACommunicationAdapter.get_message_ack", return_value=3), \
         patch.object(vra, "_llm_analysis", return_value=llm):
        test_client.get(base.rsplit("/whatsapp", 1)[0], params={"refresh": True})

    with patch.object(vra.settings, "GEMINI_API_KEY", None), patch.object(vra.settings, "LLM_API_KEY", None):
        draft = test_client.get(f"{base}/draft", headers=HEADERS).json()
    assert draft["method"] == "TEMPLATE" and "counter-offer" in draft["goal"]
    assert providers.wa.call_count == 1  # drafting sent nothing

    providers.wa.return_value = _wa_ok("true_followup_1")
    res = test_client.post(f"{base}/send", json={"text": draft["text"]}, headers=HEADERS)
    assert res.status_code == 200
    assert providers.wa.call_count == 2 and providers.wa.call_args.args[1] == draft["text"]
    wa = res.json()["whatsapp"]
    assert wa["followups"][-1]["message_id"] == "true_followup_1" and wa["status"] == "REPLIED"


def test_followup_cannot_be_sent_by_others_or_before_approval(test_client, setup, providers):
    base = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}"
    test_client.post(f"{base}/select", headers=HEADERS)
    assert test_client.post(f"{base}/communication/whatsapp/send", json={"text": "hi"}, headers=HEADERS).status_code == 409
    test_client.post(f"{base}/approve-communication", headers=HEADERS)
    res = test_client.post(f"{base}/communication/whatsapp/send", json={"text": "hi"}, headers={"X-User-Id": "stranger-1"})
    assert res.status_code == 403
    assert providers.wa.call_count == 1  # only the approved initial message


def test_followup_send_failure_is_reported_not_faked(test_client, setup, providers):
    _select_and_approve(test_client, setup)
    providers.wa.return_value = _fail("The WhatsApp session is not connected (state: UNPAIRED).")
    base = f"/api/events/{setup.event.id}/shortlist/{setup.entry.candidate_id}/communication"
    res = test_client.post(f"{base}/whatsapp/send", json={"text": "hi"}, headers=HEADERS)
    assert res.status_code == 502 and "not connected" in res.json()["detail"]
    assert test_client.get(base).json()["whatsapp"]["followups"] == []
