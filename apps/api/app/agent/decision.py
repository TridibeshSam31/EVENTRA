"""Structured Agent Decision Schema and Reason Codes.

This contract defines the structured decisions produced by Gemini or MockLLMProvider.
The agent loop NEVER relies on free-form text parsing for control flow.
No chain-of-thought or raw internal reasoning is stored.
"""
from enum import Enum
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class DecisionType(str, Enum):
    """High-level decision type emitted by the agent."""
    TOOL_CALL = "TOOL_CALL"
    PROPOSE_ACTION = "PROPOSE_ACTION"
    REQUEST_APPROVAL = "REQUEST_APPROVAL"
    WAIT = "WAIT"
    COMPLETE = "COMPLETE"
    FAIL = "FAIL"


class ReasonCode(str, Enum):
    """Authoritative operational reason codes."""
    INITIAL_OBSERVATION = "INITIAL_OBSERVATION"
    CHANGE_DETECTED = "CHANGE_DETECTED"
    MISSING_PROVIDER_STATUS = "MISSING_PROVIDER_STATUS"
    MISSING_EVENT_SPECIFICATION = "MISSING_EVENT_SPECIFICATION"
    IMPACT_REQUIRES_ANALYSIS = "IMPACT_REQUIRES_ANALYSIS"
    CRITICAL_TASK_AFFECTED = "CRITICAL_TASK_AFFECTED"
    RISK_ASSESSMENT_REQUIRED = "RISK_ASSESSMENT_REQUIRED"
    RECOVERY_OPTIONS_REQUIRED = "RECOVERY_OPTIONS_REQUIRED"
    RECOVERY_OPTION_FEASIBLE = "RECOVERY_OPTION_FEASIBLE"
    RECOVERY_OPTION_INFEASIBLE = "RECOVERY_OPTION_INFEASIBLE"
    PROCUREMENT_REQUIRED = "PROCUREMENT_REQUIRED"
    RESOURCE_REQUIREMENT_CALCULATED = "RESOURCE_REQUIREMENT_CALCULATED"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    APPROVAL_GRANTED = "APPROVAL_GRANTED"
    APPROVAL_REJECTED = "APPROVAL_REJECTED"
    ACTION_AUTHORIZED = "ACTION_AUTHORIZED"
    ACTION_EXECUTED = "ACTION_EXECUTED"
    VERIFICATION_REQUIRED = "VERIFICATION_REQUIRED"
    RECOVERY_CONFIRMED = "RECOVERY_CONFIRMED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    NO_ACTION_REQUIRED = "NO_ACTION_REQUIRED"
    STEP_LIMIT_REACHED = "STEP_LIMIT_REACHED"
    UNKNOWN_TOOL_REQUESTED = "UNKNOWN_TOOL_REQUESTED"
    INVALID_TOOL_ARGUMENTS = "INVALID_TOOL_ARGUMENTS"
    TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED"
    UNRECOVERABLE_STATE = "UNRECOVERABLE_STATE"
    EVENT_EXECUTION_PAUSED = "EVENT_EXECUTION_PAUSED"


class AgentDecision(BaseModel):
    """The structured decision output returned by the LLM on every decision turn.
    
    CRITICAL: Does NOT contain chain-of-thought or private reasoning transcripts.
    Only contains structured operational fields for the deterministic engine to validate.
    """
    decision_type: DecisionType = Field(
        ...,
        description="The operational category of action to take",
    )
    tool_name: Optional[str] = Field(
        None,
        description="Authoritative name of tool from the Tool Registry to execute",
    )
    tool_arguments: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Typed arguments to pass to the tool",
    )
    reason_code: str = Field(
        ...,
        description="Standard operational reason code explaining why this decision was taken",
    )
    action_intent: Optional[str] = Field(
        None,
        description="High-level intent: INCIDENT_INVESTIGATION, RECOVERY, PROCUREMENT, VERIFICATION, etc.",
    )
    rationale: Optional[str] = Field(
        None,
        description="Concise, factual operational summary for control-room operators",
    )
    requires_approval: bool = Field(
        False,
        description="Flag indicating if the agent expects this action to require operator approval",
    )
    terminate: bool = Field(
        False,
        description="True if the agent has reached a terminal operational state",
    )
    termination_status: Optional[str] = Field(
        None,
        description="Terminal status: COMPLETED, NO_ACTION_REQUIRED, WAITING_FOR_APPROVAL, FAILED, etc.",
    )
