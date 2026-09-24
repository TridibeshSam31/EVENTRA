"""PLANNING Agent Tools.

Exposes deterministic plan retrieval, task inspection, dependency queries,
critical path CPM computation, and authorized task modification.
"""
from typing import Any, Dict, List
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.event import Event
from app.services.planning_service import PlanningService
from app.services.event_service import EventService
from app.engines.dependency.graph import DependencyGraph
from app.engines.dependency.traversal import CriticalPathCalculator
from app.schemas.task import TaskCreate, TaskUpdate
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolContext,
    ToolResult,
)
from app.agent.tools.schemas import (
    GetPlanInput,
    GetPlanOutput,
    GetTaskInput,
    GetTaskOutput,
    GetDependenciesInput,
    GetDependenciesOutput,
    DependencyItem,
    GetCriticalPathInput,
    GetCriticalPathOutput,
    CreateOrUpdateTaskInput,
    CreateOrUpdateTaskOutput,
)
from app.agent.tools.permissions import ToolPermissionGuard


class GetPlanTool(AgentTool):
    """Retrieves the current operational plan and task DAG for the event."""

    name = "get_plan"
    description = "Retrieves the current operational plan and task DAG for the event."
    category = ToolCategory.PLANNING
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetPlanInput
    output_schema = GetPlanOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetPlanInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        planning_service = PlanningService(context.db)
        try:
            plan = planning_service.get_plan(args.event_id)
        except Exception as e:
            return ToolResult.failure_result(self.name, f"Failed to retrieve plan: {str(e)}")

        tasks_list = [t.model_dump() for t in plan.tasks]
        deps_list = [d.model_dump() for d in plan.dependencies]

        data = GetPlanOutput(
            event_id=plan.event_id,
            event_name=plan.event_name,
            lifecycle_state=plan.lifecycle_state,
            total_tasks=plan.summary.total_tasks,
            total_dependencies=plan.summary.total_dependencies,
            total_resources=plan.summary.total_resources,
            total_budget_items=plan.summary.total_budget_items,
            total_estimated_budget=plan.summary.total_estimated_budget,
            critical_path_tasks=plan.summary.critical_path_tasks,
            tasks=tasks_list,
            dependencies=deps_list,
        )
        return ToolResult.success_result(self.name, data)


class GetTaskTool(AgentTool):
    """Retrieves complete details of a specific task within an event."""

    name = "get_task"
    description = "Retrieves complete details of a specific task within an event."
    category = ToolCategory.PLANNING
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetTaskInput
    output_schema = GetTaskOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetTaskInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        task = (
            context.db.query(Task)
            .filter(Task.id == args.task_id, Task.event_id == args.event_id)
            .first()
        )
        if not task:
            return ToolResult.failure_result(
                self.name,
                f"Task '{args.task_id}' not found for event '{args.event_id}'.",
                "NOT_FOUND",
            )

        data = GetTaskOutput(
            task_id=task.id,
            event_id=task.event_id,
            name=task.name,
            description=task.description,
            status=task.status,
            priority=task.priority,
            duration_minutes=task.duration_minutes or 0,
            is_critical_path=task.is_critical_path,
            planned_start=task.planned_start.isoformat() if task.planned_start else None,
            planned_end=task.planned_end.isoformat() if task.planned_end else None,
            actual_start=task.actual_start.isoformat() if task.actual_start else None,
            actual_end=task.actual_end.isoformat() if task.actual_end else None,
            required_provider_category=task.required_provider_category,
        )
        return ToolResult.success_result(self.name, data)


class GetDependenciesTool(AgentTool):
    """Retrieves dependency edges connecting tasks in the event plan."""

    name = "get_dependencies"
    description = "Retrieves dependency edges connecting tasks in the event plan."
    category = ToolCategory.PLANNING
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetDependenciesInput
    output_schema = GetDependenciesOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetDependenciesInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        query = context.db.query(TaskDependency).filter(TaskDependency.event_id == args.event_id)
        if args.task_id:
            query = query.filter(
                (TaskDependency.predecessor_task_id == args.task_id)
                | (TaskDependency.successor_task_id == args.task_id)
            )

        deps = query.all()
        items = [
            DependencyItem(
                id=d.id,
                predecessor_task_id=d.predecessor_task_id,
                successor_task_id=d.successor_task_id,
                dependency_type=d.dependency_type,
                lag_minutes=d.lag_minutes or 0,
            )
            for d in deps
        ]

        data = GetDependenciesOutput(
            event_id=args.event_id,
            total=len(items),
            dependencies=items,
        )
        return ToolResult.success_result(self.name, data)


class GetCriticalPathTool(AgentTool):
    """Calculates the deterministic CPM critical path for the event task DAG."""

    name = "get_critical_path"
    description = "Calculates the deterministic CPM critical path for the event task DAG."
    category = ToolCategory.PLANNING
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetCriticalPathInput
    output_schema = GetCriticalPathOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetCriticalPathInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        tasks = context.db.query(Task).filter(Task.event_id == args.event_id).all()
        deps = context.db.query(TaskDependency).filter(TaskDependency.event_id == args.event_id).all()

        if not tasks:
            return ToolResult.success_result(
                self.name,
                GetCriticalPathOutput(
                    event_id=args.event_id,
                    critical_path_task_ids=[],
                    critical_path_tasks=[],
                    total_duration_minutes=0,
                    is_acyclic=True,
                ),
            )

        try:
            graph = DependencyGraph.from_tasks_and_dependencies(tasks, deps)
            is_acyclic = graph.is_acyclic()
            if not is_acyclic:
                return ToolResult.failure_result(
                    self.name,
                    "Cannot compute critical path: dependency graph contains cycles.",
                    "DAG_CYCLE_DETECTED",
                )

            calculator = CriticalPathCalculator()
            cpm_result = calculator.calculate(graph)

            task_map = {t.id: t for t in tasks}
            cp_task_objects = []
            for tid in cpm_result.critical_path:
                t = task_map.get(tid)
                if t:
                    cp_task_objects.append({
                        "id": t.id,
                        "name": t.name,
                        "duration_minutes": t.duration_minutes,
                        "priority": t.priority,
                        "status": t.status,
                    })

            data = GetCriticalPathOutput(
                event_id=args.event_id,
                critical_path_task_ids=cpm_result.critical_path,
                critical_path_tasks=cp_task_objects,
                total_duration_minutes=cpm_result.total_duration,
                is_acyclic=True,
            )
            return ToolResult.success_result(self.name, data)

        except Exception as e:
            return ToolResult.failure_result(self.name, f"Critical path calculation failed: {str(e)}")


class CreateOrUpdateTaskTool(AgentTool):
    """Creates a new operational task or updates an existing task in the event plan (WRITE operation)."""

    name = "create_or_update_task"
    description = "Creates a new operational task or updates an existing task in the event plan."
    category = ToolCategory.PLANNING
    access_mode = ToolAccessMode.WRITE
    input_schema = CreateOrUpdateTaskInput
    output_schema = CreateOrUpdateTaskOutput
    approval_required = False  # Routine tasks can be created/updated unless high impact
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: CreateOrUpdateTaskInput) -> ToolResult:
        action_type = "UPDATE_TASK" if args.task_id else "CREATE_TASK"
        target_id = args.task_id

        # 1. Server-side permission & approval gate evaluation
        can_execute, approval_id = ToolPermissionGuard.enforce_approval_gate(
            db=context.db,
            event_id=args.event_id,
            user_id=context.user_id,
            action_type=action_type,
            target_type="TASK",
            target_id=target_id,
            payload=args.model_dump(exclude_unset=True),
            approval_id=context.approval_id,
            tool_name=self.name,
        )

        if not can_execute:
            return ToolResult.approval_required_result(
                tool_name=self.name,
                approval_id=approval_id or "new_request",
                reason=f"Action '{action_type}' exceeds direct authority and requires human approval.",
            )

        # 2. Deterministic execution via EventService
        event_service = EventService(context.db)

        if args.task_id:
            # Update existing task
            existing = (
                context.db.query(Task)
                .filter(Task.id == args.task_id, Task.event_id == args.event_id)
                .first()
            )
            if not existing:
                return ToolResult.failure_result(
                    self.name,
                    f"Task '{args.task_id}' not found for event '{args.event_id}'.",
                    "NOT_FOUND",
                )

            if args.name is not None:
                existing.name = args.name
            if args.description is not None:
                existing.description = args.description
            if args.status is not None:
                existing.status = args.status
            if args.priority is not None:
                existing.priority = args.priority
            if args.duration_minutes is not None:
                existing.duration_minutes = args.duration_minutes
            if args.planned_start is not None:
                existing.planned_start = args.planned_start
            if args.planned_end is not None:
                existing.planned_end = args.planned_end
            if args.required_provider_category is not None:
                existing.required_provider_category = args.required_provider_category

            context.db.commit()
            context.db.refresh(existing)

            data = CreateOrUpdateTaskOutput(
                task_id=existing.id,
                event_id=existing.event_id,
                name=existing.name,
                status=existing.status,
                priority=existing.priority,
                is_created=False,
                message=f"Task '{existing.name}' ({existing.id}) successfully updated.",
            )
            return ToolResult.success_result(self.name, data)

        else:
            # Create new task
            if not args.name:
                return ToolResult.failure_result(self.name, "Task name is required when creating a new task.", "VALIDATION_ERROR")

            new_task_in = TaskCreate(
                name=args.name,
                description=args.description,
                status=args.status or "READY",
                priority=args.priority or "MEDIUM",
                planned_start=args.planned_start,
                planned_end=args.planned_end,
            )
            task = event_service.create_task(args.event_id, new_task_in)
            if args.duration_minutes is not None:
                task.duration_minutes = args.duration_minutes
            if args.required_provider_category:
                task.required_provider_category = args.required_provider_category
            context.db.commit()
            context.db.refresh(task)

            data = CreateOrUpdateTaskOutput(
                task_id=task.id,
                event_id=task.event_id,
                name=task.name,
                status=task.status,
                priority=task.priority,
                is_created=True,
                message=f"Task '{task.name}' ({task.id}) successfully created.",
            )
            return ToolResult.success_result(self.name, data)


def planning_tools_run(**kwargs) -> Dict[str, Any]:
    """Legacy helper for backward compatibility."""
    return {"status": "success"}
