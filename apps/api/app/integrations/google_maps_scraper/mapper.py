"""Provider Normalizer: Maps raw Google Maps scraper results into NormalizedProvider."""
import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from app.integrations.google_maps_scraper.models import (
    RawScraperBusiness,
    NormalizedProvider,
)


class ProviderNormalizer:
    """Deterministic normalizer and data sanitization engine for raw scraper data."""

    @classmethod
    def normalize_phone(cls, phone: Optional[str]) -> Optional[str]:
        """Normalizes phone numbers to standard format."""
        if not phone:
            return None
        cleaned = re.sub(r"[^\d+]", "", str(phone).strip())
        return cleaned if len(cleaned) >= 7 else None

    @classmethod
    def normalize_website(cls, url: Optional[str]) -> Optional[str]:
        """Cleans and canonicalizes website URLs by removing tracking query parameters."""
        if not url:
            return None
        url_str = str(url).strip()
        if not url_str.startswith(("http://", "https://")):
            url_str = "https://" + url_str
        try:
            parsed = urlparse(url_str)
            domain = parsed.netloc.lower()
            if domain.startswith("www."):
                domain = domain[4:]
            path = parsed.path.rstrip("/")
            if not domain:
                return None
            return f"https://{domain}{path}"
        except Exception:
            return url_str

    @classmethod
    def extract_city(cls, address: Optional[str], default_city: str = "Local") -> str:
        """Extracts city from address string or returns default."""
        if not address:
            return default_city
        parts = [p.strip() for p in address.split(",") if p.strip()]
        if len(parts) >= 2:
            # Common patterns: "123 Street, City, State ZIP" -> parts[-2] or parts[-3]
            candidate = parts[-2]
            # Strip postal codes if mixed in
            candidate_clean = re.sub(r"\b\d{5,6}\b", "", candidate).strip()
            if candidate_clean:
                return candidate_clean
        return default_city

    @classmethod
    def normalize(
        cls,
        raw: RawScraperBusiness,
        default_city: str = "Local",
    ) -> NormalizedProvider:
        """Transforms a RawScraperBusiness into a clean NormalizedProvider."""
        name = (raw.name or raw.title or "Unknown Provider").strip()
        address = (raw.address or "").strip() or None
        city = cls.extract_city(address, default_city=default_city)

        lat = raw.latitude if raw.latitude is not None else raw.lat
        lon = raw.longitude if raw.longitude is not None else raw.lon

        rating = raw.rating if raw.rating is not None else raw.review_rating
        if rating is not None:
            try:
                rating = round(max(0.0, min(5.0, float(rating))), 2)
            except (ValueError, TypeError):
                rating = None

        rev_count = raw.review_count
        if rev_count is not None:
            try:
                rev_count = max(0, int(rev_count))
            except (ValueError, TypeError):
                rev_count = None

        phone = cls.normalize_phone(raw.phone)
        website = cls.normalize_website(raw.website)
        email = (raw.email or raw.emails or "").strip() or None
        if email and "," in email:
            email = email.split(",")[0].strip()

        # Identify source ID (CID, place_id, or extract from link)
        source_id = raw.place_id or raw.cid
        if not source_id and raw.link:
            cid_match = re.search(r"cid=([0-9]+)", raw.link)
            if cid_match:
                source_id = cid_match.group(1)

        raw_category = (raw.category or "").strip() or None
        categories_list = raw.categories or ([raw_category] if raw_category else [])

        b_status = (raw.business_status or "OPERATIONAL").upper()
        if b_status not in ("OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"):
            b_status = "OPERATIONAL"
        is_active = b_status == "OPERATIONAL"

        # Field source tags: verified vs inferred
        field_sources: Dict[str, str] = {
            "name": "verified",
            "address": "verified" if address else "inferred",
            "phone": "verified" if phone else "inferred",
            "website": "verified" if website else "inferred",
            "rating": "verified" if rating is not None else "inferred",
            "review_count": "verified" if rev_count is not None else "inferred",
            "business_status": "verified" if raw.business_status else "inferred",
            "capacity": "inferred",
            "base_cost": "inferred",
        }

        return NormalizedProvider(
            source="GOOGLE_MAPS",
            source_id=source_id,
            name=name,
            category="OTHER",  # Classified in downstream classification layer
            raw_category=raw_category,
            categories=categories_list,
            address=address,
            city=city,
            latitude=lat,
            longitude=lon,
            phone=phone,
            email=email,
            website=website,
            rating=rating,
            review_count=rev_count,
            maps_url=raw.link,
            description=raw.description,
            business_status=b_status,
            is_active=is_active,
            opening_hours=raw.opening_hours or {},
            field_sources=field_sources,
            raw_data=raw.raw_data or raw.model_dump(mode="json"),
        )
