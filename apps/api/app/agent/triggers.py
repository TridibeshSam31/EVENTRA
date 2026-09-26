"""Autonomous Agent Execution Triggers.

Provides background-safe triggers to invoke EventOperationsAgent when domain events
occur (e.g. incident creation, approval granting, execution resumption, option execution).

Architectural constraints:
1. NEVER share the request-scoped DB session across threads/background tasks.
2. Open a fresh DB session via SessionLocal(), and always close it in a finally block.
3. Respect Event.manual_mode: if manual_mode is True, skip automatic execution
   so human operators retain full demo control and manual pacing.
4. Catch all unhandled exceptions within the background task so worker errors do not crash the app.
"""
import logging
from typing import Any, Dict, Optional
from app.db.session import SessionLocal
from app.models.event import Event
from app.agent.agent import EventOperationsAgent

logger = logging.getLogger(__name__)


def trigger_agent_run(
    event_id: str,
    message: str,
    user_id: str = "system",
    approval_id: Optional[str] = None,
    objective: Optional[str] = None,
    max_steps: int = 12,
) -> Optional[Dict[str, Any]]:
    """Background task target that executes EventOperationsAgent.run with an isolated DB session.
    
    Returns the agent execution dictionary on success, or None if skipped/failed.
    """
    logger.info(
        "Autonomous agent trigger invoked [event_id=%s, approval_id=%s, msg=%s]",
        event_id,
        approval_id,
        message[:60] if message else "",
    )

    db = SessionLocal()
    try:
        # Check manual_mode flag on Event
        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            logger.warning("Agent trigger skipped: Event '%s' not found.", event_id)
            return None

        if getattr(event, "manual_mode", False):
            logger.info(
                "[AGENT AUTO-TRIGGER SKIPPED] Event '%s' has manual_mode=True. Operator manual control retained.",
                event_id,
            )
            return None

        agent = EventOperationsAgent(db)
        result = agent.run(
            event_id=event_id,
            message=message,
            user_id=user_id,
            approval_id=approval_id,
            objective=objective,
            max_steps=max_steps,
        )
        logger.info(
            "Autonomous agent execution completed [event_id=%s, status=%s, phase=%s]",
            event_id,
            result.get("status") if isinstance(result, dict) else "DONE",
            result.get("current_phase") if isinstance(result, dict) else "UNKNOWN",
        )
        return result
    except Exception as exc:
        logger.error(
            "Autonomous agent execution failed for event '%s': %s",
            event_id,
            exc,
            exc_info=True,
        )
        return None
    finally:
        db.close()
