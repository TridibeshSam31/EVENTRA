"""Service: QuoteExtractionService (Part A.2)

Extracts structured operational facts (availability, quoted amount, notes, confidence)
from unstructured vendor communications (WhatsApp free-text replies, voice call transcripts)
using real LLM structured generation with robust deterministic regex fallback.
"""
import re
import logging
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

from app.integrations.registry import registry

logger = logging.getLogger(__name__)


class ExtractedQuoteFacts(BaseModel):
    available: Optional[bool] = Field(None, description="Whether the provider is available for the event")
    quoted_amount: Optional[float] = Field(None, description="Total quoted price/rate, or per-person rate * expected pax")
    currency: str = Field("INR", description="Currency code (INR, USD, etc.)")
    notes: str = Field("", description="Key terms, restrictions, or reasoning")
    confidence: float = Field(0.0, description="Extraction confidence score between 0.0 and 1.0")
    field_sources: Dict[str, str] = Field(default_factory=dict, description="Provenance for each extracted field")


class QuoteExtractionService:
    """Extracts structured facts from raw inbound vendor messages and call transcripts."""

    def __init__(self, llm_provider: Optional[Any] = None):
        self._llm = llm_provider

    @property
    def llm(self) -> Any:
        if not self._llm:
            try:
                self._llm = registry.get_llm_provider()
            except Exception as e:
                logger.warning(f"Could not initialize LLM provider for quote extraction: {e}")
                self._llm = None
        return self._llm

    @classmethod
    def extract_facts(
        cls,
        raw_text: str,
        context: Optional[Dict[str, Any]] = None,
        channel: Optional[str] = None,
        llm_provider: Optional[Any] = None,
    ) -> ExtractedQuoteFacts:
        """Parses raw text and returns structured ExtractedQuoteFacts with provenance tags."""
        if not raw_text or not raw_text.strip():
            return ExtractedQuoteFacts(
                available=None,
                quoted_amount=None,
                notes="Empty text received",
                confidence=0.0,
                field_sources={},
            )

        context_info = f" Context: {context}" if context else ""
        if channel:
            context_info += f" Channel: {channel}"

        # Attempt structured generation via LLM if a real model provider is active
        llm = llm_provider
        if not llm:
            try:
                llm = registry.get_llm_provider()
            except Exception:
                llm = None

        is_real_llm = llm and type(llm).__name__ == "RealLLMProvider" and not getattr(llm, "is_mock", False)
        if is_real_llm:
            try:
                system_prompt = (
                    "You are an authoritative event procurement analyst for EVENTRA. "
                    "Analyze the provider's communication (WhatsApp message or call transcript) and extract structured facts. "
                    "INVARIANTS: "
                    "1. 'available': true if the vendor confirms they can take the event; false if they decline, are booked, or say they cannot make it; null if ambiguous. "
                    "2. 'quoted_amount': numerical total amount quoted in the currency (e.g. 45000). If per plate (e.g. 500/plate) and guest count is in context, compute total. None if no quote mentioned. "
                    "3. 'notes': concise factual summary of any conditions, advance requirements, or remarks. "
                    "4. 'confidence': confidence score from 0.0 to 1.0. "
                    "Never invent prices or availability not present in the text."
                )
                user_prompt = f"Provider Communication:\n\"\"\"\n{raw_text}\n\"\"\"\n{context_info}"
                result = llm.generate_structured(
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    output_schema=ExtractedQuoteFacts,
                )
                if result:
                    result.field_sources = {
                        "available": "LLM_EXTRACTED",
                        "quoted_amount": "LLM_EXTRACTED",
                        "notes": "LLM_EXTRACTED",
                    }
                    return result
            except Exception as exc:
                logger.warning(f"LLM structured quote extraction failed, falling back to deterministic parser: {exc}")

        # Deterministic fallback parser
        return cls._deterministic_extract(raw_text, context)

    @classmethod
    def _deterministic_extract(
        cls,
        raw_text: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> ExtractedQuoteFacts:
        """Authentic rule-based parsing of price quotes and availability from text."""
        text_lower = raw_text.lower()
        field_sources: Dict[str, str] = {}

        # 1. Availability Detection
        available: Optional[bool] = None
        decline_patterns = [
            r"not\s+available",
            r"unavailable",
            r"can['’]?t\s+make\s+it",
            r"won['’]?t\s+be\s+able",
            r"already\s+booked",
            r"fully\s+booked",
            r"cannot\s+come",
            r"can['’]?t\s+come",
            r"decline",
            r"sorry",
            r"unable",
            r"regret",
            r"not\s+free",
        ]
        confirm_patterns = [
            r"available",
            r"can\s+do",
            r"we\s+can\s+manage",
            r"confirm",
            r"ready",
            r"free\s+on\s+that\s+date",
            r"happy\s+to\s+cater",
            r"available\s+for",
            r"yes",
        ]

        for dp in decline_patterns:
            if re.search(dp, text_lower):
                available = False
                field_sources["available"] = "REGEX_PARSED"
                break

        if available is None:
            for cp in confirm_patterns:
                if re.search(cp, text_lower):
                    available = True
                    field_sources["available"] = "REGEX_PARSED"
                    break

        # 2. Price / Quote Extraction
        quoted_amount: Optional[float] = None
        currency = "INR"

        # Match ₹45,000 | Rs. 45000 | INR 45,000 | 45k
        k_match = re.search(r'(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*k\b', text_lower)
        if k_match:
            try:
                quoted_amount = float(k_match.group(1)) * 1000
                field_sources["quoted_amount"] = "REGEX_PARSED"
            except (ValueError, TypeError):
                pass

        if quoted_amount is None:
            # Match standard currency numbers like ₹ 50,000 or 50000/- or Rs 45000
            amt_match = re.search(r'(?:₹|rs\.?|inr|\$)\s*([\d,]+(?:\.\d{1,2})?)', text_lower)
            if amt_match:
                clean_num = amt_match.group(1).replace(",", "")
                try:
                    val = float(clean_num)
                    if val > 0:
                        quoted_amount = val
                        field_sources["quoted_amount"] = "REGEX_PARSED"
                except (ValueError, TypeError):
                    pass

        if quoted_amount is None:
            # Match number followed by rupees/inr e.g. "170000 rupees"
            amt_match2 = re.search(r'([\d,]+(?:\.\d{1,2})?)\s*(?:rupees|inr|rs\.?)', text_lower)
            if amt_match2:
                clean_num = amt_match2.group(1).replace(",", "")
                try:
                    val = float(clean_num)
                    if val > 0:
                        quoted_amount = val
                        field_sources["quoted_amount"] = "REGEX_PARSED"
                except (ValueError, TypeError):
                    pass

        # Check per plate / per person rate e.g. "450 per plate"
        if quoted_amount is None:
            plate_match = re.search(r'(\d+)\s*(?:per\s+plate|per\s+person|/plate|/head)', text_lower)
            if plate_match:
                rate = float(plate_match.group(1))
                pax = (context or {}).get("pax") or (context or {}).get("guest_count") or 100
                quoted_amount = rate * pax
                field_sources["quoted_amount"] = "REGEX_PARSED_CALCULATED"

        confidence = 0.5
        if available is not None:
            confidence += 0.25
        if quoted_amount is not None:
            confidence += 0.25

        # Check for remarks like advance payment
        advance_match = re.search(r'(\d+%\s*advance|advance\s*payment|\badvance\b)', text_lower)
        advance_note = f" (Terms: {advance_match.group(0)})" if advance_match else ""

        notes = "Extracted via deterministic communication analysis"
        if available is False:
            notes = "Provider indicated unavailability/cancellation"
        elif available is True and quoted_amount:
            notes = f"Provider confirmed availability with quote of {currency} {quoted_amount:,.2f}{advance_note}"
        elif advance_match:
            notes += advance_note

        return ExtractedQuoteFacts(
            available=available,
            quoted_amount=quoted_amount,
            currency=currency,
            notes=notes,
            confidence=round(confidence, 2),
            field_sources=field_sources,
        )
