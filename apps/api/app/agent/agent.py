"""Orchestrator: EventOperationsAgent (Single unified operations agent).

Adheres strictly to the architectural constraints:
1. ONE agent: EventOperationsAgent.
2. The deterministic engine calculates what is feasible. The agent decides what should happen next.
3. Live operational loop: Observe -> Interpret -> Decide -> Tool Execution -> Re-evaluate -> Validate -> Approve -> Act -> Verify.
4. Consequential actions require approval; agent cannot self-approve.
5. Authoritative verification after mutation.
6. Execution tracing (operational facts, NOT chain-of-thought).
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session

from app.agent.state import AgentState
from app.agent.graph import EventOperationsAgentGraph, MAX_AGENT_STEPS
from app.agent.provider import LLMProvider, get_default_llm_provider
from app.models.agent_run import AgentRun
from app.services.agent_run_events import AgentRunEventRecorder, latest_event_type

logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _sanitize_agent_payload(data: Any) -> Any:
    """Removes sensitive authentication tokens and ensures JSON serializability."""
    if hasattr(data, "_mock_name") or "mock" in type(data).__name__.lower():
        return str(data)
    if isinstance(data, (str, int, float, bool)) or data is None:
        return data
    if isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            if any(sec in k.lower() for sec in ("password", "token", "secret", "auth", "credential", "private_key", "chain_of_thought")):
                sanitized[k] = "[REDACTED]"
            else:
                sanitized[k] = _sanitize_agent_payload(v)
        return sanitized
    elif isinstance(data, (list, tuple, set)):
        return [_sanitize_agent_payload(item) for item in data]
    return str(data)


class EventOperationsAgent:
    """The single Event Operations Agent sitting above EVENTRA's deterministic backend."""

    def __init__(self, db: Session, llm_provider: Optional[LLMProvider] = None):
        self.db = db
        self.llm_provider = llm_provider or get_default_llm_provider()
        self._graph_builder = EventOperationsAgentGraph()
        self.graph = self._graph_builder.build_graph()

    def run(
        self,
        event_id: str,
        message: str,
        user_id: str = "anonymous_operator",
        approval_id: Optional[str] = None,
        objective: Optional[str] = None,
        max_steps: int = MAX_AGENT_STEPS,
    ) -> Dict[str, Any]:
        """Executes the operational agent loop over the live event.
        
        Args:
            event_id: Authoritative event UUID
            message: Natural language trigger, report, or directive
            user_id: Authenticated user ID (governs authorization and approvals)
            approval_id: Optional approval request ID for resuming approved actions
            objective: Optional explicit operational objective
            max_steps: Maximum reasoning / tool execution steps
            
        Returns:
            Structured operational dictionary containing status, response,
            impact, risk, recovery options, approval, execution, verification,
            and operational decision trace.
        """
        run_id = f"RUN-{uuid.uuid4().hex[:8].upper()}"

        initial_state: AgentState = {
            "run_id": run_id,
            "event_id": event_id,
            "user_id": user_id,
            "message": message,
            "objective": objective or "",
            "current_event_state": None,
            "current_incidents": [],
            "active_incident_id": None,
            "current_operational_state": None,
            "current_phase": "START",
            "impact": None,
            "risk": None,
            "recovery_options": [],
            "selected_option": None,
            "authorization_result": None,
            "approval_id": approval_id,
            "approval_result": None,
            "execution_result": None,
            "verification_result": None,
            "decision_trace": None,
            "proposed_action": None,
            "action_status": None,
            "verification_status": None,
            "pending_approval": False,
            "operational_intent": None,
            "provider_operation_result": None,
            "last_decision": None,
            "last_tool_call": None,
            "last_tool_result": None,
            "tool_history": [],
            "messages": [{"role": "user", "content": message}],
            "next_action": None,
            "status": "INITIALIZED",
            "step_count": 0,
            "max_steps": max_steps,
            "termination_status": None,
            "final_response": None,
            "final_outcome": None,
            "failure_information": None,
            "error": None,
        }

        start_time = utc_now()

        # Persist the run before executing so progress events can reference it
        # while the graph runs (B10 + live progress).
        agent_run: Optional[AgentRun] = None
        try:
            agent_run = AgentRun(
                run_id=run_id,
                event_id=event_id,
                user_id=user_id,
                trigger_message=message,
                objective=objective,
                status="RUNNING",
                started_at=start_time,
            )
            self.db.add(agent_run)
            self.db.commit()
        except Exception as exc:
            logger.warning("Failed to persist AgentRun %s at start: %s", run_id, exc)
            agent_run = None
            try:
                self.db.rollback()
            except Exception:
                pass

        run_events = AgentRunEventRecorder(self.db)
        events_run_id = run_id if agent_run else None
        run_events.record(
            events_run_id, event_id, "agent.run_started",
            {"status": "RUNNING", "trigger": "directive", "objective": objective, "approval_id": approval_id},
        )

        # Invoke LangGraph StateGraph with DB and LLM injected through configuration
        try:
            final_state: AgentState = self.graph.invoke(
                initial_state,
                config={
                    "configurable": {
                        "db": self.db,
                        "llm_provider": self.llm_provider,
                        "run_events": run_events,
                        "events_run_id": events_run_id,
                    }
                },
            )
        except Exception as exc:
            try:
                self.db.rollback()
            except Exception:
                pass
            if agent_run:
                try:
                    agent_run.status = "FAILED"
                    agent_run.error = str(exc)[:2000]
                    agent_run.completed_at = utc_now()
                    self.db.commit()
                except Exception:
                    self.db.rollback()
            run_events.record(events_run_id, event_id, "agent.run_failed", {"status": "FAILED", "error": str(exc)[:500]})
            raise

        completed_time = utc_now()
        resolved_run_id = final_state.get("run_id", run_id)

        # Persist final AgentRun state (B10)
        try:
            if agent_run is None:
                agent_run = AgentRun(
                    run_id=resolved_run_id,
                    event_id=event_id,
                    user_id=user_id,
                    trigger_message=message,
                    objective=objective,
                    started_at=start_time,
                )
                self.db.add(agent_run)
            agent_run.status = final_state.get("status", "COMPLETED")
            agent_run.termination_status = final_state.get("termination_status")
            agent_run.completed_at = completed_time
            agent_run.tool_history = _sanitize_agent_payload(final_state.get("tool_history", []))
            agent_run.decision_trace = _sanitize_agent_payload(final_state.get("decision_trace"))
            agent_run.final_response = final_state.get("final_response")
            agent_run.error = str(final_state.get("error")) if final_state.get("error") else None
            self.db.commit()
        except Exception as exc:
            logger.warning("Failed to persist AgentRun %s: %s", resolved_run_id, exc)
            try:
                self.db.rollback()
            except Exception:
                pass

        self._record_terminal_event(run_events, events_run_id, event_id, final_state)

        return {
            "run_id": resolved_run_id,
            "event_id": final_state.get("event_id", event_id),
            "objective": final_state.get("objective"),
            "status": final_state.get("status"),
            "termination_status": final_state.get("termination_status"),
            "response": final_state.get("final_response"),
            "active_incident_id": final_state.get("active_incident_id"),
            "incident": (final_state.get("current_incidents") or [None])[0],
            "impact": final_state.get("impact"),
            "risk": final_state.get("risk"),
            "recovery_options": final_state.get("recovery_options"),
            "selected_option": final_state.get("selected_option"),
            "authorization": final_state.get("authorization_result"),
            "approval_id": final_state.get("approval_id"),
            "approval": final_state.get("approval_result"),
            "execution": final_state.get("execution_result"),
            "execution_result": final_state.get("execution_result"),
            "verification": final_state.get("verification_result"),
            "verification_result": final_state.get("verification_result"),
            "pending_approval": final_state.get("pending_approval", False),
            "recovery_attempts": final_state.get("recovery_attempts"),
            "attempt_count": final_state.get("attempt_count"),
            "decision_trace": final_state.get("decision_trace"),
            "operational_intent": final_state.get("operational_intent"),
            "provider_operation": final_state.get("provider_operation_result"),
            "tool_history": final_state.get("tool_history", []),
            "last_decision": final_state.get("last_decision"),
            "step_count": final_state.get("step_count"),
            "error": final_state.get("error"),
        }

    def _record_terminal_event(
        self,
        run_events: AgentRunEventRecorder,
        run_id: Optional[str],
        event_id: str,
        final_state: AgentState,
    ) -> None:
        """Records how the run ended. Waiting on a human is never reported as success."""
        if not run_id:
            return
        status = final_state.get("status") or "COMPLETED"
        if status in ("PENDING_APPROVAL", "WAITING_FOR_APPROVAL") or final_state.get("pending_approval"):
            approval = final_state.get("approval_result") or {}
            event_type, data = "approval.required", {
                "status": status,
                "approval_id": final_state.get("approval_id"),
                "action": approval.get("action_type"),
                "reason": approval.get("notes"),
            }
        elif status == "WAITING_FOR_USER_SELECTION":
            event_type, data = "selection.required", {"status": status, "summary": final_state.get("final_response")}
        elif status in ("FAILED", "RECOVERY_FAILED"):
            event_type, data = "agent.run_failed", {
                "status": status,
                "error": str(final_state.get("error") or final_state.get("final_response") or "Run failed")[:500],
            }
        elif status == "PAUSED":
            event_type, data = "agent.run_paused", {"status": status, "reason": final_state.get("final_response")}
        else:
            event_type, data = "agent.run_completed", {
                "status": status,
                "termination_status": final_state.get("termination_status"),
            }
        # A nested operations pipeline may already have recorded this outcome.
        if latest_event_type(self.db, run_id) == event_type:
            return
        run_events.record(run_id, event_id, event_type, _sanitize_agent_payload(data))
