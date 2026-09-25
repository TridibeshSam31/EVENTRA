"""Domain Service: IntakeService

Coordinates conversational event intake using real Gemini structured event understanding,
deterministic normalization, missing information detection, canonical plan generation,
and conversational plan updates.
"""
from datetime import datetime, timezone, timedelta
import re
import logging
from typing import Any, Dict, List, Optional, Tuple, Set
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.requirement import Requirement
from app.models.constraint import Constraint
from app.models.objective import Objective
from app.models.enums import EventType, EventState, EventLifecycleState, ProviderCategory
from app.services.specification_service import SpecificationService
from app.services.planning_service import PlanningService
from app.services.event_understanding_service import EventUnderstandingService
from app.services.normalization_utils import (
    parse_indian_number_words,
    normalize_budget,
    normalize_guest_count,
    normalize_service_category,
    SERVICE_CATEGORY_MAP,
)
from app.schemas.event_intent import (
    EventIntent,
    EventChangeProposal,
    SingleChangeProposal,
    ServiceRequirementIntent,
)
from app.schemas.planning import EventPlan
from app.observability.audit import AuditRecorder
from app.agent.provider import LLMProvider
from app.integrations.llm.base import get_configured_llm_provider

logger = logging.getLogger(__name__)


class IntakeService:
    """Coordinates real LLM event understanding, deterministic validation/normalization, and plan management."""

    def __init__(self, db: Session, llm_provider: Optional[LLMProvider] = None):
        self.db = db
        self.llm_provider = llm_provider or get_configured_llm_provider()
        self._understanding_service = EventUnderstandingService(self.llm_provider)
        self._spec_service = SpecificationService(db)
        self._planning_service = PlanningService(db)
        self._audit = AuditRecorder(db)

    def extract_intent(
        self,
        text: str,
        current_event_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Extracts structured EventIntent using Gemini LLM followed by deterministic normalization."""
        # 1. Real LLM Extraction via EventUnderstandingService
        intent_model: EventIntent = self._understanding_service.understand_input(
            user_message=text,
            current_event_context=current_event_context,
        )

        # 2. Deterministic Normalization & Domain Validation
        # A. Event Type
        event_type = None
        if intent_model.event_type:
            raw_type = intent_model.event_type.upper()
            if raw_type in [e.value for e in EventType]:
                event_type = raw_type
            elif "WEDDING" in raw_type or "MARRIAGE" in raw_type or "SHAADI" in raw_type:
                event_type = EventType.WEDDING.value
            elif "COLLEGE_FEST" in raw_type or "HACKATHON" in raw_type or raw_type == "FEST":
                event_type = EventType.COLLEGE_FEST.value
            elif "CONF" in raw_type or "CORPORATE" in raw_type or "SUMMIT" in raw_type:
                event_type = EventType.CONFERENCE.value
            elif "FESTIVAL" in raw_type or "BIRTHDAY" in raw_type:
                event_type = EventType.OTHER.value

        # Fallback event_type detection if Gemini output string was custom or unsupported domain
        if not event_type or event_type not in (EventType.WEDDING.value, EventType.COLLEGE_FEST.value, EventType.CONFERENCE.value):
            text_lower = text.lower()
            if any(k in text_lower for k in ["wedding", "marriage", "shaadi", "reception"]):
                event_type = EventType.WEDDING.value
            elif any(k in text_lower for k in ["hackathon", "fest", "college fest"]):
                event_type = EventType.COLLEGE_FEST.value
            else:
                event_type = EventType.CONFERENCE.value

        # B. Location / City
        city = intent_model.city or intent_model.location
        if city:
            city = city.strip().title()
            if "Gurgaon" in city or "Gurugram" in city:
                city = "Gurgaon"
            elif "Delhi" in city:
                city = "Delhi"

        # C. Guest Count Normalization & Domain Rule Check (guest_count > 0)
        raw_guest = intent_model.guest_count
        raw_guest_expr = intent_model.guest_count_expression
        guest_count = normalize_guest_count(count=raw_guest, expression=raw_guest_expr)

        # D. Budget Normalization & Currency Resolution (budget >= 0)
        b_amount = intent_model.budget_amount or (intent_model.budget.amount if intent_model.budget else None)
        b_expr = intent_model.budget_expression or (intent_model.budget.expression if intent_model.budget else None)
        b_curr = intent_model.budget_currency or (intent_model.budget.currency if intent_model.budget else "INR")

        total_budget, currency = normalize_budget(amount=b_amount, expression=b_expr or text, currency=b_curr)

        # E. Services Needed Categorization into ProviderCategory Enums
        requirements: List[str] = []
        if intent_model.services_needed:
            for srv in intent_model.services_needed:
                cat = normalize_service_category(srv.service_type)
                if cat not in requirements:
                    requirements.append(cat)

        # Also check general requirement strings
        for req_str in intent_model.requirements:
            cat = normalize_service_category(req_str)
            if cat not in requirements:
                requirements.append(cat)

        # F. Date / Time Resolution (Preserve Ambiguity where exact date is missing)
        start_time = None
        end_time = None
        has_exact_date = False
        date_expr = intent_model.date_expression or (intent_model.date.date_expression if intent_model.date else None)
        date_prec = intent_model.date_precision or (intent_model.date.date_precision if intent_model.date else "unknown")
        exact_date_str = intent_model.date.exact_date if (intent_model.date and intent_model.date.exact_date) else None

        # Try parsing explicit exact date if present
        if exact_date_str:
            try:
                start_time = datetime.strptime(exact_date_str, "%Y-%m-%d").replace(hour=9, minute=0, second=0)
                end_time = start_time + timedelta(hours=8)
                has_exact_date = True
            except ValueError:
                pass

        if not start_time:
            text_lower = text.lower()
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            if "tomorrow" in text_lower:
                start_time = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
                end_time = start_time + timedelta(hours=8)
                has_exact_date = True
                date_expr = date_expr or "tomorrow"
                date_prec = "day"
            elif "next week" in text_lower:
                start_time = (now + timedelta(days=7)).replace(hour=9, minute=0, second=0, microsecond=0)
                end_time = start_time + timedelta(hours=8)
                has_exact_date = True
                date_expr = date_expr or "next week"
                date_prec = "week"
            else:
                date_match = re.search(
                    r"(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*(\d{4})?",
                    text_lower,
                )
                if date_match:
                    day = int(date_match.group(1))
                    month_str = date_match.group(2)[:3]
                    year = int(date_match.group(3)) if date_match.group(3) else (now.year if now.month < 11 else now.year + 1)
                    months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
                    month = months.index(month_str) + 1
                    try:
                        start_time = datetime(year, month, day, 9, 0, 0)
                        end_time = start_time + timedelta(hours=8)
                        has_exact_date = True
                        date_expr = date_expr or f"{day} {month_str.title()} {year}"
                        date_prec = "day"
                    except ValueError:
                        pass

        # G. Generate Event Title
        effective_type = event_type or EventType.CONFERENCE.value
        type_title = effective_type.replace("_", " ").title()
        city_title = city or "Metro"
        pax_str = f"{guest_count}-Person " if guest_count else ""
        name = intent_model.event_title or f"{pax_str}{city_title} {type_title} 2026"

        preferences_list = [p.preference_text for p in intent_model.preferences]
        constraints_list = [c.description for c in intent_model.constraints]

        return {
            "intent_model": intent_model,
            "name": name,
            "event_type": event_type,
            "location": city,
            "city": city,
            "guest_count": guest_count,
            "total_budget": total_budget,
            "currency": currency,
            "requirements": requirements,
            "preferences": preferences_list,
            "constraints": constraints_list,
            "special_requests": intent_model.special_requests,
            "venue_preferences": intent_model.venue_preferences,
            "date_expression": date_expr,
            "date_precision": date_prec,
            "start_time": start_time,
            "end_time": end_time,
            "has_date": has_exact_date,
            "has_location": city is not None,
            "has_guest_count": guest_count is not None,
            "has_budget": total_budget is not None,
            "has_event_type": event_type is not None,
            "missing_information": intent_model.missing_information,
            "ambiguities": intent_model.ambiguities,
            "summary": intent_model.summary,
        }

    def detect_missing_info(self, intent: Dict[str, Any]) -> List[str]:
        """Deterministically evaluates which mandatory fields block plan generation."""
        missing = []
        if not intent.get("has_date"):
            date_expr = intent.get("date_expression")
            if date_expr:
                missing.append(f"Exact event date (provided: '{date_expr}', please specify day)")
            else:
                missing.append("Event date (e.g. 15 November 2026)")
        if not intent.get("has_location") or not intent.get("location"):
            missing.append("Target city or venue location (e.g. Delhi, Dholakpur, Gurgaon)")
        if not intent.get("has_guest_count") or not intent.get("guest_count"):
            missing.append("Expected guest/attendee count (e.g. 500 attendees)")
        if not intent.get("has_budget") or not intent.get("total_budget"):
            missing.append("Approximate total budget (e.g. 8 lakh or 12 lakh)")
        return missing

    def format_missing_info_response(self, intent: Dict[str, Any], missing: List[str]) -> str:
        """Formats a clear conversational summary displaying captured attributes, preferences, and missing info."""
        reqs_str = ", ".join(r.replace("_", " ").title() for r in intent.get("requirements", [])) or "Standard operational categories"
        prefs_str = ", ".join(intent.get("preferences", [])) or "None specified"
        currency_sym = "₹" if intent.get("currency") == "INR" else "$"
        budget_str = f"{currency_sym}{intent.get('total_budget', 0):,.0f}" if intent.get("total_budget") else "Not specified"
        guest_str = f"{intent.get('guest_count')} attendees" if intent.get("guest_count") else "Not specified"
        loc_str = intent.get("location") or "Not specified"
        type_str = (intent.get("event_type") or "Conference").title()
        date_str = intent.get("date_expression") or ("Exact Date Needed" if not intent.get("has_date") else "Set")

        lines = [
            f"Understood! Here is what EVENTRA has captured for your **{type_str}**:",
            f"• **Location:** {loc_str}",
            f"• **Attendees:** {guest_str}",
            f"• **Target Budget:** {budget_str}",
            f"• **Date / Timing:** {date_str}",
            f"• **Sourcing Slices:** {reqs_str}",
            f"• **Preferences:** {prefs_str}",
        ]

        if intent.get("ambiguities"):
            lines.append(f"• **Ambiguities Noted:** {', '.join(intent['ambiguities'])}")

        lines.extend([
            "",
            "To complete your canonical Event Specification draft and build the plan, please provide:",
        ])
        for i, m in enumerate(missing, 1):
            lines.append(f"{i}. {m}")

        return "\n".join(lines)

    def process_intake(
        self,
        message: str,
        event_id: Optional[str] = None,
        user_id: str = "anonymous_operator",
        force_plan: bool = False,
    ) -> Dict[str, Any]:
        """Main entry point for natural language event intake with multi-turn context preservation."""
        # 1. Load existing event context if event_id is supplied
        event: Optional[Event] = None
        existing_context: Optional[Dict[str, Any]] = None
        if event_id:
            event = self.db.query(Event).filter(Event.id == event_id).first()
            if event:
                existing_reqs = self.db.query(Requirement).filter(Requirement.event_id == event.id).all()
                existing_context = {
                    "event_type": event.event_type,
                    "location": event.location,
                    "guest_count": event.guest_count,
                    "total_budget": float(event.total_budget or 0),
                    "currency": event.currency,
                    "requirements": [r.type for r in existing_reqs],
                }

        # 2. Extract structured intent via Gemini LLM & Deterministic Normalization
        turn_intent = self.extract_intent(message, current_event_context=existing_context)

        # 3. Merge existing event state with newly extracted intent
        merged_intent = dict(turn_intent)
        if event:
            if not merged_intent["has_event_type"] and event.event_type:
                merged_intent["event_type"] = event.event_type
                merged_intent["has_event_type"] = True
            if not merged_intent["has_location"] and event.location:
                merged_intent["location"] = event.location
                merged_intent["has_location"] = True
            if not merged_intent["has_guest_count"] and event.guest_count:
                merged_intent["guest_count"] = event.guest_count
                merged_intent["has_guest_count"] = True
            if not merged_intent["has_budget"] and event.total_budget:
                merged_intent["total_budget"] = float(event.total_budget)
                merged_intent["has_budget"] = True
            if not merged_intent["has_date"] and event.start_datetime:
                merged_intent["start_time"] = event.start_datetime
                merged_intent["end_time"] = event.end_datetime
                merged_intent["has_date"] = True

            # Merge requirements
            existing_reqs = self.db.query(Requirement).filter(Requirement.event_id == event.id).all()
            existing_types = [r.type for r in existing_reqs]
            if existing_types and not merged_intent["requirements"]:
                merged_intent["requirements"] = existing_types
            else:
                combined = list(set(existing_types + merged_intent["requirements"]))
                if combined:
                    merged_intent["requirements"] = combined

        # Default event type if unspecified
        if not merged_intent.get("event_type"):
            merged_intent["event_type"] = EventType.CONFERENCE.value
            merged_intent["has_event_type"] = True

        # Default category slices based on event_type if still empty
        if not merged_intent["requirements"]:
            if merged_intent["event_type"] == EventType.CONFERENCE.value:
                merged_intent["requirements"] = ["VENUE", "CATERING", "AV_TECH", "PHOTOGRAPHY", "TRANSPORT"]
            elif merged_intent["event_type"] == EventType.WEDDING.value:
                merged_intent["requirements"] = ["VENUE", "CATERING", "DECOR", "PHOTOGRAPHY", "DJ_MUSIC"]
            elif merged_intent["event_type"] == EventType.COLLEGE_FEST.value:
                merged_intent["requirements"] = ["VENUE", "AV_TECH", "DJ_MUSIC", "SECURITY", "CATERING"]
            else:
                merged_intent["requirements"] = ["VENUE", "CATERING", "AV_TECH"]

        # Check missing information
        missing = self.detect_missing_info(merged_intent)

        # 4. If critical info is missing and not forced, persist DRAFT event and prompt user
        if missing and not force_plan:
            if not event:
                event = Event(
                    owner_id=user_id,
                    name=merged_intent["name"],
                    description=f"Draft intake from: '{message[:200]}'",
                    event_type=merged_intent["event_type"],
                    location=merged_intent.get("location") or "Pending Location",
                    start_datetime=merged_intent.get("start_time"),
                    end_datetime=merged_intent.get("end_time"),
                    guest_count=merged_intent.get("guest_count") or 100,
                    total_budget=merged_intent.get("total_budget") or 500000.0,
                    currency=merged_intent["currency"],
                    state=EventState.NORMAL.value,
                    lifecycle_state=EventLifecycleState.DRAFT.value,
                )
                self.db.add(event)
                self.db.commit()
                self.db.refresh(event)
            else:
                if merged_intent.get("location"):
                    event.location = merged_intent["location"]
                if merged_intent.get("guest_count"):
                    event.guest_count = merged_intent["guest_count"]
                if merged_intent.get("total_budget"):
                    event.total_budget = merged_intent["total_budget"]
                if merged_intent.get("start_time"):
                    event.start_datetime = merged_intent["start_time"]
                    event.end_datetime = merged_intent["end_time"]
                self.db.commit()
                self.db.refresh(event)

            # Persist requirements captured so far
            if merged_intent["requirements"]:
                self.db.query(Requirement).filter(Requirement.event_id == event.id).delete()
                for cat in merged_intent["requirements"]:
                    req = Requirement(
                        event_id=event.id,
                        name=f"{cat.replace('_', ' ').title()} Sourcing",
                        type=cat,
                        required=True,
                        description=f"Operational requirement for {cat.replace('_', ' ').title()}",
                        value={"category": cat, "auto_source": True},
                    )
                    self.db.add(req)
                self.db.commit()

            return {
                "status": "MISSING_INFO",
                "message": self.format_missing_info_response(merged_intent, missing),
                "intent": {
                    "event_type": merged_intent["event_type"],
                    "location": merged_intent["location"],
                    "guest_count": merged_intent["guest_count"],
                    "total_budget": merged_intent["total_budget"],
                    "currency": merged_intent["currency"],
                    "requirements": merged_intent["requirements"],
                    "preferences": merged_intent.get("preferences", []),
                    "constraints": merged_intent.get("constraints", []),
                    "date_expression": merged_intent.get("date_expression"),
                    "date_precision": merged_intent.get("date_precision"),
                },
                "missing_fields": missing,
                "event_id": event.id,
                "event": {
                    "id": event.id,
                    "name": event.name,
                    "event_type": event.event_type,
                    "location": event.location,
                    "start_time": event.start_datetime.isoformat() if event.start_datetime else None,
                    "end_time": event.end_datetime.isoformat() if event.end_datetime else None,
                    "guest_count": event.guest_count,
                    "total_budget": float(event.total_budget or 0),
                    "currency": event.currency,
                    "lifecycle_state": event.lifecycle_state,
                    "requirements": merged_intent["requirements"],
                },
                "plan": None,
            }

        # 5. All critical info is present (or force_plan): Generate canonical Event Specification & Plan
        if not merged_intent.get("start_time"):
            default_start = (datetime.now(timezone.utc) + timedelta(days=30)).replace(
                hour=9, minute=0, second=0, microsecond=0, tzinfo=None
            )
            merged_intent["start_time"] = default_start
            merged_intent["end_time"] = default_start + timedelta(hours=9)

        if not event:
            event = Event(
                owner_id=user_id,
                name=merged_intent["name"],
                description=f"Authoritative event generated from organizer request: '{message[:200]}'",
                event_type=merged_intent["event_type"],
                location=merged_intent["location"] or "Delhi",
                start_datetime=merged_intent["start_time"],
                end_datetime=merged_intent["end_time"],
                guest_count=merged_intent["guest_count"] or 100,
                total_budget=merged_intent["total_budget"] or 500000.0,
                currency=merged_intent["currency"],
                state=EventState.NORMAL.value,
                lifecycle_state=EventLifecycleState.DRAFT.value,
            )
            self.db.add(event)
            self.db.flush()
        else:
            event.name = merged_intent["name"]
            event.event_type = merged_intent["event_type"]
            event.location = merged_intent["location"] or event.location
            event.start_datetime = merged_intent["start_time"]
            event.end_datetime = merged_intent["end_time"]
            event.guest_count = merged_intent["guest_count"] or event.guest_count
            event.total_budget = merged_intent["total_budget"] or event.total_budget
            event.currency = merged_intent["currency"]

        # Persist requirements
        self.db.query(Requirement).filter(Requirement.event_id == event.id).delete()
        for cat in merged_intent["requirements"]:
            req = Requirement(
                event_id=event.id,
                name=f"{cat.replace('_', ' ').title()} Sourcing",
                type=cat,
                required=True,
                description=f"Operational requirement for {cat.replace('_', ' ').title()}",
                value={"category": cat, "auto_source": True},
            )
            self.db.add(req)

        # Persist constraints
        self.db.query(Constraint).filter(Constraint.event_id == event.id).delete()
        for c_desc in merged_intent.get("constraints", []):
            c_obj = Constraint(
                event_id=event.id,
                name=c_desc[:100],
                type="GENERAL",
                severity="HARD",
                description=c_desc,
                value={"description": c_desc},
            )
            self.db.add(c_obj)

        event.lifecycle_state = EventLifecycleState.DRAFT.value
        self.db.commit()
        self.db.refresh(event)

        # Build canonical Event Specification via SpecificationService
        spec = self._spec_service.build_specification(event=event)

        # Generate Authoritative Plan via PlanningService
        plan = self._planning_service.generate_plan(event.id)

        self._audit.record(
            event_id=event.id,
            actor_id=user_id,
            actor_type="USER",
            action="OPERATIONAL_PLAN_GENERATED",
            action_type="PLANNING",
            target_type="EVENT",
            target_id=event.id,
            after_state={
                "event_name": event.name,
                "total_tasks": plan.summary.total_tasks,
                "total_budget": float(event.total_budget),
                "requirements": merged_intent["requirements"],
            },
        )

        currency_sym = "₹" if event.currency == "INR" else "$"
        date_str = event.start_datetime.strftime("%d %B %Y") if event.start_datetime else "TBD"
        resp_msg = (
            f"I have built the complete operational plan for **{event.name}** in {event.location} on {date_str}.\n\n"
            f"**Plan Overview:**\n"
            f"• **Budget Allocation:** {currency_sym}{plan.summary.total_estimated_budget:,.0f} / {currency_sym}{float(event.total_budget):,.0f}\n"
            f"• **Tasks & Milestones:** {plan.summary.total_tasks} executable tasks ({plan.summary.critical_path_tasks} on critical path)\n"
            f"• **Dependencies:** {plan.summary.total_dependencies} dependency relationships tracked\n"
            f"• **Required Resources:** {plan.summary.total_resources} resources mapped\n"
            f"• **Sourcing Slices:** {', '.join(r.replace('_', ' ').title() for r in merged_intent['requirements'])}\n\n"
            f"You can review or modify requirements below, or say **'Start Operations'** to begin autonomous execution."
        )

        return {
            "status": "PLAN_READY",
            "message": resp_msg,
            "intent": {
                "event_type": merged_intent["event_type"],
                "location": merged_intent["location"],
                "guest_count": merged_intent["guest_count"],
                "total_budget": merged_intent["total_budget"],
                "currency": merged_intent["currency"],
                "requirements": merged_intent["requirements"],
                "preferences": merged_intent.get("preferences", []),
                "constraints": merged_intent.get("constraints", []),
                "date_expression": merged_intent.get("date_expression"),
            },
            "specification": spec.model_dump(),
            "event_id": event.id,
            "event": {
                "id": event.id,
                "name": event.name,
                "event_type": event.event_type,
                "location": event.location,
                "start_time": event.start_datetime.isoformat() if event.start_datetime else None,
                "end_time": event.end_datetime.isoformat() if event.end_datetime else None,
                "guest_count": event.guest_count,
                "total_budget": float(event.total_budget or 0),
                "currency": event.currency,
                "lifecycle_state": event.lifecycle_state,
                "requirements": merged_intent["requirements"],
            },
            "plan": plan.model_dump(),
        }

    def modify_plan(
        self,
        event_id: str,
        modification_text: str,
        user_id: str = "anonymous_operator",
    ) -> Dict[str, Any]:
        """Modifies the event specification via context-aware LLM change proposal and regenerates the operational plan."""
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise ValueError(f"Event '{event_id}' not found.")

        existing_reqs = self.db.query(Requirement).filter(Requirement.event_id == event.id).all()
        current_cats = {r.type for r in existing_reqs}

        event_context = {
            "event_id": event.id,
            "name": event.name,
            "event_type": event.event_type,
            "location": event.location,
            "guest_count": event.guest_count,
            "total_budget": float(event.total_budget or 0),
            "currency": event.currency,
            "requirements": list(current_cats),
        }

        # 1. Obtain structured ChangeProposal via LLM
        change_proposal: EventChangeProposal = self._understanding_service.understand_modification(
            user_message=modification_text,
            current_event_context=event_context,
        )

        changes_made = []

        # 2. Process structured changes proposed by LLM
        if change_proposal.changes:
            for ch in change_proposal.changes:
                if ch.field == "guest_count" and ch.new_value:
                    try:
                        new_g = int(ch.new_value)
                        if new_g > 0:
                            event.guest_count = new_g
                            changes_made.append(f"Updated guest count to {new_g}")
                    except (ValueError, TypeError):
                        pass

                elif ch.field == "budget" and ch.new_value:
                    try:
                        new_b, _ = normalize_budget(amount=float(ch.new_value) if isinstance(ch.new_value, (int, float)) else None, expression=str(ch.new_value))
                        if new_b and new_b > 0:
                            event.total_budget = new_b
                            changes_made.append(f"Updated total budget to ₹{new_b:,.0f}")
                    except (ValueError, TypeError):
                        pass

                elif ch.field == "location" and ch.new_value:
                    loc_str = str(ch.new_value).strip().title()
                    if loc_str:
                        event.location = "Gurgaon" if "Gurgaon" in loc_str or "Gurugram" in loc_str else loc_str
                        changes_made.append(f"Moved event location to {event.location}")

                elif ch.operation == "REMOVE_SERVICE" or (ch.field == "service" and ch.operation in ("REMOVE", "DELETE")):
                    srv_cat = normalize_service_category(ch.target_service or str(ch.new_value or ch.old_value))
                    if srv_cat in current_cats:
                        current_cats.remove(srv_cat)
                        changes_made.append(f"Removed {srv_cat.replace('_', ' ').title()}")

                elif ch.operation == "ADD_SERVICE" or (ch.field == "service" and ch.operation in ("ADD", "INCLUDE")):
                    srv_cat = normalize_service_category(ch.target_service or str(ch.new_value))
                    if srv_cat not in current_cats:
                        current_cats.add(srv_cat)
                        changes_made.append(f"Added {srv_cat.replace('_', ' ').title()}")

        # Deterministic fallback check if LLM proposal had no changes recognized
        if not changes_made:
            mod_lower = modification_text.lower()
            word_budget = parse_indian_number_words(mod_lower)
            if word_budget and word_budget > 0 and any(k in mod_lower for k in ["budget", "increase", "set", "update", "cost"]):
                event.total_budget = word_budget
                changes_made.append(f"Updated total budget to ₹{word_budget:,.0f}")

            guest_match = re.search(r"(?:attendance|guests?|attendees?|people|pax)\s*(?:to|is)?\s*(\d+)", mod_lower)
            if guest_match:
                new_guests = int(guest_match.group(1))
                if new_guests > 0:
                    event.guest_count = new_guests
                    changes_made.append(f"Updated guest count to {new_guests}")

            loc_match = re.search(r"(?:move|change|relocate|shift)\s+(?:the\s+)?(?:event\s+)?(?:to\s+|location\s+to\s+)([a-zA-Z\s]+)", mod_lower)
            if loc_match:
                clean_city = re.split(r"\s+(?:and|with|on|at|for|also)\b", loc_match.group(1).strip())[0].strip()
                if clean_city:
                    event.location = "Gurgaon" if "gurgaon" in clean_city.lower() or "gurugram" in clean_city.lower() else clean_city.title()
                    changes_made.append(f"Moved event location to {event.location}")

            # Removals
            for kw, cat in SERVICE_CATEGORY_MAP.items():
                if re.search(rf"(?:remove|delete|drop|no|without)\s+(?:the\s+)?{re.escape(kw)}", mod_lower):
                    if cat in current_cats:
                        current_cats.remove(cat)
                        changes_made.append(f"Removed {cat.replace('_', ' ').title()}")

            # Additions
            for kw, cat in SERVICE_CATEGORY_MAP.items():
                if re.search(rf"(?:add|include|need|require|with)\s+(?:the\s+)?{re.escape(kw)}", mod_lower):
                    if cat not in current_cats:
                        current_cats.add(cat)
                        changes_made.append(f"Added {cat.replace('_', ' ').title()}")

        # Update event title to match new params
        pax_str = f"{event.guest_count}-Person " if event.guest_count else ""
        event.name = f"{pax_str}{event.location} {event.event_type.replace('_', ' ').title()} 2026"

        # Re-persist updated requirements
        self.db.query(Requirement).filter(Requirement.event_id == event.id).delete()
        for cat in current_cats:
            req = Requirement(
                event_id=event.id,
                name=f"{cat.replace('_', ' ').title()} Sourcing",
                type=cat,
                required=True,
                description=f"Operational requirement for {cat.replace('_', ' ').title()}",
                value={"category": cat, "auto_source": True},
            )
            self.db.add(req)

        # Reset lifecycle to DRAFT to generate updated plan
        event.lifecycle_state = EventLifecycleState.DRAFT.value
        self.db.commit()
        self.db.refresh(event)

        # Recompile canonical Event Specification
        spec = self._spec_service.build_specification(event=event)

        # Regenerate plan
        updated_plan = self._planning_service.generate_plan(event.id)

        self._audit.record(
            event_id=event.id,
            actor_id=user_id,
            actor_type="USER",
            action="OPERATIONAL_PLAN_MODIFIED",
            action_type="PLANNING",
            target_type="EVENT",
            target_id=event.id,
            after_state={
                "changes": changes_made,
                "total_tasks": updated_plan.summary.total_tasks,
                "requirements": list(current_cats),
                "location": event.location,
                "total_budget": float(event.total_budget or 0),
            },
        )

        currency_sym = "₹" if event.currency == "INR" else "$"
        changes_str = "; ".join(changes_made) if changes_made else "Updated requirements and plan configuration"
        resp_msg = (
            f"Updated the operational plan based on your request ({changes_str}).\n\n"
            f"**New Plan Overview:**\n"
            f"• **Location:** {event.location}\n"
            f"• **Budget Allocation:** {currency_sym}{updated_plan.summary.total_estimated_budget:,.0f} / {currency_sym}{float(event.total_budget):,.0f}\n"
            f"• **Tasks:** {updated_plan.summary.total_tasks} executable tasks ({updated_plan.summary.critical_path_tasks} critical path)\n"
            f"• **Active Requirements:** {', '.join(c.replace('_', ' ').title() for c in current_cats)}\n\n"
            f"Say **'Start Operations'** when you are ready to begin autonomous execution."
        )

        return {
            "status": "PLAN_UPDATED",
            "message": resp_msg,
            "changes": changes_made,
            "specification": spec.model_dump(),
            "event_id": event.id,
            "event": {
                "id": event.id,
                "name": event.name,
                "event_type": event.event_type,
                "location": event.location,
                "start_time": event.start_datetime.isoformat() if event.start_datetime else None,
                "end_time": event.end_datetime.isoformat() if event.end_datetime else None,
                "guest_count": event.guest_count,
                "total_budget": float(event.total_budget or 0),
                "currency": event.currency,
                "lifecycle_state": event.lifecycle_state,
                "requirements": list(current_cats),
            },
            "plan": updated_plan.model_dump(),
            "requirements": list(current_cats),
        }
