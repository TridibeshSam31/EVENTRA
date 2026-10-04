"""Script to run a live demonstration of autonomous negotiation with safety controls.

Simulates a realistic multi-round negotiation:
1. Vendor quotes an initial price higher than the target and cap.
2. Agent calculates deterministic counter within target/cap constraints and sends offer.
3. Vendor counters with a reduced price.
4. Negotiation successfully lands within the cap and transitions to AWAITING_APPROVAL.
"""

import sys
import os
import time

# Ensure project root is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import SessionLocal
from app.models.vendor_assignment import VendorAssignment, NegotiationStatus, NegotiationControl
from app.services.negotiation_service import NegotiationService
from app.services.negotiation_broker import negotiation_broker


def run_demo(assignment_id: str, delay_seconds: float = 2.0):
    db = SessionLocal()
    try:
        assignment = db.query(VendorAssignment).filter(VendorAssignment.id == assignment_id).first()
        if not assignment:
            print(f"[-] Assignment {assignment_id} not found in database.")
            return

        print(f"[*] Starting Demo Negotiation for Assignment {assignment_id}")
        print(f"[*] Vendor: {assignment.vendor_id}, Cap: {assignment.max_approved_amount}")
        print(f"[*] Control Mode: {assignment.negotiation_control.value if hasattr(assignment.negotiation_control, 'value') else assignment.negotiation_control}")

        service = NegotiationService(db)

        # 1. Round 1: Vendor quotes above cap
        print(f"\n--- Round 1: Initial Vendor Quote (Over Cap) ---")
        time.sleep(delay_seconds)
        r1 = service.simulate_response(assignment_id=assignment.id, scenario="COUNTER")
        print(f"[+] Vendor response: {r1}")

        # 2. Agent counters
        print(f"\n--- Round 2: Autonomous Agent Counter ---")
        time.sleep(delay_seconds)
        r2 = service.negotiate(assignment_id=assignment.id)
        print(f"[+] Agent counter: {r2}")

        # 3. Vendor concedes and accepts / counters within budget
        print(f"\n--- Round 3: Vendor Concession within Approved Cap ---")
        time.sleep(delay_seconds)
        r3 = service.simulate_response(assignment_id=assignment.id, scenario="ACCEPT")
        print(f"[+] Final response: {r3}")

        db.refresh(assignment)
        print(f"\n[+] Demo completed!")
        print(f"    Final Status: {assignment.negotiation_status.value if hasattr(assignment.negotiation_status, 'value') else assignment.negotiation_status}")
        print(f"    Final Quote: {assignment.quoted_amount}")
        print(f"    Approved Cap: {assignment.max_approved_amount}")

    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/demo_negotiation.py <assignment_id> [delay_seconds]")
        sys.exit(1)

    asgn_id = sys.argv[1]
    delay = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    run_demo(asgn_id, delay)
