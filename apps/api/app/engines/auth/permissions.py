"""Canonical Permissions & Role-Permission Matrix for EVENTRA"""
from typing import Dict, Set
from app.models.enums import RoleType


class Permissions:
    EVENT_VIEW = "EVENT_VIEW"
    EVENT_EDIT = "EVENT_EDIT"
    PLAN_VIEW = "PLAN_VIEW"
    PLAN_EDIT = "PLAN_EDIT"
    TASK_VIEW = "TASK_VIEW"
    TASK_EDIT = "TASK_EDIT"
    TASK_STATUS_UPDATE = "TASK_STATUS_UPDATE"
    VENDOR_VIEW = "VENDOR_VIEW"
    VENDOR_ASSIGN = "VENDOR_ASSIGN"
    RESOURCE_VIEW = "RESOURCE_VIEW"
    RESOURCE_ALLOCATE = "RESOURCE_ALLOCATE"
    SCHEDULE_VIEW = "SCHEDULE_VIEW"
    SCHEDULE_EDIT = "SCHEDULE_EDIT"
    BUDGET_VIEW = "BUDGET_VIEW"
    BUDGET_EDIT = "BUDGET_EDIT"
    MEMBER_VIEW = "MEMBER_VIEW"
    MEMBER_MANAGE = "MEMBER_MANAGE"
    RECOVERY_VIEW = "RECOVERY_VIEW"
    RECOVERY_REQUEST = "RECOVERY_REQUEST"
    ACTION_EXECUTE = "ACTION_EXECUTE"
    APPROVAL_VIEW = "APPROVAL_VIEW"
    APPROVAL_CREATE = "APPROVAL_CREATE"
    APPROVAL_APPROVE = "APPROVAL_APPROVE"
    EVENT_PAUSE = "EVENT_PAUSE"
    EVENT_RESUME = "EVENT_RESUME"


ALL_PERMISSIONS: Set[str] = {
    Permissions.EVENT_VIEW,
    Permissions.EVENT_EDIT,
    Permissions.PLAN_VIEW,
    Permissions.PLAN_EDIT,
    Permissions.TASK_VIEW,
    Permissions.TASK_EDIT,
    Permissions.TASK_STATUS_UPDATE,
    Permissions.VENDOR_VIEW,
    Permissions.VENDOR_ASSIGN,
    Permissions.RESOURCE_VIEW,
    Permissions.RESOURCE_ALLOCATE,
    Permissions.SCHEDULE_VIEW,
    Permissions.SCHEDULE_EDIT,
    Permissions.BUDGET_VIEW,
    Permissions.BUDGET_EDIT,
    Permissions.MEMBER_VIEW,
    Permissions.MEMBER_MANAGE,
    Permissions.RECOVERY_VIEW,
    Permissions.RECOVERY_REQUEST,
    Permissions.ACTION_EXECUTE,
    Permissions.APPROVAL_VIEW,
    Permissions.APPROVAL_CREATE,
    Permissions.APPROVAL_APPROVE,
    Permissions.EVENT_PAUSE,
    Permissions.EVENT_RESUME,
}

# Role Defaults
ROLE_PERMISSIONS_MAP: Dict[str, Set[str]] = {
    RoleType.MAIN_ORGANIZER.value: set(ALL_PERMISSIONS),
    RoleType.EVENT_MANAGER.value: {
        Permissions.EVENT_VIEW,
        Permissions.EVENT_EDIT,
        Permissions.PLAN_VIEW,
        Permissions.PLAN_EDIT,
        Permissions.TASK_VIEW,
        Permissions.TASK_EDIT,
        Permissions.TASK_STATUS_UPDATE,
        Permissions.VENDOR_VIEW,
        Permissions.VENDOR_ASSIGN,
        Permissions.RESOURCE_VIEW,
        Permissions.RESOURCE_ALLOCATE,
        Permissions.SCHEDULE_VIEW,
        Permissions.SCHEDULE_EDIT,
        Permissions.BUDGET_VIEW,
        Permissions.MEMBER_VIEW,
        Permissions.RECOVERY_VIEW,
        Permissions.RECOVERY_REQUEST,
        Permissions.ACTION_EXECUTE,
        Permissions.APPROVAL_VIEW,
        Permissions.APPROVAL_CREATE,
        Permissions.APPROVAL_APPROVE,
        Permissions.EVENT_PAUSE,
        Permissions.EVENT_RESUME,
    },
    RoleType.COLLABORATOR.value: {
        Permissions.EVENT_VIEW,
        Permissions.PLAN_VIEW,
        Permissions.TASK_VIEW,
        Permissions.TASK_EDIT,
        Permissions.TASK_STATUS_UPDATE,
        Permissions.RESOURCE_VIEW,
        Permissions.SCHEDULE_VIEW,
        Permissions.RECOVERY_VIEW,
        Permissions.RECOVERY_REQUEST,
        Permissions.APPROVAL_VIEW,
        Permissions.APPROVAL_CREATE,
        Permissions.ACTION_EXECUTE,
    },
    RoleType.VENDOR.value: {
        Permissions.TASK_VIEW,
        Permissions.TASK_STATUS_UPDATE,
        Permissions.SCHEDULE_VIEW,
    },
    RoleType.VIEWER.value: {
        Permissions.EVENT_VIEW,
        Permissions.PLAN_VIEW,
        Permissions.TASK_VIEW,
        Permissions.SCHEDULE_VIEW,
        Permissions.BUDGET_VIEW,
        Permissions.APPROVAL_VIEW,
    },
}

ACTION_PERMISSION_MAP: Dict[str, str] = {
    "REASSIGN_VENDOR": Permissions.VENDOR_ASSIGN,
    "REASSIGN_TASK": Permissions.TASK_EDIT,
    "ADJUST_SCHEDULE": Permissions.SCHEDULE_EDIT,
    "ALLOCATE_RESOURCE": Permissions.RESOURCE_ALLOCATE,
    "ADJUST_BUDGET": Permissions.BUDGET_EDIT,
}
