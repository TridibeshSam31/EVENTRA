"""Pydantic schemas for the Event Operations Agent API."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator


class AgentRunRequest(BaseModel):
    """Input payload to invoke the Event Operations Agent."""
    message: Optional[str] = Field(None, description="Natural language operator report or directive")
    input: Optional[str] = Field(None, description="Alternative field for natural language directive")
    objective: Optional[str] = Field(None, description="Optional operational objective")
    approval_id: Optional[str] = Field(None, description="Optional approval request ID for resuming approved actions")
    max_steps: Optional[int] = Field(None, description="Optional bounded step limit override")

    @model_validator(mode="after")
    def validate_message_or_input(self) -> "AgentRunRequest":
        if not self.message and not self.input:
            raise ValueError("Either 'message' or 'input' must be provided.")
        if not self.message and self.input:
            self.message = self.input
        return self


class AgentRunResponse(BaseModel):
    """Authoritative structured output from the Event Operations Agent.
    
    CRITICAL: Never exposes chain-of-thought or raw internal reasoning.
    """
    run_id: Optional[str] = Field(None, description="Unique operational run ID")
    event_id: str
    objective: Optional[str] = None
    status: str
    termination_status: Optional[str] = None
    response: Optional[str] = None
    active_incident_id: Optional[str] = None
    incident: Optional[Dict[str, Any]] = None
    impact: Optional[Dict[str, Any]] = None
    risk: Optional[Dict[str, Any]] = None
    recovery_options: Optional[List[Dict[str, Any]]] = None
    selected_option: Optional[Dict[str, Any]] = None
    authorization: Optional[Dict[str, Any]] = None
    approval_id: Optional[str] = None
    approval: Optional[Dict[str, Any]] = None
    execution: Optional[Dict[str, Any]] = None
    verification: Optional[Dict[str, Any]] = None
    decision_trace: Optional[Dict[str, Any]] = None
    tool_history: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Structured factual operational trace")
    operational_intent: Optional[str] = None
    provider_operation: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    step_count: Optional[int] = None
