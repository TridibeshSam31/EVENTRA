"""Domain Service: EventService (Phase 1 Foundational Persistence)"""
from typing import List, Optional
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.requirement import Requirement
from app.models.constraint import Constraint
from app.models.objective import Objective
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.resource import Resource
from app.models.budget import BudgetItem
from app.models.enums import RoleType
from app.schemas.user import UserCreate
from app.schemas.event import EventCreate, EventUpdate
from app.schemas.event_member import EventMemberCreate
from app.schemas.specification import RequirementCreate, ConstraintCreate, ObjectiveCreate
from app.schemas.task import TaskCreate, TaskDependencyCreate
from app.schemas.resource import ResourceCreate
from app.schemas.budget import BudgetItemCreate
from app.core.exceptions import NotFoundException, ConflictException, BadRequestException


class EventService:
    """Provides foundational persistence operations for core event entities."""

    def __init__(self, db: Session):
        self.db = db

    # --- User Operations ---
    def create_user(self, data: UserCreate) -> User:
        existing = self.db.query(User).filter(User.email == data.email).first()
        if existing:
            raise ConflictException(f"User with email '{data.email}' already exists.")
        user = User(name=data.name, email=data.email)
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get_user(self, user_id: str) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_user_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()

    # --- Event Operations ---
    def create_event(self, data: EventCreate) -> Event:
        owner = self.get_user(data.owner_id)
        if not owner:
            # Auto-create the user if they don't exist for demo/development purposes
            owner = User(id=data.owner_id, name="Default Operator", email=f"{data.owner_id}@eventra.local")
            self.db.add(owner)
            self.db.commit()
            self.db.refresh(owner)

        event = Event(
            owner_id=data.owner_id,
            name=data.name,
            description=data.description,
            event_type=data.event_type,
            location=data.location,
            start_datetime=data.start_datetime,
            end_datetime=data.end_datetime,
            guest_count=data.guest_count,
            state=data.state,
            total_budget=data.total_budget,
            currency=data.currency,
        )
        self.db.add(event)
        self.db.flush()

        # Add the owner as MAIN_ORGANIZER member in event_members
        owner_member = EventMember(
            event_id=event.id,
            user_id=owner.id,
            role=RoleType.MAIN_ORGANIZER.value,
        )
        self.db.add(owner_member)
        self.db.commit()
        self.db.refresh(event)
        return event

    def get_event(self, event_id: str) -> Optional[Event]:
        return self.db.query(Event).filter(Event.id == event_id).first()

    def list_events_by_owner(self, owner_id: str) -> List[Event]:
        return self.db.query(Event).filter(Event.owner_id == owner_id).all()

    def update_event(self, event_id: str, data: EventUpdate) -> Event:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        update_data = data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(event, key, value)
        self.db.commit()
        self.db.refresh(event)
        return event

    # --- Event Member Operations ---
    def add_event_member(self, event_id: str, data: EventMemberCreate) -> EventMember:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        user = self.get_user(data.user_id)
        if not user:
            raise NotFoundException(f"User with id '{data.user_id}' not found.")

        existing = self.db.query(EventMember).filter(
            EventMember.event_id == event_id,
            EventMember.user_id == data.user_id,
        ).first()
        if existing:
            raise ConflictException("User is already a member of this event.")

        member = EventMember(
            event_id=event_id,
            user_id=data.user_id,
            role=data.role,
            role_id=data.role_id,
        )
        self.db.add(member)
        self.db.commit()
        self.db.refresh(member)
        return member

    def get_event_members(self, event_id: str) -> List[EventMember]:
        return self.db.query(EventMember).filter(EventMember.event_id == event_id).all()

    # --- Requirement Operations ---
    def create_requirement(self, event_id: str, data: RequirementCreate) -> Requirement:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        req = Requirement(
            event_id=event_id,
            type=data.type,
            name=data.name,
            description=data.description,
            value=data.value,
            required=data.required,
        )
        self.db.add(req)
        self.db.commit()
        self.db.refresh(req)
        return req

    def list_requirements(self, event_id: str) -> List[Requirement]:
        return self.db.query(Requirement).filter(Requirement.event_id == event_id).all()

    # --- Constraint Operations ---
    def create_constraint(self, event_id: str, data: ConstraintCreate) -> Constraint:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        constraint = Constraint(
            event_id=event_id,
            type=data.type,
            name=data.name,
            description=data.description,
            value=data.value,
            severity=data.severity,
        )
        self.db.add(constraint)
        self.db.commit()
        self.db.refresh(constraint)
        return constraint

    def list_constraints(self, event_id: str) -> List[Constraint]:
        return self.db.query(Constraint).filter(Constraint.event_id == event_id).all()

    # --- Objective Operations ---
    def create_objective(self, event_id: str, data: ObjectiveCreate) -> Objective:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        obj = Objective(
            event_id=event_id,
            type=data.type,
            name=data.name,
            description=data.description,
            priority=data.priority,
            target_value=data.target_value,
        )
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def list_objectives(self, event_id: str) -> List[Objective]:
        return self.db.query(Objective).filter(Objective.event_id == event_id).all()

    # --- Task Operations ---
    def create_task(self, event_id: str, data: TaskCreate) -> Task:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        task = Task(
            event_id=event_id,
            name=data.name,
            description=data.description,
            status=data.status,
            priority=data.priority,
            planned_start=data.planned_start,
            planned_end=data.planned_end,
            actual_start=data.actual_start,
            actual_end=data.actual_end,
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)
        return task

    def get_task(self, task_id: str) -> Optional[Task]:
        return self.db.query(Task).filter(Task.id == task_id).first()

    def list_tasks(self, event_id: str) -> List[Task]:
        return self.db.query(Task).filter(Task.event_id == event_id).all()

    # --- Task Dependency Operations ---
    def create_dependency(self, event_id: str, data: TaskDependencyCreate) -> TaskDependency:
        if data.predecessor_task_id == data.successor_task_id:
            raise BadRequestException("Self-dependency is not allowed: predecessor and successor cannot be the same.")

        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        pred = self.get_task(data.predecessor_task_id)
        succ = self.get_task(data.successor_task_id)
        if not pred or pred.event_id != event_id:
            raise NotFoundException("Predecessor task not found in this event.")
        if not succ or succ.event_id != event_id:
            raise NotFoundException("Successor task not found in this event.")

        existing = self.db.query(TaskDependency).filter(
            TaskDependency.predecessor_task_id == data.predecessor_task_id,
            TaskDependency.successor_task_id == data.successor_task_id,
        ).first()
        if existing:
            raise ConflictException("Dependency edge between these tasks already exists.")

        dep = TaskDependency(
            event_id=event_id,
            predecessor_task_id=data.predecessor_task_id,
            successor_task_id=data.successor_task_id,
            dependency_type=data.dependency_type,
        )
        self.db.add(dep)
        self.db.commit()
        self.db.refresh(dep)
        return dep

    def list_dependencies(self, event_id: str) -> List[TaskDependency]:
        return self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()

    # --- Resource Operations ---
    def create_resource(self, event_id: str, data: ResourceCreate) -> Resource:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        res = Resource(
            event_id=event_id,
            name=data.name,
            type=data.type,
            quantity=data.quantity,
            unit=data.unit,
            status=data.status,
        )
        self.db.add(res)
        self.db.commit()
        self.db.refresh(res)
        return res

    def list_resources(self, event_id: str) -> List[Resource]:
        return self.db.query(Resource).filter(Resource.event_id == event_id).all()

    # --- Budget Operations ---
    def create_budget_item(self, event_id: str, data: BudgetItemCreate) -> BudgetItem:
        event = self.get_event(event_id)
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        item = BudgetItem(
            event_id=event_id,
            name=data.name,
            category=data.category,
            estimated_amount=data.estimated_amount,
            actual_amount=data.actual_amount,
            currency=data.currency,
            status=data.status,
        )
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        return item

    def list_budget_items(self, event_id: str) -> List[BudgetItem]:
        return self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()
