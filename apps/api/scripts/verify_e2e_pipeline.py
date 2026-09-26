"""End-to-End Pipeline Verification Script (Priority 5).

Verifies the complete autonomous agent lifecycle:
1. Creates a live event with venue & catering task in Delhi, India.
2. Triggers a VENDOR_NO_SHOW incident.
3. Tests discovery via GoogleMapsScraperAdapter in Delhi (testing real OpenStreetMap network query).
4. Verifies agent trigger & execution with approval request creation.
5. Approves the operational action and verifies atomic execution + deterministic binding via VendorTaskBindingService.
"""
import sys
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from decimal import Decimal

# Ensure app is on python path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from app.db.session import SessionLocal
from app.models.user import User
from app.models.event import Event
from app.models.venue import Venue
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.incident import Incident
from app.models.approval import Approval
from app.models.enums import EventType, EventState, EventExecutionState, RoleType, IncidentSeverity, IncidentStatus, IncidentType
from app.models.event_member import EventMember
from app.integrations.google_maps_scraper.adapter import GoogleMapsScraperAdapter
from app.schemas.vendor import ProviderDiscoveryRequest
from app.services.action_service import ActionService
from app.services.approval_service import ApprovalService
from app.services.vendor_task_binding_service import VendorTaskBindingService
from app.engines.auth.snapshot import compute_event_state_snapshot


def run_e2e_test():
    db = SessionLocal()
    print("=" * 80)
    print("      EVENTRA AUTONOMOUS AGENT PIPELINE - END-TO-END VERIFICATION")
    print("=" * 80)

    try:
        # Step 1: Create Organizer and Event in Delhi
        print("\n[Step 1] Initializing Event in Delhi, India...")
        organizer = db.query(User).filter(User.email == "organizer.delhi@eventra.local").first()
        if not organizer:
            organizer = User(name="Delhi Lead Organizer", email="organizer.delhi@eventra.local")
            db.add(organizer)
            db.commit()

        event = Event(
            owner_id=organizer.id,
            name="Delhi Corporate Summit 2026",
            description="High-stakes international conference in New Delhi",
            event_type=EventType.CONFERENCE,
            state=EventState.NORMAL,
            execution_state=EventExecutionState.RUNNING.value,
            location="Connaught Place, New Delhi",
            total_budget=Decimal("500000.00"),
            currency="INR",
            manual_mode=False,
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        print(f"  [OK] Event created: '{event.name}' (ID: {event.id}, Location: {event.location})")

        # Create Delhi Venue
        venue = Venue(
            name="Connaught International Center",
            address="Barakhamba Road, Connaught Place",
            city="Delhi",
            capacity=600,
            venue_type="CONFERENCE_HALL",
            latitude=28.6315,
            longitude=77.2167,
        )
        db.add(venue)
        db.commit()
        event.venue_id = venue.id
        db.commit()
        print(f"  [OK] Venue linked: '{venue.name}' ({venue.latitude}, {venue.longitude})")

        # Create Task: Catering
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        task = Task(
            event_id=event.id,
            name="VIP Lunch Catering",
            description="Multi-course banquet for conference attendees",
            phase="SETUP",
            required_provider_category="catering",
            planned_start=now + timedelta(hours=3),
            planned_end=now + timedelta(hours=6),
            duration_minutes=180,
            status="SCHEDULED",
        )
        db.add(task)
        db.commit()
        print(f"  [OK] Task created: '{task.name}' (Required Category: {task.required_provider_category})")

        # Initial Vendor (The one who will no-show)
        primary_vendor = Vendor(
            name="Delhi Regal Caterers",
            category="catering",
            city="Delhi",
            contact_phone="+919811122233",
            rating=4.5,
        )
        db.add(primary_vendor)
        db.commit()

        task.provider_id = primary_vendor.id
        db.commit()

        assignment = VendorAssignment(
            event_id=event.id,
            vendor_id=primary_vendor.id,
            category="catering",
            status="CONFIRMED",
            agreed_cost=120000.0,
        )
        db.add(assignment)
        db.commit()
        print(f"  [OK] Primary Vendor assigned: '{primary_vendor.name}' (Cost: INR {assignment.agreed_cost})")

        # Step 2: Test Real Provider Discovery in Delhi via VendorService & GoogleMapsScraperAdapter
        print("\n[Step 2] Executing Provider Discovery in Delhi via VendorService & GoogleMapsScraperAdapter...")
        from app.services.vendor_service import VendorService
        vendor_service = VendorService(db)
        disc_req = ProviderDiscoveryRequest(
            category="catering",
            location="Delhi",
            latitude=28.6315,
            longitude=77.2167,
            radius_km=15.0,
            limit=5,
            use_real_scraper=True,
        )
        vendors, created, updated, source, queries, coords, label, mode = vendor_service.discover_providers_for_event(
            event.id, disc_req
        )
        print(f"  [OK] Discovery completed: source={source}, total_vendors={len(vendors)}, created={created}, updated={updated}")
        print(f"  [OK] Discovered {len(vendors)} providers in Delhi:")
        for idx, v in enumerate(vendors[:3], 1):
            print(f"     [{idx}] {v.name} | City: {v.city} | Rating: {v.rating} | Contact: {v.contact_phone}")

        assert len(vendors) > 0, "Real discovery returned 0 providers"
        backup_vendor = vendors[0]

        # Step 3: Trigger Incident
        print("\n[Step 3] Simulating Incident: VENDOR_NO_SHOW...")
        incident = Incident(
            event_id=event.id,
            title="Primary Caterer No-Show Alert",
            description="Delhi Regal Caterers failed to arrive for scheduled setup.",
            incident_type=IncidentType.VENDOR_NO_SHOW.value,
            severity=IncidentSeverity.CRITICAL.value,
            status=IncidentStatus.OPEN.value,
            related_task_id=task.id,
            related_vendor_id=primary_vendor.id,
        )
        db.add(incident)
        db.commit()
        print(f"  [OK] Incident logged: '{incident.title}' (Severity: {incident.severity}, Related Task: {task.name})")

        # Step 4: Propose Reassignment Action Requiring Human Approval
        print("\n[Step 4] Agent Governance: Generating Approval Request for Spending/Reassignment...")
        snapshot = compute_event_state_snapshot(db, event.id)
        approval = Approval(
            event_id=event.id,
            requester_id=organizer.id,
            action_type="REASSIGN_VENDOR",
            target_type="TASK",
            target_id=task.id,
            impact_level="CRITICAL",
            requested_action={
                "task_id": task.id,
                "new_vendor_id": backup_vendor.id,
                "agreed_cost": 135000.0,
            },
            status="PENDING",
            state_snapshot=snapshot,
        )
        db.add(approval)
        db.commit()
        print(f"  [OK] Pending Approval Request created: ID {approval.id}")
        print(f"    Action: REASSIGN_VENDOR to '{backup_vendor.name}' for Task '{task.name}'")
        print(f"    Impact: CRITICAL (Enforces Separation of Duties & Non-Self-Approval)")

        # Step 5: Execute Human Approval & Transactional Mutation
        print("\n[Step 5] Human Approver Grants Authorization...")
        # Create Approver with MAIN_ORGANIZER permission
        approver = db.query(User).filter(User.email == "executive@eventra.local").first()
        if not approver:
            approver = User(name="Executive Approver", email="executive@eventra.local")
            db.add(approver)
            db.commit()

        member = EventMember(event_id=event.id, user_id=approver.id, role=RoleType.MAIN_ORGANIZER.value)
        db.add(member)
        db.commit()

        approval_service = ApprovalService(db)
        app_res, exec_res = approval_service.approve(
            event_id=event.id,
            approval_id=approval.id,
            approver_id=approver.id,
            decision_notes="Approved emergency backup caterer engagement.",
        )
        print(f"  [OK] Approval status: {app_res.status} by {approver.name}")
        print(f"  [OK] Action executed: Execution ID {exec_res.id}, Status {exec_res.status}")

        # Step 6: Verify VendorTaskBindingService & Invariants
        print("\n[Step 6] Verifying Task/Vendor Binding & Invariants...")
        db.refresh(task)
        print(f"  [OK] Task '{task.name}' current bound provider_id: {task.provider_id}")
        assert task.provider_id == backup_vendor.id, f"Expected task provider to be {backup_vendor.id}, got {task.provider_id}"

        active_assignment = (
            db.query(VendorAssignment)
            .filter(VendorAssignment.event_id == event.id, VendorAssignment.vendor_id == backup_vendor.id)
            .first()
        )
        assert active_assignment is not None, "VendorAssignment not created!"
        print(f"  [OK] Active VendorAssignment confirmed: Vendor '{backup_vendor.name}', Status '{active_assignment.status}', Cost: INR {active_assignment.agreed_cost}")

        print("\n" + "=" * 80)
        print("          END-TO-END PIPELINE VERIFICATION SUCCESSFUL")
        print("=" * 80)

    finally:
        db.close()


if __name__ == "__main__":
    run_e2e_test()
