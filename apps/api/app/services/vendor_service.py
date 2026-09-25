"""Domain Service: VendorService (Provider Network)

Coordinates discovery, filtering, availability checks, category validation,
and assignment representations for providers/vendors.
"""
import math
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.vendor import Vendor
from app.models.provider_availability import ProviderAvailability
from app.models.vendor_assignment import VendorAssignment
from app.models.event import Event
from app.models.venue import Venue
from app.domains.registry import (
    is_provider_category_compatible,
    get_domain_provider_categories,
    get_domain,
)
from app.schemas.vendor import (
    VendorCreate,
    VendorUpdate,
    ProviderAvailabilityCreate,
    ProviderAvailabilityResult,
    ProviderAvailabilityResponse,
    VendorAssignmentCreate,
    VendorAssignmentUpdate,
    CategoryValidationResult,
    ProviderDiscoveryRequest,
)
from app.integrations.registry import registry
from app.services.provider_classifier import ProviderClassifier
from app.services.deduplication import ProviderDeduplicator
from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.integrations.google_maps_scraper.queries import build_discovery_query


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates great-circle distance between two GPS coordinates in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)


class VendorService:
    """Coordinates business logic and enforces domain invariants for Providers/Vendors."""

    def __init__(self, db: Session):
        self.db = db

    def create_vendor(self, vendor_in: VendorCreate) -> Vendor:
        """Creates a new provider record."""
        vendor = Vendor(
            name=vendor_in.name.strip(),
            category=vendor_in.category.strip(),
            city=vendor_in.city.strip(),
            address=vendor_in.address.strip() if vendor_in.address else None,
            latitude=vendor_in.latitude,
            longitude=vendor_in.longitude,
            contact_name=vendor_in.contact_name.strip() if vendor_in.contact_name else None,
            contact_email=vendor_in.contact_email.strip() if vendor_in.contact_email else None,
            contact_phone=vendor_in.contact_phone.strip() if vendor_in.contact_phone else None,
            website=vendor_in.website.strip() if vendor_in.website else None,
            maps_url=vendor_in.maps_url.strip() if vendor_in.maps_url else None,
            base_cost=vendor_in.base_cost,
            rating=vendor_in.rating,
            review_count=vendor_in.review_count,
            service_description=vendor_in.service_description.strip() if vendor_in.service_description else None,
            status=vendor_in.status.strip().upper(),
            source=vendor_in.source.strip().upper() if vendor_in.source else "INTERNAL",
            source_id=vendor_in.source_id.strip() if vendor_in.source_id else None,
            raw_category=vendor_in.raw_category.strip() if vendor_in.raw_category else None,
            capabilities=vendor_in.capabilities or [],
            classification_confidence=vendor_in.classification_confidence,
        )
        self.db.add(vendor)
        self.db.commit()
        self.db.refresh(vendor)
        return vendor

    def get_vendor(self, vendor_id: str) -> Optional[Vendor]:
        """Retrieves provider by ID."""
        return self.db.query(Vendor).filter(Vendor.id == vendor_id).first()

    def update_vendor(self, vendor_id: str, vendor_in: VendorUpdate) -> Optional[Vendor]:
        """Updates provider attributes."""
        vendor = self.get_vendor(vendor_id)
        if not vendor:
            return None

        update_data = vendor_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if field == "category" and value is not None:
                vendor.category = value.strip().lower()
            elif field == "status" and value is not None:
                vendor.status = value.strip().upper()
            elif isinstance(value, str):
                setattr(vendor, field, value.strip())
            else:
                setattr(vendor, field, value)

        self.db.commit()
        self.db.refresh(vendor)
        return vendor

    def search_vendors(
        self,
        category: Optional[str] = None,
        city: Optional[str] = None,
        status: Optional[str] = "ACTIVE",
        max_base_cost: Optional[float] = None,
        available_from: Optional[datetime] = None,
        available_to: Optional[datetime] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Vendor], int]:
        """Deterministically searches providers with multi-criteria filtering and pagination.

        Ordering is strictly stable: ORDER BY name ASC, id ASC.
        """
        query = self.db.query(Vendor)

        if category:
            query = query.filter(func.lower(Vendor.category) == category.strip().lower())

        if city:
            query = query.filter(func.lower(Vendor.city) == city.strip().lower())

        if status:
            query = query.filter(Vendor.status == status.strip().upper())

        if max_base_cost is not None:
            query = query.filter(Vendor.base_cost <= max_base_cost)

        # Availability filter
        if available_from and available_to:
            if available_from >= available_to:
                raise ValueError("available_from must be before available_to")

            conflict_subquery = (
                self.db.query(ProviderAvailability.vendor_id)
                .filter(
                    ProviderAvailability.status.in_(["BOOKED", "BLOCKED"]),
                    ProviderAvailability.start_datetime < available_to,
                    ProviderAvailability.end_datetime > available_from,
                )
                .subquery()
            )
            query = query.filter(~Vendor.id.in_(conflict_subquery))

        total = query.count()
        results = (
            query.order_by(Vendor.name.asc(), Vendor.id.asc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return results, total

    def add_provider_availability(
        self,
        vendor_id: str,
        avail_in: ProviderAvailabilityCreate,
    ) -> ProviderAvailability:
        """Records an availability slot for a provider."""
        vendor = self.get_vendor(vendor_id)
        if not vendor:
            raise ValueError(f"Provider with id '{vendor_id}' not found")

        if avail_in.start_datetime >= avail_in.end_datetime:
            raise ValueError("start_datetime must be strictly before end_datetime")

        slot = ProviderAvailability(
            vendor_id=vendor_id,
            start_datetime=avail_in.start_datetime,
            end_datetime=avail_in.end_datetime,
            status=avail_in.status.strip().upper(),
            notes=avail_in.notes.strip() if avail_in.notes else None,
        )
        self.db.add(slot)
        self.db.commit()
        self.db.refresh(slot)
        return slot

    def check_provider_availability(
        self,
        vendor_id: str,
        start_datetime: datetime,
        end_datetime: datetime,
    ) -> ProviderAvailabilityResult:
        """Evaluates whether a provider is available for the requested time window."""
        vendor = self.get_vendor(vendor_id)
        if not vendor:
            raise ValueError(f"Provider with id '{vendor_id}' not found")

        if start_datetime >= end_datetime:
            raise ValueError("start_datetime must be strictly before end_datetime")

        if vendor.status != "ACTIVE":
            return ProviderAvailabilityResult(
                vendor_id=vendor_id,
                is_available=False,
                start_datetime=start_datetime,
                end_datetime=end_datetime,
                conflicts=[],
                reason=f"Provider status is '{vendor.status}', not ACTIVE",
            )

        conflicts_query = self.db.query(ProviderAvailability).filter(
            ProviderAvailability.vendor_id == vendor_id,
            ProviderAvailability.status.in_(["BOOKED", "BLOCKED"]),
            ProviderAvailability.start_datetime < end_datetime,
            ProviderAvailability.end_datetime > start_datetime,
        ).order_by(ProviderAvailability.start_datetime.asc())

        conflicts = conflicts_query.all()
        conflict_responses = [
            ProviderAvailabilityResponse.model_validate(c) for c in conflicts
        ]

        is_available = len(conflicts) == 0
        reason = None if is_available else f"Found {len(conflicts)} conflicting booked/blocked window(s)"

        return ProviderAvailabilityResult(
            vendor_id=vendor_id,
            is_available=is_available,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            conflicts=conflict_responses,
            reason=reason,
        )

    def validate_category_for_domain(
        self,
        domain_name: str,
        category: str,
    ) -> CategoryValidationResult:
        """Validates if a category is supported by the domain specification."""
        domain = get_domain(domain_name)
        if not domain:
            raise ValueError(f"Unknown event domain '{domain_name}'")

        allowed = get_domain_provider_categories(domain_name)
        is_valid = is_provider_category_compatible(domain_name, category)

        return CategoryValidationResult(
            domain=domain_name,
            category=category,
            is_valid=is_valid,
            allowed_categories=allowed,
        )

    def create_assignment(
        self,
        assignment_in: VendorAssignmentCreate,
    ) -> VendorAssignment:
        """Records a provider assignment for an event."""
        vendor = self.get_vendor(assignment_in.vendor_id)
        if not vendor:
            raise ValueError(f"Provider with id '{assignment_in.vendor_id}' not found")

        assignment = VendorAssignment(
            event_id=assignment_in.event_id,
            vendor_id=assignment_in.vendor_id,
            category=assignment_in.category.strip().lower(),
            status=assignment_in.status.strip().upper(),
            agreed_cost=assignment_in.agreed_cost,
            notes=assignment_in.notes.strip() if assignment_in.notes else None,
        )
        self.db.add(assignment)
        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    def update_assignment(
        self,
        assignment_id: str,
        update_in: VendorAssignmentUpdate,
    ) -> Optional[VendorAssignment]:
        """Updates an existing assignment."""
        assignment = self.db.query(VendorAssignment).filter(VendorAssignment.id == assignment_id).first()
        if not assignment:
            return None

        update_data = update_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if field == "category" and value is not None:
                assignment.category = value.strip().lower()
            elif field == "status" and value is not None:
                assignment.status = value.strip().upper()
            elif isinstance(value, str):
                setattr(assignment, field, value.strip())
            else:
                setattr(assignment, field, value)

        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    def get_assignments_for_event(self, event_id: str) -> List[VendorAssignment]:
        """Returns all vendor assignments for a specific event with deterministic ordering."""
        return (
            self.db.query(VendorAssignment)
            .filter(VendorAssignment.event_id == event_id)
            .order_by(VendorAssignment.created_at.asc(), VendorAssignment.id.asc())
            .all()
        )

    def discover_providers(
        self,
        request: ProviderDiscoveryRequest,
        event_id: Optional[str] = None,
    ) -> Tuple[List[Vendor], int, int, str, List[str]]:
        """Discovers providers from Google Maps, normalizes, classifies into EVENTRA taxonomy,
        deduplicates against the existing database, and persists the results.
        Returns: (saved_vendors, total_created, total_updated, source, queries_used)
        """
        adapter = registry.get_google_maps_scraper()

        category = (request.category or "OTHER").strip().upper()
        city = (request.location or "Seattle").strip()

        keywords = build_discovery_query(
            category=category,
            custom_query=request.query,
            location=city,
        )

        res = adapter.search_providers(
            category=category,
            city=city,
            query=request.query,
            latitude=request.latitude,
            longitude=request.longitude,
            limit=request.limit,
        )

        raw_list = res.data or []
        source_label = res.source.value if hasattr(res.source, "value") else str(res.source)

        deduplicator = ProviderDeduplicator(self.db)
        saved_vendors: List[Vendor] = []
        created_count = 0
        updated_count = 0

        # Pre-fetch assigned vendor IDs if event_id is available
        assigned_vendor_ids = set()
        if event_id:
            assigned_vendor_ids = {a.vendor_id for a in self.get_assignments_for_event(event_id)}

        for item in raw_list:
            if isinstance(item, dict):
                norm_p = NormalizedProvider(**item)
            else:
                norm_p = item

            # Classify into EVENTRA's controlled taxonomy strictly based on evidence
            classification = ProviderClassifier.classify(
                name=norm_p.name,
                raw_category=norm_p.raw_category or norm_p.category,
                description=norm_p.description,
                city=norm_p.city,
                website=norm_p.website,
            )

            # Preserve raw category from discovery source and set evidence-based controlled category
            norm_p.raw_category = norm_p.raw_category or norm_p.category
            norm_p.category = classification.category
            norm_p.capabilities = classification.capabilities
            norm_p.classification_confidence = classification.confidence
            norm_p.classification_reason = classification.reason

            # STRICT CLASSIFICATION RULE:
            # Requested category is a filter/intent, NEVER evidence.
            # If the provider does not match the requested category, strictly exclude it.
            if category != "OTHER" and norm_p.category != category:
                continue

            vendor, is_new = deduplicator.upsert_provider(norm_p, commit=False)

            # Set assignment status
            vendor.is_assigned = (vendor.id in assigned_vendor_ids)

            # Calculate distance from request coordinates if provided
            if (
                request.latitude is not None
                and request.longitude is not None
                and vendor.latitude is not None
                and vendor.longitude is not None
            ):
                vendor.distance_km = haversine_distance_km(
                    request.latitude, request.longitude, vendor.latitude, vendor.longitude
                )
            else:
                vendor.distance_km = None

            # Apply radius filtering if specified
            if request.radius_km is not None and vendor.distance_km is not None:
                if vendor.distance_km > request.radius_km:
                    continue  # Filter out providers outside requested radius

            saved_vendors.append(vendor)
            if is_new:
                created_count += 1
            else:
                updated_count += 1

        # Single batch commit for all upserted providers (prevents remote DB latency bottleneck)
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()

        # Sort by distance if available (closest first)
        saved_vendors.sort(
            key=lambda v: getattr(v, "distance_km", None) if getattr(v, "distance_km", None) is not None else 99999.0
        )

        return saved_vendors, created_count, updated_count, source_label, keywords

    def discover_providers_for_event(
        self,
        event_id: str,
        request: ProviderDiscoveryRequest,
    ) -> Tuple[List[Vendor], int, int, str, List[str], Optional[Tuple[float, float]], Optional[str], str]:
        """Context-aware provider discovery using the event's venue, location, and requirement.

        Supports:
        - Natural language search parsing ("photographers near venue", "wedding caterers within 10km")
        - 3-tier Location Resolution:
            1. REGION / Explicit Location: geocoded via existing adapter to obtain coordinates
            2. NEAR_ME: browser/user GPS coordinates
            3. NEAR_EVENT (Default): event venue coordinates or geocoded event location
        - Deterministic Haversine distance calculation and radius filtering
        - Real source rating and review counts
        - Event assignment status
        """
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise ValueError(f"Event with id '{event_id}' not found")

        from app.integrations.google_maps_scraper.queries import parse_discovery_query
        from app.services.geospatial_service import geospatial_discovery

        # 1. Natural Language Query Parsing
        parsed = {}
        if request.query and request.query.strip():
            parsed = parse_discovery_query(request.query)

        category = (request.category or parsed.get("category") or "OTHER").strip().upper()
        radius_km = request.radius_km or parsed.get("radius_km")
        parsed_anchor = parsed.get("anchor_mode")
        custom_loc = request.location or parsed.get("location")
        clean_query = parsed.get("clean_query") if parsed.get("clean_query") else request.query

        # Determine anchor mode (explicit REGION takes precedence if custom_loc provided)
        if custom_loc and (not request.anchor_mode or request.anchor_mode == "NEAR_EVENT" or parsed_anchor == "REGION"):
            anchor_mode = "REGION"
        else:
            anchor_mode = (request.anchor_mode or parsed_anchor or "NEAR_EVENT").strip().upper()

        # 2. Location Anchor Resolution
        anchor_lat: Optional[float] = None
        anchor_lon: Optional[float] = None
        anchor_label: Optional[str] = None
        search_city: str = "Seattle"

        if (anchor_mode == "REGION" or custom_loc) and custom_loc:
            # Explicit location takes top priority: geocode via existing geocoding adapter
            search_city = geospatial_discovery.clean_city_name(custom_loc)
            anchor_lat, anchor_lon = geospatial_discovery.resolve_city_center(search_city)
            anchor_label = search_city

        elif anchor_mode == "NEAR_ME" and request.latitude is not None and request.longitude is not None:
            # Device/Browser coordinates
            anchor_lat = request.latitude
            anchor_lon = request.longitude
            anchor_label = "Your Location"
            base_loc = getattr(event, "location", "Seattle") or "Seattle"
            search_city = geospatial_discovery.clean_city_name(base_loc)

        else:
            # Default / NEAR_EVENT: Event Venue coordinates or Event Location
            venue = None
            if getattr(event, "venue_id", None):
                venue = self.db.query(Venue).filter(Venue.id == event.venue_id).first()

            if venue and venue.latitude is not None and venue.longitude is not None:
                anchor_lat = venue.latitude
                anchor_lon = venue.longitude
                anchor_label = f"Venue: {venue.name}"
                search_city = venue.city or "Seattle"
            elif getattr(event, "location", None):
                search_city = geospatial_discovery.clean_city_name(event.location)
                anchor_lat, anchor_lon = geospatial_discovery.resolve_city_center(search_city)
                anchor_label = event.location
            elif request.latitude is not None and request.longitude is not None:
                anchor_lat = request.latitude
                anchor_lon = request.longitude
                anchor_label = "Event Location"
                search_city = "Seattle"
            else:
                search_city = "Seattle"
                anchor_lat, anchor_lon = geospatial_discovery.resolve_city_center("Seattle")
                anchor_label = "Seattle, WA"

        search_city = geospatial_discovery.clean_city_name(search_city)

        enriched_request = ProviderDiscoveryRequest(
            category=category,
            query=clean_query,
            location=search_city,
            latitude=anchor_lat,
            longitude=anchor_lon,
            radius_km=radius_km,
            anchor_mode=anchor_mode,
            limit=request.limit,
            use_real_scraper=request.use_real_scraper,
        )

        vendors, created, updated, source, queries = self.discover_providers(enriched_request, event_id=event_id)

        # 3. Post-Process Distance Calculation, Radius Filtering & Assignment Status
        assigned_vendor_ids = {a.vendor_id for a in self.get_assignments_for_event(event_id)}

        processed_vendors: List[Vendor] = []
        for v in vendors:
            v.is_assigned = (v.id in assigned_vendor_ids)

            if anchor_lat is not None and anchor_lon is not None and v.latitude is not None and v.longitude is not None:
                v.distance_km = haversine_distance_km(anchor_lat, anchor_lon, v.latitude, v.longitude)
            else:
                v.distance_km = None

            if radius_km is not None and v.distance_km is not None:
                if v.distance_km > radius_km:
                    continue

            processed_vendors.append(v)

        processed_vendors.sort(
            key=lambda item: getattr(item, "distance_km", None) if getattr(item, "distance_km", None) is not None else 99999.0
        )

        anchor_coords = (anchor_lat, anchor_lon) if (anchor_lat is not None and anchor_lon is not None) else None
        return processed_vendors, created, updated, source, queries, anchor_coords, anchor_label, anchor_mode

    def qualify_vendor_deterministically(
        self,
        vendor: Vendor,
        required_category: Optional[str] = None,
        hard_requirements: Optional[List[str]] = None,
        preferences: Optional[List[str]] = None,
        guest_count: Optional[int] = None,
        max_budget: Optional[float] = None,
        max_distance_km: Optional[float] = None,
        event_date: Optional[datetime] = None,
        distance_km: Optional[float] = None,
        location: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Deterministically evaluates provider attributes against hard requirements and preferences.

        STRICT GUARDRAILS:
        - NEVER fabricates live availability, custom prices, capacities, or confirmations.
        - Missing or unconfirmed fields are explicitly marked UNKNOWN.
        - Hard requirement failures trigger DISQUALIFIED.
        - Preference mismatches NEVER disqualify candidates, only informing comparison & ranking.
        """
        import re
        from datetime import timedelta

        # 1. Category Check
        category_match = True
        if required_category:
            req_cat = required_category.strip().upper()
            v_cat = (vendor.category or "").strip().upper()
            v_raw = (vendor.raw_category or "").strip().upper()
            category_match = (v_cat == req_cat or v_raw == req_cat or req_cat in v_cat or v_cat in req_cat or req_cat in v_raw or v_raw in req_cat)

        # 2. Budget Check (authoritative base_cost only)
        budget_pass = True
        budget_status = "PASS"
        if max_budget is not None:
            if vendor.base_cost is not None:
                budget_pass = (vendor.base_cost <= max_budget)
                budget_status = "PASS" if budget_pass else "FAIL"
                budget_note = (
                    f"Base cost {vendor.base_cost} <= max budget {max_budget}"
                    if budget_pass
                    else f"Base cost {vendor.base_cost} exceeds max budget {max_budget}"
                )
            else:
                budget_pass = True  # Unknown cost does not disqualify, marked UNKNOWN
                budget_status = "UNKNOWN"
                budget_note = "Base cost unknown in database; quote must be confirmed directly"
        else:
            budget_note = "No budget ceiling specified"

        # 3. Distance Check
        dist_val = distance_km if distance_km is not None else getattr(vendor, "distance_km", None)
        distance_pass = True
        dist_status = "PASS"
        if max_distance_km is not None and dist_val is not None:
            distance_pass = (dist_val <= max_distance_km)
            dist_status = "PASS" if distance_pass else "FAIL"
            dist_note = (
                f"Distance {dist_val:.1f} km <= max radius {max_distance_km} km"
                if distance_pass
                else f"Distance {dist_val:.1f} km exceeds radius {max_distance_km} km"
            )
        elif max_distance_km is not None and dist_val is None:
            dist_status = "UNKNOWN"
            dist_note = "Distance cannot be calculated without GPS coordinates"
        else:
            dist_note = "No radius constraint specified" if dist_val is None else f"Distance: {dist_val:.1f} km"

        # Location text check (e.g. city match)
        loc_pass = True
        loc_status = "PASS"
        if location and vendor.city:
            loc_clean = location.strip().lower()
            city_clean = vendor.city.strip().lower()
            if loc_clean in city_clean or city_clean in loc_clean:
                loc_pass = True
                loc_status = "PASS"
            else:
                loc_pass = False
                loc_status = "FAIL"
        elif location and not vendor.city:
            loc_status = "UNKNOWN"

        # 4. Capacity Check
        capacity_status = "UNKNOWN"
        capacity_note = "Guest capacity not recorded in directory; must be confirmed with provider"
        capacity_pass = True
        if guest_count is not None:
            text_corpus = " ".join([
                getattr(vendor, "service_description", "") or "",
                " ".join(vendor.capabilities or []),
            ]).lower()
            cap_match = re.search(r'(?:capacity|guests?|pax|max_guests)[\s:=_-]*(\d+)', text_corpus)
            if cap_match:
                try:
                    detected_cap = int(cap_match.group(1))
                    if detected_cap >= guest_count:
                        capacity_pass = True
                        capacity_status = "PASS"
                        capacity_note = f"Verified capacity {detected_cap} >= required guests {guest_count}"
                    else:
                        capacity_pass = False
                        capacity_status = "FAIL"
                        capacity_note = f"Verified capacity {detected_cap} < required guests {guest_count}"
                except ValueError:
                    pass
        else:
            capacity_status = "PASS"
            capacity_note = "No guest count constraint specified"

        # 5. Availability Check (evaluated against recorded calendar slots ONLY)
        availability_status = "UNKNOWN"
        availability_note = "Real-time availability is UNKNOWN; EVENTRA does not fabricate live availability"
        availability_pass = True
        if event_date is not None:
            start_dt = event_date
            end_dt = start_dt + timedelta(hours=8)
            try:
                avail_res = self.check_provider_availability(vendor.id, start_dt, end_dt)
                if not avail_res.is_available:
                    availability_pass = False
                    availability_status = "FAIL"
                    availability_note = f"Calendar slot conflict: {avail_res.reason or 'Booked/Blocked slot'}"
                elif len(avail_res.conflicts) == 0:
                    availability_pass = True
                    availability_status = "PASS"
                    availability_note = "No database calendar conflicts for requested date"
                else:
                    availability_status = "UNKNOWN"
                    availability_note = "Calendar record unverified for requested date"
            except Exception:
                availability_status = "UNKNOWN"

        # 6. Hard Requirements Matching
        hard_requirement_results: Dict[str, str] = {}
        hard_reqs_passed: List[str] = []
        hard_reqs_failed: List[str] = []
        vendor_caps_lower = [c.lower() for c in (vendor.capabilities or [])]
        vendor_desc_lower = (vendor.service_description or "").lower()
        vendor_name_lower = (vendor.name or "").lower()

        for req in (hard_requirements or []):
            req_str = req.strip()
            req_lower = req_str.lower()
            matched = False

            # Check exact or token match in capabilities
            for cap in vendor_caps_lower:
                if req_lower == cap or req_lower in cap.split("_") or req_lower in cap.split(" "):
                    matched = True
                    break

            if not matched:
                full_text = f"{vendor_name_lower} {vendor_desc_lower}"
                if req_lower in ("vegetarian", "veg"):
                    # Avoid matching inside "non-vegetarian", "non vegetarian", "non-veg"
                    cleaned = re.sub(r'\bnon[- ]?veg(?:etarian)?\b', '', full_text)
                    matched = bool(re.search(r'\bveg(?:etarian)?\b', cleaned))
                elif req_lower in ("non-vegetarian", "non_vegetarian", "non-veg"):
                    matched = bool(re.search(r'\bnon[- ]?veg(?:etarian)?\b', full_text))
                else:
                    matched = bool(re.search(rf'\b{re.escape(req_lower)}\b', full_text))

            if matched:
                hard_requirement_results[req_str] = "PASS"
                hard_reqs_passed.append(req_str)
            else:
                hard_requirement_results[req_str] = "FAIL"
                hard_reqs_failed.append(req_str)

        # 7. Preferences Matching (Soft criteria — never disqualifies)
        preference_results: Dict[str, str] = {}
        prefs_matched: List[str] = []
        prefs_unmatched: List[str] = []

        for pref in (preferences or []):
            pref_str = pref.strip()
            pref_lower = pref_str.lower()
            matched = False
            if "rating" in pref_lower or "rated" in pref_lower or "star" in pref_lower:
                if vendor.rating is not None and vendor.rating >= 4.0:
                    matched = True
            elif "review" in pref_lower or "established" in pref_lower:
                if vendor.review_count is not None and vendor.review_count >= 10:
                    matched = True
            else:
                for cap in vendor_caps_lower:
                    if pref_lower == cap or pref_lower in cap.split("_") or pref_lower in cap.split(" "):
                        matched = True
                        break
                if not matched:
                    full_text = f"{vendor_name_lower} {vendor_desc_lower}"
                    matched = bool(re.search(rf'\b{re.escape(pref_lower)}\b', full_text))

            if matched:
                preference_results[pref_str] = "PASS"
                prefs_matched.append(pref_str)
            else:
                preference_results[pref_str] = "UNMATCHED"
                prefs_unmatched.append(pref_str)

        # 8. Composite Qualification Status
        has_hard_fail = (
            not category_match
            or budget_status == "FAIL"
            or dist_status == "FAIL"
            or loc_status == "FAIL"
            or capacity_status == "FAIL"
            or availability_status == "FAIL"
            or len(hard_reqs_failed) > 0
        )

        if has_hard_fail:
            status = "DISQUALIFIED"
            is_qualified = False
        else:
            status = "QUALIFIED"
            is_qualified = True

        # 9. Truthful Unknown Facts Tracking
        unknown_facts: List[str] = [
            "live_availability_for_event_dates",
            "exact_per_plate_or_package_quote",
            "staffing_and_equipment_limits",
            "deposit_and_cancellation_terms",
        ]
        if capacity_status == "UNKNOWN":
            unknown_facts.append("guest_capacity_ceiling")
        if budget_status == "UNKNOWN":
            unknown_facts.append("binding_base_cost")
        if dist_status == "UNKNOWN":
            unknown_facts.append("exact_transit_distance")

        # 10. Summary construction
        summary_parts = []
        summary_parts.append(f"Category: {'MATCH' if category_match else 'MISMATCH'}")
        summary_parts.append(f"Budget: {budget_note}")
        summary_parts.append(f"Distance: {dist_note}")
        if hard_reqs_passed:
            summary_parts.append(f"Passed requirements: {', '.join(hard_reqs_passed)}")
        if hard_reqs_failed:
            summary_parts.append(f"Failed requirements: {', '.join(hard_reqs_failed)}")
        if prefs_matched:
            summary_parts.append(f"Matched preferences: {', '.join(prefs_matched)}")
        if capacity_status != "PASS":
            summary_parts.append(f"Capacity: {capacity_status}")

        return {
            "provider_id": vendor.id,
            "name": vendor.name,
            "is_qualified": is_qualified,
            "status": status,
            "category_match": category_match,
            "budget_check": {
                "passed": budget_pass,
                "status": budget_status,
                "note": budget_note,
                "base_cost": vendor.base_cost,
                "max_budget": max_budget,
            },
            "distance_check": {
                "passed": distance_pass,
                "status": dist_status,
                "note": dist_note,
                "distance_km": dist_val,
                "max_distance_km": max_distance_km,
            },
            "capability_match": {
                "matched": hard_reqs_passed,
                "missing": hard_reqs_failed,
            },
            "capacity_check": {
                "passed": capacity_pass,
                "status": capacity_status,
                "note": capacity_note,
                "guest_count": guest_count,
            },
            "availability_check": {
                "passed": availability_pass,
                "status": availability_status,
                "note": availability_note,
            },
            "hard_requirement_results": hard_requirement_results,
            "preference_results": preference_results,
            "hard_requirements_passed": hard_reqs_passed,
            "hard_requirements_failed": hard_reqs_failed,
            "preferences_matched": prefs_matched,
            "known_facts": {
                "name": vendor.name,
                "category": vendor.category,
                "status": vendor.status,
                "base_cost": vendor.base_cost,
                "rating": vendor.rating,
                "review_count": vendor.review_count,
                "city": vendor.city,
                "capabilities": vendor.capabilities or [],
                "source": vendor.source,
            },
            "unknown_facts": unknown_facts,
            "qualification_summary": " | ".join(summary_parts),
        }

    def compare_candidates_deterministically(
        self,
        vendors: List[Vendor],
        hard_requirements: Optional[List[str]] = None,
        preferences: Optional[List[str]] = None,
        guest_count: Optional[int] = None,
        max_budget: Optional[float] = None,
        max_distance_km: Optional[float] = None,
        required_category: Optional[str] = None,
        shortlist_limit: int = 5,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], str]:
        """Deterministically compares candidate providers and ranks them using transparent objective criteria.

        Strict Ranking Order:
        1. Qualification Status: QUALIFIED > INSUFFICIENT_INFORMATION > DISQUALIFIED
        2. Preference Matches Count: Descending
        3. Rating: Descending (Nulls last)
        4. Review Count: Descending (Nulls last)
        5. Base Cost: Ascending (Nulls last)
        6. Distance: Ascending (Nulls last)
        7. Stable Tie-breaker: Name ASC, ID ASC
        """
        matrix = []
        for v in vendors:
            eval_res = self.qualify_vendor_deterministically(
                vendor=v,
                required_category=required_category or v.category,
                hard_requirements=hard_requirements,
                preferences=preferences,
                guest_count=guest_count,
                max_budget=max_budget,
                max_distance_km=max_distance_km,
            )

            req_matches = list(eval_res["hard_requirements_passed"])
            if v.rating and v.rating >= 4.0:
                req_matches.append(f"High customer rating ({v.rating:.1f}/5.0)")
            if v.review_count and v.review_count >= 10:
                req_matches.append(f"Established review track record ({v.review_count} reviews)")

            req_mismatches = list(eval_res["hard_requirements_failed"])
            if not v.base_cost:
                req_mismatches.append("Base cost not provided in record")

            known_constraints = []
            if v.base_cost:
                known_constraints.append(f"Starting cost: {v.base_cost}")
            dist_km = getattr(v, "distance_km", None)
            if dist_km is not None:
                known_constraints.append(f"Distance: {dist_km:.1f} km")

            entry = {
                "provider_id": v.id,
                "name": v.name,
                "category": v.category,
                "base_cost": v.base_cost,
                "rating": v.rating,
                "review_count": v.review_count,
                "distance_km": dist_km,
                "capabilities": v.capabilities or [],
                "qualification_status": eval_res["status"],
                "requirement_matches": req_matches,
                "requirement_mismatches": req_mismatches,
                "preferences_matched": eval_res["preferences_matched"],
                "known_constraints": known_constraints,
                "unknown_fields": eval_res["unknown_facts"][:4],
                "is_shortlisted": False,
            }
            matrix.append(entry)

        # Deterministic sorting
        def sort_key(item):
            status_priority = 0 if item["qualification_status"] == "QUALIFIED" else (1 if item["qualification_status"] == "INSUFFICIENT_INFORMATION" else 2)
            pref_count = -len(item["preferences_matched"])
            rating_val = -(item["rating"] if item["rating"] is not None else -1.0)
            rev_val = -(item["review_count"] if item["review_count"] is not None else -1)
            cost_val = item["base_cost"] if item["base_cost"] is not None else 9999999.0
            dist_val = item["distance_km"] if item["distance_km"] is not None else 99999.0
            return (status_priority, pref_count, rating_val, rev_val, cost_val, dist_val, item["name"], item["provider_id"])

        matrix.sort(key=sort_key)

        # Build shortlist: strictly exclude DISQUALIFIED providers
        shortlist = []
        for item in matrix:
            if item["qualification_status"] != "DISQUALIFIED":
                item["is_shortlisted"] = True
                shortlist.append(item)
                if len(shortlist) >= shortlist_limit:
                    break

        qualified_count = sum(1 for m in matrix if m["qualification_status"] == "QUALIFIED")
        disqualified_count = sum(1 for m in matrix if m["qualification_status"] == "DISQUALIFIED")

        names_summary = ", ".join(f"{m['name']} ({m['qualification_status']}, Rating: {m['rating'] or 'N/A'})" for m in matrix)
        deterministic_summary = (
            f"Compared {len(matrix)} provider candidates ({qualified_count} qualified, {disqualified_count} disqualified). "
            f"Shortlisted top {len(shortlist)} using deterministic criteria (no disqualified candidates, ranked by requirements, rating, and cost): {names_summary}"
        )

        return matrix, shortlist, deterministic_summary

    def generate_deterministic_shortlist(
        self,
        event_id: str,
        task_id: Optional[str] = None,
        category: Optional[str] = None,
        location: Optional[str] = None,
        guest_count: Optional[int] = None,
        hard_requirements: Optional[List[str]] = None,
        preferences: Optional[List[str]] = None,
        max_budget: Optional[float] = None,
        radius_km: Optional[float] = None,
        limit: int = 5,
        search_query: Optional[str] = None,
    ) -> Tuple[List[Vendor], List[Dict[str, Any]], int, str]:
        """Orchestrates end-to-end task-aware deterministic vendor discovery, qualification, and shortlisting.

        Returns: (all_candidate_vendors, shortlisted_entries, disqualified_count, deterministic_rationale)
        """
        from app.models.task import Task
        from app.models.requirement import Requirement
        from app.models.event import Event

        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise ValueError(f"Event with id '{event_id}' not found")

        resolved_category = category
        resolved_budget = max_budget
        resolved_location = location or getattr(event, "location", None) or "Delhi"
        resolved_guest_count = guest_count or getattr(event, "guest_count", None)

        hard_reqs = list(hard_requirements or [])
        soft_prefs = list(preferences or [])

        # 1. Task-Aware Context Resolution
        if task_id:
            task = self.db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
            if task:
                if not resolved_category and task.required_provider_category:
                    resolved_category = task.required_provider_category
                # Parse task title/description for domain requirement cues
                task_text = f"{task.name} {task.description or ''}".lower()
                if "vegetarian" in task_text and "vegetarian" not in [r.lower() for r in hard_reqs]:
                    hard_reqs.append("vegetarian")

        # 2. Event Requirement Records Resolution
        db_requirements = self.db.query(Requirement).filter(Requirement.event_id == event_id).all()
        for r in db_requirements:
            is_relevant = True
            if resolved_category and r.type and r.type != "GENERAL":
                is_relevant = (resolved_category.lower() in r.type.lower() or r.type.lower() in resolved_category.lower())

            if is_relevant:
                req_text = r.name
                if r.required:
                    if req_text not in hard_reqs:
                        hard_reqs.append(req_text)
                else:
                    if req_text not in soft_prefs:
                        soft_prefs.append(req_text)

        # 3. Retrieve Candidate Vendors (merging database records with discovery)
        clean_cat = resolved_category.strip().upper() if resolved_category else None

        # Fetch authoritative database records matching category/city
        local_db_vendors, _ = self.search_vendors(category=clean_cat, city=resolved_location, limit=max(limit * 3, 50))
        if not local_db_vendors and clean_cat:
            local_db_vendors, _ = self.search_vendors(category=clean_cat, limit=max(limit * 3, 50))

        disc_req = ProviderDiscoveryRequest(
            category=clean_cat,
            location=resolved_location,
            query=search_query,
            radius_km=radius_km,
            limit=max(limit * 3, 20),
            use_real_scraper=False,
        )

        try:
            discovered, created, updated, source, queries, anchor_coords, anchor_label, anchor_mode = (
                self.discover_providers_for_event(event_id, disc_req)
            )
        except Exception:
            discovered = []

        # Merge local DB records with discovered records, prioritizing local DB entries
        vendors_dict = {v.id: v for v in local_db_vendors}
        for v in discovered:
            if v.id not in vendors_dict:
                vendors_dict[v.id] = v

        vendors = list(vendors_dict.values())

        # 4. Deterministic Qualification & Shortlisting
        matrix, shortlist, summary = self.compare_candidates_deterministically(
            vendors=vendors,
            hard_requirements=hard_reqs,
            preferences=soft_prefs,
            guest_count=resolved_guest_count,
            max_budget=resolved_budget,
            max_distance_km=radius_km,
            required_category=clean_cat,
            shortlist_limit=limit,
        )

        disqualified_count = sum(1 for m in matrix if m["qualification_status"] == "DISQUALIFIED")
        return vendors, shortlist, disqualified_count, summary

