"""EVENTRA FastAPI Application Entrypoint"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.logging import setup_logging, logger
from app.core.exceptions import register_exception_handlers
from app.api.routes.health import router as health_router
from app.api.routes.events import router as events_router
from app.api.routes.venues import router as venues_router
from app.api.routes.vendors import router as vendors_router
from app.api.routes.planning import router as planning_router
from app.api.routes.schedule import router as schedule_router
from app.api.routes.budget import router as budget_router
from app.api.routes.live import router as live_router
from app.api.routes.incidents import router as incidents_router
from app.api.routes.recovery import router as recovery_router
from app.api.routes.approvals import router as approvals_router
from app.api.routes.actions import router as actions_router
from app.api.routes.verification import router as verification_router
from app.api.routes.observability import router as observability_router
from app.api.routes.agent import router as agent_router
from app.api.routes.integrations import router as integrations_router
from app.api.routes.intake import router as intake_router
from app.api.routes.voice import router as voice_router

# Initialize application logging
setup_logging()


def log_startup_adapter_status():
    """Loudly inspects and logs the resolution mode (Real vs Mock) for all integration adapters."""
    from app.integrations.registry import registry
    from app.integrations.communication.mock import MockCommunicationProvider
    from app.integrations.communication.exotel import ExotelVoiceAdapter
    from app.integrations.whatsapp.client import OpenWACommunicationAdapter
    from app.integrations.maps.mock import MockMapsProvider
    from app.integrations.notifications.providers import MockNotificationProvider

    comm = registry.get_communication_provider()
    maps = registry.get_maps_provider()
    notif = registry.get_notification_provider()
    scraper = registry.get_google_maps_scraper()
    llm = registry.get_llm_provider()

    comm_is_mock = isinstance(comm, MockCommunicationProvider)
    comm_name = comm.__class__.__name__
    if isinstance(comm, OpenWACommunicationAdapter):
        comm_detail = f"REAL (OpenWA WhatsApp @ {comm.base_url})" if settings.OPENWA_ENABLED else "FALLBACK TO MOCK (OPENWA_ENABLED=false)"
        if not settings.OPENWA_ENABLED:
            comm_is_mock = True
    elif isinstance(comm, ExotelVoiceAdapter):
        comm_detail = f"REAL (Exotel Voice @ {comm.stream_url or 'NO_STREAM_URL'})" if settings.EXOTEL_ENABLED else "FALLBACK TO MOCK (EXOTEL_ENABLED=false)"
        if not settings.EXOTEL_ENABLED:
            comm_is_mock = True
    else:
        comm_detail = "MOCK / NO-OP (Simulation Only)"
        comm_is_mock = True

    maps_name = maps.__class__.__name__
    maps_detail = "MOCK" if isinstance(maps, MockMapsProvider) else "REAL"

    notif_name = notif.__class__.__name__
    notif_detail = "MOCK" if isinstance(notif, MockNotificationProvider) else ("REAL (Webhook)" if "Webhook" in notif_name else "IN_APP")

    try:
        scraper_avail = scraper.client.is_available()
    except Exception:
        scraper_avail = False
    scraper_status = "REAL (Container available)" if scraper_avail else "MOCK / OSM NETWORK FALLBACK"

    llm_name = llm.__class__.__name__
    llm_detail = "REAL" if getattr(llm, "is_mock", False) is False and (settings.LLM_API_KEY or settings.GEMINI_API_KEY) else "MOCK"

    banner_lines = [
        "=" * 80,
        "                    EVENTRA INTEGRATION ADAPTER RESOLUTION",
        "=" * 80,
        f"  * Communication Provider : {comm_name} [{comm_detail}]",
        f"  * Maps Provider          : {maps_name} [{maps_detail}]",
        f"  * Notification Provider  : {notif_name} [{notif_detail}]",
        f"  * Google Maps Scraper    : {scraper.__class__.__name__} [{scraper_status}]",
        f"  * LLM Provider           : {llm_name} [{llm_detail}]",
        "=" * 80,
    ]

    if comm_is_mock:
        warning_lines = [
            "!" * 80,
            "⚠️  CRITICAL WARNING: VENDOR COMMUNICATION PROVIDER IS IN MOCK MODE!",
            "    Outbound vendor contact (WhatsApp messages / phone calls) WILL NOT REACH",
            "    real vendors. All dispatch calls will silently succeed in local memory.",
            "    To contact real vendors:",
            "      - WhatsApp: set COMMUNICATION_PROVIDER=openwa and OPENWA_ENABLED=true in .env",
            "      - Telephony: set COMMUNICATION_PROVIDER=exotel, EXOTEL_ENABLED=true, and",
            "        EXOTEL_STREAM_URL=wss://<tunnel-domain>/api/v1/voice/exotel/stream in .env",
            "!" * 80,
        ]
        for w in warning_lines:
            logger.warning(w)
            print(w)

    for line in banner_lines:
        logger.info(line)
        print(line)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager for startup and shutdown hooks."""
    logger.info(
        "EVENTRA API starting up in %s environment (host=%s, port=%d)",
        settings.ENVIRONMENT,
        settings.API_HOST,
        settings.API_PORT,
    )
    log_startup_adapter_status()
    yield
    logger.info("EVENTRA API shutting down.")


# Create FastAPI application instance
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Deterministic calculation engines and AI orchestration for live event operations.",
    version="0.1.0",
    docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
    lifespan=lifespan,
)

# Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Global Exception Handlers
register_exception_handlers(app)

# Mount Health Routes
app.include_router(health_router)

# Mount Phase 1 Events Routes
app.include_router(events_router, prefix=settings.API_V1_STR)

# Mount Phase 3 Venue and Provider Network Routes
app.include_router(venues_router, prefix=settings.API_V1_STR)
app.include_router(venues_router, prefix="/api/v1")
app.include_router(venues_router)
app.include_router(vendors_router, prefix=settings.API_V1_STR)

# Mount Phase 4 Planning Routes
app.include_router(planning_router, prefix=settings.API_V1_STR)

# Mount Phase 5 Schedule and Budget Routes
app.include_router(schedule_router, prefix=settings.API_V1_STR)
app.include_router(budget_router, prefix=settings.API_V1_STR)

# Mount Phase 6 Live State Routes
app.include_router(live_router, prefix=settings.API_V1_STR)

# Mount Phase 7 Incident, Impact, and Risk Routes
app.include_router(incidents_router, prefix=settings.API_V1_STR)

# Phase 8 returns calculated options only; it has no execution endpoint.
app.include_router(recovery_router, prefix=settings.API_V1_STR)

# Phase 9: Approvals and Operational Action Execution
app.include_router(approvals_router, prefix=settings.API_V1_STR)
app.include_router(actions_router, prefix=settings.API_V1_STR)

# Phase 10: Verification and Observability (Audit, Activity, Decision Trace, State History)
app.include_router(verification_router, prefix=settings.API_V1_STR)
app.include_router(observability_router, prefix=settings.API_V1_STR)

# Phase 11: Single Event Operations Agent (LangGraph) & Agent Tool Layer
app.include_router(agent_router, prefix=settings.API_V1_STR)
app.include_router(agent_router)

# Phase 12: Real-World Integrations Layer (Maps, Notifications, Provider Communication)
app.include_router(integrations_router, prefix=settings.API_V1_STR)

# Conversational Intake & Autonomous Operations Execution
app.include_router(intake_router, prefix=settings.API_V1_STR)

# Exotel Connect Voice AI & AgentStream WebSocket Layer
app.include_router(voice_router, prefix="/api/v1")
app.include_router(voice_router)


