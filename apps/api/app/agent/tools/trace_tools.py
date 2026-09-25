"""OBSERVABILITY & DECISION TRACE Agent Tools.

Exposes factual operational decision recording and audit retrieval.
STRICT GUARDRAIL: Captures structured operational milestones only;
NEVER records chain-of-thought or internal model deliberations.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List
from app.observability.decision_trace import DecisionTraceService
from app.models.event import Event
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolContext,
    ToolResult,
)
from app.agent.tools.schemas import (
    RecordDecisionInput,
    RecordDecisionOutput,
    GetDecisionTraceInput,
    GetDecisionTraceOutput,
)
from app.agent.tools.permissions import ToolPermissionGuard


class RecordDecisionTool(AgentTool):
    """Records a factual operational decision milestone into the event execution trace."""

    name = "record_decision"
    description = "Records a structured operational decision milestone into the event trace."
    category = ToolCategory.OBSERVABILITY
    access_mode = ToolAccessMode.WRITE
    input_schema = RecordDecisionInput
    output_schema = RecordDecisionOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: RecordDecisionInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        if not event:
            return ToolResult.failure_result(self.name, f"Event with id '{args.event_id}' not found.", "NOT_FOUND")

        trace_id = f"trace-{uuid.uuid4().hex[:12]}"
        now_iso = datetime.now(timezone.utc).isoformat()

        # Build clean factual audit payload (ensuring NO chain of thought)
        sanitized_metadata = {
            k: v for k, v in args.metadata.items()
            if not any(sub in k.lower() for sub in ("thought", "reasoning", "cot", "secret", "token", "password", "key"))
        }

        data = RecordDecisionOutput(
            trace_id=trace_id,
            event_id=args.event_id,
            decision_type=args.decision_type,
            recorded_at=now_iso,
            success=True,
        )
        return ToolResult.success_result(
            self.name,
            data,
            metadata={"rationale": args.rationale, "entity_type": args.entity_type, "entity_id": args.entity_id, **sanitized_metadata},
        )


class GetDecisionTraceTool(AgentTool):
    """Retrieves factual, structured decision traces for an event."""

    name = "get_decision_trace"
    description = "Retrieves factual, structured decision traces for an event."
    category = ToolCategory.OBSERVABILITY
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetDecisionTraceInput
    output_schema = GetDecisionTraceOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetDecisionTraceInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        trace_service = DecisionTraceService(context.db)
        if args.verification_id:
            single_trace = trace_service.get_trace_by_verification_id(args.event_id, args.verification_id)
            traces = [single_trace] if single_trace else []
        else:
            traces = trace_service.get_traces_for_event(args.event_id, limit=args.limit)

        data = GetDecisionTraceOutput(
            event_id=args.event_id,
            total=len(traces),
            traces=traces,
        )
        return ToolResult.success_result(self.name, data)
