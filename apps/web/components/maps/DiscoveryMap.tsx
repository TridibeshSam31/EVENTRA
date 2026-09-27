"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DiscoveryMapEntity } from "../../types/api";
import {
  Layers,
  MapPin,
  Compass,
  Maximize2,
  Users,
  DollarSign,
  CheckCircle,
  Clock,
  Sparkles,
  ExternalLink,
  Phone,
  Check,
  Plus,
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
}

type MapLayerType = "dark" | "streets" | "satellite";

const LAYER_CONFIGS: Record<MapLayerType, { url: string; attribution: string; name: string }> = {
  streets: {
    name: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  dark: {
    name: "Dark Radar",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin, OpenStreetMap",
  },
  satellite: {
    name: "Satellite Hybrid",
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

function getCategoryBadgeConfig(category: string, entityType: string) {
  const cat = (category || "").toUpperCase();
  if (entityType === "VENUE") {
    return {
      icon: "🏛️",
      label: "VENUE",
      bgClass: "bg-cyan-500 text-slate-950 border-cyan-300",
      dotClass: "bg-cyan-400",
    };
  }
  switch (cat) {
    case "PHOTOGRAPHY":
      return {
        icon: "📸",
        label: "PHOTO",
        bgClass: "bg-purple-600 text-white border-purple-300",
        dotClass: "bg-purple-400",
      };
    case "VIDEOGRAPHY":
      return {
        icon: "🎬",
        label: "VIDEO",
        bgClass: "bg-indigo-600 text-white border-indigo-300",
        dotClass: "bg-indigo-400",
      };
    case "CATERING":
      return {
        icon: "🍽️",
        label: "CATERING",
        bgClass: "bg-emerald-600 text-white border-emerald-300",
        dotClass: "bg-emerald-400",
      };
    case "AV_TECH":
      return {
        icon: "🔊",
        label: "AV / TECH",
        bgClass: "bg-blue-600 text-white border-blue-300",
        dotClass: "bg-blue-400",
      };
    case "DECOR":
    case "FLORIST":
      return {
        icon: "💐",
        label: "DECOR",
        bgClass: "bg-rose-600 text-white border-rose-300",
        dotClass: "bg-rose-400",
      };
    case "DJ_MUSIC":
      return {
        icon: "🎵",
        label: "DJ",
        bgClass: "bg-amber-600 text-white border-amber-300",
        dotClass: "bg-amber-400",
      };
    case "SECURITY":
      return {
        icon: "🛡️",
        label: "SECURITY",
        bgClass: "bg-slate-700 text-white border-slate-400",
        dotClass: "bg-slate-300",
      };
    case "RENTALS":
      return {
        icon: "🎪",
        label: "RENTALS",
        bgClass: "bg-teal-600 text-white border-teal-300",
        dotClass: "bg-teal-400",
      };
    default:
      return {
        icon: "⭐",
        label: cat.replace("_", " "),
        bgClass: "bg-slate-800 text-slate-100 border-slate-600",
        dotClass: "bg-cyan-400",
      };
  }
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
}: DiscoveryMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const anchorMarkerRef = useRef<L.Marker | null>(null);

  const [activeLayer, setActiveLayer] = useState<MapLayerType>("streets");
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [hoveredPlace, setHoveredPlace] = useState<DiscoveryMapEntity | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const defaultCityKey = (eventCity || "seattle").toLowerCase().trim();
    const initialCenter =
      anchorCoordinates || CITY_COORDINATES[defaultCityKey] || [47.6062, -122.3321];

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

    if (
      anchorCoordinates &&
      typeof anchorCoordinates[0] === "number" &&
      typeof anchorCoordinates[1] === "number"
    ) {
      const anchorHtml = `
        <div class="relative cursor-pointer group z-40">
          <div class="flex items-center space-x-1.5 px-3 py-1 rounded-full font-mono text-[11px] font-black shadow-2xl bg-rose-600 text-white border-2 border-rose-300 ring-4 ring-rose-500/40 animate-bounce">
            <span class="w-2 h-2 rounded-full bg-white inline-block"></span>
            <span>📍 ${anchorLabel || "EVENT ANCHOR"}</span>
          </div>
          <div class="w-2.5 h-2.5 bg-rose-600 border-r-2 border-b-2 border-rose-300 transform rotate-45 mx-auto -mt-1.5"></div>
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

    // Clear existing place markers
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    const validPlaces = places.filter(
      (p) => typeof p.latitude === "number" && typeof p.longitude === "number"
    );

    if (validPlaces.length === 0) return;

    const bounds = L.latLngBounds([]);

    // Include anchor in bounds if available
    if (anchorCoordinates) {
      bounds.extend(anchorCoordinates);
    }

    validPlaces.forEach((p) => {
      const lat = p.latitude;
      const lng = p.longitude;
      const isSelected = selectedPlace?.id === p.id;
      bounds.extend([lat, lng]);

      const badgeCfg = getCategoryBadgeConfig(p.category, p.entity_type);
      const isAssigned = p.is_assigned;

      let pinText = "";
      if (typeof p.rating === "number" && p.rating > 0) {
        pinText = `${p.rating.toFixed(1)} ★`;
      } else if (p.hourly_rate) {
        pinText = `$${Math.round(p.hourly_rate)}/hr`;
      } else {
        pinText = badgeCfg.label;
      }

      const iconHtml = `
        <div class="group relative cursor-pointer transform transition-all duration-200 ${
          isSelected ? "scale-110 z-50" : "hover:scale-105 z-20"
        }">
          <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-bold shadow-xl border transition-all ${
            isSelected
              ? "bg-cyan-500 text-slate-950 border-cyan-200 ring-4 ring-cyan-500/40 font-black shadow-cyan-500/50"
              : isAssigned
              ? "bg-emerald-600 text-white border-emerald-300 ring-2 ring-emerald-500/40"
              : `${badgeCfg.bgClass} shadow-md`
          }">
            <span>${badgeCfg.icon}</span>
            <span>${pinText}</span>
            ${isAssigned ? '<span class="text-white text-[12px] font-black">✓</span>' : ""}
          </div>
          <div class="w-2 h-2 border-r border-b transform rotate-45 mx-auto -mt-1 ${
            isSelected
              ? "bg-cyan-500 border-cyan-200"
              : isAssigned
              ? "bg-emerald-600 border-emerald-300"
              : "bg-slate-900 border-slate-700"
          }"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: "custom-discovery-pin",
        html: iconHtml,
        iconSize: [85, 34],
        iconAnchor: [42, 32],
      });

      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);

      marker.on("click", () => {
        onSelectPlace(p);
        map.flyTo([lat, lng], 14, { duration: 1 });
      });

      marker.on("mouseover", () => {
        setHoveredPlace(p);
      });

      marker.on("mouseout", () => {
        setHoveredPlace(null);
      });

      markersRef.current[p.id] = marker;
    });

    // Auto-fit bounds if we have places and none currently selected
    if (!selectedPlace && validPlaces.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [places, selectedPlace, anchorCoordinates]);

  // Center on selected place when changed
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedPlace) return;
    if (typeof selectedPlace.latitude === "number" && typeof selectedPlace.longitude === "number") {
      map.flyTo([selectedPlace.latitude, selectedPlace.longitude], 14, { duration: 1.2 });
    }
  }, [selectedPlace]);

  const handleFlyToCity = (cityName: string) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const coords = CITY_COORDINATES[cityName.toLowerCase()];
    if (coords) {
      map.flyTo(coords, 12, { duration: 1.5 });
    }
  };

  const handleResetView = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const validPlaces = places.filter(
      (p) => typeof p.latitude === "number" && typeof p.longitude === "number"
    );
    if (validPlaces.length > 0) {
      const bounds = L.latLngBounds(
        validPlaces.map((p) => [p.latitude, p.longitude])
      );
      if (anchorCoordinates) bounds.extend(anchorCoordinates);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    } else if (anchorCoordinates) {
      map.flyTo(anchorCoordinates, 13, { duration: 1 });
    }
  };

  return (
    <div className={`relative w-full h-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-[#090d16] ${className}`}>
      {/* Leaflet Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full z-10" />

      {/* Floating Top Control Bar */}
      <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
        {/* City Quick Navigation Pills */}
        <div className="flex items-center space-x-1.5 bg-[#090d16]/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 shadow-lg pointer-events-auto">
          <span className="text-[10px] font-mono uppercase px-2 text-slate-400 font-bold flex items-center space-x-1">
            <Compass className="w-3 h-3 text-cyan-400" />
            <span>Region</span>
          </span>
          {["Seattle", "Mumbai", "Delhi", "Bengaluru"].map((city) => (
            <button
              key={city}
              onClick={() => handleFlyToCity(city)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition"
            >
              {city}
            </button>
          ))}
        </div>

        {/* Tools: Reset View & Layer Switcher */}
        <div className="flex items-center space-x-2 pointer-events-auto">
          <button
            onClick={handleResetView}
            className="p-2 rounded-xl bg-[#090d16]/90 backdrop-blur-md border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white shadow-lg transition"
            title="Fit All Discovered Places in View"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowLayerMenu(!showLayerMenu)}
              className="px-3 py-1.5 rounded-xl bg-[#090d16]/90 backdrop-blur-md border border-slate-800 hover:border-slate-700 text-slate-200 text-xs font-semibold flex items-center space-x-1.5 shadow-lg transition"
            >
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>{LAYER_CONFIGS[activeLayer].name}</span>
            </button>

            {showLayerMenu && (
              <div className="absolute right-0 mt-2 w-44 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-1 z-30 space-y-0.5 animate-in fade-in zoom-in-95">
                {(["streets", "dark", "satellite"] as MapLayerType[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      setActiveLayer(key);
                      setShowLayerMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center justify-between ${
                      activeLayer === key
                        ? "bg-cyan-500/20 text-cyan-300 font-semibold"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <span>{LAYER_CONFIGS[key].name}</span>
                    {activeLayer === key && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Zoom Controls (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-20 flex flex-col space-y-1.5 bg-[#090d16]/90 backdrop-blur-md p-1 rounded-xl border border-slate-800 shadow-xl">
        <button
          onClick={() => mapInstanceRef.current?.zoomIn()}
          className="w-8 h-8 flex items-center justify-center text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg text-base font-bold transition"
          title="Zoom In"
        >
          +
        </button>
        <div className="h-px bg-slate-800 mx-1"></div>
        <button
          onClick={() => mapInstanceRef.current?.zoomOut()}
          className="w-8 h-8 flex items-center justify-center text-slate-200 hover:text-white hover:bg-slate-800 rounded-lg text-base font-bold transition"
          title="Zoom Out"
        >
          -
        </button>
      </div>

      {/* Hover Info Tooltip Preview (Bottom Left) */}
      {hoveredPlace && hoveredPlace.id !== selectedPlace?.id && (
        <div className="absolute bottom-4 left-4 z-20 max-w-xs rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 p-3 shadow-2xl space-y-1 animate-in fade-in duration-150 pointer-events-none">
          <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400">
            <span className="uppercase font-bold">{hoveredPlace.category.replace("_", " ")}</span>
            {hoveredPlace.rating && (
              <span className="text-amber-400 font-bold">★ {hoveredPlace.rating.toFixed(1)}</span>
            )}
          </div>
          <h4 className="text-xs font-bold text-white leading-tight">{hoveredPlace.name}</h4>
          <p className="text-[11px] text-slate-400 truncate">{hoveredPlace.address || hoveredPlace.city}</p>
          {hoveredPlace.distance_km !== null && hoveredPlace.distance_km !== undefined && (
            <div className="text-[10px] font-mono text-emerald-400 font-semibold">
              📍 {hoveredPlace.distance_km.toFixed(1)} km from Anchor
            </div>
          )}
        </div>
      )}

      {/* Selected Place Focus Card Overlay (When clicked on map) */}
      {selectedPlace && (
        <div className="absolute bottom-4 left-4 right-16 md:right-auto md:w-96 z-20 rounded-2xl bg-[#090d16]/95 backdrop-blur-md border border-cyan-500/50 p-4 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-1.5 flex-wrap">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-bold">
                  {selectedPlace.category.replace("_", " ")}
                </span>
                {selectedPlace.is_assigned ? (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold flex items-center space-x-1">
                    <Check className="w-3 h-3 text-emerald-400" />
                    <span>ASSIGNED TO EVENT</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center space-x-1">
                    <CheckCircle className="w-3 h-3" />
                    <span>ACTIVE</span>
                  </span>
                )}
              </div>
              <h3 className="text-sm font-bold text-white leading-snug">{selectedPlace.name}</h3>
              <p className="text-xs text-slate-400 flex items-center space-x-1">
                <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{selectedPlace.address || selectedPlace.city}</span>
              </p>
            </div>

            {/* Rating / Rate Badge */}
            <div className="text-right font-mono shrink-0 ml-2">
              {selectedPlace.rating ? (
                <div className="px-2 py-1 rounded-lg bg-amber-950/80 border border-amber-700/60 text-amber-300 font-bold text-xs">
                  ⭐ {selectedPlace.rating.toFixed(1)}
                  {selectedPlace.review_count && (
                    <span className="text-[10px] text-amber-400/80 block">
                      ({selectedPlace.review_count} rev)
                    </span>
                  )}
                </div>
              ) : selectedPlace.hourly_rate ? (
                <div>
                  <div className="text-[10px] text-slate-400">RATE</div>
                  <div className="text-sm font-bold text-emerald-400">${selectedPlace.hourly_rate}/hr</div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Quick Metrics Bar: Distance & Coordinates */}
          <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span className="text-slate-500 text-[10px] block">PROXIMITY</span>
              <span className="font-bold text-cyan-300">
                {selectedPlace.distance_km !== null && selectedPlace.distance_km !== undefined
                  ? `${selectedPlace.distance_km.toFixed(1)} km from Anchor`
                  : selectedPlace.city}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">COORDINATES</span>
              <span className="font-bold text-slate-300 text-[10px]">
                {selectedPlace.latitude?.toFixed(4)}, {selectedPlace.longitude?.toFixed(4)}
              </span>
            </div>
          </div>

          {/* External Google Maps Link */}
          <div className="flex items-center justify-between text-[11px] pt-0.5">
            <a
              href={
                selectedPlace.maps_url ||
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  selectedPlace.name + " " + selectedPlace.city
                )}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 flex items-center space-x-1 font-semibold hover:underline"
            >
              <span>Verify on Google Maps</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            {selectedPlace.phone && (
              <span className="text-slate-400 font-mono text-[10px] flex items-center space-x-1">
                <Phone className="w-3 h-3" />
                <span>{selectedPlace.phone}</span>
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2 pt-1">
            {selectedPlace.entity_type === "PROVIDER" ? (
              <button
                onClick={() => onAssignToEvent && onAssignToEvent(selectedPlace)}
                className={`flex-1 py-2 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition ${
                  selectedPlace.is_assigned
                    ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/50 hover:bg-emerald-600/40"
                    : "bg-cyan-600 hover:bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-600/30"
                }`}
              >
                {selectedPlace.is_assigned ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>✓ Assigned to Event</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 text-slate-950 font-black" />
                    <span>Assign to Event</span>
                  </>
                )}
              </button>
            ) : (
              <>
                {onCheckAvailability && (
                  <button
                    onClick={() => onCheckAvailability(selectedPlace.id)}
                    className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center space-x-1 transition"
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>Check Window</span>
                  </button>
                )}
                {onCheckSuitability && (
                  <button
                    onClick={() => onCheckSuitability(selectedPlace.id)}
                    className="flex-1 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center space-x-1 transition shadow-lg shadow-cyan-600/30"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Suitability</span>
                  </button>
                )}
                {onBindVenue && (
                  <button
                    onClick={() => onBindVenue(selectedPlace)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center space-x-1 transition"
                    title="Bind as Primary Event Venue"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Bind</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
