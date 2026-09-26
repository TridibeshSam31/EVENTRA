"""HTTP Client for Google Maps Scraper Kit (gosom/google-maps-scraper API).

Handles job creation, polling, result download, and error recovery.
Enforces strict timeouts and never crashes caller on external network failures.
"""
import csv
import io
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
import httpx

from app.core.config import settings
from app.integrations.google_maps_scraper.models import (
    RawScraperBusiness,
)

logger = logging.getLogger(__name__)


class GoogleMapsScraperClient:
    """Communicates with the local or containerized Google Maps Scraper API."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
    ):
        self.base_url = (base_url or settings.GOOGLE_MAPS_SCRAPER_URL).rstrip("/")
        self.timeout_seconds = timeout_seconds or settings.GOOGLE_MAPS_SCRAPER_TIMEOUT

    def is_available(self) -> bool:
        """Checks if the scraper API service is alive and reachable."""
        try:
            with httpx.Client(timeout=0.3) as client:
                resp = client.get(f"{self.base_url}/api/v1/jobs")
                return resp.status_code == 200
        except Exception:
            return False

    def create_job(
        self,
        keywords: List[str],
        lat: float,
        lon: float,
        radius_meters: Optional[int] = None,
        depth: int = 5,
        max_time: int = 60,
    ) -> Optional[str]:
        """Submits a new scraping job to the scraper API with configurable radius."""
        radius_val = radius_meters if radius_meters and radius_meters > 0 else 10000
        payload = {
            "name": "eventra-provider-discovery",
            "keywords": keywords,
            "lang": "en",
            "zoom": 15,
            "lat": str(lat),
            "lon": str(lon),
            "fast_mode": False,
            "radius": radius_val,
            "depth": min(depth, settings.GOOGLE_MAPS_SCRAPER_MAX_DEPTH),
            "email": False,
            "max_time": max_time,
        }
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(f"{self.base_url}/api/v1/jobs", json=payload)
                if resp.status_code in (200, 201):
                    data = resp.json()
                    return data.get("id")
                logger.warning(f"Scraper job creation failed: HTTP {resp.status_code} - {resp.text[:200]}")
                return None
        except Exception as exc:
            logger.warning(f"Scraper job creation connection error: {exc}")
            return None

    def poll_job(
        self,
        job_id: str,
        timeout_seconds: int = 40,
        interval_seconds: float = 3.0,
    ) -> bool:
        """Polls the scraper job until completion or timeout."""
        import time

        start_time = time.time()
        while time.time() - start_time < timeout_seconds:
            try:
                with httpx.Client(timeout=5.0) as client:
                    resp = client.get(f"{self.base_url}/api/v1/jobs/{job_id}")
                    if resp.status_code == 200:
                        data = resp.json()
                        raw_status = str(data.get("Status") or data.get("status") or "").lower()
                        if raw_status == "ok":
                            return True
                        if raw_status in ("failed", "error"):
                            logger.warning(f"Scraper job {job_id} reported failed status.")
                            return False
                    time.sleep(interval_seconds)
            except Exception as exc:
                logger.warning(f"Error while polling job {job_id}: {exc}")
                time.sleep(interval_seconds)

        logger.warning(f"Scraper job {job_id} timed out after {timeout_seconds} seconds.")
        return False

    def download_results(self, job_id: str) -> List[Dict[str, Any]]:
        """Downloads and parses completed scraping results for the given job."""
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(f"{self.base_url}/api/v1/jobs/{job_id}/download")
                if resp.status_code != 200:
                    logger.warning(f"Failed to download job {job_id} results: HTTP {resp.status_code}")
                    return []

                content_type = resp.headers.get("content-type", "")
                text = resp.text

                # Attempt JSON parsing first if returned as JSON
                if "application/json" in content_type or text.strip().startswith(("[", "{")):
                    try:
                        parsed = json.loads(text)
                        if isinstance(parsed, list):
                            return parsed
                        elif isinstance(parsed, dict) and "data" in parsed:
                            return parsed["data"]
                    except Exception:
                        pass

                # Parse CSV format
                f = io.StringIO(text)
                reader = csv.DictReader(f)
                return [row for row in reader if row]
        except Exception as exc:
            logger.warning(f"Failed downloading scraper results for job {job_id}: {exc}")
            return []

    def scrape(
        self,
        keywords: List[str],
        lat: float,
        lon: float,
        radius_meters: Optional[int] = None,
        depth: int = 5,
    ) -> List[RawScraperBusiness]:
        """High-level orchestration: submit job -> poll -> download -> return raw records."""
        job_id = self.create_job(
            keywords=keywords,
            lat=lat,
            lon=lon,
            radius_meters=radius_meters,
            depth=depth,
        )
        if not job_id:
            return []

        success = self.poll_job(job_id=job_id, timeout_seconds=self.timeout_seconds)
        if not success:
            return []

        raw_rows = self.download_results(job_id)
        results: List[RawScraperBusiness] = []
        for row in raw_rows:
            results.append(
                RawScraperBusiness(
                    title=row.get("title") or row.get("name"),
                    name=row.get("name") or row.get("title"),
                    category=row.get("category"),
                    address=row.get("address"),
                    phone=row.get("phone"),
                    emails=row.get("emails") or row.get("email"),
                    email=row.get("email") or row.get("emails"),
                    website=row.get("website"),
                    review_rating=float(row["review_rating"]) if row.get("review_rating") else None,
                    rating=float(row["rating"]) if row.get("rating") else None,
                    review_count=int(row["review_count"]) if row.get("review_count") else None,
                    latitude=float(row["latitude"]) if row.get("latitude") else None,
                    longitude=float(row["longitude"]) if row.get("longitude") else None,
                    lat=float(row["lat"]) if row.get("lat") else None,
                    lon=float(row["lon"]) if row.get("lon") else None,
                    link=row.get("link") or row.get("maps_url"),
                    cid=row.get("cid"),
                    place_id=row.get("place_id"),
                    description=row.get("description"),
                    raw_data=row,
                )
            )
        return results
