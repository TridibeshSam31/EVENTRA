"""Centralized JSON Serialization Utilities for EVENTRA API Boundary.

Provides a single, reusable JSON encoder that safely handles all Python types
commonly found in SQLAlchemy models and Pydantic schemas: datetime, date, time,
UUID, Decimal, Enum, bytes, sets, and Pydantic BaseModel instances.

Usage:
    from app.core.serialization import eventra_json_dumps

    payload = {"timestamp": datetime.now(), "id": uuid4(), "status": SomeEnum.ACTIVE}
    json_string = eventra_json_dumps(payload)

This encoder is used at the SSE/API serialization boundary. It does NOT change
how values are stored in the database — only how they are serialized to JSON
when leaving the backend.
"""
import json
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class EventraJSONEncoder(json.JSONEncoder):
    """JSON encoder that handles all common Python types in the EVENTRA backend.

    Converts:
        datetime  → ISO 8601 string (e.g. "2026-12-15T10:00:00")
        date      → ISO 8601 date string (e.g. "2026-12-15")
        time      → ISO 8601 time string (e.g. "10:00:00")
        UUID      → string representation
        Decimal   → float
        Enum      → enum value
        set       → sorted list
        bytes     → UTF-8 string (with fallback to repr)
        BaseModel → dict via model_dump(mode="json")
    """

    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, date):
            return obj.isoformat()
        if isinstance(obj, time):
            return obj.isoformat()
        if isinstance(obj, UUID):
            return str(obj)
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, Enum):
            return obj.value
        if isinstance(obj, set):
            return sorted(obj)
        if isinstance(obj, bytes):
            try:
                return obj.decode("utf-8")
            except UnicodeDecodeError:
                return repr(obj)
        if isinstance(obj, BaseModel):
            return obj.model_dump(mode="json")
        return super().default(obj)


def eventra_json_dumps(obj, **kwargs) -> str:
    """Serialize ``obj`` to a JSON string using EventraJSONEncoder.

    Drop-in replacement for ``json.dumps()`` that safely handles
    datetime, UUID, Decimal, Enum, and other backend types.
    """
    return json.dumps(obj, cls=EventraJSONEncoder, **kwargs)
