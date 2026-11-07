"""Phone number normalization for outbound vendor communication.

Real WhatsApp messages and phone calls must only ever target a validated E.164
number, so this module rejects anything it cannot normalize unambiguously.
"""
import re
from typing import Optional


class InvalidPhoneNumber(ValueError):
    """Raised when a contact number cannot be normalized to a dialable E.164 number."""


# Indian mobile numbers: 10 digits starting with 6-9.
_INDIAN_MOBILE = re.compile(r"^[6-9]\d{9}$")
# Generic E.164: country code + subscriber number, 8-15 digits total.
_E164_DIGITS = re.compile(r"^[1-9]\d{7,14}$")


def normalize_phone_e164(raw: Optional[str], default_country_code: str = "91") -> str:
    """Normalizes a contact number to E.164 (e.g. '+919876543210').

    Accepts common Indian formats: '9876543210', '09876543210', '+91 98765 43210',
    '91-9876543210', '0091 9876543210'. Numbers with an explicit '+' country code
    are accepted when they are valid E.164; Indian numbers are additionally
    checked to be mobile numbers since WhatsApp and the voice agent need one.
    """
    if raw is None or not str(raw).strip():
        raise InvalidPhoneNumber("Contact phone number is missing.")

    text = str(raw).strip()
    has_plus = text.startswith("+")
    digits = re.sub(r"\D", "", text)
    if not digits:
        raise InvalidPhoneNumber("Contact phone number contains no digits.")

    if not has_plus:
        if digits.startswith("00"):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]
        if len(digits) == 10:
            digits = default_country_code + digits

    if digits.startswith("91"):
        national = digits[2:]
        if not _INDIAN_MOBILE.match(national):
            raise InvalidPhoneNumber("Contact phone number is not a valid Indian mobile number.")
        return f"+91{national}"

    if not _E164_DIGITS.match(digits):
        raise InvalidPhoneNumber("Contact phone number is not a valid international number.")
    return f"+{digits}"


def phone_last10(raw: Optional[str]) -> str:
    """Returns the last 10 digits of a number, for loose matching against stored contacts."""
    return re.sub(r"\D", "", raw or "")[-10:]


def mask_phone(e164: Optional[str]) -> str:
    """Masks a number for logs and UI, keeping the country code and last 4 digits."""
    if not e164:
        return ""
    digits = re.sub(r"\D", "", e164)
    if len(digits) <= 4:
        return "*" * len(digits)
    prefix = "+91" if e164.startswith("+91") else ("+" if e164.startswith("+") else "")
    hidden = len(digits) - 4 - (2 if prefix == "+91" else 0)
    return f"{prefix}{'*' * max(hidden, 0)}{digits[-4:]}"


def scrub_phone_numbers(text: Optional[str]) -> str:
    """Masks any phone-number-like digit runs inside provider error text."""
    if not text:
        return ""
    return re.sub(r"\+?\d[\d\s-]{7,}\d", lambda m: mask_phone("+" + re.sub(r"\D", "", m.group())), text)
