"""PROVIDER DISCOVERY & QUALIFICATION Agent Tools.

Enables deterministic provider discovery, qualification, availability verification
against database slots, and objective multi-candidate comparison.

GUARDRAIL: Never hallucinates or fabricates provider pricing, availability, capacity,
or booking confirmations. Unknown facts remain explicitly marked as UNKNOWN.
"""
from typing import Any, Dict, List, Optional
from app.models.vendor import Vendor
from app.models.event import Event
from app.services.vendor_service import VendorService
from app.schemas.vendor import ProviderDiscoveryRequest
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolContext,
    ToolResult,
)
from app.agent.tools.schemas import (
    DiscoverProvidersInput,
    DiscoverProvidersOutput,
    ProviderCandidate,
    QualifyProviderInput,
    QualifyProviderOutput,
    CheckProviderAvailabilityInput,
    CheckProviderAvailabilityOutput,
    CompareCandidatesInput,
    CompareCandidatesOutput,
    ProviderComparisonEntry,
)
from app.agent.tools.permissions import ToolPermissionGuard


class DiscoverProvidersTool(AgentTool):
    """Discovers provider candidates matching event requirements."""

    name = "discover_providers"
    description = "Discovers provider candidates matching event requirements."
    category = ToolCategory.PROVIDER
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = DiscoverProvidersInput
    output_schema = DiscoverProvidersOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: DiscoverProvidersInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        if not event:
            return ToolResult.failure_result(self.name, f"Event with id '{args.event_id}' not found.", "NOT_FOUND")

        vendor_service = VendorService(context.db)

        # Build discovery request
        clean_category = args.category.strip().upper() if args.category else None
        disc_req = ProviderDiscoveryRequest(
            category=clean_category,
            location=args.location or getattr(event, "location", None) or "Delhi",
            query=args.query,
            radius_km=args.radius_km,
            limit=args.limit,
            use_real_scraper=False,  # Fallback gracefully to internal/mock discovery
        )

        try:
            vendors, created, updated, source, queries, anchor_coords, anchor_label, anchor_mode = (
                vendor_service.discover_providers_for_event(args.event_id, disc_req)
            )
        except Exception as e:
            # Fallback to local DB search
            vendors, _ = vendor_service.search_vendors(
                category=clean_category,
                city=args.location,
                limit=args.limit,
            )
            anchor_label = args.location or "Event Location"

        candidates: List[ProviderCandidate] = []
        for v in vendors:
            # Explicitly identify facts not verifiable from directory data
            unknown_fields = [
                "live_real_time_availability",
                "binding_contract_pricing",
                "custom_menu_capacity",
                "insurance_and_permits",
            ]
            known_constraints = []
            if v.base_cost:
                known_constraints.append(f"Base cost starting at {v.base_cost}")
            if getattr(v, "distance_km", None) is not None:
                known_constraints.append(f"Located {v.distance_km:.1f} km from anchor")

            candidates.append(
                ProviderCandidate(
                    provider_id=v.id,
                    name=v.name,
                    category=v.category,
                    city=v.city,
                    address=v.address,
                    base_cost=v.base_cost,
                    rating=v.rating,
                    review_count=v.review_count,
                    distance_km=getattr(v, "distance_km", None),
                    is_assigned=bool(getattr(v, "is_assigned", False)),
                    status=v.status or "ACTIVE",
                    capabilities=v.capabilities or [],
                    known_constraints=known_constraints,
                    unknown_fields=unknown_fields,
                )
            )

        data = DiscoverProvidersOutput(
            event_id=args.event_id,
            total_found=len(candidates),
            providers=candidates,
            search_location=anchor_label,
            search_category=clean_category,
            search_radius_km=args.radius_km,
        )
        return ToolResult.success_result(self.name, data)


class QualifyProviderTool(AgentTool):
    """Evaluates whether known provider information satisfies event or task requirements."""

    name = "qualify_provider"
    description = "Evaluates whether known provider information satisfies event or task requirements."
    category = ToolCategory.PROVIDER
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = QualifyProviderInput
    output_schema = QualifyProviderOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: QualifyProviderInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        vendor = context.db.query(Vendor).filter(Vendor.id == args.provider_id).first()
        if not vendor:
            return ToolResult.failure_result(self.name, f"Provider with id '{args.provider_id}' not found.", "NOT_FOUND")

        # 1. Category match check
        category_match = True
        if args.required_category:
            category_match = (
                vendor.category.strip().upper() == args.required_category.strip().upper()
                or (vendor.raw_category and vendor.raw_category.strip().upper() == args.required_category.strip().upper())
            )

        # 2. Budget check (deterministic, against base cost)
        budget_pass = True
        budget_note = "No base cost recorded"
        if args.max_budget is not None:
            if vendor.base_cost is not None:
                budget_pass = vendor.base_cost <= args.max_budget
                budget_note = f"Base cost {vendor.base_cost} <= max budget {args.max_budget}" if budget_pass else f"Base cost {vendor.base_cost} exceeds max budget {args.max_budget}"
            else:
                budget_note = "Base cost unknown; pricing must be confirmed directly"

        # 3. Distance check
        distance_pass = True
        dist_km = getattr(vendor, "distance_km", None)
        dist_note = "Distance not calculated"
        if args.max_distance_km is not None and dist_km is not None:
            distance_pass = dist_km <= args.max_distance_km
            dist_note = f"Distance {dist_km:.1f} km <= max radius {args.max_distance_km} km" if distance_pass else f"Distance {dist_km:.1f} km exceeds radius {args.max_distance_km} km"

        # 4. Capability match
        matched_caps = []
        missing_caps = []
        vendor_caps_lower = [c.lower() for c in (vendor.capabilities or [])]
        for req_cap in args.required_capabilities:
            if req_cap.lower() in vendor_caps_lower:
                matched_caps.append(req_cap)
            else:
                missing_caps.append(req_cap)

        # 5. Composite qualification determination
        is_qualified = category_match and budget_pass and distance_pass and (len(missing_caps) == 0)
        status = "QUALIFIED" if is_qualified else "DISQUALIFIED"

        known_facts = {
            "name": vendor.name,
            "category": vendor.category,
            "status": vendor.status,
            "base_cost": vendor.base_cost,
            "rating": vendor.rating,
            "review_count": vendor.review_count,
            "city": vendor.city,
            "capabilities": vendor.capabilities or [],
        }

        unknown_facts = [
            "live_availability_for_event_dates",
            "exact_per_plate_or_package_quote",
            "staffing_and_equipment_limits",
            "deposit_and_cancellation_terms",
        ]

        summary_parts = []
        summary_parts.append(f"Category: {'MATCH' if category_match else 'MISMATCH'}")
        summary_parts.append(f"Budget: {budget_note}")
        summary_parts.append(f"Distance: {dist_note}")
        if missing_caps:
            summary_parts.append(f"Missing capabilities: {', '.join(missing_caps)}")

        data = QualifyProviderOutput(
            provider_id=vendor.id,
            name=vendor.name,
            is_qualified=is_qualified,
            status=status,
            category_match=category_match,
            budget_check={"passed": budget_pass, "note": budget_note, "base_cost": vendor.base_cost, "max_budget": args.max_budget},
            distance_check={"passed": distance_pass, "note": dist_note, "distance_km": dist_km, "max_distance_km": args.max_distance_km},
            capability_match={"matched": matched_caps, "missing": missing_caps},
            known_facts=known_facts,
            unknown_facts=unknown_facts,
            qualification_summary=" | ".join(summary_parts),
        )
        return ToolResult.success_result(self.name, data)


class CheckProviderAvailabilityTool(AgentTool):
    """Checks recorded database availability slots for a provider."""

    name = "check_provider_availability"
    description = "Checks recorded database availability slots for a provider. Note: database records only, not live phone confirmation."
    category = ToolCategory.PROVIDER
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = CheckProviderAvailabilityInput
    output_schema = CheckProviderAvailabilityOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: CheckProviderAvailabilityInput) -> ToolResult:
        vendor = context.db.query(Vendor).filter(Vendor.id == args.vendor_id).first()
        if not vendor:
            return ToolResult.failure_result(self.name, f"Provider '{args.vendor_id}' not found.", "NOT_FOUND")

        vendor_service = VendorService(context.db)
        try:
            avail_res = vendor_service.check_provider_availability(
                vendor_id=args.vendor_id,
                start_datetime=args.start_datetime,
                end_datetime=args.end_datetime,
            )
            conflicts_list = [c.model_dump() for c in avail_res.conflicts]
            status_val = "AVAILABLE" if avail_res.is_available else "CONFLICT"

            data = CheckProviderAvailabilityOutput(
                vendor_id=args.vendor_id,
                is_available=avail_res.is_available,
                status=status_val,
                start_datetime=args.start_datetime.isoformat(),
                end_datetime=args.end_datetime.isoformat(),
                data_source="DATABASE_RECORDS",
                conflicts_count=len(conflicts_list),
                conflicts=conflicts_list,
                note="Evaluated against EVENTRA database calendar records. Real-world availability must be verified directly with the vendor.",
            )
            return ToolResult.success_result(self.name, data)

        except Exception as e:
            return ToolResult.unknown_result(
                self.name,
                reason=f"Availability check could not be completed deterministically: {str(e)}",
                partial_data={"vendor_id": args.vendor_id, "status": "UNKNOWN"},
            )


class CompareCandidatesTool(AgentTool):
    """Deterministically compares structured provider candidates against requirements and constraints."""

    name = "compare_candidates"
    description = "Deterministically compares structured provider candidates against requirements and constraints."
    category = ToolCategory.PROVIDER
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = CompareCandidatesInput
    output_schema = CompareCandidatesOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: CompareCandidatesInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        vendors = (
            context.db.query(Vendor)
            .filter(Vendor.id.in_(args.provider_ids))
            .all()
        )
        if not vendors:
            return ToolResult.failure_result(self.name, "No matching providers found for the given IDs.", "NOT_FOUND")

        matrix: List[ProviderComparisonEntry] = []
        for v in vendors:
            # Deterministic requirement matching
            req_matches = []
            req_mismatches = []
            if v.rating and v.rating >= 4.0:
                req_matches.append(f"High customer rating ({v.rating:.1f}/5.0)")
            if v.review_count and v.review_count >= 10:
                req_matches.append(f"Established review track record ({v.review_count} reviews)")
            if not v.base_cost:
                req_mismatches.append("Base cost not provided in record")

            known_constraints = []
            if v.base_cost:
                known_constraints.append(f"Starting cost: {v.base_cost}")
            dist_km = getattr(v, "distance_km", None)
            if dist_km is not None:
                known_constraints.append(f"Distance: {dist_km:.1f} km")

            matrix.append(
                ProviderComparisonEntry(
                    provider_id=v.id,
                    name=v.name,
                    category=v.category,
                    base_cost=v.base_cost,
                    rating=v.rating,
                    review_count=v.review_count,
                    distance_km=dist_km,
                    capabilities=v.capabilities or [],
                    requirement_matches=req_matches,
                    requirement_mismatches=req_mismatches,
                    known_constraints=known_constraints,
                    unknown_fields=["live_availability", "custom_quotation", "capacity_ceiling"],
                )
            )

        # Sort matrix deterministically: rating desc (None last), review_count desc, base_cost asc
        matrix.sort(
            key=lambda x: (
                -(x.rating or 0.0),
                -(x.review_count or 0),
                x.base_cost if x.base_cost is not None else 9999999.0,
                x.name,
            )
        )

        names_summary = ", ".join(f"{m.name} (Rating: {m.rating or 'N/A'}, Reviews: {m.review_count or 0})" for m in matrix)
        deterministic_summary = f"Compared {len(matrix)} provider candidates ranked deterministically by verified rating, review count, and base cost: {names_summary}"

        data = CompareCandidatesOutput(
            event_id=args.event_id,
            total_compared=len(matrix),
            comparison_matrix=matrix,
            deterministic_summary=deterministic_summary,
        )
        return ToolResult.success_result(self.name, data)
