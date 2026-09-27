"""Integration tests for B9: Engine Health & Status Telemetry."""
from unittest.mock import patch
from fastapi.testclient import TestClient


def test_engine_health_endpoint_success(test_client: TestClient):
    # Test both /health/engines and /api/health/engines
    for endpoint in ["/health/engines", "/api/health/engines"]:
        res = test_client.get(endpoint)
        assert res.status_code == 200
        data = res.json()
        assert data["service"] == "eventra-api"
        assert "status" in data
        assert data["status"] in ("HEALTHY", "DEGRADED")
        assert "engines" in data
        engines = data["engines"]

        # Core engines
        assert "database" in engines
        assert "planning_engine" in engines
        assert "dependency_engine" in engines
        assert "impact_engine" in engines
        assert "recovery_engine" in engines
        assert "agent_engine" in engines
        assert "google_maps_scraper" in engines
        assert "communication_provider" in engines

        # Verify no secret leak in telemetry
        payload_str = str(data).lower()
        for sensitive in ["password", "bearer", "private_key", "secret_key"]:
            assert sensitive not in payload_str


def test_engine_health_db_failure_returns_503(test_client: TestClient):
    with patch("app.api.routes.health.check_db_connection", return_value=False):
        res = test_client.get("/health/engines")
        assert res.status_code == 503
        data = res.json()
        assert data["status"] == "UNAVAILABLE"
        assert data["engines"]["database"]["status"] == "UNAVAILABLE"
