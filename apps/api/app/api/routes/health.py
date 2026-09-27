"""Health Check Endpoints"""
from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.db.session import check_db_connection

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", summary="API Process Health")
def get_health():
    """Returns basic process status confirming the API service is alive and listening."""
    return {
        "status": "healthy",
        "service": "eventra-api",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0",
    }


@router.get("/db", summary="PostgreSQL Connectivity Health")
def get_db_health():
    """Performs an authentic database ping.

    Returns HTTP 200 if PostgreSQL connection succeeds.
    Returns HTTP 503 if PostgreSQL is unreachable or failing.
    """
    is_connected = check_db_connection()

    if is_connected:
        return {
            "status": "healthy",
            "database": "connected",
            "engine": "postgresql",
        }

    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "unhealthy",
            "database": "disconnected",
            "message": "Unable to establish connection to PostgreSQL.",
        },
    )


@router.get("/engines", summary="Dedicated Backend Engine Health & Status Telemetry (B9)")
def get_engines_health():
    """Truthfully reports the operational health of all backend engines and integrations (B9).
    
    Distinguishes HEALTHY, DEGRADED, UNAVAILABLE without exposing secrets.
    Returns HTTP 503 if core engines fail; HTTP 200 for healthy or degraded optional integrations.
    """
    from datetime import datetime, timezone
    from app.agent.tools.registry import get_agent_tool_registry
    from app.integrations.registry import registry
    from app.engines.dependency.traversal import CriticalPathCalculator
    from app.engines.impact.propagation import ImpactPropagation
    from app.engines.recovery.generator import RecoveryGenerator
    from app.engines.state.event_state import EventStateMachine

    now_iso = datetime.now(timezone.utc).isoformat()
    engines_status = {}
    is_unhealthy = False
    is_degraded = False

    # 1. Database
    db_ok = check_db_connection()
    if db_ok:
        engines_status["database"] = {"status": "HEALTHY", "detail": "PostgreSQL operational"}
    else:
        engines_status["database"] = {"status": "UNAVAILABLE", "detail": "PostgreSQL unreachable"}
        is_unhealthy = True

    # 2. Core Deterministic Engines
    try:
        _ = EventStateMachine()
        engines_status["planning_engine"] = {"status": "HEALTHY", "detail": "State machine operational"}
    except Exception as exc:
        engines_status["planning_engine"] = {"status": "UNAVAILABLE", "detail": f"Engine error: {exc}"}
        is_unhealthy = True

    try:
        _ = CriticalPathCalculator()
        engines_status["dependency_engine"] = {"status": "HEALTHY", "detail": "CPM DAG engine operational"}
    except Exception as exc:
        engines_status["dependency_engine"] = {"status": "UNAVAILABLE", "detail": f"Engine error: {exc}"}
        is_unhealthy = True

    try:
        _ = ImpactPropagation()
        engines_status["impact_engine"] = {"status": "HEALTHY", "detail": "Blast radius propagation operational"}
    except Exception as exc:
        engines_status["impact_engine"] = {"status": "UNAVAILABLE", "detail": f"Engine error: {exc}"}
        is_unhealthy = True

    try:
        _ = RecoveryGenerator()
        engines_status["recovery_engine"] = {"status": "HEALTHY", "detail": "Recovery candidate generator operational"}
    except Exception as exc:
        engines_status["recovery_engine"] = {"status": "UNAVAILABLE", "detail": f"Engine error: {exc}"}
        is_unhealthy = True

    # 3. Agent & Tool Layer
    try:
        tool_count = len(get_agent_tool_registry().list_tools(available_only=True))
        engines_status["agent_engine"] = {
            "status": "HEALTHY",
            "detail": f"Operations agent ready with {tool_count} active tools",
        }
    except Exception as exc:
        engines_status["agent_engine"] = {"status": "DEGRADED", "detail": f"Tool registry error: {exc}"}
        is_degraded = True

    # 4. Google Maps Scraper Integration
    try:
        scraper_avail = registry.google_maps_scraper.client.is_available()
        if scraper_avail:
            engines_status["google_maps_scraper"] = {"status": "HEALTHY", "detail": "Live scraper reachable"}
        else:
            engines_status["google_maps_scraper"] = {
                "status": "DEGRADED",
                "detail": "Scraper offline; using OSM network fallback",
            }
            is_degraded = True
    except Exception as exc:
        engines_status["google_maps_scraper"] = {
            "status": "DEGRADED",
            "detail": f"Scraper fallback active ({exc})",
        }
        is_degraded = True

    # 5. Communication Integration
    try:
        comm = registry.communication_provider
        comm_name = comm.__class__.__name__
        if "Twilio" in comm_name and getattr(settings, "TWILIO_ENABLED", False):
            engines_status["communication_provider"] = {"status": "HEALTHY", "detail": f"Active ({comm_name})"}
        elif "Exotel" in comm_name and getattr(settings, "EXOTEL_ENABLED", False):
            engines_status["communication_provider"] = {"status": "HEALTHY", "detail": f"Active ({comm_name})"}
        elif "OpenWA" in comm_name and getattr(settings, "OPENWA_ENABLED", False):
            engines_status["communication_provider"] = {"status": "HEALTHY", "detail": f"Active ({comm_name})"}
        else:
            engines_status["communication_provider"] = {
                "status": "DEGRADED",
                "detail": f"Simulated / mock communication active ({comm_name})",
            }
            is_degraded = True
    except Exception as exc:
        engines_status["communication_provider"] = {
            "status": "DEGRADED",
            "detail": f"Communication provider in degraded state ({exc})",
        }
        is_degraded = True

    overall_status = "UNAVAILABLE" if is_unhealthy else ("DEGRADED" if is_degraded else "HEALTHY")
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE if is_unhealthy else status.HTTP_200_OK

    return JSONResponse(
        status_code=status_code,
        content={
            "status": overall_status,
            "timestamp": now_iso,
            "service": "eventra-api",
            "environment": settings.ENVIRONMENT,
            "engines": engines_status,
        },
    )
