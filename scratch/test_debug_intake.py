import sys
import time

print("[1] Starting script...", flush=True)
t0 = time.time()

print("[2] Importing SessionLocal...", flush=True)
from app.db.session import SessionLocal
print(f"    Done in {time.time()-t0:.2f}s", flush=True)

t0 = time.time()
print("[3] Creating DB session...", flush=True)
db = SessionLocal()
print(f"    Done in {time.time()-t0:.2f}s", flush=True)

t0 = time.time()
print("[4] Testing DB query...", flush=True)
from app.models.event import Event
ev = db.query(Event).first()
print(f"    Found event: {ev.id if ev else 'None'} in {time.time()-t0:.2f}s", flush=True)

t0 = time.time()
print("[5] Importing IntakeService...", flush=True)
from app.services.intake_service import IntakeService
service = IntakeService(db)
print(f"    Done in {time.time()-t0:.2f}s", flush=True)

t0 = time.time()
print("[6] Calling process_intake with structured_overrides...", flush=True)
overrides = {
    "name": "Delhi Tech Summit 2026",
    "event_type": "CONFERENCE",
    "location": "Delhi",
    "guest_count": 100,
    "total_budget": 500000.0,
    "currency": "INR",
    "requirements": ["CATERING", "AV_TECH"],
}
res = service.process_intake(
    message="Organize a Delhi Tech Summit for 100 people with 500000 budget",
    force_plan=True,
    structured_overrides=overrides,
)
print(f"    Done in {time.time()-t0:.2f}s", flush=True)
print("    Result status:", res.get("status"), flush=True)
print("    Event ID:", res.get("event_id") or res.get("event", {}).get("id"), flush=True)

db.close()
print("[7] All done successfully!", flush=True)
