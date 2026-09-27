"""Pydantic Schemas for Mutation Idempotency & Offline Batch Reconciliation (B11)."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ReconciliationOperation(BaseModel):
    idempotency_key: str = Field(..., description="Unique client-generated idempotency token")
    operation_type: str = Field(..., description="Controlled mutation type (e.g. TASK_STATUS_UPDATE, TASK_PROVIDER_REASSIGN, TASK_VERIFICATION)")
    payload: Dict[str, Any] = Field(default_factory=dict, description="Operation payload")
    client_timestamp: Optional[datetime] = Field(None, description="Time operation was queued on client/offline")


class OperationReconciliationResult(BaseModel):
    idempotency_key: str
    status: str  # APPLIED, ALREADY_APPLIED, CONFLICT, REJECTED, FAILED
    response_code: int
    result: Optional[Any] = None
    error: Optional[str] = None


class BatchReconciliationRequest(BaseModel):
    operations: List[ReconciliationOperation] = Field(..., min_length=1, max_length=50)


class BatchReconciliationResponse(BaseModel):
    event_id: str
    total_operations: int
    applied_count: int
    already_applied_count: int
    conflict_count: int
    failed_count: int
    results: List[OperationReconciliationResult]
