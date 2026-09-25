"""Normalization Utilities for Budget, Currency, Date, and Service Categories.

Provides deterministic validation and normalization logic that sits AFTER LLM intent extraction.
Ensures numeric values, currencies, dates, and service categories comply with domain rules.
"""
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple, Set

NUMBER_WORDS: Dict[str, float] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100,
}

SERVICE_CATEGORY_MAP: Dict[str, str] = {
    "venue": "VENUE",
    "hall": "VENUE",
    "location": "VENUE",
    "auditorium": "VENUE",
    "ground": "VENUE",
    "convention": "VENUE",
    "resort": "VENUE",
    "hotel": "VENUE",
    "catering": "CATERING",
    "caterer": "CATERING",
    "cater": "CATERING",
    "food": "CATERING",
    "meal": "CATERING",
    "lunch": "CATERING",
    "dinner": "CATERING",
    "buffet": "CATERING",
    "av": "AV_TECH",
    "av_tech": "AV_TECH",
    "audio": "AV_TECH",
    "sound": "AV_TECH",
    "speaker": "AV_TECH",
    "mic": "AV_TECH",
    "microphone": "AV_TECH",
    "projector": "AV_TECH",
    "screen": "AV_TECH",
    "streaming": "AV_TECH",
    "photo": "PHOTOGRAPHY",
    "photography": "PHOTOGRAPHY",
    "photographer": "PHOTOGRAPHY",
    "video": "VIDEOGRAPHY",
    "videography": "VIDEOGRAPHY",
    "videographer": "VIDEOGRAPHY",
    "decor": "DECOR",
    "decoration": "DECOR",
    "stage": "DECOR",
    "florist": "FLORIST",
    "flower": "FLORIST",
    "transport": "TRANSPORT",
    "transportation": "TRANSPORT",
    "cab": "TRANSPORT",
    "bus": "TRANSPORT",
    "shuttle": "TRANSPORT",
    "security": "SECURITY",
    "guard": "SECURITY",
    "bouncer": "SECURITY",
    "bouncers": "SECURITY",
    "staff": "STAFFING",
    "staffing": "STAFFING",
    "host": "STAFFING",
    "dj": "DJ_MUSIC",
    "dj_music": "DJ_MUSIC",
    "music": "DJ_MUSIC",
    "band": "DJ_MUSIC",
    "light": "LIGHTING",
    "lighting": "LIGHTING",
    "print": "PRINTING",
    "printing": "PRINTING",
    "badge": "PRINTING",
    "banner": "PRINTING",
    "clean": "CLEANING",
    "cleaning": "CLEANING",
    "entertainment": "DJ_MUSIC",
    "makeup": "STAFFING",
    "hospitality": "STAFFING",
}


def parse_indian_number_words(text: str) -> Optional[float]:
    """Parses phrases like 'one crore twenty lakh', 'eight lakh', '8L', '8 lakh', '10 crore', '2.5 lakh'."""
    text_lower = text.lower()
    total = 0.0
    matched = False

    # Check crore with words or decimals: e.g. "one crore", "two crore", "1.2 crore", "10 crore"
    cr_words_match = re.search(r"(\b[a-z]+\b|\d+(?:\.\d+)?)\s*(?:crore|crores|cr)\b", text_lower)
    if cr_words_match:
        val_str = cr_words_match.group(1)
        if val_str in NUMBER_WORDS:
            total += NUMBER_WORDS[val_str] * 10000000.0
            matched = True
        else:
            try:
                total += float(val_str) * 10000000.0
                matched = True
            except ValueError:
                pass

    # Check lakh with words or decimals: e.g. "twenty lakh", "eight lakh", "10 lakh", "8.5 lakhs", "8l"
    lakh_words_match = re.search(r"(\b[a-z]+(?:\s+[a-z]+)?\b|\d+(?:\.\d+)?)\s*(?:lakh|lakhs|lac|lacs|l)\b", text_lower)
    if lakh_words_match:
        val_str = lakh_words_match.group(1).strip()
        words = val_str.split()
        subtotal = 0.0
        word_found = False
        for w in words:
            if w in NUMBER_WORDS:
                subtotal += NUMBER_WORDS[w]
                word_found = True
        if word_found:
            total += subtotal * 100000.0
            matched = True
        else:
            try:
                total += float(val_str) * 100000.0
                matched = True
            except ValueError:
                pass

    return total if matched else None


def normalize_budget(
    amount: Optional[float] = None,
    expression: Optional[str] = None,
    currency: Optional[str] = None,
) -> Tuple[Optional[float], str]:
    """Deterministically normalizes budget amount and currency.
    
    Returns (normalized_float_amount, currency_code).
    Ensures amount >= 0.
    """
    resolved_currency = (currency or "INR").upper()
    if resolved_currency not in ("INR", "USD", "EUR", "GBP"):
        resolved_currency = "INR"

    # If numeric amount already provided, validate it
    if amount is not None:
        if amount < 0:
            raise ValueError(f"Budget cannot be negative: {amount}")
        return float(amount), resolved_currency

    if not expression:
        return None, resolved_currency

    expr_lower = expression.lower()

    # Try Indian lakh/crore parsing first
    indian_val = parse_indian_number_words(expr_lower)
    if indian_val and indian_val >= 0:
        return indian_val, "INR"

    # Check Western K notation: $50k, 50 thousand
    k_match = re.search(r"(?:\$|usd)?\s*(\d+(?:\.\d+)?)\s*(?:k|thousand)\b", expr_lower)
    if k_match:
        val = float(k_match.group(1)) * 1000.0
        curr = "USD" if "$" in expr_lower or "usd" in expr_lower else resolved_currency
        return val, curr

    # Check general number regex
    num_match = re.search(r"([\d,]+(?:\.\d+)?)", expr_lower)
    if num_match:
        try:
            val = float(num_match.group(1).replace(",", ""))
            if val >= 0:
                return val, resolved_currency
        except ValueError:
            pass

    return None, resolved_currency


def normalize_guest_count(
    count: Optional[int] = None,
    expression: Optional[str] = None,
) -> Optional[int]:
    """Deterministically normalizes guest count scalar. Must be > 0 if specified."""
    if count is not None:
        if count <= 0:
            raise ValueError(f"Guest count must be greater than zero: {count}")
        return int(count)

    if not expression:
        return None

    expr_lower = expression.lower()
    match = re.search(r"(\d+)", expr_lower)
    if match:
        val = int(match.group(1))
        if val > 0:
            return val
    return None


def normalize_service_category(service_str: str) -> str:
    """Maps arbitrary service string to canonical ProviderCategory enum value."""
    key = service_str.lower().strip()
    return SERVICE_CATEGORY_MAP.get(key, key.upper())
