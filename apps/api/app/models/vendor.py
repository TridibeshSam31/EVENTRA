"""SQLAlchemy Model: Vendor (Provider)"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, Integer, DateTime, Text, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False, index=True)
    category = Column(String(100), nullable=False, index=True)  # Controlled taxonomy (CATERING, DECOR, etc.)
    city = Column(String(100), nullable=False, index=True)
    address = Column(String(500), nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    contact_name = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    website = Column(String(500), nullable=True)
    maps_url = Column(String(1000), nullable=True)
    base_cost = Column(Float, nullable=True)
    rating = Column(Float, nullable=True)
    review_count = Column(Integer, nullable=True)
    service_description = Column(Text, nullable=True)
    status = Column(String(50), default="ACTIVE", nullable=False, index=True)  # ACTIVE, INACTIVE, UNAVAILABLE
    source = Column(String(50), default="INTERNAL", nullable=False, index=True)  # INTERNAL, GOOGLE_MAPS, EXTERNAL_DIRECTORY
    source_id = Column(String(1000), nullable=True, index=True)  # Google Maps CID / Place ID
    raw_category = Column(String(255), nullable=True)  # Raw unclassified category string from source
    capabilities = Column(JSON, default=list, nullable=True)  # Specific detected capabilities
    classification_confidence = Column(Float, nullable=True)  # Classifier confidence score
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    availabilities = relationship(
        "ProviderAvailability",
        back_populates="vendor",
        cascade="all, delete-orphan",
        lazy="select",
    )
    assignments = relationship(
        "VendorAssignment",
        back_populates="vendor",
        cascade="all, delete-orphan",
        lazy="select",
    )
