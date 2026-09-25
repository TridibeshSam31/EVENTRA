"""Observability: Structured Decision Trace.

Assembles concise, structured, factual traces of the operational recovery lifecycle:
Incident -> Impact -> Risk -> Recovery Option -> Authorization -> Approval -> Execution -> Verification -> Event State.

STRICT RULE: Contains only factual structured milestones; NEVER stores chain-of-thought
or opaque model reasoning.
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models.action import ActionExecution
from app.models.approval import ApprovalRequest
from app.models.incident import Incident
from app.models.recovery import Recovery
from app.models.verification import VerificationResult


class DecisionTraceService:
    """Assembles factual structured operational decision traces."""

    def __init__(self, db: Session):
        self.db = db

    def get_traces_for_event(self, event_id: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Assembles structured decision traces for all verified actions in an event."""
        verifications = (
            self.db.query(VerificationResult)
            .filter(VerificationResult.event_id == event_id)
            .order_by(VerificationResult.verified_at.desc())
            .limit(limit)
            .all()
        )

        traces = []
        for v in verifications:
            traces.append(self._build_trace(v))
        return traces

    def get_trace_by_verification_id(self, event_id: str, verification_id: str) -> Optional[Dict[str, Any]]:
        """Builds a decision trace for a single verification result."""
        ver = (
            self.db.query(VerificationResult)
            .filter(VerificationResult.id == verification_id, VerificationResult.event_id == event_id)
            .first()
        )
        if not ver:
            return None
        return self._build_trace(ver)

    def get_trace_by_incident_id(self, event_id: str, incident_id: str) -> Optional[Dict[str, Any]]:
        """Builds a decision trace for an incident by finding its recovery option and verification."""
        recovery_opts = (
            self.db.query(Recovery)
            .filter(Recovery.event_id == event_id, Recovery.incident_id == incident_id)
            .all()
        )
        rec_ids = [r.id for r in recovery_opts]
        ver = None
        if rec_ids:
            ver = (
                self.db.query(VerificationResult)
                .filter(VerificationResult.event_id == event_id, VerificationResult.recovery_option_id.in_(rec_ids))
                .order_by(VerificationResult.verified_at.desc())
                .first()
            )
        if not ver:
            ver = (
                self.db.query(VerificationResult)
                .filter(VerificationResult.event_id == event_id)
                .order_by(VerificationResult.verified_at.desc())
                .first()
            )
        if not ver:
            return None
        return self._build_trace(ver)

    def _build_trace(self, ver: VerificationResult) -> Dict[str, Any]:
        """Constructs a deterministic factual trace linking the recovery pipeline."""
        act_exec = None
        if ver.action_execution_id:
            act_exec = self.db.query(ActionExecution).filter(ActionExecution.id == ver.action_execution_id).first()

        rec_opt = None
        if ver.recovery_option_id:
            rec_opt = self.db.query(Recovery).filter(Recovery.id == ver.recovery_option_id).first()
        elif act_exec and act_exec.recovery_option_id:
            rec_opt = self.db.query(Recovery).filter(Recovery.id == act_exec.recovery_option_id).first()

        incident = None
        if rec_opt and rec_opt.incident_id:
            incident = self.db.query(Incident).filter(Incident.id == rec_opt.incident_id).first()

        approval = None
        appr_id = getattr(act_exec, "approval_request_id", None) or getattr(act_exec, "approval_id", None) if act_exec else None
        if appr_id:
            approval = self.db.query(ApprovalRequest).filter(ApprovalRequest.id == appr_id).first()

        return {
            "trace_id": f"trace-{ver.id}",
            "event_id": ver.event_id,
            "verification_id": ver.id,
            "timestamp": ver.verified_at.isoformat(),
            # 1. Incident Phase
            "incident": {
                "id": incident.id if incident else None,
                "type": incident.incident_type if incident else None,
                "severity": incident.severity if incident else None,
                "title": incident.title if incident else None,
            } if incident else None,
            # 2. Risk & Impact Phase
            "impact_and_risk": {
                "risk_before": ver.risk_before,
                "risk_after": ver.risk_after,
            },
            # 3. Recovery Strategy Phase
            "recovery_option": {
                "id": rec_opt.id if rec_opt else None,
                "strategy_type": rec_opt.strategy_type if rec_opt else None,
                "score": rec_opt.score if rec_opt else None,
                "rank": rec_opt.rank if rec_opt else None,
            } if rec_opt else None,
            # 4. Approval Phase
            "approval": {
                "id": approval.id if approval else None,
                "requester_id": approval.requester_id if approval else None,
                "approver_id": approval.approver_id if approval else None,
                "status": approval.status if approval else "DIRECT_EXECUTION",
                "impact_level": approval.impact_level if approval else None,
            } if approval else None,
            # 5. Execution Phase
            "execution": {
                "action_id": act_exec.action_id if act_exec else None,
                "action_type": act_exec.action_type if act_exec else None,
                "status": act_exec.status if act_exec else None,
                "executor_id": act_exec.executor_id if act_exec else None,
            } if act_exec else None,
            # 6. Verification Phase
            "verification": {
                "status": ver.status,
                "intended_outcome": ver.intended_outcome,
                "actual_outcome": ver.actual_outcome,
                "failure_reasons": ver.failure_reasons,
                "warnings": ver.warnings,
            },
            # 7. Final Operational State
            "event_state": {
                "state_before": ver.event_state_before,
                "state_after": ver.event_state_after,
            },
        }
