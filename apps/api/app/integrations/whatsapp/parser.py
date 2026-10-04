"""Inbound WhatsApp Message Parser for Approval Replies (English + Hindi/Hinglish)."""
import re
from typing import Optional, Tuple

# Positive approval tokens
APPROVE_TOKENS = {
    # English
    "yes", "y", "approve", "approved", "accept", "accepted", "ok", "okay", "confirm", "confirmed",
    # Hindi / Hinglish
    "haan", "ha", "haa", "han", "sahi", "sahi hai", "theek", "theek hai", "thik", "thik hai",
    "chalega", "manzoor", "krdo", "kardo", "kar do", "jaroor", "bilkul",
}

# Negative rejection tokens
REJECT_TOKENS = {
    # English
    "no", "n", "reject", "rejected", "deny", "denied", "cancel", "cancelled", "decline", "declined",
    # Hindi / Hinglish
    "nahi", "nahin", "na", "mat karo", "mat kr", "radd", "kharij", "roko", "mana", "manaa",
    "naa", "nahi karna",
}


def parse_inbound_reply(raw_text: str) -> Tuple[Optional[str], Optional[str]]:
    """Parses an inbound reply into a normalized (decision, code) tuple.
    
    Returns:
        (decision, code):
            decision: "APPROVE", "REJECT", or None
            code: Optional[str] (e.g. "A4B2") or None
    """
    if not raw_text:
        return None, None

    # Clean and split into words
    cleaned = raw_text.strip().lower()
    # Normalize punctuation except alphanumeric and whitespace
    normalized = re.sub(r"[^\w\s-]", " ", cleaned)
    words = normalized.split()

    if not words:
        return None, None

    decision: Optional[str] = None
    code: Optional[str] = None

    # Check multi-word phrases first (e.g. "sahi hai", "theek hai", "mat karo")
    for phrase in sorted(APPROVE_TOKENS, key=lambda p: -len(p)):
        if " " in phrase and (normalized == phrase or normalized.startswith(phrase + " ") or (" " + phrase + " ") in (" " + normalized + " ")):
            decision = "APPROVE"
            remainder = normalized.replace(phrase, "", 1).strip().split()
            if remainder:
                code = remainder[0].upper()
            break

    if not decision:
        for phrase in sorted(REJECT_TOKENS, key=lambda p: -len(p)):
            if " " in phrase and (normalized == phrase or normalized.startswith(phrase + " ") or (" " + phrase + " ") in (" " + normalized + " ")):
                decision = "REJECT"
                remainder = normalized.replace(phrase, "", 1).strip().split()
                if remainder:
                    code = remainder[0].upper()
                break

    # If not matched multi-word phrase, check single word matches
    if not decision:
        for i, word in enumerate(words):
            if word in APPROVE_TOKENS:
                decision = "APPROVE"
                # Look for subsequent alphanumeric code
                for next_w in words[i + 1:]:
                    if next_w not in APPROVE_TOKENS and len(next_w) >= 2:
                        code = next_w.upper()
                        break
                break
            elif word in REJECT_TOKENS:
                decision = "REJECT"
                for next_w in words[i + 1:]:
                    if next_w not in REJECT_TOKENS and len(next_w) >= 2:
                        code = next_w.upper()
                        break
                break

    # Fallback: check if the first word itself is an approval/rejection command
    if not decision and len(words) >= 1:
        first = words[0]
        if first in ("approve", "approved", "yes", "y", "haan", "ha"):
            decision = "APPROVE"
            if len(words) > 1:
                code = words[1].upper()
        elif first in ("reject", "rejected", "no", "n", "nahi", "nahin", "radd"):
            decision = "REJECT"
            if len(words) > 1:
                code = words[1].upper()

    return decision, code
