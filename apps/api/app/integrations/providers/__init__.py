"""Providers integration package.

Note: Vendor/provider discovery is driven by GoogleMapsScraperAdapter (apps/api/app/integrations/google_maps_scraper/adapter.py)
via VendorService, supporting real-world OpenStreetMap Overpass queries and Apify Google Maps scraping.
"""
from app.integrations.base import ProviderDirectoryProvider

__all__ = ["ProviderDirectoryProvider"]
