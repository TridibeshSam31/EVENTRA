"""API Route: Schedule Engine Endpoints"""
from decimal import Decimal
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.models.event import Event
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.engines.dependency.graph import DependencyGraph
from app.engines.dependency.traversal import CriticalPathCalculator
from app.engines.schedule.scheduler import ScheduleEngine
from app.engines.schedule.feasibility import ScheduleFeasibilityChecker
from app.schemas.schedule import (
    ScheduleResponse,
    TaskScheduleResponse,
    CriticalPathResponse,
    FeasibilityResponse,
    FeasibilityViolationResponse,
)
from app.core.exceptions import NotFoundException, BadRequestException

router = APIRouter(prefix="/events", tags=["schedule"])


@router.post("/{event_id}/schedule/compute", response_model=ScheduleResponse)
def compute_schedule(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> ScheduleResponse:
    """Compute schedule for all planned tasks and persist results.

    Assigns concrete planned_start/planned_end datetimes using
    forward-pass scheduling, then updates tasks in the database.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event with id '{event_id}' not found.")

    if not event.start_datetime or not event.end_datetime:
        raise BadRequestException("Event must have start_datetime and end_datetime set.")

    tasks = db.query(Task).filter(Task.event_id == event_id).all()
    if not tasks:
        raise BadRequestException(
            "PLAN_NOT_MATERIALIZED: No tasks have been materialized for this event. Execute POST /events/{event_id}/plan to generate the operational plan first."
        )

    deps = db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()

    # Compute schedule
    engine = ScheduleEngine()
    schedule_result = engine.schedule_tasks(
        event_start=event.start_datetime,
        tasks=tasks,
        dependencies=deps,
    )

    # Compute critical path
    graph = DependencyGraph.from_tasks_and_dependencies(tasks, deps)
    cpc = CriticalPathCalculator()
    cp_result = cpc.calculate(graph)

    # Persist schedule and critical path to tasks
    for task in tasks:
        entry = schedule_result.entries.get(task.id)
        if entry:
            task.planned_start = entry.planned_start
            task.planned_end = entry.planned_end

        timing = cp_result.task_timings.get(task.id)
        if timing:
            task.slack_minutes = timing.slack
            task.is_critical_path = timing.is_critical

    db.commit()

    # Check feasibility
    checker = ScheduleFeasibilityChecker()
    feasibility = checker.check_feasibility(
        schedule_result, event.start_datetime, event.end_datetime
    )

    # Build response
    entries = []
    for task in tasks:
        entry = schedule_result.entries.get(task.id)
        timing = cp_result.task_timings.get(task.id)
        if entry:
            entries.append(TaskScheduleResponse(
                task_id=task.id,
                task_name=task.name,
                planned_start=entry.planned_start,
                planned_end=entry.planned_end,
                duration_minutes=entry.duration_minutes,
                slack_minutes=timing.slack if timing else None,
                is_critical_path=timing.is_critical if timing else False,
            ))

    return ScheduleResponse(
        event_id=event_id,
        event_start=event.start_datetime,
        event_end=event.end_datetime,
        project_end=schedule_result.project_end,
        total_duration_minutes=schedule_result.total_duration_minutes,
        is_feasible=feasibility.is_feasible,
        buffer_minutes=feasibility.buffer_minutes,
        entries=entries,
        critical_path=CriticalPathResponse(
            critical_path_tasks=cp_result.critical_path,
            total_duration_minutes=cp_result.total_duration,
        ),
    )


@router.get("/{event_id}/schedule", response_model=ScheduleResponse)
def get_schedule(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> ScheduleResponse:
    """Retrieve the current computed schedule for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event with id '{event_id}' not found.")

    tasks = db.query(Task).filter(Task.event_id == event_id).all()
    deps = db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()

    entries = []
    for task in tasks:
        if task.planned_start and task.planned_end:
            entries.append(TaskScheduleResponse(
                task_id=task.id,
                task_name=task.name,
                planned_start=task.planned_start,
                planned_end=task.planned_end,
                duration_minutes=task.duration_minutes or 0,
                slack_minutes=task.slack_minutes,
                is_critical_path=task.is_critical_path,
            ))

    # Recompute critical path for response
    cp_response = CriticalPathResponse()
    if tasks and deps:
        graph = DependencyGraph.from_tasks_and_dependencies(tasks, deps)
        cpc = CriticalPathCalculator()
        cp_result = cpc.calculate(graph)
        cp_response = CriticalPathResponse(
            critical_path_tasks=cp_result.critical_path,
            total_duration_minutes=cp_result.total_duration,
        )

    total_duration = 0
    project_end = None
    if entries:
        project_end = max(e.planned_end for e in entries)
        if event.start_datetime:
            total_duration = int((project_end - event.start_datetime).total_seconds() / 60)

    feasible = True
    buffer = 0
    if event.start_datetime and event.end_datetime and project_end:
        available = int((event.end_datetime - event.start_datetime).total_seconds() / 60)
        buffer = max(available - total_duration, 0)
        feasible = project_end <= event.end_datetime

    return ScheduleResponse(
        event_id=event_id,
        event_start=event.start_datetime or event.created_at,
        event_end=event.end_datetime or event.created_at,
        project_end=project_end,
        total_duration_minutes=total_duration,
        is_feasible=feasible,
        buffer_minutes=buffer,
        entries=entries,
        critical_path=cp_response,
    )
