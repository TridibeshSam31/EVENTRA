"""Search Planner for Agentic Provider Discovery.

Generates multiple search query variants (3-5 variants per iteration) from event
spec, category, required amenities, and event type — avoiding fixed 1-2 string limitations.
"""
import logging
from typing import List, Optional, Set

logger = logging.getLogger(__name__)

# Event type descriptors to enrich search keywords
EVENT_TYPE_MODIFIERS = {
    "WEDDING": ["wedding", "grand reception", "marriage venue", "luxury bridal"],
    "CORPORATE_CONFERENCE": ["corporate conference", "business summit", "executive seminar", "convention"],
    "COLLEGE_FEST": ["college fest", "campus festival", "student event", "large scale concert"],
    "BIRTHDAY_PARTY": ["birthday party", "private celebration", "family event"],
    "GENERIC": ["event", "celebration", "function"],
}

CATEGORY_SYNONYMS = {
    "CATERING": ["catering service", "caterers", "buffet food supplier", "banquet catering"],
    "VENUE": ["banquet hall", "event venue", "marriage lawn", "resort convention hall"],
    "DECOR": ["event decorator", "wedding decor", "stage decoration", "floral decorator"],
    "PHOTOGRAPHY": ["wedding photographer", "event photography studio", "candid photo service"],
    "VIDEOGRAPHY": ["event videography", "cinematographer", "wedding film maker"],
    "DJ_MUSIC": ["event dj", "dj sound system", "party dj music"],
    "LIGHTING": ["event lighting rental", "stage lights", "led wall lighting"],
    "AV_TECH": ["av equipment rental", "sound system rental", "microphones and projectors"],
    "ENTERTAINMENT": ["live band performance", "event anchor emcee", "live artist show"],
    "TRANSPORT": ["event transport bus rental", "luxury car rental", "valet parking service"],
    "SECURITY": ["event security bouncers", "security guards for event"],
    "STAFFING": ["event hospitality staff", "waiters hire", "hostess crew"],
    "MAKEUP_STYLING": ["bridal makeup artist", "event styling salon"],
    "PRINTING": ["event invitation cards printing", "flex banner printing"],
    "RENTALS": ["furniture rental for event", "tent and chair rentals"],
    "FLORIST": ["event florist", "fresh flower decorator"],
    "PRODUCTION": ["stage production fabrication", "event setup company"],
    "CLEANING": ["event waste management", "post event cleaning service"],
    "OTHER": ["event services", "vendor supplier"],
}


class SearchPlanner:
    """Generates varied, high-yield Google Maps search queries for an event."""

    @classmethod
    def generate_queries(
        cls,
        category: str,
        location: str,
        event_type: str = "GENERIC",
        required_services: Optional[List[str]] = None,
        tried_queries: Optional[Set[str]] = None,
        max_queries: int = 5,
    ) -> List[str]:
        """Generates up to max_queries unique search query strings for the current search iteration."""
        category_clean = category.strip().upper() if category else "OTHER"
        event_type_clean = event_type.strip().upper() if event_type else "GENERIC"
        loc = location.strip()
        tried = tried_queries or set()

        synonyms = CATEGORY_SYNONYMS.get(category_clean, [category_clean.lower()])
        modifiers = EVENT_TYPE_MODIFIERS.get(event_type_clean, EVENT_TYPE_MODIFIERS["GENERIC"])

        candidates: List[str] = []

        # Variant 1: Direct Category + Location
        candidates.append(f"{synonyms[0]} in {loc}")

        # Variant 2: Event Type + Category + Location
        candidates.append(f"{modifiers[0]} {synonyms[0]} in {loc}")

        # Variant 3: Secondary Synonym + Location
        if len(synonyms) > 1:
            candidates.append(f"{synonyms[1]} in {loc}")

        # Variant 4: Required Amenities/Services Specificity
        if required_services:
            for s in required_services[:2]:
                s_clean = s.replace("_", " ").lower()
                candidates.append(f"{s_clean} {category_clean.lower()} in {loc}")

        # Variant 5: Premium / Scale Keyword Variant
        if len(modifiers) > 1:
            candidates.append(f"{modifiers[1]} {synonyms[-1]} {loc}")

        # Filter out already tried queries and preserve uniqueness
        final_queries: List[str] = []
        for q in candidates:
            q_norm = q.strip().lower()
            if q_norm not in tried and q_norm not in [f.lower() for f in final_queries]:
                final_queries.append(q)
                if len(final_queries) >= max_queries:
                    break

        # Fallback if all standard candidates were tried
        if not final_queries:
            fallback_q = f"best {category_clean.lower()} providers near {loc}"
            if fallback_q.lower() not in tried:
                final_queries.append(fallback_q)

        return final_queries
