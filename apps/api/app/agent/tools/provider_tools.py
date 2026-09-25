"""PROVIDER DISCOVERY & QUALIFICATION Agent Tools.

Enables deterministic provider discovery, qualification, availability verification
against database slots, objective multi-candidate comparison, and deterministic shortlisting.

GUARDRAIL: Never hallucinates or fabricates provider pricing, availability, capacity,
or booking confirmations. Unknown facts remain explicitly marked as UNKNOWN.
"""
from typing import Any, Dict, List, Optional
from datetime import datetime
from app.models.vendor import Vendor
from app.models.event import Event
from app.models.task import Task
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
    ShortlistVendorsInput,
    ShortlistVendorsOutput,
)
from app.agent.tools.permissions import ToolPermissionGuard


class DiscoverProvidersTool(AgentTool):
    """Discovers provider candidates matching event/task requirements and produces a deterministic shortlist."""

    name = "discover_providers"
    description = "Discovers provider candidates matching event/task requirements and produces a deterministic shortlist."
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

        # 1. Resolve task context if task_id is specified
        resolved_category = args.category
        hard_reqs = list(args.requirements or [])
        soft_prefs = list(args.preferences or [])
        resolved_budget = args.max_budget

        if args.task_id:
            task = context.db.query(Task).filter(Task.id == args.task_id, Task.event_id == args.event_id).first()
            if task:
                if not resolved_category and task.required_provider_category:
                    resolved_category = task.required_provider_category
                task_text = f"{task.name} {task.description or ''}".lower()
                if "vegetarian" in task_text and "vegetarian" not in [r.lower() for r in hard_reqs]:
                    hard_reqs.append("vegetarian")

        clean_category = resolved_category.strip().upper() if resolved_category else None

        # 2. Execute deterministic discovery and shortlisting
        try:
            vendors, shortlist_entries, disqualified_count, summary = vendor_service.generate_deterministic_shortlist(
                event_id=args.event_id,
                task_id=args.task_id,
                category=clean_category,
                location=args.location,
                guest_count=args.guest_count,
                hard_requirements=hard_reqs,
                preferences=soft_prefs,
                max_budget=resolved_budget,
                radius_km=args.radius_km,
                limit=args.shortlist_limit or 5,
                search_query=args.query,
            )
        except Exception as exc:
            return ToolResult.failure_result(
                self.name,
                f"Provider discovery service failed: {str(exc)}",
                "PROVIDER_DISCOVERY_FAILED",
            )

        # 3. Map candidates with transparent qualification details
        candidates: List[ProviderCandidate] = []
        shortlist_candidates: List[ProviderCandidate] = []
        shortlist_ids = {entry["provider_id"] for entry in shortlist_entries}

        for v in vendors:
            eval_res = vendor_service.qualify_vendor_deterministically(
                vendor=v,
                required_category=clean_category,
                hard_requirements=hard_reqs,
                preferences=soft_prefs,
                guest_count=args.guest_count or getattr(event, "guest_count", None),
                max_budget=resolved_budget,
                max_distance_km=args.radius_km,
            )

            known_constraints = []
            if v.base_cost:
                known_constraints.append(f"Base cost starting at {v.base_cost}")
            if getattr(v, "distance_km", None) is not None:
                known_constraints.append(f"Located {v.distance_km:.1f} km from anchor")

            cand = ProviderCandidate(
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
                unknown_fields=eval_res["unknown_facts"][:4],
                qualification_status=eval_res["status"],
                requirement_matches=eval_res["hard_requirements_passed"],
                requirement_failures=eval_res["hard_requirements_failed"],
                preference_matches=eval_res["preferences_matched"],
                shortlist_rationale=eval_res["qualification_summary"],
            )
            candidates.append(cand)
            if v.id in shortlist_ids:
                shortlist_candidates.append(cand)

        # Preserve deterministic ordering for the shortlist
        shortlist_candidates.sort(
            key=lambda c: (
                0 if c.qualification_status == "QUALIFIED" else 1,
                -len(c.preference_matches),
                -(c.rating if c.rating is not None else -1.0),
                -(c.review_count if c.review_count is not None else -1),
                c.base_cost if c.base_cost is not None else 9999999.0,
                c.name,
            )
        )

        data = DiscoverProvidersOutput(
            event_id=args.event_id,
            task_id=args.task_id,
            total_found=len(candidates),
            providers=candidates,
            shortlist=shortlist_candidates,
            total_shortlisted=len(shortlist_candidates),
            search_location=args.location or getattr(event, "location", "Delhi"),
            search_category=clean_category,
            search_radius_km=args.radius_km,
            deterministic_summary=summary,
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

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        required_category = args.required_category
        if not required_category and args.task_id:
            task = context.db.query(Task).filter(Task.id == args.task_id, Task.event_id == args.event_id).first()
            if task and task.required_provider_category:
                required_category = task.required_provider_category

        vendor_service = VendorService(context.db)
        eval_res = vendor_service.qualify_vendor_deterministically(
            vendor=vendor,
            required_category=required_category,
            hard_requirements=args.required_capabilities,
            preferences=args.preferences,
            guest_count=args.guest_count or (getattr(event, "guest_count", None) if event else None),
            max_budget=args.max_budget,
            max_distance_km=args.max_distance_km,
            event_date=args.event_date,
            location=getattr(event, "location", None) if event else None,
        )

        data = QualifyProviderOutput(
            provider_id=vendor.id,
            name=vendor.name,
            is_qualified=eval_res["is_qualified"],
            status=eval_res["status"],
            category_match=eval_res["category_match"],
            budget_check=eval_res["budget_check"],
            distance_check=eval_res["distance_check"],
            capability_match=eval_res["capability_match"],
            capacity_check=eval_res["capacity_check"],
            availability_check=eval_res["availability_check"],
            hard_requirement_results=eval_res["hard_requirement_results"],
            preference_results=eval_res["preference_results"],
            hard_requirements_passed=eval_res["hard_requirements_passed"],
            hard_requirements_failed=eval_res["hard_requirements_failed"],
            preferences_matched=eval_res["preferences_matched"],
            known_facts=eval_res["known_facts"],
            unknown_facts=eval_res["unknown_facts"],
            qualification_summary=eval_res["qualification_summary"],
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

        vendor_service = VendorService(context.db)
        matrix_raw, shortlist_raw, deterministic_summary = vendor_service.compare_candidates_deterministically(
            vendors=vendors,
            hard_requirements=args.hard_requirements,
            preferences=args.preferences,
            guest_count=args.guest_count,
            max_budget=args.max_budget,
            shortlist_limit=len(vendors),
        )

        matrix_entries = [ProviderComparisonEntry(**m) for m in matrix_raw]
        shortlist_entries = [ProviderComparisonEntry(**s) for s in shortlist_raw]

        data = CompareCandidatesOutput(
            event_id=args.event_id,
            total_compared=len(matrix_entries),
            comparison_matrix=matrix_entries,
            shortlist=shortlist_entries,
            deterministic_summary=deterministic_summary,
        )
        return ToolResult.success_result(self.name, data)


class ShortlistVendorsTool(AgentTool):
    """Generates an explainable deterministic shortlist of provider candidates for an event task."""

    name = "shortlist_vendors"
    description = "Generates an explainable deterministic shortlist of provider candidates for an event task."
    category = ToolCategory.PROVIDER
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = ShortlistVendorsInput
    output_schema = ShortlistVendorsOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: ShortlistVendorsInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        if not event:
            return ToolResult.failure_result(self.name, f"Event with id '{args.event_id}' not found.", "NOT_FOUND")

        vendor_service = VendorService(context.db)
        vendors, shortlist_entries, disqualified_count, summary = vendor_service.generate_deterministic_shortlist(
            event_id=args.event_id,
            task_id=args.task_id,
            category=args.category,
            location=args.location,
            guest_count=args.guest_count,
            hard_requirements=args.hard_requirements,
            preferences=args.preferences,
            max_budget=args.max_budget,
            limit=args.limit,
        )

        shortlist_candidates: List[ProviderCandidate] = []
        for entry in shortlist_entries:
            v = next((item for item in vendors if item.id == entry["provider_id"]), None)
            if v:
                cand = ProviderCandidate(
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
                    known_constraints=entry.get("known_constraints", []),
                    unknown_fields=entry.get("unknown_fields", []),
                    qualification_status=entry.get("qualification_status", "QUALIFIED"),
                    requirement_matches=entry.get("requirement_matches", []),
                    requirement_failures=entry.get("requirement_mismatches", []),
                    preference_matches=entry.get("preferences_matched", []),
                    shortlist_rationale=f"Shortlisted: matched requirements {entry.get('requirement_matches')}, preferences {entry.get('preferences_matched')}",
                )
                shortlist_candidates.append(cand)

        data = ShortlistVendorsOutput(
            event_id=args.event_id,
            task_id=args.task_id,
            total_candidates=len(vendors),
            total_shortlisted=len(shortlist_candidates),
            shortlist=shortlist_candidates,
            disqualified_count=disqualified_count,
            deterministic_rationale=summary,
        )
        return ToolResult.success_result(self.name, data)
