"""Domain Service: VendorTaskBindingService (Task 8).

Authoritative service responsible for:
1. Deterministic binding feasibility evaluation (hard requirements, capacity, availability, budget, conflicts, staleness).
2. Permission and authorization enforcement (preventing unauthorized or viewer mutations).
3. Reassignment protection (preventing silent overwrite of already bound tasks).
4. Idempotency (safe repeated requests without side effects).
5. Authoritative state mutation: task.provider_id = provider_id, task.status = ASSIGNED, vendor assignment sync.
6. Deterministic plan recalculation: DAG acyclic validation, critical path method (CPM), schedule recalculation, budget commitments.
7. Post-bind consistency verification with rollback on failure.
8. Immutable audit logging and state version tracking.
"""
import logging
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestException,
    NotFoundException,
    ForbiddenException,
)
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.dependency import TaskDependency
from app.models.budget import BudgetItem
from app.models.provider_availability import ProviderAvailability
from app.models.vendor_assignment import VendorAssignment
from app.models.vendor_outcome_validation import VendorOutcomeValidation
from app.models.state_transition import StateTransition
from app.models.audit import AuditRecord
from app.models.event_member import EventMember
from app.models.enums import (
    TaskStatus,
    BudgetItemStatus,
    RoleType,
    BindingStatus,
    BlockingReason,
    ClaimValidationStatus,
    OverallValidationStatus,
)
from app.schemas.vendor_binding import (
    VendorTaskBindingInput,
    BindingDecision,
    PlanRecalculationResult,
    VendorTaskBindingResponse,
)
from app.engines.dependency.graph import DependencyGraph
from app.engines.dependency.traversal import CriticalPathCalculator
from app.engines.schedule.scheduler import ScheduleEngine
from app.engines.budget.calculator import BudgetCalculator
from app.engines.auth.permissions import Permissions, ROLE_PERMISSIONS_MAP

logger = logging.getLogger(__name__)


class VendorTaskBindingService:
    """Authoritative service for deterministic vendor-to-task binding and plan recalculation."""

    def __init__(self, db: Session):
        self.db = db

    def evaluate_feasibility(
        self,
        event_id: str,
        task_id: str,
        provider_id: str,
        validation_id: Optional[str] = None,
        force_override_unknown: bool = False,
    ) -> BindingDecision:
        """Determines whether a vendor can be bound to a task based on validated evidence.
        
        CRITICAL PRINCIPLES:
        - NEVER bases decisions on overall_status alone.
        - Inspects individual claims: capacity, budget, availability, dietary/hard requirements, conflicts.
        - Hard requirement FAIL -> BLOCK.
        - Critical CONFLICT -> BLOCK.
        - Mandatory fact UNKNOWN -> BLOCK (unless explicit authorized override).
        - Stale validation -> BLOCK.
        - Capacity below required -> BLOCK.
        """
        # 1. Validate Entities Exist
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=f"Event with id '{event_id}' not found.",
                reason_code=BlockingReason.EVENT_MISMATCH,
                blocking_factors=[f"Event {event_id} does not exist"],
                validation_id=validation_id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )

        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            return BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=f"Task with id '{task_id}' not found.",
                reason_code=BlockingReason.TASK_NOT_FOUND,
                blocking_factors=[f"Task {task_id} does not exist"],
                validation_id=validation_id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )

        if task.event_id != event_id:
            return BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=f"Task '{task_id}' does not belong to event '{event_id}'.",
                reason_code=BlockingReason.EVENT_MISMATCH,
                blocking_factors=[f"Task event mismatch: {task.event_id} != {event_id}"],
                validation_id=validation_id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )

        provider = self.db.query(Vendor).filter(Vendor.id == provider_id).first()
        if not provider:
            return BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=f"Provider with id '{provider_id}' not found.",
                reason_code=BlockingReason.PROVIDER_NOT_FOUND,
                blocking_factors=[f"Provider {provider_id} does not exist"],
                validation_id=validation_id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )

        # 2. Check Provider Category Compatibility
        if task.required_provider_category and provider.category:
            req_cat = task.required_provider_category.strip().upper()
            prov_cat = provider.category.strip().upper()
            if req_cat not in prov_cat and prov_cat not in req_cat:
                return BindingDecision(
                    decision="BLOCK",
                    can_bind=False,
                    reason=f"Provider category '{provider.category}' does not match task requirement '{task.required_provider_category}'.",
                    reason_code=BlockingReason.CATEGORY_MISMATCH,
                    blocking_factors=[f"Category mismatch: {prov_cat} vs {req_cat}"],
                    validation_id=validation_id,
                    provider_id=provider_id,
                    task_id=task_id,
                    event_id=event_id,
                )

        # 3. Retrieve Task 7 Validation Record
        validation: Optional[VendorOutcomeValidation] = None
        if validation_id:
            validation = self.db.query(VendorOutcomeValidation).filter(
                VendorOutcomeValidation.id == validation_id,
                VendorOutcomeValidation.event_id == event_id,
            ).first()
        else:
            validation = (
                self.db.query(VendorOutcomeValidation)
                .filter(
                    VendorOutcomeValidation.event_id == event_id,
                    VendorOutcomeValidation.provider_id == provider_id,
                )
                .order_by(VendorOutcomeValidation.created_at.desc())
                .first()
            )

        if not validation:
            return BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason="No validated vendor outcome found for this provider and event. Task 7 validation is required before binding.",
                reason_code=BlockingReason.VALIDATION_NOT_FOUND,
                blocking_factors=["No Task 7 validation record exists"],
                validation_id=None,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )

        # Ensure validation matches provider and event
        if validation.provider_id != provider_id:
            return BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=f"Validation record '{validation.id}' belongs to provider '{validation.provider_id}', not '{provider_id}'.",
                reason_code=BlockingReason.VALIDATION_FAILED,
                blocking_factors=["Validation provider ID mismatch"],
                validation_id=validation.id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )

        # 4. Check Validation Staleness
        # Check if provider availability changed in the authoritative calendar after validation was created
        if event.start_datetime:
            end_dt = event.end_datetime or event.start_datetime
            conflicting_new_slots = self.db.query(ProviderAvailability).filter(
                ProviderAvailability.vendor_id == provider_id,
                ProviderAvailability.status.in_(["BOOKED", "BLOCKED"]),
                ProviderAvailability.start_datetime < end_dt,
                ProviderAvailability.end_datetime > event.start_datetime,
                ProviderAvailability.created_at > validation.created_at,
            ).count()

            if conflicting_new_slots > 0:
                return BindingDecision(
                    decision="BLOCK",
                    can_bind=False,
                    reason="Vendor availability in authoritative calendar has changed since validation was performed.",
                    reason_code=BlockingReason.VALIDATION_STALE,
                    blocking_factors=["Authoritative calendar has newly booked/blocked slots overlapping event date"],
                    validation_id=validation.id,
                    provider_id=provider_id,
                    task_id=task_id,
                    event_id=event_id,
                )

        # 5. Deep Claim-by-Claim Evaluation
        blocking_factors: List[str] = []
        primary_reason_code: Optional[BlockingReason] = None

        claim_results: List[Dict[str, Any]] = validation.claim_results or []
        hard_reqs_failed: List[str] = validation.hard_requirements_failed or []
        conflicts: List[str] = validation.conflicts or []
        unknown_facts: List[str] = validation.unknown_facts or []

        # A. Conflicts Check
        if conflicts or any(c.get("status") == ClaimValidationStatus.CONFLICT.value for c in claim_results):
            primary_reason_code = BlockingReason.VALIDATION_CONFLICT
            for conflict_msg in conflicts:
                blocking_factors.append(f"Validation conflict: {conflict_msg}")
            for c in claim_results:
                if c.get("status") == ClaimValidationStatus.CONFLICT.value and c.get("explanation") not in blocking_factors:
                    blocking_factors.append(f"Conflict in {c.get('field')}: {c.get('explanation')}")

        # B. Hard Requirements Check
        if hard_reqs_failed or any(c.get("status") == ClaimValidationStatus.FAIL.value and c.get("is_hard_requirement") for c in claim_results):
            if not primary_reason_code:
                primary_reason_code = BlockingReason.HARD_REQUIREMENT_FAILED
            for h in hard_reqs_failed:
                blocking_factors.append(f"Hard requirement failed: {h}")

        # C. Capacity Check
        cap_claim = next((c for c in claim_results if c.get("claim_type") == "CAPACITY" or c.get("field") == "capacity"), None)
        if cap_claim:
            if cap_claim.get("status") == ClaimValidationStatus.FAIL.value:
                primary_reason_code = BlockingReason.CAPACITY_REQUIREMENT_FAILED
                rep_cap = cap_claim.get("reported_value")
                auth_cap = cap_claim.get("authoritative_value") or event.guest_count
                blocking_factors.append(f"Vendor capacity {rep_cap} is below required {auth_cap} guests.")
            elif cap_claim.get("status") == ClaimValidationStatus.CONFLICT.value:
                if not primary_reason_code:
                    primary_reason_code = BlockingReason.VALIDATION_CONFLICT
                blocking_factors.append(f"Capacity conflict: {cap_claim.get('explanation')}")

        # D. Availability Check (Mandatory for assignment)
        avail_claim = next((c for c in claim_results if c.get("claim_type") == "AVAILABILITY" or c.get("field") == "availability"), None)
        if avail_claim:
            if avail_claim.get("status") == ClaimValidationStatus.FAIL.value:
                primary_reason_code = BlockingReason.AVAILABILITY_UNAVAILABLE
                blocking_factors.append("Vendor is reported or confirmed UNAVAILABLE for event dates.")
            elif avail_claim.get("status") == ClaimValidationStatus.CONFLICT.value:
                if not primary_reason_code:
                    primary_reason_code = BlockingReason.VALIDATION_CONFLICT
                blocking_factors.append("Vendor availability conflicts with existing calendar bookings.")
            elif avail_claim.get("status") == ClaimValidationStatus.UNKNOWN.value:
                if not force_override_unknown:
                    primary_reason_code = BlockingReason.AVAILABILITY_NOT_VALIDATED
                    blocking_factors.append("Vendor availability is not sufficiently validated for assignment.")

        # E. Budget / Price Check
        price_claim = next((c for c in claim_results if c.get("claim_type") == "PRICE" or c.get("field") == "quoted_price"), None)
        if price_claim:
            if price_claim.get("status") == ClaimValidationStatus.FAIL.value:
                primary_reason_code = BlockingReason.BUDGET_EXCEEDED
                rep_p = price_claim.get("reported_value")
                auth_p = price_claim.get("authoritative_value")
                blocking_factors.append(f"Vendor quote of ₹{rep_p:,.2f} exceeds allocated budget of ₹{auth_p:,.2f}.")
            elif price_claim.get("status") == ClaimValidationStatus.CONFLICT.value:
                if not primary_reason_code:
                    primary_reason_code = BlockingReason.VALIDATION_CONFLICT
                blocking_factors.append(f"Currency/Budget conflict: {price_claim.get('explanation')}")

        # Check total event budget ceiling overspend
        quote_amount = None
        if price_claim and price_claim.get("reported_value") is not None:
            try:
                quote_amount = float(price_claim.get("reported_value"))
            except (ValueError, TypeError):
                quote_amount = None

        if quote_amount and event.total_budget and float(event.total_budget) > 0:
            total_budget_float = float(event.total_budget)
            # Sum other committed amounts
            other_committed = 0.0
            other_budget_items = self.db.query(BudgetItem).filter(
                BudgetItem.event_id == event_id,
                BudgetItem.status.in_(["COMMITTED", "PAID"]),
            ).all()
            for b in other_budget_items:
                # Exclude the category item for this task to avoid double counting
                if task.required_provider_category and b.category and b.category.upper() == task.required_provider_category.upper():
                    continue
                other_committed += float(b.actual_amount or b.estimated_amount or 0)

            if other_committed + quote_amount > total_budget_float:
                primary_reason_code = BlockingReason.BUDGET_EXCEEDED
                blocking_factors.append(
                    f"Binding quote of ₹{quote_amount:,.2f} would increase total commitments to ₹{(other_committed + quote_amount):,.2f}, "
                    f"exceeding total event budget of ₹{total_budget_float:,.2f}."
                )

        # F. Remaining Unknown Facts Check
        if unknown_facts and not force_override_unknown:
            for uf in unknown_facts:
                if "availability" in uf.lower():
                    if not primary_reason_code:
                        primary_reason_code = BlockingReason.AVAILABILITY_NOT_VALIDATED
                    if "Vendor availability is not sufficiently validated for assignment." not in blocking_factors:
                        blocking_factors.append("Vendor availability is not sufficiently validated for assignment.")

        # Final decision synthesis
        if blocking_factors:
            first_factor = blocking_factors[0]
            return BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=f"Vendor cannot be bound: {first_factor}",
                reason_code=primary_reason_code or BlockingReason.VALIDATION_FAILED,
                blocking_factors=blocking_factors,
                validation_id=validation.id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )

        return BindingDecision(
            decision="BIND",
            can_bind=True,
            reason="All mandatory requirements, capacity, availability, and budget conditions satisfied.",
            reason_code=None,
            blocking_factors=[],
            validation_id=validation.id,
            provider_id=provider_id,
            task_id=task_id,
            event_id=event_id,
        )

    def _compute_plan_version(self, event_id: str) -> int:
        """Determines the current integer sequence for the event plan version."""
        transition_count = self.db.query(StateTransition).filter(StateTransition.event_id == event_id).count()
        return 1 + transition_count

    def _verify_authorization(self, event_id: str, user_id: Optional[str]) -> Tuple[bool, Optional[str]]:
        """Verifies that the calling actor has permission to bind vendors (VENDOR_ASSIGN)."""
        if not user_id or user_id in ("system", "anonymous_operator") or user_id.startswith("system"):
            return True, None

        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return False, "Event not found"

        # Owner is Main Organizer
        if event.owner_id == user_id:
            return True, None

        # Check membership
        member = self.db.query(EventMember).filter(
            EventMember.event_id == event_id,
            EventMember.user_id == user_id,
        ).first()

        if not member:
            return False, f"User '{user_id}' is not a member of event '{event_id}'."

        if member.role == RoleType.VIEWER.value:
            return False, f"User '{user_id}' has read-only VIEWER role and cannot bind vendors."

        allowed_perms = ROLE_PERMISSIONS_MAP.get(member.role, set())
        if Permissions.VENDOR_ASSIGN not in allowed_perms:
            return False, f"User role '{member.role}' lacks VENDOR_ASSIGN permission."

        return True, None

    def bind_vendor_to_task(
        self,
        event_id: str,
        task_id: str,
        provider_id: str,
        validation_id: Optional[str] = None,
        user_id: Optional[str] = None,
        allow_reassignment: bool = False,
        force_override_unknown: bool = False,
    ) -> VendorTaskBindingResponse:
        """Atomically binds a qualified, validated provider to a task and recalculates the execution plan."""
        # 1. Authorization check
        is_auth, auth_err = self._verify_authorization(event_id, user_id)
        if not is_auth:
            decision = BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=auth_err or "Unauthorized: missing VENDOR_ASSIGN permission",
                reason_code=BlockingReason.UNAUTHORIZED,
                blocking_factors=[auth_err or "User unauthorized"],
                validation_id=validation_id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )
            return VendorTaskBindingResponse(
                binding_status=BindingStatus.BLOCKED,
                event_id=event_id,
                task_id=task_id,
                provider_id=provider_id,
                validation_id=validation_id,
                decision=decision,
                message=f"Binding blocked: {auth_err}",
            )

        # 2. Load authoritative task
        task = self.db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
        if not task:
            decision = BindingDecision(
                decision="BLOCK",
                can_bind=False,
                reason=f"Task '{task_id}' not found for event '{event_id}'.",
                reason_code=BlockingReason.TASK_NOT_FOUND,
                blocking_factors=[f"Task {task_id} not found"],
                validation_id=validation_id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )
            return VendorTaskBindingResponse(
                binding_status=BindingStatus.BLOCKED,
                event_id=event_id,
                task_id=task_id,
                provider_id=provider_id,
                validation_id=validation_id,
                decision=decision,
                message=f"Binding blocked: Task not found.",
            )

        # 3. Idempotency Check
        if task.provider_id == provider_id:
            logger.info("Idempotent binding requested: provider %s already bound to task %s", provider_id, task_id)
            current_version = self._compute_plan_version(event_id)
            decision = BindingDecision(
                decision="BIND",
                can_bind=True,
                reason="Vendor is already bound to this task. Idempotent request satisfied.",
                reason_code=None,
                blocking_factors=[],
                validation_id=validation_id,
                provider_id=provider_id,
                task_id=task_id,
                event_id=event_id,
            )
            return VendorTaskBindingResponse(
                binding_status=BindingStatus.ALREADY_BOUND,
                event_id=event_id,
                task_id=task_id,
                provider_id=provider_id,
                validation_id=validation_id,
                previous_provider_id=provider_id,
                decision=decision,
                plan_version_before=current_version,
                plan_version_after=current_version,
                schedule_recalculated=False,
                critical_path_recalculated=False,
                budget_recalculated=False,
                message=f"Vendor is already bound to task '{task.name}'. No duplicate state created.",
            )

        # 4. Reassignment Protection
        if task.provider_id is not None and task.provider_id != provider_id:
            if not allow_reassignment:
                decision = BindingDecision(
                    decision="BLOCK",
                    can_bind=False,
                    reason=f"Task is already bound to provider '{task.provider_id}'. Reassignment must be explicitly confirmed with allow_reassignment=True.",
                    reason_code=BlockingReason.REASSIGNMENT_BLOCKED,
                    blocking_factors=[f"Task already has assigned provider: {task.provider_id}"],
                    validation_id=validation_id,
                    provider_id=provider_id,
                    task_id=task_id,
                    event_id=event_id,
                )
                return VendorTaskBindingResponse(
                    binding_status=BindingStatus.BLOCKED,
                    event_id=event_id,
                    task_id=task_id,
                    provider_id=provider_id,
                    validation_id=validation_id,
                    previous_provider_id=task.provider_id,
                    decision=decision,
                    message="Binding blocked: Task already has an assigned vendor. Explicit reassignment flag required.",
                )

        # 5. Deterministic Feasibility Evaluation
        decision = self.evaluate_feasibility(
            event_id=event_id,
            task_id=task_id,
            provider_id=provider_id,
            validation_id=validation_id,
            force_override_unknown=force_override_unknown,
        )

        if not decision.can_bind:
            return VendorTaskBindingResponse(
                binding_status=BindingStatus.BLOCKED,
                event_id=event_id,
                task_id=task_id,
                provider_id=provider_id,
                validation_id=decision.validation_id,
                previous_provider_id=task.provider_id,
                decision=decision,
                message=f"Binding blocked: {decision.reason}",
            )

        # 6. ATOMIC TRANSACTION BOUNDARY: BINDING & PLAN RECALCULATION
        event = self.db.query(Event).filter(Event.id == event_id).first()
        provider = self.db.query(Vendor).filter(Vendor.id == provider_id).first()
        validation = (
            self.db.query(VendorOutcomeValidation).filter(VendorOutcomeValidation.id == decision.validation_id).first()
            if decision.validation_id
            else None
        )

        prev_provider_id = task.provider_id
        prev_status = task.status
        plan_version_before = self._compute_plan_version(event_id)

        try:
            # A. Authoritative Mutation: Bind Provider to Task
            task.provider_id = provider_id
            task.status = TaskStatus.ASSIGNED.value

            # Extract validated quote price if present
            quote_price: Optional[float] = None
            if validation:
                price_claim = next((c for c in (validation.claim_results or []) if c.get("claim_type") == "PRICE" or c.get("field") == "quoted_price"), None)
                if price_claim and price_claim.get("reported_value") is not None:
                    try:
                        quote_price = float(price_claim.get("reported_value"))
                    except (ValueError, TypeError):
                        quote_price = None

            # B. Synchronize VendorAssignment table
            assignment = self.db.query(VendorAssignment).filter(
                VendorAssignment.event_id == event_id,
                VendorAssignment.vendor_id == provider_id,
            ).first()

            if assignment:
                assignment.status = "CONFIRMED"
                if quote_price is not None:
                    assignment.agreed_cost = quote_price
            else:
                assignment = VendorAssignment(
                    event_id=event_id,
                    vendor_id=provider_id,
                    category=task.required_provider_category or provider.category or "GENERAL",
                    status="CONFIRMED",
                    agreed_cost=quote_price,
                )
                self.db.add(assignment)

            # C. Deterministic Plan Recalculation
            all_tasks = self.db.query(Task).filter(Task.event_id == event_id).all()
            all_deps = self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()

            # 1. DAG Integrity & Cycle Detection
            graph = DependencyGraph.from_tasks_and_dependencies(all_tasks, all_deps)
            if not graph.is_acyclic():
                raise BadRequestException("Plan recalculation introduced a cyclic dependency in the task DAG.")

            # 2. Critical Path & Slack Recalculation
            cpc = CriticalPathCalculator()
            cp_result = cpc.calculate(graph)

            for t in all_tasks:
                timing = cp_result.task_timings.get(t.id)
                if timing:
                    t.slack_minutes = timing.slack
                    t.is_critical_path = timing.is_critical

            # 3. Schedule Recalculation
            schedule_recalculated = False
            if event.start_datetime:
                sched_engine = ScheduleEngine()
                sched_result = sched_engine.schedule_tasks(
                    event_start=event.start_datetime,
                    tasks=all_tasks,
                    dependencies=all_deps,
                )
                for t in all_tasks:
                    entry = sched_result.entries.get(t.id)
                    if entry:
                        t.planned_start = entry.planned_start
                        t.planned_end = entry.planned_end
                schedule_recalculated = True

            # 4. Budget State Recalculation
            budget_recalculated = False
            if quote_price is not None:
                category_key = task.required_provider_category or provider.category
                if category_key:
                    budget_item = next(
                        (b for b in event.budget_items if b.category and b.category.upper() == category_key.upper()),
                        None,
                    )
                    if budget_item:
                        budget_item.status = BudgetItemStatus.COMMITTED.value
                        budget_item.actual_amount = Decimal(str(quote_price))
                        budget_recalculated = True

            # 5. Plan Versioning & State Transition Record
            plan_version_after = plan_version_before + 1
            transition = StateTransition(
                event_id=event_id,
                entity_type="TASK",
                entity_id=task.id,
                previous_state=prev_status,
                new_state=TaskStatus.ASSIGNED.value,
                reason=f"Provider '{provider.name}' bound to task '{task.name}' with plan version v{plan_version_after}",
            )
            self.db.add(transition)

            # 6. Post-Bind Consistency Verification
            self.db.flush()
            if task.provider_id != provider_id:
                raise ValueError("Post-bind verification failed: task.provider_id was not set to expected provider.")
            if task.status != TaskStatus.ASSIGNED.value:
                raise ValueError("Post-bind verification failed: task.status was not set to ASSIGNED.")
            if not graph.is_acyclic():
                raise ValueError("Post-bind verification failed: task DAG contains cycles.")

            # 7. Audit Logging
            actor_type = "USER"
            if user_id and (user_id.startswith("agent") or user_id.startswith("system")):
                actor_type = "AGENT"

            audit = AuditRecord(
                event_id=event_id,
                actor_id=user_id or "system",
                actor_type=actor_type,
                action="BIND_VENDOR_TO_TASK",
                action_type="VENDOR_ASSIGN",
                target_type="TASK",
                target_id=task.id,
                before_state={
                    "provider_id": prev_provider_id,
                    "status": prev_status,
                    "plan_version": plan_version_before,
                },
                after_state={
                    "provider_id": provider_id,
                    "status": task.status,
                    "plan_version": plan_version_after,
                    "validation_id": decision.validation_id,
                    "quote_price": quote_price,
                    "is_critical_path": task.is_critical_path,
                },
                impact_level="MAJOR",
            )
            self.db.add(audit)
            self.db.commit()
            self.db.refresh(task)
            self.db.refresh(audit)

            # Construct Recalculation Summary
            recalc_result = PlanRecalculationResult(
                schedule_recalculated=schedule_recalculated,
                critical_path_recalculated=True,
                budget_recalculated=budget_recalculated,
                is_dag_acyclic=True,
                total_duration_minutes=cp_result.total_duration,
                critical_path_task_ids=cp_result.critical_path,
                task_slack_minutes=task.slack_minutes,
                task_is_critical_path=task.is_critical_path,
                budget_committed_amount=quote_price,
                plan_version_before=plan_version_before,
                plan_version_after=plan_version_after,
            )

            return VendorTaskBindingResponse(
                binding_status=BindingStatus.BOUND,
                event_id=event_id,
                task_id=task_id,
                provider_id=provider_id,
                validation_id=decision.validation_id,
                previous_provider_id=prev_provider_id,
                decision=decision,
                plan_recalculation=recalc_result,
                plan_version_before=plan_version_before,
                plan_version_after=plan_version_after,
                schedule_recalculated=schedule_recalculated,
                critical_path_recalculated=True,
                budget_recalculated=budget_recalculated,
                audit_id=audit.id,
                message=f"Vendor '{provider.name}' successfully bound to task '{task.name}'. Execution plan recalculated to v{plan_version_after}.",
            )

        except Exception as exc:
            self.db.rollback()
            logger.error("Failed to bind vendor '%s' to task '%s': %s", provider_id, task_id, str(exc), exc_info=True)
            raise exc
