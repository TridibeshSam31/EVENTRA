"""Domain Service: NegotiationService

Orchestrates the provider engagement, negotiation, and confirmation lifecycle.
Uses existing EVENTRA deterministic engines for all authoritative decisions.

CRITICAL AUTHORITY RULE:
- Agent negotiates freely toward target_amount
- Agent NEVER exceeds max_approved_amount during negotiation
- Agent NEVER autonomously accepts any offer
- ALL final commitments require human approval via ApprovalService
"""
import logging
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestException, NotFoundException
from app.models.event import Event
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.budget import BudgetItem
from app.models.approval import Approval
from app.models.enums import NegotiationStatus
from app.services.provider_communication_service import ProviderCommunicationService
from app.services.approval_service import ApprovalService
from app.schemas.approval import ApprovalRequestCreate
from app.observability.audit import AuditRecorder
from app.services.negotiation_broker import negotiation_broker

logger = logging.getLogger(__name__)


class NegotiationService:
    """Manages provider engagement, negotiation, budget validation, and approval flow."""

    def __init__(self, db: Session):
        self.db = db
        self._comm = ProviderCommunicationService(db)
        self._approval = ApprovalService(db)
        self._audit = AuditRecorder(db)

    # ---- helpers ----

    def _get_assignment(self, assignment_id: str) -> VendorAssignment:
        assignment = self.db.query(VendorAssignment).filter(VendorAssignment.id == assignment_id).first()
        if not assignment:
            raise NotFoundException(f"Assignment '{assignment_id}' not found.")
        return assignment

    def _get_event(self, event_id: str) -> Event:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")
        return event

    def _get_vendor(self, vendor_id: str) -> Vendor:
        vendor = self.db.query(Vendor).filter(Vendor.id == vendor_id).first()
        if not vendor:
            raise NotFoundException(f"Vendor '{vendor_id}' not found.")
        return vendor

    def _validate_budget(self, event: Event, amount: float) -> Dict[str, Any]:
        """Deterministic budget validation using existing budget data."""
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event.id).all()
        total_budget = float(event.total_budget or 0)
        total_committed = sum(float(b.estimated_amount or 0) for b in budget_items)

        return {
            "total_budget": total_budget,
            "total_committed": total_committed,
            "remaining_budget": total_budget - total_committed,
            "proposed_amount": amount,
            "would_exceed_budget": (total_committed + amount) > total_budget,
            "budget_utilization_percent": round(((total_committed + amount) / total_budget * 100), 1) if total_budget > 0 else 0,
        }

    def resolve_provider_by_phone(self, phone: str) -> Optional[Vendor]:
        """Resolves a Vendor by incoming phone number from OpenWA or WhatsApp.

        Normalizes phone number by removing country code prefixes, spaces, +, -, etc.
        Matches exact digits or matching national suffix (e.g. 10 digits).
        """
        if not phone:
            return None

        # Clean incoming phone (strip openwa suffix @c.us if present)
        clean_in = phone.split("@")[0]
        digits_in = "".join(c for c in clean_in if c.isdigit())
        if not digits_in:
            return None

        vendors = self.db.query(Vendor).filter(Vendor.contact_phone.isnot(None)).all()
        for vendor in vendors:
            if not vendor.contact_phone:
                continue
            v_digits = "".join(c for c in vendor.contact_phone if c.isdigit())
            if not v_digits:
                continue
            if digits_in == v_digits:
                return vendor
            # Check last 10 digits (national number in India and many countries)
            if len(digits_in) >= 10 and len(v_digits) >= 10:
                if digits_in[-10:] == v_digits[-10:]:
                    return vendor

        return None

    def find_active_assignment(
        self, vendor_id: str, event_id: Optional[str] = None
    ) -> Optional[VendorAssignment]:
        """Finds the most active VendorAssignment for a provider."""
        query = self.db.query(VendorAssignment).filter(VendorAssignment.vendor_id == vendor_id)
        if event_id:
            query = query.filter(VendorAssignment.event_id == event_id)

        active_statuses = [
            NegotiationStatus.CONTACTED.value,
            NegotiationStatus.QUOTATION_RECEIVED.value,
            NegotiationStatus.NEGOTIATING.value,
            NegotiationStatus.COUNTER_OFFER_SENT.value,
            NegotiationStatus.AWAITING_APPROVAL.value,
        ]

        active = (
            query.filter(VendorAssignment.negotiation_status.in_(active_statuses))
            .order_by(VendorAssignment.updated_at.desc())
            .first()
        )
        if active:
            return active

        return query.order_by(VendorAssignment.updated_at.desc()).first()

    # ---- core operations ----

    def initiate_engagement(
        self,
        event_id: str,
        assignment_id: str,
        target_amount: Optional[float] = None,
        max_approved_amount: Optional[float] = None,
        currency: str = "INR",
        required_coverage_start: Optional[str] = None,
        required_coverage_end: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Constructs engagement context and contacts the provider.

        Steps:
        1. Load event + vendor + assignment
        2. Set negotiation parameters
        3. Generate structured engagement message
        4. Send via ProviderCommunicationService
        5. Update assignment → CONTACTED
        6. Record audit
        """
        assignment = self._get_assignment(assignment_id)
        event = self._get_event(event_id)
        vendor = self._get_vendor(assignment.vendor_id)

        # Set negotiation parameters
        if target_amount is not None:
            assignment.target_amount = target_amount
        if max_approved_amount is not None:
            assignment.max_approved_amount = max_approved_amount
        if currency:
            assignment.currency = currency
        if required_coverage_start:
            assignment.coverage_start = required_coverage_start
        if required_coverage_end:
            assignment.coverage_end = required_coverage_end

        # Generate engagement message from structured context
        message = self._build_engagement_message(event, vendor, assignment)

        # Send via communication channel
        result = self._comm.send_message(
            event_id=event_id,
            provider_id=vendor.id,
            message=message,
            recipient_contact=vendor.contact_phone,
        )

        # Update status
        assignment.negotiation_status = NegotiationStatus.CONTACTED.value
        assignment.negotiation_round = "0"

        self._audit.record(
            event_id=event_id,
            actor_id="system",
            actor_type="AGENT",
            action="PROVIDER_ENGAGEMENT_INITIATED",
            action_type="COMMUNICATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment_id,
            after_state={
                "vendor_name": vendor.name,
                "category": assignment.category,
                "negotiation_status": assignment.negotiation_status,
                "channel": result.data.get("channel") if result.data else "UNKNOWN",
            },
        )

        self.db.commit()
        self.db.refresh(assignment)

        return {
            "assignment_id": assignment.id,
            "negotiation_status": assignment.negotiation_status,
            "message_sent": message,
            "channel": result.data.get("channel") if result.data else "UNKNOWN",
            "success": result.success,
        }

    def process_quote(
        self,
        assignment_id: str,
        quoted_amount: float,
        notes: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Convenience wrapper to process incoming provider quote."""
        assignment = self._get_assignment(assignment_id)
        assignment.agreed_cost = quoted_amount
        assignment.quoted_amount = quoted_amount
        self.db.commit()
        return self.process_provider_response(
            assignment_id=assignment_id,
            response_text=f"Quoted amount {quoted_amount}. {notes or ''}".strip(),
            structured_offer={
                "availability": True,
                "quoted_amount": quoted_amount,
                "amount": quoted_amount,
                "terms": notes,
            },
        )


    def process_provider_response(
        self,
        assignment_id: str,
        response_text: str,
        is_simulation: bool = False,
        structured_offer: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Processes a provider response, extracts structured offer, and determines next action.

        CRITICAL: Even if the offer is within ceiling, the agent NEVER autonomously accepts.
        All within-ceiling offers go to AWAITING_APPROVAL for human decision.
        """
        assignment = self._get_assignment(assignment_id)
        event = self._get_event(assignment.event_id)

        # Record the inbound message
        self._comm.receive_inbound({
            "event_id": assignment.event_id,
            "provider_id": assignment.vendor_id,
            "text": response_text,
            "channel": "DEMO_SIMULATION" if is_simulation else "PROVIDER",
        })

        assignment.is_simulation = is_simulation

        # Parse structured offer (from simulation or LLM parsing)
        offer = structured_offer or self._parse_response(response_text)
        assignment.provider_response_summary = offer

        # Handle availability
        if offer.get("availability") is False:
            assignment.negotiation_status = NegotiationStatus.DECLINED.value
            assignment.provider_available = False
            self._audit.record(
                event_id=assignment.event_id,
                actor_id="provider",
                actor_type="EXTERNAL",
                action="PROVIDER_DECLINED",
                action_type="NEGOTIATION",
                target_type="VENDOR_ASSIGNMENT",
                target_id=assignment_id,
                after_state={"reason": "Provider unavailable", "response": response_text[:200]},
            )
            self.db.commit()
            self.db.refresh(assignment)
            return {
                "assignment_id": assignment.id,
                "negotiation_status": assignment.negotiation_status,
                "action": "PROVIDER_DECLINED",
                "message": "Provider is unavailable. Recovery may be needed.",
                "offer": offer,
            }

        # Provider is available
        quoted = offer.get("quoted_price") or offer.get("quoted_amount") or offer.get("amount")
        if quoted is not None:
            assignment.quoted_amount = float(quoted)
        if offer.get("coverage_start"):
            assignment.coverage_start = offer["coverage_start"]
        if offer.get("coverage_end"):
            assignment.coverage_end = offer["coverage_end"]
        if offer.get("advance_required") is not None:
            assignment.advance_required = offer["advance_required"]

        quoted_val = float(quoted) if quoted is not None else None

        # Real-time event: Broadcast inbound message
        negotiation_broker.publish_sync(
            event_id=assignment.event_id,
            assignment_id=assignment.id,
            event_type="message_added",
            data={
                "id": f"msg_in_{time.time()}",
                "sender_type": "VENDOR",
                "text": response_text,
                "amount_extracted": quoted_val,
                "channel": "DEMO_SIMULATION" if is_simulation else "whatsapp",
                "timestamp": time.time(),
            },
        )

        # CHOKE POINT GUARD: When in manual HUMAN control, record reply and alert organizer without agent counter
        if getattr(assignment, "negotiation_control", "AGENT") == "HUMAN":
            assignment.negotiation_status = NegotiationStatus.QUOTATION_RECEIVED.value
            self.db.commit()
            self.db.refresh(assignment)

            negotiation_broker.publish_sync(
                event_id=assignment.event_id,
                assignment_id=assignment.id,
                event_type="quote_updated",
                data={
                    "quoted_amount": assignment.quoted_amount,
                    "status": assignment.negotiation_status,
                    "control": "HUMAN",
                    "timestamp": time.time(),
                },
            )

            try:
                from app.services.approval_notification_dispatcher import ApprovalNotificationDispatcher
                dispatcher = ApprovalNotificationDispatcher(self.db)
                vendor = self._get_vendor(assignment.vendor_id)
                quoted_str = f"{assignment.currency} {quoted_val:,.0f}" if quoted_val else "a quote"
                dispatcher.notify_organizers(
                    event_id=assignment.event_id,
                    title="Vendor Replied in Manual Negotiation",
                    message=f"{vendor.name} sent {quoted_str}: '{response_text[:100]}'. Organizer action required.",
                    payload={
                        "assignment_id": assignment.id,
                        "vendor_id": assignment.vendor_id,
                        "vendor_name": vendor.name,
                        "quoted_amount": quoted_val,
                    },
                )
            except Exception as notify_err:
                logger.warning("Failed to notify organizers of vendor reply in HUMAN mode: %s", notify_err)

            return {
                "assignment_id": assignment.id,
                "negotiation_status": assignment.negotiation_status,
                "negotiation_control": getattr(assignment, "negotiation_control", "HUMAN") or "HUMAN",
                "action": "HUMAN_CONTROL",
                "message": "Provider reply recorded under manual organizer control. Agent will not auto-counter.",
                "offer": offer,
                "quoted_amount": assignment.quoted_amount,
                "target_amount": assignment.target_amount,
                "max_approved_amount": assignment.max_approved_amount,
            }

        # Determine next action based on budget authority rules
        max_ceiling = assignment.max_approved_amount
        target = assignment.target_amount

        if quoted_val is not None and max_ceiling is not None and quoted_val > max_ceiling:
            # Over ceiling → agent counter-offers toward target
            assignment.negotiation_status = NegotiationStatus.NEGOTIATING.value
            action = "NEGOTIATE"
            message = f"Provider quoted {assignment.currency} {quoted_val:,.0f} which exceeds ceiling of {assignment.currency} {max_ceiling:,.0f}. Agent will counter-offer."
        else:
            # Within ceiling (or no ceiling set) → AWAITING HUMAN APPROVAL
            # CRITICAL: Agent NEVER autonomously accepts
            assignment.negotiation_status = NegotiationStatus.AWAITING_APPROVAL.value
            action = "AWAITING_APPROVAL"
            budget_validation = self._validate_budget(event, quoted_val or 0.0)
            quoted_str = f"{quoted_val:,.0f}" if quoted_val is not None else "N/A"
            message = f"Provider offer of {assignment.currency} {quoted_str} is within ceiling. Human approval required."

            # Automatically create the ApprovalRequest for human decision if not already created
            if not assignment.approval_id:
                try:
                    vendor = self._get_vendor(assignment.vendor_id)
                    approval_req = ApprovalRequestCreate(
                        action_type="PROVIDER_ENGAGEMENT",
                        target_type="VENDOR_ASSIGNMENT",
                        target_id=assignment.id,
                        requested_action={
                            "type": "CONFIRM_PROVIDER_ENGAGEMENT",
                            "vendor_id": assignment.vendor_id,
                            "vendor_name": vendor.name,
                            "category": assignment.category,
                            "quoted_amount": assignment.quoted_amount,
                            "currency": assignment.currency,
                            "coverage_start": assignment.coverage_start,
                            "coverage_end": assignment.coverage_end,
                            "advance_required": assignment.advance_required,
                            "target_amount": assignment.target_amount,
                            "max_approved_amount": assignment.max_approved_amount,
                            "negotiation_round": assignment.negotiation_round,
                            "is_simulation": assignment.is_simulation,
                        },
                        notes=f"Provider engagement approval for {vendor.name} — {assignment.category} at {assignment.currency} {quoted_str}",
                    )
                    created_approval = self._approval.create_request(assignment.event_id, "anonymous_operator", approval_req)
                    assignment.approval_id = created_approval.id
                except Exception:
                    pass

        self._audit.record(
            event_id=assignment.event_id,
            actor_id="system",
            actor_type="AGENT",
            action="PROVIDER_RESPONSE_PROCESSED",
            action_type="NEGOTIATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment_id,
            after_state={
                "quoted_amount": assignment.quoted_amount,
                "negotiation_status": assignment.negotiation_status,
                "action": action,
                "is_simulation": is_simulation,
            },
        )

        self.db.commit()
        self.db.refresh(assignment)

        # Real-time event: Broadcast quote and status update
        negotiation_broker.publish_sync(
            event_id=assignment.event_id,
            assignment_id=assignment.id,
            event_type="quote_updated",
            data={
                "quoted_amount": assignment.quoted_amount,
                "status": assignment.negotiation_status,
                "action": action,
                "approval_id": assignment.approval_id,
                "timestamp": time.time(),
            },
        )

        result: Dict[str, Any] = {
            "assignment_id": assignment.id,
            "negotiation_status": assignment.negotiation_status,
            "action": action,
            "message": message,
            "offer": offer,
            "quoted_amount": assignment.quoted_amount,
            "target_amount": target,
            "max_approved_amount": max_ceiling,
        }

        if action == "AWAITING_APPROVAL":
            result["budget_validation"] = self._validate_budget(event, float(quoted or 0))

        return result

    def negotiate(self, assignment_id: str) -> Dict[str, Any]:
        """Generates a counter-offer toward target_amount. Never exceeds ceiling."""
        assignment = self._get_assignment(assignment_id)
        vendor = self._get_vendor(assignment.vendor_id)

        # CHOKE POINT GUARD 1: Human control check
        if getattr(assignment, "negotiation_control", "AGENT") == "HUMAN":
            raise BadRequestException(
                "Negotiation is under manual organizer control (HUMAN). Agent cannot send counter-offers."
            )

        if assignment.negotiation_status not in (
            NegotiationStatus.NEGOTIATING.value,
            NegotiationStatus.QUOTATION_RECEIVED.value,
        ):
            raise BadRequestException(
                f"Cannot negotiate: assignment is in '{assignment.negotiation_status}' state."
            )

        target = assignment.target_amount or 0
        ceiling = assignment.max_approved_amount or target
        quoted = assignment.quoted_amount or 0
        currency = assignment.currency or "INR"
        round_num = int(assignment.negotiation_round or "0") + 1

        # Calculate counter-offer: move toward target, never exceed ceiling
        if round_num == 1:
            counter = target  # First counter: offer the target
        else:
            # Subsequent rounds: split the difference toward ceiling but stay closer to target
            counter = target + (ceiling - target) * min(0.3 * round_num, 0.8)
            counter = min(counter, ceiling * 0.98)  # Never hit exact ceiling

        counter = round(counter, -2)  # Round to nearest 100

        # CHOKE POINT GUARD 2: Hard cap guard
        if assignment.max_approved_amount is not None and counter > assignment.max_approved_amount:
            logger.error(
                "HARD CAP VIOLATION PREVENTED: Counter-offer %f exceeds max_approved_amount %f for assignment %s",
                counter,
                assignment.max_approved_amount,
                assignment_id,
            )
            self._audit.record(
                event_id=assignment.event_id,
                actor_id="system",
                actor_type="AGENT",
                action="NEGOTIATION_CAP_BLOCKED",
                action_type="NEGOTIATION",
                target_type="VENDOR_ASSIGNMENT",
                target_id=assignment_id,
                after_state={
                    "attempted_counter": counter,
                    "max_approved_amount": assignment.max_approved_amount,
                    "quoted": quoted,
                },
            )
            self.db.commit()
            negotiation_broker.publish_sync(
                event_id=assignment.event_id,
                assignment_id=assignment.id,
                event_type="cap_blocked",
                data={
                    "attempted_counter": counter,
                    "max_approved_amount": assignment.max_approved_amount,
                    "status": assignment.negotiation_status,
                    "reason": "Counter-offer exceeds budget cap ceiling",
                    "timestamp": time.time(),
                },
            )
            try:
                from app.services.approval_notification_dispatcher import ApprovalNotificationDispatcher
                dispatcher = ApprovalNotificationDispatcher(self.db)
                dispatcher.notify_organizers(
                    event_id=assignment.event_id,
                    title="Budget Cap Blocked Negotiation Counter",
                    message=f"Agent attempted counter of {currency} {counter:,.0f} exceeding ceiling {currency} {assignment.max_approved_amount:,.0f} for {vendor.name}.",
                    payload={"assignment_id": assignment.id, "counter": counter, "cap": assignment.max_approved_amount},
                )
            except Exception:
                pass

            raise BadRequestException(
                f"Counter-offer amount ({currency} {counter:,.0f}) exceeds approved ceiling "
                f"({currency} {assignment.max_approved_amount:,.0f}). Blocked by deterministic hard cap guard."
            )

        message = self._build_counter_offer_message(vendor, counter, currency, assignment)

        # Send counter-offer
        result = self._comm.send_message(
            event_id=assignment.event_id,
            provider_id=vendor.id,
            message=message,
            recipient_contact=vendor.contact_phone,
        )

        assignment.negotiation_status = NegotiationStatus.COUNTER_OFFER_SENT.value
        assignment.negotiation_round = str(round_num)

        self._audit.record(
            event_id=assignment.event_id,
            actor_id="system",
            actor_type="AGENT",
            action="COUNTER_OFFER_SENT",
            action_type="NEGOTIATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment_id,
            after_state={
                "counter_amount": counter,
                "round": round_num,
                "target": target,
                "ceiling": ceiling,
                "quoted": quoted,
            },
        )

        self.db.commit()
        self.db.refresh(assignment)

        # Real-time event: Broadcast counter offer and message
        negotiation_broker.publish_sync(
            event_id=assignment.event_id,
            assignment_id=assignment.id,
            event_type="counter_sent",
            data={
                "counter_amount": counter,
                "round": round_num,
                "message": message,
                "currency": currency,
                "timestamp": time.time(),
            },
        )
        negotiation_broker.publish_sync(
            event_id=assignment.event_id,
            assignment_id=assignment.id,
            event_type="message_added",
            data={
                "id": f"msg_out_{time.time()}",
                "sender_type": "AGENT",
                "text": message,
                "amount_extracted": counter,
                "channel": "whatsapp",
                "timestamp": time.time(),
            },
        )

        return {
            "assignment_id": assignment.id,
            "negotiation_status": assignment.negotiation_status,
            "action": "COUNTER_OFFER_SENT",
            "counter_offer_amount": counter,
            "round": round_num,
            "message_sent": message,
            "target": target,
            "ceiling": ceiling,
            "provider_quoted": quoted,
        }

    # ---- Control State Transitions (Takeover, Resume, Cancel) ----

    def take_over(self, assignment_id: str, user_id: str = "organizer") -> Dict[str, Any]:
        """Transfers negotiation authority from AGENT to HUMAN organizer.
        
        Guarantees:
        - Sets negotiation_control to 'HUMAN' (even if call hangup fails)
        - Records user ID and timestamp
        - Terminates any active voice call immediately via Twilio gateway
        - If hangup fails, returns 'could not end call, agent paused instead'
        - Emits 'control_changed' on negotiation_broker
        - Records authoritative audit record NEGOTIATION_TAKEOVER
        """
        assignment = self._get_assignment(assignment_id)
        prev_control = getattr(assignment, "negotiation_control", "AGENT") or "AGENT"
        assignment.negotiation_control = "HUMAN"
        assignment.control_changed_by = user_id
        assignment.control_changed_at = datetime.now(timezone.utc).replace(tzinfo=None)

        hangup_results = self._hangup_active_call_if_any(assignment, reason="MANUAL_TAKEOVER", user_id=user_id)
        hangup_failed = any(not r.success for r in hangup_results) if hangup_results else False

        self._audit.record(
            event_id=assignment.event_id,
            actor_id=user_id,
            actor_type="ORGANIZER",
            action="NEGOTIATION_TAKEOVER",
            action_type="NEGOTIATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment.id,
            after_state={
                "previous_control": prev_control,
                "negotiation_control": "HUMAN",
                "control_changed_by": user_id,
                "hangup_failed": hangup_failed,
            },
        )
        self.db.commit()
        self.db.refresh(assignment)

        negotiation_broker.publish_sync(
            event_id=assignment.event_id,
            assignment_id=assignment.id,
            event_type="control_changed",
            data={
                "control": "HUMAN",
                "changed_by": user_id,
                "timestamp": time.time(),
                "status": assignment.negotiation_status,
                "hangup_failed": hangup_failed,
            },
        )

        msg = (
            "could not end call, agent paused instead"
            if hangup_failed
            else "Manual takeover successful. Agent paused. Outbound messages now sent by organizer."
        )

        return {
            "assignment_id": assignment.id,
            "negotiation_control": assignment.negotiation_control,
            "control_changed_by": assignment.control_changed_by,
            "control_changed_at": assignment.control_changed_at.isoformat() if assignment.control_changed_at else None,
            "status": assignment.negotiation_status,
            "message": msg,
            "hangup_success": False if hangup_failed else (True if hangup_results else None),
        }

    def resume(self, assignment_id: str, user_id: str = "organizer") -> Dict[str, Any]:
        """Restores autonomous agent authority for vendor negotiation.
        
        Guarantees:
        - Sets negotiation_control to 'AGENT'
        - Records user ID and timestamp
        - Emits 'control_changed' on negotiation_broker
        - Records authoritative audit record NEGOTIATION_RESUME
        """
        assignment = self._get_assignment(assignment_id)
        prev_control = getattr(assignment, "negotiation_control", "HUMAN") or "HUMAN"
        assignment.negotiation_control = "AGENT"
        assignment.control_changed_by = user_id
        assignment.control_changed_at = datetime.now(timezone.utc).replace(tzinfo=None)

        self._audit.record(
            event_id=assignment.event_id,
            actor_id=user_id,
            actor_type="ORGANIZER",
            action="NEGOTIATION_RESUME",
            action_type="NEGOTIATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment.id,
            after_state={
                "previous_control": prev_control,
                "negotiation_control": "AGENT",
                "control_changed_by": user_id,
            },
        )
        self.db.commit()
        self.db.refresh(assignment)

        negotiation_broker.publish_sync(
            event_id=assignment.event_id,
            assignment_id=assignment.id,
            event_type="control_changed",
            data={
                "control": "AGENT",
                "changed_by": user_id,
                "timestamp": time.time(),
                "status": assignment.negotiation_status,
            },
        )

        return {
            "assignment_id": assignment.id,
            "negotiation_control": assignment.negotiation_control,
            "control_changed_by": assignment.control_changed_by,
            "control_changed_at": assignment.control_changed_at.isoformat() if assignment.control_changed_at else None,
            "status": assignment.negotiation_status,
            "message": "Autonomous agent negotiation resumed.",
        }

    def cancel(self, assignment_id: str, user_id: str = "organizer", reason: Optional[str] = None) -> Dict[str, Any]:
        """Stops negotiation and marks assignment DECLINED / CANCELLED using existing state machine."""
        assignment = self._get_assignment(assignment_id)
        assignment.negotiation_control = "HUMAN"

        hangup_results = self._hangup_active_call_if_any(assignment, reason="NEGOTIATION_CANCELLED", user_id=user_id)
        hangup_failed = any(not r.success for r in hangup_results) if hangup_results else False

        assignment.negotiation_status = NegotiationStatus.DECLINED.value
        assignment.status = "CANCELLED"
        assignment.provider_available = False

        self._audit.record(
            event_id=assignment.event_id,
            actor_id=user_id,
            actor_type="ORGANIZER",
            action="NEGOTIATION_CANCEL",
            action_type="NEGOTIATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment.id,
            after_state={
                "negotiation_status": assignment.negotiation_status,
                "status": assignment.status,
                "reason": reason or "Cancelled by organizer",
                "hangup_failed": hangup_failed,
            },
        )
        self.db.commit()
        self.db.refresh(assignment)

        negotiation_broker.publish_sync(
            event_id=assignment.event_id,
            assignment_id=assignment.id,
            event_type="status_changed",
            data={
                "status": assignment.negotiation_status,
                "action": "CANCELLED",
                "reason": reason or "Cancelled by organizer",
                "timestamp": time.time(),
                "hangup_failed": hangup_failed,
            },
        )

        msg = (
            "could not end call, agent paused instead"
            if hangup_failed
            else f"Negotiation cancelled by organizer. {reason or ''}".strip()
        )

        return {
            "assignment_id": assignment.id,
            "negotiation_control": assignment.negotiation_control,
            "status": assignment.status,
            "message": msg,
            "hangup_success": False if hangup_failed else (True if hangup_results else None),
        }

    def _hangup_active_call_if_any(self, assignment: VendorAssignment, reason: str, user_id: str) -> List[Any]:
        """Attempts to hang up any active call on this vendor/assignment via telephony gateway."""
        results = []
        try:
            from app.integrations.communication.twilio_gateway import twilio_voice_gateway, TwilioSessionState
            for session in list(twilio_voice_gateway._sessions.values()):
                if (
                    session.session_id == assignment.id
                    or session.custom_parameters.get("assignment_id") == assignment.id
                    or session.custom_parameters.get("provider_id") == assignment.vendor_id
                ):
                    session.state = TwilioSessionState.STOPPED
                    call_id = session.call_sid or session.session_id
                    res = self._comm.hangup_call(
                        call_id,
                        reason=reason,
                        actor_id=user_id,
                        event_id=assignment.event_id,
                    )
                    results.append(res)
        except Exception as e:
            logger.debug("Twilio session hangup lookup error: %s", e)

        # Also check if assignment metadata/summary records an active call_sid
        if assignment.provider_response_summary and isinstance(assignment.provider_response_summary, dict):
            stored_call_sid = assignment.provider_response_summary.get("call_sid")
            if stored_call_sid and not any(r.data and r.data.get("call_sid") == stored_call_sid for r in results):
                res = self._comm.hangup_call(
                    stored_call_sid,
                    reason=reason,
                    actor_id=user_id,
                    event_id=assignment.event_id,
                )
                results.append(res)

        return results

    def request_approval(
        self,
        event_id: str,
        assignment_id: str,
        user_id: str = "anonymous_operator",
    ) -> Dict[str, Any]:
        """Creates an approval request for the provider engagement.

        Uses existing ApprovalService — no duplicate approval system.
        """
        assignment = self._get_assignment(assignment_id)
        vendor = self._get_vendor(assignment.vendor_id)

        if assignment.negotiation_status != NegotiationStatus.AWAITING_APPROVAL.value:
            raise BadRequestException(
                f"Cannot request approval: assignment is in '{assignment.negotiation_status}' state."
            )

        req = ApprovalRequestCreate(
            action_type="PROVIDER_ENGAGEMENT",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment_id,
            requested_action={
                "type": "CONFIRM_PROVIDER_ENGAGEMENT",
                "vendor_id": assignment.vendor_id,
                "vendor_name": vendor.name,
                "category": assignment.category,
                "quoted_amount": assignment.quoted_amount,
                "currency": assignment.currency,
                "coverage_start": assignment.coverage_start,
                "coverage_end": assignment.coverage_end,
                "advance_required": assignment.advance_required,
                "target_amount": assignment.target_amount,
                "max_approved_amount": assignment.max_approved_amount,
                "negotiation_round": assignment.negotiation_round,
                "is_simulation": assignment.is_simulation,
            },
            notes=f"Provider engagement approval for {vendor.name} — {assignment.category} at {assignment.currency} {assignment.quoted_amount:,.0f}" if assignment.quoted_amount else None,
        )

        approval = self._approval.create_request(event_id, user_id, req)
        assignment.approval_id = approval.id

        self.db.commit()
        self.db.refresh(assignment)

        return {
            "assignment_id": assignment.id,
            "approval_id": approval.id,
            "approval_status": approval.status,
            "negotiation_status": assignment.negotiation_status,
            "quoted_amount": assignment.quoted_amount,
            "max_approved_amount": assignment.max_approved_amount,
        }

    def confirm_engagement(self, assignment_id: str) -> Dict[str, Any]:
        """Confirms the provider engagement AFTER human approval.

        AUTHORITATIVE RULES:
        - Must be in AWAITING_APPROVAL state.
        - Must have a linked ApprovalRequest in the database.
        - The linked ApprovalRequest status MUST be 'APPROVED'.
        - Validates budget constraints: quoted amount must not exceed max_approved_amount.
        - Updates assignment to CONFIRMED, records budget commitment, records audit.
        """
        assignment = self._get_assignment(assignment_id)
        event = self._get_event(assignment.event_id)

        if assignment.negotiation_status != NegotiationStatus.AWAITING_APPROVAL.value:
            raise BadRequestException(
                f"Cannot confirm: assignment is in '{assignment.negotiation_status}' state. "
                f"Must be AWAITING_APPROVAL."
            )

        # 1. Authoritative human approval verification
        if not assignment.approval_id:
            raise BadRequestException(
                "Cannot confirm engagement: No linked ApprovalRequest exists. "
                "Final commitment strictly requires human approval via ApprovalService."
            )

        approval = (
            self.db.query(Approval)
            .filter(Approval.id == assignment.approval_id, Approval.event_id == assignment.event_id)
            .first()
        )
        if not approval:
            raise BadRequestException(
                f"Cannot confirm engagement: Linked ApprovalRequest '{assignment.approval_id}' not found."
            )

        if approval.status != "APPROVED":
            raise BadRequestException(
                f"Cannot confirm engagement: Linked ApprovalRequest '{assignment.approval_id}' has status "
                f"'{approval.status}'. Must be 'APPROVED' before confirmation."
            )

        # 2. Budget constraint verification
        if assignment.max_approved_amount is not None and assignment.quoted_amount is not None:
            if float(assignment.quoted_amount) > float(assignment.max_approved_amount):
                raise BadRequestException(
                    f"Cannot confirm: Quoted amount ({assignment.currency} {assignment.quoted_amount}) "
                    f"exceeds max approved ceiling ({assignment.currency} {assignment.max_approved_amount})."
                )

        # Mark confirmed
        assignment.negotiation_status = NegotiationStatus.CONFIRMED.value
        assignment.status = "CONFIRMED"
        assignment.agreed_cost = assignment.quoted_amount

        # Send confirmation message to provider
        vendor = self._get_vendor(assignment.vendor_id)
        confirm_msg = self._build_confirmation_message(vendor, assignment)
        self._comm.send_message(
            event_id=assignment.event_id,
            provider_id=vendor.id,
            message=confirm_msg,
            recipient_contact=vendor.contact_phone,
        )

        self._audit.record(
            event_id=assignment.event_id,
            actor_id="system",
            actor_type="AGENT",
            action="PROVIDER_ENGAGEMENT_CONFIRMED",
            action_type="NEGOTIATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment_id,
            after_state={
                "vendor_name": vendor.name,
                "category": assignment.category,
                "agreed_cost": assignment.agreed_cost,
                "coverage_start": assignment.coverage_start,
                "coverage_end": assignment.coverage_end,
                "approval_id": assignment.approval_id,
            },
        )

        self.db.commit()
        self.db.refresh(assignment)

        return {
            "assignment_id": assignment.id,
            "negotiation_status": assignment.negotiation_status,
            "status": assignment.status,
            "agreed_cost": assignment.agreed_cost,
            "vendor_name": vendor.name,
            "category": assignment.category,
            "approval_id": assignment.approval_id,
            "message": f"Provider {vendor.name} confirmed for {assignment.category} at {assignment.currency} {assignment.agreed_cost:,.0f}",
        }

    def handle_decline(self, assignment_id: str) -> Dict[str, Any]:
        """Handles provider decline — updates state and suggests recovery."""
        assignment = self._get_assignment(assignment_id)

        assignment.negotiation_status = NegotiationStatus.DECLINED.value
        assignment.status = "CANCELLED"
        assignment.provider_available = False

        self._audit.record(
            event_id=assignment.event_id,
            actor_id="system",
            actor_type="AGENT",
            action="PROVIDER_ENGAGEMENT_DECLINED",
            action_type="NEGOTIATION",
            target_type="VENDOR_ASSIGNMENT",
            target_id=assignment_id,
            after_state={
                "negotiation_status": assignment.negotiation_status,
                "recommendation": "Invoke recovery to find alternative provider.",
            },
        )

        self.db.commit()
        self.db.refresh(assignment)

        return {
            "assignment_id": assignment.id,
            "negotiation_status": assignment.negotiation_status,
            "action": "RECOVERY_NEEDED",
            "message": f"Provider declined. {assignment.category} requirement is now uncovered. Recovery recommended.",
        }

    def simulate_response(
        self,
        assignment_id: str,
        scenario: str,
        quoted_amount: Optional[float] = None,
        coverage_start: Optional[str] = None,
        coverage_end: Optional[str] = None,
        advance_required: Optional[bool] = None,
        provider_count: Optional[int] = None,
        custom_message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Demo simulation — generates a realistic provider response.

        All simulated responses are clearly tagged as DEMO SIMULATION.
        """
        assignment = self._get_assignment(assignment_id)
        vendor = self._get_vendor(assignment.vendor_id)
        currency = assignment.currency or "INR"
        target = assignment.target_amount or 40000
        ceiling = assignment.max_approved_amount or 45000

        scenario = scenario.upper()

        if scenario == "ACCEPT":
            amount = quoted_amount or round(target * 1.25, -2)  # 25% above target
            response_text = custom_message or (
                f"Yes, I'm available for the event. My rate would be {currency} {amount:,.0f} "
                f"for full coverage. I can confirm immediately."
            )
            offer = {
                "availability": True,
                "quoted_price": amount,
                "currency": currency,
                "coverage_start": coverage_start or assignment.coverage_start or "10:00",
                "coverage_end": coverage_end or assignment.coverage_end or "20:00",
                "advance_required": advance_required or False,
                "provider_count": provider_count or 1,
            }

        elif scenario == "COUNTER":
            amount = quoted_amount or round(ceiling * 0.98, -2)
            c_start = coverage_start or "12:00"
            c_end = coverage_end or "20:00"
            response_text = custom_message or (
                f"I can do it for {currency} {amount:,.0f} but I'm only available from "
                f"{c_start} to {c_end}. I'll need 50% advance payment."
            )
            offer = {
                "availability": True,
                "quoted_price": amount,
                "currency": currency,
                "coverage_start": c_start,
                "coverage_end": c_end,
                "advance_required": advance_required if advance_required is not None else True,
                "provider_count": provider_count or 1,
            }

        elif scenario == "DECLINE":
            response_text = custom_message or (
                f"Sorry, I'm fully booked on that date. I won't be available."
            )
            offer = {"availability": False}

        elif scenario == "NO_RESPONSE":
            # No response — mark as waiting
            assignment.negotiation_status = NegotiationStatus.WAITING_FOR_RESPONSE.value
            self.db.commit()
            self.db.refresh(assignment)
            return {
                "assignment_id": assignment.id,
                "negotiation_status": assignment.negotiation_status,
                "action": "WAITING",
                "message": "Provider has not responded. Follow-up may be needed.",
                "is_simulation": True,
            }
        else:
            raise BadRequestException(f"Unknown simulation scenario: '{scenario}'. Use ACCEPT, COUNTER, DECLINE, or NO_RESPONSE.")

        # Process the simulated response through the real pipeline
        return self.process_provider_response(
            assignment_id=assignment_id,
            response_text=response_text,
            is_simulation=True,
            structured_offer=offer,
        )

    # ---- message builders ----

    def _build_engagement_message(self, event: Event, vendor: Vendor, assignment: VendorAssignment) -> str:
        """Generates a professional engagement request from structured context."""
        date_str = event.start_datetime.strftime("%d %B %Y") if event.start_datetime else "TBD"
        coverage = ""
        if assignment.coverage_start and assignment.coverage_end:
            coverage = f"\nCoverage: {assignment.coverage_start} – {assignment.coverage_end}"

        return (
            f"Hi, this is EVENTRA coordinating an upcoming event.\n\n"
            f"We're looking for {assignment.category.lower().replace('_', ' ')} services for:\n\n"
            f"Event: {event.name}\n"
            f"Date: {date_str}\n"
            f"Location: {event.location or 'TBD'}\n"
            f"Expected attendees: {event.guest_count or 'TBD'}"
            f"{coverage}\n\n"
            f"Are you available for this requirement?\n"
            f"If yes, please share your availability and quotation."
        )

    def _build_counter_offer_message(
        self, vendor: Vendor, counter_amount: float, currency: str, assignment: VendorAssignment
    ) -> str:
        """Generates a counter-offer message."""
        return (
            f"Thank you for your quotation. "
            f"Would {currency} {counter_amount:,.0f} work for the requested "
            f"{assignment.category.lower().replace('_', ' ')} coverage?"
        )

    def _build_confirmation_message(self, vendor: Vendor, assignment: VendorAssignment) -> str:
        """Generates confirmation message after human approval."""
        return (
            f"Great news! The engagement has been approved.\n\n"
            f"Confirmed details:\n"
            f"Service: {assignment.category.replace('_', ' ')}\n"
            f"Agreed amount: {assignment.currency} {assignment.agreed_cost:,.0f}\n"
            f"Coverage: {assignment.coverage_start or 'TBD'} – {assignment.coverage_end or 'TBD'}\n\n"
            f"Thank you for partnering with us. We'll share further coordination details soon."
        )

    def _parse_response(self, text: str) -> Dict[str, Any]:
        """Basic deterministic response parser. Extracts structured info from text."""
        text_lower = text.lower()
        offer: Dict[str, Any] = {}

        # Availability detection
        decline_keywords = ["sorry", "unavailable", "booked", "can't", "cannot", "not available", "fully booked", "won't"]
        accept_keywords = ["available", "yes", "can do", "i can", "confirm", "happy to"]

        if any(kw in text_lower for kw in decline_keywords):
            offer["availability"] = False
            return offer

        if any(kw in text_lower for kw in accept_keywords):
            offer["availability"] = True

        # Price extraction (simple pattern matching)
        import re
        price_patterns = [
            r'₹\s*([\d,]+)',
            r'rs\.?\s*([\d,]+)',
            r'inr\s*([\d,]+)',
            r'\$([\d,]+)',
            r'([\d,]+)\s*(?:rupees|rs|inr)',
            r'\b(\d{4,7})\b',
        ]
        for pattern in price_patterns:
            match = re.search(pattern, text_lower.replace(',', ''))
            if match:
                try:
                    offer["quoted_price"] = float(match.group(1).replace(',', ''))
                    break
                except ValueError:
                    pass

        # Time extraction
        time_pattern = r'(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)?)'
        times = re.findall(time_pattern, text)
        if len(times) >= 2:
            offer["coverage_start"] = times[0].strip()
            offer["coverage_end"] = times[1].strip()

        # Advance payment detection
        if "advance" in text_lower or "upfront" in text_lower:
            offer["advance_required"] = True

        # Default availability if not explicitly declined
        if "availability" not in offer:
            offer["availability"] = True

        return offer

    def get_conversation(self, assignment_id: str) -> Dict[str, Any]:
        """Gets full negotiation conversation and state for an assignment."""
        assignment = self._get_assignment(assignment_id)
        event = self._get_event(assignment.event_id)
        vendor = self._get_vendor(assignment.vendor_id)

        messages = self._comm.get_messages(
            event_id=assignment.event_id,
            provider_id=assignment.vendor_id,
        )

        budget_validation = None
        if assignment.quoted_amount:
            budget_validation = self._validate_budget(event, assignment.quoted_amount)

        requirement_validation = None
        if assignment.coverage_start or assignment.coverage_end:
            requirement_validation = {
                "required_start": assignment.coverage_start,
                "required_end": assignment.coverage_end,
                "provider_start": (assignment.provider_response_summary or {}).get("coverage_start"),
                "provider_end": (assignment.provider_response_summary or {}).get("coverage_end"),
            }

        return {
            "assignment": assignment,
            "vendor": vendor,
            "messages": messages,
            "budget_validation": budget_validation,
            "requirement_validation": requirement_validation,
        }
