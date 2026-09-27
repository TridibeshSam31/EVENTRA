"""SQLAlchemy Model: AgentRun (B10)"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship

from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = Column(String(64), nullable=False, unique=True, index=True)
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), nullable=True, index=True)
    trigger_message = Column(Text, nullable=True)
    objective = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="INITIALIZED", index=True)
    termination_status = Column(String(50), nullable=True)
    started_at = Column(DateTime, default=utc_now, nullable=False, index=True)
    completed_at = Column(DateTime, nullable=True)
    tool_history = Column(JSON, nullable=True)
    decision_trace = Column(JSON, nullable=True)
    final_response = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    event = relationship("Event")
