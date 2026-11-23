import { Component, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  GPS_COLOR,
  HOSPITAL_COLOR,
  OWN_BASE_COLOR,
  RED_CROSS_COLOR,
  filterOrganizationLocations,
  organizationFilterCounts,
  organizationMarkerColor,
  type OrganizationMapFilter,
} from "@/lib/organizationMap";
import { MapPinOff, RefreshCw } from "lucide-react";
import {
  NetworkMap,
  type NetworkMapLegendItem,
  type NetworkMapPoint,
} from "./NetworkMap";

type MapFilter = OrganizationMapFilter;

export type OrganizationMapCandidate = {
  organizationId: string;
  usableUnits: number;
  score: number;
  autoAuthorized: boolean;
  eligible: boolean;
};

const FILTERS: Array<{ key: MapFilter; label: string }> = [
  { key: "all", label: "All locations" },
  { key: "hospital", label: "Hospitals" },
  { key: "red_cross", label: "Blood banks" },
  { key: "own", label: "Your bases" },
];

class MapPanelErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-[12px]"
        >
          <p className="font-semibold text-foreground">
            Organization locations could not be loaded.
          </p>
          <p className="mt-1 text-muted-foreground">
            The rest of the dashboard is unaffected. Check the connection and try
            again.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 gap-1.5"
            onClick={() => this.setState({ failed: false })}
          >
            <RefreshCw className="size-3.5" /> Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function OrganizationMapData({
  height,
  candidates,
}: {
  height: number;
  candidates: OrganizationMapCandidate[];
}) {
  const data = useQuery(api.profiles.mapLocations);
  const [filter, setFilter] = useState<MapFilter>("all");

  const locations = data?.locations ?? [];
  const counts = organizationFilterCounts(locations);

  const filtered = useMemo(
    () => filterOrganizationLocations(locations, filter),
    [locations, filter],
  );

  const candidatesByOrg = useMemo(() => {
    const map = new Map<string, OrganizationMapCandidate>();
    for (const candidate of candidates) {
      if (!candidate.eligible) continue;
      map.set(String(candidate.organizationId), candidate);
    }
    return map;
  }, [candidates]);

  const points: NetworkMapPoint[] = useMemo(
    () =>
      filtered.map((location) => {
        const candidate = candidatesByOrg.get(location.id);
        const color = organizationMarkerColor(location);
        const badge = location.isOwnBase
          ? "YOUR ORGANIZATION BASE"
          : location.type === "hospital"
            ? "Registered hospital"
            : "Registered blood bank";
        const meta = [
          location.city +
            (location.area ? ` · ${location.area}` : ""),
          `Status: ${location.status === "verified" ? "Verified" : location.status}`,
          location.phone ? `Contact: ${location.phone}` : "",
        ].filter(Boolean);
        if (candidate) {
          meta.push(
            `${candidate.usableUnits} free unit(s) · score ${candidate.score} · ${candidate.autoAuthorized ? "pre-authorised" : "agreement required"}`,
          );
        }
        return {
          id: location.id,
          lat: location.latitude,
          lng: location.longitude,
          label: location.name,
          kind: "facility" as const,
          detail: location.address,
          badge,
          meta,
          color,
          active: candidate != null,
        };
      }),
    [filtered, candidatesByOrg],
  );

  const legend: NetworkMapLegendItem[] = [
    { color: HOSPITAL_COLOR, label: "Registered hospitals" },
    { color: RED_CROSS_COLOR, label: "Registered blood banks" },
    {
      color: OWN_BASE_COLOR,
      label: "Your organization base",
      hint: "Only the base linked to your authenticated organization.",
    },
    {
      color: GPS_COLOR,
      label: "Your current location (GPS dot)",
      hint: "Your device location, never your organization base.",
      shape: "gps",
    },
  ];


  if (data === undefined) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading organization map">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <Skeleton key={item.key} className="h-7 w-24 rounded-full" />
          ))}
        </div>
        <Skeleton className="w-full rounded-2xl" style={{ height }} />
        <Skeleton className="h-8 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter organization locations">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={filter === item.key}
            onClick={() => setFilter(item.key)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-colors",
              filter === item.key
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/25 hover:text-foreground",
            )}
          >
            {item.label}
            <span className="ml-1 tabular-nums opacity-70">{counts[item.key]}</span>
          </button>
        ))}
      </div>

      <NetworkMap
        points={points}
        height={height}
        showOrganizationControls
        showGps
        groupDuplicateLocations
        legend={legend}
        legendNote="Green identifies the registered base belonging to your authenticated organization. The GPS marker identifies your current physical location."
        onResetView={() => setFilter("all")}
      />

      {points.length === 0 && (
        <p className="mt-2 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          {locations.length === 0
            ? "No verified hospitals or blood banks with registered coordinates are available yet."
            : filter === "own"
              ? counts.own === 0
                ? "No organization base is linked to this account."
                : "No locations match this filter."
              : "No locations match this filter."}
        </p>
      )}

      {data.missingLocations.length > 0 && (
        <details className="mt-2 rounded-xl border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-[10.5px] text-amber-950">
          <summary className="flex cursor-pointer items-center gap-1.5 font-semibold">
            <MapPinOff className="size-3.5" />
            {data.missingLocations.length} verified location
            {data.missingLocations.length === 1 ? "" : "s"} without usable
            coordinates
          </summary>
          <ul className="mt-1.5 space-y-1 pl-5">
            {data.missingLocations.map((location) => (
              <li key={location.id} className="list-disc leading-4">
                <span className="font-semibold">{location.name}</span>
                {" · "}
                {location.city}
                {" — "}
                {location.reason.toLowerCase()}.
                {location.isOwnBase ? " This is your organization." : ""}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 pl-5 text-[9.5px] leading-4 text-amber-900/80">
            These organizations are registered but are not plotted, because an
            approximate or fabricated map position would be misleading.
          </p>
        </details>
      )}
    </div>
  );
}

/**
 * Reusable organization network map. It reads verified locations and the
 * viewer's own-base flag from the backend, keeps GPS local to the browser and
 * never merges the user's live position with an organization coordinate.
 */
export function OrganizationMapPanel({
  height = 360,
  candidates = [],
  className,
}: {
  height?: number;
  candidates?: OrganizationMapCandidate[];
  className?: string;
}) {
  return (
    <MapPanelErrorBoundary>
      <div className={className}>
        <OrganizationMapData height={height} candidates={candidates} />
      </div>
    </MapPanelErrorBoundary>
  );
}
