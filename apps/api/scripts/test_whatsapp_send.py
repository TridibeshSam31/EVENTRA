"""Integration Test Script: Send Real WhatsApp Message via OpenWA.

Usage:
    python apps/api/scripts/test_whatsapp_send.py --to 919876543210 --message "Hello from EVENTRA autonomous agent"

This script tests the full end-to-end integration path:
1. Loads settings from environment / .env
2. Resolves OpenWACommunicationAdapter from IntegrationRegistry
3. Dispatches a message to the target phone number
4. Reports latency, message ID, HTTP status, and actual delivery result
"""
import sys
import os
import argparse
from pathlib import Path

# Add apps/api to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings
from app.integrations.registry import registry
from app.integrations.whatsapp.client import OpenWACommunicationAdapter
from app.integrations.base import IntegrationSource


def main():
    parser = argparse.ArgumentParser(description="Test OpenWA WhatsApp dispatch.")
    parser.add_argument(
        "--to",
        required=True,
        help="Recipient phone number (e.g. 919876543210 or +919876543210)",
    )
    parser.add_argument(
        "--message",
        default="EVENTRA Autonomous Agent Verification: testing live WhatsApp dispatch.",
        help="Message text to send.",
    )
    parser.add_argument(
        "--event-id",
        default="test-event-verification",
        help="Event ID for audit tagging.",
    )
    parser.add_argument(
        "--provider-id",
        default="test-vendor-1",
        help="Provider ID for audit tagging.",
    )
    args = parser.parse_args()

    print("=" * 70)
    print("EVENTRA OpenWA WhatsApp Integration Verification")
    print("=" * 70)
    print(f"OpenWA Enabled    : {settings.OPENWA_ENABLED}")
    print(f"OpenWA Base URL   : {settings.OPENWA_BASE_URL}")
    print(f"OpenWA Session ID : {settings.OPENWA_SESSION_ID}")
    print(f"Recipient Contact : {args.to}")
    print(f"Message           : {args.message}")
    print("-" * 70)

    adapter = registry.get_communication_provider()
    print(f"Resolved Provider : {adapter.__class__.__name__}")

    # Health check
    if isinstance(adapter, OpenWACommunicationAdapter):
        health = adapter.check_health()
        print(f"Gateway Health    : {health}")
        sess_status = adapter.get_session_status()
        print(f"Session Status    : {sess_status}")

    print("\nDispatching message...")
    result = adapter.send_message(
        event_id=args.event_id,
        provider_id=args.provider_id,
        message=args.message,
        recipient_contact=args.to,
    )

    print("-" * 70)
    print(f"Success    : {result.success}")
    print(f"Source     : {result.source.value if hasattr(result.source, 'value') else result.source}")
    print(f"Latency    : {result.latency_ms} ms")
    print(f"Data       : {result.data}")
    if result.error:
        print(f"Error/Note : {result.error}")
    print("=" * 70)

    if result.success and result.source == IntegrationSource.REAL:
        print("RESULT: SUCCESS — Real message dispatched via OpenWA container.")
        sys.exit(0)
    elif result.source == IntegrationSource.MOCK:
        print("RESULT: MOCK FALLBACK — Dispatched to local simulation (not real WhatsApp).")
        sys.exit(1)
    else:
        print(f"RESULT: FAILED — {result.error}")
        sys.exit(2)


if __name__ == "__main__":
    main()
