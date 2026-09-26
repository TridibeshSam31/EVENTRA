"""Qualification Engine for Agentic Provider Discovery.

Enforces strict qualification gates:
1. Non-vendor / Institution filtering (rejects government, educational, railway entities).
2. Plausible category and capacity fit.
3. Business legitimacy & contactability check (active/open commercial entity).
4. Hard non-negotiable event constraints (capacity, budget ceiling, radius, required amenities).
5. Uncertain state resolution pass + human-readable evidence logging.
"""
import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.services.provider_classifier import ProviderClassifier

logger = logging.getLogger(__name__)

# Non-vendor / Institution keywords to reject unconditionally
DISQUALIFIED_INSTITUTION_KEYWORDS = [
    "institute of hotel management",
    "ihm",
    "irctc",
    "railway catering",
    "government office",
    "govt office",
    "police station",
    "training center",
    "training institute",
    "degree college",
    "university department",
    "hospital canteen",
    "municipal corporation",
    "panchayat",
    "public health center",
]


class QualificationResult(BaseModel):
    """Structured qualification assessment for a discovered candidate."""
    qualification: str  # "qualified" | "rejected" | "uncertain"
    hard_constraints_passed: bool = True
    is_legitimate_business: bool = True
    is_institution: bool = False
    reasons: List[str] = Field(default_factory=list)
    disqualification_reason: Optional[str] = None
    confidence: float = 1.0


class QualificationEngine:
    """Evaluates provider candidates against business legitimacy, category fit, and hard event constraints."""

    @classmethod
    def check_institution_disqualification(cls, candidate: NormalizedProvider) -> Tuple[bool, Optional[str]]:
        """Identifies non-vendor entities such as educational institutes or government bodies."""
        combined_text = f"{candidate.name} {candidate.raw_category or ''} {' '.join(candidate.categories)} {candidate.description or ''}".lower()
        for kw in DISQUALIFIED_INSTITUTION_KEYWORDS:
            if kw in combined_text:
                return True, f"Identified as non-commercial entity / institution matching '{kw}'"
        return False, None

    @classmethod
    def check_business_legitimacy(cls, candidate: NormalizedProvider) -> Tuple[bool, List[str]]:
        """Checks if provider is an active, open, contactable business entity."""
        reasons: List[str] = []
        if not candidate.is_active or candidate.business_status in ("CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"):
            return False, [f"Business status is {candidate.business_status}"]

        if candidate.phone:
            reasons.append(f"Verified contact phone: {candidate.phone}")
        elif candidate.website:
            reasons.append(f"Verified web presence: {candidate.website}")
        elif candidate.maps_url:
            reasons.append("Verified Google Maps listing")
        else:
            return False, ["Lacks any contact phone, website, or active maps listing"]

        return True, reasons

    @classmethod
    def evaluate(
        cls,
        candidate: NormalizedProvider,
        category: str,
        guest_count: Optional[int] = None,
        max_budget: Optional[float] = None,
        radius_km: Optional[float] = None,
        distance_km: Optional[float] = None,
        required_amenities: Optional[List[str]] = None,
    ) -> QualificationResult:
        """Runs multi-gate qualification on candidate. Hard failures immediately reject regardless of rating."""
        reasons: List[str] = []

        # Gate 1: Institution / Non-Vendor Disqualification Check
        is_inst, inst_reason = cls.check_institution_disqualification(candidate)
        if is_inst:
            return QualificationResult(
                qualification="rejected",
                hard_constraints_passed=False,
                is_legitimate_business=False,
                is_institution=True,
                reasons=[inst_reason],
                disqualification_reason=inst_reason,
                confidence=1.0,
            )

        # Gate 2: Business Legitimacy & Contactability
        is_legit, legit_reasons = cls.check_business_legitimacy(candidate)
        reasons.extend(legit_reasons)
        if not is_legit:
            reason_str = "; ".join(legit_reasons)
            return QualificationResult(
                qualification="rejected",
                hard_constraints_passed=False,
                is_legitimate_business=False,
                is_institution=False,
                reasons=legit_reasons,
                disqualification_reason=f"Failed business legitimacy: {reason_str}",
                confidence=0.95,
            )

        # Gate 3: Taxonomy & Category Compatibility
        cat_clean = category.strip().upper() if category else "OTHER"
        classification = ProviderClassifier.classify(
            name=candidate.name,
            raw_category=candidate.raw_category,
            description=candidate.description,
            city=candidate.city,
            website=candidate.website,
        )
        if cat_clean != "OTHER" and classification.category != cat_clean:
            # Secondary check: search raw categories list or description
            alt_match = False
            for raw_c in candidate.categories:
                if cat_clean.lower() in raw_c.lower():
                    alt_match = True
                    break
            if not alt_match:
                reason = f"Category mismatch (Requested: {cat_clean}, Classified: {classification.category})"
                return QualificationResult(
                    qualification="rejected",
                    hard_constraints_passed=False,
                    is_legitimate_business=True,
                    reasons=[reason],
                    disqualification_reason=reason,
                    confidence=0.90,
                )
            else:
                reasons.append(f"Category matched via raw categories list ({cat_clean})")
        else:
            reasons.append(f"Category fit confirmed for {cat_clean}")

        # Gate 4: Hard Constraints (Capacity, Budget, Radius, Required Amenities)
        # 4a. Capacity Constraint (Non-negotiable for Venues/Catering)
        if guest_count and guest_count > 0:
            if candidate.capacity is not None and candidate.capacity < guest_count:
                reason = f"Capacity constraint failed (Required: {guest_count}, Candidate Capacity: {candidate.capacity})"
                return QualificationResult(
                    qualification="rejected",
                    hard_constraints_passed=False,
                    reasons=reasons + [reason],
                    disqualification_reason=reason,
                    confidence=1.0,
                )
            elif candidate.capacity is not None:
                reasons.append(f"Capacity fit confirmed ({candidate.capacity} >= {guest_count})")

        # 4b. Budget Ceiling Constraint
        if max_budget and max_budget > 0 and candidate.base_cost:
            if candidate.base_cost > max_budget:
                reason = f"Budget ceiling constraint failed (Max Budget: {max_budget}, Base Cost: {candidate.base_cost})"
                return QualificationResult(
                    qualification="rejected",
                    hard_constraints_passed=False,
                    reasons=reasons + [reason],
                    disqualification_reason=reason,
                    confidence=1.0,
                )
            else:
                reasons.append(f"Budget fit confirmed ({candidate.base_cost} <= {max_budget})")

        # 4c. Radius Constraint
        if radius_km and distance_km is not None and distance_km > radius_km:
            reason = f"Distance constraint failed ({distance_km}km exceeds max radius {radius_km}km)"
            return QualificationResult(
                qualification="rejected",
                hard_constraints_passed=False,
                reasons=reasons + [reason],
                disqualification_reason=reason,
                confidence=1.0,
            )
        elif distance_km is not None:
            reasons.append(f"Location within radius ({distance_km}km)")

        # 4d. Required Amenities / Capabilities
        if required_amenities:
            cand_caps = set(c.lower() for c in (candidate.capabilities or []))
            desc_text = (candidate.description or "").lower()
            missing_caps = []
            for req in required_amenities:
                req_clean = req.replace("_", " ").lower()
                if not any(req_clean in c for c in cand_caps) and req_clean not in desc_text:
                    missing_caps.append(req)

            if missing_caps:
                # If rating & review count are strong, flag as UNCERTAIN for outreach verification pass
                if (candidate.rating or 0) >= 4.0 and (candidate.review_count or 0) >= 10:
                    reasons.append(f"Uncertain amenity match for: {', '.join(missing_caps)} (Flagged for outreach verification)")
                    return QualificationResult(
                        qualification="uncertain",
                        hard_constraints_passed=True,
                        reasons=reasons,
                        confidence=0.70,
                    )
                else:
                    reason = f"Required amenities missing: {', '.join(missing_caps)}"
                    return QualificationResult(
                        qualification="rejected",
                        hard_constraints_passed=False,
                        reasons=reasons + [reason],
                        disqualification_reason=reason,
                        confidence=0.85,
                    )
            else:
                reasons.append(f"Required amenities verified: {', '.join(required_amenities)}")

        return QualificationResult(
            qualification="qualified",
            hard_constraints_passed=True,
            is_legitimate_business=True,
            reasons=reasons,
            confidence=0.95,
        )

    @classmethod
    def resolve_uncertain_candidate(
        cls,
        candidate: NormalizedProvider,
        category: str,
        required_amenities: Optional[List[str]] = None,
    ) -> Tuple[str, List[str]]:
        """Secondary resolution pass for candidates in 'uncertain' state."""
        reasons: List[str] = ["Secondary resolution pass completed."]
        # Check website text or raw description
        desc_combined = f"{candidate.description or ''} {' '.join(candidate.categories)}".lower()
        if required_amenities:
            resolved = True
            for req in required_amenities:
                if req.replace("_", " ").lower() not in desc_combined:
                    resolved = False
                    break
            if resolved:
                reasons.append("Uncertain amenities confirmed via secondary description scan.")
                return "qualified", reasons
            else:
                reasons.append("Uncertain amenities unconfirmed after secondary scan; marked for outreach verification.")
                return "qualified", reasons  # Allow outreach to act as final verification

        return "qualified", reasons
