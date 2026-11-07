"""UX v3 §6 (BE-D): one committed-budget definition, honest discovery data, late-task incidents."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.models.budget import BudgetItem
from app.models.event import Event
from app.models.incident import Incident
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.services.budget_commitments import (
    committed_by_category_from_assignments,
    committed_from_assignments,
    committed_total,
    utilization_percent,
)
from app.services.discovery_ranking_engine import DiscoveryRankingEngine
from app.services.late_task_sweeper import SWEEPER_SOURCE, lateness, sweep_event
from app.services.live_state_service import LiveStateService


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _event(db, **kw):
    ev = Event(name="Fest", event_type="COLLEGE_FEST", total_budget=Decimal("100000"), currency="INR", **kw)
    db.add(ev)
    db.commit()
    return ev


def _vendor(db, name="Royal Feast", category="CATERING"):
    v = Vendor(name=name, category=category, city="Delhi")
    db.add(v)
    db.commit()
    return v


# ── committed budget ───────────────────────────────────────────────────────

def test_committed_counts_only_confirmed_agreed_cost(db_session):
    ev = _event(db_session)
    v1, v2, v3 = _vendor(db_session, "A"), _vendor(db_session, "B", "DECOR"), _vendor(db_session, "C")
    db_session.add_all([
        VendorAssignment(event_id=ev.id, vendor_id=v1.id, category="catering", status="CONFIRMED", agreed_cost=40000),
        # quote not confirmed → pending, never committed
        VendorAssignment(event_id=ev.id, vendor_id=v2.id, category="DECOR", status="REQUESTED", quoted_amount=25000),
        # confirmed via negotiation status counts too
        VendorAssignment(event_id=ev.id, vendor_id=v3.id, category="CATERING", status="REQUESTED",
                         negotiation_status="CONFIRMED", agreed_cost=5000),
    ])
    # estimates are plans, not commitments
    db_session.add(BudgetItem(event_id=ev.id, name="Catering", category="CATERING", estimated_amount=Decimal("90000")))
    db_session.commit()

    assert committed_total(db_session, ev.id) == Decimal("45000.00")
    by_cat = committed_by_category_from_assignments(
        db_session.query(VendorAssignment).filter_by(event_id=ev.id).all()
    )
    assert by_cat == {"CATERING": Decimal("45000.00")}
    assert utilization_percent(Decimal("45000"), Decimal("100000")) == Decimal("45.00")
    assert utilization_percent(Decimal("1"), Decimal("0")) == Decimal("0.00")


def test_confirmed_without_agreed_cost_is_not_invented_from_quote(db_session):
    ev = _event(db_session)
    v = _vendor(db_session)
    a = VendorAssignment(event_id=ev.id, vendor_id=v.id, category="CATERING", status="CONFIRMED", quoted_amount=9999)
    assert committed_from_assignments([a]) == Decimal("0.00")


def test_budget_summary_and_live_state_agree(test_client, db_session):
    ev = _event(db_session)
    v = _vendor(db_session)
    db_session.add(VendorAssignment(event_id=ev.id, vendor_id=v.id, category="CATERING",
                                    status="CONFIRMED", negotiation_status="CONFIRMED", agreed_cost=30000))
    db_session.add(BudgetItem(event_id=ev.id, name="Catering", category="CATERING", estimated_amount=Decimal("100000")))
    db_session.commit()

    res = test_client.get(f"/api/events/{ev.id}/budget/summary")
    assert res.status_code == 200
    body = res.json()
    assert body["total_committed"] == 30000.0
    assert body["committed_by_category"] == {"CATERING": 30000.0}
    assert body["utilization_percent"] == 30.0
    assert body["remaining_after_committed"] == 70000.0
    # estimates are still reported, separately
    assert body["total_estimated"] == 100000.0

    providers = LiveStateService(db_session).get_provider_live_state(ev.id)
    assert providers.total_committed_cost == 30000.0


# ── discovery explainability ───────────────────────────────────────────────

def test_score_breakdown_omits_dimensions_without_evidence():
    cand = NormalizedProvider(source="DATABASE", name="Unknown Caterer", category="CATERING", city="Delhi")
    score, reasons, breakdown = DiscoveryRankingEngine.score_candidate_detailed(cand, "WEDDING")
    assert 0.0 <= score <= 1.0
    assert "rating" not in breakdown and "reviews" not in breakdown and "price" not in breakdown
    assert "contactability" in breakdown  # "no phone, no website" is itself evidence


def test_score_breakdown_includes_measured_dimensions():
    cand = NormalizedProvider(
        source="LIVE_SCRAPE", name="Royal Feast", category="CATERING", city="Delhi",
        rating=4.6, review_count=120, phone="+911234567890",
    )
    _, _, breakdown = DiscoveryRankingEngine.score_candidate_detailed(cand, "WEDDING", distance_km=5.0)
    assert breakdown["rating"] == round(4.6 / 5.0, 3)
    assert "reviews" in breakdown and "location" in breakdown
    # score_candidate keeps its original 2-tuple contract
    assert len(DiscoveryRankingEngine.score_candidate(cand, "WEDDING")) == 2


def test_ranked_candidates_carry_breakdown():
    cand = NormalizedProvider(source="LIVE_SCRAPE", name="X", category="CATERING", city="Delhi", rating=4.0)
    ranked = DiscoveryRankingEngine.rank_candidates([cand], "WEDDING", distances={}, qual_results={})
    assert ranked and ranked[0].score_breakdown.get("rating") == 0.8


def test_estimated_fields_for_osm_and_tagged_sources():
    from app.services.autonomous_operations_service import _estimated_fields_for

    class _OsmVenue:
        source = "LIVE_OPENSTREETMAP_NETWORK"
        capacity = 3500
        hourly_rate = 650.0
        field_sources = {}

    assert set(_estimated_fields_for(_OsmVenue())) >= {"capacity", "hourly_rate"}
    tagged = NormalizedProvider(source="LIVE_SCRAPE", name="Y", field_sources={"capacity": "inferred", "phone": "verified"})
    assert _estimated_fields_for(tagged) == ["capacity"]


# ── late-task incidents ────────────────────────────────────────────────────

def test_lateness_rules():
    now = _now()
    t = Task(name="Catering setup", status="READY", planned_start=now - timedelta(minutes=45))
    assert lateness(t, now, 30)[0] == "start"
    assert lateness(t, now, 60) is None
    t.status = "COMPLETED"
    assert lateness(t, now, 30) is None
    t2 = Task(name="AV", status="IN_PROGRESS", planned_start=now - timedelta(hours=3),
              actual_start=now - timedelta(hours=3), planned_end=now - timedelta(minutes=40))
    kind, minutes = lateness(t2, now, 30)
    assert kind == "finish" and minutes >= 39


def test_sweep_creates_one_incident_per_late_task(db_session):
    ev = _event(db_session, lifecycle_state="LIVE")
    v = _vendor(db_session)
    now = _now()
    late = Task(event_id=ev.id, name="Catering setup", status="READY", provider_id=v.id,
                is_critical_path=True, planned_start=now - timedelta(minutes=50), planned_end=now + timedelta(hours=1))
    on_time = Task(event_id=ev.id, name="Decor", status="READY", provider_id=v.id,
                   planned_start=now + timedelta(minutes=20))
    no_vendor = Task(event_id=ev.id, name="Unassigned", status="READY", planned_start=now - timedelta(hours=2))
    db_session.add_all([late, on_time, no_vendor])
    db_session.commit()

    assert sweep_event(db_session, ev, now=now) == 1
    incidents = db_session.query(Incident).filter_by(event_id=ev.id, source=SWEEPER_SOURCE).all()
    assert len(incidents) == 1
    inc = incidents[0]
    assert inc.related_task_id == late.id and inc.related_vendor_id == v.id
    assert inc.incident_type == "VENDOR_DELAY"
    assert inc.evidence_metadata["delay_minutes"] >= 49

    # idempotent: never a second incident for the same task, even after it is resolved
    assert sweep_event(db_session, ev, now=now + timedelta(minutes=5)) == 0
    inc.status = "RESOLVED"
    db_session.commit()
    assert sweep_event(db_session, ev, now=now + timedelta(minutes=30)) == 0
