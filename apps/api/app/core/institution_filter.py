"""Shared government / institution filter for vendor and venue discovery.

Single source of truth used by both the Google Maps mapper (ProviderNormalizer)
and the QualificationEngine, so the two can never drift apart again.

Matching is whole-word (never raw substring) so that short tokens do not hit
unrelated business names ("ril" in "Grill House", "nit" in "Unity Caterers",
"bhel" in "Bhel Puri House").
"""
import os
import re
from typing import List, Optional

# Non-vendor / Institution phrases, matched case-insensitively as whole words/phrases.
DISQUALIFIED_INSTITUTION_KEYWORDS = [
    # Educational / training institutions
    "institute of hotel management", "hotel management college",
    "hotel management institute", "catering college", "catering school",
    "catering institute", "food technology college",
    "training center", "training centre", "training institute", "degree college",
    "university department", "polytechnic",
    # Government / PSU entities
    "railway catering", "railways", "railway",
    "government office", "govt office", "government canteen",
    "police station", "municipal corporation", "nagar nigam",
    "panchayat", "cantonment board", "public health center",
    "hospital canteen", "doordarshan", "prasar bharati", "all india radio",
    # Generic government markers (names and Google Maps categories)
    "government of", "govt of", "govt.", "government", "sarkari",
    "ministry of", "department of", "directorate", "central government",
    "state government", "local government", "city hall",
    "government organization", "government department", "public sector",
    "development authority", "airport authority", "port authority",
    "sports authority of india", "public works department",
    "circuit house", "state guest house", "zila parishad",
    "new delhi municipal", "delhi development authority",
    # Marquee government-run convention / exhibition venues
    "bharat mandapam", "pragati maidan",
    "india trade promotion organisation", "india trade promotion organization",
    "yashobhoomi", "india international convention",
    # Associations / Federations
    "association of", "federation of", "council of", "chamber of",
    "trade union", "welfare society",
]

# Acronyms matched case-insensitively as whole words (no common English meaning).
DISQUALIFIED_ACRONYMS_ANY_CASE = [
    "ihm", "itpo", "irctc", "bsnl", "ntpc", "ongc", "iocl", "dda", "ndmc",
    "cpwd", "pwd", "drdo", "isro", "aiims", "nic", "cris",
    "iitd", "iitm", "iimb", "iima",
]

# Acronyms that are also ordinary words ("sail", "bhel puri", "gail") only count when
# written in capitals, e.g. "SAIL Guest House" is rejected but "Bhel Puri House" is not.
DISQUALIFIED_ACRONYMS_UPPER_ONLY = [
    "BHEL", "SAIL", "GAIL", "MCD", "DTC", "IIT", "IIM", "NIT",
]

# Websites hosted on government / academic domains are not commercial vendors.
INSTITUTION_DOMAIN_SUFFIXES = (
    ".gov.in", ".nic.in", ".gov", ".ac.in", ".edu.in", ".edu", ".mil.in", ".res.in",
)


def _word_pattern(terms: List[str], flags: int = 0) -> "re.Pattern[str]":
    alternation = "|".join(re.escape(t) for t in sorted(terms, key=len, reverse=True))
    return re.compile(rf"(?<![A-Za-z0-9])({alternation})(?![A-Za-z0-9])", flags)


def _extra_denylist() -> List[str]:
    """Operator-supplied extra phrases (comma separated env DISCOVERY_EXTRA_DENYLIST)."""
    import os
    raw = os.environ.get("DISCOVERY_EXTRA_DENYLIST", "")
    return [t.strip().lower() for t in raw.split(",") if t.strip()]


_PHRASE_RE = _word_pattern(DISQUALIFIED_INSTITUTION_KEYWORDS, re.IGNORECASE)
_ACRONYM_ANY_RE = _word_pattern(DISQUALIFIED_ACRONYMS_ANY_CASE, re.IGNORECASE)
_ACRONYM_UPPER_RE = _word_pattern(DISQUALIFIED_ACRONYMS_UPPER_ONLY)


def find_institution_marker(text: str, website: Optional[str] = None) -> Optional[str]:
    """Returns the first government/institution marker found in text or website host, else None."""
    for rx in (_PHRASE_RE, _ACRONYM_ANY_RE, _ACRONYM_UPPER_RE):
        m = rx.search(text)
        if m:
            return m.group(1)
    for extra in _extra_denylist():
        if extra in text.lower():
            return extra
    if website:
        host = re.sub(r"^[a-z]+://", "", website.strip().lower()).split("/")[0].split(":")[0]
        for suffix in INSTITUTION_DOMAIN_SUFFIXES:
            if host.endswith(suffix):
                return f"website domain {suffix}"
    return None
