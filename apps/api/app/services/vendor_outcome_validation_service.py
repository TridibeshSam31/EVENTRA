"""Domain Service: VendorOutcomeValidationService (Task 7).

Responsibilities:
1. PARSING:
   - Semantically extracts structured factual claims from organizer notes and reported fields
     using LLMProvider (Google Gemini or configured LLM).
   - Preserves exact source text fragments, confidence scores, and ambiguities.
   - Preserves missing information as UNKNOWN. Never hallucinates or invents claims.
2. DETERMINISTIC VALIDATION:
   - Evaluates each extracted claim against authoritative system state:
     * Event guest count (Capacity validation)
     * Task/Event budget (Financial validation & currency checking)
     * Authoritative calendar availability (ProviderAvailability checking)
     * Task and Event requirements (Hard requirements vs Soft preferences)
     * Vendor master data (Conflict detection)
   - Evaluates claim statuses: PASS, FAIL, UNKNOWN, CONFLICT.
   - Determines overall status: VALIDATED, PARTIALLY_VALIDATED, FAILED, CONFLICT, INSUFFICIENT_INFORMATION.
   - Generates concise, deterministic explanations for every result.
3. PERSISTENCE & AUDIT:
   - Persists VendorOutcomeValidation record.
   - Updates VendorOutcome.verification_status to reflect validation state.
   - Logs an immutable AuditRecord.
4. STRICT GUARDRAILS:
   - NEVER mutates task.provider_id.
   - NEVER mutates task.status.
   - NEVER confirms bookings or commits money.
   - NEVER triggers DAG or critical-path plan recalculations.
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestException,
    NotFoundException,
)
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.budget import BudgetItem
from app.models.requirement import Requirement
from app.models.provider_availability import ProviderAvailability
from app.models.vendor_outcome import VendorOutcome
from app.models.vendor_outcome_validation import VendorOutcomeValidation
from app.models.audit import AuditRecord
from app.models.enums import (
    ClaimType,
    ClaimValidationStatus,
    OverallValidationStatus,
)
from app.schemas.vendor_outcome_validation import (
    ExtractedClaim,
    VendorOutcomeClaims,
    ClaimValidationDetail,
)
from app.agent.provider import LLMProvider
from app.agent.prompts.event_understanding import VENDOR_OUTCOME_PARSING_SYSTEM_PROMPT
from app.integrations.llm.base import get_configured_llm_provider

logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class VendorOutcomeValidationService:
    """Authoritative service for parsing and deterministically validating vendor outcomes."""

    def __init__(self, db: Session, llm_provider: Optional[LLMProvider] = None):
        self.db = db
        self.llm_provider = llm_provider or get_configured_llm_provider()

    def parse_outcome(self, outcome: VendorOutcome) -> VendorOutcomeClaims:
        """Semantically extracts factual claims from an organizer-reported outcome using LLM."""
        notes = (outcome.organizer_notes or "").strip()
        channel = outcome.communication_channel
        status = outcome.outcome_status

        structured_context = {
            "reported_outcome_status": status,
            "communication_channel": channel,
            "form_quoted_price": outcome.quoted_price,
            "form_currency": outcome.currency,
            "form_reported_availability": outcome.reported_availability,
        }

        user_prompt = (
            f"Organizer Reported Notes: \"{notes}\"\n"
            f"Form Fields Context: {structured_context}\n\n"
            "Extract all atomic factual claims (capacity, price, vegetarian/dietary, availability, dates, terms). "
            "Preserve ambiguities and do NOT invent missing information."
        )

        try:
            logger.info("Executing LLM vendor outcome parsing [provider=%s]", type(self.llm_provider).__name__)
            parsed_claims = self.llm_provider.generate_structured(
                system_prompt=VENDOR_OUTCOME_PARSING_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                output_schema=VendorOutcomeClaims,
            )
        except Exception as e:
            logger.warning("LLM parsing encounter error, using structured fallback: %s", str(e))
            parsed_claims = VendorOutcomeClaims(claims=[], ambiguities=[f"Parsing fallback due to: {str(e)}"])

        # Deterministically ensure form-provided structured fields are represented as claims
        existing_types = {c.claim_type for c in parsed_claims.claims}

        if outcome.quoted_price is not None and ClaimType.PRICE.value not in existing_types:
            parsed_claims.claims.append(ExtractedClaim(
                claim_type=ClaimType.PRICE.value,
                field="quoted_price",
                raw_value=outcome.quoted_price,
                normalized_value=float(outcome.quoted_price),
                unit=outcome.currency or "INR",
                source_text="Structured form quoted_price",
                confidence=1.0,
                precision="EXACT",
            ))

        if outcome.reported_availability and outcome.reported_availability != "UNKNOWN" and ClaimType.AVAILABILITY.value not in existing_types:
            parsed_claims.claims.append(ExtractedClaim(
                claim_type=ClaimType.AVAILABILITY.value,
                field="reported_availability",
                raw_value=outcome.reported_availability,
                normalized_value=outcome.reported_availability,
                source_text="Structured form reported_availability",
                confidence=1.0,
                precision="EXACT",
            ))

        return parsed_claims

    def validate_claims(
        self,
        outcome: VendorOutcome,
        claims: VendorOutcomeClaims,
    ) -> VendorOutcomeValidation:
        """Deterministically evaluates extracted claims against authoritative event and vendor state."""
        event_id = outcome.event_id
        task_id = outcome.task_id
        provider_id = outcome.provider_id

        # 1. Load authoritative records
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        vendor = self.db.query(Vendor).filter(Vendor.id == provider_id).first()
        if not vendor:
            raise NotFoundException(f"Vendor with id '{provider_id}' not found.")

        task = None
        if task_id:
            task = self.db.query(Task).filter(Task.id == task_id).first()

        db_requirements = self.db.query(Requirement).filter(Requirement.event_id == event_id).all()
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()

        claim_results: List[ClaimValidationDetail] = []
        hard_reqs_passed: List[str] = []
        hard_reqs_failed: List[str] = []
        prefs_matched: List[str] = []
        conflicts: List[str] = []
        unknown_facts: List[str] = []

        # -------------------------------------------------------------
        # A. Capacity Validation & Master Data Conflict Detection
        # -------------------------------------------------------------
        cap_claim = next((c for c in claims.claims if c.claim_type == ClaimType.CAPACITY.value or c.field == "capacity"), None)
        target_guests = getattr(event, "guest_count", None)

        if not cap_claim:
            claim_results.append(ClaimValidationDetail(
                claim_type=ClaimType.CAPACITY.value,
                field="capacity",
                status=ClaimValidationStatus.UNKNOWN,
                is_hard_requirement=True,
                reported_value=None,
                authoritative_value=target_guests,
                explanation="No vendor guest capacity was provided in the outcome report.",
                source_evidence=None,
            ))
            unknown_facts.append("vendor_guest_capacity")
        else:
            rep_cap = int(cap_claim.normalized_value or cap_claim.raw_value)
            
            # Check for conflict with vendor master data (e.g. recorded max capacity)
            vendor_desc = (vendor.service_description or "").lower()
            master_cap_match = re.search(r'(?:max_guests|max_capacity|capacity)[\s:=_-]*(\d+)', vendor_desc)
            master_max_cap = int(master_cap_match.group(1)) if master_cap_match else None

            if master_max_cap is not None and rep_cap > master_max_cap:
                expl = (
                    f"Organizer-reported capacity of {rep_cap} conflicts with recorded "
                    f"vendor master capacity of {master_max_cap}."
                )
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.CAPACITY.value,
                    field="capacity",
                    status=ClaimValidationStatus.CONFLICT,
                    is_hard_requirement=True,
                    reported_value=rep_cap,
                    authoritative_value=master_max_cap,
                    explanation=expl,
                    source_evidence=cap_claim.source_text,
                ))
                conflicts.append(expl)
            else:
                if target_guests is None or target_guests <= 0:
                    claim_results.append(ClaimValidationDetail(
                        claim_type=ClaimType.CAPACITY.value,
                        field="capacity",
                        status=ClaimValidationStatus.PASS,
                        is_hard_requirement=True,
                        reported_value=rep_cap,
                        authoritative_value=target_guests,
                        explanation=f"Reported capacity of {rep_cap} recorded (no target guest constraint set).",
                        source_evidence=cap_claim.source_text,
                    ))
                    hard_reqs_passed.append(f"Reported capacity {rep_cap}")
                elif rep_cap >= target_guests:
                    expl = f"Reported capacity of {rep_cap} meets the required {target_guests} guests."
                    claim_results.append(ClaimValidationDetail(
                        claim_type=ClaimType.CAPACITY.value,
                        field="capacity",
                        status=ClaimValidationStatus.PASS,
                        is_hard_requirement=True,
                        reported_value=rep_cap,
                        authoritative_value=target_guests,
                        explanation=expl,
                        source_evidence=cap_claim.source_text,
                    ))
                    hard_reqs_passed.append(f"Capacity {rep_cap} >= {target_guests}")
                else:
                    expl = f"Reported capacity of {rep_cap} is below the required {target_guests} guests."
                    claim_results.append(ClaimValidationDetail(
                        claim_type=ClaimType.CAPACITY.value,
                        field="capacity",
                        status=ClaimValidationStatus.FAIL,
                        is_hard_requirement=True,
                        reported_value=rep_cap,
                        authoritative_value=target_guests,
                        explanation=expl,
                        source_evidence=cap_claim.source_text,
                    ))
                    hard_reqs_failed.append(f"Capacity {rep_cap} < {target_guests}")

        # -------------------------------------------------------------
        # B. Budget / Price Validation & Currency Conflict Detection
        # -------------------------------------------------------------
        price_claim = next((c for c in claims.claims if c.claim_type == ClaimType.PRICE.value or c.field == "quoted_price"), None)
        
        # Determine applicable authoritative budget
        allocated_budget = None
        budget_label = "budget"
        task_category = getattr(task, "required_provider_category", None) if task else None

        if task_category:
            cat_match = next((b for b in budget_items if b.category and b.category.upper() == task_category.upper() and b.status != "CANCELLED"), None)
            if cat_match and cat_match.estimated_amount and float(cat_match.estimated_amount) > 0:
                allocated_budget = float(cat_match.estimated_amount)
                budget_label = f"task category '{task_category}' budget"

        if allocated_budget is None and event.total_budget and float(event.total_budget) > 0:
            allocated_budget = float(event.total_budget)
            budget_label = "event total budget"

        if not price_claim and outcome.quoted_price is None:
            claim_results.append(ClaimValidationDetail(
                claim_type=ClaimType.PRICE.value,
                field="quoted_price",
                status=ClaimValidationStatus.UNKNOWN,
                is_hard_requirement=True,
                reported_value=None,
                authoritative_value=allocated_budget,
                explanation="No vendor quoted price was provided in the outcome report.",
                source_evidence=None,
            ))
            unknown_facts.append("quoted_price")
        else:
            rep_price = float(price_claim.normalized_value or price_claim.raw_value) if price_claim else float(outcome.quoted_price)
            rep_curr = (price_claim.unit if price_claim else None) or outcome.currency or "INR"
            auth_curr = getattr(event, "currency", "INR") or "INR"

            # Currency Conflict Detection
            if rep_curr.strip().upper() != auth_curr.strip().upper():
                expl = (
                    f"Currency mismatch: quoted {rep_curr} vs budget {auth_curr} "
                    "without authorized conversion rate."
                )
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.CURRENCY.value,
                    field="currency",
                    status=ClaimValidationStatus.CONFLICT,
                    is_hard_requirement=True,
                    reported_value=rep_curr,
                    authoritative_value=auth_curr,
                    explanation=expl,
                    source_evidence=price_claim.source_text if price_claim else None,
                ))
                conflicts.append(expl)
            elif allocated_budget is None:
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.PRICE.value,
                    field="quoted_price",
                    status=ClaimValidationStatus.UNKNOWN,
                    is_hard_requirement=True,
                    reported_value=rep_price,
                    authoritative_value=None,
                    explanation=f"Quoted price of ₹{rep_price:,.2f} recorded, but no allocated budget exists for comparison.",
                    source_evidence=price_claim.source_text if price_claim else None,
                ))
                unknown_facts.append("allocated_budget")
            elif rep_price <= allocated_budget:
                approx_txt = " (approximate)" if (price_claim and price_claim.precision == "APPROXIMATE") else ""
                expl = f"Quoted price of ₹{rep_price:,.2f}{approx_txt} is within the allocated {budget_label} of ₹{allocated_budget:,.2f}."
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.PRICE.value,
                    field="quoted_price",
                    status=ClaimValidationStatus.PASS,
                    is_hard_requirement=True,
                    reported_value=rep_price,
                    authoritative_value=allocated_budget,
                    explanation=expl,
                    source_evidence=price_claim.source_text if price_claim else None,
                ))
                hard_reqs_passed.append(f"Price ₹{rep_price:,.0f} <= Budget ₹{allocated_budget:,.0f}")
            else:
                expl = f"Quoted price of ₹{rep_price:,.2f} exceeds the allocated {budget_label} of ₹{allocated_budget:,.2f}."
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.PRICE.value,
                    field="quoted_price",
                    status=ClaimValidationStatus.FAIL,
                    is_hard_requirement=True,
                    reported_value=rep_price,
                    authoritative_value=allocated_budget,
                    explanation=expl,
                    source_evidence=price_claim.source_text if price_claim else None,
                ))
                hard_reqs_failed.append(f"Price ₹{rep_price:,.0f} > Budget ₹{allocated_budget:,.0f}")

        # -------------------------------------------------------------
        # C. Availability Validation & Calendar Conflict Detection
        # -------------------------------------------------------------
        avail_claim = next((c for c in claims.claims if c.claim_type == ClaimType.AVAILABILITY.value or c.field == "reported_availability"), None)
        rep_avail_val = avail_claim.normalized_value if avail_claim else outcome.reported_availability

        if rep_avail_val == "UNAVAILABLE":
            expl = "Vendor reported they are unavailable for the event."
            claim_results.append(ClaimValidationDetail(
                claim_type=ClaimType.AVAILABILITY.value,
                field="availability",
                status=ClaimValidationStatus.FAIL,
                is_hard_requirement=True,
                reported_value="UNAVAILABLE",
                authoritative_value="ACTIVE",
                explanation=expl,
                source_evidence=avail_claim.source_text if avail_claim else None,
            ))
            hard_reqs_failed.append("Vendor reported UNAVAILABLE")
        else:
            # Check calendar availability slots
            if not event.start_datetime:
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.AVAILABILITY.value,
                    field="availability",
                    status=ClaimValidationStatus.UNKNOWN,
                    is_hard_requirement=True,
                    reported_value=rep_avail_val,
                    authoritative_value=None,
                    explanation="Event start date is not specified; availability cannot be verified against calendar.",
                    source_evidence=avail_claim.source_text if avail_claim else None,
                ))
                unknown_facts.append("event_calendar_availability")
            else:
                start_dt = event.start_datetime
                end_dt = event.end_datetime or (start_dt + timedelta(hours=8))

                # Query calendar slots
                conflicting_slots = self.db.query(ProviderAvailability).filter(
                    ProviderAvailability.vendor_id == provider_id,
                    ProviderAvailability.status.in_(["BOOKED", "BLOCKED"]),
                    ProviderAvailability.start_datetime < end_dt,
                    ProviderAvailability.end_datetime > start_dt,
                ).all()

                if conflicting_slots:
                    expl = (
                        f"Organizer reported vendor is available, but authoritative calendar records "
                        f"{len(conflicting_slots)} conflicting BOOKED/BLOCKED slot(s) for the requested window."
                    )
                    claim_results.append(ClaimValidationDetail(
                        claim_type=ClaimType.AVAILABILITY.value,
                        field="availability",
                        status=ClaimValidationStatus.CONFLICT,
                        is_hard_requirement=True,
                        reported_value=rep_avail_val,
                        authoritative_value="BOOKED/BLOCKED",
                        explanation=expl,
                        source_evidence=avail_claim.source_text if avail_claim else None,
                    ))
                    conflicts.append(expl)
                else:
                    available_slots = self.db.query(ProviderAvailability).filter(
                        ProviderAvailability.vendor_id == provider_id,
                        ProviderAvailability.status == "AVAILABLE",
                        ProviderAvailability.start_datetime <= start_dt,
                        ProviderAvailability.end_datetime >= end_dt,
                    ).all()

                    if available_slots:
                        expl = f"Authoritative calendar confirms availability for {start_dt.strftime('%B %d, %Y')}."
                        claim_results.append(ClaimValidationDetail(
                            claim_type=ClaimType.AVAILABILITY.value,
                            field="availability",
                            status=ClaimValidationStatus.PASS,
                            is_hard_requirement=True,
                            reported_value=rep_avail_val,
                            authoritative_value="AVAILABLE",
                            explanation=expl,
                            source_evidence=avail_claim.source_text if avail_claim else None,
                        ))
                        hard_reqs_passed.append("Calendar confirmed AVAILABLE")
                    else:
                        # Truthful preservation of UNKNOWN: Organizer reported availability, but calendar has no entry
                        expl = (
                            f"Organizer reported vendor availability, but authoritative system calendar "
                            f"has no verified slot for {start_dt.strftime('%B %d, %Y')}."
                        )
                        claim_results.append(ClaimValidationDetail(
                            claim_type=ClaimType.AVAILABILITY.value,
                            field="availability",
                            status=ClaimValidationStatus.UNKNOWN,
                            is_hard_requirement=True,
                            reported_value=rep_avail_val,
                            authoritative_value="UNVERIFIED",
                            explanation=expl,
                            source_evidence=avail_claim.source_text if avail_claim else None,
                        ))
                        unknown_facts.append("authoritative_calendar_slot")

        # -------------------------------------------------------------
        # D. Requirements & Dietary Validation (Hard vs Soft Preference)
        # -------------------------------------------------------------
        veg_claim = next((c for c in claims.claims if c.claim_type == ClaimType.VEGETARIAN.value or c.field == "vegetarian"), None)
        
        # Check if vegetarian catering is an active event requirement
        veg_req = next((r for r in db_requirements if "veg" in r.name.lower() or "catering" in r.name.lower()), None)
        
        # Also check if task is catering
        is_catering_context = (
            (task and task.required_provider_category and "cater" in task.required_provider_category.lower())
            or (vendor and vendor.category and "cater" in vendor.category.lower())
        )

        if veg_req or (is_catering_context and veg_claim is not None):
            is_mandatory = veg_req.required if veg_req else True
            req_label = veg_req.name if veg_req else "Vegetarian Catering"

            if veg_claim is None:
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.VEGETARIAN.value,
                    field="vegetarian",
                    status=ClaimValidationStatus.UNKNOWN,
                    is_hard_requirement=is_mandatory,
                    reported_value=None,
                    authoritative_value=True,
                    explanation=f"Dietary requirement '{req_label}' was not mentioned in the outcome report.",
                    source_evidence=None,
                ))
                unknown_facts.append(f"requirement_{req_label}")
            elif veg_claim.normalized_value is True or str(veg_claim.raw_value).lower() in ("true", "yes", "available"):
                expl = f"Reported vegetarian menu satisfies dietary requirement '{req_label}'."
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.VEGETARIAN.value,
                    field="vegetarian",
                    status=ClaimValidationStatus.PASS,
                    is_hard_requirement=is_mandatory,
                    reported_value=True,
                    authoritative_value=True,
                    explanation=expl,
                    source_evidence=veg_claim.source_text,
                ))
                if is_mandatory:
                    hard_reqs_passed.append(req_label)
                else:
                    prefs_matched.append(req_label)
            else:
                expl = f"Reported non-vegetarian menu fails requirement '{req_label}'."
                claim_results.append(ClaimValidationDetail(
                    claim_type=ClaimType.VEGETARIAN.value,
                    field="vegetarian",
                    status=ClaimValidationStatus.FAIL,
                    is_hard_requirement=is_mandatory,
                    reported_value=False,
                    authoritative_value=True,
                    explanation=expl,
                    source_evidence=veg_claim.source_text,
                ))
                if is_mandatory:
                    hard_reqs_failed.append(req_label)

        # -------------------------------------------------------------
        # E. Contradiction Detection in Notes
        # -------------------------------------------------------------
        note_lower = (outcome.organizer_notes or "").lower()
        if (
            re.search(r"\bavailable\b", note_lower)
            and re.search(r"\b(?:not\s+available|cannot\s+do|busy)\b", note_lower)
        ):
            expl = "Organizer note contains contradictory availability claims."
            conflicts.append(expl)
            claim_results.append(ClaimValidationDetail(
                claim_type=ClaimType.AVAILABILITY.value,
                field="contradictory_availability",
                status=ClaimValidationStatus.CONFLICT,
                is_hard_requirement=True,
                reported_value="CONTRADICTORY",
                authoritative_value="UNAMBIGUOUS",
                explanation=expl,
                source_evidence=outcome.organizer_notes,
            ))

        # -------------------------------------------------------------
        # F. Overall Validation Status Synthesis
        # -------------------------------------------------------------
        has_conflict = len(conflicts) > 0 or any(r.status == ClaimValidationStatus.CONFLICT for r in claim_results)
        has_hard_fail = len(hard_reqs_failed) > 0 or any(r.status == ClaimValidationStatus.FAIL and r.is_hard_requirement for r in claim_results)
        passed_count = sum(1 for r in claim_results if r.status == ClaimValidationStatus.PASS)
        unknown_count = sum(1 for r in claim_results if r.status == ClaimValidationStatus.UNKNOWN)

        if has_conflict:
            overall_status = OverallValidationStatus.CONFLICT
        elif has_hard_fail:
            overall_status = OverallValidationStatus.FAILED
        elif passed_count > 0 and unknown_count > 0:
            overall_status = OverallValidationStatus.PARTIALLY_VALIDATED
        elif passed_count > 0 and unknown_count == 0:
            overall_status = OverallValidationStatus.VALIDATED
        else:
            overall_status = OverallValidationStatus.INSUFFICIENT_INFORMATION

        summary_parts = [f"Overall: {overall_status.value}."]
        if hard_reqs_passed:
            summary_parts.append(f"Passed: {', '.join(hard_reqs_passed)}.")
        if hard_reqs_failed:
            summary_parts.append(f"Failed: {', '.join(hard_reqs_failed)}.")
        if conflicts:
            summary_parts.append(f"Conflicts: {'; '.join(conflicts)}.")
        if unknown_facts:
            summary_parts.append(f"Unknown: {', '.join(unknown_facts)}.")

        overall_summary = " ".join(summary_parts)

        # -------------------------------------------------------------
        # G. Persistence & Audit Record
        # -------------------------------------------------------------
        validation = VendorOutcomeValidation(
            vendor_outcome_id=outcome.id,
            event_id=event_id,
            task_id=task_id,
            provider_id=provider_id,
            overall_status=overall_status.value,
            extracted_claims=[c.model_dump() for c in claims.claims],
            claim_results=[r.model_dump() for r in claim_results],
            hard_requirements_passed=hard_reqs_passed,
            hard_requirements_failed=hard_reqs_failed,
            preferences_matched=prefs_matched,
            conflicts=conflicts,
            unknown_facts=unknown_facts,
            validator_version="1.0.0",
            summary=overall_summary,
        )
        self.db.add(validation)

        # Update the VendorOutcome verification_status to reflect validation result
        outcome.verification_status = overall_status.value
        self.db.flush()

        # Audit Record
        audit_record = AuditRecord(
            event_id=event_id,
            actor_id=outcome.submitted_by or "system",
            actor_type="SYSTEM",
            action="VALIDATE_VENDOR_OUTCOME",
            action_type="VENDOR_OUTCOME_VALIDATION",
            target_type="VENDOR_OUTCOME",
            target_id=outcome.id,
            after_state={
                "validation_id": validation.id,
                "overall_status": overall_status.value,
                "passed_count": passed_count,
                "failed_count": len(hard_reqs_failed),
                "conflicts_count": len(conflicts),
                "unknown_count": len(unknown_facts),
            },
        )
        self.db.add(audit_record)
        self.db.commit()
        self.db.refresh(validation)

        return validation

    def validate_outcome(
        self,
        outcome_id: str,
        event_id: Optional[str] = None,
    ) -> VendorOutcomeValidation:
        """Loads a persisted vendor outcome, parses claims, and runs deterministic validation."""
        query = self.db.query(VendorOutcome).filter(VendorOutcome.id == outcome_id)
        if event_id:
            query = query.filter(VendorOutcome.event_id == event_id)
        outcome = query.first()
        if not outcome:
            raise NotFoundException(f"VendorOutcome with id '{outcome_id}' not found.")

        # Step 1: Parse claims
        claims = self.parse_outcome(outcome)

        # Step 2: Validate claims deterministically
        validation = self.validate_claims(outcome, claims)
        return validation

    def get_validation(self, outcome_id: str) -> Optional[VendorOutcomeValidation]:
        """Retrieves the latest validation record for a given vendor outcome."""
        return (
            self.db.query(VendorOutcomeValidation)
            .filter(VendorOutcomeValidation.vendor_outcome_id == outcome_id)
            .order_by(VendorOutcomeValidation.created_at.desc())
            .first()
        )
