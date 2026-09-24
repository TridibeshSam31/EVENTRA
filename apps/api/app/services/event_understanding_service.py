"""Domain Service: EventUnderstandingService

Bridge between natural language organizer messages and strongly-typed Pydantic domain representations.
Invokes RealLLMProvider (Google Gemini) or configured LLMProvider to generate structured
EventIntent or EventChangeProposal objects.
"""
import logging
import json
from typing import Any, Dict, Optional

from app.agent.provider import LLMProvider
from app.integrations.llm.base import get_configured_llm_provider
from app.agent.prompts import EVENT_UNDERSTANDING_SYSTEM_PROMPT, EVENT_UPDATE_SYSTEM_PROMPT
from app.schemas.event_intent import (
    EventIntent,
    EventChangeProposal,
)

logger = logging.getLogger(__name__)


class EventUnderstandingService:
    """Understands natural language organizer requirements using real Gemini / configured LLMProvider."""

    def __init__(self, llm_provider: Optional[LLMProvider] = None):
        self.provider = llm_provider or get_configured_llm_provider()

    def understand_input(
        self,
        user_message: str,
        current_event_context: Optional[Dict[str, Any]] = None,
    ) -> EventIntent:
        """Invokes LLMProvider to convert natural language input into structured EventIntent."""
        context_str = ""
        if current_event_context:
            context_str = f"\nCurrent Event Context:\n{json.dumps(current_event_context, default=str)}\n"

        prompt = (
            f"Organizer Input: \"{user_message}\"\n{context_str}\n"
            "Extract structured event intent strictly matching EventIntent schema."
        )

        logger.info("Executing LLM event understanding [provider=%s]", type(self.provider).__name__)
        intent = self.provider.generate_structured(
            system_prompt=EVENT_UNDERSTANDING_SYSTEM_PROMPT,
            user_prompt=prompt,
            output_schema=EventIntent,
        )
        return intent

    def understand_modification(
        self,
        user_message: str,
        current_event_context: Dict[str, Any],
    ) -> EventChangeProposal:
        """Invokes LLMProvider to interpret context-aware event modifications."""
        prompt = (
            f"Existing Event Context:\n{json.dumps(current_event_context, default=str)}\n\n"
            f"Organizer Follow-up Message: \"{user_message}\"\n\n"
            "Produce structured EventChangeProposal detailing specific field updates or service additions/removals."
        )

        logger.info("Executing LLM modification understanding [provider=%s]", type(self.provider).__name__)
        proposal = self.provider.generate_structured(
            system_prompt=EVENT_UPDATE_SYSTEM_PROMPT,
            user_prompt=prompt,
            output_schema=EventChangeProposal,
        )
        return proposal
