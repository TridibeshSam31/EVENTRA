"""Deterministic Vendor Outcome Input Service (Task 6).

Responsibilities:
- Ingests organizer-reported outcomes from external vendor interactions.
- Validates event, task, provider references and their relational integrity.
- Applies deterministic input normalization (e.g. price parsing, currency/status cleaning).
- Strictly preserves architectural provenance:
    source = "ORGANIZER_REPORTED"
    verification_status = "UNVERIFIED"
- Preserves missing facts as UNKNOWN without hallucination or guessing.
- Records immutable audit history for each interaction.
- HARD GUARDRAIL: Never mutates task.provider_id, never confirms bookings,
  never triggers plan recalculation or critical path DAG execution.
"""
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestException,
    NotFoundException,
)
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_outcome import VendorOutcome
from app.models.audit import AuditRecord
from app.models.enums import (
    CommunicationChannel,
    VendorOutcomeStatus,
    ReportedAvailability,
)
from app.schemas.vendor_outcome import (
    VendorOutcomeCreate,
    VendorOutcomeResponse,
)


def _normalize_price(val: Any) -> Optional[float]:
    """Deterministically normalizes numeric or string price representations."""
    if val is None or val == "":
        return None
    if isinstance(val, (int, float)):
        if val < 0:
            raise BadRequestException("Quoted price cannot be negative.")
        return round(float(val), 2)
    if isinstance(val, str):
        cleaned = val.strip().replace(",", "").replace("₹", "").replace("$", "").replace("INR", "").replace("USD", "").strip()
        lower_cleaned = cleaned.lower()
        if "lakh" in lower_cleaned or "lac" in lower_cleaned:
            num_part = re.sub(r"[^\d.]", "", lower_cleaned)
            try:
                amount = float(num_part) * 100000.0
                if amount < 0:
                    raise BadRequestException("Quoted price cannot be negative.")
                return round(amount, 2)
            except ValueError:
                pass
        try:
            parsed = float(cleaned)
            if parsed < 0:
                raise BadRequestException("Quoted price cannot be negative.")
            return round(parsed, 2)
        except ValueError:
            raise BadRequestException(f"Invalid quoted price format: '{val}'")
    return None


class VendorOutcomeService:
    """Authoritative domain service for recording organizer-reported vendor outcomes."""

    def __init__(self, db: Session):
        self.db = db

    def record_outcome(
        self,
        event_id: str,
        payload: Union[VendorOutcomeCreate, Dict[str, Any]],
        submitted_by: Optional[str] = None,
    ) -> VendorOutcome:
        """Validates and persists an organizer-reported vendor outcome.

        Enforces all Task 6 boundaries:
        - Entity existence and relationship validation
        - Strict unverified / organizer_reported labeling
        - No plan, booking, or assignment mutations
        """
        if isinstance(payload, dict):
            provider_id = payload.get("provider_id")
            task_id = payload.get("task_id")
            channel_raw = payload.get("communication_channel", "OTHER")
            status_raw = payload.get("outcome_status", "CONTACTED")
            price_raw = payload.get("quoted_price")
            currency_raw = payload.get("currency", "INR")
            avail_raw = payload.get("reported_availability", "UNKNOWN")
            organizer_notes = payload.get("organizer_notes")
            vendor_response = payload.get("vendor_response")
            sub_by = payload.get("submitted_by") or submitted_by
        else:
            provider_id = payload.provider_id
            task_id = payload.task_id
            channel_raw = payload.communication_channel
            status_raw = payload.outcome_status
            price_raw = payload.quoted_price
            currency_raw = payload.currency
            avail_raw = payload.reported_availability
            organizer_notes = payload.organizer_notes
            vendor_response = payload.vendor_response
            sub_by = getattr(payload, "submitted_by", None) or submitted_by

        # 1. Validate Event existence
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        # 2. Validate Provider existence
        if not provider_id:
            raise BadRequestException("provider_id is required.")
        vendor = self.db.query(Vendor).filter(Vendor.id == provider_id).first()
        if not vendor:
            raise NotFoundException(f"Provider with id '{provider_id}' not found.")

        # 3. Validate Task existence and relationship to Event
        task = None
        if task_id:
            task = self.db.query(Task).filter(Task.id == task_id).first()
            if not task:
                raise NotFoundException(f"Task with id '{task_id}' not found.")
            if task.event_id != event_id:
                raise BadRequestException(f"Task with id '{task_id}' does not belong to event '{event_id}'.")

        # 4. Deterministic Normalization
        # Normalize Channel
        channel_norm = str(channel_raw or "OTHER").strip().upper()
        valid_channels = {c.value for c in CommunicationChannel}
        if channel_norm not in valid_channels:
            raise BadRequestException(
                f"Invalid communication_channel '{channel_raw}'. Must be one of {sorted(list(valid_channels))}."
            )

        # Normalize Outcome Status
        status_norm = str(status_raw or "CONTACTED").strip().upper()
        valid_statuses = {s.value for s in VendorOutcomeStatus}
        if status_norm not in valid_statuses:
            raise BadRequestException(
                f"Invalid outcome_status '{status_raw}'. Must be one of {sorted(list(valid_statuses))}."
            )

        # Normalize Price & Currency
        normalized_price = _normalize_price(price_raw)
        currency_norm = str(currency_raw or getattr(event, "currency", "INR") or "INR").strip().upper()

        # Normalize Reported Availability
        avail_norm = str(avail_raw or "UNKNOWN").strip().upper()
        valid_avail = {a.value for a in ReportedAvailability}
        if avail_norm not in valid_avail:
            avail_norm = ReportedAvailability.UNKNOWN.value

        # 5. Build Persistent VendorOutcome Record
        outcome = VendorOutcome(
            event_id=event_id,
            task_id=task_id,
            provider_id=provider_id,
            communication_channel=channel_norm,
            outcome_status=status_norm,
            quoted_price=normalized_price,
            currency=currency_norm,
            reported_availability=avail_norm,
            organizer_notes=organizer_notes.strip() if organizer_notes else None,
            vendor_response=vendor_response or None,
            # Provenance: Always explicitly marked as ORGANIZER_REPORTED and UNVERIFIED
            source="ORGANIZER_REPORTED",
            verification_status="UNVERIFIED",
            submitted_by=sub_by,
        )

        self.db.add(outcome)
        self.db.flush()

        # 6. Record Audit Trail
        audit_record = AuditRecord(
            event_id=event_id,
            actor_id=sub_by or "organizer",
            actor_type="USER",
            action="RECORD_VENDOR_OUTCOME",
            action_type="VENDOR_OUTCOME",
            target_type="VENDOR",
            target_id=provider_id,
            after_state={
                "outcome_id": outcome.id,
                "task_id": task_id,
                "status": status_norm,
                "quoted_price": normalized_price,
                "currency": currency_norm,
                "reported_availability": avail_norm,
                "source": "ORGANIZER_REPORTED",
                "verification_status": "UNVERIFIED",
            },
        )
        self.db.add(audit_record)
        self.db.commit()
        self.db.refresh(outcome)

        return outcome

    def get_outcomes_for_event(
        self,
        event_id: str,
        provider_id: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> List[VendorOutcome]:
        """Lists historical vendor outcomes for an event in reverse chronological order."""
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        query = self.db.query(VendorOutcome).filter(VendorOutcome.event_id == event_id)
        if provider_id:
            query = query.filter(VendorOutcome.provider_id == provider_id)
        if task_id:
            query = query.filter(VendorOutcome.task_id == task_id)

        return query.order_by(VendorOutcome.created_at.desc()).all()

    def get_outcome(self, outcome_id: str, event_id: Optional[str] = None) -> VendorOutcome:
        """Retrieves a single vendor outcome record by UUID."""
        query = self.db.query(VendorOutcome).filter(VendorOutcome.id == outcome_id)
        if event_id:
            query = query.filter(VendorOutcome.event_id == event_id)
        outcome = query.first()
        if not outcome:
            raise NotFoundException(f"Vendor outcome '{outcome_id}' not found.")
        return outcome
