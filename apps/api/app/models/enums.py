"""Canonical Controlled Domain Enums for EVENTRA"""
from enum import Enum


class EventType(str, Enum):
    WEDDING = "WEDDING"
    CONFERENCE = "CONFERENCE"
    COLLEGE_FEST = "COLLEGE_FEST"
    CORPORATE = "CORPORATE"
    CONCERT = "CONCERT"
    EXHIBITION = "EXHIBITION"
    OTHER = "OTHER"


class EventState(str, Enum):
    NORMAL = "NORMAL"
    AT_RISK = "AT_RISK"
    CRITICAL = "CRITICAL"
    EMERGENCY = "EMERGENCY"
    RECOVERY = "RECOVERY"


class TaskStatus(str, Enum):
    PENDING = "PENDING"
    ASSIGNED = "ASSIGNED"
    READY = "READY"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class TaskPriority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class VendorStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    UNAVAILABLE = "UNAVAILABLE"


class ProviderCategory(str, Enum):
    """Controlled taxonomy for EVENTRA providers/vendors."""
    VENUE = "VENUE"
    CATERING = "CATERING"
    DECOR = "DECOR"
    PHOTOGRAPHY = "PHOTOGRAPHY"
    VIDEOGRAPHY = "VIDEOGRAPHY"
    DJ_MUSIC = "DJ_MUSIC"
    LIGHTING = "LIGHTING"
    AV_TECH = "AV_TECH"
    ENTERTAINMENT = "ENTERTAINMENT"
    TRANSPORT = "TRANSPORT"
    SECURITY = "SECURITY"
    STAFFING = "STAFFING"
    MAKEUP_STYLING = "MAKEUP_STYLING"
    PRINTING = "PRINTING"
    RENTALS = "RENTALS"
    FLORIST = "FLORIST"
    PRODUCTION = "PRODUCTION"
    CLEANING = "CLEANING"
    OTHER = "OTHER"


class RequirementType(str, Enum):
    VENUE = "VENUE"
    CATERING = "CATERING"
    EQUIPMENT = "EQUIPMENT"
    ACCESSIBILITY = "ACCESSIBILITY"
    STAFFING = "STAFFING"
    PERMIT = "PERMIT"
    GENERAL = "GENERAL"


class ConstraintType(str, Enum):
    TIME_WINDOW = "TIME_WINDOW"
    BUDGET_CAP = "BUDGET_CAP"
    NOISE_CURFEW = "NOISE_CURFEW"
    VENUE_CAPACITY = "VENUE_CAPACITY"
    RESOURCE = "RESOURCE"
    REGULATORY = "REGULATORY"
    GENERAL = "GENERAL"


class DependencyType(str, Enum):
    FINISH_TO_START = "FINISH_TO_START"
    START_TO_START = "START_TO_START"
    FINISH_TO_FINISH = "FINISH_TO_FINISH"
    START_TO_FINISH = "START_TO_FINISH"


class IncidentSeverity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"
    EMERGENCY = "EMERGENCY"


class IncidentType(str, Enum):
    VENDOR_DELAY = "VENDOR_DELAY"
    VENDOR_NO_SHOW = "VENDOR_NO_SHOW"
    VENDOR_CANCELLATION = "VENDOR_CANCELLATION"
    VENUE_ISSUE = "VENUE_ISSUE"
    RESOURCE_SHORTAGE = "RESOURCE_SHORTAGE"
    CAPACITY_PROBLEM = "CAPACITY_PROBLEM"
    SCHEDULE_DEVIATION = "SCHEDULE_DEVIATION"
    DEPENDENCY_FAILURE = "DEPENDENCY_FAILURE"


class IncidentStatus(str, Enum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    INVESTIGATING = "INVESTIGATING"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class RoleType(str, Enum):
    MAIN_ORGANIZER = "MAIN_ORGANIZER"
    EVENT_MANAGER = "EVENT_MANAGER"
    COLLABORATOR = "COLLABORATOR"
    VENDOR = "VENDOR"
    VIEWER = "VIEWER"


class PermissionCategory(str, Enum):
    VIEW = "VIEW"
    MINOR_CHANGE = "MINOR_CHANGE"
    CRITICAL_CHANGE = "CRITICAL_CHANGE"
    APPROVE = "APPROVE"


class EventLifecycleState(str, Enum):
    """Event lifecycle stages (separate from operational risk states)."""
    DRAFT = "DRAFT"
    SPECIFIED = "SPECIFIED"
    PLANNED = "PLANNED"
    LIVE = "LIVE"
    INCIDENT = "INCIDENT"
    EMERGENCY = "EMERGENCY"
    CONCLUDED = "CONCLUDED"
    CANCELLED = "CANCELLED"


class BudgetItemStatus(str, Enum):
    """Budget line item tracking status."""
    PLANNED = "PLANNED"
    COMMITTED = "COMMITTED"
    PAID = "PAID"
    CANCELLED = "CANCELLED"


class ResourceStatus(str, Enum):
    """Resource allocation status."""
    AVAILABLE = "AVAILABLE"
    ALLOCATED = "ALLOCATED"
    IN_USE = "IN_USE"
    DEPLETED = "DEPLETED"


class NegotiationStatus(str, Enum):
    """Provider engagement and negotiation lifecycle states."""
    NOT_CONTACTED = "NOT_CONTACTED"
    DISCOVERED = "DISCOVERED"
    CONTACT_PENDING = "CONTACT_PENDING"
    CONTACTED = "CONTACTED"
    WAITING_FOR_RESPONSE = "WAITING_FOR_RESPONSE"
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    QUOTATION_RECEIVED = "QUOTATION_RECEIVED"
    NEGOTIATING = "NEGOTIATING"
    COUNTER_OFFER_SENT = "COUNTER_OFFER_SENT"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    CONFIRMED = "CONFIRMED"
    DECLINED = "DECLINED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class CommunicationChannel(str, Enum):
    """External channel used by the organizer to communicate with the vendor outside EVENTRA."""
    PHONE = "PHONE"
    EMAIL = "EMAIL"
    WHATSAPP_EXTERNAL = "WHATSAPP_EXTERNAL"
    IN_PERSON = "IN_PERSON"
    OTHER = "OTHER"


class VendorOutcomeStatus(str, Enum):
    """Status of an organizer-reported external vendor interaction."""
    PENDING = "PENDING"
    CONTACTED = "CONTACTED"
    INTERESTED = "INTERESTED"
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    QUOTE_RECEIVED = "QUOTE_RECEIVED"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    NO_RESPONSE = "NO_RESPONSE"
    UNKNOWN = "UNKNOWN"


class ReportedAvailability(str, Enum):
    """Availability state reported by the vendor during external communication."""
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    CONDITIONAL = "CONDITIONAL"
    UNKNOWN = "UNKNOWN"


class ClaimValidationStatus(str, Enum):
    """Deterministic validation evaluation of an organizer-reported claim."""
    PASS = "PASS"
    FAIL = "FAIL"
    UNKNOWN = "UNKNOWN"
    CONFLICT = "CONFLICT"


class OverallValidationStatus(str, Enum):
    """Overall validation status for a parsed and validated vendor outcome."""
    VALIDATED = "VALIDATED"
    PARTIALLY_VALIDATED = "PARTIALLY_VALIDATED"
    FAILED = "FAILED"
    CONFLICT = "CONFLICT"
    INSUFFICIENT_INFORMATION = "INSUFFICIENT_INFORMATION"


class ClaimType(str, Enum):
    """Categorization of facts extracted from organizer-reported vendor outcomes."""
    CAPACITY = "CAPACITY"
    PRICE = "PRICE"
    CURRENCY = "CURRENCY"
    AVAILABILITY = "AVAILABILITY"
    DATE = "DATE"
    VEGETARIAN = "VEGETARIAN"
    LOCATION = "LOCATION"
    CATEGORY = "CATEGORY"
    REQUIREMENT = "REQUIREMENT"
    PREFERENCE = "PREFERENCE"
    TERMS = "TERMS"


class BindingStatus(str, Enum):
    """Authoritative outcome of a vendor-to-task binding evaluation or execution."""
    BOUND = "BOUND"
    BLOCKED = "BLOCKED"
    ALREADY_BOUND = "ALREADY_BOUND"


class BlockingReason(str, Enum):
    """Controlled deterministic reason codes when a vendor cannot be bound to a task."""
    CAPACITY_REQUIREMENT_FAILED = "CAPACITY_REQUIREMENT_FAILED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    AVAILABILITY_NOT_VALIDATED = "AVAILABILITY_NOT_VALIDATED"
    AVAILABILITY_UNAVAILABLE = "AVAILABILITY_UNAVAILABLE"
    HARD_REQUIREMENT_FAILED = "HARD_REQUIREMENT_FAILED"
    VALIDATION_CONFLICT = "VALIDATION_CONFLICT"
    VALIDATION_STALE = "VALIDATION_STALE"
    VALIDATION_NOT_FOUND = "VALIDATION_NOT_FOUND"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    TASK_NOT_FOUND = "TASK_NOT_FOUND"
    PROVIDER_NOT_FOUND = "PROVIDER_NOT_FOUND"
    EVENT_MISMATCH = "EVENT_MISMATCH"
    CATEGORY_MISMATCH = "CATEGORY_MISMATCH"
    REASSIGNMENT_BLOCKED = "REASSIGNMENT_BLOCKED"
    UNAUTHORIZED = "UNAUTHORIZED"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    INCONSISTENT_PLAN = "INCONSISTENT_PLAN"



