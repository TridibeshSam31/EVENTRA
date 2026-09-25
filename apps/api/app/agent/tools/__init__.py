"""Agent Tools package exposing the real typed Agent Tool Layer and central tool registry for EVENTRA."""

# Task 4 Functional Tool Registry & Loop Artifacts
from app.agent.tools.registry import (
    ToolCategory,
    ToolStatus,
    ToolResult,
    ToolDefinition,
    ToolRegistry,
    default_registry,
    create_default_functional_tool_registry,
)

# Task 3 Central Typed Tool Registry & Base Contracts
from app.agent.tools.base import (
    AgentTool,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolResultStatus,
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

# Task 3 Domain Tools
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
    GenerateFinalExecutionPlanTool,
)
from app.agent.tools.provider_tools import (
    DiscoverProvidersTool,
    QualifyProviderTool,
    CheckProviderAvailabilityTool,
    CompareCandidatesTool,
    ShortlistVendorsTool,
    SubmitVendorOutcomeTool,
    ValidateVendorOutcomeTool,
)
from app.agent.tools.impact_tools import AnalyzeImpactTool
from app.agent.tools.risk_tools import AssessRiskTool
from app.agent.tools.recovery_tools import (
    GetActiveIncidentsTool,
    InspectIncidentTool,
    GenerateRecoveryOptionsTool,
    ValidateRecoveryOptionTool,
    ExecuteRecoveryTool,
    CallVendorTool,
)
from app.agent.tools.trace_tools import (
    RecordDecisionTool,
    GetDecisionTraceTool,
)

# Operations & Communication function exports (backward-compatible)
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
    get_negotiation_constraints,
    submit_vendor_negotiation_response,
    request_negotiation_approval,
    confirm_authorized_engagement,
    call_vendor,
)

__all__ = [
    # Task 4 Functional Tool Registry & Loop Artifacts
    "ToolCategory",
    "ToolStatus",
    "ToolResult",
    "ToolDefinition",
    "ToolRegistry",
    "default_registry",
    "create_default_functional_tool_registry",
    # Task 3 Central Typed Tool Registry & Base Contracts
    "AgentToolRegistry",
    "get_agent_tool_registry",
    "create_default_tool_registry",
    "AgentTool",
    "ToolAccessMode",
    "ToolAvailabilityStatus",
    "ToolResultStatus",
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
    "GenerateFinalExecutionPlanTool",
    # Provider Tools
    "DiscoverProvidersTool",
    "QualifyProviderTool",
    "CheckProviderAvailabilityTool",
    "CompareCandidatesTool",
    "ShortlistVendorsTool",
    "SubmitVendorOutcomeTool",
    "ValidateVendorOutcomeTool",
    # Impact & Risk Tools
    "AnalyzeImpactTool",
    "AssessRiskTool",
    # Recovery Tools
    "GetActiveIncidentsTool",
    "InspectIncidentTool",
    "GenerateRecoveryOptionsTool",
    "ValidateRecoveryOptionTool",
    "ExecuteRecoveryTool",
    "CallVendorTool",
    # Observability Tools
    "RecordDecisionTool",
    "GetDecisionTraceTool",
    # Legacy operations & communication functions
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
    "get_negotiation_constraints",
    "submit_vendor_negotiation_response",
    "request_negotiation_approval",
    "confirm_authorized_engagement",
    "call_vendor",
]
