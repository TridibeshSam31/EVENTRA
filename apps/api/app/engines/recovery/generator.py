"""Fact-based candidate generation; this module never mutates event state."""
from typing import Any, Dict, List

from app.engines.recovery.types import RecoveryCandidate, RecoveryContext, RecoveryStrategy


class RecoveryGenerator:
    """Generate only candidates supported by the current authoritative records."""

    def generate_candidates(self, context: RecoveryContext) -> List[RecoveryCandidate]:
        incident = context.incident
        incident_type = getattr(incident, "incident_type", "")
        metadata = getattr(incident, "evidence_metadata", None) or {}
        task_ids = self._affected_task_ids(context)
        if not task_ids:
            return []

        delay = int(metadata.get("delay_minutes") or metadata.get("deviation_minutes") or
                    context.impact_result.get("schedule_impact", {}).get("delay_minutes", 0) or 0)
        candidates: List[RecoveryCandidate] = []

        # Waiting has a concrete meaning only when the incident reports a delay/no-show/slip.
        if incident_type in {"VENDOR_DELAY", "VENDOR_NO_SHOW", "VENDOR_FAILURE", "SCHEDULE_DEVIATION", "TASK_DELAY", "SCHEDULE_SLIP"} and delay > 0:
            candidates.append(RecoveryCandidate(
                strategy_type=RecoveryStrategy.WAIT,
                affected_task_ids=task_ids,
                affected_provider_ids=self._related_provider_ids(context),
                proposed_changes={"delay_minutes": delay, "operation": "retain_current_assignment"},
            ))

        alternatives = self._eligible_providers(context, task_ids)
        for provider in alternatives:
            provider_id = getattr(provider, "id")
            provider_cost = getattr(provider, "base_cost", None)
            # An unknown price is not a concrete alternative: never fabricate one.
            if provider_cost is None:
                continue
            eta = self._provider_eta(metadata, provider_id)
            changes = {
                "provider_id": provider_id,
                "provider_cost": float(provider_cost),
                "delay_minutes": eta,
                "operation": "propose_provider_substitution",
            }
            candidates.append(RecoveryCandidate(
                strategy_type=RecoveryStrategy.BACKUP,
                affected_task_ids=task_ids,
                affected_provider_ids=[provider_id],
                proposed_changes=changes,
            ))
            candidates.append(RecoveryCandidate(
                strategy_type=RecoveryStrategy.REASSIGN,
                affected_task_ids=task_ids,
                affected_provider_ids=[provider_id],
                proposed_changes={**changes, "operation": "propose_provider_reassignment"},
            ))

        # Moving existing tasks is always a proposal, not a schedule mutation.
        if delay > 0:
            candidates.append(RecoveryCandidate(
                strategy_type=RecoveryStrategy.RESCHEDULE,
                affected_task_ids=task_ids,
                affected_provider_ids=self._related_provider_ids(context),
                proposed_changes={"delay_minutes": delay, "operation": "propose_schedule_shift"},
            ))

        # Compression is deliberately opt-in. The task schema has no generic
        # compressibility field, so evidence must explicitly identify the task and cap.
        compressible = metadata.get("compressible_task_ids", [])
        max_compression = int(metadata.get("max_compression_minutes", 0) or 0)
        selected = sorted(set(task_ids).intersection(compressible))
        if selected and max_compression > 0:
            candidates.append(RecoveryCandidate(
                strategy_type=RecoveryStrategy.COMPRESS,
                affected_task_ids=selected,
                proposed_changes={
                    "compression_minutes": max_compression,
                    "operation": "propose_explicitly_authorized_compression",
                },
            ))

        # Resource substitutions use only existing available, compatible resources.
        if incident_type in {"RESOURCE_SHORTAGE", "RESOURCE_UNAVAILABLE", "EQUIPMENT_FAILURE"}:
            related = getattr(incident, "related_resource_id", None)
            source = next((r for r in context.resources if getattr(r, "id", None) == related), None)
            if source:
                for resource in sorted(context.resources, key=lambda r: getattr(r, "id", "")):
                    if (getattr(resource, "id", None) != related and
                        getattr(resource, "type", None) == getattr(source, "type", None) and
                        getattr(resource, "status", "") == "AVAILABLE" and
                        getattr(resource, "quantity", 0) >= int(metadata.get("shortage_quantity", 1))):
                        candidates.append(RecoveryCandidate(
                            strategy_type=RecoveryStrategy.REASSIGN,
                            affected_task_ids=task_ids,
                            affected_resource_ids=[getattr(resource, "id")],
                            proposed_changes={"resource_id": getattr(resource, "id"), "operation": "propose_resource_reassignment"},
                        ))

        # Scope shedding candidates (for non-critical tasks)
        sheddable = metadata.get("sheddable_task_ids", [])
        if not sheddable:
            by_id = {getattr(t, "id"): t for t in context.tasks}
            sheddable = [tid for tid in task_ids if tid in by_id and str(getattr(by_id[tid], "priority", "")).upper() == "LOW"]
        if sheddable:
            candidates.append(RecoveryCandidate(
                strategy_type=RecoveryStrategy.SCOPE_SHED,
                affected_task_ids=sorted(sheddable),
                proposed_changes={"operation": "propose_scope_shedding", "cancelled_task_ids": sorted(sheddable)},
            ))

        # Capacity adjustment candidates
        target_cap = metadata.get("target_capacity") or metadata.get("adjusted_capacity")
        if incident_type in {"CAPACITY_PROBLEM", "CAPACITY_CHANGE"} or target_cap:
            candidates.append(RecoveryCandidate(
                strategy_type=RecoveryStrategy.CAPACITY_ADJUST,
                affected_task_ids=task_ids,
                proposed_changes={
                    "operation": "propose_capacity_adjustment",
                    "target_capacity": target_cap or 100,
                },
            ))

        # Stable ordering is part of determinism.
        return sorted(candidates, key=lambda c: (c.strategy_type, tuple(c.affected_provider_ids), tuple(c.affected_resource_ids)))

    @staticmethod
    def _affected_task_ids(context: RecoveryContext) -> List[str]:
        direct = context.impact_result.get("directly_affected_tasks", [])
        ids = [item.get("id") for item in direct if item.get("id")]
        related = getattr(context.incident, "related_task_id", None)
        if related:
            ids.append(related)
        return sorted(set(ids))

    @staticmethod
    def _related_provider_ids(context: RecoveryContext) -> List[str]:
        provider_id = getattr(context.incident, "related_vendor_id", None)
        return [provider_id] if provider_id else []

    def _eligible_providers(self, context: RecoveryContext, task_ids: List[str]) -> List[Any]:
        by_id = {getattr(task, "id"): task for task in context.tasks}
        categories = {
            (getattr(by_id[task_id], "required_provider_category", None) or "").lower()
            for task_id in task_ids if task_id in by_id
        }
        if not categories:
            for assignment in context.provider_assignments:
                if getattr(assignment, "vendor_id", None) == getattr(context.incident, "related_vendor_id", None):
                    categories.add((getattr(assignment, "category", "") or "").lower())
        excluded = getattr(context.incident, "related_vendor_id", None)
        return [provider for provider in sorted(context.providers, key=lambda p: getattr(p, "id", ""))
                if getattr(provider, "id", None) != excluded
                and getattr(provider, "status", "") == "ACTIVE"
                and (getattr(provider, "category", "") or "").lower() in categories]

    @staticmethod
    def _provider_eta(metadata: Dict[str, Any], provider_id: str) -> int:
        etas = metadata.get("provider_eta_minutes", {})
        value = etas.get(provider_id, metadata.get("backup_eta_minutes", 0)) if isinstance(etas, dict) else 0
        return max(0, int(value or 0))


# Alias retained for callers of the original Phase 0 scaffold.
Generator = RecoveryGenerator
