"""Browser Agent Service for EVENTRA (Phase 2).

Orchestrates Browser Agent execution lifecycles, provides state machine management,
and streams real activity telemetry to connected clients.
"""

import asyncio
from collections import deque
import logging
from typing import Any, AsyncGenerator, Deque, Dict, List, Optional, Set
import uuid

from fastapi import HTTPException, status

from app.schemas.browser_agent import (
    AgentEventType,
    ExecutionEvent,
    ExecutionResponse,
    ExecutionStatus,
    VALID_TRANSITIONS,
    utc_now_iso,
)
from app.services.browser_runtime_service import (
    BrowserRuntimeService,
    browser_runtime_service,
    validate_browser_url,
)

logger = logging.getLogger(__name__)


class ExecutionRecord:
    """In-memory representation of an active or historical Browser Agent execution."""

    def __init__(
        self,
        execution_id: str,
        user_id: str,
        event_id: Optional[str] = None,
        initial_url: Optional[str] = None,
    ):
        now = utc_now_iso()
        self.execution_id = execution_id
        self.user_id = user_id
        self.event_id = event_id
        self.initial_url = initial_url or "about:blank"
        self.session_id: Optional[str] = None
        self.status = ExecutionStatus.CREATED
        self.created_at = now
        self.updated_at = now
        self.current_url: Optional[str] = None
        self.current_title: Optional[str] = None
        self.active_tab_id: Optional[str] = None
        self.tabs: List[Any] = []
        self.viewer_url: str = ""
        self.error: Optional[str] = None
        self.discovered_candidates: List[Any] = []

        self.seq_counter: int = 0
        self.event_history: Deque[ExecutionEvent] = deque(maxlen=100)
        self.listeners: Set[asyncio.Queue] = set()
        self.lock = asyncio.Lock()

    def to_response(self) -> ExecutionResponse:
        return ExecutionResponse(
            execution_id=self.execution_id,
            event_id=self.event_id,
            user_id=self.user_id,
            session_id=self.session_id,
            status=self.status,
            created_at=self.created_at,
            updated_at=self.updated_at,
            current_url=self.current_url,
            current_title=self.current_title,
            active_tab_id=self.active_tab_id,
            tabs=self.tabs,
            viewer_url=self.viewer_url,
            error=self.error,
            event_count=len(self.event_history),
        )

    def transition_status(self, new_status: ExecutionStatus, error: Optional[str] = None):
        """Enforces deterministic lifecycle transitions."""
        if self.status == new_status:
            return  # Idempotent no-op

        valid = VALID_TRANSITIONS.get(self.status, set())
        if new_status not in valid:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot transition execution from '{self.status.value}' to '{new_status.value}'.",
            )

        self.status = new_status
        self.updated_at = utc_now_iso()
        if error:
            self.error = error

    def emit_event(
        self,
        event_type: AgentEventType,
        message: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> ExecutionEvent:
        """Emits a timestamped, sequence-numbered execution event and notifies listeners."""
        self.seq_counter += 1
        payload_data = data or {}
        # Include current execution snapshot metadata
        payload_data.setdefault("status", self.status.value)
        if self.current_url:
            payload_data.setdefault("current_url", self.current_url)
        if self.current_title:
            payload_data.setdefault("current_title", self.current_title)
        if self.active_tab_id:
            payload_data.setdefault("active_tab_id", self.active_tab_id)

        event = ExecutionEvent(
            execution_id=self.execution_id,
            event_type=event_type.value,
            seq=self.seq_counter,
            timestamp=utc_now_iso(),
            message=message,
            data=payload_data,
        )

        self.event_history.append(event)

        # Broadcast to active queues
        for queue in list(self.listeners):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("Listener queue full for execution %s; dropping frame", self.execution_id)
            except Exception as e:
                logger.warning("Error broadcasting event: %s", e)

        return event


class BrowserAgentService:
    """Coordinates Browser Agent executions and binds them to the underlying runtime."""

    def __init__(self, runtime_service: Optional[BrowserRuntimeService] = None):
        self.runtime = runtime_service or browser_runtime_service
        self._executions: Dict[str, ExecutionRecord] = {}
        self._global_lock = asyncio.Lock()

    def _authorize(self, record: ExecutionRecord, user_id: str):
        """Validates that the requesting operator is allowed to access this execution."""
        # In development and tests, allow 'anonymous_operator' or exact matching
        if user_id in ("anonymous_operator", "admin", "system"):
            return
        if record.user_id not in ("anonymous_operator", "admin", "system") and record.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: You do not own this browser execution.",
            )

    async def list_executions(
        self,
        event_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[ExecutionResponse]:
        async with self._global_lock:
            results = []
            for record in self._executions.values():
                if event_id and record.event_id != event_id:
                    continue
                if user_id and user_id not in ("anonymous_operator", "admin") and record.user_id != user_id:
                    continue
                results.append(record.to_response())
            return sorted(results, key=lambda r: r.created_at, reverse=True)

    async def create_execution(
        self,
        execution_id: Optional[str] = None,
        event_id: Optional[str] = None,
        initial_url: Optional[str] = "about:blank",
        user_id: str = "anonymous_operator",
    ) -> ExecutionResponse:
        exec_id = execution_id.strip() if execution_id else f"exec_{uuid.uuid4().hex[:12]}"

        async with self._global_lock:
            # Idempotency check: if execution already exists
            if exec_id in self._executions:
                existing = self._executions[exec_id]
                self._authorize(existing, user_id)
                # If running, return existing state safely
                if existing.status in (ExecutionStatus.RUNNING, ExecutionStatus.STARTING):
                    logger.info("Idempotent start request for execution %s", exec_id)
                    return existing.to_response()
                elif existing.status in (ExecutionStatus.COMPLETED, ExecutionStatus.CANCELLED, ExecutionStatus.FAILED):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"Execution '{exec_id}' has already concluded with status '{existing.status.value}'.",
                    )

            target_url = validate_browser_url(initial_url, allow_blank=True) if initial_url else "about:blank"
            record = ExecutionRecord(
                execution_id=exec_id,
                user_id=user_id,
                event_id=event_id,
                initial_url=target_url,
            )
            self._executions[exec_id] = record

        # Lock record during startup
        async with record.lock:
            record.emit_event(
                AgentEventType.EXECUTION_CREATED,
                f"Browser Agent execution '{exec_id}' created.",
                {"event_id": event_id, "initial_url": target_url},
            )

            record.transition_status(ExecutionStatus.STARTING)
            record.emit_event(
                AgentEventType.EXECUTION_STARTING,
                "Requesting browser session from runtime daemon...",
            )

            try:
                # Attach to Phase 1 browser runtime
                session_name = f"sess_{exec_id[:16]}"
                session_state = await self.runtime.start_session(
                    session_id=session_name,
                    initial_url=target_url,
                    force=True,
                )

                record.session_id = session_state.session_id
                record.viewer_url = session_state.viewer_url
                record.active_tab_id = session_state.active_tab_id
                record.tabs = session_state.tabs

                # Set current tab url and title
                for tab in session_state.tabs:
                    if tab.is_active:
                        record.current_url = tab.url
                        record.current_title = tab.title
                        break

                record.transition_status(ExecutionStatus.RUNNING)
                record.emit_event(
                    AgentEventType.EXECUTION_RUNNING,
                    f"Browser session '{session_state.session_id}' attached and active.",
                    {
                        "session_id": session_state.session_id,
                        "viewer_url": session_state.viewer_url,
                        "active_tab_id": session_state.active_tab_id,
                    },
                )
                return record.to_response()

            except HTTPException as he:
                record.transition_status(ExecutionStatus.FAILED, error=he.detail)
                record.emit_event(
                    AgentEventType.EXECUTION_FAILED,
                    f"Startup failed: {he.detail}",
                    {"error": he.detail, "status_code": he.status_code},
                )
                raise he
            except Exception as e:
                err_msg = str(e)
                record.transition_status(ExecutionStatus.FAILED, error=err_msg)
                record.emit_event(
                    AgentEventType.EXECUTION_FAILED,
                    f"Startup failed unexpectedly: {err_msg}",
                    {"error": err_msg},
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Browser Agent startup failed: {err_msg}",
                )

    async def get_execution(self, execution_id: str, user_id: str = "anonymous_operator") -> ExecutionResponse:
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Browser Agent execution '{execution_id}' not found.",
            )

        self._authorize(record, user_id)

        # If running, sync latest tab details from runtime if reachable
        if record.status == ExecutionStatus.RUNNING and record.session_id:
            try:
                latest = await self.runtime.get_session(record.session_id)
                record.active_tab_id = latest.active_tab_id
                record.tabs = latest.tabs
                record.viewer_url = latest.viewer_url
                for tab in latest.tabs:
                    if tab.is_active:
                        record.current_url = tab.url
                        record.current_title = tab.title
                        break
            except Exception as e:
                logger.debug("Could not refresh live session for %s: %s", execution_id, e)

        return record.to_response()

    async def navigate(
        self,
        execution_id: str,
        url: str,
        tab_id: Optional[str] = None,
        timeout_ms: int = 30000,
        user_id: str = "anonymous_operator",
    ) -> ExecutionResponse:
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execution '{execution_id}' not found.",
            )

        self._authorize(record, user_id)

        if record.status != ExecutionStatus.RUNNING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot navigate execution with status '{record.status.value}'. Must be 'running'.",
            )

        if not record.session_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Execution is missing an active browser session.",
            )

        validated_url = validate_browser_url(url, allow_blank=True)

        async with record.lock:
            record.emit_event(
                AgentEventType.BROWSER_NAVIGATING,
                f"Navigating to {validated_url}...",
                {"target_url": validated_url, "tab_id": tab_id},
            )

            try:
                session_state = await self.runtime.navigate(
                    session_id=record.session_id,
                    url=validated_url,
                    tab_id=tab_id,
                    timeout_ms=timeout_ms,
                )

                record.active_tab_id = session_state.active_tab_id
                record.tabs = session_state.tabs
                for tab in session_state.tabs:
                    if tab.is_active:
                        record.current_url = tab.url
                        record.current_title = tab.title
                        break

                record.updated_at = utc_now_iso()
                record.emit_event(
                    AgentEventType.BROWSER_NAVIGATION_COMPLETED,
                    f"Navigation completed: {record.current_title or validated_url}",
                    {
                        "url": record.current_url,
                        "title": record.current_title,
                        "active_tab_id": record.active_tab_id,
                    },
                )
                return record.to_response()

            except Exception as e:
                err_msg = str(e)
                record.emit_event(
                    AgentEventType.EXECUTION_FAILED,
                    f"Navigation failed: {err_msg}",
                    {"url": validated_url, "error": err_msg},
                )
                raise

    async def create_tab(
        self,
        execution_id: str,
        url: Optional[str] = None,
        timeout_ms: int = 30000,
        user_id: str = "anonymous_operator",
    ) -> ExecutionResponse:
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execution '{execution_id}' not found.",
            )

        self._authorize(record, user_id)

        if record.status != ExecutionStatus.RUNNING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot open tab in execution with status '{record.status.value}'.",
            )

        validated_url = validate_browser_url(url, allow_blank=True) if url else None

        async with record.lock:
            try:
                session_state = await self.runtime.create_tab(
                    session_id=record.session_id,
                    url=validated_url,
                    timeout_ms=timeout_ms,
                )

                record.active_tab_id = session_state.active_tab_id
                record.tabs = session_state.tabs
                for tab in session_state.tabs:
                    if tab.is_active:
                        record.current_url = tab.url
                        record.current_title = tab.title
                        break

                record.updated_at = utc_now_iso()
                record.emit_event(
                    AgentEventType.BROWSER_TAB_OPENED,
                    f"Opened new tab [{record.active_tab_id}]",
                    {
                        "tab_id": record.active_tab_id,
                        "url": record.current_url,
                        "title": record.current_title,
                    },
                )
                return record.to_response()
            except Exception as e:
                logger.error("Failed to open tab in execution %s: %s", execution_id, e)
                raise

    async def activate_tab(
        self,
        execution_id: str,
        tab_id: str,
        user_id: str = "anonymous_operator",
    ) -> ExecutionResponse:
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execution '{execution_id}' not found.",
            )

        self._authorize(record, user_id)

        if record.status != ExecutionStatus.RUNNING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot activate tab in execution with status '{record.status.value}'.",
            )

        async with record.lock:
            try:
                session_state = await self.runtime.activate_tab(
                    session_id=record.session_id,
                    tab_id=tab_id,
                )

                record.active_tab_id = session_state.active_tab_id
                record.tabs = session_state.tabs
                for tab in session_state.tabs:
                    if tab.is_active:
                        record.current_url = tab.url
                        record.current_title = tab.title
                        break

                record.updated_at = utc_now_iso()
                record.emit_event(
                    AgentEventType.BROWSER_TAB_ACTIVATED,
                    f"Switched focus to tab [{record.active_tab_id}]: {record.current_title or record.current_url}",
                    {
                        "tab_id": record.active_tab_id,
                        "url": record.current_url,
                        "title": record.current_title,
                    },
                )
                return record.to_response()
            except Exception as e:
                logger.error("Failed to activate tab in execution %s: %s", execution_id, e)
                raise

    async def stop_execution(
        self,
        execution_id: str,
        reason: Optional[str] = "User requested stop",
        user_id: str = "anonymous_operator",
    ) -> ExecutionResponse:
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execution '{execution_id}' not found.",
            )

        self._authorize(record, user_id)

        # Idempotent check
        if record.status in (ExecutionStatus.COMPLETED, ExecutionStatus.CANCELLED, ExecutionStatus.FAILED):
            return record.to_response()

        async with record.lock:
            record.transition_status(ExecutionStatus.STOPPING)
            record.emit_event(
                AgentEventType.EXECUTION_STOPPING,
                f"Stopping Browser Agent execution: {reason}",
                {"reason": reason},
            )

            if record.session_id:
                try:
                    await self.runtime.stop_session(record.session_id)
                except Exception as e:
                    logger.warning("Error stopping underlying browser runtime session: %s", e)

            record.transition_status(ExecutionStatus.CANCELLED)
            record.tabs = []
            record.active_tab_id = None
            record.emit_event(
                AgentEventType.EXECUTION_CANCELLED,
                f"Execution cleanly stopped and resources released. Reason: {reason}",
                {"reason": reason},
            )
            return record.to_response()

    def get_candidates(self, execution_id: str, user_id: str = "anonymous_operator") -> List[Any]:
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execution '{execution_id}' not found.",
            )
        self._authorize(record, user_id)
        return list(record.discovered_candidates)

    def set_candidates(self, execution_id: str, candidates: List[Any], user_id: str = "anonymous_operator"):
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execution '{execution_id}' not found.",
            )
        self._authorize(record, user_id)
        record.discovered_candidates = candidates

    async def subscribe_events(
        self,
        execution_id: str,
        user_id: str = "anonymous_operator",
        last_seq: Optional[int] = None,
    ) -> AsyncGenerator[ExecutionEvent, None]:
        """Provides an async stream of events for an execution, supporting reconnection replay."""
        record = self._executions.get(execution_id)
        if not record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Execution '{execution_id}' not found.",
            )

        self._authorize(record, user_id)

        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        record.listeners.add(queue)

        try:
            # 1. State snapshot on connect
            snapshot_event = ExecutionEvent(
                execution_id=record.execution_id,
                event_type=AgentEventType.BROWSER_STATE_UPDATED.value,
                seq=record.seq_counter,
                timestamp=utc_now_iso(),
                message="Current execution state snapshot.",
                data={
                    "status": record.status.value,
                    "current_url": record.current_url,
                    "current_title": record.current_title,
                    "active_tab_id": record.active_tab_id,
                    "tabs_count": len(record.tabs),
                    "viewer_url": record.viewer_url,
                },
            )
            yield snapshot_event

            # 2. Replay buffered events if reconnecting with last_seq
            if last_seq is not None and last_seq > 0:
                for evt in list(record.event_history):
                    if evt.seq > last_seq:
                        yield evt

            # 3. Stream ongoing real-time events
            while True:
                event = await queue.get()
                yield event
                queue.task_done()

        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            record.listeners.discard(queue)


browser_agent_service = BrowserAgentService()


def get_browser_agent_service() -> BrowserAgentService:
    return browser_agent_service
