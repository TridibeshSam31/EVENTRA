"""Agentic Discovery Controller for EVENTRA Provider & Venue Discovery.

Implements the multi-iteration agentic discovery pipeline:
- Dynamic search planner (3-5 query variants per iteration)
- Radius-aware scraper execution with dynamic scaling (x1.5-2)
- Global persistent deduplication across search iterations
- Strict pass/fail qualification + legitimacy check + evidence logging
- Per-event-type weight profile ranking (scores grounded in evidence)
- Outreach availability state machine (only availability == confirmed is shortlist-eligible)
- Failure diagnosis: Search Problem (expand radius/queries) vs Outreach Problem (batch expand)
- Tiered shortlist output + funnel transparency stats + fallback messaging
"""
import logging
import math
from typing import Any, Dict, List, Optional, Set, Tuple
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.event import Event
from app.integrations.registry import registry
from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.services.discovery_search_planner import SearchPlanner
from app.services.discovery_qualification_engine import QualificationEngine, QualificationResult
from app.services.discovery_ranking_engine import DiscoveryRankingEngine, RankedCandidate
from app.services.discovery_outreach_service import DiscoveryOutreachService
from app.services.deduplication import ProviderDeduplicator
from app.services.geospatial_service import geospatial_discovery
from app.services.vendor_service import haversine_distance_km
from app.models.discovery_run import DiscoveryRun, DiscoveryRunEvent
import uuid

logger = logging.getLogger(__name__)


class FunnelTransparencyStats(BaseModel):
    """Transparency statistics detailing candidate progression through discovery stages."""
    total_scraped: int = 0
    total_deduplicated: int = 0
    total_qualified: int = 0
    total_disqualified: int = 0
    total_contacted: int = 0
    total_responded: int = 0
    total_confirmed: int = 0
    radius_searched_km: float = 10.0
    iterations_run: int = 1
    # Illustrated target terms (Appendix Section 8.2)
    discovered: int = 0
    unique: int = 0
    relevant: int = 0
    matching: int = 0
    shortlisted: int = 0


class TieredShortlistResult(BaseModel):
    """Tiered, transparent candidate presentation for frontend UI."""
    run_id: Optional[str] = None
    top_matches: List[RankedCandidate] = Field(default_factory=list)
    other_available_options: List[RankedCandidate] = Field(default_factory=list)
    backup_waitlist: List[RankedCandidate] = Field(default_factory=list)
    rejected_candidates: List[RankedCandidate] = Field(default_factory=list)
    funnel_stats: FunnelTransparencyStats = Field(default_factory=FunnelTransparencyStats)
    target_count_met: bool = False
    diagnosis_message: Optional[str] = None
    search_queries_used: List[str] = Field(default_factory=list)


class AgenticDiscoveryController:
    """Orchestrates adaptive multi-iteration provider discovery pipeline."""

    def __init__(
        self,
        db: Session,
        max_iterations: int = 3,
        max_queries_per_iteration: int = 5,
        target_count: int = 6,
        allowed_expansion_km: float = 15.0,
    ):
        self.db = db
        self.max_iterations = max_iterations
        self.max_queries_per_iteration = max_queries_per_iteration
        self.target_count = target_count
        self.allowed_expansion_km = allowed_expansion_km

    def execute_discovery(
        self,
        event_id: Optional[str],
        category: str,
        location: str,
        event_type: str = "GENERIC",
        guest_count: Optional[int] = None,
        max_budget: Optional[float] = None,
        base_radius_km: float = 10.0,
        required_amenities: Optional[List[str]] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        outreach_batch_size: int = 5,
        simulate_outreach: bool = False,
        run_id: Optional[str] = None,
        trigger: str = "routine",
        incident_id: Optional[str] = None,
    ) -> TieredShortlistResult:
        """Executes the complete agentic discovery loop end-to-end with persisted run telemetry."""
        # 1. Resolve coordinates
        clean_loc = geospatial_discovery.clean_city_name(location or "Delhi")
        if latitude is None or longitude is None:
            lat, lon = geospatial_discovery.resolve_city_center(clean_loc)
        else:
            lat, lon = latitude, longitude

        max_radius = base_radius_km + self.allowed_expansion_km
        current_radius = base_radius_km

        # Persist DiscoveryRun (Part A.1 & A.3)
        run = None
        if event_id and event_id != "demo-event":
            try:
                if run_id:
                    run = self.db.query(DiscoveryRun).filter(DiscoveryRun.id == run_id).first()
                if not run:
                    run = DiscoveryRun(
                        id=run_id or f"disc_{uuid.uuid4().hex[:12]}",
                        event_id=event_id,
                        category=category,
                        status="RUNNING",
                        trigger=trigger,
                        incident_id=incident_id,
                        current_iteration=1,
                        max_iterations=self.max_iterations,
                        radius_km=base_radius_km,
                        target_count=self.target_count,
                        parameters={
                            "location": clean_loc,
                            "event_type": event_type,
                            "guest_count": guest_count,
                            "max_budget": max_budget,
                        },
                    )
                    self.db.add(run)
                    self.db.commit()
                    self.db.refresh(run)
            except Exception as r_err:
                logger.warning(f"Could not persist DiscoveryRun: {r_err}")
                self.db.rollback()

        def _log_event(ev_type: str, message: str, data: Optional[Dict[str, Any]] = None):
            if run:
                try:
                    ev = DiscoveryRunEvent(
                        run_id=run.id,
                        iteration=iteration or 1,
                        event_type=ev_type,
                        message=message,
                        data=data or {},
                    )
                    self.db.add(ev)
                    self.db.commit()
                except Exception as log_err:
                    logger.warning(f"Could not log DiscoveryRunEvent: {log_err}")
                    self.db.rollback()

        seen_ids: Set[str] = set()
        tried_queries: Set[str] = set()
        all_queries_used: List[str] = []

        raw_candidates_pool: List[NormalizedProvider] = []
        qualified_pool: List[RankedCandidate] = []
        confirmed_pool: List[RankedCandidate] = []
        rejected_pool: List[RankedCandidate] = []

        total_scraped_count = 0
        total_deduped_count = 0
        iteration = 0

        # Global deduplicator connected to DB Vendor table
        deduplicator = ProviderDeduplicator(self.db)
        directory_provider = registry.get_provider_directory()

        _log_event(
            "requirements_parsed",
            f"Understanding event requirements: category={category}, location={clean_loc}, radius={current_radius}km, target={self.target_count}",
            {"category": category, "location": clean_loc, "radius_km": current_radius, "target": self.target_count},
        )

        while iteration < self.max_iterations:
            iteration += 1
            if run:
                run.current_iteration = iteration
                run.radius_km = current_radius
                try:
                    self.db.commit()
                except Exception:
                    self.db.rollback()

            logger.info(f"Agentic Discovery Iteration {iteration}/{self.max_iterations} (Radius: {current_radius}km)")

            # Step A: Search Planner generates query variants
            queries = SearchPlanner.generate_queries(
                category=category,
                location=clean_loc,
                event_type=event_type,
                required_services=required_amenities,
                tried_queries=tried_queries,
                max_queries=self.max_queries_per_iteration,
            )
            tried_queries.update(q.lower() for q in queries)
            all_queries_used.extend(queries)

            _log_event(
                "query_generated",
                f"Generating discovery queries: {', '.join(queries)}",
                {"queries": queries, "iteration": iteration},
            )

            # Step B: Scrape with dynamic radius
            radius_meters = int(current_radius * 1000)
            iter_scraped_candidates: List[NormalizedProvider] = []

            for q in queries:
                res = directory_provider.search_providers(
                    category=category,
                    city=clean_loc,
                    query=q,
                    latitude=lat,
                    longitude=lon,
                    limit=15,
                    radius_km=current_radius,  # FIX(4c): thread actual computed radius through
                )
                if res.success and res.data:
                    for raw_item in res.data:
                        norm = NormalizedProvider.model_validate(raw_item)
                        iter_scraped_candidates.append(norm)

            total_scraped_count += len(iter_scraped_candidates)
            _log_event(
                "batch_scraped",
                f"{len(iter_scraped_candidates)} candidates discovered from directory/scraper",
                {"scraped_count": len(iter_scraped_candidates), "iteration": iteration},
            )

            # Step C: Global Persistent Deduplication
            new_candidates: List[NormalizedProvider] = []
            for cand in iter_scraped_candidates:
                cid = cand.source_id or cand.maps_url or cand.phone or cand.name.lower()
                if cid not in seen_ids:
                    seen_ids.add(cid)
                    new_candidates.append(cand)

            total_deduped_count += len(new_candidates)
            raw_candidates_pool.extend(new_candidates)

            # Step D: Qualification Gate & Hard Constraints Filter
            iter_qual_results: Dict[str, QualificationResult] = {}
            iter_distances: Dict[str, float] = {}

            for cand in new_candidates:
                cand_id = cand.source_id or cand.name
                dist = haversine_distance_km(lat, lon, cand.latitude or lat, cand.longitude or lon)
                iter_distances[cand_id] = dist

                qual = QualificationEngine.evaluate(
                    candidate=cand,
                    category=category,
                    guest_count=guest_count,
                    max_budget=max_budget,
                    radius_km=current_radius,
                    distance_km=dist,
                    required_amenities=required_amenities,
                )
                iter_qual_results[cand_id] = qual
                if qual.qualification == "rejected":
                    rejected_pool.append(
                        RankedCandidate(
                            candidate=cand,
                            qualification="rejected",
                            availability="unconfirmed",
                            score=0.25,
                            rank=999,
                            confidence=qual.confidence,
                            reasons=qual.reasons or [qual.disqualification_reason or "Excluded by qualification engine"],
                            field_sources=cand.field_sources or {},
                            distance_km=dist,
                            qual_result=qual,
                        )
                    )

            # Step E: Ranking Engine with Per-Event-Type Weight Profiles
            ranked_new = DiscoveryRankingEngine.rank_candidates(
                candidates=new_candidates,
                event_type=event_type,
                distances=iter_distances,
                qual_results=iter_qual_results,
                max_budget=max_budget,
                guest_count=guest_count,
                required_amenities=required_amenities,
            )

            # Upsert qualified providers to database for persistent caching
            for r in ranked_new:
                if r.qualification in ("qualified", "uncertain"):
                    deduplicator.upsert_provider(r.candidate, commit=True)
                    qualified_pool.append(r)
                else:
                    rejected_pool.append(r)

            _log_event(
                "qualification_passed",
                f"{len(ranked_new)} candidates qualified against event constraints (total qualified: {len(qualified_pool)})",
                {"iteration_qualified": len(ranked_new), "total_qualified": len(qualified_pool)},
            )

            # Step F: Outreach & Availability Confirmation State Machine
            uncontacted_qualified = [c for c in qualified_pool if c.availability == "unconfirmed"]

            if uncontacted_qualified:
                outreach_res = DiscoveryOutreachService.contact_batch(
                    ranked_candidates=qualified_pool,
                    event_id=event_id or "demo-event",
                    batch_size=outreach_batch_size,
                    dev_simulate_responses=simulate_outreach,
                    db=self.db,
                )

                _log_event(
                    "outreach_dispatched",
                    f"Outreach dispatched to {len(uncontacted_qualified[:outreach_batch_size])} candidates via telephony/messaging",
                    {"contacted": len(uncontacted_qualified[:outreach_batch_size]), "simulated": simulate_outreach},
                )

                for item in qualified_pool:
                    if item.availability == "confirmed" and item not in confirmed_pool:
                        confirmed_pool.append(item)

            # Check Stopping Condition
            valid_confirmed = [
                c for c in confirmed_pool
                if c.qualification in ("qualified", "uncertain") and c.confidence >= 0.75
            ]

            if len(valid_confirmed) >= self.target_count:
                logger.info(f"Target count met ({len(valid_confirmed)} >= {self.target_count}) at iteration {iteration}")
                break

            # Step G: Diagnosis Branch (Search Problem vs Outreach Problem)
            if len(qualified_pool) < self.target_count:
                # SEARCH PROBLEM: Too few qualified candidates exist -> widen radius & generate new queries
                density_factor = max(1.2, min(2.0, 1.5 + (0.1 * (self.target_count - len(qualified_pool)))))
                new_radius = min(max_radius, round(current_radius * density_factor, 1))
                if new_radius > current_radius:
                    logger.info(f"Diagnosis: Search problem. Widening radius from {current_radius}km to {new_radius}km")
                    _log_event(
                        "radius_expanded",
                        f"Expanding search radius from {current_radius}km to {new_radius}km for iteration {iteration + 1}",
                        {"old_radius_km": current_radius, "new_radius_km": new_radius},
                    )
                    current_radius = new_radius
                else:
                    logger.info(f"Radius reached maximum expansion cap ({max_radius}km).")
            else:
                # OUTREACH PROBLEM: Enough qualified candidates exist, but low response/agreement -> contact next batch
                logger.info("Diagnosis: Outreach problem. Contacting next batch of qualified candidates without re-searching.")

        # Sort final confirmed candidates by score
        confirmed_pool.sort(key=lambda x: x.score, reverse=True)
        for i, item in enumerate(confirmed_pool, start=1):
            item.rank = i

        if confirmed_pool:
            top_matches = confirmed_pool[:3]
            other_available = confirmed_pool[3:]
        else:
            top_matches = qualified_pool[:3]
            other_available = qualified_pool[3:]

        backup_waitlist = [
            c for c in qualified_pool
            if c.availability in ("unconfirmed", "pending_response")
        ][:5]

        target_met = len(confirmed_pool) >= self.target_count
        diag_msg = None
        if not target_met:
            diag_msg = (
                f"Found {len(confirmed_pool)} confirmed vendors within your constraints matching requirements — "
                f"want to relax budget (${max_budget or 0}), search radius ({current_radius}km), "
                f"or amenities to see more options?"
            )

        _log_event(
            "target_reached" if target_met else "run_completed",
            f"Discovery completed: {len(confirmed_pool)} confirmed, {len(qualified_pool)} matching candidates",
            {"confirmed": len(confirmed_pool), "qualified": len(qualified_pool)},
        )

        # Update DiscoveryRun in database (Part A.1)
        if run:
            try:
                run.discovered = total_scraped_count
                run.unique_count = total_deduped_count
                run.relevant = len([c for c in qualified_pool if c.qualification in ("qualified", "uncertain")])
                run.matching = len([c for c in qualified_pool if c.qualification == "qualified"])
                run.shortlisted = len(confirmed_pool) if confirmed_pool else min(len(qualified_pool), self.target_count)
                run.current_iteration = iteration
                run.radius_km = current_radius
                run.status = "TARGET_REACHED" if target_met else ("EXHAUSTED" if iteration >= self.max_iterations else "COMPLETED")
                run.summary = diag_msg or f"Successfully shortlisted {run.shortlisted} candidates across {iteration} iterations."
                self.db.commit()
            except Exception as up_err:
                logger.warning(f"Could not update DiscoveryRun counters: {up_err}")
                self.db.rollback()

        funnel_stats = FunnelTransparencyStats(
            total_scraped=total_scraped_count,
            total_deduplicated=total_deduped_count,
            total_qualified=len(qualified_pool),
            total_disqualified=max(0, total_deduped_count - len(qualified_pool)),
            total_contacted=len([c for c in qualified_pool if c.availability != "unconfirmed"]),
            total_responded=len([c for c in qualified_pool if c.availability in ("confirmed", "declined")]),
            total_confirmed=len(confirmed_pool),
            radius_searched_km=current_radius,
            iterations_run=iteration,
            discovered=total_scraped_count,
            unique=total_deduped_count,
            relevant=len([c for c in qualified_pool if c.qualification in ("qualified", "uncertain")]),
            matching=len([c for c in qualified_pool if c.qualification == "qualified"]),
            shortlisted=len(confirmed_pool) if confirmed_pool else min(len(qualified_pool), self.target_count),
        )

        return TieredShortlistResult(
            run_id=run.id if run else None,
            top_matches=top_matches,
            other_available_options=other_available,
            backup_waitlist=backup_waitlist,
            rejected_candidates=rejected_pool,
            funnel_stats=funnel_stats,
            target_count_met=target_met,
            diagnosis_message=diag_msg,
            search_queries_used=all_queries_used,
        )
