"use client";

import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { VenueResponse } from "../../types/api";
import {
  Layers,
  MapPin,
  Navigation,
  Compass,
  Maximize2,
  Users,
  DollarSign,
  CheckCircle,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";

interface VenueMapProps {
  venues: VenueResponse[];
  selectedVenue: VenueResponse | null;
  onSelectVenue: (venue: VenueResponse) => void;
  eventCity?: string;
  className?: string;
  onCheckAvailability?: (venueId: string) => void;
  onCheckSuitability?: (venueId: string) => void;
}

type MapLayerType = "dark" | "streets" | "satellite";

const LAYER_CONFIGS: Record<MapLayerType, { url: string; attribution: string; name: string }> = {
  dark: {
    name: "Dark Radar",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, HERE, Garmin, OpenStreetMap",
  },
  streets: {
    name: "Streets",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    name: "Satellite Hybrid",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "&copy; Esri, Maxar, Earthstar Geographics",
  },
};


const CITY_COORDINATES: Record<string, [number, number]> = {
  seattle: [47.6115, -122.3332],
  mumbai: [19.076, 72.8777],
  delhi: [28.6139, 77.209],
  bengaluru: [12.9716, 77.5946],
  boston: [42.3601, -71.0589],
};

export default function VenueMap({
  venues,
  selectedVenue,
  onSelectVenue,
  eventCity,
  className = "",
  onCheckAvailability,
  onCheckSuitability,
}: VenueMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  const [activeLayer, setActiveLayer] = useState<MapLayerType>("dark");
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [hoveredVenue, setHoveredVenue] = useState<VenueResponse | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Determine initial center
    const defaultCityKey = (eventCity || "seattle").toLowerCase().trim();
    const initialCenter = CITY_COORDINATES[defaultCityKey] || [47.6115, -122.3332];

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
    });

    // Add Attribution in bottom right cleanly
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map);

    // Initial Tile Layer
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

  // Update Tile Layer on Change
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

  // Update Markers when Venues change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    Object.values(markersRef.current).forEach((marker) => marker.remove());
    markersRef.current = {};

    const validVenues = venues.filter(
      (v) => typeof v.latitude === "number" && typeof v.longitude === "number"
    );

    if (validVenues.length === 0) return;

    const bounds = L.latLngBounds([]);

    validVenues.forEach((v) => {
      const lat = v.latitude as number;
      const lng = v.longitude as number;
      const isSelected = selectedVenue?.id === v.id;

      bounds.extend([lat, lng]);

      // Custom Google Maps style price-badge pin
      const priceText = v.hourly_rate ? `$${Math.round(v.hourly_rate)}/hr` : "Venue";
      const iconHtml = `
        <div class="group relative cursor-pointer transform transition-all duration-200 ${
          isSelected ? "scale-110 z-50" : "hover:scale-105 z-20"
        }">
          <div class="flex items-center space-x-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-bold shadow-xl border transition-all ${
            isSelected
              ? "bg-cyan-500 text-slate-950 border-cyan-300 ring-4 ring-cyan-500/30 font-black shadow-cyan-500/50"
              : "bg-slate-900/95 text-slate-100 border-slate-700 hover:border-cyan-400 hover:text-cyan-300"
          }">
            <span class="w-2 h-2 rounded-full ${isSelected ? "bg-slate-950" : "bg-emerald-400"}"></span>
            <span>${priceText}</span>
          </div>
          <div class="w-2 h-2 bg-slate-900 border-r border-b border-slate-700 transform rotate-45 mx-auto -mt-1 ${
            isSelected ? "!bg-cyan-500 !border-cyan-300" : ""
          }"></div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: "custom-venue-pin",
        html: iconHtml,
        iconSize: [80, 32],
        iconAnchor: [40, 30],
      });

      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);

      marker.on("click", () => {
        onSelectVenue(v);
        map.flyTo([lat, lng], 14, { duration: 1 });
      });

      marker.on("mouseover", () => {
        setHoveredVenue(v);
      });

      marker.on("mouseout", () => {
        setHoveredVenue(null);
      });

      markersRef.current[v.id] = marker;
    });

    // Auto-fit bounds if we have venues and none currently selected
    if (!selectedVenue && validVenues.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [venues, selectedVenue]);

  // Center on selected venue when it changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedVenue) return;
    if (typeof selectedVenue.latitude === "number" && typeof selectedVenue.longitude === "number") {
      map.flyTo([selectedVenue.latitude, selectedVenue.longitude], 14, { duration: 1.2 });
    }
  }, [selectedVenue]);

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
    const validVenues = venues.filter(
      (v) => typeof v.latitude === "number" && typeof v.longitude === "number"
    );
    if (validVenues.length > 0) {
      const bounds = L.latLngBounds(
        validVenues.map((v) => [v.latitude as number, v.longitude as number])
      );
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    }
  };

  return (
    <div className={`relative w-full h-full rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-[#090d16] ${className}`}>
      {/* Map Canvas */}
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

        {/* Map Layer Switcher & Tools */}
        <div className="flex items-center space-x-2 pointer-events-auto">
          {/* Reset View Button */}
          <button
            onClick={handleResetView}
            className="p-2 rounded-xl bg-[#090d16]/90 backdrop-blur-md border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white shadow-lg transition"
            title="Fit All Venues in View"
          >
            <Maximize2 className="w-4 h-4" />
          </button>

          {/* Layer Selector */}
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
                {(["dark", "streets", "satellite"] as MapLayerType[]).map((key) => (
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

      {/* Floating Zoom Buttons (Bottom Right) */}
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

      {/* Hover Info Window Preview (Bottom Left) */}
      {hoveredVenue && hoveredVenue.id !== selectedVenue?.id && (
        <div className="absolute bottom-4 left-4 z-20 max-w-xs rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 p-3 shadow-2xl space-y-1 animate-in fade-in duration-150 pointer-events-none">
          <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400">
            <span className="uppercase">{hoveredVenue.venue_type}</span>
            <span>★ 4.8</span>
          </div>
          <h4 className="text-xs font-bold text-white leading-tight">{hoveredVenue.name}</h4>
          <p className="text-[11px] text-slate-400 truncate">{hoveredVenue.address || hoveredVenue.city}</p>
          <div className="flex items-center justify-between text-[11px] font-mono pt-1 text-slate-300">
            <span>Capacity: {hoveredVenue.capacity}</span>
            <span className="text-emerald-400 font-bold">${hoveredVenue.hourly_rate || 0}/hr</span>
          </div>
        </div>
      )}

      {/* Selected Venue Focus Card Overlay (When clicked on map) */}
      {selectedVenue && (
        <div className="absolute bottom-4 left-4 right-16 md:right-auto md:w-96 z-20 rounded-2xl bg-[#090d16]/95 backdrop-blur-md border border-cyan-500/50 p-4 shadow-2xl space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-bold">
                  {selectedVenue.venue_type}
                </span>
                <span className="text-[10px] font-mono text-emerald-400 flex items-center space-x-1">
                  <CheckCircle className="w-3 h-3" />
                  <span>ACTIVE</span>
                </span>
              </div>
              <h3 className="text-sm font-bold text-white mt-1 leading-snug">{selectedVenue.name}</h3>
              <p className="text-xs text-slate-400 flex items-center space-x-1 mt-0.5">
                <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                <span className="truncate">{selectedVenue.address || selectedVenue.city}</span>
              </p>
            </div>
            <div className="text-right font-mono">
              <div className="text-xs text-slate-400">RATE</div>
              <div className="text-sm font-bold text-emerald-400">${selectedVenue.hourly_rate || 0}/hr</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-900/80 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span className="text-slate-500 text-[10px] block">MAX CAPACITY</span>
              <span className="font-bold text-slate-200">{selectedVenue.capacity} Guests</span>
            </div>
            <div>
              <span className="text-slate-500 text-[10px] block">COORDINATES</span>
              <span className="font-bold text-slate-300 text-[10px]">
                {selectedVenue.latitude?.toFixed(4)}, {selectedVenue.longitude?.toFixed(4)}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2 pt-1">
            {onCheckAvailability && (
              <button
                onClick={() => onCheckAvailability(selectedVenue.id)}
                className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center space-x-1 transition"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Check Window</span>
              </button>
            )}
            {onCheckSuitability && (
              <button
                onClick={() => onCheckSuitability(selectedVenue.id)}
                className="flex-1 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center space-x-1 transition shadow-lg shadow-cyan-600/30"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Suitability Score</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
