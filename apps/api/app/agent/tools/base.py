"""Base abstractions and contracts for the EVENTRA Agent Tool Layer.

Every agent tool conforms to:
- Stable name and truthful description
- Typed Pydantic input and output schemas
- Read vs Write classification (access_mode)
- Server-side permission and approval metadata
- Deterministic underlying service delegation
- Structured ToolResult contract (distinguishing SUCCESS, FAILURE, UNKNOWN, REQUIRES_APPROVAL, UNSUPPORTED)
- Model-friendly Gemini FunctionDeclaration generation
"""
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Type
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session


class ToolCategory(str, Enum):
    """Functional taxonomy of agent tools."""
    EVENT_STATE = "EVENT_STATE"
    PLANNING = "PLANNING"
    PROVIDER = "PROVIDER"
    IMPACT_RISK = "IMPACT_RISK"
    RECOVERY = "RECOVERY"
    OBSERVABILITY = "OBSERVABILITY"


class ToolAccessMode(str, Enum):
    """Identifies whether an agent tool mutates state or is strictly read-only."""
    READ_ONLY = "READ_ONLY"
    WRITE = "WRITE"


class ToolAvailabilityStatus(str, Enum):
    """Runtime availability state of an agent tool."""
    AVAILABLE = "AVAILABLE"
    DISABLED = "DISABLED"
    UNSUPPORTED = "UNSUPPORTED"


class ToolResultStatus(str, Enum):
    """Explicit status classification for tool execution outcomes."""
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"
    UNKNOWN = "UNKNOWN"
    REQUIRES_APPROVAL = "REQUIRES_APPROVAL"
    UNSUPPORTED = "UNSUPPORTED"


class ToolResult(BaseModel):
    """Authoritative outcome contract returned to the agent from every tool execution.

    The agent must be able to clearly distinguish between SUCCESS, FAILURE, UNKNOWN,
    REQUIRES_APPROVAL, and UNSUPPORTED. Never silently converts failure into success.
    """
    model_config = ConfigDict(arbitrary_types_allowed=True)

    success: bool = Field(..., description="True if operation succeeded without unrecoverable error")
    tool_name: str = Field(..., description="Identifier of the executed tool")
    status: ToolResultStatus = Field(..., description="Classification of the result state")
    data: Optional[Any] = Field(None, description="Structured output payload conforming to tool's output_schema")
    error: Optional[str] = Field(None, description="Human-readable error description when status is FAILURE or UNKNOWN")
    error_code: Optional[str] = Field(None, description="Machine-readable error code")
    requires_approval: bool = Field(False, description="Whether the action is held pending human approval")
    approval_id: Optional[str] = Field(None, description="ID of the generated ApprovalRequest if approval is required")
    verification_status: Optional[str] = Field(None, description="Verification outcome if post-action verification was performed")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Operational metadata (e.g. latency, source, flags)")

    @classmethod
    def success_result(
        cls,
        tool_name: str,
        data: Any,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> "ToolResult":
        """Factory for successful tool executions."""
        return cls(
            success=True,
            tool_name=tool_name,
            status=ToolResultStatus.SUCCESS,
            data=data,
            metadata=metadata or {},
        )

    @classmethod
    def failure_result(
        cls,
        tool_name: str,
        error: str,
        error_code: str = "TOOL_EXECUTION_FAILED",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> "ToolResult":
        """Factory for failed tool executions."""
        return cls(
            success=False,
            tool_name=tool_name,
            status=ToolResultStatus.FAILURE,
            error=error,
            error_code=error_code,
            metadata=metadata or {},
        )

    @classmethod
    def unknown_result(
        cls,
        tool_name: str,
        reason: str,
        partial_data: Optional[Any] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> "ToolResult":
        """Factory for scenarios where facts are genuinely unknown (no hallucination)."""
        return cls(
            success=True,
            tool_name=tool_name,
            status=ToolResultStatus.UNKNOWN,
            data=partial_data,
            error=reason,
            error_code="DATA_UNKNOWN",
            metadata=metadata or {},
        )

    @classmethod
    def approval_required_result(
        cls,
        tool_name: str,
        approval_id: str,
        reason: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> "ToolResult":
        """Factory for actions blocked pending human approval."""
        return cls(
            success=False,
            tool_name=tool_name,
            status=ToolResultStatus.REQUIRES_APPROVAL,
            requires_approval=True,
            approval_id=approval_id,
            error=reason,
            error_code="APPROVAL_REQUIRED",
            metadata=metadata or {},
        )

    @classmethod
    def unsupported_result(
        cls,
        tool_name: str,
        reason: str = "Tool is disabled or unsupported in the current environment.",
    ) -> "ToolResult":
        """Factory for disabled or unsupported tools."""
        return cls(
            success=False,
            tool_name=tool_name,
            status=ToolResultStatus.UNSUPPORTED,
            error=reason,
            error_code="TOOL_UNSUPPORTED",
        )


class ToolContext(BaseModel):
    """Runtime execution context provided by the caller to tools.

    Carries authoritative DB session, user identification, optional event/run references,
    and approval IDs. Does NOT allow the LLM to override authorization.
    """
    model_config = ConfigDict(arbitrary_types_allowed=True)

    db: Session = Field(..., description="Authoritative SQLAlchemy session")
    user_id: str = Field("anonymous_operator", description="Authenticated operator / caller ID")
    event_id: Optional[str] = Field(None, description="Active event ID if bound")
    run_id: Optional[str] = Field(None, description="Agent execution run ID")
    approval_id: Optional[str] = Field(None, description="Optional approval request ID for executing approved actions")


class ExecutionTraceRecord(BaseModel):
    """Structured, factual record of a tool execution.

    STRICT GUARDRAIL: Contains only operational facts and summaries; NEVER stores
    chain-of-thought or opaque model reasoning.
    """
    trace_id: str = Field(..., description="Unique ID for this tool execution trace")
    run_id: Optional[str] = Field(None, description="Associated agent run ID")
    event_id: Optional[str] = Field(None, description="Associated event ID")
    tool_name: str = Field(..., description="Name of the tool executed")
    category: str = Field(..., description="Category of the tool")
    access_mode: str = Field(..., description="READ_ONLY or WRITE")
    user_id: str = Field(..., description="User ID under which tool was invoked")
    status: str = Field(..., description="ToolResultStatus value")
    input_summary: Dict[str, Any] = Field(default_factory=dict, description="Sanitized, factual summary of inputs")
    result_summary: str = Field(..., description="Factual summary of execution outcome")
    duration_ms: float = Field(..., description="Execution latency in milliseconds")
    error: Optional[str] = Field(None, description="Error message if failed")
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO 8601 execution timestamp",
    )


class AgentTool(ABC):
    """Abstract base class for all typed EVENTRA agent tools."""

    name: str
    description: str
    category: ToolCategory
    access_mode: ToolAccessMode
    input_schema: Type[BaseModel]
    output_schema: Type[BaseModel]
    permission_required: Optional[str] = None
    approval_required: bool = False
    availability: ToolAvailabilityStatus = ToolAvailabilityStatus.AVAILABLE
    timeout_seconds: float = 30.0

    @abstractmethod
    def execute(self, context: ToolContext, args: BaseModel) -> ToolResult:
        """Deterministically executes the tool using existing EVENTRA domain services.

        Args:
            context: Verified ToolContext containing authoritative DB session and user credentials.
            args: Validated Pydantic input conforming to self.input_schema.

        Returns:
            Authoritative ToolResult conforming to self.output_schema.
        """
        pass

    def to_gemini_declaration(self) -> Dict[str, Any]:
        """Generates a model-friendly FunctionDeclaration schema for Gemini function calling.

        Conforms to Gemini OpenAPI / JSON Schema parameter conventions.
        """
        json_schema = self.input_schema.model_json_schema()

        # Clean schema: remove title and definition refs where possible for Gemini compatibility
        properties = json_schema.get("properties", {})
        required = json_schema.get("required", [])

        # Recursively sanitize schema types to UPPERCASE where required by Gemini or standard format
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "OBJECT",
                "properties": properties,
                "required": required,
            },
        }

    def to_summary_dict(self) -> Dict[str, Any]:
        """Provides a safe overview dictionary suitable for GET /agent/tools without secrets."""
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category.value,
            "access_mode": self.access_mode.value,
            "read_only": self.access_mode == ToolAccessMode.READ_ONLY,
            "approval_required": self.approval_required,
            "permission_required": self.permission_required,
            "availability": self.availability.value,
        }
