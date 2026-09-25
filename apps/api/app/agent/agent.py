"""Orchestrator: EventOperationsAgent (Single unified operations agent).

Adheres strictly to the architectural constraints:
1. ONE agent: EventOperationsAgent.
2. The deterministic engine calculates what is feasible. The agent decides what should happen next.
3. Live operational loop: Observe -> Interpret -> Decide -> Tool Execution -> Re-evaluate -> Validate -> Approve -> Act -> Verify.
4. Consequential actions require approval; agent cannot self-approve.
5. Authoritative verification after mutation.
6. Execution tracing (operational facts, NOT chain-of-thought).
"""
import uuid
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session

from app.agent.state import AgentState
from app.agent.graph import EventOperationsAgentGraph, MAX_AGENT_STEPS
from app.agent.provider import LLMProvider, get_default_llm_provider


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

        # Invoke LangGraph StateGraph with DB and LLM injected through configuration
        final_state: AgentState = self.graph.invoke(
            initial_state,
            config={"configurable": {"db": self.db, "llm_provider": self.llm_provider}},
        )

        return {
            "run_id": final_state.get("run_id", run_id),
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
            "step_count": final_state.get("step_count"),
            "error": final_state.get("error"),
        }
