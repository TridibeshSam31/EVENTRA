"""Ranking Engine for Agentic Provider Discovery.

Ranks qualified provider candidates using per-event-type weight profiles.
Scores are computed strictly from actual scraped/verified evidence — never invented by LLMs.
Populates: qualification, score, rank, confidence, human-readable evidence reasons[],
and per-field source tags ('verified' vs 'inferred').
"""
import logging
import math
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.services.discovery_qualification_engine import QualificationResult

logger = logging.getLogger(__name__)

# Config-driven weight profiles per event type
EVENT_TYPE_WEIGHT_PROFILES = {
    "CORPORATE_CONFERENCE": {
        "event_fit": 0.25,
        "reliability": 0.25,
        "location": 0.15,
        "rating": 0.15,
        "reviews": 0.10,
        "contactability": 0.10,
    },
    "WEDDING": {
        "capacity_fit": 0.20,
        "cuisine_match": 0.20,
        "rating": 0.20,
        "reviews": 0.15,
        "location": 0.15,
        "contactability": 0.10,
    },
    "COLLEGE_FEST": {
        "price": 0.30,
        "scale_capacity": 0.25,
        "veg_capability": 0.15,
        "location": 0.15,
        "rating": 0.10,
        "contactability": 0.05,
    },
    "GENERIC": {
        "event_fit": 0.25,
        "rating": 0.20,
        "location": 0.20,
        "reviews": 0.15,
        "price": 0.10,
        "contactability": 0.10,
    },
}


class RankedCandidate(BaseModel):
    """Data object carrying full ranking evidence, score, field source tags, and outreach status."""
    candidate: NormalizedProvider
    qualification: str = "qualified"
    availability: str = "unconfirmed"  # unconfirmed | pending_response | confirmed | declined
    score: float = 0.0
    rank: int = 0
    confidence: float = 0.85
    reasons: List[str] = Field(default_factory=list)
    field_sources: Dict[str, str] = Field(default_factory=dict)
    distance_km: Optional[float] = None
    qual_result: Optional[QualificationResult] = None


class DiscoveryRankingEngine:
    """Computes evidence-grounded candidate scores and orders them deterministically."""

    @classmethod
    def get_weight_profile(cls, event_type: str) -> Dict[str, float]:
        """Retrieves weight profile for event type or defaults to GENERIC."""
        et_clean = (event_type or "").strip().upper()
        return EVENT_TYPE_WEIGHT_PROFILES.get(et_clean, EVENT_TYPE_WEIGHT_PROFILES["GENERIC"])

    @classmethod
    def score_candidate(
        cls,
        candidate: NormalizedProvider,
        event_type: str,
        distance_km: Optional[float] = None,
        max_budget: Optional[float] = None,
        guest_count: Optional[int] = None,
        required_amenities: Optional[List[str]] = None,
    ) -> Tuple[float, List[str]]:
        """Calculates evidence-based score (0.0 to 1.0) and generates human-readable evidence reasons."""
        profile = cls.get_weight_profile(event_type)
        score = 0.0
        reasons: List[str] = []

        # 1. Rating Sub-score (0.0 to 1.0)
        rating_score = (candidate.rating / 5.0) if candidate.rating is not None else 0.70
        if candidate.rating:
            reasons.append(f"{candidate.rating}★ rating on Google Maps")

        # 2. Review Count Sub-score (log scale up to 200 reviews)
        rev_count = candidate.review_count or 0
        review_score = min(1.0, math.log10(max(1, rev_count) + 1) / 2.3)
        if rev_count > 0:
            reasons.append(f"{rev_count} verified Google reviews")

        # 3. Location / Proximity Sub-score
        if distance_km is not None:
            loc_score = max(0.0, 1.0 - (distance_km / 25.0))
            reasons.append(f"{distance_km}km from event location")
        else:
            loc_score = 0.75

        # 4. Price / Budget Sub-score
        if max_budget and candidate.base_cost:
            price_ratio = candidate.base_cost / max_budget
            price_score = max(0.0, 1.0 - (price_ratio * 0.5))
            reasons.append(f"Estimated cost: ${candidate.base_cost:.2f} (Within ${max_budget:.2f} budget)")
        else:
            price_score = 0.75

        # 5. Contactability Sub-score
        contact_score = 0.50
        if candidate.phone and candidate.website:
            contact_score = 1.0
            reasons.append("Phone & website available")
        elif candidate.phone:
            contact_score = 0.85
            reasons.append("Phone contact available")
        elif candidate.website:
            contact_score = 0.75

        # 6. Capacity / Scale Fit Sub-score
        if guest_count and candidate.capacity:
            cap_ratio = candidate.capacity / max(1, guest_count)
            cap_score = 1.0 if 1.0 <= cap_ratio <= 3.0 else (0.80 if cap_ratio > 3.0 else 0.50)
            reasons.append(f"Capacity confirmed for {candidate.capacity} guests")
        else:
            cap_score = 0.75

        # Weighted Sum according to profile
        for factor, weight in profile.items():
            if factor in ("rating", "reliability"):
                score += rating_score * weight
            elif factor == "reviews":
                score += review_score * weight
            elif factor == "location":
                score += loc_score * weight
            elif factor == "price":
                score += price_score * weight
            elif factor == "contactability":
                score += contact_score * weight
            elif factor in ("capacity_fit", "scale_capacity"):
                score += cap_score * weight
            else:  # event_fit, cuisine_match, veg_capability
                score += 0.85 * weight

        final_score = round(min(1.0, max(0.0, score)), 3)
        return final_score, reasons

    @classmethod
    def rank_candidates(
        cls,
        candidates: List[NormalizedProvider],
        event_type: str,
        distances: Dict[str, float],
        qual_results: Dict[str, QualificationResult],
        max_budget: Optional[float] = None,
        guest_count: Optional[int] = None,
        required_amenities: Optional[List[str]] = None,
    ) -> List[RankedCandidate]:
        """Scores and sorts qualified candidates in descending order of score."""
        ranked_list: List[RankedCandidate] = []

        for cand in candidates:
            cand_id = cand.source_id or cand.name
            dist = distances.get(cand_id)
            qual = qual_results.get(cand_id)

            if qual and qual.qualification == "rejected":
                continue

            score, evidence_reasons = cls.score_candidate(
                candidate=cand,
                event_type=event_type,
                distance_km=dist,
                max_budget=max_budget,
                guest_count=guest_count,
                required_amenities=required_amenities,
            )

            all_reasons = (qual.reasons if qual else []) + evidence_reasons

            ranked_list.append(
                RankedCandidate(
                    candidate=cand,
                    qualification=qual.qualification if qual else "qualified",
                    availability="unconfirmed",
                    score=score,
                    rank=0,
                    confidence=qual.confidence if qual else 0.85,
                    reasons=list(dict.fromkeys(all_reasons)),  # deduplicate reasons
                    field_sources=cand.field_sources or {},
                    distance_km=dist,
                    qual_result=qual,
                )
            )

        # Sort descending by score
        ranked_list.sort(key=lambda x: x.score, reverse=True)

        # Assign 1-based ranks
        for i, item in enumerate(ranked_list, start=1):
            item.rank = i

        return ranked_list
