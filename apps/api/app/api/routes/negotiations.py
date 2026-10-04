"""API Routes for Live Negotiation Screen & Realtime Operations.

Enables organizers to observe autonomous negotiations in real time, view budget
caps vs. current vendor offers, take over / resume / cancel the agent, and receive
live SSE stream updates.
"""
import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.core.config import settings
from app.core.serialization import eventra_json_dumps
from app.engines.auth.policy import ApprovalPolicy
from app.core.exceptions import ConflictException, ForbiddenException, NotFoundException
from app.models.approval import ApprovalRequest
from app.models.communication import Conversation, Message
from app.models.event import Event
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.schemas.negotiation import (
    NegotiationActionResponse,
    NegotiationCancelRequest,
    NegotiationMessage,
    NegotiationSummaryResponse,
    NegotiationTimelineResponse,
)
from app.services.authorization_service import AuthorizationService
from app.services.negotiation_broker import negotiation_broker
from app.services.negotiation_service import NegotiationService
from app.services.quote_extraction_service import QuoteExtractionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["Negotiations"])


def verify_organizer_role(db: Session, event_id: str, user_id: str) -> Event:
    """Verifies that the caller has authoritative organizer role for the event."""
    auth_service = AuthorizationService(db)
    try:
        event = auth_service.get_event(event_id)
        role = auth_service.get_user_role(event, user_id)
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except ForbiddenException as fe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(fe))

    if not ApprovalPolicy.is_eligible_approver(role, "MAJOR"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Role '{role}' is not authorized to control negotiations for event '{event_id}'.",
        )
    return event


# -------------------------------------------------------------------------
# Control Endpoints (Take Over, Resume, Cancel)
# -------------------------------------------------------------------------

@router.post(
    "/{event_id}/negotiations/{assignment_id}/take-over",
    response_model=NegotiationActionResponse,
    status_code=status.HTTP_200_OK,
)
def take_over_negotiation(
    event_id: str,
    assignment_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> NegotiationActionResponse:
    """Transfers negotiation authority from AGENT to HUMAN organizer.

    - Sets negotiation_control to 'HUMAN'
    - Prevents agent from sending outbound messages or counters
    - Terminates any active voice call immediately
    - Emits 'control_changed' event on SSE stream
    - Records authoritative audit record NEGOTIATION_TAKEOVER
    """
    verify_organizer_role(db, event_id, current_user_id)
    service = NegotiationService(db)
    try:
        result = service.take_over(assignment_id, user_id=current_user_id)
        return NegotiationActionResponse(
            assignment_id=result["assignment_id"],
            negotiation_control=result["negotiation_control"],
            control_changed_by=result.get("control_changed_by"),
            control_changed_at=result.get("control_changed_at"),
            status=result["status"],
            message=result["message"],
        )
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except (ConflictException, ValueError) as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@router.post(
    "/{event_id}/negotiations/{assignment_id}/resume",
    response_model=NegotiationActionResponse,
    status_code=status.HTTP_200_OK,
)
def resume_negotiation(
    event_id: str,
    assignment_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> NegotiationActionResponse:
    """Restores autonomous AGENT control over negotiation.

    - Sets negotiation_control to 'AGENT'
    - Allows the autonomous agent to resume counter-offering
    - Emits 'control_changed' event on SSE stream
    - Records authoritative audit record NEGOTIATION_RESUME
    """
    verify_organizer_role(db, event_id, current_user_id)
    service = NegotiationService(db)
    try:
        result = service.resume(assignment_id, user_id=current_user_id)
        return NegotiationActionResponse(
            assignment_id=result["assignment_id"],
            negotiation_control=result["negotiation_control"],
            control_changed_by=result.get("control_changed_by"),
            control_changed_at=result.get("control_changed_at"),
            status=result["status"],
            message=result["message"],
        )
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except (ConflictException, ValueError) as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


@router.post(
    "/{event_id}/negotiations/{assignment_id}/cancel",
    response_model=NegotiationActionResponse,
    status_code=status.HTTP_200_OK,
)
def cancel_negotiation(
    event_id: str,
    assignment_id: str,
    payload: Optional[NegotiationCancelRequest] = None,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> NegotiationActionResponse:
    """Terminates negotiation and marks assignment DECLINED / CANCELLED.

    - Stops negotiation immediately
    - Marks assignment status DECLINED
    - Terminates any active voice session
    - Emits 'status_changed' event on SSE stream
    - Records authoritative audit record NEGOTIATION_CANCEL
    """
    verify_organizer_role(db, event_id, current_user_id)
    service = NegotiationService(db)
    reason = payload.reason if payload else "Cancelled by organizer"
    try:
        result = service.cancel(assignment_id, user_id=current_user_id, reason=reason)
        return NegotiationActionResponse(
            assignment_id=result["assignment_id"],
            negotiation_control=result["negotiation_control"],
            control_changed_by=result.get("control_changed_by"),
            control_changed_at=result.get("control_changed_at"),
            status=result["status"],
            message=result["message"],
        )
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except (ConflictException, ValueError) as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))


# -------------------------------------------------------------------------
# Timeline & Overview Endpoints (Task 2)
# -------------------------------------------------------------------------

@router.get(
    "/{event_id}/negotiations/{assignment_id}/live",
    response_model=NegotiationTimelineResponse,
    status_code=status.HTTP_200_OK,
)
def get_negotiation_live_timeline(
    event_id: str,
    assignment_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> NegotiationTimelineResponse:
    """Returns authoritative, UI-ready live state and conversation transcript.

    Reuses NegotiationService.get_conversation() to guarantee deterministic
    state consistency without duplicating business logic.
    """
    verify_organizer_role(db, event_id, current_user_id)
    service = NegotiationService(db)
    try:
        data = service.get_conversation(assignment_id)
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))

    assignment: VendorAssignment = data["assignment"]
    if assignment.event_id != event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assignment '{assignment_id}' does not belong to event '{event_id}'.",
        )

    vendor = data.get("vendor")
    vendor_name = vendor.name if vendor else "Vendor"
    vendor_type = getattr(vendor, "category", None) or "General"

    # Normalize messages from comms history and DB
    raw_messages: List[Dict[str, Any]] = data.get("messages", [])
    extractor = QuoteExtractionService()

    normalized_messages: List[NegotiationMessage] = []
    seen_ids = set()
    latest_counter = None

    for m in raw_messages:
        mid = str(m.get("id") or f"msg_{time.time()}")
        if mid in seen_ids:
            continue
        seen_ids.add(mid)

        text = m.get("text") or m.get("message") or ""
        sender_type = m.get("sender_type")
        direction = m.get("direction", "")

        if not sender_type:
            if direction.upper() == "INBOUND":
                sender_type = "VENDOR"
            elif direction.upper() == "OUTBOUND":
                sender_type = "AGENT"
            else:
                sender_type = "SYSTEM"
        else:
            sender_type = str(sender_type).upper()

        amt = m.get("amount_extracted") or m.get("extracted_amount")
        if amt is None and text:
            quote_res = extractor.extract_quote(text)
            if quote_res.amount:
                amt = quote_res.amount

        if sender_type == "AGENT" and amt is not None:
            latest_counter = amt

        ts = m.get("timestamp")
        if isinstance(ts, (int, float)):
            timestamp_val = float(ts)
        else:
            timestamp_val = time.time()

        channel = (m.get("channel") or "whatsapp").lower()
        if channel == "mock":
            channel = "whatsapp"

        normalized_messages.append(
            NegotiationMessage(
                id=mid,
                sender_type=sender_type,
                text=text,
                amount_extracted=float(amt) if amt is not None else None,
                timestamp=timestamp_val,
                channel=channel,
            )
        )

    # Also query DB messages in Conversation table if present
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.event_id == event_id,
            Conversation.vendor_id == assignment.vendor_id,
        )
        .first()
    )
    if conv:
        db_msgs = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.asc())
            .all()
        )
        for dm in db_msgs:
            dmid = dm.id
            if dmid in seen_ids:
                continue
            seen_ids.add(dmid)

            st = (dm.sender_type or "AGENT").upper()
            amt = None
            if dm.extracted_facts and isinstance(dm.extracted_facts, dict):
                amt = dm.extracted_facts.get("quoted_amount")
            if amt is None and dm.content:
                qr = extractor.extract_quote(dm.content)
                if qr.amount:
                    amt = qr.amount

            if st == "AGENT" and amt is not None:
                latest_counter = amt

            ts = dm.created_at.timestamp() if dm.created_at else time.time()
            chan = (dm.channel or "whatsapp").lower()

            normalized_messages.append(
                NegotiationMessage(
                    id=dmid,
                    sender_type=st,
                    text=dm.content,
                    amount_extracted=float(amt) if amt is not None else None,
                    timestamp=ts,
                    channel=chan,
                )
            )

    normalized_messages.sort(key=lambda x: x.timestamp)

    # Check for active or past approval request for this assignment
    approval = (
        db.query(ApprovalRequest)
        .filter(
            ApprovalRequest.event_id == event_id,
            ApprovalRequest.target_id == assignment.id,
        )
        .order_by(ApprovalRequest.created_at.desc())
        .first()
    )
    approval_id = approval.id if approval else None

    # Resolve latest counter from notes if not found in messages
    if latest_counter is None and assignment.notes:
        for entry in reversed(assignment.notes):
            if isinstance(entry, dict) and entry.get("action") == "NEGOTIATION_COUNTER_OFFER":
                details = entry.get("details", {})
                if details.get("counter_amount"):
                    latest_counter = float(details["counter_amount"])
                    break

    return NegotiationTimelineResponse(
        assignment_id=assignment.id,
        event_id=assignment.event_id,
        vendor_id=assignment.vendor_id,
        vendor_name=vendor_name,
        vendor_type=vendor_type,
        status=assignment.negotiation_status or assignment.status or "NOT_STARTED",
        round_number=assignment.negotiation_round or 0,
        control=getattr(assignment, "negotiation_control", "AGENT") or "AGENT",
        cap=float(assignment.max_approved_amount) if assignment.max_approved_amount is not None else None,
        target=float(assignment.target_amount) if assignment.target_amount is not None else None,
        latest_vendor_quote=float(assignment.quoted_amount) if assignment.quoted_amount is not None else None,
        latest_agent_counter=float(latest_counter) if latest_counter is not None else None,
        budget_validation=data.get("budget_validation"),
        approval_id=approval_id,
        conversation_id=conv.id if conv else None,
        messages=normalized_messages,
    )


@router.post(
    "/{event_id}/negotiations/{assignment_id}/message",
    response_model=NegotiationMessage,
    status_code=status.HTTP_201_CREATED,
)
def send_organizer_negotiation_message(
    event_id: str,
    assignment_id: str,
    payload: Dict[str, Any],
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> NegotiationMessage:
    """Sends a manual organizer message directly to the vendor during HUMAN takeover.

    Marks message sender_type as ORGANIZER and broadcasts message_added to the SSE stream.
    """
    verify_organizer_role(db, event_id, current_user_id)
    service = NegotiationService(db)
    assignment = service._get_assignment(assignment_id)
    if assignment.event_id != event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assignment '{assignment_id}' does not belong to event '{event_id}'.",
        )

    text = payload.get("text") or payload.get("raw_text") or ""
    channel = payload.get("channel") or "whatsapp"
    if not text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message text is required.")

    from app.services.conversation_service import ConversationService
    from app.services.provider_communication_service import ProviderCommunicationService

    conv_service = ConversationService(db)
    conv = conv_service.get_or_create_conversation(
        event_id=event_id,
        vendor_id=assignment.vendor_id,
        channel=channel,
    )

    comm_service = ProviderCommunicationService(db)
    send_res = comm_service.send_message(
        event_id=event_id,
        provider_id=assignment.vendor_id,
        message=text,
        recipient_contact=conv.recipient_contact,
        actor_id=current_user_id,
        actor_type="OPERATOR",
    )

    msg = conv_service.record_outbound_message(
        event_id=event_id,
        vendor_id=assignment.vendor_id,
        raw_text=text,
        channel=channel,
        recipient=conv.recipient_contact,
        sender="ORGANIZER",
        status="sent" if send_res.success else "failed",
    )

    amt = QuoteExtractionService().extract_quote(text).amount
    msg_id = msg.id if msg else f"msg_org_{time.time()}"
    ts = time.time()

    negotiation_broker.publish_sync(
        event_id=event_id,
        assignment_id=assignment.id,
        event_type="message_added",
        data={
            "id": msg_id,
            "sender_type": "ORGANIZER",
            "text": text,
            "amount_extracted": amt,
            "channel": channel,
            "timestamp": ts,
        },
    )

    return NegotiationMessage(
        id=msg_id,
        sender_type="ORGANIZER",
        text=text,
        amount_extracted=amt,
        timestamp=ts,
        channel=channel,
    )


@router.get(
    "/{event_id}/negotiations",
    response_model=List[NegotiationSummaryResponse],
    status_code=status.HTTP_200_OK,
)
def list_active_negotiations(
    event_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> List[NegotiationSummaryResponse]:
    """Lists all active and ongoing negotiations for an event."""
    verify_organizer_role(db, event_id, current_user_id)

    assignments = (
        db.query(VendorAssignment)
        .filter(VendorAssignment.event_id == event_id)
        .order_by(VendorAssignment.updated_at.desc())
        .all()
    )

    summaries: List[NegotiationSummaryResponse] = []
    for a in assignments:
        vendor = db.query(Vendor).filter(Vendor.id == a.vendor_id).first()
        vendor_name = vendor.name if vendor else "Vendor"
        category = getattr(vendor, "category", None) or "General"

        approval = (
            db.query(ApprovalRequest)
            .filter(
                ApprovalRequest.event_id == event_id,
                ApprovalRequest.target_id == a.id,
            )
            .order_by(ApprovalRequest.created_at.desc())
            .first()
        )

        summaries.append(
            NegotiationSummaryResponse(
                assignment_id=a.id,
                event_id=a.event_id,
                vendor_id=a.vendor_id,
                vendor_name=vendor_name,
                category=category,
                status=a.negotiation_status or a.status or "NOT_STARTED",
                control=getattr(a, "negotiation_control", "AGENT") or "AGENT",
                round_number=a.negotiation_round or 0,
                target_amount=float(a.target_amount) if a.target_amount is not None else None,
                max_approved_amount=float(a.max_approved_amount) if a.max_approved_amount is not None else None,
                quoted_amount=float(a.quoted_amount) if a.quoted_amount is not None else None,
                currency=a.currency or "INR",
                approval_id=approval.id if approval else None,
                updated_at=a.updated_at.isoformat() if a.updated_at else None,
            )
        )

    return summaries


# -------------------------------------------------------------------------
# Realtime Server-Sent Events (SSE) Stream (Task 3)
# -------------------------------------------------------------------------

@router.get(
    "/{event_id}/negotiations/stream",
)
async def stream_negotiation_events(
    event_id: str,
    assignment_id: Optional[str] = Query(None, description="Optional filter by assignment ID"),
    since: Optional[int] = Query(None, description="Cursor for historical replay"),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Authoritative SSE stream for live negotiation updates.

    Emits events:
    - message_added: Inbound vendor, outbound agent, or organizer chat message
    - quote_updated: New vendor offer extracted
    - counter_sent: Agent or organizer counter-offer sent
    - status_changed: Negotiation status changed (e.g. AWAITING_APPROVAL, CANCELLED)
    - control_changed: Authority flipped between AGENT and HUMAN
    - cap_blocked: Agent counter attempt blocked because it exceeded cap

    Supports Last-Event-ID and ?since cursor replay for seamless reconnections.
    """
    verify_organizer_role(db, event_id, current_user_id)

    # Determine replay cursor
    since_cursor = None
    if last_event_id:
        since_cursor = last_event_id
    elif since is not None:
        since_cursor = str(since)

    async def event_generator():
        # 1. Replay historical events if cursor requested
        if since_cursor is not None:
            history = negotiation_broker.get_history_since(
                event_id=event_id,
                assignment_id=assignment_id,
                since_id=since_cursor,
            )
            for ev in history:
                evt_type = ev.get("type", "update")
                evt_id = ev.get("id", "")
                payload = eventra_json_dumps(ev.get("data", {}))
                yield f"id: {evt_id}\nevent: {evt_type}\ndata: {payload}\n\n"

        # 2. Subscribe to real-time broker
        queue = await negotiation_broker.subscribe(event_id=event_id, assignment_id=assignment_id)
        try:
            # Emit initial connection frame
            init_frame = eventra_json_dumps(
                {
                    "type": "CONNECTED",
                    "event_id": event_id,
                    "assignment_id": assignment_id,
                    "timestamp": time.time(),
                }
            )
            yield f"event: connected\ndata: {init_frame}\n\n"

            while True:
                try:
                    event_msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    evt_type = event_msg.get("type", "update")
                    evt_id = event_msg.get("id", "")
                    payload = eventra_json_dumps(event_msg.get("data", {}))
                    yield f"id: {evt_id}\nevent: {evt_type}\ndata: {payload}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await negotiation_broker.unsubscribe(
                event_id=event_id, queue=queue, assignment_id=assignment_id
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# -------------------------------------------------------------------------
# Demo Mode Simulation Endpoint (Task 6)
# -------------------------------------------------------------------------

@router.post(
    "/{event_id}/negotiations/{assignment_id}/demo-simulation",
    status_code=status.HTTP_200_OK,
)
def run_demo_simulation(
    event_id: str,
    assignment_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Executes a realistic scripted vendor negotiation for hackathon demo.

    Scenario:
    1. Vendor replies with a price above target (e.g. 52,000 when cap is 50,000).
    2. Agent automatically computes counter-offer within budget ceiling and sends it.
    3. Vendor accepts counter or drops price within cap (e.g. 48,000).
    4. System creates an ApprovalRequest and transitions assignment to AWAITING_APPROVAL.

    Gated behind ENVIRONMENT != 'production' to guarantee zero production abuse.
    """
    if getattr(settings, "ENVIRONMENT", "").lower() == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo simulation is disabled in production environments.",
        )

    verify_organizer_role(db, event_id, current_user_id)
    service = NegotiationService(db)

    assignment = service._get_assignment(assignment_id)
    if assignment.event_id != event_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assignment '{assignment_id}' does not belong to event '{event_id}'.",
        )

    target = float(assignment.target_amount or 40000)
    ceiling = float(assignment.max_approved_amount or 50000)

    # Step 1: Initial high quote from vendor (above ceiling to trigger agent counter)
    initial_high = round(ceiling * 1.08, -2)
    res_1 = service.simulate_response(
        assignment_id=assignment_id,
        scenario="COUNTER",
        quoted_amount=initial_high,
        custom_message=f"Hello! We are available for your event. Our standard fee for full coverage is INR {initial_high:,.0f}.",
    )

    # If the assignment is still in negotiation (agent countered), simulate vendor agreeing within cap
    db.refresh(assignment)
    if assignment.negotiation_status in ("NEGOTIATING", "IN_PROGRESS", "OPEN", "QUOTATION_RECEIVED") or assignment.status in ("NEGOTIATING", "PENDING", "ASSIGNED"):
        agree_amount = round(ceiling * 0.96, -2)
        res_2 = service.simulate_response(
            assignment_id=assignment_id,
            scenario="ACCEPT",
            quoted_amount=agree_amount,
            custom_message=f"Understood. We'd love to work with you on this event. We can do INR {agree_amount:,.0f} as our final offer.",
        )
        db.refresh(assignment)
        return {
            "assignment_id": assignment_id,
            "status": "COMPLETED",
            "step_1": res_1,
            "step_2": res_2,
            "final_negotiation_status": assignment.negotiation_status,
            "final_quoted_amount": assignment.quoted_amount,
        }

    return {
        "assignment_id": assignment_id,
        "status": "STEP_1_EXECUTED",
        "result": res_1,
    }
