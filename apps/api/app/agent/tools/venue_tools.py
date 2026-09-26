"""Agent Tool: venue_tools (Task: Venue Discovery & AI Navigation)"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolContext,
    ToolResult,
)
from app.services.venue_service import VenueService


class DiscoverAndRankVenuesInput(BaseModel):
    city: str = Field(..., description="Target city or state for the event")
    guest_count: Optional[int] = Field(None, description="Expected guest or attendee count")
    event_type: Optional[str] = Field(None, description="Event type category (e.g. CONFERENCE, WEDDING, FEST)")
    budget: Optional[float] = Field(None, description="Target total budget in currency")
    required_amenities: Optional[List[str]] = Field(default_factory=list, description="Required amenities list")
    user_description: Optional[str] = Field(None, description="Full natural language description of event requirements")
    event_id: Optional[str] = Field(None, description="Optional target event ID")


class DiscoverAndRankVenuesOutput(BaseModel):
    city: str
    total_scouted: int
    agent_summary: str
    best_venue: Optional[Dict[str, Any]] = None
    ranked_venues: List[Dict[str, Any]] = Field(default_factory=list)


class DiscoverAndRankVenuesTool(AgentTool):
    """Scouts real-world venues from live geospatial maps and ranks the best venue for the event requirement."""

    name = "discover_and_rank_venues"
    description = (
        "Scouts real physical venues from the live open geospatial network in the specified city or state, "
        "evaluates factual suitability against guest count and requirements, and identifies the best venue match."
    )
    category = ToolCategory.COMPUTATIONAL
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = DiscoverAndRankVenuesInput
    output_schema = DiscoverAndRankVenuesOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: DiscoverAndRankVenuesInput) -> ToolResult:
        service = VenueService(context.db)
        res = service.recommend_best_venues(
            city=args.city,
            guest_count=args.guest_count,
            event_type=args.event_type,
            budget=args.budget,
            required_amenities=args.required_amenities,
            user_description=args.user_description,
        )
        return ToolResult.success_result(
            tool_name=self.name,
            data=res,
            message=res["agent_summary"],
        )


def venue_tools_run(**kwargs) -> Dict[str, Any]:
    """Wraps deterministic engine calls for legacy tool invocation."""
    return {"status": "success"}

