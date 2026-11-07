"""Idempotently registers a vendor contact for real outreach testing.

Usage (inside the API container, phone via env so it stays out of the command line):
    OUTREACH_CONTACT_PHONE=<number> python scripts/upsert_outreach_contact.py \
        --event-id <event uuid> --name "<contact name>" --category PHOTOGRAPHY

What it does:
1. Normalizes the phone number to E.164 (Indian numbers default to +91).
2. Reuses an existing vendor whose contact phone matches; it never overwrites an
   existing vendor's contact details. Otherwise creates a clearly labelled test vendor.
3. Adds that vendor to the event shortlist as RECOMMENDED so the organizer can
   select it and use "Approve & Contact" in the UI.
Running it again changes nothing. The phone number is never printed unmasked.
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.phone import InvalidPhoneNumber, mask_phone, normalize_phone_e164, phone_last10
from app.db.session import SessionLocal
import app.models  # noqa: F401  (registers all mappers)
from app.models.enums import ProviderCategory
from app.models.event import Event
from app.models.shortlist import EventShortlistEntry
from app.models.vendor import Vendor

TEST_VENDOR_SUFFIX = "(EVENTRA test contact)"


def main() -> int:
    parser = argparse.ArgumentParser(description="Register a vendor contact for real outreach testing.")
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--name", required=True, help="Contact name exactly as the person is known")
    parser.add_argument("--category", required=True, choices=[c.value for c in ProviderCategory])
    parser.add_argument("--phone", default=os.environ.get("OUTREACH_CONTACT_PHONE"), help="Defaults to $OUTREACH_CONTACT_PHONE")
    args = parser.parse_args()

    try:
        phone = normalize_phone_e164(args.phone)
    except InvalidPhoneNumber as err:
        print(f"ERROR: {err}")
        return 1

    with SessionLocal() as db:
        event = db.get(Event, args.event_id)
        if not event:
            print(f"ERROR: event {args.event_id} not found")
            return 1

        last4 = phone[-4:]
        matches = [
            v for v in db.query(Vendor).filter(Vendor.contact_phone.like(f"%{last4}")).all()
            if phone_last10(v.contact_phone) == phone_last10(phone)
        ]
        if len(matches) > 1:
            print(f"ERROR: {len(matches)} vendors already use {mask_phone(phone)}; resolve the duplicates first:")
            for v in matches:
                print(f"  - {v.id} {v.name}")
            return 1

        if matches:
            vendor = matches[0]
            print(f"Reusing existing vendor {vendor.id} ({vendor.name}); contact details left unchanged.")
            if (vendor.contact_name or "").strip() != args.name.strip():
                print(f"WARNING: its contact name is '{vendor.contact_name}', not '{args.name}'. Update it in vendor management if that is wrong.")
        else:
            vendor = Vendor(
                name=f"{args.name} {TEST_VENDOR_SUFFIX}",
                category=args.category,
                city=(event.location or "Unknown").split(",")[0].strip() or "Unknown",
                contact_name=args.name,
                contact_phone=phone,
                status="ACTIVE",
                source="INTERNAL",
                service_description="Test vendor created for live WhatsApp and AI call verification.",
            )
            db.add(vendor)
            db.commit()
            print(f"Created test vendor {vendor.id} ({vendor.name}) with contact {mask_phone(phone)}.")

        entry = (
            db.query(EventShortlistEntry)
            .filter(EventShortlistEntry.event_id == event.id, EventShortlistEntry.provider_id == vendor.id)
            .first()
        )
        if entry:
            print(f"Already on the shortlist of '{event.name}' as {entry.candidate_id} (status {entry.status}).")
        else:
            entry = EventShortlistEntry(
                event_id=event.id,
                candidate_id=vendor.id,  # approvals.target_id is String(36)
                provider_id=vendor.id,
                category=args.category,
                candidate_name=vendor.name,
                status="RECOMMENDED",
                # Not ORGANIZER_SELECTION: the UI treats that as already selected.
                selection_source="TEST_CONTACT",
                notes="Added for live outreach testing.",
                candidate_data={"contact_name": vendor.contact_name, "source": "test_contact"},
            )
            db.add(entry)
            db.commit()
            print(f"Added to the shortlist of '{event.name}' as {entry.candidate_id}. Select it in the UI, then Approve & Contact.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
