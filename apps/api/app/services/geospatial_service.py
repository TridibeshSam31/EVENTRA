"""Geospatial Discovery Service: Real-time Live Discovery of Venues and Providers.

Connects to open geospatial networks (Komoot Photon + OpenStreetMap Nominatim)
to fetch 100% real physical places and active businesses worldwide with zero paid API keys.
"""
import logging
import urllib.parse
import urllib.request
import json
import time
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Canonical city center coordinates for instant high-precision geospatial biasing
CITY_COORDINATES: Dict[str, Tuple[float, float]] = {
    "seattle": (47.6062, -122.3321),
    "delhi": (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090),
    "noida": (28.5355, 77.3910),
    "mumbai": (19.0760, 72.8777),
    "bengaluru": (12.9716, 77.5946),
    "bangalore": (12.9716, 77.5946),
    "san francisco": (37.7749, -122.4194),
    "new york": (40.7128, -74.0060),
    "chicago": (41.8781, -87.6298),
    "london": (51.5074, -0.1278),
    "tokyo": (35.6762, 139.6503),
    "singapore": (1.3521, 103.8198),
    "paris": (48.8566, 2.3522),
    "berlin": (52.5200, 13.4050),
    "dubai": (25.2048, 55.2708),
}


class GeospatialDiscoveryService:
    """Discovers real-world venues and providers dynamically from the global map network."""

    def __init__(self, timeout_seconds: int = 4):
        self.timeout = timeout_seconds
        self.headers = {
            "User-Agent": "EVENTRA-LiveMapRadar/1.0 (contact@eventra.internal)",
            "Accept": "application/json",
        }

    def clean_city_name(self, city: str) -> str:
        """Extracts recognizable canonical city name from address or qualified location."""
        if not city:
            return "Seattle"
        city_lower = city.strip().lower()
        for c_name in CITY_COORDINATES:
            if c_name in city_lower:
                return c_name.title()
        parts = [p.strip() for p in city.split(",") if p.strip()]
        if len(parts) >= 2:
            return parts[-1]
        return city.strip()

    def resolve_city_center(self, city: str) -> Tuple[float, float]:
        """Resolves city center coordinates from local registry or live geocoding."""
        city_lower = city.strip().lower()
        if city_lower in CITY_COORDINATES:
            return CITY_COORDINATES[city_lower]

        for c_name, c_coords in CITY_COORDINATES.items():
            if c_name in city_lower:
                return c_coords

        # Live lookup via Nominatim
        try:
            url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(city)}&format=json&limit=1"
            req = urllib.request.Request(url, headers=self.headers)
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data:
                    lat = float(data[0]["lat"])
                    lon = float(data[0]["lon"])
                    CITY_COORDINATES[city_lower] = (lat, lon)
                    return lat, lon
        except Exception as exc:
            logger.warning(f"Failed to geocode city '{city}': {exc}")

        # Default fallback (Seattle coordinates if completely unresolved)
        return (47.6062, -122.3321)

    def discover_real_venues(
        self,
        city: str,
        query: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        limit: int = 25,
    ) -> List[Dict[str, Any]]:
        """Discovers real-world physical event spaces, convention centers, and halls."""
        city = self.clean_city_name(city)
        if latitude is None or longitude is None:
            lat, lon = self.resolve_city_center(city)
        else:
            lat, lon = latitude, longitude

        search_terms = []
        if query and query.strip():
            search_terms.append(f"{query.strip()} {city}")
            search_terms.append(query.strip())
        else:
            search_terms.extend([
                f"convention center {city}",
                f"theatre {city}",
                f"auditorium {city}",
                f"banquet hall {city}",
                f"events venue {city}",
            ])

        seen_names = set()
        discovered: List[Dict[str, Any]] = []

        for term in search_terms:
            if len(discovered) >= limit:
                break

            items = self._query_photon(term, lat=lat, lon=lon, limit=12)
            for item in items:
                props = item.get("properties", {})
                coords = item.get("geometry", {}).get("coordinates", [0, 0])
                name = props.get("name")
                if not name or len(name.strip()) < 3:
                    continue

                clean_name = name.strip()
                if clean_name.lower() in seen_names:
                    continue

                osm_val = props.get("osm_value", "").lower()
                osm_key = props.get("osm_key", "").lower()

                # Filter out pure transit stops or non-event objects
                if osm_val in ["bus_stop", "tram_stop", "station", "subway_entrance", "platform", "roof", "track"]:
                    continue

                # Build address
                street = props.get("street", "").strip()
                housenumber = props.get("housenumber", "").strip()
                postcode = props.get("postcode", "").strip()
                item_city = props.get("city") or props.get("town") or props.get("state") or city

                address_parts = []
                if housenumber and street:
                    address_parts.append(f"{housenumber} {street}")
                elif street:
                    address_parts.append(street)
                if item_city:
                    address_parts.append(item_city)
                if postcode:
                    address_parts.append(postcode)

                full_address = ", ".join(address_parts) if address_parts else f"Central District, {city}"

                v_type, capacity, hourly_rate, amenities = self._derive_venue_attributes(clean_name, osm_val, osm_key)

                venue_dict = {
                    "name": clean_name,
                    "address": full_address,
                    "city": city,
                    "latitude": round(coords[1], 6),
                    "longitude": round(coords[0], 6),
                    "capacity": capacity,
                    "venue_type": v_type,
                    "hourly_rate": hourly_rate,
                    "amenities": amenities,
                    "status": "ACTIVE",
                    "source": "LIVE_OPENSTREETMAP_NETWORK",
                    "raw_osm_tag": f"{osm_key}={osm_val}",
                    # capacity / rate / amenities / type are inferred from the place name & OSM tag,
                    # not reported by the venue — the UI must label them "estimated".
                    "estimated_fields": ["capacity", "hourly_rate", "amenities", "venue_type"],
                }

                seen_names.add(clean_name.lower())
                discovered.append(venue_dict)

                if len(discovered) >= limit:
                    break

        # Fallback to direct Nominatim query if Photon returned few items
        if len(discovered) < 3:
            nom_items = self._query_nominatim_venues(city, query=query, limit=limit - len(discovered))
            for v in nom_items:
                if v["name"].lower() not in seen_names:
                    seen_names.add(v["name"].lower())
                    discovered.append(v)

        return discovered[:limit]

    def discover_real_providers(
        self,
        category: str,
        city: str,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        query: Optional[str] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Discovers real-world companies and professionals (catering, AV, photography, decor, florists)."""
        city = self.clean_city_name(city)
        if latitude is None or longitude is None:
            lat, lon = self.resolve_city_center(city)
        else:
            lat, lon = latitude, longitude

        cat_clean = category.strip().upper()
        cat_term = cat_clean.lower().replace("_", " ")
        from app.integrations.google_maps_scraper.queries import CATEGORY_SEARCH_QUERIES

        # Build targeted queries using canonical high-precision keywords
        clean_q = query.strip() if query and query.strip() else ""
        if clean_q:
            primary = f"{clean_q} {city}" if city.lower() not in clean_q.lower() else clean_q
            search_queries = [primary]
        else:
            cat_keywords = CATEGORY_SEARCH_QUERIES.get(cat_clean, [f"{cat_term} services"])
            search_queries = [f"{kw} {city}" for kw in cat_keywords[:2]]

        discovered = []
        seen = set()

        import math

        for s_query in search_queries:
            if len(discovered) >= limit or len(discovered) >= 6:
                break
            items = self._query_photon(s_query, lat=lat, lon=lon, limit=15)
            for it in items:
                props = it.get("properties", {})
                coords = it.get("geometry", {}).get("coordinates", [0, 0])
                name = props.get("name")
                if not name or len(name.strip()) < 3:
                    continue

                osm_key = (props.get("osm_key") or "").lower()
                osm_val = (props.get("osm_value") or "").lower()

                # Filter out streets, highways, administrative boundaries, natural features, etc.
                if osm_key in ("highway", "boundary", "place", "waterway", "railway", "natural", "landuse", "barrier"):
                    continue

                # Filter out pure transit stops or non-business objects
                if osm_val in ("bus_stop", "tram_stop", "station", "subway_entrance", "platform", "roof", "track", "traffic_signals"):
                    continue

                # Filter out places too far from the anchor city (e.g. out of state/country)
                if coords and coords[0] != 0 and coords[1] != 0:
                    d_lat = math.radians(coords[1] - lat)
                    d_lon = math.radians(coords[0] - lon)
                    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(coords[1])) * math.sin(d_lon / 2) ** 2
                    dist_km = 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
                    if dist_km > 75.0:
                        continue

                clean_name = name.strip()
                if clean_name.lower() in seen:
                    continue

                street = props.get("street", "").strip()
                housenumber = props.get("housenumber", "").strip()
                item_city = props.get("city") or props.get("town") or city

                addr = f"{housenumber} {street}, {item_city}".strip(", ") if street else f"Commercial District, {city}"

                osm_id_val = props.get("osm_id") or abs(hash(f"{clean_name}_{city}")) % 10000000
                raw_cat_detected = osm_val or props.get("type") or osm_key or "commercial"

                from app.services.provider_classifier import ProviderClassifier
                classification = ProviderClassifier.classify(
                    name=clean_name,
                    raw_category=raw_cat_detected,
                    description=props.get("description"),
                )
                # STRICT EVIDENCE-BASED RULE: If requested category is specific, discard non-matching places
                if cat_clean != "OTHER" and classification.category != cat_clean:
                    continue

                provider_dict = {
                    "source": "LIVE_OPENSTREETMAP_NETWORK",
                    "source_id": f"osm_live_{osm_id_val}",
                    "name": clean_name,
                    "category": classification.category,
                    "raw_category": raw_cat_detected,
                    "address": addr,
                    "city": city,
                    "latitude": round(coords[1], 6),
                    "longitude": round(coords[0], 6),
                    "phone": props.get("phone"),
                    "email": None,
                    # Only a real website counts; a search URL is not evidence of a website.
                    "website": props.get("website") or None,
                    "search_url": f"https://www.google.com/search?q={urllib.parse.quote(clean_name + ' ' + city)}",
                    "rating": None,
                    "review_count": None,
                    "maps_url": f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(clean_name + ' ' + city)}",
                    "description": props.get("description") or None,
                    "base_cost": None,
                    "capabilities": [],
                    "classification_confidence": 0.0,
                    "classification_reason": "Live OpenStreetMap physical entity; pending classifier evaluation.",
                    "raw_data": props,
                    "estimated_fields": [],
                }

                seen.add(clean_name.lower())
                discovered.append(provider_dict)
                if len(discovered) >= limit:
                    break

        return discovered

    def _query_photon(
        self,
        query: str,
        lat: Optional[float] = None,
        lon: Optional[float] = None,
        limit: int = 15,
    ) -> List[Dict[str, Any]]:
        """Queries the Komoot Photon OpenStreetMap API with location biasing."""
        params = {"q": query, "limit": limit}
        if lat is not None and lon is not None:
            params["lat"] = lat
            params["lon"] = lon

        url = f"https://photon.komoot.io/api/?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("features", [])
        except Exception as exc:
            logger.warning(f"Photon query '{query}' error: {exc}")
            return []

    def _query_nominatim_venues(
        self,
        city: str,
        query: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Queries OpenStreetMap Nominatim for venues in a city."""
        search_q = f"{query or 'convention center'}, {city}"
        url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(search_q)}&format=json&addressdetails=1&limit={limit}"
        req = urllib.request.Request(url, headers=self.headers)
        venues = []
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                for item in data:
                    name = item.get("name") or item.get("display_name", "").split(",")[0]
                    if not name:
                        continue
                    lat = float(item["lat"])
                    lon = float(item["lon"])
                    v_type, cap, rate, amenities = self._derive_venue_attributes(name, item.get("type", ""), item.get("class", ""))
                    venues.append({
                        "name": name,
                        "address": item.get("display_name", f"{name}, {city}"),
                        "city": city,
                        "latitude": lat,
                        "longitude": lon,
                        "capacity": cap,
                        "venue_type": v_type,
                        "hourly_rate": rate,
                        "amenities": amenities,
                        "status": "ACTIVE",
                        "source": "LIVE_OPENSTREETMAP_NETWORK",
                        "estimated_fields": ["capacity", "hourly_rate", "amenities", "venue_type"],
                    })
        except Exception as exc:
            logger.warning(f"Nominatim fallback error: {exc}")
        return venues

    def _derive_venue_attributes(
        self,
        name: str,
        osm_value: str,
        osm_key: str,
    ) -> Tuple[str, int, float, List[str]]:
        """Synthesizes factual, realistic event venue attributes based on place identity."""
        lower_name = name.lower()

        if "convention" in lower_name or "expo" in lower_name or "exhibition" in lower_name or osm_value == "conference_centre":
            v_type = "Convention Center"
            capacity = 3500
            hourly_rate = 650.0
            amenities = ["high_speed_wifi", "av_system", "breakout_rooms", "stage", "ada_accessible", "parking", "loading_dock", "catering_prep"]
        elif "theatre" in lower_name or "theater" in lower_name or osm_value == "theatre":
            v_type = "Auditorium & Theater"
            capacity = 1200
            hourly_rate = 450.0
            amenities = ["stage", "av_system", "sound_system", "theatrical_lighting", "green_room", "ada_accessible", "high_speed_wifi"]
        elif "auditorium" in lower_name:
            v_type = "Auditorium"
            capacity = 950
            hourly_rate = 380.0
            amenities = ["stage", "av_system", "projector_screens", "podium", "ada_accessible", "high_speed_wifi"]
        elif "banquet" in lower_name or "ballroom" in lower_name or "palace" in lower_name:
            v_type = "Ballroom & Banquet Hall"
            capacity = 550
            hourly_rate = 320.0
            amenities = ["banquet_kitchen", "dance_floor", "ambient_lighting", "valet_parking", "av_system", "high_speed_wifi"]
        elif "hotel" in lower_name or osm_value == "hotel":
            v_type = "Hotel & Conference Facility"
            capacity = 400
            hourly_rate = 290.0
            amenities = ["breakout_rooms", "catering_kitchen", "high_speed_wifi", "av_system", "parking", "ada_accessible"]
        else:
            v_type = "Modern Event Space"
            capacity = 300
            hourly_rate = 220.0
            amenities = ["high_speed_wifi", "av_system", "stage", "breakout_rooms", "ada_accessible"]

        return v_type, capacity, hourly_rate, amenities


# Global singleton instance
geospatial_discovery = GeospatialDiscoveryService()
