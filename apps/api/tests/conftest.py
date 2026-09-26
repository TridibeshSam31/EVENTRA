"""Pytest Configuration and Shared Test Fixtures"""
import os
import sys
from pathlib import Path
from typing import Generator
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

# Ensure apps/api and workspace root are on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

# Ensure test environment
os.environ["ENVIRONMENT"] = "test"
os.environ["LLM_PROVIDER"] = "mock"
os.environ["COMMUNICATION_PROVIDER"] = "mock"
os.environ["EXOTEL_ENABLED"] = "false"
os.environ["OPENWA_ENABLED"] = "false"
os.environ.setdefault("EXOTEL_STREAM_URL", "wss://test.stream.eventra.ai/stream")

from app.main import app
from app.core.config import settings
settings.LLM_PROVIDER = "mock"
settings.COMMUNICATION_PROVIDER = "mock"
settings.EXOTEL_ENABLED = False
settings.OPENWA_ENABLED = False
if not settings.EXOTEL_STREAM_URL:
    settings.EXOTEL_STREAM_URL = "wss://test.stream.eventra.ai/stream"
settings.GEMINI_LIVE_MODEL = "gemini-3.8-live"

from app.integrations.registry import registry
registry._communication_provider = None
from app.db.base import Base
from app.db.session import get_db
from app.api.dependencies import get_db_session
import app.models as _models  # noqa: F401


# In-memory SQLite for deterministic, isolated fast testing without external services
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    """TestClient fixture for making simulated HTTP calls to the FastAPI app."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="function")
def db_session() -> Generator[Session, None, None]:
    """Provides a fresh isolated database session with created tables for each test function."""
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(scope="function")
def test_client(db_session: Session) -> Generator[TestClient, None, None]:
    """TestClient with dependency overrides configured to the isolated test database."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_db_session] = override_get_db
    with TestClient(app) as tc:
        yield tc
    app.dependency_overrides.clear()
