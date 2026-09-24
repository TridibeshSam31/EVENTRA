"""Agent Tools package exposing the real typed Agent Tool Layer for EVENTRA.

Provides:
- Central AgentToolRegistry and singleton getter
- Base tool contracts, schemas, categories, and ToolResult
- Typed exceptions
- Domain tools across Event/State, Planning, Provider, Impact/Risk, Recovery, and Observability
- Backward-compatible wrappers for legacy operations tools
"""
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
    ToolError,
    UnknownToolError,
    InvalidToolInputError,
    PermissionDeniedError,
    ApprovalRequiredError,
    ToolExecutionFailedError,
    ToolTimeoutError,
    UnsupportedToolError,
    VerificationFailedError,
)
from app.agent.tools.registry import (
    AgentToolRegistry,
    get_agent_tool_registry,
    create_default_tool_registry,
)
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

# Backward-compatible function exports for legacy Phase 11 agent graph & tests
from app.agent.tools.operations_tools import (
    get_event_state,
    get_incidents,
    get_incident_details,
    analyze_impact,
    calculate_risk,
    generate_recovery_options,
    validate_recovery_option,
    check_action_authorization,
    request_action_approval,
    check_approval_status,
    execute_action,
    verify_action,
    get_decision_trace,
    start_autonomous_operations,
    modify_event_plan,
)
from app.agent.tools.communication_tools import (
    contact_provider,
    negotiate_with_provider,
    request_provider_approval,
    confirm_provider_engagement,
    simulate_provider_response,
    get_provider_negotiation_history,
)

__all__ = [
    # Registry & Core
    "AgentToolRegistry",
    "get_agent_tool_registry",
    "create_default_tool_registry",
    "AgentTool",
    "ToolCategory",
    "ToolAccessMode",
    "ToolAvailabilityStatus",
    "ToolResultStatus",
    "ToolResult",
    "ToolContext",
    "ExecutionTraceRecord",
    # Typed Errors
    "ToolError",
    "UnknownToolError",
    "InvalidToolInputError",
    "PermissionDeniedError",
    "ApprovalRequiredError",
    "ToolExecutionFailedError",
    "ToolTimeoutError",
    "UnsupportedToolError",
    "VerificationFailedError",
    # Event Tools
    "GetEventStateTool",
    "GetEventSpecTool",
    "GetOperationalStatusTool",
    "GetActiveConstraintsTool",
    # Planning Tools
    "GetPlanTool",
    "GetTaskTool",
    "GetDependenciesTool",
    "GetCriticalPathTool",
    "CreateOrUpdateTaskTool",
    # Provider Tools
    "DiscoverProvidersTool",
    "QualifyProviderTool",
    "CheckProviderAvailabilityTool",
    "CompareCandidatesTool",
    # Impact & Risk Tools
    "AnalyzeImpactTool",
    "AssessRiskTool",
    # Recovery Tools
    "GetActiveIncidentsTool",
    "InspectIncidentTool",
    "GenerateRecoveryOptionsTool",
    "ValidateRecoveryOptionTool",
    "ExecuteRecoveryTool",
    # Observability Tools
    "RecordDecisionTool",
    "GetDecisionTraceTool",
    # Legacy operations functions
    "get_event_state",
    "get_incidents",
    "get_incident_details",
    "analyze_impact",
    "calculate_risk",
    "generate_recovery_options",
    "validate_recovery_option",
    "check_action_authorization",
    "request_action_approval",
    "check_approval_status",
    "execute_action",
    "verify_action",
    "get_decision_trace",
    "start_autonomous_operations",
    "modify_event_plan",
    "contact_provider",
    "negotiate_with_provider",
    "request_provider_approval",
    "confirm_provider_engagement",
    "simulate_provider_response",
    "get_provider_negotiation_history",
]
