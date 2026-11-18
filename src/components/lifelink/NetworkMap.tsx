import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { AlertTriangle, LocateFixed, Loader2, RotateCcw } from "lucide-react";
import { groupByCoordinate } from "@/lib/organizationMap";
import "leaflet/dist/leaflet.css";

export type NetworkMapPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "facility" | "pickup" | "dropoff" | "drone" | "base" | "zone";
  detail?: string;
  active?: boolean;
  /** Optional override used by the organization map colour system. */
  color?: string;
  /** Small status line shown above the popup title. */
  badge?: string;
  /** Additional safe popup lines (address, contact, status). */
  meta?: string[];
};

export type NetworkMapLegendItem = {
  color: string;
  label: string;
  hint?: string;
  shape?: "dot" | "gps";
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

// Esri World Imagery is a public, attribution-licensed satellite basemap.
const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const HOME: [number, number] = [18.5204, 73.8567];

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

function gpsIcon() {
  return L.divIcon({
    html: `<span style="position:relative;display:flex;align-items:center;justify-content:center;width:22px;height:22px">
      <span style="position:absolute;inset:0;border-radius:9999px;background:#3b82f6;opacity:.18"></span>
      <span style="position:absolute;inset:5px;border-radius:9999px;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 5px rgba(15,23,42,.45)"></span>
    </span>`,
    className: "lifelink-gps-marker",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11],
  });
}

function markerIcon(point: NetworkMapPoint) {
  const color = point.color ?? TONES[point.kind];
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

function popupHtml(group: NetworkMapPoint[]) {
  const blocks = group
    .map((point) => {
      const badge = point.badge
        ? `<span style="display:inline-block;margin:0 0 4px;padding:1px 6px;border-radius:9999px;background:${point.color ?? TONES[point.kind]}18;color:${point.color ?? TONES[point.kind]};font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(point.badge)}</span>`
        : "";
      const detail = point.detail
        ? `<p style="margin:4px 0 0;font-size:10px;line-height:1.5;color:#64748b">${escapeHtml(point.detail)}</p>`
        : "";
      const meta = (point.meta ?? [])
        .filter(Boolean)
        .map(
          (line) =>
            `<p style="margin:2px 0 0;font-size:10px;line-height:1.5;color:#475569">${escapeHtml(line)}</p>`,
        )
        .join("");
      return `<div style="padding:2px 0">
        ${badge}
        <p style="margin:0;font-size:11px;font-weight:700;color:#0f172a">${escapeHtml(point.label)}</p>
        ${detail}${meta}
      </div>`;
    })
    .join(
      '<div style="border-top:1px solid #e2e8f0;margin:5px 0"></div>',
    );
  return `<div style="font-family:Inter,system-ui,sans-serif;min-width:170px;max-width:250px">${blocks}</div>`;
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
  showOrganizationControls = false,
  showGps = false,
  groupDuplicateLocations = false,
  legend,
  legendNote,
  onResetView,
}: {
  points: NetworkMapPoint[];
  routes?: NetworkMapRoute[];
  zones?: NetworkMapZone[];
  height?: number;
  className?: string;
  focus?: [number, number] | null;
  showOrganizationControls?: boolean;
  showGps?: boolean;
  groupDuplicateLocations?: boolean;
  legend?: NetworkMapLegendItem[];
  legendNote?: string;
  onResetView?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const gpsLayerRef = useRef<L.LayerGroup | null>(null);
  const watchRef = useRef<number | null>(null);
  const centeredOnGpsRef = useRef(false);

  const [satellite, setSatellite] = useState(false);
  const [gps, setGps] = useState<{
    lat: number;
    lng: number;
    accuracy: number | null;
  } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<
    "idle" | "locating" | "ready" | "denied" | "unavailable" | "timeout"
  >("idle");
  const [gpsMessage, setGpsMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: false,
    }).setView(HOME, 11);
    L.control.zoom({ position: "topleft" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    gpsLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      gpsLayerRef.current = null;
      baseLayerRef.current = null;
    };
  }, []);

  // The basemap is replaced in place, so markers, GPS and filters survive a
  // street/satellite switch without recreating the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    const layer = satellite
      ? L.tileLayer(SATELLITE_TILES, {
          maxZoom: 19,
          attribution: SATELLITE_ATTRIBUTION,
        })
      : L.tileLayer(CARTO_API_KEY ? CARTO_TILES : OSM_TILES, {
          maxZoom: 19,
          attribution: CARTO_API_KEY ? CARTO_ATTRIBUTION : OSM_ATTRIBUTION,
          subdomains: "abcd",
        });
    layer.addTo(map);
    baseLayerRef.current = layer;
    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      if (baseLayerRef.current === layer) baseLayerRef.current = null;
    };
  }, [satellite]);

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
        .bindTooltip(`${escapeHtml(zone.label)} · ${zone.radiusKm} km`, {
          direction: "top",
        })
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

    // Overlapping coordinates are grouped into one marker with a popup that
    // still exposes every organization, instead of silently dropping records.
    const groups = groupDuplicateLocations
      ? groupByCoordinate(points)
      : points.map((point) => [point]);

    for (const group of groups) {
      const primary =
        group.find((point) => point.color === "#16A34A") ?? group[0];
      const active = group.some((point) => point.active);
      L.marker([primary.lat, primary.lng], {
        icon: markerIcon({
          ...primary,
          active,
          label:
            group.length > 1
              ? `${group.length} organizations`
              : primary.label,
        }),
        keyboard: true,
      })
        .bindPopup(popupHtml(group))
        .addTo(layer);
    }

    const coordinates = [
      ...points.map((p) => [p.lat, p.lng] as [number, number]),
      ...routes.flatMap((route) => route.points),
    ];
    if (focus) {
      map.setView(focus, Math.max(map.getZoom(), 12));
    } else if (
      coordinates.length > 0 &&
      !(showGps && centeredOnGpsRef.current)
    ) {
      // Once GPS has centered the map, reactive organization updates must not
      // pull the view away from the user's current location.
      map.fitBounds(L.latLngBounds(coordinates), {
        padding: [32, 32],
        maxZoom: 13,
      });
    }
  }, [points, routes, zones, focus, groupDuplicateLocations, showGps]);

  // Live GPS is intentionally browser-only: coordinates never leave this
  // component and are never written to Convex.
  useEffect(() => {
    if (!showGps) {
      centeredOnGpsRef.current = false;
      gpsLayerRef.current?.clearLayers();
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;

    const handleError = (error: GeolocationPositionError) => {
      if (cancelled) return;
      if (error.code === error.PERMISSION_DENIED) {
        setGpsStatus("denied");
        setGpsMessage(
          "Location access is disabled. Enable it in your browser's site settings, then use the location button. You can still browse the map manually.",
        );
        if (watchRef.current != null) {
          navigator.geolocation.clearWatch(watchRef.current);
          watchRef.current = null;
        }
      } else if (error.code === error.TIMEOUT) {
        setGpsStatus("timeout");
        setGpsMessage(
          "Location request timed out. Try the location button again or browse the map manually.",
        );
      } else {
        setGpsStatus("unavailable");
        setGpsMessage(
          "Your current location could not be determined. Organization markers are still available.",
        );
      }
    };

    try {
      watchRef.current = navigator.geolocation.watchPosition(
        (position) => {
          if (cancelled) return;
          const next = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy:
              Number.isFinite(position.coords.accuracy) &&
              position.coords.accuracy >= 0
                ? position.coords.accuracy
                : null,
          };
          setGps(next);
          setGpsStatus("ready");
          setGpsMessage(null);
          const map = mapRef.current;
          if (map && !centeredOnGpsRef.current) {
            centeredOnGpsRef.current = true;
            map.setView([next.lat, next.lng], 14, { animate: true });
          }
        },
        handleError,
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 30000,
        },
      );
    } catch {
      // The locate button reports unsupported/blocked geolocation to the user.
    }

    return () => {
      cancelled = true;
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [showGps]);

  useEffect(() => {
    const layer = gpsLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!gps) return;
    if (gps.accuracy != null) {
      L.circle([gps.lat, gps.lng], {
        radius: gps.accuracy,
        color: "#2563eb",
        weight: 1,
        opacity: 0.5,
        fillColor: "#3b82f6",
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(layer);
    }
    L.marker([gps.lat, gps.lng], {
      icon: gpsIcon(),
      zIndexOffset: 1000,
      keyboard: true,
    })
      .bindPopup(
        `<div style="font-family:Inter,system-ui,sans-serif;min-width:160px">
          <span style="display:inline-block;margin:0 0 4px;padding:1px 6px;border-radius:9999px;background:#2563eb18;color:#2563eb;font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Your current location</span>
          <p style="margin:0;font-size:11px;font-weight:700;color:#0f172a">GPS location</p>
          <p style="margin:4px 0 0;font-size:10px;line-height:1.5;color:#64748b">This is where your device is now, not your organization's registered base.${
            gps.accuracy != null
              ? ` Accuracy ±${Math.round(gps.accuracy)} m.`
              : ""
          }</p>
        </div>`,
      )
      .addTo(layer);
  }, [gps]);

  const requestLocation = () => {
    if (gpsStatus === "locating") return;
    const map = mapRef.current;
    const center = (lat: number, lng: number, zoom = 15) => {
      map?.setView([lat, lng], Math.max(map.getZoom(), zoom), {
        animate: true,
      });
    };
    if (gps) {
      center(gps.lat, gps.lng);
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsStatus("unavailable");
      setGpsMessage(
        "Location is not available in this browser. Organization markers and manual navigation still work.",
      );
      return;
    }
    setGpsStatus("locating");
    setGpsMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
        };
        setGps(next);
        setGpsStatus("ready");
        centeredOnGpsRef.current = true;
        center(next.lat, next.lng);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsStatus("denied");
          setGpsMessage(
            "Location access is disabled. Enable it in your browser's site settings, then use the location button. You can still browse the map manually.",
          );
        } else if (error.code === error.TIMEOUT) {
          setGpsStatus("timeout");
          setGpsMessage(
            "Location request timed out. Try the location button again or browse the map manually.",
          );
        } else {
          setGpsStatus("unavailable");
          setGpsMessage(
            "Your current location could not be determined. Organization markers are still available.",
          );
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  };

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    onResetView?.();
    const coordinates: Array<[number, number]> = points.map((point) => [
      point.lat,
      point.lng,
    ]);
    if (gps) coordinates.push([gps.lat, gps.lng]);
    if (coordinates.length > 0) {
      map.fitBounds(L.latLngBounds(coordinates), {
        padding: [40, 40],
        maxZoom: 14,
      });
    } else {
      map.setView(HOME, 11);
    }
  };

  return (
    <div className={className}>
      {!CARTO_API_KEY && !satellite && (
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
      <div className="relative">
        <div
          ref={containerRef}
          style={{ height }}
          className="w-full overflow-hidden rounded-2xl border border-border bg-muted/40 [&_.leaflet-control-attribution]:text-[9px]"
          role="img"
          aria-label="Map of verified hospitals, Red Cross societies and your current location"
        />
        {showOrganizationControls && (
          <div className="absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
            <div className="flex overflow-hidden rounded-xl border border-border bg-card/95 shadow-md backdrop-blur">
              <button
                type="button"
                onClick={() => setSatellite(false)}
                aria-pressed={!satellite}
                title="Standard street map"
                className={`px-2.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                  satellite
                    ? "text-muted-foreground hover:bg-muted"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                Street
              </button>
              <button
                type="button"
                onClick={() => setSatellite(true)}
                aria-pressed={satellite}
                title="Satellite imagery"
                className={`border-l border-border px-2.5 py-1.5 text-[10.5px] font-semibold transition-colors ${
                  satellite
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                Satellite
              </button>
            </div>
            {showGps && (
              <button
                type="button"
                onClick={requestLocation}
                disabled={gpsStatus === "locating"}
                aria-label="Show my current location"
                title="Show my current location"
                className="flex size-9 items-center justify-center rounded-xl border border-border bg-card/95 text-primary shadow-md backdrop-blur transition-colors hover:bg-muted disabled:opacity-60"
              >
                {gpsStatus === "locating" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LocateFixed className="size-4" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={resetView}
              aria-label="Reset map view"
              title="Reset map view"
              className="flex size-9 items-center justify-center rounded-xl border border-border bg-card/95 text-foreground shadow-md backdrop-blur transition-colors hover:bg-muted"
            >
              <RotateCcw className="size-4" />
            </button>
          </div>
        )}
      </div>

      {showGps && gpsMessage && (
        <p
          role="status"
          className="mt-2 rounded-xl border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-[10.5px] leading-5 text-amber-900"
        >
          {gpsMessage}
        </p>
      )}

      {legend && legend.length > 0 && (
        <div className="mt-2 rounded-xl border border-border bg-card px-3 py-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {legend.map((item) => (
              <span
                key={item.label}
                className="inline-flex items-center gap-1.5 text-[10px] font-medium text-foreground"
                title={item.hint}
              >
                {item.shape === "gps" ? (
                  <span
                    aria-hidden
                    className="flex size-3 items-center justify-center rounded-full border border-blue-200 bg-blue-100"
                  >
                    <span
                      className="size-1.5 rounded-full border border-white"
                      style={{ background: item.color }}
                    />
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full border-2 border-white shadow-sm"
                    style={{ background: item.color }}
                  />
                )}
                {item.label}
              </span>
            ))}
          </div>
          {legendNote && (
            <p className="mt-1.5 text-[9.5px] leading-4 text-muted-foreground">
              {legendNote}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export const NETWORK_MAP_NOTE =
  "Coordinates come from facility and base records. Airspace zones are a simulated training dataset — not an authoritative aeronautical chart.";
