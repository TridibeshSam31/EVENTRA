"""Pydantic Schemas: Task and TaskDependency"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict
from app.models.enums import TaskStatus, TaskPriority, DependencyType


class TaskBase(BaseModel):
    name: str
    description: Optional[str] = None
    status: str = TaskStatus.PENDING.value
    priority: str = TaskPriority.MEDIUM.value
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    verification_status: str = "PENDING"
    verified_at: Optional[datetime] = None
    verification_notes: Optional[str] = None


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    verification_status: Optional[str] = None
    verified_at: Optional[datetime] = None
    verification_notes: Optional[str] = None


class TaskResponse(TaskBase):
    id: str
    event_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskVerificationUpdateRequest(BaseModel):
    verification_status: str
    verification_notes: Optional[str] = None


class TaskDependencyCreate(BaseModel):
    predecessor_task_id: str
    successor_task_id: str
    dependency_type: str = DependencyType.FINISH_TO_START.value


class TaskDependencyResponse(BaseModel):
    id: str
    event_id: str
    predecessor_task_id: str
    successor_task_id: str
    dependency_type: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskProviderReassignRequest(BaseModel):
    """Payload to reassign a provider to an operational task (B4)."""
    provider_id: str
    agreed_cost: Optional[float] = None
    notes: Optional[str] = None
    force_override: bool = False


class TaskProviderReassignResponse(BaseModel):
    """Authoritative response confirming task provider reassignment (B4)."""
    task_id: str
    task_name: str
    previous_provider_id: Optional[str] = None
    new_provider_id: str
    status: str
    agreed_cost: Optional[float] = None
    reassigned_at: datetime
    audit_id: Optional[str] = None
