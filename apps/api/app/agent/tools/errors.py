"""Typed tool exceptions for EVENTRA Agent Tool Layer.

Provides structured, machine-readable error classes for tool lookup, argument validation,
permission boundaries, approval requirements, execution failures, timeouts, and verification.
Raw internal stack traces are never exposed to the LLM or end-users.
"""
from typing import Any, Dict, Optional
from app.core.exceptions import AppException


class ToolError(AppException):
    """Base exception for all agent tool layer errors."""

    def __init__(
        self,
        message: str,
        code: str = "TOOL_ERROR",
        details: Optional[Dict[str, Any]] = None,
        status_code: int = 500,
    ):
        super().__init__(message=message, status_code=status_code, code=code, details=details)


class UnknownToolError(ToolError):
    """Raised when an unrecognized tool name is requested."""

    def __init__(self, tool_name: str):
        super().__init__(
            message=f"Tool '{tool_name}' is not registered in the Agent Tool Registry.",
            code="TOOL_UNKNOWN",
            details={"tool_name": tool_name},
            status_code=404,
        )


class InvalidToolInputError(ToolError):
    """Raised when tool arguments fail Pydantic validation."""

    def __init__(self, tool_name: str, errors: Any):
        super().__init__(
            message=f"Invalid arguments provided for tool '{tool_name}'.",
            code="TOOL_INVALID_INPUT",
            details={"tool_name": tool_name, "validation_errors": str(errors)},
            status_code=422,
        )


class PermissionDeniedError(ToolError):
    """Raised when an agent action is rejected by server-side authorization."""

    def __init__(self, tool_name: str, reason: str, user_id: str, action_type: Optional[str] = None):
        super().__init__(
            message=f"Permission denied for tool '{tool_name}': {reason}",
            code="TOOL_PERMISSION_DENIED",
            details={
                "tool_name": tool_name,
                "user_id": user_id,
                "reason": reason,
                "action_type": action_type,
            },
            status_code=403,
        )


class ApprovalRequiredError(ToolError):
    """Raised when an action requires human approval before execution."""

    def __init__(
        self,
        tool_name: str,
        action_type: str,
        impact_level: str,
        approval_id: Optional[str] = None,
        reason: Optional[str] = None,
    ):
        super().__init__(
            message=f"Tool '{tool_name}' requires human approval ({impact_level} impact) before execution.",
            code="TOOL_APPROVAL_REQUIRED",
            details={
                "tool_name": tool_name,
                "action_type": action_type,
                "impact_level": impact_level,
                "approval_id": approval_id,
                "reason": reason or "Action exceeds direct execution authority.",
            },
            status_code=403,
        )


class ToolExecutionFailedError(ToolError):
    """Raised when a deterministic underlying service raises an unexpected failure."""

    def __init__(self, tool_name: str, reason: str, details: Optional[Dict[str, Any]] = None):
        merged = {"tool_name": tool_name, "reason": reason}
        if details:
            merged.update(details)
        super().__init__(
            message=f"Execution of tool '{tool_name}' failed: {reason}",
            code="TOOL_EXECUTION_FAILED",
            details=merged,
            status_code=500,
        )


class ToolTimeoutError(ToolError):
    """Raised when a tool execution exceeds the bounded timeout window."""

    def __init__(self, tool_name: str, timeout_seconds: float):
        super().__init__(
            message=f"Tool '{tool_name}' timed out after {timeout_seconds} seconds.",
            code="TOOL_TIMEOUT",
            details={"tool_name": tool_name, "timeout_seconds": timeout_seconds},
            status_code=504,
        )


class UnsupportedToolError(ToolError):
    """Raised when a tool is recognized but disabled/unsupported in the current environment."""

    def __init__(self, tool_name: str, reason: Optional[str] = None):
        super().__init__(
            message=reason or f"Tool '{tool_name}' is currently disabled or unsupported.",
            code="TOOL_UNSUPPORTED",
            details={"tool_name": tool_name, "reason": reason},
            status_code=400,
        )


class VerificationFailedError(ToolError):
    """Raised when post-execution verification fails after a mutating tool action."""

    def __init__(self, tool_name: str, failure_reasons: Any):
        super().__init__(
            message=f"Verification failed after executing tool '{tool_name}'.",
            code="TOOL_VERIFICATION_FAILED",
            details={"tool_name": tool_name, "failure_reasons": failure_reasons},
            status_code=422,
        )
