import { useEffect, useRef } from "react";
import L from "leaflet";
import { AlertTriangle } from "lucide-react";
import "leaflet/dist/leaflet.css";

export type NetworkMapPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "facility" | "pickup" | "dropoff" | "drone" | "base" | "zone";
  detail?: string;
  active?: boolean;
};

export type NetworkMapRoute = {
  id: string;
  points: Array<[number, number]>;
  color?: string;
  dashed?: boolean;
  label?: string;
};

export type NetworkMapZone = {
  id: string;
  lat: number;
  lng: number;
  radiusKm: number;
  label: string;
};

const CARTO_API_KEY = (
  import.meta.env.VITE_CARTO_API_KEY as string | undefined
)?.trim();

const CARTO_TILES = `https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png${
  CARTO_API_KEY ? `?key=${encodeURIComponent(CARTO_API_KEY)}` : ""
}`;
const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const TONES: Record<NetworkMapPoint["kind"], string> = {
  facility: "#0f766e",
  pickup: "#0f766e",
  dropoff: "#b21f34",
  drone: "#1d4ed8",
  base: "#111827",
  zone: "#b45309",
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markerIcon(point: NetworkMapPoint) {
  const color = TONES[point.kind];
  const drone = point.kind === "drone";
  const size = drone ? 14 : 10;
  const html = `
    <span style="
      display:flex;align-items:center;justify-content:center;
      width:${size}px;height:${size}px;border-radius:9999px;
      background:${color};border:2px solid #fff;
      box-shadow:0 0 0 ${point.active ? "7px" : "3px"} ${color}22, 0 1px 4px rgba(15,23,42,.35);
    "></span>`;
  return L.divIcon({
    html,
    className: "lifelink-map-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

/**
 * Leaflet map with real facility coordinates. Tiles require network access;
 * markers, routes and zones still render without them.
 */
export function NetworkMap({
  points,
  routes = [],
  zones = [],
  height = 420,
  className,
  focus,
}: {
  points: NetworkMapPoint[];
  routes?: NetworkMapRoute[];
  zones?: NetworkMapZone[];
  height?: number;
  className?: string;
  focus?: [number, number] | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    }).setView([18.5204, 73.8567], 11);
    L.tileLayer(CARTO_API_KEY ? CARTO_TILES : OSM_TILES, {
      maxZoom: 19,
      attribution: CARTO_API_KEY ? CARTO_ATTRIBUTION : OSM_ATTRIBUTION,
      subdomains: "abcd",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    for (const zone of zones) {
      L.circle([zone.lat, zone.lng], {
        radius: zone.radiusKm * 1000,
        color: "#b45309",
        weight: 1,
        opacity: 0.55,
        fillColor: "#f59e0b",
        fillOpacity: 0.1,
        dashArray: "4 5",
      })
        .bindTooltip(`${escapeHtml(zone.label)} · ${zone.radiusKm} km`, { direction: "top" })
        .addTo(layer);
    }

    for (const route of routes) {
      L.polyline(route.points, {
        color: route.color ?? "#b21f34",
        weight: 3,
        opacity: 0.85,
        dashArray: route.dashed ? "6 6" : undefined,
      })
        .bindTooltip(route.label ?? "Route", { sticky: true })
        .addTo(layer);
    }

    for (const point of points) {
      L.marker([point.lat, point.lng], { icon: markerIcon(point) })
        .bindPopup(
          `<div style="font-family:Inter,system-ui,sans-serif;min-width:160px">
            <p style="margin:0;font-size:11px;font-weight:700;color:#0f172a">${escapeHtml(point.label)}</p>
            <p style="margin:4px 0 0;font-size:10px;line-height:1.5;color:#64748b">${escapeHtml(point.detail ?? point.kind)}</p>
          </div>`,
        )
        .addTo(layer);
    }

    const coordinates = [
      ...points.map((p) => [p.lat, p.lng] as [number, number]),
      ...routes.flatMap((route) => route.points),
    ];
    if (focus) {
      map.setView(focus, Math.max(map.getZoom(), 12));
    } else if (coordinates.length > 0) {
      map.fitBounds(L.latLngBounds(coordinates), { padding: [32, 32], maxZoom: 13 });
    }
  }, [points, routes, zones, focus]);

  return (
    <div className={className}>
      {!CARTO_API_KEY && (
        <div
          role="status"
          className="mb-2 flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-[10.5px] leading-5 text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            CARTO is not configured, so the map is using OpenStreetMap tiles. Add
            <code className="mx-1 rounded bg-white/70 px-1">VITE_CARTO_API_KEY</code>
            to the frontend environment to restore CARTO basemaps.
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        style={{ height }}
        className="w-full overflow-hidden rounded-2xl border border-border bg-muted/40 [&_.leaflet-control-attribution]:text-[9px]"
        role="img"
        aria-label="Map of facilities, drone bases and mission routes"
      />
    </div>
  );
}

export const NETWORK_MAP_NOTE =
  "Coordinates come from facility and base records. Airspace zones are a simulated training dataset — not an authoritative aeronautical chart.";
