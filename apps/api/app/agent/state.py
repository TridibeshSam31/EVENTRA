"""Agent execution state schema for LangGraph.

The database remains the authoritative source of truth.
AgentState carries only operational context, step outcomes, and structured tool history.
CRITICAL: Do NOT store hidden chain-of-thought, thought_history, or reasoning_trace.
"""
from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict


class AgentState(TypedDict, total=False):
    """Authoritative typed operational state schema for the Event Operations Agent."""
    
    # Run Identity & Scoping
    run_id: str
    event_id: str
    user_id: str
    message: str
    objective: str
    
    # Authoritative snapshots from deterministic backend
    current_event_state: Optional[Dict[str, Any]]
    current_incidents: List[Dict[str, Any]]
    active_incident_id: Optional[str]
    current_operational_state: Optional[str]
    current_phase: str
    
    # Deterministic pipeline outputs
    impact: Optional[Dict[str, Any]]
    risk: Optional[Dict[str, Any]]
    recovery_options: List[Dict[str, Any]]
    selected_option: Optional[Dict[str, Any]]
    
    # Governance & Execution
    authorization_result: Optional[Dict[str, Any]]
    approval_id: Optional[str]
    approval_result: Optional[Dict[str, Any]]
    execution_result: Optional[Dict[str, Any]]
    verification_result: Optional[Dict[str, Any]]
    decision_trace: Optional[Dict[str, Any]]
    
    # Operational Action & Verification Tracking
    proposed_action: Optional[Dict[str, Any]]
    action_status: Optional[str]  # PROPOSED, AUTHORIZED, PENDING_APPROVAL, EXECUTED, FAILED
    verification_status: Optional[str]  # PENDING, VERIFIED, PARTIALLY_VERIFIED, VERIFICATION_FAILED
    pending_approval: bool
    recovery_attempts: Optional[List[Dict[str, Any]]]
    attempt_count: Optional[int]
    max_recovery_attempts: Optional[int]
    
    # Provider Operations (communication, negotiation, confirmation)
    operational_intent: Optional[str]
    provider_operation_result: Optional[Dict[str, Any]]
    
    # Structured Execution Tracing (Operational Decision Trace, NOT Chain of Thought)
    last_decision: Optional[Dict[str, Any]]
    last_tool_call: Optional[Dict[str, Any]]
    last_tool_result: Optional[Dict[str, Any]]
    tool_history: List[Dict[str, Any]]
    
    # LangGraph navigation & bounded execution
    messages: List[Dict[str, Any]]
    next_action: Optional[str]
    status: str  # INITIALIZED, OBSERVING, INTERPRETING, DECIDING, EXECUTING_TOOL, PENDING_APPROVAL, EXECUTED, VERIFYING, COMPLETED, FAILED
    step_count: int
    max_steps: int
    termination_status: Optional[str]  # COMPLETED, NO_ACTION_REQUIRED, WAITING_FOR_APPROVAL, WAITING_FOR_INFORMATION, UNRECOVERABLE, FAILED, STEP_LIMIT_REACHED, VERIFICATION_FAILED
    final_response: Optional[str]
    final_outcome: Optional[Dict[str, Any]]
    failure_information: Optional[Dict[str, Any]]
    error: Optional[str]
