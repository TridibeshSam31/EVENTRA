"""Central Agent Tool Registry for EVENTRA.

Coordinates:
- Tool registration and duplicate prevention
- Typed argument validation against Pydantic schemas
- Single common execution pipeline:
    Agent Request -> Tool Lookup -> Input Validation -> Permission Check -> Approval Gate -> Deterministic Service -> Result -> Trace
- Distinguishes available vs disabled vs unsupported tools
- Exposing model-friendly Gemini FunctionDeclarations for Task 4
"""
import logging
import time
import uuid
from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolResultStatus,
    ToolResult,
    ToolContext,
    ExecutionTraceRecord,
)
from app.agent.tools.errors import (
    UnknownToolError,
    InvalidToolInputError,
    PermissionDeniedError,
    ApprovalRequiredError,
    UnsupportedToolError,
    ToolTimeoutError,
    ToolExecutionFailedError,
)

logger = logging.getLogger(__name__)


class AgentToolRegistry:
    """Central authoritative registry for all agent tools in EVENTRA."""

    def __init__(self):
        self._tools: Dict[str, AgentTool] = {}
        self._execution_traces: List[ExecutionTraceRecord] = []

    def register(self, tool: AgentTool) -> None:
        """Registers a tool in the registry. Rejects duplicates."""
        if tool.name in self._tools:
            raise ValueError(f"Tool with name '{tool.name}' is already registered in AgentToolRegistry.")
        self._tools[tool.name] = tool
        logger.info(f"Registered agent tool: {tool.name} [{tool.category.value} / {tool.access_mode.value}]")

    def get(self, name: str) -> AgentTool:
        """Retrieves a registered tool by name. Raises UnknownToolError if not found."""
        tool = self._tools.get(name)
        if not tool:
            raise UnknownToolError(tool_name=name)
        return tool

    def has_tool(self, name: str) -> bool:
        """Checks if a tool is registered."""
        return name in self._tools

    def list_tools(
        self,
        category: Optional[ToolCategory] = None,
        access_mode: Optional[ToolAccessMode] = None,
        available_only: bool = True,
    ) -> List[AgentTool]:
        """Lists registered tools matching the provided criteria."""
        results = list(self._tools.values())

        if category:
            results = [t for t in results if t.category == category]
        if access_mode:
            results = [t for t in results if t.access_mode == access_mode]
        if available_only:
            results = [t for t in results if t.availability == ToolAvailabilityStatus.AVAILABLE]

        return results

    def get_llm_tools(self) -> List[Dict[str, Any]]:
        """Returns model-friendly tool definitions formatted for Gemini function calling.

        STRICT PRODUCT SCOPE:
        Only tools with availability == AVAILABLE are exposed to the LLM.
        Disabled tools (e.g. WhatsApp, phone, autonomous negotiation) are strictly excluded.
        """
        available_tools = self.list_tools(available_only=True)
        return [tool.to_gemini_declaration() for tool in available_tools]

    def execute(
        self,
        name: str,
        args: Dict[str, Any] | BaseModel,
        context: ToolContext,
        timeout_seconds: Optional[float] = None,
    ) -> ToolResult:
        """Common execution pipeline for all agent tools.

        Pipeline:
        1. Tool lookup in registry
        2. Tool availability check (reject DISABLED / UNSUPPORTED)
        3. Typed input validation via Pydantic
        4. Deterministic service invocation with timing
        5. Structured ToolResult generation
        6. Operational execution trace recording
        """
        start_time = time.perf_counter()
        trace_id = f"exec-{uuid.uuid4().hex[:12]}"
        tool_name = name

        # 1. Tool Lookup
        if not self.has_tool(name):
            err_res = ToolResult.failure_result(
                tool_name=name,
                error=f"Tool '{name}' is not registered in the Agent Tool Registry.",
                error_code="TOOL_UNKNOWN",
            )
            self._record_trace(
                trace_id=trace_id,
                context=context,
                tool_name=name,
                category="UNKNOWN",
                access_mode="UNKNOWN",
                status=ToolResultStatus.FAILURE.value,
                input_summary=self._sanitize_input_summary(args),
                result_summary=err_res.error or "Unknown tool",
                duration_ms=(time.perf_counter() - start_time) * 1000,
                error=err_res.error,
            )
            return err_res

        tool = self.get(name)

        # 2. Availability Check
        if tool.availability != ToolAvailabilityStatus.AVAILABLE:
            unsupported_res = ToolResult.unsupported_result(
                tool_name=name,
                reason=f"Tool '{name}' is currently {tool.availability.value} in this environment.",
            )
            self._record_trace(
                trace_id=trace_id,
                context=context,
                tool_name=name,
                category=tool.category.value,
                access_mode=tool.access_mode.value,
                status=ToolResultStatus.UNSUPPORTED.value,
                input_summary=self._sanitize_input_summary(args),
                result_summary=unsupported_res.error or "Tool unsupported",
                duration_ms=(time.perf_counter() - start_time) * 1000,
                error=unsupported_res.error,
            )
            return unsupported_res

        # 3. Input Validation
        if isinstance(args, dict):
            try:
                validated_args = tool.input_schema.model_validate(args)
            except ValidationError as ve:
                val_err_res = ToolResult.failure_result(
                    tool_name=name,
                    error=f"Validation failed for tool '{name}' input: {str(ve)}",
                    error_code="TOOL_INVALID_INPUT",
                    metadata={"validation_errors": ve.errors()},
                )
                self._record_trace(
                    trace_id=trace_id,
                    context=context,
                    tool_name=name,
                    category=tool.category.value,
                    access_mode=tool.access_mode.value,
                    status=ToolResultStatus.FAILURE.value,
                    input_summary=self._sanitize_input_summary(args),
                    result_summary="Input validation failed",
                    duration_ms=(time.perf_counter() - start_time) * 1000,
                    error=val_err_res.error,
                )
                return val_err_res
        elif isinstance(args, tool.input_schema):
            validated_args = args
        else:
            val_err_res = ToolResult.failure_result(
                tool_name=name,
                error=f"Expected input schema of type '{tool.input_schema.__name__}', got '{type(args).__name__}'.",
                error_code="TOOL_INVALID_INPUT",
            )
            return val_err_res

        # 4. Deterministic Execution
        try:
            result = tool.execute(context=context, args=validated_args)

        except PermissionDeniedError as pde:
            result = ToolResult.failure_result(
                tool_name=name,
                error=pde.message,
                error_code=pde.code,
                metadata=pde.details,
            )
        except ApprovalRequiredError as are:
            result = ToolResult.approval_required_result(
                tool_name=name,
                approval_id=are.details.get("approval_id") or "pending",
                reason=are.message,
                metadata=are.details,
            )
        except Exception as e:
            logger.exception(f"Unexpected execution error in tool '{name}': {e}")
            result = ToolResult.failure_result(
                tool_name=name,
                error=f"Deterministic execution failed: {str(e)}",
                error_code="TOOL_EXECUTION_FAILED",
            )

        duration_ms = (time.perf_counter() - start_time) * 1000

        # 5. Record Execution Trace
        summary_str = f"Status: {result.status.value}"
        if result.success and result.data:
            summary_str += f" | Output: {type(result.data).__name__}"
        elif result.error:
            summary_str += f" | Error: {result.error}"

        self._record_trace(
            trace_id=trace_id,
            context=context,
            tool_name=name,
            category=tool.category.value,
            access_mode=tool.access_mode.value,
            status=result.status.value,
            input_summary=self._sanitize_input_summary(validated_args.model_dump()),
            result_summary=summary_str,
            duration_ms=duration_ms,
            error=result.error,
        )

        return result

    def get_traces(self, event_id: Optional[str] = None, limit: int = 50) -> List[ExecutionTraceRecord]:
        """Retrieves in-memory execution traces for auditing and testing."""
        if event_id:
            filtered = [t for t in self._execution_traces if t.event_id == event_id]
        else:
            filtered = self._execution_traces
        return filtered[-limit:]

    def clear_traces(self) -> None:
        """Clears in-memory traces (used in test fixtures)."""
        self._execution_traces.clear()

    def _record_trace(
        self,
        trace_id: str,
        context: ToolContext,
        tool_name: str,
        category: str,
        access_mode: str,
        status: str,
        input_summary: Dict[str, Any],
        result_summary: str,
        duration_ms: float,
        error: Optional[str] = None,
    ) -> None:
        rec = ExecutionTraceRecord(
            trace_id=trace_id,
            run_id=context.run_id,
            event_id=context.event_id,
            tool_name=tool_name,
            category=category,
            access_mode=access_mode,
            user_id=context.user_id,
            status=status,
            input_summary=input_summary,
            result_summary=result_summary,
            duration_ms=round(duration_ms, 2),
            error=error,
        )
        self._execution_traces.append(rec)

    @classmethod
    def _sanitize_input_summary(cls, args: Any) -> Dict[str, Any]:
        """Produces a safe, sanitized summary of arguments without credentials or giant payloads."""
        if isinstance(args, BaseModel):
            raw = args.model_dump()
        elif isinstance(args, dict):
            raw = dict(args)
        else:
            return {"type": str(type(args))}

        return cls._sanitize_dict(raw)

    @classmethod
    def _sanitize_dict(cls, d: Dict[str, Any]) -> Dict[str, Any]:
        sanitized = {}
        for k, v in d.items():
            if any(secret in k.lower() for secret in ("key", "secret", "password", "token", "auth")):
                sanitized[k] = "[REDACTED]"
            elif isinstance(v, dict):
                sanitized[k] = cls._sanitize_dict(v)
            elif isinstance(v, (str, int, float, bool)) or v is None:
                sanitized[k] = v
            elif isinstance(v, list):
                sanitized[k] = f"list(len={len(v)})"
            else:
                sanitized[k] = str(v)
        return sanitized


def create_default_tool_registry() -> AgentToolRegistry:
    """Factory creating and populating the default AgentToolRegistry with all canonical tools."""
    from app.agent.tools.event_tools import (
        GetEventStateTool,
        GetEventSpecTool,
        GetOperationalStatusTool,
        GetActiveConstraintsTool,
    )
    from app.agent.tools.planning_tools import (
        GetPlanTool,
        GetTaskTool,
        GetDependenciesTool,
        GetCriticalPathTool,
        CreateOrUpdateTaskTool,
    )
    from app.agent.tools.provider_tools import (
        DiscoverProvidersTool,
        QualifyProviderTool,
        CheckProviderAvailabilityTool,
        CompareCandidatesTool,
    )
    from app.agent.tools.impact_tools import AnalyzeImpactTool
    from app.agent.tools.risk_tools import AssessRiskTool
    from app.agent.tools.recovery_tools import (
        GetActiveIncidentsTool,
        InspectIncidentTool,
        GenerateRecoveryOptionsTool,
        ValidateRecoveryOptionTool,
        ExecuteRecoveryTool,
    )
    from app.agent.tools.trace_tools import (
        RecordDecisionTool,
        GetDecisionTraceTool,
    )

    registry = AgentToolRegistry()

    # 1. Event / State Tools
    registry.register(GetEventStateTool())
    registry.register(GetEventSpecTool())
    registry.register(GetOperationalStatusTool())
    registry.register(GetActiveConstraintsTool())

    # 2. Planning Tools
    registry.register(GetPlanTool())
    registry.register(GetTaskTool())
    registry.register(GetDependenciesTool())
    registry.register(GetCriticalPathTool())
    registry.register(CreateOrUpdateTaskTool())

    # 3. Provider Tools
    registry.register(DiscoverProvidersTool())
    registry.register(QualifyProviderTool())
    registry.register(CheckProviderAvailabilityTool())
    registry.register(CompareCandidatesTool())

    # 4. Impact & Risk Tools
    registry.register(AnalyzeImpactTool())
    registry.register(AssessRiskTool())

    # 5. Recovery Tools
    registry.register(GetActiveIncidentsTool())
    registry.register(InspectIncidentTool())
    registry.register(GenerateRecoveryOptionsTool())
    registry.register(ValidateRecoveryOptionTool())
    registry.register(ExecuteRecoveryTool())

    # 6. Observability Tools
    registry.register(RecordDecisionTool())
    registry.register(GetDecisionTraceTool())

    return registry


# Global canonical singleton registry
_default_registry: Optional[AgentToolRegistry] = None


def get_agent_tool_registry() -> AgentToolRegistry:
    """Provides the global canonical AgentToolRegistry instance."""
    global _default_registry
    if _default_registry is None:
        _default_registry = create_default_tool_registry()
    return _default_registry
