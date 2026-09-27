"""Unit tests for B1: Canonical Authoritative Dependency Blast Radius Edges."""
import pytest
from app.engines.impact.analyzer import ImpactAnalyzer
from app.engines.dependency.graph import DependencyGraph


def test_empty_dependency_graph_no_fabricated_relationships():
    analyzer = ImpactAnalyzer()
    incident = {"id": "inc-001", "title": "General Incident", "incident_type": "GENERAL"}
    res = analyzer.analyze(incident, tasks=[], dependencies=[])
    
    assert res["incident_id"] == "inc-001"
    assert res["directly_affected_tasks"] == []
    assert res["indirectly_affected_tasks"] == []
    assert res["affected_dependencies"] == []


def test_cpm_dependency_graph_edges():
    analyzer = ImpactAnalyzer()
    incident = {
        "id": "inc-cpm",
        "title": "Stage Rigging Delay",
        "incident_type": "TASK_DELAY",
        "related_task_id": "task-1",
    }
    tasks = [
        {"id": "task-1", "name": "Stage Rigging", "status": "IN_PROGRESS", "duration_minutes": 60},
        {"id": "task-2", "name": "Lighting Setup", "status": "PENDING", "duration_minutes": 45},
        {"id": "task-3", "name": "Sound Check", "status": "PENDING", "duration_minutes": 30},
    ]
    deps = [
        {"predecessor_task_id": "task-1", "successor_task_id": "task-2", "lag_minutes": 10},
        {"predecessor_task_id": "task-2", "successor_task_id": "task-3", "lag_minutes": 0},
    ]

    res = analyzer.analyze(incident, tasks=tasks, dependencies=deps)
    affected_deps = res["affected_dependencies"]
    
    # Must have incident causation edge + downstream task-to-task edges
    edge_types = [d["edge_type"] for d in affected_deps]
    assert "INCIDENT_TO_TASK" in edge_types
    assert "TASK_TO_TASK" in edge_types

    # Verify task-to-task edge details
    task_edges = [d for d in affected_deps if d["edge_type"] == "TASK_TO_TASK"]
    assert len(task_edges) == 2
    assert task_edges[0]["predecessor_id"] == "task-1"
    assert task_edges[0]["successor_id"] == "task-2"
    assert task_edges[0]["predecessor_name"] == "Stage Rigging"
    assert task_edges[0]["successor_name"] == "Lighting Setup"
    assert task_edges[0]["lag_minutes"] == 10
    # Backward compatibility keys
    assert task_edges[0]["predecessor_task_id"] == "task-1"
    assert task_edges[0]["successor_task_id"] == "task-2"


def test_non_cpm_incident_with_provider_and_resource_edges():
    analyzer = ImpactAnalyzer()
    incident = {
        "id": "inc-vendor",
        "title": "Caterer Truck Breakdown",
        "incident_type": "VENDOR_FAILURE",
        "related_vendor_id": "vendor-101",
    }
    tasks = [
        {
            "id": "task-cat",
            "name": "Lunch Buffet Setup",
            "required_provider_category": "catering",
            "provider_id": "vendor-101",
            "status": "PENDING",
            "duration_minutes": 90,
        },
        {
            "id": "task-unrelated",
            "name": "AV Calibration",
            "required_provider_category": "av",
            "status": "PENDING",
            "duration_minutes": 60,
        },
    ]
    vendor_assignments = [
        {
            "id": "va-1",
            "vendor_id": "vendor-101",
            "category": "catering",
            "task_id": "task-cat",
            "status": "CONFIRMED",
        }
    ]
    resources = [
        {
            "id": "res-warmer",
            "name": "Chafing Dish Warmers",
            "type": "EQUIPMENT",
            "allocated_task_id": "task-cat",
            "status": "ALLOCATED",
        }
    ]

    res = analyzer.analyze(
        incident,
        tasks=tasks,
        dependencies=[],
        resources=resources,
        vendor_assignments=vendor_assignments,
    )
    affected_deps = res["affected_dependencies"]

    # Edges must include INCIDENT_TO_TASK, PROVIDER_TO_TASK, and RESOURCE_TO_TASK
    edge_types = [d["edge_type"] for d in affected_deps]
    assert "INCIDENT_TO_TASK" in edge_types
    assert "PROVIDER_TO_TASK" in edge_types
    assert "RESOURCE_TO_TASK" in edge_types

    prov_edge = next(d for d in affected_deps if d["edge_type"] == "PROVIDER_TO_TASK")
    assert prov_edge["predecessor_id"] == "vendor-101"
    assert prov_edge["successor_id"] == "task-cat"
    assert prov_edge["successor_name"] == "Lunch Buffet Setup"
    assert prov_edge["dependency_type"] == "ASSIGNMENT"

    res_edge = next(d for d in affected_deps if d["edge_type"] == "RESOURCE_TO_TASK")
    assert res_edge["predecessor_id"] == "res-warmer"
    assert res_edge["successor_id"] == "task-cat"
    assert res_edge["predecessor_name"] == "Chafing Dish Warmers"
    assert res_edge["dependency_type"] == "ALLOCATION"


def test_multiple_affected_tasks_no_hallucinated_edges():
    analyzer = ImpactAnalyzer()
    incident = {
        "id": "inc-venue",
        "title": "Ballroom Flooding",
        "incident_type": "VENUE_ISSUE",
        "related_venue_id": "venue-main",
    }
    tasks = [
        {"id": "t-setup-1", "name": "Hallway Decor", "phase": "SETUP", "status": "PENDING"},
        {"id": "t-setup-2", "name": "Main Stage Assembly", "phase": "SETUP", "status": "PENDING"},
        {"id": "t-unrelated", "name": "Post-Event Debrief", "phase": "POST_EVENT", "status": "PENDING"},
    ]

    res = analyzer.analyze(incident, tasks=tasks, dependencies=[])
    direct_ids = [t["id"] for t in res["directly_affected_tasks"]]
    assert "t-setup-1" in direct_ids
    assert "t-setup-2" in direct_ids
    assert "t-unrelated" not in direct_ids

    # Verify only causation edges for directly affected tasks exist
    for dep in res["affected_dependencies"]:
        assert dep["edge_type"] == "INCIDENT_TO_TASK"
        assert dep["successor_id"] in ("t-setup-1", "t-setup-2")
        assert dep["successor_id"] != "t-unrelated"
