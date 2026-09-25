"""LLM Provider abstraction for the Event Operations Agent.

Provides an abstract LLM interface, a RealLLMProvider for real Google Gemini model
invocations, and a MockLLMProvider strictly for automated testing and offline fallback.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Type, TypeVar, Union
import json
import logging
import os
import time
import warnings

from pydantic import BaseModel, Field, ValidationError
from pydantic_core import PydanticUndefined

from app.agent.errors import (
    LLMError,
    MissingAPIKeyError,
    UnsupportedProviderError,
    GeminiAuthError,
    GeminiAPIError,
    ModelInvocationError,
    LLMTimeoutError,
    MalformedOutputError,
    StructuredValidationError,
)
from app.agent.decision import AgentDecision, DecisionType, ReasonCode

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


# --- Structured schemas for existing agent operational workflows ---

class IncidentInterpretationOutput(BaseModel):
    interpreted_type: str = Field(..., description="Operational incident category enum")
    requires_recovery: bool = Field(..., description="Whether automated or manual recovery planning is needed")
    priority: str = Field("HIGH", description="Priority level: LOW, MEDIUM, HIGH, CRITICAL")
    summary: str = Field(..., description="Concise operational summary of the situation")


class RecoverySelectionOutput(BaseModel):
    selected_option_id: Optional[str] = Field(None, description="The ID of the recommended candidate option")
    rationale: str = Field(..., description="Clear operational rationale for why this option was chosen")


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    def generate_text(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
    ) -> str:
        """Generates plain text operational message or response."""
        pass

    @abstractmethod
    def generate_structured(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
        output_schema: Type[T],
    ) -> T:
        """Generates a structured response strictly validated against output_schema (Pydantic model)."""
        pass

    @abstractmethod
    def interpret_incident(
        self,
        user_message: str,
        event_context: Dict[str, Any],
        open_incidents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Interprets the natural language operational situation."""
        pass

    @abstractmethod
    def select_recovery_strategy(
        self,
        candidate_options: List[Dict[str, Any]],
        incident_context: Dict[str, Any],
        risk_context: Dict[str, Any],
    ) -> Optional[str]:
        """Reasons over deterministic candidate options and selects the optimal recovery option ID."""
        pass

    @abstractmethod
    def format_operational_response(
        self,
        status: str,
        context: Dict[str, Any],
    ) -> str:
        """Formats a clear, concise operational status message for the event operator."""
        pass

    @abstractmethod
    def decide_next_action(
        self,
        operational_context: Dict[str, Any],
        available_tools: List[Dict[str, Any]],
        current_objective: str,
        tool_history: List[Dict[str, Any]],
        previous_result: Optional[Dict[str, Any]] = None,
    ) -> AgentDecision:
        """Reasons over live operational state and dynamically selects the next tool or action."""
        pass


class MockLLMProvider(LLMProvider):
    """Deterministic mock provider strictly for automated tests and offline environments.
    
    WARNING: This is a test/offline fallback mock, NOT a live LLM.
    Ensures tests pass deterministically without external network or API key dependencies.
    """

    def __init__(self, custom_responses: Optional[Dict[str, Any]] = None):
        self._custom_responses = custom_responses or {}

    def generate_text(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
    ) -> str:
        if "generate_text" in self._custom_responses:
            return str(self._custom_responses["generate_text"])
        return f"[MOCK_TEXT] Processed prompt: {user_prompt[:60]}"

    def generate_structured(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
        output_schema: Type[T],
    ) -> T:
        if not issubclass(output_schema, BaseModel):
            raise TypeError(f"output_schema must be a Pydantic BaseModel subclass, got {output_schema}")

        if "structured" in self._custom_responses:
            custom_data = self._custom_responses["structured"]
            if isinstance(custom_data, output_schema):
                return custom_data
            if isinstance(custom_data, dict):
                return output_schema.model_validate(custom_data)

        # Smart mock handling for EventIntent and EventChangeProposal in test environments
        schema_name = getattr(output_schema, "__name__", "")
        if schema_name == "EventIntent":
            return self._mock_generate_event_intent(user_prompt, output_schema)
        elif schema_name == "EventChangeProposal":
            return self._mock_generate_event_change_proposal(user_prompt, output_schema)
        elif schema_name == "VendorOutcomeClaims":
            return self._mock_generate_vendor_outcome_claims(user_prompt, output_schema)

        # Build minimal valid mock instance by inspecting fields
        mock_fields: Dict[str, Any] = {}
        for field_name, field_info in output_schema.model_fields.items():
            if (
                field_info.default is not PydanticUndefined
                and field_info.default is not None
                and field_info.default != Ellipsis
            ):
                mock_fields[field_name] = field_info.default
            elif field_info.default_factory is not None:
                mock_fields[field_name] = field_info.default_factory()
            else:
                # Provide reasonable dummy value based on annotation string
                ann_str = str(field_info.annotation).lower()
                if "int" in ann_str:
                    mock_fields[field_name] = 100
                elif "float" in ann_str:
                    mock_fields[field_name] = 1.0
                elif "bool" in ann_str:
                    mock_fields[field_name] = True
                elif "list" in ann_str:
                    mock_fields[field_name] = ["mock_item"]
                elif "dict" in ann_str:
                    mock_fields[field_name] = {"mock_key": "mock_value"}
                else:
                    mock_fields[field_name] = f"mock_{field_name}"

        return output_schema.model_validate(mock_fields)

    def _mock_generate_event_intent(self, user_prompt: str, output_schema: Type[T]) -> T:
        """Deterministic mock builder for EventIntent strictly for tests."""
        import re
        from app.schemas.event_intent import (
            EventIntent,
            BudgetIntent,
            DateIntent,
            ServiceRequirementIntent,
            EventPreferenceIntent,
            EventConstraintIntent,
        )
        from app.services.normalization_utils import parse_indian_number_words, SERVICE_CATEGORY_MAP

        text_lower = user_prompt.lower()

        # 1. Event Type
        event_type = "OTHER"
        if any(k in text_lower for k in ["wedding", "shaadi", "marriage", "reception"]):
            event_type = "WEDDING"
        elif any(k in text_lower for k in ["conference", "summit", "corporate", "offsite"]):
            event_type = "CONFERENCE"
        elif "festival" in text_lower or "diwali" in text_lower:
            event_type = "FESTIVAL"
        elif any(k in text_lower for k in ["hackathon", "college fest", "campus fest"]):
            event_type = "COLLEGE_FEST"
        elif "birthday" in text_lower:
            event_type = "BIRTHDAY"

        # 2. Location / City
        location = None
        for c in ["dholakpur", "delhi", "gurgaon", "gurugram", "mumbai", "jaipur", "bangalore", "chandigarh", "noida", "pune", "hyderabad", "goa"]:
            if re.search(rf"\b{re.escape(c)}\b", text_lower):
                location = "Gurgaon" if c in ("gurgaon", "gurugram") else ("Delhi" if c in ("delhi", "new delhi") else c.title())
                break

        # 3. Guest Count
        guest_count = None
        pax_match = re.search(r"(\d+)\s*[-]?\s*(?:person|people|attendee|attendees|guest|guests|pax|members)", text_lower)
        if pax_match:
            guest_count = int(pax_match.group(1))
        else:
            words_num_map = {"five hundred": 500, "three hundred": 300, "four hundred": 400, "six hundred": 600}
            for w, n in words_num_map.items():
                if w in text_lower:
                    guest_count = n
                    break
            if not guest_count:
                num_match = re.search(r"\b(\d{2,4})\b", text_lower)
                if num_match:
                    val = int(num_match.group(1))
                    if 20 <= val <= 5000 and not (2020 <= val <= 2035):
                        guest_count = val

        # 4. Budget
        budget_obj = None
        word_budget = parse_indian_number_words(text_lower)
        if word_budget and word_budget > 0:
            expr = "around " + text_lower[text_lower.find("lakh"):text_lower.find("lakh")+10] if "lakh" in text_lower else f"₹{word_budget}"
            is_flex = "stretch" in text_lower or "around" in text_lower or "flexible" in text_lower
            budget_obj = BudgetIntent(
                amount=word_budget,
                currency="INR",
                expression=expr,
                is_flexible=is_flex,
            )
        else:
            k_match = re.search(r"(?:\$|usd)?\s*(\d+(?:\.\d+)?)\s*(?:k|thousand)\b", text_lower)
            if k_match:
                budget_obj = BudgetIntent(
                    amount=float(k_match.group(1)) * 1000.0,
                    currency="USD",
                    expression=k_match.group(0),
                    is_flexible="around" in text_lower,
                )

        # 5. Date & Timing
        date_obj = None
        exact_d = None
        date_expr = None
        precision = "unknown"
        if "december" in text_lower:
            date_expr = "December"
            precision = "month"
        elif "second week of october" in text_lower:
            date_expr = "second week of October"
            precision = "week"
        elif "next friday" in text_lower:
            date_expr = "next Friday"
            precision = "day"
        elif "3rd december" in text_lower:
            date_expr = "3rd December"
            precision = "day"
            exact_d = "2026-12-03"

        time_expr = None
        if "6 pm to 10 pm" in text_lower or "6pm to 10pm" in text_lower:
            time_expr = "6 PM to 10 PM"
        elif "evening" in text_lower:
            time_expr = "evening"
        elif "morning" in text_lower:
            time_expr = "morning"

        if date_expr or time_expr or exact_d:
            date_obj = DateIntent(
                date_expression=date_expr,
                date_precision=precision,
                exact_date=exact_d,
                time_expression=time_expr,
                start_time_expression="6 PM" if time_expr and "6" in time_expr else None,
                end_time_expression="10 PM" if time_expr and "10" in time_expr else None,
            )

        # 6. Services Needed
        services: List[ServiceRequirementIntent] = []
        for kw, cat in SERVICE_CATEGORY_MAP.items():
            if re.search(rf"\b{re.escape(kw)}\b", text_lower):
                srv_name = cat.lower()
                if not any(s.service_type == srv_name for s in services):
                    detail = f"vegetarian {srv_name}" if "vegetarian" in text_lower and srv_name == "catering" else None
                    services.append(ServiceRequirementIntent(
                        service_type=srv_name,
                        details=detail,
                        is_mandatory=True,
                    ))

        # 7. Preferences & Constraints
        prefs: List[EventPreferenceIntent] = []
        if "vegetarian" in text_lower:
            prefs.append(EventPreferenceIntent(category="catering", preference_text="vegetarian catering"))
        if "outdoor" in text_lower:
            prefs.append(EventPreferenceIntent(category="venue", preference_text="outdoor venue"))

        constraints: List[EventConstraintIntent] = []
        if guest_count:
            constraints.append(EventConstraintIntent(
                constraint_type="capacity",
                description=f"venue capacity >= {guest_count}",
                is_hard=True,
            ))

        # 8. Missing Information
        missing: List[str] = []
        if not date_expr and not exact_d:
            missing.append("event_date")
        if not location:
            missing.append("location")
        if not guest_count:
            missing.append("guest_count")
        if not budget_obj or not budget_obj.amount:
            missing.append("budget")

        # 9. Ambiguities
        ambiguities: List[str] = []
        for amb in ["large venue", "good venue", "reasonable budget", "premium catering", "around october"]:
            if amb in text_lower:
                ambiguities.append(amb)

        intent = EventIntent(
            event_type=event_type,
            event_title=f"{location or 'Metro'} {event_type.title()}" if location else f"{event_type.title()}",
            event_description=f"Interpreted event intent from prompt: '{user_prompt[:100]}'",
            location=location,
            city=location,
            guest_count=guest_count,
            budget=budget_obj,
            budget_amount=budget_obj.amount if budget_obj else None,
            budget_currency=budget_obj.currency if budget_obj else "INR",
            date=date_obj,
            date_expression=date_expr,
            date_precision=precision,
            services_needed=services,
            preferences=prefs,
            constraints=constraints,
            missing_information=missing,
            ambiguities=ambiguities,
            summary=f"Interpreted {event_type} event in {location or 'TBD'} for {guest_count or 'TBD'} guests.",
        )
        return intent

    def _mock_generate_event_change_proposal(self, user_prompt: str, output_schema: Type[T]) -> T:
        """Deterministic mock builder for EventChangeProposal strictly for tests."""
        import re
        from app.schemas.event_intent import EventChangeProposal, SingleChangeProposal
        from app.services.normalization_utils import parse_indian_number_words

        text_lower = user_prompt.lower()
        changes: List[SingleChangeProposal] = []

        # Check guest count update
        guest_match = re.search(r"(\d+)\s*(?:people|guests|attendees|pax)", text_lower)
        if not guest_match:
            guest_match = re.search(r"(?:make it|change to|guests? to)\s*(\d+)", text_lower)
        if guest_match:
            new_g = int(guest_match.group(1))
            changes.append(SingleChangeProposal(
                operation="UPDATE",
                field="guest_count",
                new_value=new_g,
                reason="Organizer updated guest count",
            ))

        # Check budget update
        word_b = parse_indian_number_words(text_lower)
        if word_b and word_b > 0 and any(k in text_lower for k in ["budget", "lakh", "crore", "increase", "make"]):
            changes.append(SingleChangeProposal(
                operation="UPDATE",
                field="budget",
                new_value=word_b,
                reason="Organizer updated budget",
            ))

        # Check location update
        if "gurgaon" in text_lower:
            changes.append(SingleChangeProposal(
                operation="UPDATE",
                field="location",
                new_value="Gurgaon",
                reason="Organizer moved location to Gurgaon",
            ))

        # Check service removal
        if any(k in text_lower for k in ["remove photography", "no photography", "delete photography", "hata do"]):
            changes.append(SingleChangeProposal(
                operation="REMOVE_SERVICE",
                field="service",
                target_service="photography",
                reason="Organizer removed photography service",
            ))

        # Check service addition
        if any(k in text_lower for k in ["add security", "include security", "need security"]):
            changes.append(SingleChangeProposal(
                operation="ADD_SERVICE",
                field="service",
                target_service="security",
                reason="Organizer added security service",
            ))

        proposal = EventChangeProposal(
            is_modification=True,
            changes=changes,
            summary=f"Proposed {len(changes)} modifications based on prompt.",
        )
        return proposal

    def _mock_generate_vendor_outcome_claims(self, user_prompt: str, output_schema: Type[T]) -> T:
        """Deterministic mock builder for VendorOutcomeClaims strictly for tests and offline fallback."""
        import re
        from app.schemas.vendor_outcome_validation import VendorOutcomeClaims, ExtractedClaim

        text_lower = user_prompt.lower()
        claims: List[ExtractedClaim] = []
        ambiguities: List[str] = []

        # 1. Capacity
        cap_match = re.search(r"(?:can\s+(?:do|cater|handle|accommodate)|capacity|up to|guests?|pax)\s*(?:for\s*)?(\d+)", text_lower)
        if not cap_match:
            cap_match = re.search(r"(\d+)\s*(?:guests|people|pax|attendees)", text_lower)
        if cap_match:
            cap_val = int(cap_match.group(1))
            claims.append(ExtractedClaim(
                claim_type="CAPACITY",
                field="capacity",
                raw_value=cap_val,
                normalized_value=cap_val,
                unit="guests",
                source_text=cap_match.group(0),
                confidence=0.98,
                precision="EXACT",
            ))

        # 2. Quoted Price
        price_val = None
        price_src = None
        price_prec = "APPROXIMATE" if any(w in text_lower for w in ["around", "approx", "about", "roughly"]) else "EXACT"

        lakh_match = re.search(r"(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:lakh|lac|l)\b", text_lower)
        if lakh_match:
            try:
                price_val = float(lakh_match.group(1)) * 100000.0
                price_src = lakh_match.group(0)
            except ValueError:
                pass
        if price_val is None:
            raw_num_match = re.search(r"(?:₹|rs\.?|inr|quote(?:\s+is)?)\s*(\d[\d,]{3,})", text_lower)
            if raw_num_match:
                cleaned_num = raw_num_match.group(1).replace(",", "")
                try:
                    price_val = float(cleaned_num)
                    price_src = raw_num_match.group(0)
                except ValueError:
                    pass

        if price_val is not None:
            claims.append(ExtractedClaim(
                claim_type="PRICE",
                field="quoted_price",
                raw_value=price_val,
                normalized_value=price_val,
                unit="INR",
                source_text=price_src or str(price_val),
                confidence=0.99,
                precision=price_prec,
            ))

        # 3. Vegetarian / Dietary capability
        if "veg" in text_lower or "vegetarian" in text_lower:
            is_non_veg_only = bool(re.search(r"\b(?:only\s+non[- ]?veg|no\s+veg|cannot\s+do\s+veg|non[- ]?veg\s+only)\b", text_lower))
            if is_non_veg_only:
                claims.append(ExtractedClaim(
                    claim_type="VEGETARIAN",
                    field="vegetarian",
                    raw_value=False,
                    normalized_value=False,
                    source_text="only non-vegetarian menu" if "non" in text_lower else "no veg",
                    confidence=0.95,
                    precision="EXACT",
                ))
            else:
                veg_match = re.search(r"\b(?:veg(?:etarian)?\s*(?:menu)?\s*(?:is\s*)?(?:available|fine|possible|yes)?)\b", text_lower)
                claims.append(ExtractedClaim(
                    claim_type="VEGETARIAN",
                    field="vegetarian",
                    raw_value=True,
                    normalized_value=True,
                    source_text=veg_match.group(0) if veg_match else "vegetarian",
                    confidence=0.98,
                    precision="EXACT",
                ))

        # 4. Availability
        if "available" in text_lower or "unavailable" in text_lower:
            is_unavail = bool(re.search(r"\b(?:not\s+available|unavailable|cannot\s+do|booked|busy)\b", text_lower))
            avail_val = "UNAVAILABLE" if is_unavail else "AVAILABLE"
            claims.append(ExtractedClaim(
                claim_type="AVAILABILITY",
                field="reported_availability",
                raw_value=avail_val,
                normalized_value=avail_val,
                source_text="available" if avail_val == "AVAILABLE" else "unavailable",
                confidence=0.95,
                precision="EXACT",
            ))

        # 5. Date mention
        date_match = re.search(r"\b(?:december|dec|november|nov|january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|october|oct)\s+\d{1,2}\b", text_lower)
        if date_match:
            claims.append(ExtractedClaim(
                claim_type="DATE",
                field="date",
                raw_value=date_match.group(0).title(),
                normalized_value=date_match.group(0).title(),
                source_text=date_match.group(0),
                confidence=0.95,
                precision="EXACT",
            ))

        # 6. Ambiguities
        for vague in ["probably", "might", "around", "should be able", "approx", "maybe"]:
            if vague in text_lower:
                ambiguities.append(f"Ambiguous statement detected: '{vague}'")

        res = VendorOutcomeClaims(
            claims=claims,
            ambiguities=ambiguities,
            summary=f"Extracted {len(claims)} claims with {len(ambiguities)} ambiguities.",
        )
        return res

    def interpret_incident(
        self,
        user_message: str,
        event_context: Dict[str, Any],
        open_incidents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        msg_lower = (user_message or "").lower()
        incident_type = "GENERAL_DISRUPTION"
        if "cater" in msg_lower or "vendor" in msg_lower or "no-show" in msg_lower or "cancelled" in msg_lower:
            incident_type = "VENDOR_NO_SHOW"
        elif "delay" in msg_lower or "late" in msg_lower:
            incident_type = "VENDOR_DELAY"
        elif "overheat" in msg_lower or "broken" in msg_lower or "shortage" in msg_lower:
            incident_type = "RESOURCE_SHORTAGE"

        return {
            "interpreted_type": incident_type,
            "requires_recovery": True,
            "priority": "HIGH",
            "summary": f"Interpreted operational incident from message: '{user_message}'",
        }

    def select_recovery_strategy(
        self,
        candidate_options: List[Dict[str, Any]],
        incident_context: Dict[str, Any],
        risk_context: Dict[str, Any],
    ) -> Optional[str]:
        # Filter for feasible options
        feasible = [opt for opt in candidate_options if opt.get("is_feasible", False)]
        if not feasible:
            return None

        # Prioritize REPLACE_VENDOR / BACKUP_PROVIDER or highest score
        for opt in feasible:
            st = opt.get("strategy_type", "")
            if st in ("REPLACE_VENDOR", "ASSIGN_BACKUP", "REASSIGN_VENDOR"):
                return opt.get("id")

        # Fallback to option with highest score or lowest rank
        feasible.sort(key=lambda o: (o.get("rank") or 999, -float(o.get("score") or 0.0)))
        return feasible[0].get("id")

    def format_operational_response(
        self,
        status: str,
        context: Dict[str, Any],
    ) -> str:
        incident = context.get("incident") or {}
        selected_option = context.get("selected_option") or {}
        risk = context.get("risk") or {}
        verification = context.get("verification") or {}
        approval = context.get("approval") or {}

        inc_title = incident.get("title") or incident.get("incident_type", "Operational disruption")
        strat = selected_option.get("strategy_type", "Operational recovery")
        risk_score = risk.get("composite_score") or risk.get("level", "EVALUATED")

        if status == "PENDING_APPROVAL":
            appr_id = approval.get("id", "N/A")
            impact_level = approval.get("impact_level", "MAJOR")
            return (
                f"Incident detected: {inc_title}.\n\n"
                f"Operational Risk: {risk_score}\n"
                f"Selected Strategy: {strat}\n"
                f"Impact Level: {impact_level}\n\n"
                f"This action requires human organizer approval under event governance policy.\n"
                f"Approval requested (ID: {appr_id}). Execution paused awaiting approval sign-off."
            )
        elif status == "COMPLETED":
            ver_status = verification.get("status", "VERIFIED")
            return (
                f"Recovery executed and verified.\n\n"
                f"Incident: {inc_title}\n"
                f"Strategy: {strat}\n"
                f"Verification Status: {ver_status}\n"
                f"Schedule, budget, and critical objectives protected.\n"
                f"Event operational state restored to NORMAL."
            )
        elif status == "OPTIONS_GENERATED":
            num_opts = len(context.get("recovery_options", []))
            return (
                f"Incident detected: {inc_title}.\n\n"
                f"Operational Risk: {risk_score}\n"
                f"Generated {num_opts} validated recovery options. Recommended strategy: {strat}."
            )
        elif status == "FAILED":
            reason = context.get("error", "Recovery execution or verification failed.")
            return f"Operational recovery failed: {reason}"

        return f"Operational state updated: {status}."

    def decide_next_action(
        self,
        operational_context: Dict[str, Any],
        available_tools: List[Dict[str, Any]],
        current_objective: str,
        tool_history: List[Dict[str, Any]],
        previous_result: Optional[Dict[str, Any]] = None,
    ) -> AgentDecision:
        """Deterministic operational decision maker for testing and offline execution."""
        # 1. Check if a pre-scripted sequence of decisions exists
        if "decision_sequence" in self._custom_responses and self._custom_responses["decision_sequence"]:
            next_dec = self._custom_responses["decision_sequence"].pop(0)
            if isinstance(next_dec, AgentDecision):
                return next_dec
            if isinstance(next_dec, dict):
                return AgentDecision.model_validate(next_dec)

        # 2. Check if a dynamic decision handler was provided
        if "decision_handler" in self._custom_responses and callable(self._custom_responses["decision_handler"]):
            return self._custom_responses["decision_handler"](
                operational_context, available_tools, current_objective, tool_history, previous_result
            )

        # 3. Check for a single static decision override
        if "decision" in self._custom_responses:
            dec = self._custom_responses["decision"]
            if isinstance(dec, AgentDecision):
                return dec
            if isinstance(dec, dict):
                return AgentDecision.model_validate(dec)

        # Check if event execution is paused
        exec_state = operational_context.get("execution_state")
        if exec_state in ("PAUSED", "PAUSING"):
            return AgentDecision(
                decision_type=DecisionType.WAIT,
                reason_code=ReasonCode.EVENT_EXECUTION_PAUSED.value,
                action_intent="HALT_FOR_PAUSE",
                rationale=f"Event execution is {exec_state}. Agent halts consequential operations and waits for resume.",
                terminate=True,
                termination_status="PAUSED",
            )

        # 4. Intelligent default deterministic operational loop
        obj_lower = (current_objective or "").lower()
        hist_tools = [h.get("tool") for h in tool_history if isinstance(h, dict)]
        last_step = tool_history[-1] if tool_history else {}
        last_tool = last_step.get("tool")
        last_status = (previous_result or {}).get("status") or last_step.get("status")

        # Scenario A: Disruption / vendor delay / no-show / incident / cancellation
        is_incident = bool(operational_context.get("current_incidents")) or any(
            kw in obj_lower for kw in [
                "photographer", "delay", "no-show", "vendor", "caterer", "catering",
                "cancel", "cancellation", "late", "arrive", "failure", "incident",
                "recovery", "broken", "issue", "fix", "disruption", "emergency"
            ]
        )
        if is_incident:
            incidents = operational_context.get("current_incidents") or []
            active_inc_id = operational_context.get("active_incident_id") or (incidents[0]["id"] if incidents else "inc-1")
            
            # Determine provider category
            category = "photography"
            if "cater" in obj_lower or "food" in obj_lower or "cater" in (operational_context.get("event_name") or "").lower():
                category = "catering"
            elif "dj" in obj_lower or "sound" in obj_lower or "music" in obj_lower:
                category = "sound"
            elif "decor" in obj_lower:
                category = "decor"
            
            # Step 1: Inspect event state if not inspected
            if "get_event_state" not in hist_tools:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="get_event_state",
                    tool_arguments={"event_id": operational_context.get("event_id", "")},
                    reason_code=ReasonCode.INITIAL_OBSERVATION.value,
                    rationale="Observing authoritative event baseline state",
                )
            
            # Step 2: Investigate provider status (missing information)
            if "get_provider_status" not in hist_tools and category:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="get_provider_status",
                    tool_arguments={"category": category},
                    reason_code=ReasonCode.MISSING_PROVIDER_STATUS.value,
                    rationale=f"Investigating current arrival status and responsiveness of {category} provider",
                )
            
            # Step 3: Analyze impact on critical tasks
            if "analyze_impact" not in hist_tools:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="analyze_impact",
                    tool_arguments={"incident_id": active_inc_id},
                    reason_code=ReasonCode.IMPACT_REQUIRES_ANALYSIS.value,
                    rationale="Analyzing downstream impact on photography and dependent ceremony tasks",
                )
                
            # Step 4: Calculate risk
            if "assess_risk" not in hist_tools:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="assess_risk",
                    tool_arguments={"incident_id": active_inc_id},
                    reason_code=ReasonCode.RISK_ASSESSMENT_REQUIRED.value,
                    rationale="Evaluating risk score and threat to primary event objectives",
                )
                
            # Step 5: Generate recovery options
            if "generate_recovery_options" not in hist_tools:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="generate_recovery_options",
                    tool_arguments={"incident_id": active_inc_id},
                    reason_code=ReasonCode.RECOVERY_OPTIONS_REQUIRED.value,
                    rationale="Invoking deterministic RecoveryEngine to compute feasible candidate options",
                )
            
            # Step 6: Propose action with retry and alternative candidate selection
            recovery_attempts = operational_context.get("recovery_attempts") or []
            failed_opt_ids = {att.get("recovery_option_id") for att in recovery_attempts if att.get("status") == "RECOVERY_FAILED"}
            
            recovery_options = operational_context.get("recovery_options") or []
            feasible_options = [o for o in recovery_options if o.get("is_feasible") and o.get("id") not in failed_opt_ids]

            if not feasible_options and failed_opt_ids:
                return AgentDecision(
                    decision_type=DecisionType.FAIL,
                    reason_code=ReasonCode.VERIFICATION_FAILED.value,
                    rationale=f"All feasible recovery options exhausted across {len(recovery_attempts)} attempts without successful verification.",
                    terminate=True,
                    termination_status="RECOVERY_FAILED",
                )

            backup_opts = [o for o in feasible_options if str(o.get("strategy_type", "")).upper() in ("BACKUP", "REASSIGN", "REASSIGN_VENDOR")]
            selected = backup_opts[0] if backup_opts else (feasible_options[0] if feasible_options else (recovery_options[0] if recovery_options else None))
            selected_id = selected.get("id") if selected else "rec-1"
            strat_name = str(selected.get("strategy_type", "REASSIGN_VENDOR")).upper() if selected else "REASSIGN_VENDOR"
            
            # Check if action already executed for the current attempt
            has_executed_current = bool(operational_context.get("execution_result"))
            if not has_executed_current:
                if operational_context.get("approval_granted") or operational_context.get("approval_id"):
                    return AgentDecision(
                        decision_type=DecisionType.TOOL_CALL,
                        tool_name="execute_action",
                        tool_arguments={"recovery_option_id": selected_id},
                        reason_code=ReasonCode.APPROVAL_GRANTED.value,
                        rationale=f"Executing approved recovery action ({strat_name}) through ActionService",
                    )
                return AgentDecision(
                    decision_type=DecisionType.PROPOSE_ACTION,
                    tool_name="execute_action",
                    tool_arguments={"recovery_option_id": selected_id},
                    reason_code=ReasonCode.RECOVERY_OPTION_FEASIBLE.value,
                    action_intent="REASSIGN_VENDOR",
                    rationale=f"Recommending feasible recovery strategy ({strat_name}); requires operator approval",
                    requires_approval=True,
                )
                
            # Step 7: Post-mutation verification
            exec_res = operational_context.get("execution_result") or {}
            exec_id = exec_res.get("id") or exec_res.get("action_id") or "exec-1"
            ver_res = operational_context.get("verification_result") or {}

            if not ver_res or ver_res.get("action_execution_id") != exec_id:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="verify_action",
                    tool_arguments={"action_execution_id": exec_id},
                    reason_code=ReasonCode.VERIFICATION_REQUIRED.value,
                    rationale="Authoritatively verifying post-action state recovery",
                )
            
            # Step 8: Verify result
            ver_status = ver_res.get("status")
            if ver_status in ("VERIFIED", "PARTIALLY_VERIFIED", "SUCCESS") or last_status in ("SUCCESS", "VERIFIED"):
                return AgentDecision(
                    decision_type=DecisionType.COMPLETE,
                    reason_code=ReasonCode.RECOVERY_CONFIRMED.value,
                    rationale="Operational recovery confirmed and verified. Event returned to stable operating condition.",
                    terminate=True,
                    termination_status="COMPLETED",
                )
            else:
                return AgentDecision(
                    decision_type=DecisionType.FAIL,
                    reason_code=ReasonCode.VERIFICATION_FAILED.value,
                    rationale="Verification failed to confirm operational recovery.",
                    terminate=True,
                    termination_status="VERIFICATION_FAILED",
                )

        # Scenario B: Guest count change (e.g. 500 to 800)
        if any(kw in obj_lower for kw in ["guest", "count", "500", "800", "pax", "capacity"]):
            if "get_event_spec" not in hist_tools and "get_event_state" not in hist_tools:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="get_event_spec",
                    tool_arguments={"event_id": operational_context.get("event_id", "")},
                    reason_code=ReasonCode.MISSING_EVENT_SPECIFICATION.value,
                    rationale="Inspecting canonical EventSpecification to evaluate guest capacity and resource baseline",
                )
            if "calculate_resource_requirements" not in hist_tools:
                return AgentDecision(
                    decision_type=DecisionType.TOOL_CALL,
                    tool_name="calculate_resource_requirements",
                    tool_arguments={"new_guest_count": 800, "original_guest_count": 500},
                    reason_code=ReasonCode.RESOURCE_REQUIREMENT_CALCULATED.value,
                    rationale="Calculating deterministic resource delta for guest count increase to 800",
                )
            if "modify_event_plan" not in hist_tools:
                if operational_context.get("approval_granted") or operational_context.get("approval_id"):
                    return AgentDecision(
                        decision_type=DecisionType.TOOL_CALL,
                        tool_name="modify_event_plan",
                        tool_arguments={"modification": "Increase guest count to 800 and procure additional resources"},
                        reason_code=ReasonCode.APPROVAL_GRANTED.value,
                        rationale="Applying approved event plan modifications",
                    )
                return AgentDecision(
                    decision_type=DecisionType.PROPOSE_ACTION,
                    tool_name="modify_event_plan",
                    tool_arguments={"modification": "Increase guest count to 800 with additional resources"},
                    reason_code=ReasonCode.PROCUREMENT_REQUIRED.value,
                    action_intent="PROCURE_RESOURCES",
                    rationale="Proposing plan modification and procurement for 800 guests (+300 meals, chairs, tables); requires operator approval",
                    requires_approval=True,
                )
            return AgentDecision(
                decision_type=DecisionType.COMPLETE,
                reason_code=ReasonCode.RECOVERY_CONFIRMED.value,
                rationale="Guest count modification and resource scaling successfully updated in operational plan.",
                terminate=True,
                termination_status="COMPLETED",
            )

        # Default fallback
        if not hist_tools:
            return AgentDecision(
                decision_type=DecisionType.TOOL_CALL,
                tool_name="get_event_state",
                tool_arguments={"event_id": operational_context.get("event_id", "")},
                reason_code=ReasonCode.INITIAL_OBSERVATION.value,
                rationale="Retrieving current event state",
            )
        return AgentDecision(
            decision_type=DecisionType.COMPLETE,
            reason_code=ReasonCode.NO_ACTION_REQUIRED.value,
            rationale="Operational review complete. No further actions required.",
            terminate=True,
            termination_status="COMPLETED",
        )


class RealLLMProvider(LLMProvider):
    """Real LLM Provider invoking Google Gemini model API via the official google-genai SDK.
    
    CRITICAL ARCHITECTURAL CONSTRAINTS:
    1. NEVER silently falls back to MockLLMProvider when configured.
    2. Strict typed error boundaries: MissingAPIKeyError, GeminiAuthError, GeminiAPIError,
       LLMTimeoutError, MalformedOutputError, StructuredValidationError.
    3. Bounded timeouts and bounded retries for transient HTTP errors.
    4. Structured output directly validates against Pydantic models.
    5. Security: Never logs API keys, auth headers, or raw secrets.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "gemini-3.6-flash",
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        client: Optional[Any] = None,
    ):
        from app.core.config import settings

        resolved_key = (
            api_key
            or getattr(settings, "LLM_API_KEY", None)
            or getattr(settings, "GEMINI_API_KEY", None)
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("GEMINI_API_KEY")
        )
        if not resolved_key and client is None:
            raise MissingAPIKeyError(
                provider="gemini",
                message="Gemini API key is missing. Set LLM_API_KEY or GEMINI_API_KEY in .env.",
            )

        self.api_key = resolved_key
        self.model_name = model_name
        self.timeout_seconds = float(timeout_seconds)
        self.max_retries = max(0, int(max_retries))
        self._client = client

    def __repr__(self) -> str:
        # Secret-safe representation: never expose self.api_key
        return (
            f"RealLLMProvider(model={self.model_name!r}, "
            f"timeout_seconds={self.timeout_seconds}, "
            f"max_retries={self.max_retries}, "
            f"has_api_key={bool(self.api_key)})"
        )

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        from google import genai
        from google.genai import types

        timeout_ms = int(self.timeout_seconds * 1000)
        http_opts = types.HttpOptions(timeout=timeout_ms)
        self._client = genai.Client(api_key=self.api_key, http_options=http_opts)
        return self._client

    def _invoke_with_retry(
        self,
        fn,
        operation_name: str,
        schema_name: Optional[str] = None,
    ) -> Any:
        """Executes a model invocation callable with bounded retry for transient failures."""
        import httpx
        from google.genai import errors

        retries = 0
        start_time = time.perf_counter()

        while True:
            try:
                result = fn()
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.info(
                    "LLM invocation succeeded [provider=gemini, model=%s, operation=%s, schema=%s, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    schema_name or "none",
                    duration_ms,
                )
                return result

            except (errors.ClientError, errors.ServerError, errors.APIError) as e:
                status_code = getattr(e, "code", getattr(e, "status_code", None))
                msg = str(e)

                # Authentication error: 401 / 403 / API_KEY_INVALID -> NEVER retry
                if status_code in (401, 403) or "API_KEY_INVALID" in msg.upper():
                    duration_ms = (time.perf_counter() - start_time) * 1000
                    logger.error(
                        "LLM authentication failure [provider=gemini, model=%s, operation=%s, status_code=%s, duration_ms=%.1f]",
                        self.model_name,
                        operation_name,
                        status_code,
                        duration_ms,
                    )
                    raise GeminiAuthError(
                        f"Gemini authentication failed (status {status_code}): {msg}",
                        details={"status_code": status_code},
                    ) from e

                # Check if transient / retryable (e.g. 503, 429, RESOURCE_EXHAUSTED)
                is_transient = (
                    status_code in (429, 503, 504)
                    or "UNAVAILABLE" in msg.upper()
                    or "RESOURCE_EXHAUSTED" in msg.upper()
                )
                if is_transient and retries < self.max_retries:
                    retries += 1
                    backoff = 0.5 * (2 ** (retries - 1))
                    logger.warning(
                        "Transient error during LLM invocation (attempt %d/%d), retrying in %.2fs: status=%s",
                        retries,
                        self.max_retries + 1,
                        backoff,
                        status_code,
                    )
                    time.sleep(backoff)
                    continue

                # Non-retryable or retries exhausted
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    "LLM API failure [provider=gemini, model=%s, operation=%s, status_code=%s, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    status_code,
                    duration_ms,
                )
                raise GeminiAPIError(
                    f"Gemini API error (status {status_code}): {msg}",
                    status_code=status_code or 502,
                    details={"status_code": status_code, "retries": retries},
                ) from e

            except (httpx.TimeoutException, TimeoutError) as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    "LLM timeout [provider=gemini, model=%s, operation=%s, timeout_s=%.1f, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    self.timeout_seconds,
                    duration_ms,
                )
                raise LLMTimeoutError(
                    timeout_seconds=self.timeout_seconds,
                    message=f"Gemini request timed out after {self.timeout_seconds}s: {e}",
                ) from e

            except (LLMError, TypeError):
                # Reraise known typed exceptions without wrapping
                raise

            except Exception as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    "LLM invocation unexpected failure [provider=gemini, model=%s, operation=%s, error_type=%s, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    type(e).__name__,
                    duration_ms,
                )
                raise ModelInvocationError(
                    f"Unexpected error during Gemini model invocation: {e}",
                    details={"error_type": type(e).__name__},
                ) from e

    def generate_text(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
    ) -> str:
        """Generates plain text response using real Gemini invocation."""
        from google.genai import types

        client = self._get_client()
        config = types.GenerateContentConfig(
            system_instruction=system_prompt if system_prompt else None,
        )

        def _call() -> str:
            resp = client.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )
            if not resp or not resp.text:
                raise MalformedOutputError("Gemini returned empty text response.")
            return resp.text.strip()

        return self._invoke_with_retry(_call, operation_name="generate_text")

    def generate_structured(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
        output_schema: Type[T],
    ) -> T:
        """Generates structured response strictly validated against Pydantic output_schema."""
        if not (isinstance(output_schema, type) and issubclass(output_schema, BaseModel)):
            raise TypeError(f"output_schema must be a Pydantic BaseModel subclass, got {output_schema}")

        from google.genai import types

        client = self._get_client()
        config = types.GenerateContentConfig(
            system_instruction=system_prompt if system_prompt else None,
            response_mime_type="application/json",
            response_schema=output_schema,
        )

        def _call() -> T:
            resp = client.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )
            if not resp or not resp.text:
                raise MalformedOutputError(
                    "Gemini returned empty structured response.",
                    raw_output=None,
                )

            raw_text = resp.text.strip()
            try:
                parsed_json = json.loads(raw_text)
            except Exception as jde:
                raise MalformedOutputError(
                    f"Gemini output could not be parsed as JSON: {jde}",
                    raw_output=raw_text,
                ) from jde

            try:
                return output_schema.model_validate(parsed_json)
            except ValidationError as ve:
                raise StructuredValidationError(
                    message=f"Gemini output failed schema validation for {output_schema.__name__}: {ve}",
                    schema_name=output_schema.__name__,
                    validation_errors=ve.errors(),
                ) from ve

        return self._invoke_with_retry(
            _call,
            operation_name="generate_structured",
            schema_name=output_schema.__name__,
        )

    def interpret_incident(
        self,
        user_message: str,
        event_context: Dict[str, Any],
        open_incidents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Interprets the natural language operational situation via Gemini structured output."""
        system_prompt = (
            "You are EVENTRA's Event Operations Agent interpreting an live operational incident. "
            "Analyze the situation and return structured incident categorization."
        )
        prompt = (
            f"Event Context: {json.dumps(event_context, default=str)}\n"
            f"Open Incidents: {json.dumps(open_incidents, default=str)}\n"
            f"Operator Message: {user_message}\n\n"
            "Categorize this incident and determine if recovery is required."
        )
        structured = self.generate_structured(
            system_prompt=system_prompt,
            user_prompt=prompt,
            output_schema=IncidentInterpretationOutput,
        )
        return structured.model_dump()

    def select_recovery_strategy(
        self,
        candidate_options: List[Dict[str, Any]],
        incident_context: Dict[str, Any],
        risk_context: Dict[str, Any],
    ) -> Optional[str]:
        """Reasons over candidate options and selects optimal recovery strategy via Gemini structured output."""
        feasible_options = [opt for opt in candidate_options if opt.get("is_feasible", False)]
        if not feasible_options:
            return None

        system_prompt = (
            "You are EVENTRA's Event Operations Agent evaluating recovery tradeoffs. "
            "Select the single most suitable recovery option ID based on objective protection, "
            "feasibility, schedule slack preservation, and budget variance."
        )
        prompt = (
            f"Incident: {json.dumps(incident_context, default=str)}\n"
            f"Evaluated Risk: {json.dumps(risk_context, default=str)}\n"
            f"Feasible Candidate Options: {json.dumps(feasible_options, default=str)}\n\n"
            "Select the best option ID and explain your operational rationale."
        )
        structured = self.generate_structured(
            system_prompt=system_prompt,
            user_prompt=prompt,
            output_schema=RecoverySelectionOutput,
        )
        return structured.selected_option_id

    def format_operational_response(
        self,
        status: str,
        context: Dict[str, Any],
    ) -> str:
        """Formats a clear, concise operational status message for the event operator."""
        system_prompt = (
            "You are EVENTRA's Event Operations Agent. Compose a concise, professional operational "
            "status update for the live event control room operator."
        )
        prompt = (
            f"Execution Status: {status}\n"
            f"Operational Context: {json.dumps(context, default=str)}\n\n"
            "Provide a clear, brief operational summary."
        )
        return self.generate_text(system_prompt=system_prompt, user_prompt=prompt)

    def decide_next_action(
        self,
        operational_context: Dict[str, Any],
        available_tools: List[Dict[str, Any]],
        current_objective: str,
        tool_history: List[Dict[str, Any]],
        previous_result: Optional[Dict[str, Any]] = None,
    ) -> AgentDecision:
        """Reasons over live operational state via Gemini structured output."""
        from app.agent.prompts.general import GENERAL_SYSTEM_PROMPT, format_operational_context_prompt

        system_prompt = GENERAL_SYSTEM_PROMPT
        user_prompt = format_operational_context_prompt(
            operational_context=operational_context,
            available_tools=available_tools,
            current_objective=current_objective,
            tool_history=tool_history,
            previous_result=previous_result,
        )
        return self.generate_structured(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_schema=AgentDecision,
        )


def get_default_llm_provider() -> LLMProvider:
    """Factory returns configured LLMProvider based on application settings.
    
    Provides ONE authoritative path for obtaining the configured LLM provider.
    """
    from app.integrations.llm.base import get_configured_llm_provider
    return get_configured_llm_provider()
