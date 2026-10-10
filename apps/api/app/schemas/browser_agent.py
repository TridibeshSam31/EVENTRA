"""Pydantic schemas and lifecycle state models for EVENTRA Browser Agent (Phase 2)."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.services.browser_runtime_service import TabInfo


class ExecutionStatus(str, Enum):
    """Authoritative lifecycle states for Browser Agent executions."""
    CREATED = "created"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    DISCONNECTED = "disconnected"


class AgentEventType(str, Enum):
    """Standardized event types emitted during browser execution lifecycle."""
    EXECUTION_CREATED = "execution.created"
    EXECUTION_STARTING = "execution.starting"
    EXECUTION_RUNNING = "execution.running"
    BROWSER_NAVIGATING = "browser.navigating"
    BROWSER_NAVIGATION_COMPLETED = "browser.navigation_completed"
    BROWSER_TAB_OPENED = "browser.tab_opened"
    BROWSER_TAB_ACTIVATED = "browser.tab_activated"
    BROWSER_STATE_UPDATED = "browser.state_updated"
    EXECUTION_WAITING = "execution.waiting"
    EXECUTION_STOPPING = "execution.stopping"
    EXECUTION_COMPLETED = "execution.completed"
    EXECUTION_FAILED = "execution.failed"
    EXECUTION_CANCELLED = "execution.cancelled"
    BROWSER_DISCONNECTED = "browser.disconnected"

    # Phase 3: Discovery event types
    DISCOVERY_STARTED = "discovery.started"
    DISCOVERY_REQUIREMENTS_LOADED = "discovery.requirements_loaded"
    DISCOVERY_SEARCH_STARTED = "discovery.search_started"
    DISCOVERY_PAGE_OPENED = "discovery.page_opened"
    DISCOVERY_CANDIDATE_FOUND = "discovery.candidate_found"
    DISCOVERY_CANDIDATE_VALIDATED = "discovery.candidate_validated"
    DISCOVERY_CANDIDATE_REJECTED = "discovery.candidate_rejected"
    DISCOVERY_PERSISTENCE_COMPLETED = "discovery.persistence_completed"
    DISCOVERY_PARTIAL_FAILURE = "discovery.partial_failure"
    DISCOVERY_COMPLETED = "discovery.completed"


# Allowed state transitions to enforce determinism
VALID_TRANSITIONS: Dict[ExecutionStatus, set] = {
    ExecutionStatus.CREATED: {ExecutionStatus.STARTING, ExecutionStatus.CANCELLED, ExecutionStatus.FAILED},
    ExecutionStatus.STARTING: {ExecutionStatus.RUNNING, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED},
    ExecutionStatus.RUNNING: {
        ExecutionStatus.STOPPING,
        ExecutionStatus.COMPLETED,
        ExecutionStatus.FAILED,
        ExecutionStatus.CANCELLED,
        ExecutionStatus.DISCONNECTED,
    },
    ExecutionStatus.STOPPING: {ExecutionStatus.COMPLETED, ExecutionStatus.CANCELLED, ExecutionStatus.FAILED},
    ExecutionStatus.DISCONNECTED: {ExecutionStatus.RUNNING, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED},
    # Terminal states (cannot transition further)
    ExecutionStatus.COMPLETED: set(),
    ExecutionStatus.FAILED: set(),
    ExecutionStatus.CANCELLED: set(),
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CreateExecutionRequest(BaseModel):
    execution_id: Optional[str] = Field(None, description="Optional custom execution identifier")
    event_id: Optional[str] = Field(None, description="Optional EVENTRA event identifier for operational association")
    initial_url: Optional[str] = Field("about:blank", description="Initial URL to load on launch")


class NavigateExecutionRequest(BaseModel):
    url: str = Field(..., description="Target HTTP/HTTPS URL")
    tab_id: Optional[str] = Field(None, description="Target tab ID; defaults to active tab if omitted")
    timeout_ms: int = Field(30000, description="Timeout in milliseconds", ge=1000, le=120000)


class CreateExecutionTabRequest(BaseModel):
    url: Optional[str] = Field(None, description="Optional URL to load in the new tab")
    timeout_ms: int = Field(30000, description="Timeout in milliseconds", ge=1000, le=120000)


class StopExecutionRequest(BaseModel):
    reason: Optional[str] = Field("User requested stop", description="Reason for stopping execution")


class ExecutionEvent(BaseModel):
    execution_id: str
    event_type: str
    seq: int
    timestamp: str
    message: str
    data: Dict[str, Any] = Field(default_factory=dict)


class ExecutionResponse(BaseModel):
    execution_id: str
    event_id: Optional[str] = None
    user_id: str
    session_id: Optional[str] = None
    status: ExecutionStatus
    created_at: str
    updated_at: str
    current_url: Optional[str] = None
    current_title: Optional[str] = None
    active_tab_id: Optional[str] = None
    tabs: List[TabInfo] = Field(default_factory=list)
    viewer_url: str
    error: Optional[str] = None
    event_count: int = 0
