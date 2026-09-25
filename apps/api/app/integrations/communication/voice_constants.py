"""Voice Production Constants: Error Classifications & Audit Event Types (Task 8).

Defines standard error taxonomies and structured observability audit event names
used across Exotel telephony transport, Gemini Live voice streaming, and EVENTRA
deterministic outcome/negotiation/recovery authority.
"""
from enum import Enum


class VoiceErrorClassification(str, Enum):
    """Categorized classifications for voice call and conversational failures."""
    TRANSPORT_FAILURE = "TRANSPORT_FAILURE"        # Exotel / WebSocket / audio packet failure
    VOICE_AGENT_FAILURE = "VOICE_AGENT_FAILURE"    # Gemini Live connection / quota / model failure
    VENDOR_UNAVAILABLE = "VENDOR_UNAVAILABLE"      # Vendor stated unavailable or no slots
    NEGOTIATION_FAILED = "NEGOTIATION_FAILED"      # Over ceiling, counter rejected, terms incompatible
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"        # Within ceiling or recovery quote needs human approval
    VALIDATION_FAILED = "VALIDATION_FAILED"        # Hard requirement, capacity, or currency mismatch
    RECOVERY_FAILED = "RECOVERY_FAILED"            # Recovery attempt unsuccessful


class VoiceAuditEvent(str, Enum):
    """Canonical event names for structured immutable audit trails across voice operations."""
    VOICE_CALL_INITIATED = "VOICE_CALL_INITIATED"
    VOICE_CALL_CONNECTED = "VOICE_CALL_CONNECTED"
    VOICE_STREAM_CONNECTED = "VOICE_STREAM_CONNECTED"
    VOICE_GEMINI_CONNECTED = "VOICE_GEMINI_CONNECTED"
    VOICE_CALL_DISCONNECTED = "VOICE_CALL_DISCONNECTED"
    VOICE_CALL_FAILED = "VOICE_CALL_FAILED"
    VOICE_GEMINI_FAILED = "VOICE_GEMINI_FAILED"
    VOICE_CALL_TIMEOUT = "VOICE_CALL_TIMEOUT"
    VOICE_OUTCOME_RECEIVED = "VOICE_OUTCOME_RECEIVED"
    VOICE_OUTCOME_VALIDATED = "VOICE_OUTCOME_VALIDATED"
    VOICE_NEGOTIATION_DECISION = "VOICE_NEGOTIATION_DECISION"
    VOICE_APPROVAL_REQUIRED = "VOICE_APPROVAL_REQUIRED"
    VOICE_ENGAGEMENT_CONFIRMED = "VOICE_ENGAGEMENT_CONFIRMED"
    RECOVERY_VOICE_CALL_INITIATED = "RECOVERY_VOICE_CALL_INITIATED"
    RECOVERY_VOICE_CALL_COMPLETED = "RECOVERY_VOICE_CALL_COMPLETED"
    RECOVERY_VOICE_CALL_FAILED = "RECOVERY_VOICE_CALL_FAILED"
