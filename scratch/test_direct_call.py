import traceback
import sys
from app.db.session import SessionLocal
from app.api.routes.intake import confirm_voice_intake, VoiceConfirmRequest

db = SessionLocal()
try:
    print("Testing confirm_voice_intake directly in-process...")
    req = VoiceConfirmRequest(
        fields={
            "name": "Direct Test Summit",
            "event_type": "CONFERENCE",
            "location": "Delhi",
            "guest_count": 100,
            "total_budget": 500000.0,
            "currency": "INR",
            "requirements": ["CATERING", "AV_TECH"],
        },
        accepted_suggestions=[],
        explicit_defaults_accepted=True,
        idempotency_key="direct_test_1"
    )
    result = confirm_voice_intake(req=req, db=db, current_user_id="anonymous_operator")
    print("SUCCESS!")
    print("Event ID:", result.get("event_id") or result.get("event", {}).get("id"))
    print("Status:", result.get("status"))
except Exception as e:
    print("EXCEPTION:", type(e), e)
    traceback.print_exc()
finally:
    db.close()
