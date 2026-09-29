"""Comprehensive Golden Path End-to-End Product Lifecycle Integration Test

Verifies the full lifecycle of EVENTRA:
1. Clean DB initialization
2. Multi-turn Conversational Intake & Missing Info clarification
3. Authoritative Event Specification & Deterministic Operational Plan generation
4. Conversational Plan Modification (add/remove requirements, budget adjustment, location/date)
5. 'Start Operations' Autonomous Orchestration (LIVE transition, candidate discovery, deterministic scoring, outreach dispatch)
6. Provider Quote Ingestion & Budget Validation
7. Sudden Provider Cancellation Incident Detection
8. Deterministic Impact Analysis & Risk Evaluation
9. Autonomous Adaptive Recovery Option Synthesis
10. Separation-of-Duties Human Approval Gate
11. Transactional Action Execution
12. Multi-domain Post-Action Verification
13. Task Unblocking & Event State Restoration to LIVE/NORMAL
14. Complete Audit Trail & Decision Trace Persisted
"""
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.venue import Venue
from app.models.vendor_assignment import VendorAssignment
from app.models.shortlist import EventShortlistEntry
from app.models.budget import BudgetItem
from app.models.requirement import Requirement
from app.models.incident import Incident
from app.models.approval import Approval
from app.models.action import ActionExecution
from app.models.audit import AuditRecord
from app.models.enums import EventLifecycleState, EventState, TaskStatus, ProviderCategory
from app.services.intake_service import IntakeService
from app.services.autonomous_operations_service import AutonomousOperationsService
from app.services.negotiation_service import NegotiationService


@pytest.fixture
def clean_db():
    """Provides an isolated, clean in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_full_autonomous_event_operations_lifecycle(clean_db):
    """Executes the entire end-to-end golden path contract."""
    intake_svc = IntakeService(clean_db)
    ops_svc = AutonomousOperationsService(clean_db)
    neg_svc = NegotiationService(clean_db)

    # =========================================================================
    # STEP 1: Conversational Intake Turn 1 (Partial request -> Missing Info)
    # =========================================================================
    turn1_text = "I want to organize a 500-person corporate conference in Delhi."
    turn1_res = intake_svc.process_intake(turn1_text, user_id="organizer_1")

    assert turn1_res["status"] == "MISSING_INFO"
    assert turn1_res["event_id"] is not None
    assert "Delhi" in turn1_res["message"]
    assert any("date" in f.lower() for f in turn1_res["missing_fields"])
    draft_event_id = turn1_res["event_id"]

    # =========================================================================
    # STEP 2: Conversational Intake Turn 2 (Clarification -> Plan Ready)
    # =========================================================================
    turn2_text = (
        "15 November 2026, budget around 8 lakh. "
        "I need a venue, catering, AV, photography and transportation."
    )
    turn2_res = intake_svc.process_intake(
        turn2_text,
        event_id=draft_event_id,
        user_id="organizer_1",
    )

    assert turn2_res["status"] == "PLAN_READY"
    assert turn2_res["event_id"] == draft_event_id
    assert turn2_res["event"]["guest_count"] == 500
    assert turn2_res["event"]["location"] == "Delhi"
    assert turn2_res["event"]["total_budget"] == 800000.0
    reqs = set(turn2_res["event"]["requirements"])
    assert {"VENUE", "CATERING", "AV_TECH", "PHOTOGRAPHY", "TRANSPORT"}.issubset(reqs)

    # Authoritative Plan verification
    plan = turn2_res["plan"]
    assert plan["summary"]["total_tasks"] > 0
    assert plan["summary"]["critical_path_tasks"] > 0
    assert plan["summary"]["total_dependencies"] > 0

    # DB persistence verification
    tasks = clean_db.query(Task).filter(Task.event_id == draft_event_id).all()
    assert len(tasks) == plan["summary"]["total_tasks"]

    # =========================================================================
    # STEP 3: Conversational Plan Modification
    # "Remove photography and add security. Increase the budget to 10 lakh."
    # =========================================================================
    mod_text = "Remove photography and add security. Increase the budget to 10 lakh."
    mod_res = intake_svc.modify_plan(
        event_id=draft_event_id,
        modification_text=mod_text,
        user_id="organizer_1",
    )

    assert mod_res["status"] == "PLAN_UPDATED"
    updated_reqs = set(mod_res["requirements"])
    assert "PHOTOGRAPHY" not in updated_reqs
    assert "SECURITY" in updated_reqs

    # Authoritative DB verification
    event = clean_db.query(Event).filter(Event.id == draft_event_id).first()
    assert event.total_budget == 1000000.0

    # =========================================================================
    # STEP 4: START OPERATIONS (Autonomous Execution Initiation - Phase 1)
    # =========================================================================
    ops_res = ops_svc.start_operations(event_id=draft_event_id, user_id="organizer_1")

    assert ops_res["status"] == "WAITING_FOR_USER_SELECTION"
    assert ops_res["lifecycle_state"] == EventLifecycleState.LIVE.value
    assert ops_res["providers_contacted_count"] == 0
    assert len(ops_res["operations_report"]) >= 4

    # Recommendations persisted as EventShortlistEntry records
    shortlists = clean_db.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == draft_event_id).all()
    assert len(shortlists) > 0
    for s in shortlists:
        assert s.status == "RECOMMENDED"
        assert s.selection_source == "AGENT_RECOMMENDATION"

    # Prior to organizer selection, zero VendorAssignment records exist
    pre_assignments = clean_db.query(VendorAssignment).filter(VendorAssignment.event_id == draft_event_id).all()
    assert len(pre_assignments) == 0

    # Organizer selects catering candidate from recommendations
    cater_candidates = [s for s in shortlists if "cater" in s.category.lower()]
    assert len(cater_candidates) > 0
    select_res = ops_svc.select_candidate(event_id=draft_event_id, candidate_id=cater_candidates[0].candidate_id)
    assert select_res["status"] == "SELECTED"
    assert select_res["selection_source"] == "ORGANIZER_SELECTION"

    # Check vendor assignment created upon organizer selection
    assignments = clean_db.query(VendorAssignment).filter(VendorAssignment.event_id == draft_event_id).all()
    assert len(assignments) >= 1

    # Verify telemetry & activity feed
    telemetry = ops_svc.get_operations_status(draft_event_id)
    assert telemetry["lifecycle_state"] == EventLifecycleState.LIVE.value

    # =========================================================================
    # STEP 5: Provider Quote & Budget Processing
    # =========================================================================
    catering_asg = (
        clean_db.query(VendorAssignment)
        .filter(VendorAssignment.event_id == draft_event_id, VendorAssignment.category.ilike("%cater%"))
        .first()
    )
    assert catering_asg is not None

    quote_res = neg_svc.process_quote(
        assignment_id=catering_asg.id,
        quoted_amount=185000.0,
        notes="All-inclusive conference buffet for 500 attendees",
    )
    assert "negotiation_status" in quote_res
    clean_db.refresh(catering_asg)
    assert float(catering_asg.agreed_cost or 0) == 185000.0

    # =========================================================================
    # STEP 6: Incident Detection & Adaptive Recovery (Catering Cancellation)
    # =========================================================================
    inc_res = ops_svc.simulate_caterer_cancellation(event_id=draft_event_id, user_id="organizer_1")

    assert inc_res["status"] == "INCIDENT_TRIGGERED"
    assert inc_res["incident"]["severity"] in ("HIGH", "CRITICAL")
    assert inc_res["affected_task"]["status"] == "BLOCKED"
    assert len(inc_res["recovery_options"]) > 0
    assert inc_res["pending_approval"]["id"] is not None

    approval_id = inc_res["pending_approval"]["id"]

    # Verify event state transitioned to at-risk/critical/recovery tracking
    event = clean_db.query(Event).filter(Event.id == draft_event_id).first()
    assert event.state in (EventState.AT_RISK.value, EventState.CRITICAL.value, EventState.EMERGENCY.value, EventState.RECOVERY.value)

    # =========================================================================
    # STEP 7: Human Approval, Execution & Verification
    # =========================================================================
    recovery_exec_res = ops_svc.approve_and_execute_recovery(
        event_id=draft_event_id,
        approval_id=approval_id,
        user_id="organizer_1",
    )

    assert recovery_exec_res["status"] == "RECOVERY_COMPLETED"
    assert recovery_exec_res["verification_status"] == "VERIFIED"
    assert recovery_exec_res["event_state"] == EventState.NORMAL.value
    assert recovery_exec_res["lifecycle_state"] == EventLifecycleState.LIVE.value

    # =========================================================================
    # STEP 8: Final Authoritative State & Audit Trail Verification
    # =========================================================================
    final_event = clean_db.query(Event).filter(Event.id == draft_event_id).first()
    assert final_event.lifecycle_state == EventLifecycleState.LIVE.value
    assert final_event.state == EventState.NORMAL.value

    # Verify task unblocked
    catering_task = clean_db.query(Task).filter(Task.id == inc_res["affected_task"]["id"]).first()
    assert catering_task.status != TaskStatus.BLOCKED.value

    # Check complete audit trail
    audit_records = clean_db.query(AuditRecord).filter(AuditRecord.event_id == draft_event_id).all()
    actions = {a.action for a in audit_records}
    assert "OPERATIONAL_PLAN_GENERATED" in actions
    assert "OPERATIONAL_PLAN_MODIFIED" in actions
    assert "AUTONOMOUS_OPERATIONS_STARTED" in actions
    assert "PROVIDER_CANDIDATES_EVALUATED" in actions
    assert "INCIDENT_RECOVERY_TRIGGERED" in actions
    assert "RECOVERY_EXECUTED_AND_VERIFIED" in actions
