"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DiscoveryMapEntity } from "../../types/api";
import {
  Layers,
  MapPin,
  Navigation,
  Maximize2,
  Clock,
  ExternalLink,
  Phone,
  Check,
  Plus,
  ChevronDown,
  X,
} from "lucide-react";

interface DiscoveryMapProps {
  places: DiscoveryMapEntity[];
  selectedPlace: DiscoveryMapEntity | null;
  onSelectPlace: (place: DiscoveryMapEntity) => void;
  anchorCoordinates?: [number, number] | null;
  anchorLabel?: string | null;
  eventCity?: string;
  className?: string;
  onAssignToEvent?: (place: DiscoveryMapEntity) => void;
  onCheckAvailability?: (venueId: string) => void;
  onCheckSuitability?: (venueId: string) => void;
  onBindVenue?: (venue: DiscoveryMapEntity) => void;
  /** id of the place to highlight (e.g. the list card under the cursor) */
  highlightedId?: string | null;
  /** called when the cursor enters/leaves a pin, so the list can highlight its card */
  onHoverPlace?: (place: DiscoveryMapEntity | null) => void;
  /** short pin labels by place id — e.g. the card's list number, so list and map match */
  labels?: Record<string, string>;
}

/**
 * Pins that share (almost) the same coordinates would sit exactly on top of each
 * other. Fan them out in a small ring (in screen pixels) so each stays clickable.
 * Coordinates are never changed — only the icon's anchor is offset.
 */
function computeOffsets(places: DiscoveryMapEntity[]): Record<string, [number, number]> {
  const groups: Record<string, string[]> = {};
  for (const p of places) {
    const key = `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`;
    (groups[key] ||= []).push(p.id);
  }
  const out: Record<string, [number, number]> = {};
  for (const ids of Object.values(groups)) {
    if (ids.length === 1) {
      out[ids[0]] = [0, 0];
      continue;
    }
    const r = 14 + ids.length * 2;
    ids.forEach((id, i) => {
      const a = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
      out[id] = [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
    });
  }
  return out;
}

type MapLayerType = "dark" | "streets" | "satellite";

const LAYER_CONFIGS: Record<MapLayerType, { url: string; attribution: string; name: string }> = {
  streets: {
    name: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    name: "Dark",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin, OpenStreetMap",
  },
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, Maxar, Earthstar Geographics",
  },
};

const CITY_COORDINATES: Record<string, [number, number]> = {
  seattle: [47.6062, -122.3321],
  mumbai: [19.076, 72.8777],
  delhi: [28.6139, 77.209],
  bengaluru: [12.9716, 77.5946],
  boston: [42.3601, -71.0589],
};

// One short label + a category colour (the dot inside the pin). The pin body
// itself is always ink so the map reads as one system.
function getCategoryBadgeConfig(category: string, entityType: string) {
  const cat = (category || "").toUpperCase();
  if (entityType === "VENUE") return { label: "Venue", dotClass: "bg-engine-400" };
  switch (cat) {
    case "PHOTOGRAPHY":
      return { label: "Photo", dotClass: "bg-agent-400" };
    case "VIDEOGRAPHY":
      return { label: "Video", dotClass: "bg-agent-300" };
    case "CATERING":
      return { label: "Catering", dotClass: "bg-go-400" };
    case "AV_TECH":
      return { label: "AV", dotClass: "bg-info-400" };
    case "DECOR":
    case "FLORIST":
      return { label: "Décor", dotClass: "bg-cue-400" };
    case "DJ_MUSIC":
      return { label: "DJ", dotClass: "bg-standby-400" };
    case "SECURITY":
      return { label: "Security", dotClass: "bg-ink-300" };
    case "RENTALS":
      return { label: "Rentals", dotClass: "bg-engine-300" };
    default: {
      const s = cat.replace(/_/g, " ").toLowerCase();
      return { label: s ? s.charAt(0).toUpperCase() + s.slice(1) : "Place", dotClass: "bg-ink-300" };
    }
  }
}

function prettyCategory(cat?: string) {
  const s = (cat || "").replace(/_/g, " ").toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Place";
}

export default function DiscoveryMap({
  places,
  selectedPlace,
  onSelectPlace,
  anchorCoordinates,
  anchorLabel,
  eventCity,
  className = "",
  onAssignToEvent,
  onCheckAvailability,
  onCheckSuitability,
  onBindVenue,
  highlightedId = null,
  onHoverPlace,
  labels,
}: DiscoveryMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const anchorMarkerRef = useRef<L.Marker | null>(null);

  const [activeLayer, setActiveLayer] = useState<MapLayerType>("streets");
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showCityMenu, setShowCityMenu] = useState(false);
  const [hoveredPlace, setHoveredPlace] = useState<DiscoveryMapEntity | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  // Marker handlers are bound once per rebuild; read the latest callback through a ref.
  const hoverCbRef = useRef(onHoverPlace);
  hoverCbRef.current = onHoverPlace;

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const defaultCityKey = (eventCity || "seattle").toLowerCase().trim();
    const initialCenter = anchorCoordinates || CITY_COORDINATES[defaultCityKey] || [47.6062, -122.3321];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    const layerCfg = LAYER_CONFIGS[activeLayer];
    const tiles = L.tileLayer(layerCfg.url, {
      attribution: layerCfg.attribution,
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(map);

    tileLayerRef.current = tiles;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Tile Layer
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (tileLayerRef.current) {
      mapInstanceRef.current.removeLayer(tileLayerRef.current);
    }
    const layerCfg = LAYER_CONFIGS[activeLayer];
    const newTiles = L.tileLayer(layerCfg.url, {
      attribution: layerCfg.attribution,
      maxZoom: 19,
      subdomains: "abcd",
    }).addTo(mapInstanceRef.current);
    tileLayerRef.current = newTiles;
  }, [activeLayer]);

  // Update Event Anchor Pin
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (anchorMarkerRef.current) {
      anchorMarkerRef.current.remove();
      anchorMarkerRef.current = null;
    }

    if (anchorCoordinates && typeof anchorCoordinates[0] === "number" && typeof anchorCoordinates[1] === "number") {
      const anchorHtml = `
        <div class="relative z-40 flex flex-col items-center">
          <div class="flex items-center gap-1.5 whitespace-nowrap rounded-full bg-cue-600 px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-wider text-white shadow-lg ring-4 ring-cue-500/25">
            <span class="h-1.5 w-1.5 rounded-full bg-white"></span>
            <span>${anchorLabel || "Event"}</span>
          </div>
          <div class="-mt-1 h-2 w-2 rotate-45 bg-cue-600"></div>
        </div>
      `;

      const anchorIcon = L.divIcon({
        className: "custom-anchor-pin",
        html: anchorHtml,
        iconSize: [140, 36],
        iconAnchor: [70, 34],
      });

      anchorMarkerRef.current = L.marker(anchorCoordinates, { icon: anchorIcon }).addTo(map);
    }
  }, [anchorCoordinates, anchorLabel]);

  // Update Place Markers when places change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    const validPlaces = places.filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number");
    if (validPlaces.length === 0) return;

    const bounds = L.latLngBounds([]);
    if (anchorCoordinates) bounds.extend(anchorCoordinates);
    const offsets = computeOffsets(validPlaces);

    validPlaces.forEach((p) => {
      const lat = p.latitude;
      const lng = p.longitude;
      const isSelected = selectedPlace?.id === p.id;
      bounds.extend([lat, lng]);

      const badgeCfg = getCategoryBadgeConfig(p.category, p.entity_type);
      const isAssigned = p.is_assigned;

      // Compact pin: the card's list number (or rating) in a small ink badge.
      // Selected / booked pins stand out; the name appears on hover via the card overlay.
      const label = labels?.[p.id];
      let pinText = "";
      if (label) {
        pinText = label;
      } else if (typeof p.rating === "number" && p.rating > 0) {
        pinText = `${p.rating.toFixed(1)}★`;
      } else {
        pinText = badgeCfg.label;
      }

      const bodyCls = isSelected
        ? "bg-cue-600 text-white ring-4 ring-cue-500/30 shadow-xl"
        : isAssigned
        ? "bg-go-600 text-white ring-2 ring-go-400/40 shadow-lg"
        : "bg-ink-900 text-ink-50 ring-2 ring-white shadow-md";
      const tipCls = isSelected ? "bg-cue-600" : isAssigned ? "bg-go-600" : "bg-ink-900";
      const [dx, dy] = offsets[p.id] || [0, 0];

      const iconHtml = `
        <div data-pin class="pin-body relative flex cursor-pointer flex-col items-center transition-transform duration-200 ease-out ${
          isSelected ? "z-50 scale-110" : "z-20 hover:scale-110"
        } [.is-hot_&]:scale-125 [.is-hot_&]:z-50">
          <div class="flex min-w-[24px] items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 py-[3px] font-mono text-[11px] font-bold leading-none ${bodyCls} [.is-hot_&]:bg-cue-600 [.is-hot_&]:text-white [.is-hot_&]:ring-cue-500/40">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full ${isAssigned || isSelected ? "bg-white" : badgeCfg.dotClass}"></span>
            <span>${pinText}</span>
            ${isAssigned ? '<span class="text-[11px] font-black">✓</span>' : ""}
          </div>
          <div class="-mt-1 h-2 w-2 rotate-45 ${tipCls} [.is-hot_&]:bg-cue-600"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: "custom-discovery-pin",
        html: iconHtml,
        iconSize: [56, 30],
        iconAnchor: [28 - dx, 28 - dy],
      });

      const marker = L.marker([lat, lng], { icon: customIcon, keyboard: true, title: p.name }).addTo(map);

      marker.on("click", () => {
        setDismissedId(null);
        onSelectPlace(p);
        map.flyTo([lat, lng], 14, { duration: 1 });
      });
      marker.on("mouseover", () => {
        setHoveredPlace(p);
        hoverCbRef.current?.(p);
      });
      marker.on("mouseout", () => {
        setHoveredPlace(null);
        hoverCbRef.current?.(null);
      });

      markersRef.current[p.id] = marker;
    });

    if (!selectedPlace && validPlaces.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [places, selectedPlace, anchorCoordinates, labels]);

  // Highlight the pin of the card under the cursor (no marker rebuild, just a class)
  useEffect(() => {
    for (const [id, marker] of Object.entries(markersRef.current)) {
      const el = marker.getElement();
      if (!el) continue;
      const hot = id === highlightedId;
      el.classList.toggle("is-hot", hot);
      marker.setZIndexOffset(hot ? 1000 : 0);
    }
  }, [highlightedId, places, selectedPlace]);

  // Center on selected place when changed
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedPlace) return;
    setDismissedId(null);
    if (typeof selectedPlace.latitude === "number" && typeof selectedPlace.longitude === "number") {
      map.flyTo([selectedPlace.latitude, selectedPlace.longitude], 14, { duration: 1.2 });
    }
  }, [selectedPlace]);

  const handleFlyToCity = (cityName: string) => {
    const map = mapInstanceRef.current;
    setShowCityMenu(false);
    if (!map) return;
    const coords = CITY_COORDINATES[cityName.toLowerCase()];
    if (coords) map.flyTo(coords, 12, { duration: 1.5 });
  };

  const handleResetView = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const validPlaces = places.filter((p) => typeof p.latitude === "number" && typeof p.longitude === "number");
    if (validPlaces.length > 0) {
      const bounds = L.latLngBounds(validPlaces.map((p) => [p.latitude, p.longitude]));
      if (anchorCoordinates) bounds.extend(anchorCoordinates);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    } else if (anchorCoordinates) {
      map.flyTo(anchorCoordinates, 13, { duration: 1 });
    }
  };

  const ctrl =
    "pointer-events-auto rounded-lg border border-ink-200/80 bg-[#FDFCFA]/95 text-ink-700 shadow-md backdrop-blur-md transition hover:border-ink-300 hover:text-ink-900";
  const menu =
    "absolute z-30 mt-1.5 min-w-[150px] animate-rise-in rounded-xl border border-ink-200 bg-[#FDFCFA] p-1 shadow-xl";
  const menuItem = (active: boolean) =>
    `flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition ${
      active ? "bg-ink-100 font-semibold text-ink-900" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
    }`;

  const showSelectedCard = selectedPlace && dismissedId !== selectedPlace.id;
  const hasProviderAction = selectedPlace?.entity_type === "PROVIDER" && !!onAssignToEvent;
  const hasVenueActions =
    selectedPlace?.entity_type !== "PROVIDER" && (!!onCheckAvailability || !!onCheckSuitability || !!onBindVenue);

  return (
    <div className={`relative h-full w-full overflow-hidden bg-ink-100 ${className}`}>
      <div ref={mapContainerRef} className="z-10 h-full w-full" />

      {/* Top controls */}
      <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex items-start justify-between gap-2">
        <div className="relative">
          <button
            onClick={() => {
              setShowCityMenu((v) => !v);
              setShowLayerMenu(false);
            }}
            className={`${ctrl} flex h-8 items-center gap-1.5 px-2.5 text-[12px] font-semibold`}
            aria-haspopup="menu"
            aria-expanded={showCityMenu}
          >
            <Navigation className="h-3.5 w-3.5 text-ink-500" />
            Jump to
            <ChevronDown className="h-3 w-3 text-ink-400" />
          </button>
          {showCityMenu && (
            <div role="menu" className={`${menu} pointer-events-auto left-0`}>
              {["Seattle", "Mumbai", "Delhi", "Bengaluru"].map((city) => (
                <button key={city} role="menuitem" onClick={() => handleFlyToCity(city)} className={menuItem(false)}>
                  {city}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={handleResetView} className={`${ctrl} grid h-8 w-8 place-items-center`} title="Fit all places in view" aria-label="Fit all places in view">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <div className="relative">
            <button
              onClick={() => {
                setShowLayerMenu((v) => !v);
                setShowCityMenu(false);
              }}
              className={`${ctrl} flex h-8 items-center gap-1.5 px-2.5 text-[12px] font-semibold`}
              aria-haspopup="menu"
              aria-expanded={showLayerMenu}
            >
              <Layers className="h-3.5 w-3.5 text-ink-500" />
              {LAYER_CONFIGS[activeLayer].name}
            </button>
            {showLayerMenu && (
              <div role="menu" className={`${menu} pointer-events-auto right-0`}>
                {(["streets", "dark", "satellite"] as MapLayerType[]).map((key) => (
                  <button
                    key={key}
                    role="menuitemradio"
                    aria-checked={activeLayer === key}
                    onClick={() => {
                      setActiveLayer(key);
                      setShowLayerMenu(false);
                    }}
                    className={menuItem(activeLayer === key)}
                  >
                    {LAYER_CONFIGS[key].name}
                    {activeLayer === key && <Check className="h-3.5 w-3.5 text-cue-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Zoom */}
      <div className="absolute bottom-8 right-3 z-20 flex flex-col overflow-hidden rounded-lg border border-ink-200/80 bg-[#FDFCFA]/95 shadow-md backdrop-blur-md">
        <button
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="grid h-8 w-8 place-items-center text-[16px] font-semibold text-ink-700 transition hover:bg-ink-100"
          title="Zoom in"
          aria-label="Zoom in"
        >
          +
        </button>
        <div className="h-px bg-ink-200" />
        <button
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="grid h-8 w-8 place-items-center text-[16px] font-semibold text-ink-700 transition hover:bg-ink-100"
          title="Zoom out"
          aria-label="Zoom out"
        >
          −
        </button>
      </div>

      {/* Empty overlay */}
      {places.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-20 flex justify-center px-6">
          <div className="rounded-full border border-ink-200 bg-[#FDFCFA]/95 px-3 py-1.5 font-mono text-[11px] text-ink-500 shadow-md backdrop-blur">
            No places to plot yet
          </div>
        </div>
      )}

      {/* Hover preview */}
      {hoveredPlace && hoveredPlace.id !== selectedPlace?.id && (
        <div className="pointer-events-none absolute bottom-8 left-3 z-20 max-w-[260px] animate-rise-in rounded-xl bg-ink-950/95 p-3 text-ink-100 shadow-2xl ring-1 ring-black/20 backdrop-blur-md">
          <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-label text-ink-400">
            <span>{prettyCategory(hoveredPlace.category)}</span>
            {hoveredPlace.rating && <span className="text-standby-300">★ {hoveredPlace.rating.toFixed(1)}</span>}
          </div>
          <div className="mt-1 text-[13px] font-semibold leading-tight text-white">{hoveredPlace.name}</div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-400">{hoveredPlace.address || hoveredPlace.city}</p>
          {hoveredPlace.distance_km !== null && hoveredPlace.distance_km !== undefined && (
            <div className="mt-1 font-mono text-[10.5px] text-go-300">{hoveredPlace.distance_km.toFixed(1)} km from event</div>
          )}
        </div>
      )}

      {/* Selected place card */}
      {showSelectedCard && selectedPlace && (
        <div className="absolute bottom-8 left-3 right-14 z-20 animate-rise-in overflow-hidden rounded-xl bg-[#FDFCFA] shadow-2xl ring-1 ring-ink-900/10 md:right-auto md:w-[340px]">
          <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="chip border-ink-200 bg-ink-100/70 px-1.5 py-px text-[10px] text-ink-600">
                  {prettyCategory(selectedPlace.category)}
                </span>
                {selectedPlace.is_assigned && (
                  <span className="chip border-go-200 bg-go-50 px-1.5 py-px text-[10px] text-go-700">
                    <Check className="h-3 w-3" /> Assigned
                  </span>
                )}
              </div>
              <h3 className="mt-1.5 text-[14px] font-semibold leading-snug text-ink-900">{selectedPlace.name}</h3>
              <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-500">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{selectedPlace.address || selectedPlace.city}</span>
              </p>
            </div>
            <div className="flex shrink-0 items-start gap-1">
              {selectedPlace.rating ? (
                <div className="text-right">
                  <div className="font-display text-[18px] font-bold leading-none text-ink-900">
                    {selectedPlace.rating.toFixed(1)}
                    <span className="text-standby-500">★</span>
                  </div>
                  {selectedPlace.review_count && (
                    <div className="mt-0.5 font-mono text-[10px] text-ink-400">{selectedPlace.review_count} reviews</div>
                  )}
                </div>
              ) : selectedPlace.hourly_rate ? (
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase text-ink-400">Rate</div>
                  <div className="text-[13px] font-bold text-ink-900">₹{selectedPlace.hourly_rate}/hr</div>
                </div>
              ) : null}
              <button
                onClick={() => setDismissedId(selectedPlace.id)}
                className="-mr-1.5 -mt-0.5 rounded p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-800"
                aria-label="Close place card"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <dl className="mx-4 mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-ink-200 font-mono text-[11px]">
            <div className="bg-ink-50 px-2.5 py-1.5">
              <dt className="text-[9.5px] uppercase tracking-label text-ink-400">Distance</dt>
              <dd className="font-semibold text-ink-800">
                {selectedPlace.distance_km !== null && selectedPlace.distance_km !== undefined
                  ? `${selectedPlace.distance_km.toFixed(1)} km`
                  : <span className="font-normal italic text-ink-400">unknown</span>}
              </dd>
            </div>
            <div className="bg-ink-50 px-2.5 py-1.5">
              <dt className="text-[9.5px] uppercase tracking-label text-ink-400">Coordinates</dt>
              <dd className="truncate text-ink-700">
                {selectedPlace.latitude?.toFixed(4)}, {selectedPlace.longitude?.toFixed(4)}
              </dd>
            </div>
          </dl>

          <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-[12px]">
            <a
              href={
                selectedPlace.maps_url ||
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedPlace.name + " " + selectedPlace.city)}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-ink-700 hover:text-ink-900 hover:underline"
            >
              Verify on Google Maps <ExternalLink className="h-3 w-3" />
            </a>
            {selectedPlace.phone && (
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-500">
                <Phone className="h-3 w-3" />
                {selectedPlace.phone}
              </span>
            )}
          </div>

          {(hasProviderAction || hasVenueActions) && (
            <div className="flex items-center gap-2 border-t border-ink-200 bg-ink-50/70 px-4 py-2.5">
              {selectedPlace.entity_type === "PROVIDER" ? (
                <button
                  onClick={() => onAssignToEvent && onAssignToEvent(selectedPlace)}
                  className={`flex-1 ${selectedPlace.is_assigned ? "btn border border-go-200 bg-go-50 text-go-700" : "btn-primary"}`}
                >
                  {selectedPlace.is_assigned ? (
                    <>
                      <Check className="h-3.5 w-3.5" /> Assigned to event
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" /> Assign to event
                    </>
                  )}
                </button>
              ) : (
                <>
                  {onCheckAvailability && (
                    <button onClick={() => onCheckAvailability(selectedPlace.id)} className="btn-secondary h-8 flex-1 text-[12px]">
                      <Clock className="h-3.5 w-3.5 text-standby-600" /> Check dates
                    </button>
                  )}
                  {onCheckSuitability && (
                    <button onClick={() => onCheckSuitability(selectedPlace.id)} className="btn-secondary h-8 flex-1 text-[12px]">
                      <span className="text-agent-500">✦</span> Suitability
                    </button>
                  )}
                  {onBindVenue && (
                    <button
                      onClick={() => onBindVenue(selectedPlace)}
                      className="btn-cue h-8 text-[12px]"
                      title="Set as the primary event venue"
                    >
                      <Check className="h-3.5 w-3.5" /> Select
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
