"""Domain Service: VenueService

Implements deterministic discovery, filtering, availability checks,
and factual suitability evaluation for venues.
"""
from typing import Any, Dict, List, Optional, Tuple, Set
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_

from app.models.venue import Venue
from app.models.venue_availability import VenueAvailability
from app.schemas.venue import (
    VenueCreate,
    VenueUpdate,
    VenueAvailabilityCreate,
    VenueAvailabilityResult,
    VenueAvailabilityResponse,
    VenueSuitabilityCheck,
    VenueSuitabilityResult,
)


class VenueService:
    """Coordinates business logic and enforces domain invariants for Venues."""

    def __init__(self, db: Session):
        self.db = db

    def create_venue(self, venue_in: VenueCreate) -> Venue:
        """Creates a new venue with validated attributes."""
        venue = Venue(
            name=venue_in.name.strip(),
            address=venue_in.address.strip() if venue_in.address else None,
            city=venue_in.city.strip(),
            latitude=venue_in.latitude,
            longitude=venue_in.longitude,
            capacity=venue_in.capacity,
            venue_type=venue_in.venue_type.strip(),
            contact_email=venue_in.contact_email.strip() if venue_in.contact_email else None,
            contact_phone=venue_in.contact_phone.strip() if venue_in.contact_phone else None,
            hourly_rate=venue_in.hourly_rate,
            amenities=[a.strip().lower() for a in venue_in.amenities],
            status=venue_in.status.strip().upper(),
        )
        self.db.add(venue)
        self.db.commit()
        self.db.refresh(venue)
        return venue

    def get_venue(self, venue_id: str) -> Optional[Venue]:
        """Retrieves venue by ID."""
        return self.db.query(Venue).filter(Venue.id == venue_id).first()

    def update_venue(self, venue_id: str, venue_in: VenueUpdate) -> Optional[Venue]:
        """Updates an existing venue."""
        venue = self.get_venue(venue_id)
        if not venue:
            return None

        update_data = venue_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if field == "amenities" and value is not None:
                venue.amenities = [a.strip().lower() for a in value]
            elif field == "status" and value is not None:
                venue.status = value.strip().upper()
            elif isinstance(value, str):
                setattr(venue, field, value.strip())
            else:
                setattr(venue, field, value)

        self.db.commit()
        self.db.refresh(venue)
        return venue

    def search_venues(
        self,
        city: Optional[str] = None,
        min_capacity: Optional[int] = None,
        max_capacity: Optional[int] = None,
        venue_type: Optional[str] = None,
        status: Optional[str] = "ACTIVE",
        max_hourly_rate: Optional[float] = None,
        required_amenities: Optional[List[str]] = None,
        available_from: Optional[datetime] = None,
        available_to: Optional[datetime] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Venue], int]:
        """Deterministically searches venues with multi-criteria filtering and pagination.

        Ordering is strictly stable: ORDER BY name ASC, id ASC.
        """
        query = self.db.query(Venue)

        if city:
            query = query.filter(func.lower(Venue.city) == city.strip().lower())

        if min_capacity is not None:
            query = query.filter(Venue.capacity >= min_capacity)

        if max_capacity is not None:
            query = query.filter(Venue.capacity <= max_capacity)

        if venue_type:
            query = query.filter(func.lower(Venue.venue_type) == venue_type.strip().lower())

        if status:
            query = query.filter(Venue.status == status.strip().upper())

        if max_hourly_rate is not None:
            query = query.filter(Venue.hourly_rate <= max_hourly_rate)

        # Availability filter: exclude venues that have a conflicting slot
        if available_from and available_to:
            if available_from >= available_to:
                raise ValueError("available_from must be before available_to")

            conflict_subquery = (
                self.db.query(VenueAvailability.venue_id)
                .filter(
                    VenueAvailability.status.in_(["BOOKED", "BLOCKED", "MAINTENANCE"]),
                    VenueAvailability.start_datetime < available_to,
                    VenueAvailability.end_datetime > available_from,
                )
                .subquery()
            )
            query = query.filter(~Venue.id.in_(conflict_subquery))

        # Amenities filter (in-memory verification for strict cross-DB compatibility)
        if required_amenities:
            norm_required = [a.strip().lower() for a in required_amenities if a.strip()]
            if norm_required:
                candidates = query.order_by(Venue.name.asc(), Venue.id.asc()).all()
                filtered = [
                    v
                    for v in candidates
                    if all(req in [a.lower() for a in (v.amenities or [])] for req in norm_required)
                ]
                total = len(filtered)
                paginated = filtered[offset : offset + limit]
                return paginated, total

        total = query.count()
        results = (
            query.order_by(Venue.name.asc(), Venue.id.asc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return results, total

    def add_venue_availability(
        self,
        venue_id: str,
        avail_in: VenueAvailabilityCreate,
    ) -> VenueAvailability:
        """Records an availability slot for a venue."""
        venue = self.get_venue(venue_id)
        if not venue:
            raise ValueError(f"Venue with id '{venue_id}' not found")

        if avail_in.start_datetime >= avail_in.end_datetime:
            raise ValueError("start_datetime must be strictly before end_datetime")

        slot = VenueAvailability(
            venue_id=venue_id,
            start_datetime=avail_in.start_datetime,
            end_datetime=avail_in.end_datetime,
            status=avail_in.status.strip().upper(),
            notes=avail_in.notes.strip() if avail_in.notes else None,
        )
        self.db.add(slot)
        self.db.commit()
        self.db.refresh(slot)
        return slot

    def check_venue_availability(
        self,
        venue_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
    ) -> VenueAvailabilityResult:
        """Evaluates whether a venue is available for the requested time window."""
        venue = self.get_venue(venue_id)
        if not venue:
            raise ValueError(f"Venue with id '{venue_id}' not found")

        if start_datetime >= end_datetime:
            raise ValueError("start_datetime must be strictly before end_datetime")

        if venue.status != "ACTIVE":
            return VenueAvailabilityResult(
                venue_id=venue_id,
                is_available=False,
                start_datetime=start_datetime,
                end_datetime=end_datetime,
                conflicts=[],
                reason=f"Venue status is '{venue.status}', not ACTIVE",
            )

        # Query overlapping slots that are not available
        conflicts_query = self.db.query(VenueAvailability).filter(
            VenueAvailability.venue_id == venue_id,
            VenueAvailability.status.in_(["BOOKED", "BLOCKED", "MAINTENANCE"]),
            VenueAvailability.start_datetime < end_datetime,
            VenueAvailability.end_datetime > start_datetime,
        ).order_by(VenueAvailability.start_datetime.asc())

        conflicts = conflicts_query.all()
        conflict_responses = [
            VenueAvailabilityResponse.model_validate(c) for c in conflicts
        ]

        is_available = len(conflicts) == 0
        reason = None if is_available else f"Found {len(conflicts)} conflicting booked/blocked window(s)"

        return VenueAvailabilityResult(
            venue_id=venue_id,
            is_available=is_available,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            conflicts=conflict_responses,
            reason=reason,
        )

    def check_venue_suitability(
        self,
        venue_id: str,
        check_in: VenueSuitabilityCheck,
    ) -> VenueSuitabilityResult:
        """Performs a deterministic, factual suitability check against hard requirements."""
        venue = self.get_venue(venue_id)
        if not venue:
            raise ValueError(f"Venue with id '{venue_id}' not found")

        # Capacity check
        capacity_satisfied = venue.capacity >= check_in.required_capacity

        # Amenities check
        venue_amenities = [a.lower() for a in (venue.amenities or [])]
        req_amenities = [a.strip().lower() for a in (check_in.required_amenities or [])]
        missing_amenities = [a for a in req_amenities if a not in venue_amenities]
        amenities_satisfied = len(missing_amenities) == 0

        # Availability check (if window provided)
        availability_satisfied = None
        if check_in.start_datetime and check_in.end_datetime:
            avail_res = self.check_venue_availability(
                venue_id=venue_id,
                start_datetime=check_in.start_datetime,
                end_datetime=check_in.end_datetime,
            )
            availability_satisfied = avail_res.is_available

        # Overall suitability
        is_suitable = capacity_satisfied and amenities_satisfied
        if availability_satisfied is not None:
            is_suitable = is_suitable and availability_satisfied

        return VenueSuitabilityResult(
            venue_id=venue.id,
            venue_name=venue.name,
            capacity=venue.capacity,
            required_capacity=check_in.required_capacity,
            capacity_satisfied=capacity_satisfied,
            required_amenities=req_amenities,
            missing_amenities=missing_amenities,
            amenities_satisfied=amenities_satisfied,
            availability_satisfied=availability_satisfied,
            is_suitable=is_suitable,
        )

    def discover_live_venues(
        self,
        city: str,
        query: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        limit: int = 25,
        save_to_db: bool = True,
    ) -> Tuple[List[Venue], int, str, str]:
        """Discovers real venues from the live open geospatial network and optionally upserts them.

        Returns: (venues, total_created, city, source)
        """
        from app.services.geospatial_service import geospatial_discovery

        raw_venues = geospatial_discovery.discover_real_venues(
            city=city,
            query=query,
            latitude=latitude,
            longitude=longitude,
            limit=limit,
        )

        source = "LIVE_OPENSTREETMAP_NETWORK"
        total_created = 0
        result_venues: List[Venue] = []

        if not save_to_db:
            import uuid
            from app.models.venue import utc_now
            for rv in raw_venues:
                v = Venue(
                    id=str(uuid.uuid4()),
                    name=rv["name"],
                    address=rv.get("address"),
                    city=rv.get("city", city),
                    latitude=rv.get("latitude"),
                    longitude=rv.get("longitude"),
                    capacity=rv.get("capacity", 500),
                    venue_type=rv.get("venue_type", "Modern Event Space"),
                    hourly_rate=rv.get("hourly_rate", 300.0),
                    amenities=rv.get("amenities", []),
                    status=rv.get("status", "ACTIVE"),
                    created_at=utc_now(),
                    updated_at=utc_now(),
                )
                result_venues.append(v)
            return result_venues, 0, city, source

        for rv in raw_venues:
            v_name = rv["name"].strip()
            existing = (
                self.db.query(Venue)
                .filter(
                    func.lower(Venue.name) == v_name.lower(),
                    func.lower(Venue.city) == city.strip().lower(),
                )
                .first()
            )

            if existing:
                if rv.get("latitude") and not existing.latitude:
                    existing.latitude = rv.get("latitude")
                    existing.longitude = rv.get("longitude")
                if rv.get("address") and not existing.address:
                    existing.address = rv.get("address")
                result_venues.append(existing)
            else:
                new_v = Venue(
                    name=v_name,
                    address=rv.get("address"),
                    city=city.strip(),
                    latitude=rv.get("latitude"),
                    longitude=rv.get("longitude"),
                    capacity=rv.get("capacity", 500),
                    venue_type=rv.get("venue_type", "Modern Event Space"),
                    hourly_rate=rv.get("hourly_rate", 300.0),
                    amenities=rv.get("amenities", []),
                    status="ACTIVE",
                )
                self.db.add(new_v)
                result_venues.append(new_v)
                total_created += 1

        self.db.commit()
        for v in result_venues:
            self.db.refresh(v)

        return result_venues, total_created, city, source

    def recommend_best_venues(
        self,
        city: str,
        guest_count: Optional[int] = None,
        event_type: Optional[str] = None,
        budget: Optional[float] = None,
        required_amenities: Optional[List[str]] = None,
        user_description: Optional[str] = None,
        limit: int = 15,
    ) -> Dict[str, Any]:
        """Scouts real venues from live geospatial network and ranks the best venue for the event requirement."""
        city_clean = city.strip()
        # 1. Discover live venues in that city
        venues, _, _, _ = self.discover_live_venues(
            city=city_clean,
            limit=limit,
            save_to_db=True,
        )

        # Supplement with any existing DB venues in that city
        db_venues = self.db.query(Venue).filter(func.lower(Venue.city) == city_clean.lower()).all()
        seen_ids = set()
        all_candidates: List[Venue] = []
        for v in (venues + db_venues):
            if v.id not in seen_ids:
                seen_ids.add(v.id)
                all_candidates.append(v)

        # 2. Extract keywords from user_description if provided
        keywords: Set[str] = set()
        if required_amenities:
            for a in required_amenities:
                keywords.add(a.lower().strip())
        desc_lower = (user_description or "").lower()
        check_words = [
            "outdoor", "lawn", "garden", "banquet", "hall", "parking", "av",
            "sound", "stage", "lighting", "catering", "wifi", "luxury",
            "auditorium", "theatre", "conference", "exhibition"
        ]
        for w in check_words:
            if w in desc_lower:
                keywords.add(w)

        # 3. Evaluate each venue
        target_guests = guest_count or 100
        scored_venues = []

        for v in all_candidates:
            cap = v.capacity or 500
            # Capacity calculation
            cap_status = "FIT"
            if cap >= target_guests:
                ratio = cap / target_guests
                if 1.0 <= ratio <= 2.5:
                    cap_score = 98  # Ideal sizing
                elif ratio <= 5.0:
                    cap_score = 90  # Generous headroom
                else:
                    cap_score = 80  # Much larger than needed
            else:
                shortfall = (target_guests - cap) / target_guests
                cap_score = max(30, int(90 - (shortfall * 70)))
                cap_status = "TIGHT" if cap_score >= 60 else "EXCEEDED"

            # Amenity & description keyword match
            v_amenities = [a.lower() for a in (v.amenities or [])]
            v_text = f"{v.name} {v.venue_type} {' '.join(v_amenities)}".lower()

            matched_amenities = []
            pros = []
            cons = []

            if cap >= target_guests:
                pros.append(f"Comfortably accommodates {target_guests} attendees (capacity: {cap})")
            else:
                cons.append(f"Capacity of {cap} is below the {target_guests} guest requirement")

            amenity_score = 85
            if keywords:
                matched = [kw for kw in keywords if kw in v_text]
                matched_amenities = matched
                if matched:
                    amenity_score = min(99, 75 + int((len(matched) / len(keywords)) * 25))
                    pros.append(f"Supports required features: {', '.join(matched)}")
                else:
                    amenity_score = 65
                    cons.append("May require external setup for specialized amenities")
            else:
                matched_amenities = (v.amenities or [])[:3]

            # Budget score
            budget_score = 90
            hr_rate = v.hourly_rate or 250.0
            if budget:
                est_venue_cost = hr_rate * 8.0  # 8 hour day estimate
                if est_venue_cost <= (budget * 0.4):
                    budget_score = 95
                    pros.append(f"Within target budget range (~₹{est_venue_cost:,.0f} full day)")
                elif est_venue_cost <= (budget * 0.6):
                    budget_score = 80
                else:
                    budget_score = 65
                    cons.append(f"Higher hourly rate (₹{hr_rate}/hr may consume significant budget)")

            # Overall composite suitability score (weighted)
            overall_score = int((cap_score * 0.45) + (amenity_score * 0.35) + (budget_score * 0.20))
            overall_score = max(45, min(99, overall_score))

            # Badge designation
            badge = "Candidate Space"
            if overall_score >= 93:
                badge = "🏆 Top Recommendation"
            elif "outdoor" in v_text or "lawn" in v_text:
                badge = "🌳 Premier Outdoor Venue"
            elif cap >= 1000:
                badge = "🌟 Mega Capacity Space"
            elif hr_rate < 200:
                badge = "💰 Best Value Space"

            match_reasons = []
            if cap_status == "FIT":
                match_reasons.append(f"Fits {target_guests} guests with comfortable operational buffer")
            if matched_amenities:
                match_reasons.append(f"Matches requirements: {', '.join(matched_amenities[:3])}")
            if v.address:
                match_reasons.append(f"Location: {v.address}")

            scored_venues.append({
                "id": v.id,
                "name": v.name,
                "address": v.address or f"{v.city} Metro Area",
                "city": v.city,
                "capacity": cap,
                "venue_type": v.venue_type,
                "hourly_rate": hr_rate,
                "amenities": v.amenities or [],
                "suitability_score": overall_score,
                "is_best_match": False,
                "badge": badge,
                "match_reasons": match_reasons,
                "pros": pros,
                "cons": cons,
                "capacity_status": cap_status,
            })

        # Sort descending by suitability score
        scored_venues.sort(key=lambda x: x["suitability_score"], reverse=True)

        best_venue = None
        if scored_venues:
            scored_venues[0]["is_best_match"] = True
            scored_venues[0]["badge"] = "🏆 Best Overall Match"
            best_venue = scored_venues[0]

        summary = ""
        if best_venue:
            e_type_str = f" {event_type.lower()}" if event_type else " event"
            g_str = f" for {target_guests} guests" if guest_count else ""
            summary = (
                f"Scouted {len(scored_venues)} venues in {city_clean}. Based on your{e_type_str} requirement{g_str}, "
                f"the AI Agent recommends **{best_venue['name']}** as the best fit ({best_venue['suitability_score']}% match). "
                f"It offers {best_venue['capacity']} capacity, {best_venue['venue_type']} layout, and matches your core operational criteria."
            )
        else:
            summary = f"Scouted live venues in {city_clean}. No active candidates found."

        return {
            "city": city_clean,
            "total_scouted": len(scored_venues),
            "agent_summary": summary,
            "best_venue": best_venue,
            "ranked_venues": scored_venues,
        }


