import requests
import json

payload = {
    "fields": {
        "name": "Delhi Tech Summit 2026",
        "event_type": "CONFERENCE",
        "location": "Delhi",
        "guest_count": 100,
        "total_budget": 500000.0,
        "currency": "INR",
        "requirements": ["CATERING", "AV_TECH"]
    },
    "accepted_suggestions": [],
    "explicit_defaults_accepted": True,
    "idempotency_key": "test_debug_file_1"
}

print("Sending request...")
try:
    r = requests.post("http://127.0.0.1:8000/api/events/intake/voice/confirm", json=payload, timeout=30)
    print("STATUS:", r.status_code)
    print("BODY:", r.text[:400])
except Exception as e:
    print("ERROR:", type(e), e)
