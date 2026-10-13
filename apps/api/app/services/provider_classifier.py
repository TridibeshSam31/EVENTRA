"""Provider Classifier for EVENTRA Controlled Taxonomy.

Classifies raw provider metadata into the controlled 19-category EVENTRA taxonomy
using deterministic rule-based matching with fallback to EVENTRA's existing LLM abstraction.
"""
import re
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.models.enums import ProviderCategory
from app.integrations.registry import registry


class ClassificationResult(BaseModel):
    """Structured output from ProviderClassifier."""
    category: str
    subcategory: Optional[str] = None
    capabilities: List[str] = Field(default_factory=list)
    service_area: List[str] = Field(default_factory=list)
    confidence: float = 0.0
    reason: str = ""


# High-precision keywords mapping to controlled categories
CATEGORY_KEYWORD_RULES = {
    "CATERING": {
        "keywords": ["caterer", "catering", "buffet", "culinary", "banquet food", "food supplier", "live counter", "tiffin"],
        "subcategory": "CATERING_SERVICE",
        "capabilities_map": {
            "veg": "pure_veg",
            "non-veg": "non_veg_catering",
            "buffet": "buffet_setup",
            "live": "live_counters",
            "cocktail": "cocktail_snacks",
            "dessert": "dessert_spread",
        },
    },
    "VENUE": {
        "keywords": [
            "banquet hall", "banquet", "banquets", "venue", "venues", "event venue",
            "wedding venue", "marriage hall", "party hall", "resort", "hotel",
            "convention center", "convention centre", "wedding lawn", "farmhouse",
            "party plot", "auditorium", "community hall", "kalyana mandapam", "palace"
        ],
        "subcategory": "EVENT_VENUE",
        "capabilities_map": {
            "lawn": "outdoor_lawn",
            "hall": "indoor_banquet",
            "parking": "valet_parking",
            "pool": "poolside",
            "room": "guest_rooms",
        },
    },
    "DECOR": {
        "keywords": ["decor", "decorator", "decoration", "stage decor", "mandap", "theme decor", "backdrop", "balloon decor"],
        "subcategory": "EVENT_DECOR",
        "capabilities_map": {
            "flower": "floral_styling",
            "theme": "theme_customization",
            "entry": "entrance_arch",
            "stage": "stage_fabrication",
        },
    },
    "PHOTOGRAPHY": {
        "keywords": ["photographer", "photography", "photo studio", "candid photo", "pre-wedding shoot", "portrait"],
        "subcategory": "PHOTOGRAPHY_STUDIO",
        "capabilities_map": {
            "candid": "candid_photography",
            "traditional": "traditional_photography",
            "drone": "aerial_drone_shots",
            "album": "printed_photobooks",
        },
    },
    "VIDEOGRAPHY": {
        "keywords": ["videography", "cinematography", "wedding film", "video production", "teaser film", "drone video"],
        "subcategory": "CINEMATOGRAPHY",
        "capabilities_map": {
            "cinematic": "cinematic_films",
            "teaser": "same_day_teasers",
            "drone": "aerial_videography",
            "4k": "4k_recording",
        },
    },
    "DJ_MUSIC": {
        "keywords": ["dj", "disc jockey", "dj sound", "dj music", "sound track", "party dj", "club dj"],
        "subcategory": "DJ_ARTIST",
        "capabilities_map": {
            "console": "pro_dj_console",
            "lighting": "integrated_dance_floor_lights",
            "sound": "subwoofer_rig",
        },
    },
    "LIGHTING": {
        "keywords": ["lighting", "stage lights", "led wall", "ambient lights", "truss lighting", "wash lights"],
        "subcategory": "LIGHTING_RENTAL",
        "capabilities_map": {
            "led": "led_par_lights",
            "sharpie": "moving_heads",
            "truss": "aluminum_trussing",
            "ambient": "architectural_facade_lighting",
        },
    },
    "AV_TECH": {
        "keywords": ["audiovisual", "av tech", "av rental", "projector", "mic sound", "sound system", "audio equipment"],
        "subcategory": "AV_PRODUCTION",
        "capabilities_map": {
            "mic": "wireless_microphones",
            "speaker": "line_array_speakers",
            "projector": "high_lumen_projectors",
            "screen": "led_video_wall",
        },
    },
    "ENTERTAINMENT": {
        "keywords": ["live band", "singer", "performer", "anchor", "emcee", "magician", "artist management", "orchestra"],
        "subcategory": "LIVE_ENTERTAINMENT",
        "capabilities_map": {
            "live": "live_vocalists",
            "band": "multi_piece_band",
            "anchor": "bilingual_emcee",
        },
    },
    "TRANSPORT": {
        "keywords": ["transport", "cab rental", "bus rental", "luxury car", "fleet", "valet", "coach travel"],
        "subcategory": "EVENT_LOGISTICS",
        "capabilities_map": {
            "luxury": "luxury_sedans",
            "bus": "ac_coaches",
            "shuttle": "guest_shuttle_service",
        },
    },
    "SECURITY": {
        "keywords": ["security", "bouncer", "security guards", "bodyguard", "crowd control", "licensed guards"],
        "subcategory": "EVENT_SECURITY",
        "capabilities_map": {
            "bouncer": "vip_bouncers",
            "guard": "uniformed_guards",
            "metal": "door_frame_metal_detectors",
        },
    },
    "STAFFING": {
        "keywords": ["staffing", "hospitality staff", "waiters", "hostess", "usher", "event crew", "manpower"],
        "subcategory": "HOSPITALITY_CREW",
        "capabilities_map": {
            "hostess": "trained_hostesses",
            "waitstaff": "banquet_waitstaff",
            "coordinator": "on_ground_runners",
        },
    },
    "MAKEUP_STYLING": {
        "keywords": ["makeup", "bridal makeup", "makeover", "hairstyling", "salon", "cosmetology", "draping"],
        "subcategory": "MAKEUP_ARTIST",
        "capabilities_map": {
            "bridal": "hd_bridal_makeup",
            "hair": "advance_hairstyling",
            "airbrush": "airbrush_makeup",
        },
    },
    "PRINTING": {
        "keywords": ["printing", "invitation card", "backdrop printing", "flex banner", "signage", "brochure"],
        "subcategory": "PRINTING_FABRICATION",
        "capabilities_map": {
            "cards": "laser_cut_invitations",
            "flex": "large_format_vinyl",
            "badges": "lanyard_id_printing",
        },
    },
    "RENTALS": {
        "keywords": ["rentals", "furniture rental", "tent rental", "shamiana", "chair rental", "table rental", "cutlery rental"],
        "subcategory": "INVENTORY_RENTALS",
        "capabilities_map": {
            "tent": "german_hanger_tents",
            "furniture": "banquet_chiavari_chairs",
            "sofa": "vip_lounge_sofas",
        },
    },
    "FLORIST": {
        "keywords": ["florist", "flower shop", "flower delivery", "fresh flowers", "exotic flowers", "floral decor"],
        "subcategory": "FLORAL_SPECIALIST",
        "capabilities_map": {
            "exotic": "imported_carnations_orchids",
            "garland": "custom_varmala_garlands",
            "car": "wedding_car_floral_wrap",
        },
    },
    "PRODUCTION": {
        "keywords": ["event production", "stage fabrication", "exhibition stall", "rigging", "event fabrication"],
        "subcategory": "EVENT_PRODUCTION",
        "capabilities_map": {
            "stage": "heavy_duty_staging",
            "stall": "custom_stall_fabrication",
            "rigging": "truss_rigging",
        },
    },
    "CLEANING": {
        "keywords": ["cleaning", "waste management", "sanitization", "housekeeping", "post event cleanup"],
        "subcategory": "FACILITY_CLEANING",
        "capabilities_map": {
            "post_event": "post_event_deep_clean",
            "waste": "segregated_waste_disposal",
            "washroom": "dedicated_restroom_attendants",
        },
    },
}


class ProviderClassifier:
    """Classifies provider information into EVENTRA's controlled taxonomy."""

    VALID_CATEGORIES = {cat.value for cat in ProviderCategory}

    @classmethod
    def classify(
        cls,
        name: str,
        raw_category: Optional[str] = None,
        description: Optional[str] = None,
        city: Optional[str] = None,
        website: Optional[str] = None,
    ) -> ClassificationResult:
        """Classifies a business into the controlled taxonomy using deterministic matching."""
        combined_text = f"{name} {raw_category or ''} {description or ''}".lower()

        best_category = "OTHER"
        best_subcategory = None
        best_confidence = 0.0
        best_reason = "No high-confidence taxonomy match identified."
        detected_capabilities: List[str] = []

        # 1. Deterministic Rule-Based Scanning
        for cat_name, rule_data in CATEGORY_KEYWORD_RULES.items():
            score = 0
            matched_keywords = []

            # Raw category match has highest weight
            if raw_category:
                raw_cat_lower = raw_category.lower()
                for kw in rule_data["keywords"]:
                    if kw in raw_cat_lower:
                        score += 3
                        matched_keywords.append(f"raw_category:{kw}")

            # Business name match has strong weight
            name_lower = name.lower()
            for kw in rule_data["keywords"]:
                if kw in name_lower:
                    score += 2
                    matched_keywords.append(f"name:{kw}")

            # Description match
            if description:
                desc_lower = description.lower()
                for kw in rule_data["keywords"]:
                    if kw in desc_lower:
                        score += 1
                        matched_keywords.append(f"desc:{kw}")

            if score > 0:
                confidence = min(0.98, round(0.55 + (score * 0.1), 2))
                if confidence > best_confidence:
                    best_confidence = confidence
                    best_category = cat_name
                    best_subcategory = rule_data["subcategory"]
                    best_reason = f"Matched keywords: {', '.join(matched_keywords)}"

                    # Detect capabilities
                    caps = []
                    for kw_indicator, cap_label in rule_data["capabilities_map"].items():
                        if kw_indicator in combined_text:
                            caps.append(cap_label)
                    detected_capabilities = caps

        # If confidence is below threshold, categorize as OTHER
        if best_confidence < 0.60:
            return ClassificationResult(
                category="OTHER",
                subcategory=None,
                capabilities=[],
                service_area=[city] if city else [],
                confidence=0.40,
                reason="Below certainty threshold; categorized as OTHER per taxonomy policy.",
            )

        # Ensure category is strictly in controlled taxonomy
        if best_category not in cls.VALID_CATEGORIES:
            best_category = "OTHER"

        return ClassificationResult(
            category=best_category,
            subcategory=best_subcategory,
            capabilities=detected_capabilities,
            service_area=[city] if city else [],
            confidence=best_confidence,
            reason=best_reason,
        )
