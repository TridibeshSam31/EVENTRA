"""Pydantic Schemas: Observability (Audit, Activity, Decision Trace, State History)"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class AuditRecordResponse(BaseModel):
    id: str
    event_id: str
    actor_id: Optional[str] = None
    actor_type: str
    action: str
    action_type: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    before_state: Optional[Dict[str, Any]] = None
    after_state: Optional[Dict[str, Any]] = None
    impact_level: Optional[str] = None
    approval_id: Optional[str] = None
    execution_id: Optional[str] = None
    verification_id: Optional[str] = None
    failure_reason: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuditListResponse(BaseModel):
    total: int
    items: List[AuditRecordResponse]
    next_cursor: Optional[str] = None
    limit: Optional[int] = None
    offset: Optional[int] = None


class ActivityEntryResponse(BaseModel):
    id: str
    timestamp: Optional[str] = None
    category: str
    summary: str
    status: str
    actor_id: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)


class ActivityListResponse(BaseModel):
    total: int
    items: List[ActivityEntryResponse]


class DecisionTraceResponse(BaseModel):
    trace_id: str
    event_id: str
    verification_id: str
    timestamp: str
    incident: Optional[Dict[str, Any]] = None
    impact_and_risk: Dict[str, Any] = Field(default_factory=dict)
    recovery_option: Optional[Dict[str, Any]] = None
    approval: Optional[Dict[str, Any]] = None
    execution: Optional[Dict[str, Any]] = None
    verification: Dict[str, Any] = Field(default_factory=dict)
    event_state: Dict[str, Any] = Field(default_factory=dict)


class StateTransitionEntryResponse(BaseModel):
    id: str
    event_id: str
    entity_type: str
    entity_id: str
    previous_state: str
    new_state: str
    reason: Optional[str] = None
    transitioned_at: str


class StateHistoryResponse(BaseModel):
    total: int
    items: List[StateTransitionEntryResponse]
