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
    SubmitVendorOutcomeInput,
    SubmitVendorOutcomeOutput,
    ValidateVendorOutcomeInput,
    ValidateVendorOutcomeOutput,
    BindVendorToTaskInput,
    BindVendorToTaskOutput,
)
from app.agent.tools.permissions import ToolPermissionGuard
from app.services.vendor_outcome_service import VendorOutcomeService
from app.services.vendor_outcome_validation_service import VendorOutcomeValidationService
from app.services.vendor_task_binding_service import VendorTaskBindingService
from app.models.enums import BindingStatus
from app.core.exceptions import BadRequestException, NotFoundException


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


class SubmitVendorOutcomeTool(AgentTool):
    """Submits the organizer-reported outcome of external communication with a vendor for an event task.

    CRITICAL ARCHITECTURAL BOUNDARY:
    Strictly records unverified organizer-reported facts (source='ORGANIZER_REPORTED', verification_status='UNVERIFIED').
    Does NOT confirm bookings, does NOT mutate task provider assignments, and does NOT recalculate plans.
    """

    name = "submit_vendor_outcome"
    description = (
        "Records the outcome of external communication with a provider (phone, email, WhatsApp external, etc.). "
        "Strictly records unverified organizer-reported facts without altering booking or task assignments."
    )
    category = ToolCategory.PROVIDER
    access_mode = ToolAccessMode.WRITE
    input_schema = SubmitVendorOutcomeInput
    output_schema = SubmitVendorOutcomeOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: SubmitVendorOutcomeInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        # Enforce viewer role restriction: viewers cannot submit operational outcomes
        if context.user_id and not (
            context.user_id in ("system", "anonymous_operator")
            or context.user_id.startswith("system")
            or context.user_id.startswith("agent")
        ):
            from app.models.event import Event
            from app.models.event_member import EventMember
            from app.models.enums import RoleType

            event = context.db.query(Event).filter(Event.id == args.event_id).first()
            if event and event.owner_id != context.user_id:
                member = (
                    context.db.query(EventMember)
                    .filter(
                        EventMember.event_id == args.event_id,
                        EventMember.user_id == context.user_id,
                    )
                    .first()
                )
                if member and member.role == RoleType.VIEWER.value:
                    return ToolResult.failure_result(
                        self.name,
                        f"User '{context.user_id}' has read-only VIEWER access and cannot record vendor outcomes.",
                        "PERMISSION_DENIED",
                    )

        outcome_service = VendorOutcomeService(context.db)
        try:
            outcome = outcome_service.record_outcome(
                event_id=args.event_id,
                payload=args,
                submitted_by=context.user_id,
            )
        except NotFoundException as exc:
            return ToolResult.failure_result(self.name, str(exc), "NOT_FOUND")
        except BadRequestException as exc:
            return ToolResult.failure_result(self.name, str(exc), "INVALID_INPUT")
        except Exception as exc:
            return ToolResult.failure_result(
                self.name,
                f"Failed to record vendor outcome: {str(exc)}",
                "PERSISTENCE_FAILURE",
            )

        vendor = context.db.query(Vendor).filter(Vendor.id == outcome.provider_id).first()
        task = context.db.query(Task).filter(Task.id == outcome.task_id).first() if outcome.task_id else None

        summary_msg = (
            f"Recorded {outcome.outcome_status} outcome for provider '{vendor.name if vendor else outcome.provider_id}' "
            f"via {outcome.communication_channel}. Status is UNVERIFIED pending Task 7 validation."
        )

        data = SubmitVendorOutcomeOutput(
            outcome_id=outcome.id,
            event_id=outcome.event_id,
            task_id=outcome.task_id,
            provider_id=outcome.provider_id,
            provider_name=vendor.name if vendor else None,
            outcome_status=outcome.outcome_status,
            quoted_price=outcome.quoted_price,
            currency=outcome.currency,
            reported_availability=outcome.reported_availability,
            communication_channel=outcome.communication_channel,
            source=outcome.source,
            verification_status=outcome.verification_status,
            organizer_notes=outcome.organizer_notes,
            recorded_at=outcome.created_at.isoformat() if outcome.created_at else "",
            summary=summary_msg,
        )
        return ToolResult.success_result(self.name, data)


class ValidateVendorOutcomeTool(AgentTool):
    """Parses and deterministically validates an organizer-reported vendor outcome against system state.

    CRITICAL ARCHITECTURAL BOUNDARY:
    Evaluates claims deterministically into PASS, FAIL, UNKNOWN, or CONFLICT.
    Does NOT assign or bind the vendor to the task, does NOT mutate task status or provider_id,
    and does NOT recalculate the event plan or DAG.
    """

    name = "validate_vendor_outcome"
    description = (
        "Parses organizer-reported vendor outcome notes and evaluates claims against event requirements, "
        "budget, guest capacity, calendar availability, and vendor master data. "
        "Returns structured deterministic validation results without mutating task assignments or event plans."
    )
    category = ToolCategory.PROVIDER
    access_mode = ToolAccessMode.WRITE
    input_schema = ValidateVendorOutcomeInput
    output_schema = ValidateVendorOutcomeOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: ValidateVendorOutcomeInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        # Enforce viewer role restriction: viewers cannot perform operational validations
        if context.user_id and not (
            context.user_id in ("system", "anonymous_operator")
            or context.user_id.startswith("system")
            or context.user_id.startswith("agent")
        ):
            from app.models.event import Event
            from app.models.event_member import EventMember
            from app.models.enums import RoleType

            event = context.db.query(Event).filter(Event.id == args.event_id).first()
            if event and event.owner_id != context.user_id:
                member = (
                    context.db.query(EventMember)
                    .filter(
                        EventMember.event_id == args.event_id,
                        EventMember.user_id == context.user_id,
                    )
                    .first()
                )
                if member and member.role == RoleType.VIEWER.value:
                    return ToolResult.failure_result(
                        self.name,
                        f"User '{context.user_id}' has read-only VIEWER access and cannot validate vendor outcomes.",
                        "PERMISSION_DENIED",
                    )

        validation_service = VendorOutcomeValidationService(context.db)
        try:
            val = validation_service.validate_outcome(
                outcome_id=args.vendor_outcome_id,
                event_id=args.event_id,
            )
        except NotFoundException as exc:
            return ToolResult.failure_result(self.name, str(exc), "NOT_FOUND")
        except BadRequestException as exc:
            return ToolResult.failure_result(self.name, str(exc), "INVALID_INPUT")
        except Exception as exc:
            return ToolResult.failure_result(
                self.name,
                f"Failed to validate vendor outcome: {str(exc)}",
                "VALIDATION_FAILURE",
            )

        vendor = context.db.query(Vendor).filter(Vendor.id == val.provider_id).first()

        data = ValidateVendorOutcomeOutput(
            validation_id=val.id,
            vendor_outcome_id=val.vendor_outcome_id,
            event_id=val.event_id,
            task_id=val.task_id,
            provider_id=val.provider_id,
            provider_name=vendor.name if vendor else None,
            overall_status=val.overall_status,
            extracted_claims=val.extracted_claims or [],
            claim_results=val.claim_results or [],
            hard_requirements_passed=val.hard_requirements_passed or [],
            hard_requirements_failed=val.hard_requirements_failed or [],
            preferences_matched=val.preferences_matched or [],
            conflicts=val.conflicts or [],
            unknown_facts=val.unknown_facts or [],
            validator_version=val.validator_version,
            summary=val.summary or f"Validation evaluated with overall status: {val.overall_status}",
            validated_at=val.created_at.isoformat() if val.created_at else "",
        )
        return ToolResult.success_result(self.name, data)


class BindVendorToTaskTool(AgentTool):
    """Evaluates feasibility and deterministically binds a validated provider to a task.
    
    CRITICAL ARCHITECTURAL BOUNDARY:
    1. Does NOT accept blind LLM decisions or invent claims.
    2. Enforces deterministic feasibility against Task 7 validation evidence.
    3. Rejects bindings with failing hard requirements, critical conflicts, or missing mandatory availability.
    4. Mutates task.provider_id and task.status = ASSIGNED upon success.
    5. Recalculates DAG integrity, CPM critical path, schedule timings, and budget commitments.
    6. Verifies post-bind consistency and records an immutable audit record.
    """

    name = "bind_vendor_to_task"
    description = (
        "Evaluates deterministic feasibility and binds a qualified, validated provider to an operational task. "
        "Upon successful binding, recalculates task schedule, critical path (CPM), and budget commitments, "
        "ensuring strict DAG acyclic integrity."
    )
    category = ToolCategory.PLANNING
    access_mode = ToolAccessMode.WRITE
    input_schema = BindVendorToTaskInput
    output_schema = BindVendorToTaskOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: BindVendorToTaskInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        service = VendorTaskBindingService(context.db)
        try:
            res = service.bind_vendor_to_task(
                event_id=args.event_id,
                task_id=args.task_id,
                provider_id=args.provider_id,
                validation_id=args.validation_id,
                user_id=context.user_id,
                allow_reassignment=args.allow_reassignment,
                force_override_unknown=args.force_override_unknown,
            )
        except Exception as exc:
            return ToolResult.failure_result(
                self.name,
                f"Binding failed with operational error: {str(exc)}",
                "BINDING_ERROR",
            )

        if res.binding_status == BindingStatus.BLOCKED:
            output = BindVendorToTaskOutput(
                binding_status=BindingStatus.BLOCKED.value,
                event_id=res.event_id,
                task_id=res.task_id,
                provider_id=res.provider_id,
                validation_id=res.validation_id,
                previous_provider_id=res.previous_provider_id,
                decision=res.decision.decision,
                reason=res.decision.reason,
                reason_code=res.decision.reason_code.value if res.decision.reason_code else None,
                blocking_factors=res.decision.blocking_factors,
                plan_version_before=res.plan_version_before,
                plan_version_after=res.plan_version_after,
                schedule_recalculated=res.schedule_recalculated,
                critical_path_recalculated=res.critical_path_recalculated,
                budget_recalculated=res.budget_recalculated,
                is_dag_acyclic=True,
                critical_path_tasks=[],
                task_slack_minutes=None,
                task_is_critical_path=False,
                budget_committed_amount=None,
                audit_id=res.audit_id,
                summary=res.message,
            )
            return ToolResult.failure_result(
                self.name,
                res.message,
                res.decision.reason_code.value if res.decision.reason_code else "BINDING_BLOCKED",
                output.model_dump(),
            )

        # BOUND or ALREADY_BOUND
        output = BindVendorToTaskOutput(
            binding_status=res.binding_status.value,
            event_id=res.event_id,
            task_id=res.task_id,
            provider_id=res.provider_id,
            validation_id=res.validation_id,
            previous_provider_id=res.previous_provider_id,
            decision=res.decision.decision,
            reason=res.decision.reason,
            reason_code=None,
            blocking_factors=[],
            plan_version_before=res.plan_version_before,
            plan_version_after=res.plan_version_after,
            schedule_recalculated=res.schedule_recalculated,
            critical_path_recalculated=res.critical_path_recalculated,
            budget_recalculated=res.budget_recalculated,
            is_dag_acyclic=res.plan_recalculation.is_dag_acyclic if res.plan_recalculation else True,
            critical_path_tasks=res.plan_recalculation.critical_path_task_ids if res.plan_recalculation else [],
            task_slack_minutes=res.plan_recalculation.task_slack_minutes if res.plan_recalculation else None,
            task_is_critical_path=res.plan_recalculation.task_is_critical_path if res.plan_recalculation else False,
            budget_committed_amount=res.plan_recalculation.budget_committed_amount if res.plan_recalculation else None,
            audit_id=res.audit_id,
            summary=res.message,
        )
        return ToolResult.success_result(self.name, output)



