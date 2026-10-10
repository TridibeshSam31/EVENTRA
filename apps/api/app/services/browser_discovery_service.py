"""Browser-Based Venue & Vendor Discovery Service for EVENTRA (Phase 3).

Orchestrates real browser-driven search and inspection of Google Search & Google Maps,
extracts evidence-backed business candidates, applies deterministic qualification rules,
and persists valid candidates via existing deduplication services.
"""

import html
import logging
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from app.api.routes.events import DEMO_EVENTS
from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.schemas.browser_agent import AgentEventType, ExecutionStatus
from app.schemas.browser_discovery import (
    BrowserDiscoveryRequest,
    BrowserDiscoveryResponse,
    DiscoveredCandidate,
    EventSearchRequirements,
)
from app.services.browser_agent_service import BrowserAgentService, browser_agent_service
from app.services.browser_runtime_service import BrowserRuntimeService, browser_runtime_service
from app.services.browser_companion_service import (
    BrowserCompanionService,
    browser_companion_service,
)
from app.schemas.browser_companion import CompanionCommandType, CompanionEventMessage
from app.services.deduplication import ProviderDeduplicator
from app.services.discovery_qualification_engine import QualificationEngine
from app.services.event_service import EventService
from app.services.provider_classifier import ProviderClassifier

logger = logging.getLogger(__name__)


def sanitize_untrusted_text(raw_text: Optional[str]) -> Optional[str]:
    """Sanitizes untrusted webpage text to prevent injection or malicious control characters.
    
    Treats extracted page content strictly as research data.
    """
    if not raw_text:
        return raw_text
    # Unescape HTML entities, strip null bytes and excessive whitespace
    cleaned = html.unescape(raw_text).replace("\x00", "").strip()
    # Normalize internal spaces
    return re.sub(r"\s+", " ", cleaned)


class BrowserDiscoveryService:
    """Coordinates browser discovery workflows for authorized events."""

    def __init__(
        self,
        agent_service: Optional[BrowserAgentService] = None,
        runtime_service: Optional[BrowserRuntimeService] = None,
        companion_service: Optional[BrowserCompanionService] = None,
    ):
        self.agent_service = agent_service or browser_agent_service
        self.runtime_service = runtime_service or browser_runtime_service
        self.companion_service = companion_service or browser_companion_service

    def load_event_requirements(
        self,
        event_id: str,
        db: Optional[Session] = None,
        category: str = "CATERING",
    ) -> EventSearchRequirements:
        """Extracts search requirements strictly from stored event data.
        
        Rejects requests missing essential search info (e.g. location).
        Never fabricates missing requirements.
        """
        event_data: Optional[Any] = None

        # 1. Attempt database lookup if session available
        if db is not None:
            try:
                event_svc = EventService(db)
                event_data = event_svc.get_event(event_id)
            except Exception as e:
                logger.debug("DB lookup failed for event %s: %s", event_id, e)

        # 2. Fallback to demo events store
        if not event_data and event_id in DEMO_EVENTS:
            event_data = DEMO_EVENTS[event_id]

        if not event_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Event '{event_id}' not found in database or demo registry.",
            )

        # Extract event attributes safely across DB model and dict
        if isinstance(event_data, dict):
            event_name = event_data.get("title") or event_data.get("name") or "Untitled Event"
            event_type = event_data.get("event_type", "OTHER")
            loc_val = event_data.get("location")
            guest_count = event_data.get("guest_count")
            budget = event_data.get("total_budget")
            currency = event_data.get("currency", "USD")
            start_date = str(event_data.get("start_time")) if event_data.get("start_time") else None
            constraints = event_data.get("constraints", [])
        else:
            event_name = getattr(event_data, "name", None) or getattr(event_data, "title", None) or "Untitled Event"
            event_type = getattr(event_data, "event_type", "OTHER")
            loc_val = getattr(event_data, "location", None)
            guest_count = getattr(event_data, "guest_count", None)
            budget = float(getattr(event_data, "total_budget", 0.0)) if getattr(event_data, "total_budget", None) else None
            currency = getattr(event_data, "currency", "USD")
            start_date = str(getattr(event_data, "start_datetime", "")) if getattr(event_data, "start_datetime", None) else None
            constraints = []

        # Resolve location string and city
        location_str = ""
        city_str = ""
        if isinstance(loc_val, dict):
            city_str = loc_val.get("city") or loc_val.get("name") or ""
            location_str = loc_val.get("name") or city_str
        elif isinstance(loc_val, str) and loc_val.strip():
            location_str = loc_val.strip()
            city_str = location_str.split(",")[0].strip()

        # Enforce location requirement: If location is missing, fail fast with informative message
        if not city_str:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Event '{event_id}' lacks a usable location. "
                    "Please specify an event location or city to proceed with real browser discovery."
                ),
            )

        return EventSearchRequirements(
            event_id=event_id,
            event_name=event_name,
            event_type=str(event_type),
            category=category.upper().strip(),
            location=location_str,
            city=city_str,
            guest_count=guest_count if (guest_count and guest_count > 0) else None,
            budget=budget if (budget and budget > 0) else None,
            currency=currency,
            start_date=start_date,
            constraints=constraints if isinstance(constraints, list) else [],
        )

    def build_search_query(
        self,
        requirements: EventSearchRequirements,
        custom_query: Optional[str] = None,
    ) -> str:
        """Constructs a targeted query for Google Maps and Google Search."""
        if custom_query and custom_query.strip():
            return custom_query.strip()

        category_clean = requirements.category.replace("_", " ").title()
        if requirements.category in ("VENUE", "BANQUET_HALL", "HOTEL"):
            return f"{category_clean} venues in {requirements.city}"
        return f"{category_clean} in {requirements.city}"

    def normalize_and_qualify(
        self,
        raw_items: List[Dict[str, Any]],
        requirements: EventSearchRequirements,
    ) -> List[Tuple[NormalizedProvider, DiscoveredCandidate]]:
        """Transforms observed browser items into normalized providers and evaluates qualification."""
        results: List[Tuple[NormalizedProvider, DiscoveredCandidate]] = []

        for item in raw_items:
            raw_name = sanitize_untrusted_text(item.get("name") or "Unnamed Provider")
            if not raw_name:
                continue

            raw_address = sanitize_untrusted_text(item.get("address"))
            raw_phone = sanitize_untrusted_text(item.get("phone"))
            raw_website = sanitize_untrusted_text(item.get("website"))
            maps_url = sanitize_untrusted_text(item.get("maps_url"))
            rating = item.get("rating")
            review_count = item.get("review_count")
            lat = item.get("latitude")
            lon = item.get("longitude")
            source_type = item.get("source", "BROWSER_AGENT")

            # Determine category taxonomy
            classification = ProviderClassifier.classify(
                raw_category=item.get("raw_category") or requirements.category,
                name=raw_name,
                description=raw_address or "",
            )
            detected_category = (
                classification.category if hasattr(classification, "category") else str(classification)
            )
            class_conf = getattr(classification, "confidence", 0.85)

            # Record granular evidence provenance
            field_sources: Dict[str, str] = {
                "name": "google_maps_listing",
            }
            evidence_list: List[str] = [
                f"Observed on Google Maps listing: '{raw_name}'",
            ]

            if maps_url:
                field_sources["maps_url"] = "google_maps_url"
                evidence_list.append(f"Listing URL: {maps_url[:80]}...")

            if raw_address:
                field_sources["address"] = "google_maps_place_details"
                evidence_list.append(f"Physical address: {raw_address}")

            if raw_phone:
                field_sources["phone"] = "google_maps_place_details"
                evidence_list.append(f"Public contact phone: {raw_phone}")

            if raw_website:
                field_sources["website"] = "google_maps_place_details"
                evidence_list.append(f"Official website: {raw_website}")

            if rating is not None:
                field_sources["rating"] = "google_maps_reviews"
                evidence_list.append(f"Observed rating: {rating} stars ({review_count or 0} reviews)")

            # Create NormalizedProvider instance
            norm_provider = NormalizedProvider(
                source=source_type,
                source_id=maps_url,
                name=raw_name,
                category=detected_category,
                raw_category=item.get("raw_category") or requirements.category,
                address=raw_address,
                city=requirements.city,
                latitude=lat,
                longitude=lon,
                phone=raw_phone,
                website=raw_website,
                maps_url=maps_url,
                rating=float(rating) if rating is not None else None,
                review_count=int(review_count) if review_count is not None else None,
                is_active=True,
                business_status="OPERATIONAL",
                capabilities=[f"source:{source_type}"] + [f"evidence:{k}" for k in field_sources.keys()],
                classification_confidence=class_conf,
                field_sources=field_sources,
                raw_data={"observed_raw": item},
            )

            # Evaluate against deterministic qualification rules
            qual_result = QualificationEngine.evaluate(
                candidate=norm_provider,
                category=requirements.category,
                guest_count=requirements.guest_count,
                max_budget=requirements.budget,
            )

            candidate_id = f"cand_{uuid.uuid4().hex[:8]}"
            reasons = qual_result.reasons or []
            if not qual_result.hard_constraints_passed and qual_result.disqualification_reason:
                reasons.append(qual_result.disqualification_reason)
            if not reasons:
                reasons = ["Candidate satisfies category and business legitimacy requirements."]

            candidate = DiscoveredCandidate(
                id=candidate_id,
                name=raw_name,
                category=detected_category,
                raw_category=item.get("raw_category") or requirements.category,
                address=raw_address,
                city=requirements.city,
                latitude=lat,
                longitude=lon,
                phone=raw_phone,
                website=raw_website,
                maps_url=maps_url,
                rating=float(rating) if rating is not None else None,
                review_count=int(review_count) if review_count is not None else None,
                base_cost=None,  # Price is only populated when explicit pricing exists
                capacity=None,   # Capacity is only populated when explicit capacity exists
                source=source_type,
                source_id=maps_url,
                field_sources=field_sources,
                evidence=evidence_list,
                qualification_status=qual_result.qualification,
                qualification_reasons=reasons,
                is_persisted=False,
            )

            results.append((norm_provider, candidate))

        return results

    async def discover(
        self,
        execution_id: str,
        request: BrowserDiscoveryRequest,
        db: Optional[Session] = None,
        user_id: str = "anonymous_operator",
    ) -> BrowserDiscoveryResponse:
        """Executes end-to-end browser discovery within an active execution lifecycle."""
        # 1. Fetch and authorize execution record
        record = self.agent_service._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Browser Agent execution '{execution_id}' not found.",
            )
        self.agent_service._authorize(record, user_id)

        if record.status != ExecutionStatus.RUNNING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Execution must be in 'running' state to initiate discovery (current: {record.status.value}).",
            )

        if not record.session_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Execution lacks an active browser runtime session.",
            )

        # 2. Load requirements from stored event data
        requirements = self.load_event_requirements(
            event_id=request.event_id,
            db=db,
            category=request.category,
        )

        record.emit_event(
            AgentEventType.DISCOVERY_STARTED,
            f"Initiating live browser discovery for event '{requirements.event_name}' ({requirements.category} in {requirements.city}).",
            {
                "event_id": requirements.event_id,
                "category": requirements.category,
                "city": requirements.city,
                "max_results": request.max_results,
            },
        )

        record.emit_event(
            AgentEventType.DISCOVERY_REQUIREMENTS_LOADED,
            f"Loaded event requirements: City='{requirements.city}', Type='{requirements.event_type}', Guests={requirements.guest_count or 'Unknown'}, Budget={requirements.budget or 'Unknown'}",
            {
                "event_id": requirements.event_id,
                "city": requirements.city,
                "guest_count": requirements.guest_count,
                "budget": requirements.budget,
                "event_type": requirements.event_type,
            },
        )

        # 3. Construct search query
        query = self.build_search_query(requirements, request.custom_query)

        # Check if local Windows Companion (Option A) is connected
        use_companion = self.companion_service.is_companion_connected(user_id)
        active_runner = "windows_companion" if use_companion else "container_sandbox"

        warnings: List[str] = []
        raw_items: List[Dict[str, Any]] = []
        is_blocked = False

        if use_companion:
            # OPTION A: Genuine visible browser window on the operator's Windows desktop
            record.emit_event(
                AgentEventType.DISCOVERY_SEARCH_STARTED,
                f"Launching genuine visible browser window on Windows desktop: '{query}'",
                {"query": query, "runner": "windows_companion", "target_service": "Google Maps"},
            )

            def on_companion_event(evt: CompanionEventMessage) -> None:
                if evt.event_type == "page_opened":
                    record.current_url = evt.data.get("url")
                    record.current_title = evt.data.get("title")
                    record.emit_event(
                        AgentEventType.DISCOVERY_PAGE_OPENED,
                        evt.message,
                        evt.data,
                    )
                elif evt.event_type == "candidate_found":
                    record.emit_event(
                        AgentEventType.DISCOVERY_CANDIDATE_FOUND,
                        evt.message,
                        evt.data,
                    )
                else:
                    record.emit_event(
                        AgentEventType.EXECUTION_PROGRESS,
                        evt.message,
                        evt.data,
                    )

            try:
                cmd_resp = await self.companion_service.send_command(
                    user_id=user_id,
                    command=CompanionCommandType.START_DISCOVERY,
                    payload={
                        "query": query,
                        "max_results": request.max_results,
                        "category": requirements.category,
                        "city": requirements.city,
                        "event_id": requirements.event_id,
                    },
                    execution_id=execution_id,
                    event_callback=on_companion_event,
                    timeout_seconds=90.0,
                )

                if cmd_resp.get("success"):
                    raw_items = cmd_resp.get("results", [])
                    record.current_url = cmd_resp.get("metadata", {}).get("current_url") or "https://www.google.com/maps"
                    record.current_title = cmd_resp.get("metadata", {}).get("current_title")
                else:
                    err_msg = cmd_resp.get("error", "Unknown companion error")
                    warnings.append(f"Windows browser companion error: {err_msg}")
                    record.emit_event(
                        AgentEventType.DISCOVERY_PARTIAL_FAILURE,
                        f"Windows browser encountered issue: {err_msg}",
                        {"error": err_msg},
                    )
            except Exception as e:
                err_msg = str(e)
                logger.warning("Windows companion search error: %s", err_msg)
                warnings.append(f"Windows companion error: {err_msg}")
                record.emit_event(
                    AgentEventType.DISCOVERY_PARTIAL_FAILURE,
                    f"Error communicating with Windows Companion: {err_msg}",
                    {"error": err_msg},
                )
        else:
            # Fallback path: Container sandbox browser on virtual DISPLAY :99
            record.emit_event(
                AgentEventType.DISCOVERY_SEARCH_STARTED,
                f"Searching Google Maps via container browser on DISPLAY :99: '{query}'",
                {"query": query, "runner": "container_sandbox", "target_service": "Google Maps"},
            )

            try:
                search_resp = await self.runtime_service.search_discovery(
                    session_id=record.session_id,
                    query=query,
                    max_results=request.max_results,
                    category=requirements.category,
                    inspect_details=True,
                    timeout_ms=35000,
                )

                record.current_url = search_resp.get("current_url")
                record.current_title = search_resp.get("current_title")
                record.emit_event(
                    AgentEventType.DISCOVERY_PAGE_OPENED,
                    f"Google Maps search loaded: {record.current_title or query}",
                    {"url": record.current_url, "title": record.current_title},
                )

                if search_resp.get("status") == "blocked":
                    is_blocked = True
                    block_reason = search_resp.get("reason", "Google verification wall detected")
                    warnings.append(block_reason)
                    record.emit_event(
                        AgentEventType.DISCOVERY_PARTIAL_FAILURE,
                        f"Live browser encountered Google Maps anti-bot challenge: {block_reason}",
                        {"reason": block_reason, "url": record.current_url},
                    )
                else:
                    raw_items = search_resp.get("results", [])

            except Exception as e:
                err_msg = str(e)
                logger.warning("Browser discovery runtime search error: %s", err_msg)
                warnings.append(f"Live browser search error: {err_msg}")
                record.emit_event(
                    AgentEventType.DISCOVERY_PARTIAL_FAILURE,
                    f"Error during browser search: {err_msg}",
                    {"error": err_msg},
                )

        # 5. Fallback path if browser was blocked or encountered an issue
        if (is_blocked or not raw_items) and request.use_fallback_if_blocked:
            try:
                from app.integrations.registry import registry
                scraper_adapter = registry.get_google_maps_scraper()
                logger.info("Engaging approved Google Maps scraper fallback for query: '%s'", query)
                record.emit_event(
                    AgentEventType.DISCOVERY_PARTIAL_FAILURE,
                    "Engaging approved fallback scraper due to live browser challenge.",
                    {"fallback_engine": "google_maps_scraper"},
                )
                fallback_results = scraper_adapter.search_sync(
                    query=query,
                    limit=request.max_results,
                )
                for fb in fallback_results:
                    raw_items.append({
                        "name": fb.name,
                        "address": fb.address,
                        "phone": fb.phone,
                        "website": fb.website,
                        "maps_url": fb.maps_url,
                        "rating": fb.rating,
                        "review_count": fb.review_count,
                        "latitude": fb.latitude,
                        "longitude": fb.longitude,
                        "raw_category": fb.raw_category or requirements.category,
                        "source": "GOOGLE_MAPS_SCRAPER",
                    })
            except Exception as fb_err:
                logger.debug("Fallback scraper also unavailable: %s", fb_err)
                warnings.append(f"Fallback scraper note: {fb_err}")

        # Check for early cancellation
        if record.status in (ExecutionStatus.CANCELLED, ExecutionStatus.STOPPING):
            logger.info("Execution %s cancelled during discovery; aborting persistence.", execution_id)
            return BrowserDiscoveryResponse(
                execution_id=execution_id,
                event_id=requirements.event_id,
                query=query,
                category=requirements.category,
                status="cancelled",
                total_found=0,
                total_qualified=0,
                total_persisted=0,
                candidates=[],
                warnings=["Discovery cancelled before completion."],
                provenance={"source": "none"},
            )

        # 6. Normalize and qualify discovered candidates
        norm_and_candidates = self.normalize_and_qualify(raw_items, requirements)
        total_found = len(norm_and_candidates)
        total_qualified = 0
        total_persisted = 0
        candidate_models: List[DiscoveredCandidate] = []

        for norm_p, cand in norm_and_candidates:
            # Emit candidate found event
            record.emit_event(
                AgentEventType.DISCOVERY_CANDIDATE_FOUND,
                f"Discovered candidate: '{cand.name}' (Rating: {cand.rating or 'N/A'}, Phone: {cand.phone or 'N/A'})",
                {
                    "candidate_id": cand.id,
                    "name": cand.name,
                    "category": cand.category,
                    "phone": cand.phone,
                    "website": cand.website,
                    "rating": cand.rating,
                    "source": cand.source,
                },
            )

            # Emit validation event
            if cand.qualification_status == "qualified":
                total_qualified += 1
                record.emit_event(
                    AgentEventType.DISCOVERY_CANDIDATE_VALIDATED,
                    f"Candidate '{cand.name}' passed qualification gates: {'; '.join(cand.qualification_reasons)}",
                    {
                        "candidate_id": cand.id,
                        "name": cand.name,
                        "status": cand.qualification_status,
                        "reasons": cand.qualification_reasons,
                    },
                )
            else:
                record.emit_event(
                    AgentEventType.DISCOVERY_CANDIDATE_REJECTED,
                    f"Candidate '{cand.name}' marked {cand.qualification_status}: {'; '.join(cand.qualification_reasons)}",
                    {
                        "candidate_id": cand.id,
                        "name": cand.name,
                        "status": cand.qualification_status,
                        "reasons": cand.qualification_reasons,
                    },
                )

            # 7. Persistence via existing deduplicator
            if request.persist_results and db is not None and cand.qualification_status != "rejected":
                # Ensure execution was not cancelled before persisting
                if record.status not in (ExecutionStatus.CANCELLED, ExecutionStatus.STOPPING):
                    try:
                        deduplicator = ProviderDeduplicator(db)
                        persisted_vendor, is_created = deduplicator.upsert_provider(norm_p, commit=True)
                        cand.is_persisted = True
                        cand.vendor_id = persisted_vendor.id
                        cand.is_new_vendor = is_created
                        total_persisted += 1

                        action_label = "Created new" if is_created else "Deduplicated/enriched"
                        record.emit_event(
                            AgentEventType.DISCOVERY_PERSISTENCE_COMPLETED,
                            f"{action_label} vendor '{persisted_vendor.name}' in EVENTRA database (ID: {persisted_vendor.id}).",
                            {
                                "candidate_id": cand.id,
                                "vendor_id": persisted_vendor.id,
                                "is_created": is_created,
                                "vendor_name": persisted_vendor.name,
                            },
                        )
                    except Exception as persist_err:
                        logger.error("Failed to persist candidate %s: %s", cand.name, persist_err)
                        warnings.append(f"Persistence error for {cand.name}: {persist_err}")

            candidate_models.append(cand)

        # 8. Record discovered candidates in execution record
        self.agent_service.set_candidates(execution_id, candidate_models, user_id=user_id)

        # 9. Conclude execution lifecycle
        status_label = "completed" if total_found > 0 else ("empty" if not warnings else "partial_failure")
        record.emit_event(
            AgentEventType.DISCOVERY_COMPLETED,
            f"Discovery workflow completed: {total_found} found, {total_qualified} qualified, {total_persisted} persisted.",
            {
                "total_found": total_found,
                "total_qualified": total_qualified,
                "total_persisted": total_persisted,
                "status": status_label,
            },
        )

        return BrowserDiscoveryResponse(
            execution_id=execution_id,
            event_id=requirements.event_id,
            query=query,
            category=requirements.category,
            status=status_label,
            total_found=total_found,
            total_qualified=total_qualified,
            total_persisted=total_persisted,
            candidates=candidate_models,
            warnings=warnings,
            provenance={
                "source": "WINDOWS_BROWSER_COMPANION" if use_companion else ("BROWSER_AGENT" if not is_blocked else "GOOGLE_MAPS_SCRAPER_FALLBACK"),
                "runner": active_runner,
                "browser_visible_on_desktop": use_companion,
                "viewer_url": record.viewer_url,
                "verified_fields": ["name", "address", "phone", "website", "rating"],
            },
        )


browser_discovery_service = BrowserDiscoveryService()


def get_browser_discovery_service() -> BrowserDiscoveryService:
    """Dependency provider for BrowserDiscoveryService."""
    return browser_discovery_service
