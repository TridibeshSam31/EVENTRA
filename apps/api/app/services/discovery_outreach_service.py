"""Outreach Service for Agentic Provider Discovery.

Manages vendor availability outreach state machine:
- qualification: qualified | rejected | uncertain
- availability:  unconfirmed | pending_response | confirmed | declined

Safety Invariant: A candidate is NOT shortlist-eligible until availability == confirmed.
Dispatches real/simulated outbound contact calls/messages to confirm vendor willingness.
"""
import logging
import time
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.services.discovery_ranking_engine import RankedCandidate
from app.integrations.registry import registry

logger = logging.getLogger(__name__)


class OutreachContactBatchResult(BaseModel):
    """Result of an outreach batch attempt."""
    batch_size: int
    total_contacted: int
    confirmed_candidates: List[RankedCandidate] = Field(default_factory=list)
    declined_candidates: List[RankedCandidate] = Field(default_factory=list)
    pending_candidates: List[RankedCandidate] = Field(default_factory=list)
    response_rate: float = 0.0


class DiscoveryOutreachService:
    """Coordinates outreach to ranked candidates and tracks availability confirmation state."""

    @classmethod
    def contact_candidate(
        cls,
        item: RankedCandidate,
        event_id: str,
        task_id: Optional[str] = None,
        dev_simulate_responses: bool = False,
    ) -> RankedCandidate:
        """Contacts a single ranked candidate to confirm availability.

        State transitions:
          unconfirmed -> pending_response  (immediately after dispatch)
          pending_response -> confirmed    (only after real inbound reply/voice outcome)
          pending_response -> declined     (only after real inbound reply/voice outcome)

        In dev/test mode (dev_simulate_responses=True), availability is resolved
        deterministically based on rating to unblock local testing — this must
        NEVER be the default or reachable from a production API call.
        """
        cand = item.candidate
        phone = cand.phone or "+919876543210"

        # Step 1: Immediately mark as pending — even before we dispatch
        item.availability = "pending_response"

        # Attempt communication dispatch via registered communication provider
        try:
            comm_provider = registry.get_communication_provider()
            comm_provider.send_message(
                event_id=event_id,
                provider_id=cand.source_id or cand.name,
                message=f"Hello {cand.name}, checking availability for {cand.category} event ID {event_id}.",
                recipient_contact=phone,
            )

            if dev_simulate_responses:
                # DEV ONLY: deterministically resolve based on rating for local testing
                rating = cand.rating or 4.5
                if rating >= 4.0:
                    item.availability = "confirmed"
                    item.reasons.append("[DEV_SIMULATE] Availability confirmed via simulated outreach")
                    if "capacity" in item.field_sources:
                        item.field_sources["capacity"] = "verified"
                    if "base_cost" in item.field_sources:
                        item.field_sources["base_cost"] = "verified"
                else:
                    item.availability = "declined"
                    item.reasons.append("[DEV_SIMULATE] Vendor declined (simulated)")
            else:
                # REAL PATH: stay pending_response — resolved only by inbound WhatsApp webhook
                # or VendorOutcomeService.record_outcome() from a completed AI voice call.
                item.reasons.append(
                    "Outreach contact dispatched via telephony/messaging; awaiting provider response"
                )

        except Exception as exc:
            logger.warning(f"Outreach contact dispatch failed for {cand.name}: {exc}")
            # On dispatch failure, remain pending (not failed-confirmed!) so the operator
            # is aware and can manually follow up or retry.
            item.availability = "pending_response"
            item.reasons.append(f"Outreach dispatch error: {exc} — manual follow-up required")

        return item

    @classmethod
    def contact_batch(
        cls,
        ranked_candidates: List[RankedCandidate],
        event_id: str,
        task_id: Optional[str] = None,
        batch_size: int = 5,
        dev_simulate_responses: bool = False,
    ) -> OutreachContactBatchResult:
        """Contacts a batch of uncontacted qualified candidates and updates their availability states."""
        uncontacted = [c for c in ranked_candidates if c.availability == "unconfirmed"]
        target_batch = uncontacted[:batch_size]

        confirmed: List[RankedCandidate] = []
        declined: List[RankedCandidate] = []
        pending: List[RankedCandidate] = []

        for item in target_batch:
            updated_item = cls.contact_candidate(
                item=item,
                event_id=event_id,
                task_id=task_id,
                dev_simulate_responses=dev_simulate_responses,
            )
            if updated_item.availability == "confirmed":
                confirmed.append(updated_item)
            elif updated_item.availability == "declined":
                declined.append(updated_item)
            else:
                pending.append(updated_item)

        total_contacted = len(target_batch)
        resp_rate = round(len(confirmed) / max(1, total_contacted), 2) if total_contacted > 0 else 0.0

        return OutreachContactBatchResult(
            batch_size=batch_size,
            total_contacted=total_contacted,
            confirmed_candidates=confirmed,
            declined_candidates=declined,
            pending_candidates=pending,
            response_rate=resp_rate,
        )
