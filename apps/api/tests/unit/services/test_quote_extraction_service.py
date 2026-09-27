"""Unit tests for QuoteExtractionService.

Tests extraction of structured facts (availability, quoted amount, currency, notes)
from inbound raw texts across WhatsApp and voice-call transcripts.
"""
import pytest
from app.services.quote_extraction_service import QuoteExtractionService


def test_quote_extraction_whatsapp_available():
    text = "Yes, we are available on October 15th! Our package rate is ₹45,000 all inclusive."
    facts = QuoteExtractionService.extract_facts(text, channel="whatsapp")

    assert facts.available is True
    assert facts.quoted_amount == 45000.0
    assert facts.currency == "INR"
    assert facts.confidence >= 0.7


def test_quote_extraction_whatsapp_unavailable():
    text = "Sorry, we are fully booked and unavailable on that date."
    facts = QuoteExtractionService.extract_facts(text, channel="whatsapp")

    assert facts.available is False
    assert facts.quoted_amount is None
    assert facts.confidence >= 0.7


def test_quote_extraction_call_transcript():
    transcript = (
        "Agent: Hello, calling from Eventra regarding the catering order on November 5th. Are you available? "
        "Provider: Yes we can take that order. Our per plate charge will be Rs. 850 per person for 200 guests, "
        "so total quotation is 170000 rupees. We need 50% advance."
    )
    facts = QuoteExtractionService.extract_facts(transcript, channel="call")

    assert facts.available is True
    assert facts.quoted_amount is not None
    assert facts.quoted_amount in [170000.0, 850.0]
    assert facts.currency == "INR"
    assert "advance" in facts.notes.lower() or "50%" in facts.notes


def test_quote_extraction_ambiguous_text():
    text = "Thanks for contacting us. Let me check the schedule and get back to you later."
    facts = QuoteExtractionService.extract_facts(text, channel="whatsapp")

    assert facts.available is None
    assert facts.quoted_amount is None
