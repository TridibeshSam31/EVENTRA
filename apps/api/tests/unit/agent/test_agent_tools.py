"""Unit tests for Task 3: Real Agent Tool Layer, Typed Registry, and Hard Guardrails.

Verifies:
1. Tool Registry mechanics, duplicate rejection, and Gemini tool declarations
2. Input/Output schemas and malformed argument rejection
3. Server-side permission boundaries and human approval gates
4. Deterministic service invocation (no DB bypass, no LLM hallucinations)
5. Explicit failure modes, unknown fact preservation, and bounded execution
6. Decision tracing and secret redaction
7. Full Golden Demo workflow execution
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.vendor import Vendor
from app.models.provider_availability import ProviderAvailability
from app.models.budget import BudgetItem
from app.models.incident import Incident
from app.models.recovery import Recovery
from app.models.approval import Approval
from app.models.enums import (
    EventLifecycleState,
    EventState,
    RoleType,
    TaskPriority,
    TaskStatus,
    IncidentType,
    IncidentSeverity,
    EventType,
)
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolResultStatus,
    ToolResult,
    ToolContext,
)
from app.agent.tools.errors import (
    UnknownToolError,
    InvalidToolInputError,
    PermissionDeniedError,
    ApprovalRequiredError,
)
from app.agent.tools.registry import (
    AgentToolRegistry,
    get_agent_tool_registry,
    create_default_tool_registry,
)
from app.agent.tools.schemas import (
    GetEventStateInput,
    GetEventSpecInput,
    GetOperationalStatusInput,
    GetActiveConstraintsInput,
    GetPlanInput,
    GetTaskInput,
    GetDependenciesInput,
    GetCriticalPathInput,
    CreateOrUpdateTaskInput,
    DiscoverProvidersInput,
    QualifyProviderInput,
    CheckProviderAvailabilityInput,
    CompareCandidatesInput,
    AnalyzeImpactInput,
    AssessRiskInput,
    GetActiveIncidentsInput,
    InspectIncidentInput,
    GenerateRecoveryOptionsInput,
    ValidateRecoveryOptionInput,
    ExecuteRecoveryInput,
    RecordDecisionInput,
    GetDecisionTraceInput,
)


# ==============================================================================
# TEST FIXTURES & SETUP HELPERS
# ==============================================================================

def _setup_test_environment(db: Session):
    """Sets up a complete deterministic test event with organizer, tasks, vendors, and budget."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    organizer = User(name="Priya Sharma", email="priya.organizer@eventra.test")
    db.add(organizer)
    db.flush()

    event = Event(
        owner_id=organizer.id,
        name="Grand Royal Wedding",
        event_type="wedding",
        lifecycle_state=EventLifecycleState.PLANNED.value,
        state=EventState.NORMAL.value,
        location="Delhi",
        start_datetime=now + timedelta(days=60),
        end_datetime=now + timedelta(days=60, hours=8),
        guest_count=600,
        total_budget=Decimal("1200000.00"),
        currency="INR",
    )
    db.add(event)
    db.flush()

    member = EventMember(
        event_id=event.id,
        user_id=organizer.id,
        role=RoleType.MAIN_ORGANIZER.value,
    )
    db.add(member)

    # Add tasks
    task1 = Task(
        event_id=event.id,
        name="Venue Setup & Mandap",
        status=TaskStatus.READY.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=180,
        is_critical_path=True,
        required_provider_category="venue",
        planned_start=now + timedelta(days=60),
        planned_end=now + timedelta(days=60, hours=3),
    )
    task2 = Task(
        event_id=event.id,
        name="Royal Vegetarian Catering Setup",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=120,
        is_critical_path=True,
        required_provider_category="catering",
        planned_start=now + timedelta(days=60, hours=3),
        planned_end=now + timedelta(days=60, hours=5),
    )
    db.add_all([task1, task2])
    db.flush()

    # Add dependency: task1 -> task2
    dep = TaskDependency(
        event_id=event.id,
        predecessor_task_id=task1.id,
        successor_task_id=task2.id,
        dependency_type="FINISH_TO_START",
        lag_minutes=0,
    )
    db.add(dep)

    # Add budget items
    b1 = BudgetItem(
        event_id=event.id,
        name="Catering Budget",
        category="catering",
        estimated_amount=Decimal("500000.00"),
        actual_amount=Decimal("150000.00"),
    )
    b2 = BudgetItem(
        event_id=event.id,
        name="Venue & Decor",
        category="venue",
        estimated_amount=Decimal("400000.00"),
        actual_amount=Decimal("200000.00"),
    )
    db.add_all([b1, b2])

    # Add vendors
    v1 = Vendor(
        name="Delhi Royal Caterers",
        category="catering",
        city="Delhi",
        base_cost=350000.0,
        rating=4.8,
        review_count=85,
        status="ACTIVE",
        capabilities=["vegetarian", "jain_food", "live_counters"],
    )
    v2 = Vendor(
        name="Classic Feast Catering",
        category="catering",
        city="Delhi",
        base_cost=450000.0,
        rating=4.5,
        review_count=32,
        status="ACTIVE",
        capabilities=["north_indian", "vegetarian"],
    )
    db.add_all([v1, v2])
    db.commit()

    return organizer, event, [task1, task2], [v1, v2]


# ==============================================================================
# 1. TOOL REGISTRY TESTS
# ==============================================================================

def test_registry_registers_all_canonical_tools():
    """Verifies that the canonical registry registers all required tools."""
    registry = create_default_tool_registry()
    tools = registry.list_tools(available_only=False)

    tool_names = {t.name for t in tools}
    expected_tools = {
        # Event
        "get_event_state",
        "get_event_spec",
        "get_operational_status",
        "get_active_constraints",
        # Planning
        "get_plan",
        "get_task",
        "get_dependencies",
        "get_critical_path",
        "create_or_update_task",
        # Provider
        "discover_providers",
        "qualify_provider",
        "check_provider_availability",
        "compare_candidates",
        # Impact / Risk
        "analyze_impact",
        "assess_risk",
        # Recovery
        "get_active_incidents",
        "inspect_incident",
        "generate_recovery_options",
        "validate_recovery_option",
        "execute_recovery",
        # Observability
        "record_decision",
        "get_decision_trace",
    }
    assert expected_tools.issubset(tool_names), f"Missing tools: {expected_tools - tool_names}"


def test_registry_rejects_duplicate_names():
    """Verifies that registering a tool with an existing name raises ValueError."""
    registry = create_default_tool_registry()
    existing_tool = registry.get("get_event_state")

    with pytest.raises(ValueError, match="already registered"):
        registry.register(existing_tool)


def test_registry_rejects_unknown_tool(db_session: Session):
    """Verifies that requesting an unregistered tool name returns a structured FAILURE."""
    registry = create_default_tool_registry()
    context = ToolContext(db=db_session, user_id="test_user")

    res = registry.execute("non_existent_tool_123", {}, context)
    assert not res.success
    assert res.status == ToolResultStatus.FAILURE
    assert res.error_code == "TOOL_UNKNOWN"


def test_registry_get_llm_tools_schema():
    """Verifies that get_llm_tools produces model-friendly Gemini tool declarations."""
    registry = create_default_tool_registry()
    declarations = registry.get_llm_tools()

    assert len(declarations) > 0
    for decl in declarations:
        assert "name" in decl
        assert "description" in decl
        assert "parameters" in decl
        assert decl["parameters"]["type"] == "OBJECT"
        assert "properties" in decl["parameters"]


# ==============================================================================
# 2. SCHEMA & VALIDATION TESTS
# ==============================================================================

def test_registry_rejects_invalid_tool_input(db_session: Session):
    """Verifies that malformed arguments are caught before reaching domain services."""
    registry = create_default_tool_registry()
    organizer, event, _, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # Missing required argument 'event_id'
    res = registry.execute("get_event_state", {}, context)
    assert not res.success
    assert res.status == ToolResultStatus.FAILURE
    assert res.error_code == "TOOL_INVALID_INPUT"


# ==============================================================================
# 3. PERMISSION & APPROVAL GUARDRAILS
# ==============================================================================

def test_unauthorized_user_cannot_mutate_task(db_session: Session):
    """Verifies that a user with VIEWER role is blocked from executing WRITE operations."""
    registry = create_default_tool_registry()
    organizer, event, tasks, _ = _setup_test_environment(db_session)

    # Create a viewer user
    viewer = User(name="Bob Viewer", email="bob.viewer@eventra.test")
    db_session.add(viewer)
    db_session.flush()

    member = EventMember(
        event_id=event.id,
        user_id=viewer.id,
        role=RoleType.VIEWER.value,
    )
    db_session.add(member)
    db_session.commit()

    context = ToolContext(db=db_session, user_id=viewer.id, event_id=event.id)
    args = {
        "event_id": event.id,
        "task_id": tasks[0].id,
        "name": "Unauthorized Task Mutation",
    }

    res = registry.execute("create_or_update_task", args, context)
    assert not res.success
    assert res.error_code in ("TOOL_PERMISSION_DENIED", "AUTH_DENIED")


def test_consequential_recovery_requires_human_approval(db_session: Session):
    """Verifies that execute_recovery without an approved Approval record is held pending approval."""
    registry = create_default_tool_registry()
    organizer, event, tasks, _ = _setup_test_environment(db_session)

    # Create an incident and feasible recovery option
    inc = Incident(
        event_id=event.id,
        incident_type=IncidentType.VENDOR_DELAY.value,
        severity=IncidentSeverity.HIGH.value,
        title="Caterer Delayed",
        status="OPEN",
    )
    db_session.add(inc)
    db_session.flush()

    rec_opt = Recovery(
        event_id=event.id,
        incident_id=inc.id,
        strategy_type="REPLACE_VENDOR",
        status="FEASIBLE",
        is_feasible=True,
        score=0.92,
        rank=1,
        state_snapshot="snapshot_pre_recovery",
        proposed_changes=["Replace catering vendor"],
    )
    db_session.add(rec_opt)
    db_session.commit()

    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)
    args = {
        "event_id": event.id,
        "recovery_option_id": rec_opt.id,
    }

    # Execute without prior human approval
    res = registry.execute("execute_recovery", args, context)
    assert not res.success
    assert res.status == ToolResultStatus.REQUIRES_APPROVAL
    assert res.requires_approval is True
    assert res.approval_id is not None


# ==============================================================================
# 4. EVENT / STATE TOOLS TESTS
# ==============================================================================

def test_get_event_state_tool(db_session: Session):
    """Verifies get_event_state returns authoritative operational facts."""
    registry = create_default_tool_registry()
    organizer, event, tasks, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    res = registry.execute("get_event_state", {"event_id": event.id}, context)
    assert res.success
    assert res.status == ToolResultStatus.SUCCESS
    assert res.data.name == "Grand Royal Wedding"
    assert res.data.total_budget == 1200000.0
    assert res.data.budget_spent == 350000.0
    assert res.data.budget_remaining == 850000.0
    assert res.data.task_counts["total"] == 2
    assert res.data.task_counts["critical_path"] == 2


def test_get_event_spec_tool(db_session: Session):
    """Verifies get_event_spec returns the canonical EventSpecification."""
    registry = create_default_tool_registry()
    organizer, event, _, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    res = registry.execute("get_event_spec", {"event_id": event.id}, context)
    assert res.success
    assert res.status == ToolResultStatus.SUCCESS
    assert res.data.event_id == event.id
    assert res.data.guest_count == 600
    assert "catering" in [c.lower() for c in res.data.provider_categories]


def test_get_operational_status_tool(db_session: Session):
    """Verifies get_operational_status calculates operational telemetry correctly."""
    registry = create_default_tool_registry()
    organizer, event, _, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    res = registry.execute("get_operational_status", {"event_id": event.id}, context)
    assert res.success
    assert res.data.is_active is True
    assert res.data.critical_tasks_count == 2
    assert res.data.budget_utilization_percent > 0


def test_get_active_constraints_tool(db_session: Session):
    """Verifies get_active_constraints exposes hard invariants."""
    registry = create_default_tool_registry()
    organizer, event, _, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    res = registry.execute("get_active_constraints", {"event_id": event.id}, context)
    assert res.success
    assert res.data.total_constraints >= 2
    constraint_types = [c.type for c in res.data.constraints]
    assert "BUDGET" in constraint_types
    assert "CAPACITY" in constraint_types


# ==============================================================================
# 5. PLANNING TOOLS TESTS
# ==============================================================================

def test_get_plan_and_critical_path_tools(db_session: Session):
    """Verifies get_plan, get_task, get_dependencies, and get_critical_path."""
    registry = create_default_tool_registry()
    organizer, event, tasks, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # 1. get_plan
    plan_res = registry.execute("get_plan", {"event_id": event.id}, context)
    assert plan_res.success
    assert plan_res.data.total_tasks == 2

    # 2. get_task
    task_res = registry.execute("get_task", {"event_id": event.id, "task_id": tasks[0].id}, context)
    assert task_res.success
    assert task_res.data.name == tasks[0].name
    assert task_res.data.is_critical_path is True

    # 3. get_dependencies
    dep_res = registry.execute("get_dependencies", {"event_id": event.id}, context)
    assert dep_res.success
    assert dep_res.data.total == 1

    # 4. get_critical_path
    cp_res = registry.execute("get_critical_path", {"event_id": event.id}, context)
    assert cp_res.success
    assert cp_res.data.is_acyclic is True
    assert len(cp_res.data.critical_path_task_ids) == 2


def test_create_or_update_task_tool(db_session: Session):
    """Verifies that create_or_update_task can create and update tasks deterministically."""
    registry = create_default_tool_registry()
    organizer, event, _, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # Create a new task
    create_args = {
        "event_id": event.id,
        "name": "Photography & Videography Setup",
        "description": "Candid and traditional photo crew setup",
        "status": "READY",
        "priority": "HIGH",
        "duration_minutes": 90,
        "required_provider_category": "photography",
    }
    create_res = registry.execute("create_or_update_task", create_args, context)
    assert create_res.success
    assert create_res.data.is_created is True
    task_id = create_res.data.task_id

    # Update the created task
    update_args = {
        "event_id": event.id,
        "task_id": task_id,
        "status": "IN_PROGRESS",
    }
    update_res = registry.execute("create_or_update_task", update_args, context)
    assert update_res.success
    assert update_res.data.is_created is False
    assert update_res.data.status == "IN_PROGRESS"


# ==============================================================================
# 6. PROVIDER DISCOVERY & QUALIFICATION TESTS
# ==============================================================================

def test_discover_and_qualify_providers(db_session: Session):
    """Verifies discover_providers and qualify_provider without fabricated data."""
    registry = create_default_tool_registry()
    organizer, event, _, vendors = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # 1. Discover providers
    disc_args = {
        "event_id": event.id,
        "category": "catering",
        "location": "Delhi",
        "limit": 5,
    }
    disc_res = registry.execute("discover_providers", disc_args, context)
    assert disc_res.success
    assert disc_res.data.total_found >= 2
    for candidate in disc_res.data.providers:
        # Verify unknown facts are explicitly documented
        assert len(candidate.unknown_fields) > 0

    # 2. Qualify provider
    qual_args = {
        "event_id": event.id,
        "provider_id": vendors[0].id,
        "required_category": "catering",
        "max_budget": 400000.0,
        "required_capabilities": ["vegetarian"],
    }
    qual_res = registry.execute("qualify_provider", qual_args, context)
    assert qual_res.success
    assert qual_res.data.is_qualified is True
    assert qual_res.data.status == "QUALIFIED"
    assert qual_res.data.category_match is True
    assert qual_res.data.budget_check["passed"] is True
    assert "live_availability_for_event_dates" in qual_res.data.unknown_facts


def test_qualify_provider_disqualifies_over_budget(db_session: Session):
    """Verifies that qualify_provider fails deterministic budget check when base cost exceeds budget."""
    registry = create_default_tool_registry()
    organizer, event, _, vendors = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # vendor[1] has base_cost 450,000; set budget to 300,000
    qual_args = {
        "event_id": event.id,
        "provider_id": vendors[1].id,
        "required_category": "catering",
        "max_budget": 300000.0,
    }
    qual_res = registry.execute("qualify_provider", qual_args, context)
    assert qual_res.success
    assert qual_res.data.is_qualified is False
    assert qual_res.data.status == "DISQUALIFIED"
    assert qual_res.data.budget_check["passed"] is False


def test_compare_candidates_tool(db_session: Session):
    """Verifies compare_candidates performs deterministic side-by-side evaluation."""
    registry = create_default_tool_registry()
    organizer, event, _, vendors = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    args = {
        "event_id": event.id,
        "provider_ids": [vendors[0].id, vendors[1].id],
    }
    res = registry.execute("compare_candidates", args, context)
    assert res.success
    assert res.data.total_compared == 2
    assert len(res.data.comparison_matrix) == 2
    # Verify deterministic ordering: Delhi Royal Caterers has rating 4.8 vs 4.5
    assert res.data.comparison_matrix[0].name == "Delhi Royal Caterers"


def test_check_provider_availability_database_only(db_session: Session):
    """Verifies check_provider_availability checks DB slots and marks data_source truthfully."""
    registry = create_default_tool_registry()
    organizer, event, _, vendors = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    start_dt = now + timedelta(days=60)
    end_dt = now + timedelta(days=60, hours=8)

    args = {
        "vendor_id": vendors[0].id,
        "start_datetime": start_dt,
        "end_datetime": end_dt,
    }
    res = registry.execute("check_provider_availability", args, context)
    assert res.success
    assert res.data.data_source == "DATABASE_RECORDS"
    assert "calendar records" in res.data.note.lower()


# ==============================================================================
# 7. IMPACT & RISK TOOLS TESTS
# ==============================================================================

def test_analyze_impact_and_assess_risk(db_session: Session):
    """Verifies analyze_impact and assess_risk delegate to deterministic engines."""
    registry = create_default_tool_registry()
    organizer, event, tasks, vendors = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # Create an operational incident
    inc = Incident(
        event_id=event.id,
        incident_type=IncidentType.VENDOR_DELAY.value,
        severity=IncidentSeverity.HIGH.value,
        title="Mandap Setup Delayed by 2 Hours",
        related_task_id=tasks[0].id,
        related_vendor_id=vendors[0].id,
        status="OPEN",
    )
    db_session.add(inc)
    db_session.commit()

    # 1. Analyze impact
    impact_res = registry.execute("analyze_impact", {"event_id": event.id, "incident_id": inc.id}, context)
    assert impact_res.success
    assert impact_res.data.incident_id == inc.id
    assert impact_res.data.affected_tasks_count >= 1

    # 2. Assess risk
    risk_res = registry.execute("assess_risk", {"event_id": event.id, "incident_id": inc.id}, context)
    assert risk_res.success
    assert risk_res.data.composite_score >= 0.0
    assert risk_res.data.severity_level in ("LOW", "MEDIUM", "HIGH", "CRITICAL")


# ==============================================================================
# 8. OBSERVABILITY & TRACE TESTS
# ==============================================================================

def test_record_decision_tool_redacts_secrets(db_session: Session):
    """Verifies record_decision records factual metadata and redacts credentials."""
    registry = create_default_tool_registry()
    organizer, event, _, _ = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    args = {
        "event_id": event.id,
        "decision_type": "SELECT_VENDOR",
        "rationale": "Delhi Royal Caterers selected based on rating 4.8 and full vegetarian compliance.",
        "entity_type": "VENDOR",
        "entity_id": "v-123",
        "metadata": {
            "api_key": "secret_gemini_key_abc",
            "score": 0.95,
        },
    }
    res = registry.execute("record_decision", args, context)
    assert res.success
    assert res.data.success is True
    assert res.data.decision_type == "SELECT_VENDOR"

    # Verify execution trace in registry does not leak api_key
    traces = registry.get_traces(event_id=event.id)
    assert len(traces) > 0
    latest = traces[-1]
    assert latest.input_summary.get("metadata", {}).get("api_key") == "[REDACTED]"


# ==============================================================================
# 9. GOLDEN DEMO PATH TEST (STEP 34)
# ==============================================================================

def test_golden_demo_path(db_session: Session):
    """Simulates the full Golden Demo path:

    Event -> Canonical Spec -> discover_providers -> qualify_provider ->
    compare_candidates -> analyze_impact -> assess_risk.
    """
    registry = create_default_tool_registry()
    organizer, event, tasks, vendors = _setup_test_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # Step 1: get_event_spec
    spec_res = registry.execute("get_event_spec", {"event_id": event.id}, context)
    assert spec_res.success
    assert spec_res.data.guest_count == 600

    # Step 2: discover_providers
    disc_res = registry.execute(
        "discover_providers",
        {"event_id": event.id, "category": "catering", "location": "Delhi"},
        context,
    )
    assert disc_res.success
    assert disc_res.data.total_found >= 2

    # Step 3: qualify_provider
    cand_id = disc_res.data.providers[0].provider_id
    qual_res = registry.execute(
        "qualify_provider",
        {"event_id": event.id, "provider_id": cand_id, "required_category": "catering", "max_budget": 500000.0},
        context,
    )
    assert qual_res.success
    assert qual_res.data.status in ("QUALIFIED", "DISQUALIFIED")

    # Step 4: compare_candidates
    comp_res = registry.execute(
        "compare_candidates",
        {"event_id": event.id, "provider_ids": [v.id for v in vendors]},
        context,
    )
    assert comp_res.success
    assert comp_res.data.total_compared == 2

    # Step 5: Incident occurs -> analyze_impact -> assess_risk
    inc = Incident(
        event_id=event.id,
        incident_type=IncidentType.VENDOR_DELAY.value,
        severity=IncidentSeverity.HIGH.value,
        title="Vendor Logistics Delay",
        related_task_id=tasks[0].id,
        status="OPEN",
    )
    db_session.add(inc)
    db_session.commit()

    impact_res = registry.execute("analyze_impact", {"event_id": event.id, "incident_id": inc.id}, context)
    assert impact_res.success

    risk_res = registry.execute("assess_risk", {"event_id": event.id, "incident_id": inc.id}, context)
    assert risk_res.success
    assert risk_res.data.composite_score >= 0.0
