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

# Initialize application logging
setup_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager for startup and shutdown hooks."""
    logger.info(
        "EVENTRA API starting up in %s environment (host=%s, port=%d)",
        settings.ENVIRONMENT,
        settings.API_HOST,
        settings.API_PORT,
    )
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


