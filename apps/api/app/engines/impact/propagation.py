"""Deterministic Engine: impact.propagation

Graph traversal algorithms for propagating operational impact through the task dependency DAG.
Isolates downstream propagation and strictly excludes upstream predecessors.
"""
from typing import Any, Dict, List, Set, Tuple
from collections import deque
from app.engines.dependency.graph import DependencyGraph
from app.models.enums import TaskStatus


class ImpactPropagation:
    """Pure deterministic dependency propagation calculator."""

    def propagate_task_impact(
        self,
        direct_task_ids: Set[str],
        graph: DependencyGraph,
        tasks_by_id: Dict[str, Any],
    ) -> Tuple[List[str], List[str], List[Dict[str, Any]], int]:
        """Traverse the dependency graph to find downstream descendants.

        Args:
            direct_task_ids: Set of task IDs directly affected by the incident.
            graph: The in-memory DependencyGraph.
            tasks_by_id: Map of task_id -> task dict or ORM object.

        Returns:
            Tuple of:
            - indirectly_affected_ids: List of downstream descendant task IDs (excluding direct).
            - blocked_task_ids: List of downstream task IDs that cannot proceed.
            - affected_dependencies: List of dependency dicts traversed.
            - max_depth: Maximum dependency depth from any direct task.
        """
        indirectly_affected: Set[str] = set()
        affected_deps: List[Dict[str, Any]] = []
        depth_map: Dict[str, int] = {tid: 0 for tid in direct_task_ids}

        # BFS queue of (task_id, current_depth)
        queue = deque((tid, 0) for tid in sorted(direct_task_ids))
        visited: Set[str] = set(direct_task_ids)

        while queue:
            current_id, current_depth = queue.popleft()
            successors = graph.get_successors(current_id)

            for succ_id in sorted(successors):
                lag = graph.get_lag(current_id, succ_id)
                pred_t = tasks_by_id.get(current_id)
                succ_t = tasks_by_id.get(succ_id)
                pred_name = (pred_t.get("name") if isinstance(pred_t, dict) else getattr(pred_t, "name", None)) or current_id
                succ_name = (succ_t.get("name") if isinstance(succ_t, dict) else getattr(succ_t, "name", None)) or succ_id

                affected_deps.append({
                    "edge_type": "TASK_TO_TASK",
                    "predecessor_id": current_id,
                    "successor_id": succ_id,
                    "predecessor_task_id": current_id,
                    "successor_task_id": succ_id,
                    "predecessor_name": pred_name,
                    "successor_name": succ_name,
                    "dependency_type": "FINISH_TO_START",
                    "lag_minutes": lag,
                })

                new_depth = current_depth + 1
                if succ_id not in depth_map or new_depth > depth_map[succ_id]:
                    depth_map[succ_id] = new_depth

                if succ_id not in visited:
                    visited.add(succ_id)
                    indirectly_affected.add(succ_id)
                    queue.append((succ_id, new_depth))

        # Identify blocked tasks: downstream tasks whose predecessors are not completed
        blocked_tasks: List[str] = []
        for tid in sorted(indirectly_affected):
            task = tasks_by_id.get(tid)
            status = task.get("status") if isinstance(task, dict) else getattr(task, "status", None)
            if status not in (TaskStatus.COMPLETED.value, TaskStatus.CANCELLED.value):
                blocked_tasks.append(tid)

        max_depth = max(depth_map.values(), default=0)
        return sorted(indirectly_affected), blocked_tasks, affected_deps, max_depth
