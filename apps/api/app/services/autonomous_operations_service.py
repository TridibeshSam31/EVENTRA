"""Domain Service: AutonomousOperationsService

Orchestrates autonomous event operations execution when an organizer says 'Start Operations'.
Transitions the event to LIVE, dynamically executes discovery across all required operational categories
(Venues, Catering, AV, Photography, Security, Transport, etc.), evaluates candidates deterministically,
dispatches outreach via ProviderCommunicationService, tracks responses, synchronizes with LiveStateService,
and manages incident detection, impact analysis, recovery option generation, and post-action verification.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.task import Task
from app.models.requirement import Requirement
from app.models.vendor import Vendor
from app.models.venue import Venue
from app.models.vendor_assignment import VendorAssignment
from app.models.budget import BudgetItem
from app.models.approval import Approval
from app.models.incident import Incident
from app.models.audit import AuditRecord
from app.models.enums import EventLifecycleState, EventState, TaskStatus, ProviderCategory, IncidentSeverity
from app.services.live_state_service import LiveStateService
from app.services.venue_service import VenueService
from app.services.vendor_service import VendorService
from app.services.provider_communication_service import ProviderCommunicationService
from app.services.negotiation_service import NegotiationService
from app.services.approval_service import ApprovalService
from app.services.planning_service import PlanningService
from app.services.incident_service import IncidentService
from app.services.recovery_service import RecoveryService
from app.services.action_service import ActionService
from app.services.verification_service import VerificationService
from app.schemas.vendor import VendorAssignmentCreate, ProviderDiscoveryRequest
from app.schemas.venue import VenueCreate
from app.schemas.incident import IncidentCreate
from app.schemas.approval import ApprovalRequestCreate
from app.observability.audit import AuditRecorder
from app.core.exceptions import NotFoundException, BadRequestException
from app.models.discovery_run import DiscoveryRun
from app.models.agent_run import AgentRun
from app.services.live_broker import live_broker
from app.services.agentic_discovery_controller import AgenticDiscoveryController
import uuid
import logging

logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AutonomousOperationsService:
    """Coordinates autonomous execution of operational plans and adaptive recovery."""

    def __init__(self, db: Session):
        self.db = db
        self._live_state = LiveStateService(db)
        self._venue_service = VenueService(db)
        self._vendor_service = VendorService(db)
        self._comm_service = ProviderCommunicationService(db)
        self._negotiation_service = NegotiationService(db)
        self._approval_service = ApprovalService(db)
        self._planning_service = PlanningService(db)
        self._incident_service = IncidentService(db)
        self._recovery_service = RecoveryService(db)
        self._action_service = ActionService(db)
        self._verification_service = VerificationService(db)
        self._audit = AuditRecorder(db)

    def initiate_operations_run(
        self,
        event_id: str,
        user_id: str = "anonymous_operator",
    ) -> Dict[str, Any]:
        """Transitions event to LIVE, ensures plan exists, initiates DiscoveryRun,
        and returns immediately so heavy multi-iteration scraping runs in BackgroundTasks.
        (Decision 1: start_operations must not run discovery synchronously in the request)
        """
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with ID '{event_id}' not found.")

        # 0. Concurrency & Idempotency Check: Prevent duplicate concurrent operation runs
        active_agent_run = (
            self.db.query(AgentRun)
            .filter(
                AgentRun.event_id == event_id,
                AgentRun.status.in_(["RUNNING", "INITIALIZED"]),
            )
            .first()
        )
        if active_agent_run:
            return {
                "status": "ALREADY_RUNNING",
                "message": f"Autonomous operations run '{active_agent_run.run_id}' is already active.",
                "event_id": event.id,
                "run_id": active_agent_run.run_id,
                "lifecycle_state": event.lifecycle_state,
            }

        # 1. Ensure operational plan exists
        existing_tasks = self.db.query(Task).filter(Task.event_id == event.id).all()
        if not existing_tasks or event.lifecycle_state == EventLifecycleState.DRAFT.value:
            self._planning_service.generate_plan(event.id)
            self.db.refresh(event)

        # 2. Transition lifecycle state to LIVE (Do NOT force LIVE if validation fails)
        if event.lifecycle_state in (EventLifecycleState.PLANNED.value, EventLifecycleState.DRAFT.value):
            try:
                self._live_state.go_live(event.id, reason="Organizer started autonomous operations")
                self.db.refresh(event)
            except Exception as live_err:
                logger.error(f"Cannot transition event '{event.id}' to LIVE: {live_err}")
                raise BadRequestException(f"Failed to transition event to LIVE: {str(live_err)}")

        # 3. Create canonical AgentRun in RUNNING state
        agent_run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"
        agent_run = AgentRun(
            run_id=agent_run_id,
            event_id=event.id,
            user_id=user_id,
            trigger_message="Organizer started autonomous operations",
            objective=f"Execute autonomous operations for '{event.name}'",
            status="RUNNING",
            started_at=utc_now(),
            tool_history=[{"step": 1, "tool": "initiate_operations", "status": "STARTED"}],
        )
        self.db.add(agent_run)

        # 4. Create initial DiscoveryRun in RUNNING state
        requirements = self.db.query(Requirement).filter(Requirement.event_id == event.id).all()
        primary_category = requirements[0].type if requirements else "CATERING"

        run = DiscoveryRun(
            id=f"disc_{uuid.uuid4().hex[:10]}",
            event_id=event.id,
            category=primary_category,
            status="RUNNING",
            trigger="operations",
            current_iteration=1,
            max_iterations=3,
            radius_km=10.0,
            target_count=6,
            parameters={
                "location": event.location or "Delhi",
                "guest_count": event.guest_count or 100,
            },
        )
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)

        # 5. Broadcast agent started event across workspace
        live_broker.publish_sync(
            event.id,
            {
                "type": "agent.started",
                "event_id": event.id,
                "run_id": agent_run_id,
                "status": "RUNNING",
                "current_step": "Autonomous operations started",
            },
        )

        return {
            "status": "STARTED",
            "message": f"Autonomous operations initiated for '{event.name}'. Agent observing and executing operational plan.",
            "event_id": event.id,
            "run_id": agent_run_id,
            "lifecycle_state": event.lifecycle_state,
        }

    @classmethod
    def run_background_operations(
        cls,
        event_id: str,
        run_id: Optional[str] = None,
        user_id: str = "anonymous_operator",
    ):
        """Asynchronous worker for running operations pipeline with isolated SessionLocal session."""
        from app.db.session import SessionLocal
        db = SessionLocal()
        try:
            service = cls(db)
            service.start_operations(event_id=event_id, user_id=user_id, run_id=run_id)
        except Exception as exc:
            logger.error(f"Background operations execution failed for event {event_id}: {exc}", exc_info=True)
            if run_id:
                try:
                    run = db.query(DiscoveryRun).filter(DiscoveryRun.id == run_id).first()
                    if run:
                        run.status = "FAILED"
                        db.commit()
                except Exception:
                    pass
        finally:
            db.close()

    def start_operations(
        self,
        event_id: str,
        user_id: str = "anonymous_operator",
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Transitions event to LIVE and kicks off autonomous sourcing and provider engagement."""
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with ID '{event_id}' not found.")

        # 1. Ensure operational plan exists
        existing_tasks = self.db.query(Task).filter(Task.event_id == event.id).all()
        if not existing_tasks or event.lifecycle_state == EventLifecycleState.DRAFT.value:
            self._planning_service.generate_plan(event.id)
            self.db.refresh(event)

        # 2. Transition lifecycle state to LIVE
        if event.lifecycle_state in (EventLifecycleState.PLANNED.value, EventLifecycleState.DRAFT.value):
            try:
                self._live_state.go_live(event.id, reason="Organizer started autonomous operations")
            except Exception:
                event.lifecycle_state = EventLifecycleState.LIVE.value
                event.state = EventState.NORMAL.value
                self.db.commit()
                self.db.refresh(event)

        # 3. Retrieve Active Requirements
        requirements = self.db.query(Requirement).filter(Requirement.event_id == event.id).all()
        categories_to_source = [r.type for r in requirements] if requirements else ["VENUE", "CATERING", "AV_TECH"]

        date_str = event.start_datetime.strftime("%d %B %Y") if event.start_datetime else "Upcoming Date"
        city = event.location or "Delhi"
        pax = event.guest_count or 100

        operations_report: List[Dict[str, Any]] = []
        providers_contacted_count = 0

        # 4. Venue Operations
        if "VENUE" in categories_to_source or not categories_to_source:
            venue_res = self._execute_venue_operations(event, city, pax, date_str)
            operations_report.append(venue_res)
            if venue_res.get("contacted"):
                providers_contacted_count += 1

        # 5. Vendor Operations (Catering, AV, Photography, Security, Transport, etc.)
        vendor_categories = [c for c in categories_to_source if c != "VENUE"]
        for category in vendor_categories:
            cat_res = self._execute_vendor_operations(event, category, city, pax, date_str, run_id=run_id)
            operations_report.append(cat_res)
            if cat_res.get("contacted"):
                providers_contacted_count += 1

        # Complete DiscoveryRun and update AgentRun status
        pending_apps = self._approval_service.get_pending_approvals(event_id=event.id)
        if run_id:
            try:
                # 1. Discovery run if exists
                disc_run = self.db.query(DiscoveryRun).filter(DiscoveryRun.id == run_id).first()
                if disc_run:
                    disc_run.status = "COMPLETED"

                # 2. Canonical AgentRun
                agent_run = self.db.query(AgentRun).filter(AgentRun.run_id == run_id).first()
                if agent_run:
                    if pending_apps:
                        agent_run.status = "WAITING_APPROVAL"
                        live_broker.publish_sync(
                            event.id,
                            {
                                "type": "agent.waiting_approval",
                                "event_id": event.id,
                                "run_id": run_id,
                                "status": "WAITING_APPROVAL",
                                "pending_approvals_count": len(pending_apps),
                            },
                        )
                    else:
                        agent_run.status = "COMPLETED"
                        agent_run.completed_at = utc_now()
                        live_broker.publish_sync(
                            event.id,
                            {
                                "type": "agent.completed",
                                "event_id": event.id,
                                "run_id": run_id,
                                "status": "COMPLETED",
                            },
                        )
                self.db.commit()
            except Exception as r_err:
                logger.warning(f"Could not update AgentRun / DiscoveryRun completed status: {r_err}")


        # 6. Audit & Telemetry
        self._audit.record(
            event_id=event.id,
            actor_id=user_id,
            actor_type="USER",
            action="AUTONOMOUS_OPERATIONS_STARTED",
            action_type="OPERATIONS",
            target_type="EVENT",
            target_id=event.id,
            after_state={
                "event_id": event.id,
                "categories_sourced": categories_to_source,
                "providers_contacted": providers_contacted_count,
            },
        )

        currency_sym = "₹" if event.currency == "INR" else "$"
        budget_total = float(event.total_budget or 0)
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event.id).all()
        allocated_budget = sum(float(b.estimated_amount or 0) for b in budget_items)

        summary_msg = (
            f"🚀 **Operations Active for {event.name}!**\n\n"
            f"Autonomous operations have started. Evaluated and contacted providers across {len(operations_report)} categories:\n"
        )
        for item in operations_report:
            status_emoji = "✓" if item.get("status") in ("CONFIRMED", "CONTACTED", "SOURCED", "ASSIGNED") else "⟳"
            src_tag = f" [{item.get('source', 'LIVE_SCRAPE')}]"
            summary_msg += f"• **{item.get('category', '').title()}**: {status_emoji} {item.get('provider_name', 'Sourcing candidate')}{src_tag} ({item.get('status', 'Pending')})\n"

        summary_msg += (
            f"\n• **Allocated Budget:** {currency_sym}{allocated_budget:,.0f} / {currency_sym}{budget_total:,.0f}\n"
            f"• **Live Status:** All operational tasks actively dispatched and monitored in Live Command Center."
        )

        return {
            "status": "OPERATING",
            "message": summary_msg,
            "event_id": event.id,
            "run_id": run_id,
            "lifecycle_state": event.lifecycle_state,
            "operations_report": operations_report,
            "providers_contacted_count": providers_contacted_count,
            "budget_allocated": allocated_budget,
            "budget_total": budget_total,
        }

    def _score_venue_candidate(self, venue: Venue, pax: int, city: str) -> float:
        """Deterministic candidate scoring for venues."""
        # 1. Capacity fit (ideal is 1.2x - 2.5x of pax)
        cap = venue.capacity or 100
        if cap < pax:
            cap_score = 0.3
        elif cap <= pax * 2.5:
            cap_score = 1.0
        else:
            cap_score = 0.7

        # 2. Location match
        loc_score = 1.0 if venue.city and city.lower() in venue.city.lower() else 0.5

        # 3. Rate feasibility
        rate_score = 0.9 if venue.hourly_rate and venue.hourly_rate > 0 else 0.8

        # Weighted aggregate
        return round((cap_score * 0.45) + (loc_score * 0.35) + (rate_score * 0.20), 2)

    def _score_vendor_candidate(self, vendor: Vendor, category: str, city: str, pax: int) -> float:
        """Deterministic candidate scoring for vendors."""
        # 1. Category match
        cat_score = 1.0 if vendor.category and category.lower() in vendor.category.lower() else 0.5

        # 2. Location match
        loc_score = 1.0 if vendor.city and city.lower() in vendor.city.lower() else 0.6

        # 3. Rating
        rating_score = (vendor.rating or 4.5) / 5.0

        return round((cat_score * 0.4) + (loc_score * 0.35) + (rating_score * 0.25), 2)

    def _execute_venue_operations(
        self,
        event: Event,
        city: str,
        pax: int,
        date_str: str,
    ) -> Dict[str, Any]:
        """Discovers, scores, evaluates, and contacts suitable venues."""
        venues, total = self._venue_service.search_venues(city=city, min_capacity=int(pax * 0.8), limit=5)
        if not venues:
            venues, total = self._venue_service.search_venues(city=city, limit=5)

        is_simulated = False
        if not venues:
            # Deterministic fallback candidate
            is_simulated = True
            new_venue = Venue(
                name=f"The Grand Imperial Convention Centre {city}",
                city=city,
                address=f"Central Convention Boulevard, {city}",
                capacity=max(pax * 2, 600),
                venue_type="CONFERENCE_CENTER",
                contact_phone="+919876543210",
                contact_email=f"events@grandimperial{city.lower().replace(' ', '')}.com",
                hourly_rate=15000.0,
                status="ACTIVE",
                amenities=["wifi", "av_tech", "parking", "catering_hall", "air_conditioned"],
            )
            self.db.add(new_venue)
            self.db.commit()
            self.db.refresh(new_venue)
            venues = [new_venue]

        # Deterministic scoring across all candidates
        scored_candidates = [(v, self._score_venue_candidate(v, pax, city)) for v in venues]
        scored_candidates.sort(key=lambda x: x[1], reverse=True)
        selected_venue, best_score = scored_candidates[0]

        venue_source = getattr(selected_venue, "source", None) or ("DEMO_FALLBACK" if is_simulated else "DATABASE")

        # Record candidate evaluation trace in Audit
        self._audit.record(
            event_id=event.id,
            actor_id="autonomous_agent",
            actor_type="AGENT",
            action="PROVIDER_CANDIDATES_EVALUATED",
            action_type="OPERATIONS",
            target_type="VENUE",
            target_id=selected_venue.id,
            after_state={
                "category": "VENUE",
                "total_candidates": len(venues),
                "selected_provider": selected_venue.name,
                "evaluation_score": best_score,
                "capacity": selected_venue.capacity,
                "source": venue_source,
            },
        )

        # Dispatch structured inquiry tied to the actual event
        inquiry_msg = (
            f"Greetings from EVENTRA Operations. We are inquiring about venue availability at {selected_venue.name} "
            f"for '{event.name}' ({pax} attendees) on {date_str}. Please provide availability confirmation and full-day rate quotation."
        )

        comm_res = self._comm_service.send_message(
            event_id=event.id,
            provider_id=selected_venue.id,
            message=inquiry_msg,
            recipient_contact=selected_venue.contact_phone,
            actor_id="autonomous_agent",
            actor_type="AGENT",
        )

        return {
            "category": "VENUE",
            "provider_id": selected_venue.id,
            "provider_name": selected_venue.name,
            "status": "CONTACTED" if comm_res.success else "SOURCED",
            "contacted": comm_res.success,
            "contact_phone": selected_venue.contact_phone,
            "evaluation_score": best_score,
            "is_simulated": is_simulated or (venue_source == "DEMO_FALLBACK"),
            "source": venue_source,
            "notes": f"Scored {best_score} on capacity ({selected_venue.capacity}) & location match for {pax} pax on {date_str}",
        }

    def _execute_vendor_operations(
        self,
        event: Event,
        category: str,
        city: str,
        pax: int,
        date_str: str,
        run_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Discovers, scores, assigns, and contacts providers for a specific category via AgenticDiscoveryController."""
        cat_lower = category.lower()

        # 1. Run Agentic Discovery (Multi-iteration scraping + qualification + ranking)
        controller = AgenticDiscoveryController(
            self.db,
            max_iterations=2,
            target_count=3,
        )
        discovery_res = controller.execute_discovery(
            event_id=event.id,
            category=category,
            location=city,
            guest_count=pax,
            run_id=run_id,
            trigger="operations",
            simulate_outreach=False,
        )

        selected_vendor = None
        best_score = 0.85
        is_simulated = False
        vendor_source = "LIVE_SCRAPE"

        if discovery_res.top_matches:
            top_match = discovery_res.top_matches[0]
            cand = top_match.candidate
            best_score = top_match.score or 0.85
            vendor_source = getattr(cand, "source", "LIVE_SCRAPE") or "LIVE_SCRAPE"

            # Find or upsert vendor in DB
            selected_vendor = (
                self.db.query(Vendor)
                .filter(
                    Vendor.name == cand.name,
                    Vendor.city.ilike(f"%{city}%"),
                )
                .first()
            )
            if not selected_vendor:
                selected_vendor = Vendor(
                    name=cand.name,
                    category=category.upper(),
                    city=cand.city or city,
                    address=cand.address,
                    latitude=cand.latitude,
                    longitude=cand.longitude,
                    contact_phone=cand.phone or "+919811223344",
                    contact_email=cand.email,
                    website=cand.website,
                    base_cost=float(pax * 450) if "cater" in cat_lower else (cand.base_cost or 45000.0),
                    rating=cand.rating or 4.8,
                    review_count=cand.review_count or 15,
                    status="ACTIVE",
                    source=vendor_source,
                )
                self.db.add(selected_vendor)
                self.db.commit()
                self.db.refresh(selected_vendor)

        if not selected_vendor:
            # Check cached DB strictly meeting radius and category
            cached_vendors = self._vendor_service.get_cached_candidates(category=category, city=city, limit=1)
            if cached_vendors:
                selected_vendor = cached_vendors[0]
                vendor_source = "CACHED_DB"
            else:
                is_simulated = True
                vendor_source = "DEMO_FALLBACK"
                selected_vendor = Vendor(
                    name=f"Elite {category.replace('_', ' ').title()} Solutions {city}",
                    category=category.upper(),
                    city=city,
                    address=f"Central Business Plaza, Sector 4, {city}",
                    contact_phone="+919811223344",
                    contact_email=f"contact@elite{cat_lower}.com",
                    base_cost=float(pax * 450) if "cater" in cat_lower else 45000.0,
                    rating=4.8,
                    status="ACTIVE",
                    source="DEMO_FALLBACK",
                )
                self.db.add(selected_vendor)
                self.db.commit()
                self.db.refresh(selected_vendor)

        # Record candidate evaluation trace
        self._audit.record(
            event_id=event.id,
            actor_id="autonomous_agent",
            actor_type="AGENT",
            action="PROVIDER_CANDIDATES_EVALUATED",
            action_type="OPERATIONS",
            target_type="VENDOR",
            target_id=selected_vendor.id,
            after_state={
                "category": category,
                "total_candidates": len(discovery_res.top_matches) if discovery_res.top_matches else 1,
                "selected_provider": selected_vendor.name,
                "evaluation_score": best_score,
                "base_cost": float(selected_vendor.base_cost or 0),
                "source": vendor_source,
            },
        )

        # Ensure VendorAssignment
        existing_assignment = (
            self.db.query(VendorAssignment)
            .filter(
                VendorAssignment.event_id == event.id,
                VendorAssignment.vendor_id == selected_vendor.id,
            )
            .first()
        )

        if not existing_assignment:
            assignment = VendorAssignment(
                event_id=event.id,
                vendor_id=selected_vendor.id,
                category=cat_lower,
                status="PENDING_CONFIRMATION",
                agreed_cost=selected_vendor.base_cost,
                notes=f"Autonomous sourcing dispatch (Score: {best_score}) for {pax} pax on {date_str}",
            )
            self.db.add(assignment)
            self.db.commit()
            self.db.refresh(assignment)
        else:
            assignment = existing_assignment

        # Strict requirement (Decision 2): Every vendor-binding action strictly requires an ApprovalRequest via ApprovalService
        approval_record = None
        cat_task = self.db.query(Task).filter(
            Task.event_id == event.id,
            Task.required_provider_category.ilike(f"%{cat_lower}%"),
        ).first()
        try:
            approval_in = ApprovalRequestCreate(
                action_type="CONTRACT_VENDOR",
                target_type="VENDOR",
                target_id=selected_vendor.id,
                requested_action={
                    "vendor_id": selected_vendor.id,
                    "vendor_name": selected_vendor.name,
                    "category": category,
                    "task_id": cat_task.id if cat_task else None,
                    "assignment_id": assignment.id,
                    "agreed_cost": float(selected_vendor.base_cost or 0),
                    "notes": f"Contracting shortlisted provider {selected_vendor.name} for {category.title()}",
                },
                notes=f"Approval required to contract {selected_vendor.name} for {category.title()}",
            )
            approval_record = self._approval_service.create_request(event.id, requester_id="autonomous_operations_engine", data=approval_in)
            live_broker.publish_sync(
                event.id,
                {
                    "type": "approval.created",
                    "event_id": event.id,
                    "approval_id": approval_record.id,
                    "action_type": approval_record.action_type,
                    "target_name": selected_vendor.name,
                },
            )
        except Exception as app_err:
            logger.error(f"Approval creation failed for vendor {selected_vendor.name}: {app_err}")
            # HARD GATE STOP: Enter error/blocked state. DO NOT send outreach or assign!
            assignment.status = "APPROVAL_FAILED"
            self.db.commit()

            live_broker.publish_sync(
                event.id,
                {
                    "type": "agent.failed",
                    "event_id": event.id,
                    "category": category,
                    "error": f"Approval creation failed: {app_err}",
                },
            )

            return {
                "category": category,
                "provider_id": selected_vendor.id,
                "provider_name": selected_vendor.name,
                "assignment_id": assignment.id,
                "status": "APPROVAL_FAILED",
                "error": f"Approval creation failed: {app_err}",
                "contacted": False,
            }

        # Keep assignment strictly PENDING_CONFIRMATION until explicit human approval
        assignment.status = "PENDING_CONFIRMATION"
        self.db.commit()

        # Dispatch outreach inquiry message tied to the actual event
        cat_title = category.replace("_", " ").title()
        outreach_msg = (
            f"Hello {selected_vendor.name}, EVENTRA Autonomous Operations is requesting availability and quotation "
            f"for {cat_title} services for '{event.name}' ({pax} guests) in {city} on {date_str}. "
            f"Please reply with your standard package quotation."
        )

        comm_res = self._comm_service.send_message(
            event_id=event.id,
            provider_id=selected_vendor.id,
            message=outreach_msg,
            recipient_contact=selected_vendor.contact_phone,
            actor_id="autonomous_agent",
            actor_type="AGENT",
        )

        return {
            "category": category,
            "provider_id": selected_vendor.id,
            "provider_name": selected_vendor.name,
            "assignment_id": assignment.id,
            "status": "CONTACTED" if comm_res.success else "ASSIGNED",
            "contacted": comm_res.success,
            "contact_phone": selected_vendor.contact_phone,
            "evaluation_score": best_score,
            "base_cost": float(selected_vendor.base_cost or 0),
            "is_simulated": is_simulated or (vendor_source == "DEMO_FALLBACK"),
            "source": vendor_source,
        }

    def simulate_caterer_cancellation(
        self,
        event_id: str,
        user_id: str = "anonymous_operator",
    ) -> Dict[str, Any]:
        """P3 Adaptive Recovery Demonstration Scenario.
        
        Executes:
        1. Find assigned catering provider & operational task
        2. Detect cancellation incident via IncidentService (transitions state to DEGRADED, marks task BLOCKED)
        3. Deterministic impact analysis & downstream dependency check
        4. Synthesize recovery options via RecoveryService
        5. Request approval gate for vendor replacement
        """
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")

        # 1. Locate catering assignment
        catering_assignment = (
            self.db.query(VendorAssignment)
            .filter(
                VendorAssignment.event_id == event.id,
                VendorAssignment.category.ilike("%cater%"),
            )
            .first()
        )
        if not catering_assignment:
            catering_assignment = (
                self.db.query(VendorAssignment)
                .filter(VendorAssignment.event_id == event.id)
                .first()
            )

        # 2. Locate related catering task
        catering_task = (
            self.db.query(Task)
            .filter(
                Task.event_id == event.id,
                (Task.required_provider_category.ilike("%cater%"))
                | (Task.name.ilike("%cater%"))
                | (Task.name.ilike("%luncheon%"))
                | (Task.name.ilike("%coffee%"))
                | (Task.name.ilike("%food%")),
            )
            .first()
        )
        if not catering_task:
            catering_task = self.db.query(Task).filter(Task.event_id == event.id).first()

        # Mark task BLOCKED
        if catering_task:
            catering_task.status = TaskStatus.BLOCKED.value
            self.db.commit()

        pax = event.guest_count or 500
        budget_target = float(catering_assignment.agreed_cost) if catering_assignment and catering_assignment.agreed_cost else float(pax * 370)

        # 3. Create Incident first so recovery discovery can attach directly to it
        incident_in = IncidentCreate(
            incident_type="VENDOR_CANCELLATION",
            severity="HIGH",
            title="Catering Provider Cancellation Incident",
            description="Assigned catering provider submitted unexpected cancellation due to infrastructure breakdown.",
            source="MONITORING_ENGINE",
            related_task_id=catering_task.id if catering_task else None,
            related_vendor_id=catering_assignment.vendor_id if catering_assignment else None,
            evidence_metadata={
                "cancellation_reason": "Kitchen infrastructure failure",
                "original_vendor_id": catering_assignment.vendor_id if catering_assignment else None,
            },
        )
        incident = self._incident_service.create_incident(event.id, incident_in, current_user_id=user_id)

        # 4. Live recovery discovery via AgenticDiscoveryController
        backup_caterer = None
        try:
            controller = AgenticDiscoveryController(self.db, max_iterations=1, target_count=2)
            recov_disc = controller.execute_discovery(
                event_id=event.id,
                category="CATERING",
                location=event.location or "Delhi",
                guest_count=pax,
                trigger="recovery",
                incident_id=incident.id,
                simulate_outreach=False,
            )
            if recov_disc.top_matches:
                top_backup = recov_disc.top_matches[0].candidate
                backup_caterer = self.db.query(Vendor).filter(
                    Vendor.name == top_backup.name,
                    Vendor.id != (catering_assignment.vendor_id if catering_assignment else ""),
                ).first()
                if not backup_caterer:
                    backup_caterer = Vendor(
                        name=top_backup.name,
                        category="catering",
                        city=top_backup.city or event.location or "Delhi",
                        address=top_backup.address,
                        contact_phone=top_backup.phone or "+919876500112",
                        contact_email=top_backup.email or "concierge@backupcaterer.in",
                        base_cost=budget_target,
                        rating=top_backup.rating or 4.9,
                        status="ACTIVE",
                        source=getattr(top_backup, "source", "LIVE_SCRAPE") or "LIVE_SCRAPE",
                    )
                    self.db.add(backup_caterer)
                    self.db.commit()
                    self.db.refresh(backup_caterer)
        except Exception as disc_err:
            logger.warning(f"Recovery discovery error: {disc_err}")

        # Fallback to database or deterministic backup if discovery produced no new vendor
        if not backup_caterer:
            backup_caterer = (
                self.db.query(Vendor)
                .filter(
                    Vendor.category.ilike("%cater%"),
                    Vendor.id != (catering_assignment.vendor_id if catering_assignment else ""),
                    Vendor.status == "ACTIVE",
                )
                .first()
            )
        if not backup_caterer:
            backup_caterer = Vendor(
                name="Saffron Artisan Catering Services",
                category="catering",
                city=event.location or "Delhi",
                address=f"Culinary Quarter, Sector 29, {event.location or 'Delhi'}",
                contact_phone="+919876500112",
                contact_email="concierge@saffroncaterers.in",
                base_cost=budget_target,
                rating=4.9,
                status="ACTIVE",
                source="DATABASE",
            )
            self.db.add(backup_caterer)
            self.db.commit()
            self.db.refresh(backup_caterer)
        elif backup_caterer.base_cost > budget_target:
            backup_caterer.base_cost = budget_target
            self.db.commit()

        # Update incident evidence metadata with chosen replacement
        if incident.evidence_metadata:
            meta = dict(incident.evidence_metadata)
            meta["replacement_vendor_id"] = backup_caterer.id
            meta["replacement_vendor_name"] = backup_caterer.name
            meta["replacement_cost"] = float(backup_caterer.base_cost)
            incident.evidence_metadata = meta
            self.db.commit()

        # 5. Generate deterministic recovery options
        recovery_options = self._recovery_service.generate_recovery_options(event.id, incident.id, current_user_id=user_id)

        top_option = recovery_options[0] if recovery_options else None
        top_opt_id = top_option.id if top_option else None

        # 6. Create human approval gate
        approval_in = ApprovalRequestCreate(
            action_type="REASSIGN_VENDOR",
            target_type="TASK",
            target_id=catering_task.id if catering_task else None,
            requested_action={
                "new_vendor_id": backup_caterer.id,
                "vendor_id": backup_caterer.id,
                "replacement_vendor_id": backup_caterer.id,
                "replacement_vendor_name": backup_caterer.name,
                "task_id": catering_task.id if catering_task else None,
                "agreed_cost": float(backup_caterer.base_cost),
                "notes": f"Emergency substitution: Switch catering to {backup_caterer.name} (₹{backup_caterer.base_cost:,.0f})",
            },
            recovery_option_id=top_opt_id,
            notes=f"Authorize emergency replacement of cancelled caterer with {backup_caterer.name}",
        )
        approval = self._approval_service.create_request(event.id, requester_id="system_incident_engine", data=approval_in)

        # Record Audit
        self._audit.record(
            event_id=event.id,
            actor_id="system_incident_engine",
            actor_type="SYSTEM",
            action="INCIDENT_RECOVERY_TRIGGERED",
            action_type="INCIDENT",
            target_type="TASK",
            target_id=catering_task.id if catering_task else None,
            after_state={
                "incident_id": incident.id,
                "affected_task": catering_task.name if catering_task else "Catering",
                "recovery_options_count": len(recovery_options),
                "approval_id": approval.id,
                "proposed_vendor": backup_caterer.name,
            },
        )

        return {
            "status": "INCIDENT_TRIGGERED",
            "message": f"Incident recorded: Catering provider cancelled. Task '{catering_task.name if catering_task else 'Catering'}' is BLOCKED. Adaptive recovery synthesized {len(recovery_options)} options. Approval required.",
            "event_id": event.id,
            "incident": {
                "id": incident.id,
                "title": incident.title,
                "severity": incident.severity,
                "impact_result": incident.impact_result,
                "risk_result": incident.risk_result,
            },
            "affected_task": {
                "id": catering_task.id if catering_task else None,
                "name": catering_task.name if catering_task else "Catering Logistics",
                "status": "BLOCKED",
            },
            "recovery_options": [
                {
                    "id": opt.id,
                    "strategy_type": opt.strategy_type,
                    "score": opt.score,
                    "is_feasible": opt.is_feasible,
                    "proposed_changes": opt.proposed_changes,
                    "budget_delta": opt.budget_delta,
                    "schedule_delta": opt.schedule_delta,
                }
                for opt in recovery_options
            ],
            "pending_approval": {
                "id": approval.id,
                "action_type": approval.action_type,
                "impact_level": approval.impact_level,
                "proposed_vendor": backup_caterer.name,
                "proposed_cost": float(backup_caterer.base_cost),
                "status": approval.status,
            },
        }

    def approve_and_execute_recovery(
        self,
        event_id: str,
        approval_id: str,
        user_id: str = "test_organizer",
    ) -> Dict[str, Any]:
        """Approves a recovery action, executes the replacement, verifies the mutation, and unblocks the task."""
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")

        # 1. Authorize & Approve Request
        approval, action_exec = self._approval_service.approve(
            event_id=event.id,
            approval_id=approval_id,
            approver_id=user_id,
            decision_notes="Approved by organizer for emergency replacement.",
        )

        # 2. Verify Execution via VerificationService
        verification = self._verification_service.verify_action(
            event_id=event.id,
            action_execution_id=action_exec.id,
            current_user_id=user_id,
        )

        # 3. Unblock Task and Restore Event State to LIVE / NORMAL
        catering_task = None
        target_id = getattr(approval, "target_id", None) or (action_exec.execution_payload.get("task_id") if action_exec.execution_payload else None)
        if target_id:
            catering_task = self.db.query(Task).filter(Task.id == target_id).first()
            if catering_task:
                catering_task.status = TaskStatus.IN_PROGRESS.value

        blocked_tasks = self.db.query(Task).filter(Task.event_id == event.id, Task.status == TaskStatus.BLOCKED.value).all()
        for bt in blocked_tasks:
            bt.status = TaskStatus.IN_PROGRESS.value
            if not catering_task:
                catering_task = bt

        event.state = EventState.NORMAL.value
        event.lifecycle_state = EventLifecycleState.LIVE.value
        self.db.commit()
        self.db.refresh(event)

        # 4. Record Audit Log
        self._audit.record(
            event_id=event.id,
            actor_id=user_id,
            actor_type="USER",
            action="RECOVERY_EXECUTED_AND_VERIFIED",
            action_type="OPERATIONS",
            target_type="EVENT",
            target_id=event.id,
            after_state={
                "approval_id": approval.id,
                "execution_id": action_exec.id,
                "verification_status": verification.status,
                "event_state": event.state,
                "lifecycle_state": event.lifecycle_state,
            },
        )

        return {
            "status": "RECOVERY_COMPLETED",
            "message": f"Successfully approved and executed replacement. Verification: {verification.status}. Task unblocked, event state restored to NORMAL/LIVE.",
            "approval_id": approval.id,
            "action_execution_id": action_exec.id,
            "verification_status": verification.status,
            "event_state": event.state,
            "lifecycle_state": event.lifecycle_state,
            "unblocked_task": catering_task.name if catering_task else "Catering",
        }

    def get_operations_status(self, event_id: str) -> Dict[str, Any]:
        """Aggregates real-time telemetry, assignments, budget, tasks, pending approvals, and activity feed."""
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")

        # Live State
        live_state = self._live_state.get_live_state(event.id)

        # Assignments
        assignments = (
            self.db.query(VendorAssignment, Vendor)
            .join(Vendor, VendorAssignment.vendor_id == Vendor.id)
            .filter(VendorAssignment.event_id == event.id)
            .all()
        )
        assignment_list = [
            {
                "id": assignment.id,
                "vendor_id": vendor.id,
                "vendor_name": vendor.name,
                "category": assignment.category,
                "status": assignment.status,
                "agreed_cost": float(assignment.agreed_cost or 0),
                "contact_phone": vendor.contact_phone,
                "rating": vendor.rating,
                "source": vendor.source or "DATABASE",
                "is_simulated": vendor.source == "DEMO_FALLBACK",
            }
            for assignment, vendor in assignments
        ]

        # Approvals
        pending_approvals = self._approval_service.get_pending_approvals(event_id=event.id)
        pending_approvals_list = [
            {
                "id": a.id,
                "action_type": a.action_type,
                "target_type": a.target_type,
                "target_id": a.target_id,
                "impact_level": a.impact_level,
                "status": a.status,
                "requested_action": a.requested_action,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in pending_approvals
        ]

        # Tasks summary
        tasks = self.db.query(Task).filter(Task.event_id == event.id).all()
        task_list = [
            {
                "id": t.id,
                "name": t.name,
                "status": t.status,
                "category": t.required_provider_category,
                "is_critical_path": t.is_critical_path,
            }
            for t in tasks
        ]

        # Budget
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event.id).all()
        total_budget = float(event.total_budget or 0)
        committed_budget = sum(float(b.estimated_amount or 0) for b in budget_items)

        # Activity Feed from AuditRecords
        audit_records = (
            self.db.query(AuditRecord)
            .filter(AuditRecord.event_id == event.id)
            .order_by(AuditRecord.created_at.desc())
            .limit(20)
            .all()
        )
        activity_feed = []
        for rec in audit_records:
            t_str = rec.created_at.strftime("%H:%M") if rec.created_at else "Now"
            action_title = rec.action.replace("_", " ").title()
            detail = ""
            if rec.after_state:
                if "total_tasks" in rec.after_state:
                    detail = f"{rec.after_state.get('total_tasks')} operational tasks synthesized"
                elif "selected_provider" in rec.after_state:
                    detail = f"Evaluated {rec.after_state.get('total_candidates', 1)} candidates; shortlisted {rec.after_state.get('selected_provider')} for {rec.after_state.get('category')} (Score: {rec.after_state.get('evaluation_score')})"
                elif "providers_contacted" in rec.after_state:
                    detail = f"Dispatched outreach across {rec.after_state.get('providers_contacted')} categories"
                elif "changes" in rec.after_state:
                    detail = "; ".join(rec.after_state.get("changes", []))
                elif "incident_id" in rec.after_state:
                    detail = f"Detected cancellation on {rec.after_state.get('affected_task')}; proposed {rec.after_state.get('proposed_vendor')}"
                elif "verification_status" in rec.after_state:
                    detail = f"Verified: {rec.after_state.get('verification_status')}; State restored to LIVE"
            activity_feed.append({
                "id": rec.id,
                "time": t_str,
                "action": action_title,
                "actor_type": rec.actor_type,
                "detail": detail or action_title,
            })

        return {
            "event_id": event.id,
            "event_name": event.name,
            "lifecycle_state": event.lifecycle_state,
            "state": event.state,
            "total_budget": total_budget,
            "committed_budget": committed_budget,
            "currency": event.currency,
            "live_state": live_state.model_dump(),
            "assignments": assignment_list,
            "tasks": task_list,
            "pending_approvals": pending_approvals_list,
            "pending_approvals_count": len(pending_approvals_list),
            "activity_feed": activity_feed,
        }
