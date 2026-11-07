"""Server-side approval policy on recovery execution (role x impact tier)."""
import pytest

from app.core.exceptions import ForbiddenException
from app.engines.auth.snapshot import compute_event_state_snapshot
from app.models.event_member import EventMember
from app.models.recovery import Recovery
from app.models.user import User
from app.services.action_service import ActionService
from tests.test_vendor_signal_service import OWNER, _process, world  # noqa: F401  (fixture reuse)


def _option(db, world, strategy="BACKUP"):
    incident_id = _process(db, world, "Sorry, we have to cancel")["incident"]["id"]
    rec = Recovery(
        event_id=world.event.id,
        incident_id=incident_id,
        strategy_type=strategy,
        status="FEASIBLE",
        is_feasible=True,
        state_snapshot=compute_event_state_snapshot(db, world.event.id),
        proposed_changes={"operation": "noop"},
        affected_tasks=[world.task.id],
        feasibility_result={"feasible": True},
    )
    db.add(rec)
    db.commit()
    return rec


def test_collaborator_cannot_execute_critical_recovery_without_approval(db_session, world):
    db_session.add(User(id="collab-gate", name="Collab", email="collab-gate@example.com"))
    db_session.add(EventMember(event_id=world.event.id, user_id="collab-gate", role="COLLABORATOR"))
    db_session.commit()
    rec = _option(db_session, world)
    with pytest.raises(ForbiddenException, match="APPROVAL_REQUIRED"):
        ActionService(db_session).execute_recovery_option(world.event.id, "collab-gate", rec.id)
    db_session.refresh(rec)
    assert rec.status == "FEASIBLE"  # nothing was applied


def test_main_organizer_passes_the_gate(db_session, world):
    rec = _option(db_session, world)
    execution = ActionService(db_session).execute_recovery_option(world.event.id, OWNER, rec.id)
    assert execution.status == "SUCCESS"
    db_session.refresh(rec)
    assert rec.status == "EXECUTED"
    # Re-running the same option is idempotent, not a second mutation.
    again = ActionService(db_session).execute_recovery_option(world.event.id, OWNER, rec.id)
    assert again.id == execution.id
